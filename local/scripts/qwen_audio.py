"""Speech-oriented tempo processing. No convolution, echo or phase-vocoder stretch."""
import numpy as np

AUDIO_PIPELINE_VERSION = "wsola-v2"


def trim_edge_silence(samples, sample_rate):
    """Trim only quiet edges, retaining 60 ms around audible speech."""
    samples = np.asarray(samples, dtype=np.float32).reshape(-1)
    if not len(samples):
        return samples
    frame = max(1, round(sample_rate * .01))
    padded = np.pad(samples, (0, (-len(samples)) % frame))
    rms = np.sqrt(np.mean(padded.reshape(-1, frame) ** 2, axis=1))
    threshold = max(0.0001, float(rms.max()) * 0.004)
    active = np.flatnonzero(rms > threshold)
    if not len(active):
        return samples
    padding = round(sample_rate * .06)
    start = max(0, int(active[0]) * frame - padding)
    end = min(len(samples), (int(active[-1]) + 1) * frame + padding)
    return samples[start:end]


def apply_speech_tempo(samples, sample_rate, speed):
    """WSOLA preserves pitch and speech transients without STFT phase smearing."""
    if not 0.9 <= float(speed) <= 1.5:
        raise ValueError("Speech rate must be 0.9-1.5")
    samples = trim_edge_silence(samples, sample_rate)
    if abs(speed - 1.0) < .001:
        return samples
    from audiotsm import wsola
    from audiotsm.io.array import ArrayReader, ArrayWriter
    # Short speech windows; explicit end padding prevents loss of the final callsign.
    frame_length = 512 if sample_rate <= 24000 else 1024
    reader = ArrayReader(np.pad(samples, (0, frame_length * 3))[None, :])
    writer = ArrayWriter(channels=1)
    processor = wsola(channels=1, speed=float(speed), frame_length=frame_length)
    processor.run(reader, writer)
    return trim_edge_silence(writer.data[0], sample_rate).astype(np.float32)
