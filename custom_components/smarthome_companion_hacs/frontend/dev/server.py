#!/usr/bin/env python3
"""
server.py: Zero-cache, CORS-enabled local dev HTTP server for SmartHome Companion Workbench.
Usage:
  python server.py [PORT]  (default port: 5173)
"""
import sys
import os
import mimetypes
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

FRONTEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

mimetypes.add_type("application/javascript", ".js")
mimetypes.add_type("application/javascript", ".mjs")
mimetypes.add_type("text/html", ".html")
mimetypes.add_type("text/css", ".css")
mimetypes.add_type("application/json", ".json")

class DevHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=FRONTEND_DIR, **kwargs)

    def end_headers(self):
        # Strict zero-cache for instant live development
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        # CORS enabled for live Home Assistant or local tools
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "*")
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(204)
        self.end_headers()

    def do_GET(self):
        # Redirect root to dev workbench
        if self.path in ("/", ""):
            self.send_response(302)
            self.send_header("Location", "/dev/index.html")
            self.end_headers()
            return
        return super().do_GET()

    def log_message(self, format, *args):
        # Quiet logging: only log errors
        if args and str(args[1]).startswith(("4", "5")):
            super().log_message(format, *args)

def run(port=5173):
    server = ThreadingHTTPServer(("127.0.0.1", port), DevHandler)
    print(f"\n=======================================================")
    print(f"  SmartHome Companion OS Local Dev Server")
    print(f"  Workbench: http://127.0.0.1:{port}/dev/index.html")
    print(f"  Raw Panel: http://127.0.0.1:{port}/companion-dashboard.js")
    print(f"  Serving:   {FRONTEND_DIR}")
    print(f"=======================================================\n")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping dev server...")
        server.server_close()

if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 5173
    run(port)
