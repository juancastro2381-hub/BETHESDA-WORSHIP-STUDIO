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
import sys
from pathlib import Path
from typing import Literal, Optional

from pydantic import BaseModel, Field, ValidationError

# Ensure sibling imports resolve cleanly regardless of cwd
_HERE = Path(__file__).resolve().parent
if str(_HERE) not in sys.path:
    sys.path.insert(0, str(_HERE))

from audio_inspector import inspect_and_verify_audio_file, outcome_to_dict


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

    def on_progress(pct: int, stage: str) -> None:
        _emit({
            "type": "PROGRESS",
            "contractVersion": "1.0",
            "jobId": req.jobId,
            "progress": pct,
            "stage": stage,
        })

    try:
        derivative_path = Path(req.derivativeWavPath) if req.derivativeWavPath else None
        outcome = inspect_and_verify_audio_file(
            source_path=Path(req.sourcePath),
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

