# WORSHIP STUDIO — PHASE 1B-R
## SYSTEM LIMITATIONS, BOUNDARIES & ROADMAP DEPENDENCY AUDIT

**Project:** Bethesda Worship Studio  
**Working Branch:** `feature/phase-1a-core-foundation`  
**Phase:** 1B-R — Remediation Only  
**Author:** Antigravity (Principal Systems Architect)  
**Date:** 2026-11-05  

---

## 1. SCOPE BOUNDARIES & INTENTIONAL EXCLUSIONS

In strict accordance with the Product Owner Executive Directive for Phase 1B-R:
- **Zero Phase 1C Features Implemented:**
  1. **No Neural OMR Engine:** No ML models (Audiveris, Calamari, Oemer, or custom ONNX) were introduced. Visual PDF/Image score ingestion strictly preserves original bytes and truthfully returns `RECOGNITION_UNAVAILABLE`.
  2. **No Audio Ingestion Inferences:** No stem separation (Demucs), monophonic/polyphonic transcription (Basic Pitch, CREPE), or lyrics alignment (WhisperX) were added. Audio files are validated, hashed, stored, and reported as `RECOGNITION_UNAVAILABLE`.
  3. **No Distributed Cloud Infrastructure:** `@aws-sdk/client-s3` and Cloudflare R2 integrations remain uninstalled. Storage is managed by `LocalFileSystemSourceStorageProvider` on isolated local disks.
  4. **No External Message Broker:** Redis, BullMQ, or RabbitMQ were not added. The transactional `background_jobs` PostgreSQL table remains the reliable source of truth for job tracking.

---

## 2. KNOWN SYSTEM LIMITATIONS

### 2.1 Optical Music Recognition (OMR) Status
- While visual score file signatures (`%PDF-`, PNG, JPEG, TIFF, WEBP) are strictly verified against MIME spoofing and original files are immutably stored with SHA-256 digests, automated extraction of musical staves, clefs, key signatures, and notes requires the neural OMR pipeline scheduled for Phase 1C.
- PDF text layers containing ChordPro or chord lyrics (e.g. Lead Sheets) are parsed by `PdfTextExtractor`, whereas scanned graphical sheets are safely stored as visual references awaiting manual annotation or Phase 1C inference.

### 2.2 Audio Processing Status
- Legitimate audio files (`WAV`, `MP3`, `FLAC`, `M4A`) are verified via binary magic bytes and preserved with SHA-256 digests.
- Automatic transcription of melody, harmony, or tempo from audio waveforms is intentionally deferred to Phase 1C. Zero dummy notes, chords, or BPM values are invented.

### 2.3 Complex Microtonal & Tuplet Quantization in MIDI
- Standard MIDI quantizer normalizes divisions to 480 TPQN. Common musical tuplets (triplets: 3 in the space of 2) are mapped accurately to 160 or 320 ticks.
- Exotic irrational tuplets (e.g. 11-tuplets, 13-tuplets) or continuous pitch-bend microtonality are quantized to the nearest integer tick. Pitch bend messages are not currently stored in `CanonicalMusicPayload` notes.

### 2.4 External Video URLs
- In strict adherence to platform Terms of Service and DRM protections, video ingestion does not perform unauthorized stream scraping or audio extraction.
- A video URL is registered with status `REGISTERED` as an external reference (`videoId`, `platform`, `videoUrl`). Transcription requires direct upload of the authorized audio/video file.

---

## 3. PREREQUISITES FOR PHASE 1C AUTHORIZATION

Before the Product Owner authorizes Phase 1C (Advanced Neural OMR, Audio AI Pipelines & Cloudflare R2), the following milestones must be confirmed:
1. Complete Product Owner review and acceptance of Phase 1B-R reports.
2. Verification that all 596 tests in the regression suite pass unconditionally.
3. Formal approval of cloud infrastructure budget for GPU inference workers (OMR/Demucs/Basic Pitch).
4. S3/R2 storage credentials and IAM least-privilege policies configured in environment.

