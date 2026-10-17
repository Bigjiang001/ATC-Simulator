"""Pitch, duration, silence and callsign-tail regression for the Qwen tempo path."""
import unittest
import numpy as np
from qwen_audio import apply_speech_tempo


class SpeechTempoTests(unittest.TestCase):
    def test_speed_changes_duration_without_changing_pitch(self):
        sr = 24000
        source = (.3 * np.sin(2 * np.pi * 220 * np.arange(sr * 3) / sr)).astype(np.float32)
        for speed in (.9, 1.0, 1.2, 1.5):
            result = apply_speech_tempo(source, sr, speed)
            self.assertAlmostEqual(len(result) / sr, 3 / speed, delta=.09)
            center = result[sr // 3:-sr // 3]
            bins = np.fft.rfftfreq(len(center), 1 / sr)
            peak = bins[np.argmax(np.abs(np.fft.rfft(center)))]
            self.assertAlmostEqual(peak, 220, delta=3)
            self.assertTrue(np.isfinite(result).all())

    def test_last_syllable_survives_fastest_rate(self):
        sr = 24000
        t = np.arange(sr * 2) / sr
        # A distinctly higher-pitched final syllable stands in for the final callsign digit.
        signal = .25 * np.sin(2 * np.pi * 180 * t)
        signal[-4800:] = .25 * np.sin(2 * np.pi * 700 * t[-4800:])
        result = apply_speech_tempo(signal, sr, 1.5)
        tail = result[-3000:-800]
        bins = np.fft.rfftfreq(len(tail), 1 / sr)
        self.assertAlmostEqual(bins[np.argmax(abs(np.fft.rfft(tail)))], 700, delta=15)

    def test_trims_quiet_edges_without_gating_quiet_speech(self):
        sr = 24000
        speech = .002 * np.sin(2 * np.pi * 240 * np.arange(sr) / sr)
        result = apply_speech_tempo(np.pad(speech, (sr, sr)), sr, 1)
        self.assertGreater(len(result), sr)
        self.assertLess(len(result), sr * 1.2)

    def test_invalid_rate_is_explicit(self):
        with self.assertRaises(ValueError):
            apply_speech_tempo(np.ones(1000), 24000, 2)


if __name__ == '__main__':
    unittest.main()
