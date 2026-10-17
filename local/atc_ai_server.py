#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""ATC2.0: offline SenseVoice ASR, Qwen3-TTS-0.6B Mandarin and Kokoro English."""

import argparse
import asyncio
import hashlib
import io
import json
import os
import re
import sys
import time
import webbrowser
from collections import OrderedDict
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import numpy as np
import soundfile as sf
from fastapi import FastAPI, File, Form, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, Response
from pydantic import BaseModel, Field
from fastapi import HTTPException, Request
from scripts.qwen_bridge import QwenBridge

ROOT_DIR = Path(__file__).resolve().parent
MODELS_DIR = ROOT_DIR / "models"
SENSEVOICE_DIR = MODELS_DIR / "iic" / "SenseVoiceSmall"
KOKORO_DIR = MODELS_DIR / "Kokoro-82M"
ZH_CACHE_DIR = MODELS_DIR / "qwen3_tts_cache_v1"
GAME_HTML_PATH = ROOT_DIR / "atc_command_simulator.html"

ICAO_NATO_MAP = {
    "A": "Alpha", "B": "Bravo", "C": "Charlie", "D": "Delta", "E": "Echo",
    "F": "Foxtrot", "G": "Golf", "H": "Hotel", "I": "India", "J": "Juliett",
    "K": "Kilo", "L": "Lima", "M": "Mike", "N": "November", "O": "Oscar",
    "P": "Papa", "Q": "Quebec", "R": "Romeo", "S": "Sierra", "T": "Tango",
    "U": "Uniform", "V": "Victor", "W": "Whiskey", "X": "X-ray", "Y": "Yankee",
    "Z": "Zulu",
}

ICAO_DIGIT_EN = {
    "0": "zero", "1": "one", "2": "two", "3": "three", "4": "four",
    "5": "five", "6": "six", "7": "seven", "8": "eight", "9": "niner",
}

CN_AIRLINE_MAP = {
    "CES": "东方航空",
    "CCA": "中国国航",
    "CSN": "南方航空",
    "CHH": "海南航空",
    "CPA": "国泰航空",
    "CXA": "厦门航空",
    "CSC": "四川航空",
    "CKK": "中货航",
    "ANA": "全日空",
    "JAL": "日本航空",
    "SKY": "天马航空",
    "ADO": "北海道航空",
    "BAW": "英国航空",
    "VIR": "维珍航空",
    "EZY": "易捷航空",
    "DLH": "汉莎航空",
    "AFR": "法国航空",
    "SIA": "新加坡航空",
}

# All fixed Qwen speakers; output language is controlled independently.
QWEN_SPEAKERS = {"Serena", "Vivian", "Uncle_Fu", "Dylan", "Eric", "Ryan", "Aiden", "Ono_Anna", "Sohee"}
STANDARD_PUTONGHUA_VOICES = QWEN_SPEAKERS


def resolve_clean_zh_voice(requested_voice: str, role: str = "PILOT") -> str:
    v = (requested_voice or "").strip()
    if v in STANDARD_PUTONGHUA_VOICES:
        return v
    # Migrate saved legacy presets once, before synthesis; never a runtime fallback.
    legacy = {"zh-CN-YunxiNeural": "Uncle_Fu", "zh-CN-YunjianNeural": "Uncle_Fu",
              "zh-CN-XiaoxiaoNeural": "Serena", "zh-CN-XiaoyiNeural": "Vivian",
              "zm_yunxi": "Uncle_Fu", "zf_xiaoxiao": "Serena"}
    if v in legacy:
        return legacy[v]
    if not v or v == "AUTO" or re.match(r"^(af_|bf_|am_|bm_)", v):
        return "Serena" if v.startswith(("af_", "bf_")) else "Uncle_Fu"
    raise ValueError("Unsupported Qwen speaker")


def resolve_clean_en_voice(requested_voice: str, role: str = "PILOT") -> str:
    """确保英文模式 100% 使用 Kokoro-82M 原生英文声源"""
    v = (requested_voice or "").strip()
    if re.match(r"^(am_|af_|bm_|bf_)", v):
        return v
    is_female = any(k in v.lower() for k in ("serena", "vivian", "xiaoxiao", "xiaoyi", "female", "af_", "bf_"))
    if role.upper() == "ATC":
        return "af_heart" if is_female else "am_adam"
    return "af_bella" if is_female else "am_michael"


