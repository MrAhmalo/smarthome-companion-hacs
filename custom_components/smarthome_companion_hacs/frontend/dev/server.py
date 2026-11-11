#!/usr/bin/env python3
"""
server.py: Zero-cache, auto-bundling local dev HTTP server for SmartHome Companion Workbench.
Usage:
  python server.py [PORT]  (default port: 5173)
"""
import sys
import os
import mimetypes
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

FRONTEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, FRONTEND_DIR)

try:
    from bundle_frontend import bundle as run_bundle, FILES_IN_ORDER, OUTPUT_FILE
except Exception as err:
    print(f"[DevServer] Warning: bundler could not be imported: {err}")
    run_bundle = None
    FILES_IN_ORDER = []
    OUTPUT_FILE = ""

mimetypes.add_type("application/javascript", ".js")
mimetypes.add_type("application/javascript", ".mjs")
mimetypes.add_type("text/html", ".html")
mimetypes.add_type("text/css", ".css")
mimetypes.add_type("application/json", ".json")

def check_and_bundle():
    """Auto-rebuilds dist bundle if any frontend source file changed."""
    if not run_bundle:
        return
    needs_bundle = False
    if not os.path.exists(OUTPUT_FILE):
        needs_bundle = True
    else:
        bundle_mtime = os.path.getmtime(OUTPUT_FILE)
        for rel in FILES_IN_ORDER:
            p = os.path.join(FRONTEND_DIR, rel)
            if os.path.exists(p) and os.path.getmtime(p) > bundle_mtime:
                needs_bundle = True
                break
    if needs_bundle:
        run_bundle()

class DevHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=FRONTEND_DIR, **kwargs)

    def end_headers(self):
        # Bulletproof zero-cache headers: forces browser to discard memory & disk caches
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0, post-check=0, pre-check=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        self.send_header("Surrogate-Control", "no-store")
        self.send_header("Clear-Site-Data", '"cache"')
        # CORS enabled for live Home Assistant or local tools
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "*")
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(204)
        self.end_headers()

    def do_GET(self):
        # Auto-rebuild bundle on any source file modification before serving
        check_and_bundle()

        # Strip caching headers from the client so SimpleHTTPRequestHandler NEVER sends 304 Not Modified!
        if "If-Modified-Since" in self.headers:
            del self.headers["If-Modified-Since"]
        if "If-None-Match" in self.headers:
            del self.headers["If-None-Match"]

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

def run(port=5173, host="0.0.0.0"):
    # Initial bundle check on startup
    check_and_bundle()
    server = ThreadingHTTPServer((host, port), DevHandler)
    print(f"\n=======================================================")
    print(f"  SmartHome Companion OS Local Dev Server (Zero-Cache)")
    print(f"  Workbench Local: http://localhost:{port}/dev/index.html")
    print(f"  Workbench LAN:   http://<Deine-PC-IP>:{port}/dev/index.html")
    print(f"  Serving:         {FRONTEND_DIR}")
    print(f"=======================================================\n")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping dev server...")
        server.server_close()

if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 5173
    run(port)


