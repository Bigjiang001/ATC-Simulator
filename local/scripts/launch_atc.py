"""Both launchers open the current game only after all three local models are ready."""
import hashlib
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import time
from urllib.request import Request, ProxyHandler, build_opener
import webbrowser

ROOT = Path(__file__).resolve().parent.parent


def main():
    expected = hashlib.sha256((ROOT / "atc_command_simulator.html").read_bytes()).hexdigest()
    url = "http://127.0.0.1:18765/game?atc=2.0&v=" + expected[:16]
    local_http = build_opener(ProxyHandler({}))

    def ready():
        try:
            with local_http.open("http://127.0.0.1:18765/api/health", timeout=2) as response:
                health = json.load(response)
            if health.get("voice_backend_version") != "atc2-offline-qwen-v2":
                return False
            if not all(health.get(key) for key in ("qwen_ready", "sensevoice_ready", "kokoro_ready")):
                return False
            with local_http.open(Request(url, headers={"Cache-Control": "no-cache"}), timeout=2) as response:
                return hashlib.sha256(response.read()).hexdigest() == expected
        except (OSError, ValueError):
            return False

    def open_game():
        print("[READY] ATC2.0: " + url, flush=True)
        if "--no-browser" in sys.argv:
            return
        if sys.platform == "darwin":
            subprocess.run(["/usr/bin/open", url], check=True)
        elif os.name == "nt":
            os.startfile(url)
        else:
            webbrowser.open(url)

    with socket.socket() as probe:
        occupied = probe.connect_ex(("127.0.0.1", 18765)) == 0
    if occupied:
        if ready():
            open_game()
            return
        raise RuntimeError("Port 18765 is occupied by an old/unready service. Close its launcher and retry.")
    server = subprocess.Popen([sys.executable, "-u", str(ROOT / "atc_ai_server.py"), "--no-browser"], cwd=ROOT)
    try:
        deadline = time.monotonic() + 900
        while server.poll() is None:
            if ready():
                open_game()
                sys.exit(server.wait())
            if time.monotonic() > deadline:
                raise RuntimeError("Model startup timed out; see .atc_logs/qwen-worker.log")
            time.sleep(0.5)
        raise RuntimeError(f"AI server exited ({server.returncode}); see model logs above")
    except KeyboardInterrupt:
        pass
    finally:
        if server.poll() is None:
            server.terminate()
            try:
                server.wait(timeout=20)
            except subprocess.TimeoutExpired:
                server.kill()
                server.wait()


if __name__ == "__main__":
    main()
