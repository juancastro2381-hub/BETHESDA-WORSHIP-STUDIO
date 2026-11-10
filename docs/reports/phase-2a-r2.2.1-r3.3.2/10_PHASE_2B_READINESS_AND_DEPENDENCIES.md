# 10 — PHASE 2B READINESS AND DEPENDENCY ASSESSMENT
## Bethesda Worship Studio — Architectural Briefing for Future Phases

> [!IMPORTANT]
> **GOVERNANCE NOTICE:**
> This document represents an architectural readiness assessment and scoping specification ONLY.
> **No implementation of Phase 2B has been authorized or performed in this cycle.**
> Development of Phase 2B may commence only following formal sign-off of Phase 2A by independent audit.

---

### 1. Scope of Phase 2B (Derived from Authoritative Project Documentation)
According to the Bethesda Worship Studio product roadmap:
- **Phase 2A (Completed & Certified Candidate):** Native digital music ingestion (`MusicXML`, `ChordPro`, direct transposition, lyrics extraction, background job queueing, leases, transactional catalog commitment).
- **Phase 2B (Future Phase):** Advanced multimodal musical ingestion:
  1. Optical Music Recognition (OMR) pipeline for sheet music images and PDF scores (e.g., Audiveris / specialized OMR inference engines).
  2. Audio stem separation (e.g., Demucs / Spleeter) to isolate vocals, bass, drums, and harmonic accompaniment.
  3. Polyphonic and monophonic pitch tracking (e.g., Basic Pitch, crepe) for melodic transcription.
  4. Automatic lyric alignment and speech-to-text with timestamps (e.g., WhisperX).
  5. Multi-track score assembly and confidence scoring with human-in-the-loop review.

---

### 2. Dependencies on Phase 2A Conversion and Storage Infrastructure
Phase 2B relies directly on the solid distributed foundation established in Phase 2A:
1. **Durable Asynchronous Job Engine:**
   Heavyweight audio/OMR processing cannot run inside HTTP request threads. It will use the `background_jobs` PostgreSQL schema, pg-boss queuing, distributed leases (`lease_expires_at`), heartbeat renewals (`heartbeat()`), and atomic terminal updates.
2. **Deterministic Storage Engine:**
   `ISourceStorageProvider` and `LocalFileSystemSourceStorageProvider` manage tenant-isolated directories (`workspaceId/jobId/`). Audio stems, score crops, and intermediate transcription JSON artifacts will be persisted and protected by existing path-traversal prevention and storage reconciliation.
3. **Graceful Worker Lifecycle:**
   Long-running ML inference jobs (which may take 15–120 seconds) require bounded graceful drain deadlines, fencing tokens to prevent zombie worker overwrites, and idempotent catalog commitment.

---

### 3. Security and Tenant Isolation Implications
1. **Audio and Image File Ingestion:**
   Incoming audio files (WAV, MP3, FLAC) and score images (PNG, TIFF, PDF) are untrusted binary inputs. Strict magic-number sniffing, decompressor bomb guards (zip bomb / image pixel dimension limits), and anti-traversal path resolution must be enforced.
2. **Anti-IDOR and Tenant Isolation:**
   All intermediate ML outputs and committed songs must remain strictly bound to `workspaceId` and `userId`. A user in Church A must never access stems or transcription artifacts belonging to Church B.
3. **Execution Sandboxing:**
   AI inference subprocesses (Python runtimes, ONNX models, Torch inference) must run within isolated, unprivileged container boundaries with restricted network access.

---

### 4. Infrastructure, Resource and Scalability Requirements
1. **Compute Resources:**
   - Audio stem separation (Demucs) and transcription (WhisperX / Basic Pitch) are compute-heavy. CPU inference will require multiple cores (e.g. 4–8 vCPUs) or GPU acceleration (NVIDIA CUDA / TensorRT).
   - OMR requires significant memory (2–4 GB per Audiveris worker).
2. **Separate Worker Pool:**
   ML tasks must be isolated onto a dedicated queue (e.g., `bethesda-ai-audio-transcription`) to prevent heavy audio processing from starving fast MusicXML/ChordPro transpilation jobs.
3. **Lease Timers and Timeouts:**
   Default conversion lease timeout (60s) must be parameterized: ML jobs will require 300–600s lease durations with continuous heartbeat renewal.

---

### 5. Licensing and Model Weight Considerations
1. **Model Licensing Compliance:**
   - Demucs (MIT / Creative Commons depending on variant).
   - Basic Pitch (Apache 2.0 - Spotify).
   - Whisper / WhisperX (MIT / BSD).
   - Audiveris (AGPL v3 - requires architectural isolation via network/IPC boundary to avoid license contamination of Bethesda proprietary core).
2. **Weight Storage and Versioning:**
   Pre-trained model weights (~500MB to 3GB) must be cached locally or on fast blob storage, with cryptographic SHA-256 integrity verification upon container boot.

---

### 6. Zero-Fabrication and Commercial Policy Constraints
1. **Musical Zero-Fabrication Contract:**
   AI transcription must produce explicit confidence scores. Ambiguous notes or chords must be flagged for human worship-leader review rather than hallucinating plausible harmonies.
2. **Zero Paywalls or Paid Restrictions:**
   Bethesda Worship Studio must remain free for legitimate church worship teams. Phase 2B will NOT introduce pay-per-song, credit balances, or subscription gates.

---

### 7. Implementation Roadmap & Prerequisites
Development of Phase 2B will proceed only after:
1. Formal independent approval of Phase 2A-R2.2.1-R3.3.2.
2. Explicit engineering authorization.
3. Deployment of the containerized ML inference sidecar / worker pool.
4. Definition of test datasets with gold-standard musical ground truths (MIDI, MusicXML) for empirical accuracy benchmarking.

