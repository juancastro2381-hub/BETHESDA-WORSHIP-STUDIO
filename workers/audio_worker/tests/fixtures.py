"""Shared synthetic-audio fixtures. Generated at test time into tmp dirs; NO audio samples are committed."""

from __future__ import annotations

import math
import struct
import subprocess
from pathlib import Path


def ffmpeg_exe() -> str:
    import imageio_ffmpeg  # type: ignore[import-untyped]

    return imageio_ffmpeg.get_ffmpeg_exe()


def synth_id3v2(payload_size: int = 64, extra_junk: bytes = b"") -> bytes:
    body = b"TIT2" + struct.pack(">I", 4) + b"\x00\x00" + b"\x03abc"
    body = body.ljust(payload_size, b"\x00") + extra_junk
    size = len(body)
    synchsafe = bytes([(size >> 21) & 0x7F, (size >> 14) & 0x7F, (size >> 7) & 0x7F, size & 0x7F])
    return b"ID3\x03\x00\x00" + synchsafe + body


def synth_mp3_frames(frames: int = 8) -> bytes:
    """MPEG-1 Layer III, 128 kbps, 44.1 kHz, joint stereo: header FF FB 90 40, frame length 417 (padding 0)."""
    header = bytes([0xFF, 0xFB, 0x90, 0x40])
    frame = header + b"\x00" * (417 - 4)
    return frame * frames


def synth_wav(duration_s: float = 1.0, sample_rate: int = 22050, freq: float = 440.0) -> bytes:
    n = int(duration_s * sample_rate)
    pcm = b"".join(struct.pack("<h", int(12000 * math.sin(2 * math.pi * freq * i / sample_rate))) for i in range(n))
    fmt = struct.pack("<HHIIHH", 1, 1, sample_rate, sample_rate * 2, 2, 16)
    return (
        b"RIFF" + struct.pack("<I", 4 + 8 + len(fmt) + 8 + len(pcm)) + b"WAVE"
        + b"fmt " + struct.pack("<I", len(fmt)) + fmt
        + b"data" + struct.pack("<I", len(pcm)) + pcm
    )


def real_mp3_via_ffmpeg(out_path: Path, duration_s: float = 2.0, with_id3: bool = True) -> bytes:
    cmd = [
        ffmpeg_exe(), "-nostdin", "-v", "error", "-y",
        "-f", "lavfi", "-i", f"sine=frequency=440:duration={duration_s}",
        "-c:a", "libmp3lame", "-b:a", "128k",
        "-id3v2_version", "3" if with_id3 else "0",
        "-write_id3v2", "1" if with_id3 else "0",
        "-write_xing", "0",
        "-metadata", "title=Fixture Tone",
        str(out_path),
    ]
    subprocess.run(cmd, check=True, timeout=60)
    return out_path.read_bytes()


