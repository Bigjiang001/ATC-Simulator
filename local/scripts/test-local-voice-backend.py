"""Exercise the real TTS endpoint/cache using a fake local inference worker."""
import asyncio
import io
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import atc_ai_server as server
import numpy as np
import soundfile as sf
from fastapi import HTTPException


class ConnectedRequest:
    async def is_disconnected(self):
        return False


class FakeQwen:
    ready = True
    info = {"revision": "test-revision"}

    def __init__(self):
        self.calls = []

    def synthesize(self, text, voice, speed, language="Chinese"):
        self.calls.append((text, voice, speed, language))
        output = io.BytesIO()
        sf.write(output, np.sin(np.arange(2400) / 10) * .2, 24000, format="WAV")
        return output.getvalue()


class LocalVoiceTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.engine = server.ResidentAiEngine()
        self.engine.qwen = FakeQwen()
        self.patches = [patch.object(server, "engine", self.engine),
                        patch.object(server, "ZH_CACHE_DIR", Path(self.temp.name) / "qwen-cache")]
        for replacement in self.patches:
            replacement.start()

    async def asyncTearDown(self):
        for replacement in self.patches:
            replacement.stop()
        self.temp.cleanup()

    async def synth(self, **extra):
        values = dict(text="左转航向270，东方航空5213。", voice="Serena")
        values.update(extra)
        return await server.tts_endpoint(server.TtsRequest(**values), ConnectedRequest())

    async def test_selected_voice_provenance_and_cache_identity(self):
        result = await self.synth()
        self.assertEqual(result.headers["X-ATC-TTS-Engine"], "qwen3-tts-0.6b")
        self.assertEqual(result.headers["X-ATC-TTS-Voice"], "Serena")
        self.assertTrue(result.body.startswith(b"RIFF"))
        await self.synth()
        self.engine.audio_cache.clear()  # disk cache also retains exactly this engine/voice
        await self.synth()
        self.assertEqual(len(self.engine.qwen.calls), 1)
        await self.synth(voice="Vivian")
        await self.synth(speed=1.35)
        self.engine.qwen.info = {"revision": "new-revision"}
        await self.synth()
        self.assertEqual(len(self.engine.qwen.calls), 4)
        self.assertIn("两拐洞", self.engine.qwen.calls[0][0])
        self.assertTrue(self.engine.qwen.calls[0][0].endswith("东方航空 五两幺三。"))

    async def test_model_failure_has_no_alternate_voice_or_silent_wav(self):
        self.engine.qwen.ready = False
        with self.assertRaises(HTTPException) as failure:
            await self.synth()
        self.assertEqual(failure.exception.status_code, 503)
        with self.assertRaises(HTTPException) as failure:
            await self.synth(lang="en-us", voice="af_bella")
        self.assertEqual(failure.exception.status_code, 503)
        self.assertEqual(len(self.engine.qwen.calls), 0)

    async def test_all_nine_qwen_speakers_keep_exact_identity(self):
        for voice in server.QWEN_SPEAKERS:
            result = await self.synth(voice=voice)
            self.assertEqual(result.headers["X-ATC-TTS-Voice"], voice)
            self.assertEqual(result.headers["X-ATC-TTS-Engine"], "qwen3-tts-0.6b")
        self.assertEqual(len(self.engine.qwen.calls), 9)
        with self.assertRaises(HTTPException) as failure:
            await self.synth(voice="Tingting")
        self.assertEqual(failure.exception.status_code, 400)

    async def test_explicit_qwen_english_choice_and_language_cache(self):
        first = await self.synth(voice="Ryan", lang="en-us")
        self.assertEqual(first.headers["X-ATC-TTS-Engine"], "qwen3-tts-0.6b")
        self.assertEqual(self.engine.qwen.calls[-1][3], "English")
        await self.synth(voice="Ryan", lang="zh-CN")
        self.assertEqual(self.engine.qwen.calls[-1][3], "Chinese")
        self.assertEqual(len(self.engine.qwen.calls), 2)

    async def test_serial_requests_keep_speaker_identity(self):
        results = await asyncio.gather(self.synth(voice="Vivian"), self.synth(voice="Uncle_Fu"))
        self.assertEqual([r.headers["X-ATC-TTS-Voice"] for r in results], ["Vivian", "Uncle_Fu"])


if __name__ == "__main__":
    unittest.main()
