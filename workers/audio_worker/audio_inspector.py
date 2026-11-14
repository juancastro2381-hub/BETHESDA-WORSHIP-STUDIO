"""Audio binary verification, container telemetry extraction, and derivative preparation (WS-AUDIO-01).

Never modifies the original uploaded audio file. Any decoded PCM normalization or inspection
manifest is written as a separate isolated derivative with cryptographic provenance metadata.
"""

from __future__ import annotations

import hashlib
import os
import subprocess
import time
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Callable, Optional

import numpy as np

from signature_inspector import inspect_audio_signature, parse_mpeg_frame_header

MAX_AUDIO_BYTES = 50 * 1024 * 1024  # 50 MiB
MAX_DURATION_SECONDS = 900  # 15 min decompression-bomb cap for derivative WAV
MAX_PROBE_DURATION_SECONDS = 60  # 60s bounded in-memory probe cap when derivativeWavPath is omitted
HEADER_INSPECT_WINDOW_BYTES = 1024 * 1024  # 1 MiB bounded header inspection window


@dataclass
class InspectionOutcome:
    contract_version: str
    worker_version: str
    verified_sha256: str
    file_size_bytes: int
    detected_format: str
    mime_type: str
    has_id3v2: bool
    id3_tag_size_bytes: int
    sample_rate_hz: Optional[int]
    channels: Optional[int]
    bitrate_kbps: Optional[int]
    duration_ms: Optional[int]
    mpeg_frame_count: Optional[int]
    pcm_decode_verified: bool
    decoder_used: str
    derivative_pcm_path: Optional[str] = None
    derivative_pcm_sha256: Optional[str] = None
    derivative_pcm_bytes: Optional[int] = None
    warnings: list[str] = None  # type: ignore[assignment]

    def __post_init__(self) -> None:
        if self.warnings is None:
            self.warnings = []


def compute_sha256_streaming(file_path: Path) -> tuple[str, int]:
    """Compute SHA-256 and byte length incrementally without keeping huge buffers unnecessarily."""
    hasher = hashlib.sha256()
    total = 0
    with file_path.open("rb") as fh:
        while True:
            chunk = fh.read(65536)
            if not chunk:
                break
            hasher.update(chunk)
            total += len(chunk)
    return hasher.hexdigest(), total


def _read_bounded_header_window(file_path: Path, max_bytes: int = HEADER_INSPECT_WINDOW_BYTES) -> bytes:
    """Read only a bounded prefix window for container/signature checks (never buffers huge audio)."""
    with file_path.open("rb") as fh:
        data = fh.read(max_bytes)
        # If an ID3v2 tag extends beyond max_bytes, inspect its header and append up to 16 KiB post-tag frames
        if len(data) >= 10 and data[0:3] == b"ID3" and not ((data[5] | data[6] | data[7] | data[8] | data[9]) & 0x80):
            s0, s1, s2, s3 = data[6], data[7], data[8], data[9]
            tag_size = ((s0 & 0x7F) << 21) | ((s1 & 0x7F) << 14) | ((s2 & 0x7F) << 7) | (s3 & 0x7F)
            footer = 10 if (data[5] & 0x10) else 0
            total_id3 = 10 + tag_size + footer
            if total_id3 + 8192 > len(data) and total_id3 < MAX_AUDIO_BYTES:
                # Re-anchor a compact synthetic ID3v2 header (0 bytes payload) + actual frames at offset total_id3
                # so inspect_audio_signature checks post-ID3 frames with O(1) memory.
                fh.seek(total_id3)
                frame_slice = fh.read(16384)
                compact_id3 = bytes([0x49, 0x44, 0x33, data[3], data[4], data[5] & ~0x10, 0, 0, 0, 0])
                return compact_id3 + frame_slice
        return data


