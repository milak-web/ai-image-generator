import os
import re
import time
import uuid
import queue
import threading
import requests
import socket
from flask import Flask, request, Response, jsonify, send_from_directory, send_file
from flask_cors import CORS

# --- CONFIGURATION ---
PORT = 8000
VERSION = "5.0-PUBLIC-STABLE"

def get_local_ips():
    ips = []
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ips.append(s.getsockname()[0])
        s.close()
    except Exception:
        ips.append("127.0.0.1")
    return list(set(ips))

app = Flask(__name__)
CORS(app)

@app.after_request
def after_request(response):
    response.headers.add('Access-Control-Allow-Origin', '*')
    response.headers.add('Access-Control-Allow-Headers', 'Content-Type,Authorization,X-Target-URL')
    response.headers.add('Access-Control-Allow-Methods', 'GET,PUT,POST,DELETE,OPTIONS')
    response.headers.add('Access-Control-Allow-Private-Network', 'true')
    return response

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
            print(f"[{time.strftime('%H:%M:%S')}] Executing Job {job_id} -> {job['url']}")
            resp = session.request(
                method=job['method'],
                url=job['url'],
                headers=job['headers'],
                data=job['data'],
                timeout=300 # 5 minutes max for SD
            )
            if resp.ok:
                jobs[job_id]['result'] = resp.json()
                jobs[job_id]['status'] = 'done'
                print(f"[{time.strftime('%H:%M:%S')}] Job {job_id} SUCCESS")
            else:
                jobs[job_id]['status'] = 'error'
                jobs[job_id]['error'] = f"HTTP {resp.status_code}: {resp.text[:200]}"
                print(f"[{time.strftime('%H:%M:%S')}] Job {job_id} FAILED: {resp.status_code}")
        except Exception as e:
            jobs[job_id]['status'] = 'error'
            jobs[job_id]['error'] = str(e)
            print(f"[{time.strftime('%H:%M:%S')}] Job {job_id} EXCEPTION: {str(e)}")
        job_queue.task_done()

# Cleanup thread for old jobs
def cleanup_loop():
    while True:
        time.sleep(300) # Clean every 5 mins
        now = time.time()
        to_delete = [jid for jid, j in jobs.items() if now - j.get('start_time', 0) > 3600]
        for jid in to_delete:
            del jobs[jid]
        if to_delete:
            print(f"[{time.strftime('%H:%M:%S')}] Cleaned up {len(to_delete)} expired jobs")

threading.Thread(target=worker_loop, daemon=True).start()
threading.Thread(target=cleanup_loop, daemon=True).start()

# --- ROUTES ---

@app.route('/')
def index():
    html_path = os.path.join(os.getcwd(), 'index.html')
    if os.path.exists(html_path):
        return send_file(html_path)
    return jsonify({"error": "index.html not found"}), 404

@app.route('/health')
def health():
    return jsonify({"status": "ok", "version": VERSION, "ips": get_local_ips()})

@app.route('/proxy', methods=['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'])
def proxy_query():
    if request.method == 'OPTIONS':
        resp = Response(status=200)
        resp.headers['Access-Control-Allow-Private-Network'] = 'true'
        return resp
    target_url = request.args.get('url') or request.headers.get('X-Target-URL')
    if not target_url:
        return "Error: No 'url' parameter provided.", 400
    return handle_proxy_logic(target_url)

@app.route('/proxy/<path:url_path>', methods=['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'])
def proxy_path(url_path):
    if url_path.startswith('http:/') and not url_path.startswith('http://'):
        url_path = url_path.replace('http:/', 'http://', 1)
    elif url_path.startswith('https:/') and not url_path.startswith('https://'):
        url_path = url_path.replace('https:/', 'https://', 1)
    elif not url_path.startswith('http'):
        url_path = 'https://' + url_path
    return handle_proxy_logic(url_path)

def handle_proxy_logic(target_url):
    if request.method == 'OPTIONS':
        resp = Response(status=200)
        resp.headers['Access-Control-Allow-Private-Network'] = 'true'
        return resp

    print(f"[{time.strftime('%H:%M:%S')}] Proxying -> {target_url}")
    
    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
        'Accept': '*/*',
        'Connection': 'keep-alive'
    }
    
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
    if request.method == 'OPTIONS':
        resp = Response(status=200)
        resp.headers['Access-Control-Allow-Private-Network'] = 'true'
        return resp
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

@app.route('/job_status/<job_id>')
def job_status(job_id):
    if job_id not in jobs: return jsonify({"error": "Job not found"}), 404
    return jsonify(jobs[job_id])

@app.route('/<path:path>')
def static_proxy(path):
    return send_from_directory('.', path)

if __name__ == '__main__':
    ips = get_local_ips()
    print("\n" + "="*60)
    print(f"AI Studio Pro Public Server v{VERSION}")
    print(f"Local Access: http://localhost:{PORT}")
    for ip in ips:
        print(f"Public/Mobile Access: http://{ip}:{PORT}")
    print("="*60 + "\n")
    app.run(host='0.0.0.0', port=PORT, debug=False)
