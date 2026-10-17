"""Installer recovery and fully offline reuse, without network or model inference."""
import hashlib
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("setup_qwen", Path(__file__).with_name("setup_qwen.py"))
setup = importlib.util.module_from_spec(spec)
spec.loader.exec_module(setup)


class SetupTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.target = self.root / "models/qwen"
        self.target.mkdir(parents=True)
        self.patch = patch.object(setup, "ROOT", self.root)
        self.patch.start()
        self.download_patch = patch.object(setup, "download_weight", lambda *args: None)
        self.download_patch.start()
        (self.root / ".atc_qwen_runtime.json").write_text(json.dumps({
            "repo": "test/local-qwen", "model_dir": "models/qwen"}))
        self.files = {"config.json": b"{}", "tokenizer_config.json": b"{}",
                      "model.safetensors": b"model-weights",
                      "speech_tokenizer/config.json": b"{}",
                      "speech_tokenizer/model.safetensors": b"tokenizer-weights"}
        self.downloads = 0
        entries = [SimpleNamespace(rfilename=name, size=len(data), lfs=SimpleNamespace(sha256=hashlib.sha256(data).hexdigest()))
                   for name, data in self.files.items() if name.endswith(".safetensors")]
        api = SimpleNamespace(model_info=lambda *args, **kwargs: SimpleNamespace(sha="fixed-revision", siblings=entries))
        self.hub = SimpleNamespace(HfApi=lambda **kwargs: api, snapshot_download=self.fake_download)

    def fake_download(self, *args, **kwargs):
        self.downloads += 1
        for name, data in self.files.items():
            path = self.target / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(data)

    def tearDown(self):
        self.download_patch.stop()
        self.patch.stop()
        self.temp.cleanup()

    def test_install_then_offline_reuse_and_missing_file_repair(self):
        with patch.dict(sys.modules, {"huggingface_hub": self.hub}):
            setup.download()
            marker = self.target / "atc-model-complete.json"
            self.assertNotIn(marker.name, json.loads(marker.read_text())["files"])
            # A ready installation must not need even a metadata request on the next launch.
            self.hub.HfApi = lambda **kwargs: self.fail("Ready model attempted network access")
            setup.download()
            self.assertEqual(self.downloads, 1)
            self.hub.HfApi = lambda **kwargs: SimpleNamespace(model_info=lambda *a, **k: SimpleNamespace(sha="fixed-revision", siblings=[]))
            (self.target / "speech_tokenizer/model.safetensors").unlink()
            setup.download()
            self.assertEqual(self.downloads, 2)

    def test_interrupted_manifest_recovers(self):
        (self.target / "atc-model-complete.json").write_text('{"files":')
        with patch.dict(sys.modules, {"huggingface_hub": self.hub}):
            setup.download()
        self.assertEqual(self.downloads, 1)

    def test_corrupt_weights_are_rejected(self):
        actual_download = self.hub.snapshot_download
        def corrupt(*args, **kwargs):
            actual_download(*args, **kwargs)
            (self.target / "model.safetensors").write_bytes(b"corrupt")
        self.hub.snapshot_download = corrupt
        with patch.dict(sys.modules, {"huggingface_hub": self.hub}):
            with self.assertRaisesRegex(RuntimeError, "checksum"):
                setup.download()
        self.assertFalse((self.target / "model.safetensors").exists())
        self.assertFalse((self.target / "atc-model-complete.json").exists())


if __name__ == "__main__":
    unittest.main()
