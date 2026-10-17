"""Isolated local Qwen worker bridge. Failures never select another voice."""
import atexit
import base64
import json
import os
from pathlib import Path
import queue
import subprocess
import threading

ROOT = Path(__file__).resolve().parent.parent


class QwenBridge:
    def __init__(self):
        self.process = None
        self.ready = False
        self.info = {}
        self.responses = queue.Queue()
        self.lock = threading.Lock()
        self.log = None

    def start(self):
        config = json.loads((ROOT / ".atc_qwen_runtime.json").read_text())
        python = ROOT / config["python"]
        (ROOT / ".atc_logs").mkdir(exist_ok=True)
        self.log = (ROOT / ".atc_logs" / "qwen-worker.log").open("a", encoding="utf-8")
        env = os.environ.copy()
        env.pop("PYTHONHOME", None)
        env.pop("PYTHONPATH", None)
        env.update(PYTHONUTF8="1", PYTHONIOENCODING="utf-8")
        self.process = subprocess.Popen([str(python), "-u", str(ROOT / "scripts/qwen_worker.py")],
                                        cwd=ROOT, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                        stderr=self.log, text=True, encoding="utf-8", env=env)
        atexit.register(self.close)
        threading.Thread(target=self._read, daemon=True).start()
        try:
            self.info = self.responses.get(timeout=600)
            if not self.info.get("ready"):
                raise RuntimeError(self.info.get("error", "Worker did not become ready"))
            self.ready = True
        except Exception:
            self.close()
            raise

    def _read(self):
        try:
            for line in self.process.stdout:
                self.responses.put(json.loads(line))
        finally:
            self.responses.put({"error": "Qwen worker exited; see .atc_logs/qwen-worker.log"})

    def synthesize(self, text, speaker, speed, language="Chinese"):
        with self.lock:
            if not self.ready or self.process.poll() is not None:
                self.ready = False
                raise RuntimeError("Local Qwen is unavailable; restart the launcher")
            self.process.stdin.write(json.dumps(dict(text=text, speaker=speaker, speed=speed, language=language)) + "\n")
            self.process.stdin.flush()
            try:
                response = self.responses.get(timeout=120)
            except queue.Empty:
                self.close()
                raise RuntimeError("Qwen synthesis timed out; no substitute voice was used")
            if "error" in response:
                raise RuntimeError(response["error"])
            return base64.b64decode(response["audio"], validate=True)

    def close(self):
        self.ready = False
        if self.process and self.process.poll() is None:
            self.process.terminate()
            try:
                self.process.wait(timeout=8)
            except subprocess.TimeoutExpired:
                self.process.kill()
                self.process.wait()
        if self.log and not self.log.closed:
            self.log.close()
