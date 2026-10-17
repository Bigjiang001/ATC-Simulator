"""Resumable weight downloads, independent of Hugging Face Hub client version."""
import hashlib
import os
from pathlib import Path
import ssl
import time
from urllib.request import Request, urlopen


def file_sha256(path):
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(8 * 1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def download_weight(url, target, size, digest, partial):
    target, partial = Path(target), Path(partial)
    if target.exists() and target.stat().st_size == size and file_sha256(target) == digest:
        return
    partial.parent.mkdir(parents=True, exist_ok=True)
    target.parent.mkdir(parents=True, exist_ok=True)
    failure = None
    for attempt in range(3):
        offset = partial.stat().st_size if partial.exists() else 0
        if offset > size:
            partial.unlink()
            offset = 0
        try:
            if offset < size:
                headers = {"Range": f"bytes={offset}-"} if offset else {}
                context = ssl.create_default_context(cafile=os.environ.get("SSL_CERT_FILE"))
                with urlopen(Request(url, headers=headers), timeout=45, context=context) as response:
                    if offset and response.status == 206:
                        if not response.headers.get("Content-Range", "").startswith(f"bytes {offset}-"):
                            raise RuntimeError("Download server returned an incorrect byte range")
                    elif offset:
                        offset = 0  # Server ignored Range: safely restart instead of appending duplicate data.
                    mode = "ab" if offset else "wb"
                    last_progress = -1
                    with partial.open(mode) as output:
                        while True:
                            block = response.read(1024 * 1024)
                            if not block:
                                break
                            output.write(block)
                            offset += len(block)
                            progress = int(offset / size * 10)
                            if progress != last_progress:
                                print(f"[Qwen] {target.name}: {offset / 1048576:.0f}/{size / 1048576:.0f} MiB", flush=True)
                                last_progress = progress
            if partial.stat().st_size != size:
                raise RuntimeError("Incomplete weight download")
            if file_sha256(partial) != digest:
                partial.unlink()
                raise RuntimeError("Weight SHA-256 checksum failed")
            partial.replace(target)
            return
        except Exception as exc:
            failure = exc
            if attempt < 2:
                time.sleep(1)
    raise RuntimeError(f"Could not download {target.name}; rerun launcher to resume") from failure
