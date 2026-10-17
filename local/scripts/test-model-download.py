import hashlib
import io
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from model_download import download_weight


class DownloadTests(unittest.TestCase):
    def test_partial_file_resumes_without_redownloading_the_prefix(self):
        data = b"mandarin-model" * 1000
        with tempfile.TemporaryDirectory() as folder:
            target = Path(folder) / "model.safetensors"
            partial = Path(folder) / "model.partial"
            partial.write_bytes(data[:1024])
            response = io.BytesIO(data[1024:])
            response.status = 206
            response.headers = {"Content-Range": f"bytes 1024-{len(data)-1}/{len(data)}"}
            with patch("model_download.urlopen", return_value=response) as request:
                download_weight("https://example.test/model", target, len(data), hashlib.sha256(data).hexdigest(), partial)
            self.assertEqual(request.call_args.args[0].get_header("Range"), "bytes=1024-")
            self.assertEqual(target.read_bytes(), data)
            self.assertFalse(partial.exists())
            with patch("model_download.urlopen", side_effect=AssertionError("Unexpected network access")):
                download_weight("https://example.test/model", target, len(data), hashlib.sha256(data).hexdigest(), partial)


if __name__ == "__main__":
    unittest.main()