def format_kokoro_aviation_phonetics(text: str, lang: str = "en-us") -> str:
    """
    航空发音预处理器：
    - 中文模式：将 CES5213 转为 '东方航空 五两幺三'，将 09L 转为 '洞九左'，清除夹杂的英文缩写；
    - 英文模式：将 B9001 转为 'Bravo niner zero zero one'，将 270 转为 'two seven zero'。
    """
    if not text:
        return ""
    s = re.sub(r"[🚨⚠✓★🎯🎙️⛔⚡🔥]", "", text).strip()
    if lang.lower().startswith("cmn") or lang.lower().startswith("zh"):
        cn_map = {
            "0": "洞", "1": "幺", "2": "两", "3": "三", "4": "四",
            "5": "五", "6": "六", "7": "拐", "8": "八", "9": "九",
        }
        # 移除括号内英文附注
        s = re.sub(r"\([A-Z0-9\s/-]+\)", "", s)
        s = re.sub(r"ILS\s*盲降", "盲降", s, flags=re.I)
        for abbreviation, phrase in (("ILS", "盲降"), ("RWY", "跑道"), ("IDENT", "识别")):
            s = re.sub(rf"(?<![A-Za-z]){abbreviation}(?![A-Za-z])", phrase, s, flags=re.I)
        # 航司三字码转中文名
        s = re.sub(
            r"(?<![A-Za-z0-9])([A-Z]{3})\s*([0-9]{2,4})(?![A-Za-z0-9])",
            lambda m: (
                f"{CN_AIRLINE_MAP[m.group(1).upper()]} " + "".join(cn_map.get(c, c) for c in m.group(2))
                if m.group(1).upper() in CN_AIRLINE_MAP
                else m.group(0)
            ),
            s,
        )
        # 跑道号转中文读法
        s = re.sub(
            r"(?<![A-Za-z0-9])(09|27|34|16|35|17|22|04)([LR])?(?![A-Za-z0-9])",
            lambda m: "".join(cn_map.get(c, c) for c in m.group(1))
            + ("左" if m.group(2) == "L" else "右" if m.group(2) == "R" else ""),
            s,
        )
        # 频率转中文读法
        s = re.sub(
            r"(?<![A-Za-z0-9])(1[12][0-9])\.([0-9]{1,2})(?![A-Za-z0-9])",
            lambda m: "".join(cn_map.get(c, c) for c in m.group(1))
            + "点"
            + "".join(cn_map.get(c, c) for c in m.group(2)),
            s,
        )
        # 航向与呼号数字转洞幺两三四五六拐八九
        s = re.sub(
            r"(航向\s*)([0-9]{3})",
            lambda m: m.group(1) + "".join(cn_map.get(c, c) for c in m.group(2)),
            s,
        )
        s = re.sub(
            r"(航空|国航|南航|东航|海航|厦航|川航|货航|全日空|天马|北海道|维珍|易捷|汉莎|应答机|编码)\s*([0-9]{3,4})",
            lambda m: f"{m.group(1)} " + "".join(cn_map.get(c, c) for c in m.group(2)),
            s,
        )
        return re.sub(r"\s+", " ", s).strip()

    for abbreviation, phrase in (("RWY", "runway"), ("HDG", "heading"), ("ALT", "altitude"),
                                 ("SPD", "speed"), ("KT", "knots"), ("FT", "feet"), ("ILS", "I L S")):
        s = re.sub(rf"\b{abbreviation}\b", phrase, s, flags=re.I)

    def to_en_digits(num_str: str) -> str:
        return " ".join(ICAO_DIGIT_EN.get(d, d) for d in num_str)

    s = re.sub(
        r"\b([A-Z])-?([0-9]{3,4})\b",
        lambda m: f"{ICAO_NATO_MAP.get(m.group(1).upper(), m.group(1))} {to_en_digits(m.group(2))}",
        s,
    )

    def repl_rwy(m: re.Match) -> str:
        prefix = "runway " if m.group(1) else ""
        digits = to_en_digits(m.group(2))
        side = " left" if (m.group(3) or "").upper() == "L" else " right" if (m.group(3) or "").upper() == "R" else ""
        return f"{prefix}{digits}{side}"

    s = re.sub(r"\b(runway\s+|RWY\s+)?(09|27|34|16|35|17|22|04)([LR])?\b", repl_rwy, s, flags=re.I)
    s = re.sub(
        r"\b(1[12][0-9])\.([0-9]{1,2})\b",
        lambda m: f"{to_en_digits(m.group(1))} decimal {to_en_digits(m.group(2))}",
        s,
    )

    def repl_alt_thousand(m: re.Match) -> str:
        th = ICAO_DIGIT_EN.get(m.group(1), m.group(1))
        hu = m.group(2)
        unit = m.group(3).lower()
        if hu == "0":
            return f"{th} thousand {unit}"
        return f"{th} thousand {ICAO_DIGIT_EN.get(hu, hu)} hundred {unit}"

    s = re.sub(r"\b([1-9])([0-9])00\s+(feet|meters)\b", repl_alt_thousand, s, flags=re.I)
    s = re.sub(
        r"\b([1-9])00\s+(feet|meters)\b",
        lambda m: f"{ICAO_DIGIT_EN.get(m.group(1), m.group(1))} hundred {m.group(2).lower()}",
        s,
        flags=re.I,
    )
    s = re.sub(r"\b([0-9]{2,4})\b", lambda m: to_en_digits(m.group(1)), s)
    return re.sub(r"\s+", " ", s).strip()


