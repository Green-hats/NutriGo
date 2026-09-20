import http.client
import json
import os
from pathlib import Path
import socket
import shutil
import subprocess
import tempfile
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


finish_stream = threading.Event()


class Upstream(BaseHTTPRequestHandler):
    def do_GET(self):
        self.respond()

    def do_POST(self):
        self.respond()

    def do_DELETE(self):
        self.respond()

    def respond(self):
        if self.path.startswith('/api/chat?'):
            self.send_response(200)
            self.send_header('Content-Type', 'text/event-stream')
            self.end_headers()
            self.wfile.write(b'event: chunk\ndata: hello\n\n')
            self.wfile.flush()
            finish_stream.wait(5)
            self.wfile.write(b'event: done\ndata: \n\n')
            self.wfile.flush()
            return
        body = self.rfile.read(int(self.headers.get('Content-Length', 0))).decode()
        data = json.dumps({
            'service': self.server.service, 'method': self.command, 'path': self.path,
            'authorization': self.headers.get('Authorization'), 'body': body,
        }).encode()
        self.send_response(404 if self.path.endswith('/missing') else 200)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, *args):
        pass


servers = []
process = None
try:
    for service in ('backend', 'agent'):
        server = ThreadingHTTPServer(('127.0.0.1', 0), Upstream)
        server.service = service
        threading.Thread(target=server.serve_forever, daemon=True).start()
        servers.append(server)
    with socket.socket() as probe:
        probe.bind(('127.0.0.1', 0))
        port = probe.getsockname()[1]
    with tempfile.TemporaryDirectory(prefix='nutrigo-proxy-') as temp:
        root = Path(temp)
        template = (Path(__file__).resolve().parents[1] / 'Caddyfile').read_text()
        config = (template.replace('{', '{\n admin off\n auto_https off', 1)
                  .replace('{$API_DOMAIN}', f'http://127.0.0.1:{port}')
                  .replace('backend:3333', f'127.0.0.1:{servers[0].server_port}')
                  .replace('agent:8000', f'127.0.0.1:{servers[1].server_port}')
                  )
        config_path = root / 'Caddyfile'
        config_path.write_text(config)
        env = dict(os.environ, XDG_CONFIG_HOME=temp, XDG_DATA_HOME=temp)
        caddy = os.environ.get('CADDY_BIN') or shutil.which('caddy')
        if not caddy:
            raise SystemExit('Install Caddy or set CADDY_BIN')
        command = [caddy, 'validate', '--config', str(config_path), '--adapter', 'caddyfile']
        subprocess.run(command, check=True, env=env, capture_output=True)
        print('PASS Caddy configuration validation', flush=True)
        log = (root / 'caddy.log').open('w')
        process = subprocess.Popen([caddy, 'run', '--config', str(config_path)],
                                   env=env, stdout=log, stderr=log)
        for _ in range(100):
            try:
                with socket.create_connection(('127.0.0.1', port), timeout=.1):
                    break
            except OSError:
                if process.poll() is not None:
                    raise RuntimeError((root / 'caddy.log').read_text())
                time.sleep(.05)
        else:
            raise RuntimeError('Caddy did not start')

        def request(path, method='GET', body=None):
            conn = http.client.HTTPConnection('127.0.0.1', port, timeout=3)
            conn.request(method, path, body=body, headers={'Authorization': 'Bearer test-token'})
            response = conn.getresponse()
            result = (response.status, response.read())
            conn.close()
            return result

        cases = [
            ('/api/health', 'GET', None, 'backend', '/api/health'),
            ('/api/images/42', 'DELETE', None, 'backend', '/api/images/42'),
            ('/api/images/upload', 'POST', 'multipart-fixture', 'backend', '/api/images/upload'),
            ('/agent-api/health', 'GET', None, 'agent', '/api/health'),
            ('/agent-api/sessions?limit=20&offset=2', 'GET', None, 'agent', '/api/sessions?limit=20&offset=2'),
            ('/agent-api/sessions?name=%E7%B1%B3%E9%A5%AD&extra=a%2Bb%26c', 'GET', None,
             'agent', '/api/sessions?name=%E7%B1%B3%E9%A5%AD&extra=a%2Bb%26c'),
            ('/agent-api/identify-food', 'POST', '{"image_id":12}', 'agent', '/api/identify-food'),
            ('/agent-api/sessions/1/regenerate', 'POST', '{}', 'agent', '/api/sessions/1/regenerate'),
        ]
        for path, method, body, service, expected in cases:
            status, data = request(path, method, body)
            payload = json.loads(data)
            assert status == 200 and payload == {
                'service': service, 'method': method, 'path': expected,
                'authorization': 'Bearer test-token', 'body': body or '',
            }, (path, status, payload)
        print('PASS API routes, methods, query parameters, Authorization and POST bodies', flush=True)
        for path in ('/api/auth/register', '/agent-api/identify-food'):
            assert request(path, 'POST', 'x' * 65536)[0] == 200
            assert request(path, 'POST', 'x' * 65537)[0] == 413
        assert request('/api/images/upload', 'POST', 'x' * 65537)[0] == 200
        print('PASS JSON size boundary and separate upload limit', flush=True)
        for path in ('/', '/chat', '/api/internal/users/1/profile', '/api/internal/auth/verify', '/api/metrics',
                     '/api/images/42', '/api/images/42/raw', '/api/unknown'):
            assert request(path) == (404, b'Not Found'), path
        status, data = request('/agent-api/missing')
        assert status == 404 and json.loads(data)['path'] == '/api/missing'
        print('PASS private routes blocked, no static site, upstream errors preserved', flush=True)
        conn = http.client.HTTPConnection('127.0.0.1', port, timeout=3)
        conn.request('GET', '/agent-api/chat?message=hello&session_id=1')
        response = conn.getresponse()
        assert response.status == 200
        assert response.readline() == b'event: chunk\n'
        assert response.readline() == b'data: hello\n'
        assert not finish_stream.is_set()
        finish_stream.set()
        assert b'event: done' in response.read()
        conn.close()
        print('PASS SSE first event arrives before upstream finishes', flush=True)
        process.terminate()
        process.wait(timeout=5)
        process = None
        log.close()
finally:
    finish_stream.set()
    if process is not None:
        process.terminate()
        process.wait(timeout=5)
    for server in servers:
        server.shutdown()
        server.server_close()