def _count_mp3_frames_streaming(file_path: Path, start_offset: int) -> tuple[int, Optional[int], Optional[int]]:
    """Walk MPEG audio frames cleanly in 64 KiB chunks to measure frame count and exact duration."""
    frame_count = 0
    total_samples = 0
    total_bits = 0
    last_sr = None

    buf = bytearray()
    with file_path.open("rb") as fh:
        fh.seek(max(0, start_offset))
        eof = False
        while True:
            if not eof and len(buf) < 65536:
                chunk = fh.read(65536)
                if not chunk:
                    eof = True
                else:
                    buf.extend(chunk)

            offset = 0
            stopped = False
            while offset + 4 <= len(buf):
                parsed = parse_mpeg_frame_header(buf, offset)
                if parsed is None:
                    stopped = True
                    break
                frame_len = parsed["frame_length"]
                if offset + frame_len > len(buf):
                    break
                sr = parsed["sample_rate_hz"]
                last_sr = sr
                version_id = parsed["version_id"]
                layer_id = parsed["layer_id"]
                if layer_id == 3:
                    samples_per_frame = 384
                elif layer_id == 2 or version_id == 3:
                    samples_per_frame = 1152
                else:
                    samples_per_frame = 576
                total_samples += samples_per_frame
                total_bits += frame_len * 8
                frame_count += 1
                offset += frame_len

            if offset > 0:
                del buf[:offset]

            if stopped or (eof and len(buf) < 4) or (eof and offset == 0):
                break
            if eof and parse_mpeg_frame_header(buf, 0) is not None and parse_mpeg_frame_header(buf, 0)["frame_length"] > len(buf):
                break

    if frame_count == 0 or not last_sr:
        return 0, None, None

    duration_ms = round((total_samples / last_sr) * 1000)
    avg_bitrate_kbps = round((total_bits / (total_samples / last_sr)) / 1000) if total_samples > 0 else None
    return frame_count, duration_ms, avg_bitrate_kbps


