"""Install a separate local TTS runtime and a complete, resumable model snapshot."""
import hashlib
import json
import os
from pathlib import Path
import platform
import shutil
import subprocess
import sys
from urllib.request import getproxies
from concurrent.futures import ThreadPoolExecutor

sys.path.insert(0, str(Path(__file__).resolve().parent))
from model_download import download_weight

ROOT = Path(__file__).resolve().parent.parent


def run(args, env=None):
    subprocess.run([str(a) for a in args], cwd=ROOT, env=env, check=True)


def download():
    from huggingface_hub import HfApi, snapshot_download
    config_path = ROOT / ".atc_qwen_runtime.json"
    config = json.loads(config_path.read_text())
    target = ROOT / config["model_dir"]
    marker = target / "atc-model-complete.json"
    if marker.exists():
        try:
            manifest = json.loads(marker.read_text())
            if manifest["repo"] == config["repo"] and manifest["files"] and all(
                (target / name).is_file() and (target / name).stat().st_size == size
                for name, size in manifest["files"].items()
            ):
                config["revision"] = manifest["revision"]
                config_path.write_text(json.dumps(config, indent=2))
                print("[Qwen] Complete local model found; no network download needed.", flush=True)
                return
        except (OSError, ValueError, KeyError):
            pass  # An interrupted manifest write must be recoverable on the next launch.
    repo = config["repo"]
    # One fixed revision across all files; includes the speech tokenizer and license.
    failure = None
    info = None
    endpoints = list(dict.fromkeys([os.environ.get("HF_ENDPOINT", "https://huggingface.co"),
                                    "https://hf-mirror.com"]))
    for endpoint in endpoints:
        try:
            info = HfApi(endpoint=endpoint).model_info(repo, timeout=30, files_metadata=True)
            print(f"[Qwen] Downloading {repo} ({info.sha}); interrupted downloads can resume.", flush=True)
            snapshot_download(repo, revision=info.sha, local_dir=str(target), max_workers=4,
                              endpoint=endpoint, ignore_patterns=[".gitattributes", "*.safetensors"])
            weights = [entry for entry in info.siblings if entry.rfilename.endswith(".safetensors") and entry.lfs]
            def fetch_weight(entry):
                download_weight(f"{endpoint}/{repo}/resolve/{info.sha}/{entry.rfilename}",
                                target / entry.rfilename, entry.size, entry.lfs.sha256,
                                target / ".cache/atc-download" / (entry.rfilename + ".partial"))
            with ThreadPoolExecutor(max_workers=2) as downloads:
                list(downloads.map(fetch_weight, weights))
            failure = None
            break
        except Exception as exc:
            failure = exc
            print(f"[Qwen] Download source failed: {endpoint}: {exc}", flush=True)
    if failure:
        raise RuntimeError("Qwen download incomplete; check network and rerun the launcher") from failure
    required = ["config.json", "tokenizer_config.json", "speech_tokenizer/config.json", "speech_tokenizer/model.safetensors"]
    if not all((target / name).is_file() for name in required) or not list(target.rglob("*.safetensors")):
        raise RuntimeError("Qwen snapshot incomplete; rerun the launcher")
    for entry in info.siblings:
        if entry.rfilename.endswith(".safetensors") and entry.lfs:
            print(f"[Qwen] Verifying SHA-256: {entry.rfilename}", flush=True)
            digest = hashlib.sha256()
            with (target / entry.rfilename).open("rb") as model_file:
                for block in iter(lambda: model_file.read(8 * 1024 * 1024), b""):
                    digest.update(block)
            if digest.hexdigest() != entry.lfs.sha256:
                (target / entry.rfilename).unlink()
                raise RuntimeError("Model checksum failed; rerun the launcher to resume downloading")
    manifest = {"revision": info.sha, "repo": repo,
                "files": {p.relative_to(target).as_posix(): p.stat().st_size
                          for p in target.rglob("*") if p.is_file() and ".cache" not in p.parts and p != marker}}
    marker.write_text(json.dumps(manifest, indent=2))
    config["revision"] = info.sha
    config_path.write_text(json.dumps(config, indent=2))


def main():
    if "--download" in sys.argv:
        download()
        return
    mlx = sys.platform == "darwin" and platform.machine() == "arm64"
    runtime = "mlx" if mlx else "torch"
    env_dir = ROOT / (".venv_atc_qwen_windows" if os.name == "nt" else ".venv_atc_qwen")
    python = env_dir / ("Scripts/python.exe" if os.name == "nt" else "bin/python3")
    requirements = ROOT / f"requirements-qwen-{runtime}.txt"
    env = os.environ.copy()
    env.pop("PYTHONHOME", None)
    env.pop("PYTHONPATH", None)
    # Honor the operating system's configured proxy, including macOS System Settings.
    for protocol, proxy in getproxies().items():
        if protocol in ("http", "https"):
            env.setdefault(protocol.upper() + "_PROXY", proxy)
    env.setdefault("NO_PROXY", "localhost,127.0.0.1")
    env.setdefault("HF_HUB_DISABLE_XET", "1")
    # python.org macOS installations can lack a configured certificate bundle.
    try:
        import certifi
        env.setdefault("SSL_CERT_FILE", certifi.where())
        env.setdefault("PIP_CERT", certifi.where())
    except ImportError:
        pass
    if not python.exists():
        base = shutil.which("python3.12") if os.name != "nt" else None
        run([base or sys.executable, "-m", "venv", env_dir], env)
    run([python, "-c", "import sys; assert sys.prefix != sys.base_prefix"], env)
    signature = hashlib.sha256(requirements.read_bytes()).hexdigest()
    marker = env_dir / "atc-requirements.sha256"
    modules = ["mlx_audio", "einops"] if mlx else ["qwen_tts", "torch"]
    modules += ["audiotsm", "soundfile", "huggingface_hub"]
    probe = subprocess.run([str(python), "-c", "import importlib.util as u; "
                            f"assert all(u.find_spec(m) is not None for m in {modules!r})"],
                           cwd=ROOT, env=env, capture_output=True)
    if probe.returncode or not marker.exists() or marker.read_text() != signature:
        command = [python, "-m", "pip", "install", "--disable-pip-version-check", "-r", requirements]
        try:
            run(command + ["--index-url", "https://pypi.org/simple"], env)
        except subprocess.CalledProcessError:
            run(command + ["--index-url", "https://pypi.tuna.tsinghua.edu.cn/simple"], env)
        run([python, "-m", "pip", "check"], env)
        marker.write_text(signature)
    config_path = ROOT / ".atc_qwen_runtime.json"
    config = {
        "runtime": runtime, "python": python.relative_to(ROOT).as_posix(),
        "repo": "mlx-community/Qwen3-TTS-12Hz-0.6B-CustomVoice-8bit" if mlx else "Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice",
        "model_dir": f"models/Qwen3-TTS-0.6B-CustomVoice-{runtime}",
    }
    config_path.write_text(json.dumps(config, indent=2))
    run([python, "-u", __file__, "--download"], env)


if __name__ == "__main__":
    main()
