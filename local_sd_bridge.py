#!/usr/bin/env python3
import base64
import json
import os
import random
import time
import urllib.error
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

BRIDGE_HOST = os.environ.get("BRIDGE_HOST", "127.0.0.1")
BRIDGE_PORT = int(os.environ.get("BRIDGE_PORT", "8000"))
ED_BASE = os.environ.get("ED_BASE_URL", "http://127.0.0.1:9000").rstrip("/")
CORS_ALLOW_ORIGIN = os.environ.get("BRIDGE_CORS_ALLOW_ORIGIN", "*")
REQUEST_TIMEOUT = int(os.environ.get("BRIDGE_REQUEST_TIMEOUT", "45"))
TASK_TIMEOUT = int(os.environ.get("BRIDGE_TASK_TIMEOUT", "900"))


def _backend_url(path: str) -> str:
    return f"{ED_BASE}/{path.lstrip('/')}"


def _http_json(method: str, path: str, payload=None, timeout=REQUEST_TIMEOUT):
    body = None
    headers = {"Accept": "application/json"}
    if payload is not None:
        body = json.dumps(payload).encode("utf-8")
        headers["Content-Type"] = "application/json"

    req = urllib.request.Request(_backend_url(path), data=body, headers=headers, method=method)
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        raw = resp.read().decode("utf-8", errors="replace")
        return json.loads(raw) if raw else {}


def _http_bytes(method: str, url: str, timeout=REQUEST_TIMEOUT):
    req = urllib.request.Request(url, method=method)
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read()


def _parse_concatenated_json(payload: str):
    decoder = json.JSONDecoder()
    idx = 0
    out = []
    n = len(payload)
    while idx < n:
        while idx < n and payload[idx].isspace():
            idx += 1
        if idx >= n:
            break
        obj, nxt = decoder.raw_decode(payload, idx)
        out.append(obj)
        idx = nxt
    return out


def _pick_model():
    try:
        models_resp = _http_json("GET", "/get/models")
        models = models_resp.get("models", [])
        for m in models:
            tags = m.get("tags") or []
            if "stable-diffusion" in tags:
                return m.get("model") or "sd-v1-5"
        for m in models:
            model_name = m.get("model")
            if model_name:
                return model_name
    except Exception:
        pass
    return "sd-v1-5"


def _map_sampler(name: str) -> str:
    if not name:
        return "euler_a"
    raw = name.strip().lower()
    direct_map = {
        "euler a": "euler_a",
        "euler": "euler",
        "ddim": "ddim",
        "plms": "plms",
    }
    if raw in direct_map:
        return direct_map[raw]
    return raw.replace(" ", "_").replace("+", "plus")


