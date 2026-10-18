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


def stop_old_project_server():
    """Only stop the listener when its command names this exact project's backend."""
    if os.name != "nt":
        return False
    env = os.environ.copy()
    env["ATC_EXPECTED_SERVER"] = str(ROOT / "atc_ai_server.py")
    script = r"""
$ErrorActionPreference = 'Stop'
$listener = Get-NetTCPConnection -LocalPort 18765 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $listener) { exit 0 }
$serverProcess = Get-CimInstance Win32_Process -Filter ('ProcessId=' + $listener.OwningProcess)
$expected = $env:ATC_EXPECTED_SERVER
$command = $serverProcess.CommandLine
if (-not $command) { exit 0 }
$pattern = '(?i)(?:^|[\s"])' + [regex]::Escape($expected) + '(?:[\s"]|$)'
if ($command -notmatch $pattern -or $serverProcess.Name -notmatch '^python(?:w|[0-9.]*)?\.exe$') { exit 0 }
& taskkill.exe /PID $listener.OwningProcess /T /F | Out-Null
if ($LASTEXITCODE -ne 0) { exit 1 }
Write-Output 'ATC_SERVER_STOPPED'
"""
    result = subprocess.run(["powershell.exe", "-NoProfile", "-NonInteractive", "-Command", script],
                            env=env, capture_output=True, text=True)
    if result.returncode:
        raise RuntimeError("Could not stop the old ATC server: " + result.stderr.strip())
    return "ATC_SERVER_STOPPED" in result.stdout


def main():
    expected = hashlib.sha256((ROOT / "atc_command_simulator.html").read_bytes()).hexdigest()
    url = "http://127.0.0.1:18765/game?atc=2.0&v=" + expected[:16]
    local_http = build_opener(ProxyHandler({}))

    import torch
    expect_cuda = torch.cuda.is_available()

    def ready():
        try:
            with local_http.open("http://127.0.0.1:18765/api/health", timeout=2) as response:
                health = json.load(response)
            if health.get("voice_backend_version") != "atc2-offline-qwen-v2":
                return False
            if not all(health.get(key) for key in ("qwen_ready", "sensevoice_ready", "kokoro_ready")):
                return False
            if expect_cuda and ("NVIDIA CUDA" not in health.get("device", "") or not health.get("qwen_device", "").startswith("cuda")):
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
        if not stop_old_project_server():
            raise RuntimeError("Port 18765 is occupied by another service. Close the application using it and retry.")
        print("[INFO] Restarting this project's old server with the current GPU runtime...", flush=True)
        deadline = time.monotonic() + 15
        while time.monotonic() < deadline:
            with socket.socket() as probe:
                if probe.connect_ex(("127.0.0.1", 18765)) != 0:
                    break
            time.sleep(0.25)
        else:
            raise RuntimeError("The old ATC server has not released port 18765; close its launcher and retry.")
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
    try:
        main()
    except Exception as exc:
        print(f"[ERROR] {exc}", flush=True)
        raise SystemExit(1)
