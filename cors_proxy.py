import os
import re
import time
import uuid
import queue
import threading
import requests
import socket
import pyperclip
from flask import Flask, request, Response, jsonify, stream_with_context, send_file
from flask_cors import CORS

# --- CONFIGURATION ---
PORT = 8001
VERSION = "3.0-ULTRA-STABLE"

def get_local_ip():
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except:
        return "127.0.0.1"

app = Flask(__name__)
CORS(app) # Allow everything

# --- ASYNC JOB ENGINE ---
jobs = {}
job_queue = queue.Queue()
session = requests.Session()

def worker_loop():
    print(f"[{time.strftime('%H:%M:%S')}] Background Worker Active")
    while True:
        job = job_queue.get()
        job_id = job['id']
        jobs[job_id]['status'] = 'processing'
        try:
            resp = session.request(
                method=job['method'],
                url=job['url'],
                headers=job['headers'],
                data=job['data'],
                timeout=10800
            )
            if resp.ok:
                jobs[job_id]['result'] = resp.json()
                jobs[job_id]['status'] = 'done'
            else:
                jobs[job_id]['status'] = 'error'
                jobs[job_id]['error'] = f"HTTP {resp.status_code}"
        except Exception as e:
            jobs[job_id]['status'] = 'error'
            jobs[job_id]['error'] = str(e)
        job_queue.task_done()

threading.Thread(target=worker_loop, daemon=True).start()

# --- THE FOOLPROOF ROUTES ---

@app.route('/')
def index():
    # Serve the actual app file directly!
    html_path = os.path.join(os.getcwd(), 'index.html')
    if os.path.exists(html_path):
        return send_file(html_path)
    return jsonify({
        "error": "index.html not found in current directory",
        "cwd": os.getcwd()
    }), 404

@app.route('/status')
def status():
    return jsonify({
        "server": "CORS Proxy",
        "version": VERSION,
        "ip": get_local_ip(),
        "status": "online"
    })

@app.route('/health')
def health():
    return jsonify({"status": "ok", "version": VERSION})

@app.route('/clipboard')
def get_clipboard():
    # Privacy Shield: Only allow the PC itself to access the system clipboard
    # This prevents mobile devices from seeing the PC's clipboard content
    remote_addr = request.remote_addr
    if remote_addr not in ['127.0.0.1', 'localhost', '::1']:
        return jsonify({"error": "Access denied: Clipboard sync is PC-only for privacy"}), 403
        
    try:
        text = pyperclip.paste()
        return jsonify({"text": text})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/proxy', methods=['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'])
def proxy_query():
    target_url = request.args.get('url') or request.headers.get('X-Target-URL')
    if not target_url:
        return "Error: No 'url' parameter provided in query string.", 400
    return handle_proxy_logic(target_url)

@app.route('/proxy/<path:url_path>', methods=['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'])
def proxy_path(url_path):
    # Fix protocol if swallowed
    if url_path.startswith('http:/') and not url_path.startswith('http://'):
        url_path = url_path.replace('http:/', 'http://', 1)
    elif url_path.startswith('https:/') and not url_path.startswith('https://'):
        url_path = url_path.replace('https:/', 'https://', 1)
    elif not url_path.startswith('http'):
        url_path = 'https://' + url_path
    return handle_proxy_logic(url_path)

def handle_proxy_logic(target_url):
    if request.method == 'OPTIONS':
        return Response(status=200)

    print(f"[{time.strftime('%H:%M:%S')}] Proxying -> {target_url}")
    
    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
        'Accept': '*/*',
        'Connection': 'keep-alive'
    }
    
    # Forward headers for API calls
    if request.headers.get('X-Target-URL'):
        for k, v in request.headers.items():
            if k.lower() not in ['host', 'origin', 'referer', 'content-length', 'cookie']:
                headers[k] = v

    try:
        resp = session.request(
            method=request.method,
            url=target_url,
            headers=headers,
            data=request.get_data() if request.method not in ['GET', 'HEAD'] else None,
            allow_redirects=True,
            timeout=30,
            stream=True
        )
        
        # Scrub HTML for iframing
        content_type = resp.headers.get('Content-Type', '')
        if 'text/html' in content_type:
            html = resp.text
            html = re.sub(r'<meta[^>]+http-equiv=["\'](X-Frame-Options|Content-Security-Policy)["\'][^>]*>', '', html, flags=re.I)
            parsed_url = requests.utils.urlparse(target_url)
            base_tag = f'<base href="{parsed_url.scheme}://{parsed_url.netloc}/">'
            html = html.replace('<head>', f'<head>{base_tag}', 1) if '<head>' in html else base_tag + html
            html = html.replace('window.top', 'window.self').replace('top.location', 'self.location')
            response = Response(html, resp.status_code)
        else:
            response = Response(resp.content, resp.status_code)

        # Cleanup headers
        excluded = ['content-encoding', 'content-length', 'transfer-encoding', 'connection', 'x-frame-options', 'content-security-policy', 'set-cookie']
        for k, v in resp.headers.items():
            if k.lower() not in excluded:
                response.headers[k] = v
        
        response.headers['Access-Control-Allow-Origin'] = '*'
        response.headers['X-Frame-Options'] = 'ALLOWALL'
        return response
    except Exception as e:
        return str(e), 502

@app.route('/submit_job', methods=['POST', 'OPTIONS'])
def submit_job():
    if request.method == 'OPTIONS': return Response(status=200)
    target_url = request.headers.get('X-Target-URL')
    if not target_url: return jsonify({"error": "Missing X-Target-URL"}), 400
    
    job_id = str(uuid.uuid4())
    jobs[job_id] = {'status': 'pending', 'start_time': time.time()}
    job_queue.put({
        'id': job_id, 'method': request.method, 'url': target_url,
        'headers': {k: v for k, v in request.headers.items() if k.lower() not in ['host', 'content-length']},
        'data': request.get_data()
    })
    return jsonify({"job_id": job_id})

@app.route('/check_job_status/<job_id>')
def check_status(job_id):
    job = jobs.get(job_id)
    return jsonify(job) if job else (jsonify({"status": "not_found"}), 404)

@app.route('/check_job/<job_id>')
def check_result(job_id):
    return check_status(job_id)

if __name__ == '__main__':
    local_ip = get_local_ip()
    print("\n" + "="*60)
    print(f"  ULTRA-STABLE PROXY SERVER v{VERSION}")
    print("="*60)
    print(f"  Local Access:   http://127.0.0.1:{PORT}")
    print(f"  Network Access: http://{local_ip}:{PORT}")
    print("="*60 + "\n")
    app.run(host='0.0.0.0', port=PORT, threaded=True, debug=False)
