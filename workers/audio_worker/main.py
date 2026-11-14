"""Versioned v1 local Python audio worker entrypoint (WS-AUDIO-01).

Protocol (IPC over stdin/stdout JSON lines):
Input JSON object:
{
  "contractVersion": "1.0",
  "jobId": "<uuid>",
  "command": "PING" | "INSPECT_AND_VERIFY_AUDIO",
  "sourcePath": "/abs/path/to/immutable/source.mp3",
  "expectedSha256": "<hex>",
  "derivativeWavPath": "/abs/path/to/isolated/derivative.wav"  // optional
}

Emitted JSON lines on stdout:
  {"type": "PROGRESS", "contractVersion": "1.0", "jobId": "...", "progress": 40, "stage": "..."}
  {"type": "RESULT",   "contractVersion": "1.0", "jobId": "...", "data": {...}}
  {"type": "ERROR",    "contractVersion": "1.0", "jobId": "...", "errorCode": "...", "message": "..."}

Never logs raw audio content, credentials, or sensitive strings.
"""

from __future__ import annotations

import json
import platform
import re
import sys
from pathlib import Path
from typing import Literal, Optional

from pydantic import BaseModel, Field, ValidationError

# Ensure sibling imports resolve cleanly regardless of cwd
_HERE = Path(__file__).resolve().parent
if str(_HERE) not in sys.path:
    sys.path.insert(0, str(_HERE))

from audio_inspector import inspect_and_verify_audio_file, outcome_to_dict

_SHA256_HEX_RE = re.compile(r"^[0-9a-fA-F]{64}$")
_DISALLOWED_URI_PREFIX_RE = re.compile(
    r"^(?:https?|ftps?|sftp|rtmps?|rtsp|tcp|udp|tls|file|pipe|concat|subfile|data|crypto):",
    re.IGNORECASE,
)


def _validate_local_path_string(raw_path: str, field_name: str) -> Path:
    if "\x00" in raw_path:
        raise ValueError(f"{field_name} contains a null byte.")
    stripped = raw_path.strip()
    if not stripped:
        raise ValueError(f"{field_name} must not be empty.")
    if _DISALLOWED_URI_PREFIX_RE.match(stripped):
        raise ValueError(f"{field_name} must be a local filesystem path, not a URI or protocol stream.")
    return Path(stripped)


class WorkerRequest(BaseModel):
    contractVersion: Literal["1.0"]
    jobId: str = Field(min_length=1, max_length=128)
    command: Literal["PING", "INSPECT_AND_VERIFY_AUDIO"]
    sourcePath: Optional[str] = None
    expectedSha256: Optional[str] = None
    derivativeWavPath: Optional[str] = None


def _emit(payload: dict) -> None:
    sys.stdout.write(json.dumps(payload, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def handle_request_json(raw_json: str) -> int:
    job_id = "unknown"
    try:
        raw_obj = json.loads(raw_json)
        req = WorkerRequest.model_validate(raw_obj)
        job_id = req.jobId
    except (json.JSONDecodeError, ValidationError) as exc:
        _emit({
            "type": "ERROR",
            "contractVersion": "1.0",
            "jobId": job_id,
            "errorCode": "INVALID_WORKER_REQUEST",
            "message": f"Invalid v1 worker request: {exc}",
        })
        return 2

    if req.command == "PING":
        _emit({
            "type": "RESULT",
            "contractVersion": "1.0",
            "jobId": req.jobId,
            "data": {
                "status": "READY",
                "workerVersion": "0.1.0",
                "pythonVersion": platform.python_version(),
            },
        })
        return 0

    if not req.sourcePath or not req.expectedSha256:
        _emit({
            "type": "ERROR",
            "contractVersion": "1.0",
            "jobId": req.jobId,
            "errorCode": "MISSING_REQUIRED_FIELDS",
            "message": "sourcePath and expectedSha256 are required for INSPECT_AND_VERIFY_AUDIO.",
        })
        return 2

    if not _SHA256_HEX_RE.match(req.expectedSha256):
        _emit({
            "type": "ERROR",
            "contractVersion": "1.0",
            "jobId": req.jobId,
            "errorCode": "INVALID_ARGUMENT",
            "message": "expectedSha256 must be a 64-character hexadecimal SHA-256 digest.",
        })
        return 2

    try:
        source_path = _validate_local_path_string(req.sourcePath, "sourcePath")
        derivative_path = (
            _validate_local_path_string(req.derivativeWavPath, "derivativeWavPath")
            if req.derivativeWavPath is not None
            else None
        )
        if derivative_path is not None and derivative_path.resolve() == source_path.resolve():
            raise ValueError("derivativeWavPath must not resolve to the immutable sourcePath.")
    except ValueError as exc:
        _emit({
            "type": "ERROR",
            "contractVersion": "1.0",
            "jobId": req.jobId,
            "errorCode": "INVALID_ARGUMENT",
            "message": str(exc),
        })
        return 2

    def on_progress(pct: int, stage: str) -> None:
        _emit({
            "type": "PROGRESS",
            "contractVersion": "1.0",
            "jobId": req.jobId,
            "progress": pct,
            "stage": stage,
        })

    try:
        outcome = inspect_and_verify_audio_file(
            source_path=source_path,
            expected_sha256=req.expectedSha256,
            derivative_wav_path=derivative_path,
            emit_progress=on_progress,
        )
        result_dict = outcome_to_dict(outcome)
        result_dict["pythonVersion"] = platform.python_version()
        if not outcome.pcm_decode_verified:
            # No false success: a file whose audio cannot actually be decoded is NOT reported as healthy.
            infra = outcome.decoder_used == "native-header-only"
            _emit({
                "type": "ERROR",
                "contractVersion": "1.0",
                "jobId": req.jobId,
                "errorCode": "DECODER_UNAVAILABLE" if infra else "AUDIO_DECODE_FAILED",
                "message": "; ".join(outcome.warnings) or "Audio could not be decoded to PCM.",
                "details": result_dict,
            })
            return 1
        _emit({
            "type": "RESULT",
            "contractVersion": "1.0",
            "jobId": req.jobId,
            "data": result_dict,
        })
        return 0
    except FileNotFoundError as exc:
        _emit({
            "type": "ERROR",
            "contractVersion": "1.0",
            "jobId": req.jobId,
            "errorCode": "SOURCE_FILE_NOT_FOUND",
            "message": str(exc),
        })
        return 1
    except ValueError as exc:
        _emit({
            "type": "ERROR",
            "contractVersion": "1.0",
            "jobId": req.jobId,
            "errorCode": "AUDIO_VALIDATION_FAILED",
            "message": str(exc),
        })
        return 1
    except Exception as exc:
        _emit({
            "type": "ERROR",
            "contractVersion": "1.0",
            "jobId": req.jobId,
            "errorCode": "WORKER_INTERNAL_ERROR",
            "message": f"Unexpected audio worker error: {type(exc).__name__}: {exc}",
        })
        return 1


def main() -> int:
    line = sys.stdin.readline()
    if not line:
        return 0
    return handle_request_json(line)


if __name__ == "__main__":
    raise SystemExit(main())