def verify_sensevoice_with_airspace_context(
    raw_text: str,
    itn_text: str,
    callsigns: List[str],
    waypoints: List[str],
    runways: List[str],
) -> str:
    candidate = itn_text.strip() if itn_text.strip() else raw_text.strip()
    upper = candidate.upper()
    upper = re.sub(r"\b([0-9]{1,2}):([0-9]{2})\b", r"\1\2", upper)

    for wp in waypoints:
        wp_up = wp.upper()
        if len(wp_up) >= 4 and wp_up not in upper:
            prefix = wp_up[:3]
            upper = re.sub(rf"\b{prefix}[A-Z]{{1,3}}\b", wp_up, upper)

    for rwy in runways:
        rwy_up = rwy.upper()
        if rwy_up.startswith("0"):
            short_rwy = rwy_up[1:]
            upper = re.sub(rf"\bRWY\s*{short_rwy}\b", f"RWY {rwy_up}", upper)

    return upper


class ResidentAiEngine:
    """管理常驻内存的 SenseVoice Small + Qwen3-TTS-0.6B 普通话 + Kokoro-82M 模型及缓存"""

    def __init__(self) -> None:
        self.sensevoice_model = None
        self.sensevoice_model_dir: Optional[str] = None
        self.kokoro_model = None
        self.sensevoice_ready = False
        self.kokoro_ready = False
        self.device = "CPU (ONNX / PyTorch Resident)"
        self.audio_cache: "OrderedDict[str, bytes]" = OrderedDict()
        self.max_cache_size = 256
        self.last_latency_ms = 0
        self.qwen = QwenBridge()
        self.tts_lock = asyncio.Lock()

    def _find_local_sensevoice_dir(self) -> Optional[Path]:
        """在 models/ 目录下递归查找已下载的 SenseVoiceSmall 模型目录"""
        candidates = [
            MODELS_DIR / "iic" / "SenseVoiceSmall",
            MODELS_DIR / "SenseVoiceSmall",
        ]
        for c in candidates:
            if (c / "model.pt").exists() or (c / "configuration.json").exists():
                return c
        if MODELS_DIR.exists():
            for p in MODELS_DIR.rglob("model.pt"):
                if "SenseVoice" in str(p.parent):
                    return p.parent
        return None

    def ensure_models_downloaded(self) -> None:
        MODELS_DIR.mkdir(parents=True, exist_ok=True)
        KOKORO_DIR.mkdir(parents=True, exist_ok=True)
        ZH_CACHE_DIR.mkdir(parents=True, exist_ok=True)

        print("=================================================================")
        print(" [1/2] 检查并部署 SenseVoice Small 语音识别模型 (iic/SenseVoiceSmall)...")
        print("=================================================================")
        existing_sv = self._find_local_sensevoice_dir()
        if existing_sv:
            self.sensevoice_model_dir = str(existing_sv)
            print(f" ✓ SenseVoice Small 本地模型已存在: {existing_sv}")
        else:
            try:
                from modelscope import snapshot_download
                model_path = snapshot_download(
                    "iic/SenseVoiceSmall",
                    cache_dir=str(MODELS_DIR),
                )
                self.sensevoice_model_dir = str(model_path)
                print(f" ✓ SenseVoice Small 下载完成: {model_path}")
            except Exception as e:
                print(f" ! ModelScope 下载提示 ({e})，将尝试由 FunASR 自动拉取。")

        print("=================================================================")
        print(" [2/2] 检查并部署 Kokoro-82M 英文语音合成模型 (kokoro-v1.0.onnx)...")
        print("=================================================================")
        onnx_file = KOKORO_DIR / "kokoro-v1.0.onnx"
        voices_file = KOKORO_DIR / "voices-v1.0.bin"
        if not onnx_file.exists() or not voices_file.exists():
            try:
                import urllib.request
                urls = [
                    (
                        "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/kokoro-v1.0.onnx",
                        onnx_file,
                    ),
                    (
                        "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/voices-v1.0.bin",
                        voices_file,
                    ),
                ]
                for url, target in urls:
                    if not target.exists():
                        print(f" 正在下载 {target.name} ...")
                        urllib.request.urlretrieve(url, str(target))
                        print(f" ✓ 下载完成: {target}")
            except Exception as e:
                print(f" ! Kokoro ONNX 下载提示: {e}")
        else:
            print(f" ✓ Kokoro-82M 模型文件已存在: {KOKORO_DIR}")

    def load_into_memory(self) -> None:
        """将 SenseVoice Small 与 Kokoro-82M 常驻内存，并预热中英文标准陆空通话语音缓存"""
        # 1. 检测硬件加速设备 (CUDA / Apple MPS / CPU)
        torch_device = "cpu"
        try:
            import torch
            if torch.cuda.is_available():
                torch_device = "cuda:0"
                self.device = f"NVIDIA CUDA ({torch.cuda.get_device_name(0)})"
            elif hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
                torch_device = "mps"
                self.device = "Apple Silicon MPS"
        except Exception:
            pass

        # 2. 加载 SenseVoice Small
        try:
            from funasr import AutoModel
            sv_dir = self.sensevoice_model_dir or self._find_local_sensevoice_dir() or "iic/SenseVoiceSmall"
            print(f" 正在加载 SenseVoice Small 到内存 ({sv_dir}, device={torch_device})...")
            self.sensevoice_model = AutoModel(
                model=str(sv_dir),
                trust_remote_code=True,
                disable_update=True,
                device=torch_device,
            )
            self.sensevoice_ready = True
            print(" ✓ [RAM Resident] SenseVoice Small 语音识别模型已常驻内存！")
        except Exception as e:
            print(f" ! [警告] SenseVoice Small 加载异常: {e}")
            print("   请确认已安装 torch 与 funasr (启动器会自动执行 pip install -r requirements.txt)")

        # 3. 加载 Kokoro-82M (专用于高音质英文 ICAO 陆空通话)
        try:
            from kokoro_onnx import Kokoro
            onnx_file = KOKORO_DIR / "kokoro-v1.0.onnx"
            voices_file = KOKORO_DIR / "voices-v1.0.bin"
            if onnx_file.exists() and voices_file.exists():
                self.kokoro_model = Kokoro(str(onnx_file), str(voices_file))
                self.kokoro_ready = True
                print(" ✓ [RAM Resident] Kokoro-82M 英文语音模型已常驻内存！")
        except Exception as e:
            print(f" ! Kokoro TTS 加载提示: {e}")

    def transcribe_short_utterance(
        self,
        wav_bytes: bytes,
        language: str,
        callsigns: List[str],
        waypoints: List[str],
        runways: List[str],
    ) -> Tuple[str, str, str, int, str]:
        """
        使用内存中的 soundfile 直接解码 16kHz 单声道波形为 float32 numpy 数组，
        直接送入 SenseVoice Small 推理（无需外部 ffmpeg！），并自动执行微弱音量增益放大 (AGC)。
        """
        t0 = time.perf_counter()
        if not self.sensevoice_model:
            return "", "", "", 0, "SenseVoice Small 模型尚未加载就绪，请检查启动器终端日志"

        try:
            samples, sr = sf.read(io.BytesIO(wav_bytes), dtype="float32")
            if samples.ndim > 1:
                samples = np.mean(samples, axis=1).astype(np.float32)

            if len(samples) < 1600:
                return "", "", "", 0, "录音时长过短 (<0.1s)"

            # 若采样率不是 16000Hz，线性重采样至 16000Hz
            if sr != 16000 and sr > 0:
                target_len = int(len(samples) * 16000 / sr)
                x_old = np.linspace(0.0, 1.0, len(samples), endpoint=False)
                x_new = np.linspace(0.0, 1.0, target_len, endpoint=False)
                samples = np.interp(x_new, x_old, samples).astype(np.float32)

            peak = float(np.max(np.abs(samples))) if len(samples) > 0 else 0.0
            if peak < 0.002:
                return "", "", "", 0, "麦克风未检测到有效人声波形 (音量过低)"

            # 自动增益归一化 (AGC)：确保轻声说话也能被 SenseVoice 准确识别
            if peak < 0.65:
                gain = min(15.0, 0.85 / peak)
                samples = np.clip(samples * gain, -1.0, 1.0).astype(np.float32)

            lang_arg = language if language in ("en", "zh", "auto") else "auto"

            # 直接传入 numpy float32 数组，彻底绕过 torchaudio/ffmpeg 文件读取报错！
            res_raw = self.sensevoice_model.generate(
                input=samples,
                cache={},
                language=lang_arg,
                use_itn=False,
            )
            res_itn = self.sensevoice_model.generate(
                input=samples,
                cache={},
                language=lang_arg,
                use_itn=True,
            )

            raw_text = re.sub(r"<\|[^>]+?\|>", "", res_raw[0].get("text", "")).strip() if res_raw else ""
            itn_text = re.sub(r"<\|[^>]+?\|>", "", res_itn[0].get("text", "")).strip() if res_itn else ""
            verified = verify_sensevoice_with_airspace_context(
                raw_text, itn_text, callsigns, waypoints, runways
            )
            latency_ms = int((time.perf_counter() - t0) * 1000)
            self.last_latency_ms = latency_ms
            print(
                f" 🎙️ [SenseVoice ASR] 时长={len(samples)/16000:.2f}s | 原始='{raw_text}' | ITN='{itn_text}' | 校验后='{verified}' ({latency_ms}ms)"
            )
            return raw_text, itn_text, verified, latency_ms, ""
        except Exception as e:
            err_msg = f"SenseVoice 推理异常: {e}"
            print(f" ❌ [SenseVoice Error] {err_msg}")
            return "", "", "", 0, err_msg

    async def synthesize_putonghua_wav_bytes(
        self,
        phonetic_text: str,
        voice: str,
        speed: float = 1.2,
        role: str = "PILOT",
        language: str = "Chinese",
    ) -> bytes:
        zh_voice = resolve_clean_zh_voice(voice, role)
        if not self.qwen.ready:
            raise RuntimeError("Local Qwen is not ready; restart the launcher")
        revision = self.qwen.info["revision"]
        cache_key = f"QWEN3_06B_WSOLA_V2::{revision}::{language}::{zh_voice}::{speed:.4f}::{phonetic_text}"
        if cache_key in self.audio_cache:
            self.audio_cache.move_to_end(cache_key)
            return self.audio_cache[cache_key]
        ZH_CACHE_DIR.mkdir(parents=True, exist_ok=True)
        disk_file = ZH_CACHE_DIR / (hashlib.sha256(cache_key.encode()).hexdigest() + ".wav")
        if disk_file.exists():
            wav_bytes = disk_file.read_bytes()
            try:
                samples, _ = sf.read(io.BytesIO(wav_bytes))
                if len(samples) < 100 or not np.isfinite(samples).all() or np.max(np.abs(samples)) < 0.0001:
                    raise ValueError("Invalid cached audio")
                self._store_in_ram_cache(cache_key, wav_bytes)
                return wav_bytes
            except Exception:
                disk_file.unlink(missing_ok=True)
        t0 = time.perf_counter()
        wav_bytes = await asyncio.to_thread(self.qwen.synthesize, phonetic_text, zh_voice, speed, language)
        temporary = disk_file.with_suffix(".tmp")
        temporary.write_bytes(wav_bytes)
        temporary.replace(disk_file)
        self._store_in_ram_cache(cache_key, wav_bytes)
        self.last_latency_ms = round((time.perf_counter() - t0) * 1000)
        return wav_bytes

    def _store_in_ram_cache(self, key: str, wav_bytes: bytes) -> None:
        if len(self.audio_cache) >= self.max_cache_size:
            self.audio_cache.popitem(last=False)
        self.audio_cache[key] = wav_bytes

    def synthesize_english_kokoro_wav_bytes(
        self,
        phonetic_text: str,
        voice: str = "af_bella",
        lang: str = "en-us",
        speed: float = 1.12,
        role: str = "PILOT",
    ) -> bytes:
        en_voice = resolve_clean_en_voice(voice, role)
        en_lang = "en-gb" if en_voice.startswith("b") else "en-us"
        cache_key = f"EN_KOKORO::{en_voice}::{en_lang}::{speed:.2f}::{phonetic_text}"
        if cache_key in self.audio_cache:
            self.audio_cache.move_to_end(cache_key)
            return self.audio_cache[cache_key]

        t0 = time.perf_counter()
        if self.kokoro_model:
            samples, sample_rate = self.kokoro_model.create(
                phonetic_text,
                voice=en_voice,
                speed=float(speed),
                lang=en_lang,
            )
        else:
            raise RuntimeError("Local Kokoro is not ready; restart the launcher")

        buf = io.BytesIO()
        sf.write(buf, samples, sample_rate, format="WAV", subtype="PCM_16")
        wav_bytes = buf.getvalue()

        self._store_in_ram_cache(cache_key, wav_bytes)
        self.last_latency_ms = int((time.perf_counter() - t0) * 1000)
        return wav_bytes


