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

