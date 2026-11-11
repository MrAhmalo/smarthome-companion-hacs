#!/usr/bin/env python3
"""
capture.py: Instant Headless Screenshot Runner for SmartHome Companion Workbench.
Spins up an ephemeral HTTP server (or reuses active dev server), loads the requested scene,
and captures a pixel-perfect snapshot using headless Edge in < 2 seconds.
"""
import sys
import os
import subprocess
import time
import socket
import threading
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

EDGE_PATH = r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
ARTIFACTS_DIR = r"C:\Users\Julian\.gemini\antigravity\brain\84354bb4-c129-4ff3-b37d-4039eccf412b"
DEV_DIR = os.path.dirname(os.path.abspath(__file__))
FRONTEND_DIR = os.path.dirname(DEV_DIR)
INDEX_HTML = os.path.join(DEV_DIR, "index.html")

def is_port_in_use(port):
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        return s.connect_ex(("127.0.0.1", port)) == 0

def get_free_port():
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]

class QuietHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=FRONTEND_DIR, **kwargs)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Access-Control-Allow-Origin", "*")
        super().end_headers()

    def log_message(self, format, *args):
        pass

def capture(scene="dashboard", out_name=None, width=1280, height=800):
    if not out_name:
        out_name = f"preview_{scene}_{width}x{height}.png"
    out_path = os.path.join(ARTIFACTS_DIR, out_name)

    # Server setup: reuse 5173 if running, else spin up ephemeral server
    ephemeral_server = None
    if is_port_in_use(5173):
        port = 5173
    else:
        port = get_free_port()
        ephemeral_server = ThreadingHTTPServer(("127.0.0.1", port), QuietHandler)
        server_thread = threading.Thread(target=ephemeral_server.serve_forever, daemon=True)
        server_thread.start()

    runner_path = os.path.join(DEV_DIR, f"_runner_{scene}.html")
    with open(INDEX_HTML, "r", encoding="utf-8") as f:
        content = f.read()

    action_code = ""
    if scene == "room_julian":
        action_code = "window.panel._openRoom('julian');"
    elif scene == "wizard":
        action_code = "window.panel._openWizard();"
    elif scene == "settings":
        action_code = "window.panel._openSettings();"
    elif scene == "warning":
        action_code = "window.panel._openWarningDetail();"
    elif scene == "all_on":
        action_code = "window.mockHass.applyScenario('all_on');"
    elif scene == "test_toggle":
        action_code = """
        const room = window.panel._components.find(c => c.spec?.area_id === 'julian');
        if (room) {
          const master = room.tiles.find(t => t.spec?.name === 'Deckenlampen Master');
          if (master) master._toggleMaster();
        }
        """
    elif scene == "master_off":
        action_code = """
        window.mockHass.states['light.schreibtisch_lampe'].state = 'off';
        window.mockHass.states['light.lavalampe'].state = 'off';
        window.panel._reload();
        """
    elif scene == "edit_mode":
        action_code = "window.panel._toggleEditMode();"
    elif scene == "group_modal":
        action_code = """
        window.panel._openWizard();
        setTimeout(() => {
          const wiz = window.panel._wizard;
          if (wiz) {
            wiz.selectedDevices.add('dev_shelly2pm');
            wiz.selectedDevices.add('dev_wasserpumpe');
            wiz._openGroupModal();
            setTimeout(() => {
              const cdd = wiz.el.querySelector('.custom-dropdown .cdd-box');
              if (cdd) cdd.click();
            }, 200);
          }
        }, 400);
        """

    # Inject ready checker as an ES module at the bottom
    injection = f"""
    <script type="module">
      const checkReady = () => {{
        if (window.panel && window.panel._data) {{
          {action_code}
        }} else {{
          setTimeout(checkReady, 50);
        }}
      }};
      setTimeout(checkReady, 100);
    </script>
    """

    injected = content.replace("</body>", f"{injection}</body>")
    with open(runner_path, "w", encoding="utf-8") as f:
        f.write(injected)

    url = f"http://127.0.0.1:{port}/dev/{os.path.basename(runner_path)}"

    cmd = [
        EDGE_PATH,
        "--headless",
        "--disable-gpu",
        "--hide-scrollbars",
        f"--window-size={width},{height}",
        "--virtual-time-budget=2500",
        f"--screenshot={out_path}",
        url
    ]

    try:
        res = subprocess.run(cmd, capture_output=True, text=True, timeout=12)
        if os.path.exists(out_path):
            size = os.path.getsize(out_path)
            print(f"SUCCESS: Captured '{scene}' ({width}x{height}) -> {out_path} ({size} bytes)")
            return out_path
        else:
            print(f"FAILED: Screenshot not generated. Output: {res.stderr or res.stdout}")
            return None
    finally:
        if ephemeral_server:
            ephemeral_server.shutdown()
            ephemeral_server.server_close()
        if os.path.exists(runner_path):
            try:
                os.remove(runner_path)
            except OSError:
                pass

if __name__ == "__main__":
    scene = sys.argv[1] if len(sys.argv) > 1 else "dashboard"
    width = int(sys.argv[2]) if len(sys.argv) > 2 else 1280
    height = int(sys.argv[3]) if len(sys.argv) > 3 else 800
    capture(scene, None, width, height)