engine = ResidentAiEngine()
app = FastAPI(title="ATC2.0 Offline SenseVoice + Qwen3-TTS + Kokoro")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["X-ATC-TTS-Engine", "X-ATC-TTS-Voice"],
)


class TtsRequest(BaseModel):
    text: str = Field(min_length=1, max_length=500)
    raw_text: Optional[str] = None
    voice: str = "Serena"
    lang: str = "zh-CN"
    speed: float = Field(default=1.2, ge=0.9, le=1.5)
    role: str = "PILOT"


@app.get("/")
@app.get("/game")
def serve_game():
    if GAME_HTML_PATH.exists():
        return FileResponse(str(GAME_HTML_PATH), media_type="text/html")
    return HTMLResponse("<h3>请将 atc_command_simulator.html 放在启动器同级目录下</h3>")


@app.get("/api/health")
def health_check():
    return JSONResponse(
        {
            "status": "ok",
            "voice_backend_version": "atc2-offline-qwen-v2",
            "qwen_ready": engine.qwen.ready and engine.qwen.process is not None and engine.qwen.process.poll() is None,
            "qwen_speakers": sorted(QWEN_SPEAKERS),
            "audio_pipeline": "wsola-v2",
            "qwen_device": engine.qwen.info.get("device", ""),
            "tts_engines": {"zh": "qwen3-tts-0.6b", "en": "kokoro-82m"},
            "sensevoice_ready": engine.sensevoice_ready,
            "kokoro_ready": engine.kokoro_ready,
            "device": engine.device,
            "cache_size": len(engine.audio_cache),
            "last_latency_ms": engine.last_latency_ms,
        }
    )