def synth_monophonic_melody_wav(sample_rate: int = 22050, bpm: int = 120) -> bytes:
    """Synthesize a clear 8-bar monophonic melody with percussive beat clicks at `bpm`."""
    beat_sec = 60.0 / float(bpm)
    # C4, D4, E4, G4, A4, G4, E4, C4 repeated over 8 measures (32 beats)
    note_freqs = [261.63, 293.66, 329.63, 392.00, 440.00, 392.00, 329.63, 261.63] * 4
    total_samples = int(len(note_freqs) * beat_sec * sample_rate)
    samples: list[int] = []
    beat_samples = int(beat_sec * sample_rate)
    for i in range(total_samples):
        beat_idx = min(len(note_freqs) - 1, i // beat_samples)
        pos_in_beat = i % beat_samples
        t = i / float(sample_rate)
        f = note_freqs[beat_idx]
        # Pure fundamental + light 2nd harmonic with attack/decay envelope
        env = min(1.0, pos_in_beat / (0.02 * sample_rate)) * math.exp(-1.5 * (pos_in_beat / float(beat_samples)))
        val = 0.75 * env * (0.85 * math.sin(2 * math.pi * f * t) + 0.15 * math.sin(4 * math.pi * f * t))
        # Short transient click at beat onset for tempo lock
        if pos_in_beat < int(0.012 * sample_rate):
            accent = 0.22 if (beat_idx % 4 == 0) else 0.12
            val += accent * math.sin(2 * math.pi * 1800.0 * t)
        samples.append(max(-32000, min(32000, int(val * 24000))))

    pcm = struct.pack(f"<{len(samples)}h", *samples)
    fmt = struct.pack("<HHIIHH", 1, 1, sample_rate, sample_rate * 2, 2, 16)
    return (
        b"RIFF" + struct.pack("<I", 4 + 8 + len(fmt) + 8 + len(pcm)) + b"WAVE"
        + b"fmt " + struct.pack("<I", len(fmt)) + fmt
        + b"data" + struct.pack("<I", len(pcm)) + pcm
    )


def synth_polyphonic_chords_wav(sample_rate: int = 22050, bpm: int = 120) -> bytes:
    """Synthesize a dense 8-bar polyphonic chord progression (C -> Am -> F -> G) with broadband drums."""
    beat_sec = 60.0 / float(bpm)
    chords = [
        [130.81, 164.81, 196.00, 261.63, 329.63, 392.00, 523.25],  # C major full voicing
        [110.00, 164.81, 220.00, 261.63, 329.63, 440.00, 523.25],  # A minor full voicing
        [87.31, 130.81, 174.61, 220.00, 261.63, 349.23, 440.00],   # F major full voicing
        [98.00, 146.83, 196.00, 246.94, 293.66, 392.00, 493.88],   # G major full voicing
    ] * 2  # 8 measures, 4 beats each = 32 beats
    beat_samples = int(beat_sec * sample_rate)
    total_beats = len(chords) * 4
    total_samples = total_beats * beat_samples
    samples: list[int] = []
    for i in range(total_samples):
        beat_idx = i // beat_samples
        measure_idx = min(len(chords) - 1, beat_idx // 4)
        pos_in_beat = i % beat_samples
        t = i / float(sample_rate)
        freqs = chords[measure_idx]
        val = sum(math.sin(2 * math.pi * f * t) + 0.4 * math.sin(4 * math.pi * f * t) for f in freqs) / (len(freqs) * 1.4)
        if pos_in_beat < int(0.015 * sample_rate):
            accent = 0.35 if (beat_idx % 4 == 0) else 0.18
            val += accent * math.sin(2 * math.pi * (900.0 + (pos_in_beat * 7) % 1500) * t)
        samples.append(max(-32000, min(32000, int(val * 22000))))

    pcm = struct.pack(f"<{len(samples)}h", *samples)
    fmt = struct.pack("<HHIIHH", 1, 1, sample_rate, sample_rate * 2, 2, 16)
    return (
        b"RIFF" + struct.pack("<I", 4 + 8 + len(fmt) + 8 + len(pcm)) + b"WAVE"
        + b"fmt " + struct.pack("<I", len(fmt)) + fmt
        + b"data" + struct.pack("<I", len(pcm)) + pcm
    )


def synth_silent_wav(duration_s: float = 2.0, sample_rate: int = 22050) -> bytes:
    """Synthesize a near-silent WAV file to verify zero-fabrication on insufficient evidence."""
    n = int(duration_s * sample_rate)
    pcm = b"\x00\x00" * n
    fmt = struct.pack("<HHIIHH", 1, 1, sample_rate, sample_rate * 2, 2, 16)
    return (
        b"RIFF" + struct.pack("<I", 4 + 8 + len(fmt) + 8 + len(pcm)) + b"WAVE"
        + b"fmt " + struct.pack("<I", len(fmt)) + fmt
        + b"data" + struct.pack("<I", len(pcm)) + pcm
    )


