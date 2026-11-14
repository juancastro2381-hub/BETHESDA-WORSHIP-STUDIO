"""Worker v1 contract + signature + integrity tests (offline, no network, no browser)."""

from __future__ import annotations

import hashlib
import json
import subprocess
import sys
from pathlib import Path

import pytest

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
sys.path.insert(0, str(HERE))

from fixtures import real_mp3_via_ffmpeg, synth_id3v2, synth_mp3_frames, synth_wav  # noqa: E402
from signature_inspector import inspect_audio_signature  # noqa: E402

MAIN = HERE.parent / "main.py"


def run_worker(request: dict) -> list[dict]:
    proc = subprocess.run(
        [sys.executable, str(MAIN)], input=json.dumps(request), capture_output=True, text=True, timeout=90
    )
    return [json.loads(line) for line in proc.stdout.splitlines() if line.strip()]


def test_mp3_with_id3_detected():
    data = synth_id3v2() + synth_mp3_frames()
    r = inspect_audio_signature(data)
    assert r.valid and r.detected_format == "MP3" and r.has_id3v2
    assert r.sample_rate_hz == 44100 and r.bitrate_kbps == 128


def test_mp3_without_id3_detected():
    r = inspect_audio_signature(synth_mp3_frames())
    assert r.valid and r.detected_format == "MP3" and not r.has_id3v2 and r.mpeg_frame_offset == 0


def test_id3_header_alone_or_text_is_rejected():
    assert not inspect_audio_signature(synth_id3v2() + b"<html>not audio</html>" * 10).valid
    assert not inspect_audio_signature(b"ID3 this is just text pretending to be mp3").valid
    assert not inspect_audio_signature(b"<html><body>404</body></html>").valid
    assert not inspect_audio_signature(b"MZ\x90\x00\x03\x00\x00\x00" + b"\x00" * 64).valid


def test_wav_detected():
    r = inspect_audio_signature(synth_wav(0.2))
    assert r.valid and r.detected_format == "WAV" and r.sample_rate_hz == 22050 and r.channels == 1


def test_ping_contract():
    out = run_worker({"contractVersion": "1.0", "jobId": "j1", "command": "PING"})
    assert out[-1]["type"] == "RESULT" and out[-1]["data"]["status"] == "READY"


def test_invalid_contract_version_rejected():
    out = run_worker({"contractVersion": "9.9", "jobId": "j1", "command": "PING"})
    assert out[-1]["type"] == "ERROR" and out[-1]["errorCode"] == "INVALID_WORKER_REQUEST"


def test_real_mp3_with_id3_end_to_end_and_source_unchanged(tmp_path: Path):
    mp3 = tmp_path / "tone.mp3"
    data = real_mp3_via_ffmpeg(mp3, 2.0, with_id3=True)
    assert data[:3] == b"ID3"
    sha = hashlib.sha256(data).hexdigest()
    out = run_worker({
        "contractVersion": "1.0", "jobId": "j2", "command": "INSPECT_AND_VERIFY_AUDIO",
        "sourcePath": str(mp3), "expectedSha256": sha,
    })
    res = out[-1]
    assert res["type"] == "RESULT", res
    d = res["data"]
    assert d["detectedFormat"] == "MP3" and d["hasId3v2"] is True and d["pcmDecodeVerified"] is True
    assert d["verifiedSha256"] == sha
    assert abs(d["durationMs"] - 2000) < 150
    assert hashlib.sha256(mp3.read_bytes()).hexdigest() == sha  # original never modified
    assert [m["type"] for m in out].count("PROGRESS") >= 3


def test_real_mp3_without_id3_end_to_end(tmp_path: Path):
    mp3 = tmp_path / "noid3.mp3"
    data = real_mp3_via_ffmpeg(mp3, 1.5, with_id3=False)
    assert data[:3] != b"ID3"
    sha = hashlib.sha256(data).hexdigest()
    out = run_worker({
        "contractVersion": "1.0", "jobId": "j3", "command": "INSPECT_AND_VERIFY_AUDIO",
        "sourcePath": str(mp3), "expectedSha256": sha,
    })
    assert out[-1]["type"] == "RESULT", out[-1]
    assert out[-1]["data"]["hasId3v2"] is False and out[-1]["data"]["detectedFormat"] == "MP3"


def test_sha_mismatch_rejected(tmp_path: Path):
    wav = tmp_path / "a.wav"
    wav.write_bytes(synth_wav(0.2))
    out = run_worker({
        "contractVersion": "1.0", "jobId": "j4", "command": "INSPECT_AND_VERIFY_AUDIO",
        "sourcePath": str(wav), "expectedSha256": "0" * 64,
    })
    assert out[-1]["type"] == "ERROR" and out[-1]["errorCode"] == "AUDIO_VALIDATION_FAILED"
    assert "mismatch" in out[-1]["message"].lower()


def test_undecodable_synthetic_mp3_is_not_false_success(tmp_path: Path):
    # Structurally valid headers but truncated garbage: must never be reported as a healthy result.
    p = tmp_path / "bad.mp3"
    data = synth_mp3_frames(3)
    p.write_bytes(data)
    out = run_worker({
        "contractVersion": "1.0", "jobId": "j5", "command": "INSPECT_AND_VERIFY_AUDIO",
        "sourcePath": str(p), "expectedSha256": hashlib.sha256(data).hexdigest(),
    })
    last = out[-1]
    assert last["type"] in ("RESULT", "ERROR")
    if last["type"] == "RESULT":
        assert last["data"]["pcmDecodeVerified"] is True  # only acceptable if ffmpeg truly decoded it
    else:
        assert last["errorCode"] in ("AUDIO_DECODE_FAILED", "DECODER_UNAVAILABLE")


def test_missing_source_file(tmp_path: Path):
    out = run_worker({
        "contractVersion": "1.0", "jobId": "j6", "command": "INSPECT_AND_VERIFY_AUDIO",
        "sourcePath": str(tmp_path / "nope.mp3"), "expectedSha256": "0" * 64,
    })
    assert out[-1]["errorCode"] == "SOURCE_FILE_NOT_FOUND"