@app.post("/api/asr")
async def asr_endpoint(
    audio: UploadFile = File(...),
    language: str = Form("auto"),
    compare_itn: str = Form("true"),
    callsigns: str = Form("[]"),
    waypoints: str = Form("[]"),
    runways: str = Form("[]"),
):
    wav_bytes = await audio.read()
    cs_list = json.loads(callsigns) if callsigns else []
    wp_list = json.loads(waypoints) if waypoints else []
    rwy_list = json.loads(runways) if runways else []

    raw_text, itn_text, verified_text, latency_ms, error_msg = engine.transcribe_short_utterance(
        wav_bytes, language, cs_list, wp_list, rwy_list
    )
    return JSONResponse(
        {
            "raw_text": raw_text,
            "itn_text": itn_text,
            "verified_text": verified_text,
            "text": verified_text,
            "latency_ms": latency_ms,
            "sensevoice_ready": engine.sensevoice_ready,
            "error": error_msg,
        }
    )


@app.post("/api/tts")
async def tts_endpoint(req: TtsRequest, request: Request):
    is_chinese = req.lang.lower().startswith("zh") or req.lang.lower().startswith("cmn") or req.lang.upper() == "CN"
    phonetic = format_kokoro_aviation_phonetics(
        req.text or req.raw_text or "",
        "zh-CN" if is_chinese else "en-us",
    )
    use_qwen = is_chinese or req.voice in QWEN_SPEAKERS
    try:
        async with engine.tts_lock:
            if await request.is_disconnected():
                return Response(status_code=499)
            if use_qwen:
                voice = resolve_clean_zh_voice(req.voice, req.role)
                wav_bytes = await engine.synthesize_putonghua_wav_bytes(phonetic, voice, req.speed, req.role,
                                                                      "Chinese" if is_chinese else "English")
            else:
                voice = resolve_clean_en_voice(req.voice, req.role)
                wav_bytes = await asyncio.to_thread(engine.synthesize_english_kokoro_wav_bytes,
                                                    phonetic, voice, req.lang, req.speed, req.role)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        print(f"[Local TTS failed] {exc}", flush=True)
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    return Response(content=wav_bytes, media_type="audio/wav", headers={
        "X-ATC-TTS-Engine": "qwen3-tts-0.6b" if use_qwen else "kokoro-82m",
        "X-ATC-TTS-Voice": voice,
        "Cache-Control": "no-store",
    })