class BridgeHandler(BaseHTTPRequestHandler):
    server_version = "LocalSDBridge/1.0"

    def _set_headers(self, code=200, content_type="application/json"):
        self.send_response(code)
        self.send_header("Content-Type", content_type)
        self.send_header("Access-Control-Allow-Origin", CORS_ALLOW_ORIGIN)
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With")
        self.send_header("Access-Control-Max-Age", "86400")
        self.end_headers()

    def _write_json(self, code, payload):
        self._set_headers(code=code, content_type="application/json")
        self.wfile.write(json.dumps(payload).encode("utf-8"))

    def do_OPTIONS(self):
        self._set_headers(code=204, content_type="text/plain")

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path

        if path == "/health":
            return self._write_json(200, {"ok": True, "bridge": "local_sd_bridge", "backend": ED_BASE})

        if path == "/sdapi/v1/options":
            try:
                model = _pick_model()
                return self._write_json(
                    200,
                    {
                        "sd_model_checkpoint": model,
                        "samples_save": False,
                        "jpeg_quality": 75,
                        "bridge_backend": "Easy Diffusion",
                    },
                )
            except Exception as exc:
                return self._write_json(502, {"error": f"Backend check failed: {exc}"})

        if path == "/sdapi/v1/samplers":
            return self._write_json(
                200,
                [{"name": s} for s in ["euler_a", "euler", "ddim", "plms"]],
            )

        return self._write_json(404, {"error": "Not found"})

    def do_POST(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path

        if path != "/sdapi/v1/txt2img":
            return self._write_json(404, {"error": "Not found"})

        try:
            length = int(self.headers.get("Content-Length", "0"))
            payload = json.loads(self.rfile.read(length).decode("utf-8")) if length > 0 else {}
        except Exception as exc:
            return self._write_json(400, {"error": f"Invalid JSON: {exc}"})

        prompt = str(payload.get("prompt", "")).strip()
        if not prompt:
            return self._write_json(400, {"error": "prompt is required"})

        width = int(payload.get("width", 512))
        height = int(payload.get("height", 512))
        steps = int(payload.get("steps", 28))
        cfg = float(payload.get("cfg_scale", 7.5))
        batch_size = max(1, int(payload.get("batch_size", 1)))
        incoming_seed = int(payload.get("seed", -1))
        seed = incoming_seed if incoming_seed >= 0 else random.randint(0, 2**32 - 1)

        session_id = f"bridge-{int(time.time() * 1000)}"
        model = _pick_model()
        sampler = _map_sampler(str(payload.get("sampler_name", "euler_a")))
        render_req = {
            "session_id": session_id,
            "prompt": prompt,
            "negative_prompt": str(payload.get("negative_prompt", "")),
            "width": width,
            "height": height,
            "seed": seed,
            "sampler_name": sampler,
            "use_stable_diffusion_model": model,
            "clip_skip": False,
            "num_inference_steps": steps,
            "guidance_scale": cfg,
            "num_outputs": batch_size,
            "stream_progress_updates": False,
            "stream_image_progress": False,
            "show_only_filtered_image": True,
            "block_nsfw": False,
            "output_format": "png",
            "output_quality": 75,
            "output_lossless": False,
            "metadata_output_format": "none",
            "original_prompt": prompt,
            "active_tags": [],
            "inactive_tags": [],
        }

        try:
            render_response = _http_json("POST", "/render", render_req)
            task_id = render_response.get("task")
            if not task_id:
                return self._write_json(502, {"error": f"Invalid /render response: {render_response}"})

            deadline = time.time() + TASK_TIMEOUT
            final_state = None
            while time.time() < deadline:
                ping = _http_json("GET", f"/ping?session_id={urllib.parse.quote(session_id)}")
                tasks = ping.get("tasks") or {}
                state = tasks.get(str(task_id))
                if state in ("completed", "error", "stopped"):
                    final_state = state
                    break
                time.sleep(1.0)

            if final_state is None:
                return self._write_json(504, {"error": "Timed out waiting for backend task completion"})

            raw_stream = _http_bytes("GET", _backend_url(f"/image/stream/{task_id}"), timeout=REQUEST_TIMEOUT).decode(
                "utf-8", errors="replace"
            )
            chunks = _parse_concatenated_json(raw_stream) if raw_stream else []
            final_payload = chunks[-1] if chunks else {}

            if final_payload.get("status") != "succeeded":
                detail = final_payload.get("detail") or final_payload.get("status") or "Generation failed"
                return self._write_json(502, {"error": detail, "backend_payload": final_payload})

            output = final_payload.get("output") or []
            images_b64 = []
            for item in output:
                if isinstance(item, dict) and item.get("data"):
                    raw = str(item["data"])
                    if raw.startswith("data:image"):
                        raw = raw.split(",", 1)[1]
                    images_b64.append(raw)
                    continue

                path_value = None
                if isinstance(item, dict):
                    path_value = item.get("path")
                elif isinstance(item, str):
                    path_value = item

                if path_value:
                    img_bytes = _http_bytes("GET", _backend_url(path_value), timeout=REQUEST_TIMEOUT)
                    images_b64.append(base64.b64encode(img_bytes).decode("ascii"))

            if not images_b64:
                return self._write_json(502, {"error": "No images returned by backend", "backend_payload": final_payload})

            return self._write_json(
                200,
                {
                    "images": images_b64,
                    "parameters": payload,
                    "info": json.dumps(
                        {
                            "bridge": "easy-diffusion",
                            "task_id": task_id,
                            "model": model,
                            "sampler": sampler,
                        }
                    ),
                },
            )
        except urllib.error.HTTPError as exc:
            try:
                detail = exc.read().decode("utf-8", errors="replace")
            except Exception:
                detail = str(exc)
            return self._write_json(502, {"error": f"Backend HTTP error {exc.code}", "detail": detail})
        except Exception as exc:
            return self._write_json(500, {"error": str(exc)})


def main():
    server = ThreadingHTTPServer((BRIDGE_HOST, BRIDGE_PORT), BridgeHandler)
    print(f"[local_sd_bridge] listening on http://{BRIDGE_HOST}:{BRIDGE_PORT} -> {ED_BASE}")
    server.serve_forever()


if __name__ == "__main__":
    main()
