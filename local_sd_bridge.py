#!/usr/bin/env python3
import os
import urllib.error
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


BRIDGE_HOST = os.environ.get("BRIDGE_HOST", "127.0.0.1")
BRIDGE_PORT = int(os.environ.get("BRIDGE_PORT", "8000"))
CORS_ALLOW_ORIGIN = os.environ.get("BRIDGE_CORS_ALLOW_ORIGIN", "*")
REQUEST_TIMEOUT = int(os.environ.get("BRIDGE_REQUEST_TIMEOUT", "180"))


def _is_allowed_target(target: str) -> bool:
    try:
        parsed = urllib.parse.urlparse(target)
    except Exception:
        return False
    return parsed.scheme in ("http", "https") and bool(parsed.netloc)


def _copy_response(handler: BaseHTTPRequestHandler, status: int, headers, body: bytes) -> None:
    content_type = headers.get("Content-Type", "application/json")
    handler.send_response(status)
    handler.send_header("Content-Type", content_type)
    handler.send_header("Access-Control-Allow-Origin", CORS_ALLOW_ORIGIN)
    handler.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
    handler.send_header(
        "Access-Control-Allow-Headers",
        "Content-Type, Authorization, X-Requested-With, Access-Control-Request-Private-Network",
    )
    handler.send_header("Access-Control-Allow-Private-Network", "true")
    handler.send_header("Access-Control-Max-Age", "86400")
    handler.send_header("Cross-Origin-Resource-Policy", "cross-origin")
    if body is not None:
        handler.send_header("Content-Length", str(len(body)))
    handler.end_headers()
    if body:
        handler.wfile.write(body)


class RelayHandler(BaseHTTPRequestHandler):
    server_version = "LocalSDRelay/2.0"

    def _send_json(self, code: int, payload: str) -> None:
        _copy_response(self, code, {"Content-Type": "application/json"}, payload.encode("utf-8"))

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", CORS_ALLOW_ORIGIN)
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header(
            "Access-Control-Allow-Headers",
            "Content-Type, Authorization, X-Requested-With, Access-Control-Request-Private-Network",
        )
        self.send_header("Access-Control-Allow-Private-Network", "true")
        self.send_header("Access-Control-Max-Age", "86400")
        self.end_headers()

    def do_GET(self):
        self._handle_proxy()

    def do_POST(self):
        self._handle_proxy()

    def _handle_proxy(self):
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path == "/health":
            self._send_json(200, '{"ok":true,"relay":"local_sd_bridge"}')
            return

        if parsed.path != "/proxy":
            self._send_json(404, '{"error":"Not found"}')
            return

        params = urllib.parse.parse_qs(parsed.query)
        target = (params.get("target") or [""])[0]
        if not _is_allowed_target(target):
            self._send_json(400, '{"error":"Missing or invalid target URL"}')
            return

        body = None
        content_length = int(self.headers.get("Content-Length", "0") or "0")
        if content_length > 0:
            body = self.rfile.read(content_length)

        headers = {}
        if self.headers.get("Content-Type"):
            headers["Content-Type"] = self.headers.get("Content-Type")
        if self.headers.get("Accept"):
            headers["Accept"] = self.headers.get("Accept")
        if self.headers.get("Authorization"):
            headers["Authorization"] = self.headers.get("Authorization")

        request = urllib.request.Request(target, data=body, headers=headers, method=self.command)
        try:
            with urllib.request.urlopen(request, timeout=REQUEST_TIMEOUT) as response:
                payload = response.read()
                _copy_response(self, response.getcode(), response.headers, payload)
        except urllib.error.HTTPError as exc:
            payload = exc.read()
            _copy_response(self, exc.code, exc.headers, payload)
        except Exception as exc:
            safe = str(exc).replace('"', '\\"')
            self._send_json(502, f'{{"error":"Relay could not reach target","detail":"{safe}"}}')


def main():
    server = ThreadingHTTPServer((BRIDGE_HOST, BRIDGE_PORT), RelayHandler)
    print(f"[local_sd_bridge] listening on http://{BRIDGE_HOST}:{BRIDGE_PORT}")
    server.serve_forever()


if __name__ == "__main__":
    main()
