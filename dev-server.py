#!/usr/bin/env python3
"""
仅托管 `web/` 静态文件；不经过 Vite，无法解析 `src/main.js`。
本地开发请使用: npm run dev
生产可先: npm run build，再托管 ../dist/
"""
import http.server
import socketserver
import os

PORT = 8080
DIRECTORY = "web"

class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIRECTORY, **kwargs)
    
    def end_headers(self):
        self.send_header('Cache-Control', 'no-cache')
        super().end_headers()

print(f"Open Block dev server running at http://0.0.0.0:{PORT}")
print("Press Ctrl+C to stop")
with socketserver.TCPServer(("", PORT), Handler) as httpd:
    httpd.serve_forever()