def _decode_pcm_with_local_ffmpeg(
    source_path: Path,
    derivative_wav_path: Optional[Path],
    target_sample_rate: int = 22050,
    max_duration_sec: int = MAX_DURATION_SECONDS,
) -> tuple[bool, str, Optional[int], Optional[int], Optional[int], list[str]]:
    """Use locally bundled imageio-ffmpeg binary to verify compressed audio decoding into mono PCM."""
    warnings: list[str] = []
    try:
        import imageio_ffmpeg  # type: ignore[import-untyped]
        ffmpeg_exe = imageio_ffmpeg.get_ffmpeg_exe()
    except Exception as exc:  # pragma: no cover - environment fallback
        warnings.append(f"Local FFmpeg binary unavailable: {exc}")
        return False, "native-header-only", None, None, None, warnings

    if not ffmpeg_exe or not Path(ffmpeg_exe).exists():
        warnings.append("Local FFmpeg executable path missing.")
        return False, "native-header-only", None, None, None, warnings

    # Bounded execution: single-thread and max duration cap prevents decompression bombs
    if derivative_wav_path is not None:
        if derivative_wav_path.resolve() == source_path.resolve():
            raise ValueError("derivative_wav_path must never resolve to source_path.")
        derivative_wav_path.parent.mkdir(parents=True, exist_ok=True)
        cmd = [
            ffmpeg_exe,
            "-nostdin",
            "-threads", "1",
            "-v", "error",
            "-y",
            "-i", str(source_path),
            "-t", str(max_duration_sec),
            "-vn",
            "-ac", "1",
            "-ar", str(target_sample_rate),
            "-f", "wav",
            "-acodec", "pcm_s16le",
            str(derivative_wav_path),
        ]
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=35, check=False)
        if proc.returncode != 0 or not derivative_wav_path.exists():
            stderr_clean = (proc.stderr or "").strip()[:300]
            warnings.append(f"FFmpeg derivative verification returned non-zero status ({proc.returncode}): {stderr_clean}")
            return False, "imageio-ffmpeg-failed", None, None, None, warnings

        wav_size = derivative_wav_path.stat().st_size
        if wav_size < 44:
            warnings.append("Decoded derivative WAV was smaller than canonical 44-byte RIFF header.")
            return False, "imageio-ffmpeg-empty", None, None, None, warnings

        # Stream PCM frames after 44-byte header in bounded chunks without reading whole WAV into memory
        sample_count = 0
        with derivative_wav_path.open("rb") as wf:
            wf.seek(44)
            rem = b""
            while True:
                chunk = wf.read(65536)
                if not chunk:
                    break
                buf = rem + chunk
                aligned_len = (len(buf) // 2) * 2
                rem = buf[aligned_len:]
                if aligned_len > 0:
                    samples = np.frombuffer(buf[:aligned_len], dtype=np.int16)
                    _ = float(np.sqrt(np.mean((samples.astype(np.float32) / 32768.0) ** 2)))
                    sample_count += aligned_len // 2

        duration_ms = round((sample_count / target_sample_rate) * 1000) if sample_count > 0 else 0
        sha, byte_len = compute_sha256_streaming(derivative_wav_path)
        return True, "imageio-ffmpeg", duration_ms, byte_len, sha, warnings

    # Bounded probe decode without writing derivative file (capped at MAX_PROBE_DURATION_SECONDS)
    probe_duration = min(max_duration_sec, MAX_PROBE_DURATION_SECONDS)
    cmd = [
        ffmpeg_exe,
        "-nostdin",
        "-threads", "1",
        "-v", "error",
        "-i", str(source_path),
        "-t", str(probe_duration),
        "-vn",
        "-ac", "1",
        "-ar", str(target_sample_rate),
        "-f", "s16le",
        "pipe:1",
    ]
    proc = subprocess.run(cmd, capture_output=True, timeout=35, check=False)
    if proc.returncode != 0 or not proc.stdout:
        stderr_clean = proc.stderr.decode("utf-8", errors="replace").strip()[:300]
        warnings.append(f"FFmpeg decode probe did not produce PCM samples: {stderr_clean}")
        return False, "imageio-ffmpeg-failed", None, None, None, warnings

    sample_count = len(proc.stdout) // 2
    duration_ms = round((sample_count / target_sample_rate) * 1000) if sample_count > 0 else 0
    return True, "imageio-ffmpeg", duration_ms, None, None, warnings


def inspect_and_verify_audio_file(
    source_path: Path,
    expected_sha256: str,
    derivative_wav_path: Optional[Path] = None,
    emit_progress: Optional[Callable[[int, str], None]] = None,
) -> InspectionOutcome:
    """Verify binary integrity, container signatures, and optional derivative decode cleanly."""
    if derivative_wav_path is not None and derivative_wav_path.resolve() == source_path.resolve():
        raise ValueError("derivative_wav_path must not resolve to the immutable source_path.")

    if not source_path.exists() or not source_path.is_file():
        raise FileNotFoundError(f"Source audio file not found: {source_path.name}")

    if emit_progress:
        emit_progress(15, "Computing cryptographic SHA-256 on original source")

    actual_sha256, file_size_bytes = compute_sha256_streaming(source_path)
    if file_size_bytes == 0:
        raise ValueError("Source audio file is empty (0 bytes).")
    if file_size_bytes > MAX_AUDIO_BYTES:
        raise ValueError(f"Source audio file ({file_size_bytes} bytes) exceeds 50 MiB safety limit.")
    if actual_sha256.lower() != expected_sha256.lower():
        raise ValueError(
            f"Cryptographic SHA-256 mismatch: expected {expected_sha256}, actual {actual_sha256}"
        )

    if emit_progress:
        emit_progress(40, "Validating binary magic bytes and audio frame signatures")

    header_bytes = _read_bounded_header_window(source_path)
    sig = inspect_audio_signature(header_bytes)
    if not sig.valid or not sig.detected_format or not sig.mime_type:
        raise ValueError(sig.reason or "Invalid binary audio signature.")

    # Recover true ID3 size from file header if compact synthetic ID3 prefix was used for >1 MiB ID3 tag
    true_id3_size = sig.id3_tag_size_bytes
    if sig.has_id3v2 and true_id3_size == 10:
        with source_path.open("rb") as fh:
            prefix10 = fh.read(10)
        if len(prefix10) == 10 and prefix10[0:3] == b"ID3":
            s0, s1, s2, s3 = prefix10[6], prefix10[7], prefix10[8], prefix10[9]
            tag_sz = ((s0 & 0x7F) << 21) | ((s1 & 0x7F) << 14) | ((s2 & 0x7F) << 7) | (s3 & 0x7F)
            footer = 10 if (prefix10[5] & 0x10) else 0
            true_id3_size = 10 + tag_sz + footer

    duration_ms: Optional[int] = None
    frame_count: Optional[int] = None
    bitrate_kbps = sig.bitrate_kbps
    sample_rate_hz = sig.sample_rate_hz
    channels = sig.channels
    warnings: list[str] = []

    if sig.detected_format == "MP3" and sig.mpeg_frame_offset is not None:
        stream_start_offset = sig.mpeg_frame_offset
        if true_id3_size > HEADER_INSPECT_WINDOW_BYTES:
            stream_start_offset = (true_id3_size - 10) + sig.mpeg_frame_offset
        fc, dur_ms, avg_br = _count_mp3_frames_streaming(source_path, stream_start_offset)
        if fc > 0:
            frame_count = fc
            duration_ms = dur_ms
            if avg_br:
                bitrate_kbps = avg_br

    if sig.detected_format == "WAV" and sample_rate_hz and channels:
        # Compute deterministic WAV payload duration from byte size after header
        data_idx = header_bytes.find(b"data", 12, min(len(header_bytes), 4096))
        if data_idx != -1 and data_idx + 8 <= len(header_bytes):
            data_size = int.from_bytes(header_bytes[data_idx + 4 : data_idx + 8], "little")
            effective_size = min(data_size, file_size_bytes - (data_idx + 8))
            bits_per_sample = int.from_bytes(header_bytes[34:36], "little") if len(header_bytes) >= 36 else 16
            bytes_per_sec = sample_rate_hz * channels * max(1, bits_per_sample // 8)
            if bytes_per_sec > 0 and effective_size > 0:
                duration_ms = round((effective_size / bytes_per_sec) * 1000)

    if emit_progress:
        emit_progress(70, "Verifying audio decoding via local Python/FFmpeg runtime")

    pcm_verified, decoder_used, decoded_dur_ms, deriv_bytes, deriv_sha, decode_warnings = _decode_pcm_with_local_ffmpeg(
        source_path=source_path,
        derivative_wav_path=derivative_wav_path,
    )
    warnings.extend(decode_warnings)
    if duration_ms is None and decoded_dur_ms is not None and decoded_dur_ms > 0:
        duration_ms = decoded_dur_ms

    if emit_progress:
        emit_progress(95, "Finalizing inspection manifest")

    return InspectionOutcome(
        contract_version="1.0",
        worker_version="0.1.0",
        verified_sha256=actual_sha256,
        file_size_bytes=file_size_bytes,
        detected_format=sig.detected_format,
        mime_type=sig.mime_type,
        has_id3v2=sig.has_id3v2,
        id3_tag_size_bytes=true_id3_size,
        sample_rate_hz=sample_rate_hz,
        channels=channels,
        bitrate_kbps=bitrate_kbps,
        duration_ms=duration_ms,
        mpeg_frame_count=frame_count,
        pcm_decode_verified=pcm_verified,
        decoder_used=decoder_used,
        derivative_pcm_path=str(derivative_wav_path) if (pcm_verified and derivative_wav_path and derivative_wav_path.exists()) else None,
        derivative_pcm_sha256=deriv_sha if pcm_verified else None,
        derivative_pcm_bytes=deriv_bytes if pcm_verified else None,
        warnings=warnings,
    )


def _camel(key: str) -> str:
    head, *rest = key.split("_")
    return head + "".join(part.capitalize() for part in rest)


def outcome_to_dict(outcome: InspectionOutcome) -> dict:
    """Serialize with the camelCase keys of the documented v1 worker contract."""
    return {_camel(k): v for k, v in asdict(outcome).items()}

