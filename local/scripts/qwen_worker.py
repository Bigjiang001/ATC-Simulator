"""Resident, offline-only Qwen3-TTS worker; JSON lines on stdin/stdout.

Runs in its own virtual environment so Qwen's transformers cannot affect ASR.
"""
import contextlib
import io
import json
import os
from pathlib import Path
import sys
import time
import base64

os.environ.update(HF_HUB_OFFLINE="1", TRANSFORMERS_OFFLINE="1", HF_HUB_DISABLE_TELEMETRY="1")
ROOT = Path(__file__).resolve().parent.parent
SPEAKERS = {"Serena", "Vivian", "Uncle_Fu", "Dylan", "Eric", "Ryan", "Aiden", "Ono_Anna", "Sohee"}
from qwen_audio import apply_speech_tempo, AUDIO_PIPELINE_VERSION


def emit(value):
    sys.__stdout__.write(json.dumps(value, ensure_ascii=True) + "\n")
    sys.__stdout__.flush()


def main():
    with contextlib.redirect_stdout(sys.stderr):
        import numpy as np
        import soundfile as sf
        config = json.loads((ROOT / ".atc_qwen_runtime.json").read_text())
        model_path = ROOT / config["model_dir"]
        if config["runtime"] == "mlx":
            from mlx_audio.tts.utils import load_model
            model = load_model(str(model_path))
            device = "Apple Silicon / MLX 8-bit"
            cpu_threads = None
        else:
            import torch
            from qwen_tts import Qwen3TTSModel
            device = "cuda:0" if torch.cuda.is_available() else "cpu"
            cpu_threads = torch.get_num_threads()
            print(f"[Qwen] device={device}; CPU dispatch threads={cpu_threads}; attention=sdpa", file=sys.stderr, flush=True)
            model = Qwen3TTSModel.from_pretrained(
                str(model_path), device_map=device,
                dtype=(torch.bfloat16 if torch.cuda.is_bf16_supported() else torch.float16) if device.startswith("cuda") else torch.float32,
                attn_implementation="sdpa", local_files_only=True,
            )

        def synthesize(text, speaker, speed, language="Chinese"):
            if speaker not in SPEAKERS:
                raise ValueError("Unknown Qwen speaker")
            if language not in {"Chinese", "English"}:
                raise ValueError("Unsupported synthesis language")
            if not text.strip() or len(text) > 500:
                raise ValueError("TTS text must contain 1-500 characters")
            if not 0.9 <= speed <= 1.5:
                raise ValueError("TTS speed must be 0.9-1.5")
            generation_started = time.perf_counter()
            if config["runtime"] == "mlx":
                chunks = list(model.generate(text=text, voice=speaker, lang_code=language,
                                             stream=False, max_tokens=1024))
                samples = np.concatenate([np.asarray(c.audio).reshape(-1) for c in chunks])
                sr = chunks[0].sample_rate
            else:
                with torch.inference_mode():
                    wavs, sr = model.generate_custom_voice(text=text, language=language,
                                                           speaker=speaker, max_new_tokens=1024)
                samples = np.asarray(wavs[0]).reshape(-1)
            generation_ms = round((time.perf_counter() - generation_started) * 1000)
            tempo_started = time.perf_counter()
            samples = apply_speech_tempo(samples, sr, speed)
            tempo_ms = round((time.perf_counter() - tempo_started) * 1000)
            if len(samples) < 100 or not np.isfinite(samples).all() or np.max(np.abs(samples)) < 0.0001:
                raise RuntimeError("Qwen returned invalid or silent audio")
            output = io.BytesIO()
            sf.write(output, samples, sr, format="WAV", subtype="PCM_16")
            return output.getvalue(), {"generation_ms": generation_ms, "tempo_ms": tempo_ms, "audio_ms": round(len(samples) * 1000 / sr)}

        print("[Qwen] Warming up Mandarin voice...", file=sys.stderr, flush=True)
        synthesize("收到，东方航空五两幺三。", "Serena", 1.2)
    emit({"ready": True, "engine": "qwen3-tts-0.6b", "device": device,
          "revision": config["revision"], "speakers": sorted(SPEAKERS), "audio_pipeline": AUDIO_PIPELINE_VERSION,
          "runtime_diagnostics": "timings-v1", "cpu_threads": cpu_threads})
    for line in sys.stdin:
        try:
            request = json.loads(line)
            started = time.perf_counter()
            with contextlib.redirect_stdout(sys.stderr):
                wav, timings = synthesize(request["text"], request["speaker"], float(request["speed"]), request.get("language", "Chinese"))
            emit({"audio": base64.b64encode(wav).decode("ascii"),
                  "latency_ms": round((time.perf_counter() - started) * 1000), "timings": timings})
        except Exception as exc:
            emit({"error": str(exc)})


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        emit({"error": str(exc)})
        raise