def main() -> None:
    parser = argparse.ArgumentParser(description="ATC2.0 Local AI Launcher Server")
    parser.add_argument("--check-and-download-models", action="store_true", help="仅检查并下载两个模型")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=18765)
    parser.add_argument("--no-browser", action="store_true")
    args = parser.parse_args()

    engine.ensure_models_downloaded()
    if args.check_and_download_models:
        print(" ✓ 模型检查与部署完成！")
        return

    engine.load_into_memory()
    print("[Qwen] Loading local Mandarin model (see .atc_logs/qwen-worker.log)...", flush=True)
    engine.qwen.start()
    if not engine.sensevoice_ready or not engine.kokoro_ready:
        engine.qwen.close()
        raise RuntimeError("Local ASR/English model failed to load; see log above")

    url = f"http://{args.host}:{args.port}/"
    print("=================================================================")
    print(f" 🚀 ATC2.0 本地常驻 AI 语音服务已启动: {url}")
    print(f"    - SenseVoice Small (ASR): {'已就绪' if engine.sensevoice_ready else '未就绪'}")
    print(f"    - Kokoro-82M (英文 TTS) : {'已就绪' if engine.kokoro_ready else '未就绪'}")
    print("    - Qwen3-TTS-0.6B (九种音色 TTS): " + engine.qwen.info["device"])
    print("=================================================================")
    if not args.no_browser:
        webbrowser.open(url)

    import uvicorn
    try:
        uvicorn.run(app, host=args.host, port=args.port, log_level="warning")
    finally:
        engine.qwen.close()


if __name__ == "__main__":
    main()
