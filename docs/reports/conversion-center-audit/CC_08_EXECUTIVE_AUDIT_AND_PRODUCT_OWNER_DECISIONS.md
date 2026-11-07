# CC_08: EXECUTIVE AUDIT AND PRODUCT OWNER DECISIONS
## BETHESDA WORSHIP STUDIO — CONVERSION CENTER TECHNICAL AUDIT

- **Project:** Bethesda Worship Studio
- **Document ID:** `CC-08-EXECUTIVE-AUDIT-AND-PRODUCT-OWNER-DECISIONS`
- **Audit Date:** November 2026
- **Status:** Complete Executive Synthesis & Decision Framework
- **Repository Branch:** `feature/phase-1a-core-foundation`
- **Base Commit:** `51fef932b082df82bd31d643983a271c155eb4e2`
- **Execution Mode:** Read-Only Audit & Strategic Decision Document

---

## 1. Executive Summary & Audit Conclusions

An independent, evidence-based technical audit of the Bethesda Worship Studio repository was performed to evaluate the current capabilities and architectural readiness for a comprehensive **Musical File Conversion Center** (`Centro de Conversión Musical`).

### Key Audit Findings:
1. **Core Ingestion & Musical Integrity (Phases 1A & 1B-R) Are Highly Solid:**
   - Ingestion of structured files (MusicXML 4.0 and ChordPro) is fully deterministic, mathematically normalized to 480 TPQN, covered by rigorous automated tests, and strictly compliant with zero-fabrication principles (no invented notes, tempos, or keys).
   - Ingestion of raw sources (MIDI, audio, visual scores, video URLs) correctly preserves physical files in `song_sources` with SHA-256 digests and magic byte inspection before parsing.
2. **The "Conversion Center" Gap Is Real and Substantial:**
   - There is currently **no integrated Conversion Center module** in the application.
   - The platform can *read* MusicXML and ChordPro, but it cannot *export* back to MusicXML, MIDI, or printable engraved PDF scores (zero outbound serializers exist from `CanonicalMusicPayload`).
   - The current PDF conversion dialog (`DocumentConversionModal.tsx`) is exclusively a regex-based heuristic extractor for text cancioneros (chord-over-text lines). It does **not** perform Optical Music Recognition (OMR) on musical staves, clefs, or notes.
   - Optical Music Recognition (OMR), Audio-to-MIDI transcription, Audio chord recognition, and Audio stem separation are currently **stubbed, mocked, or non-existent** at runtime.
   - There is no background worker daemon processing the existing `background_jobs` table asynchronously.
3. **Feasibility of a Permanently Free Architecture:**
   - A 100% self-hosted, permanently free conversion center is **fully feasible** using modern open-source engines (Spotify Basic Pitch, Whisper.cpp, Madmom, Audiveris, Verovio, FFmpeg).
   - Standard, modest server hardware (4–8 vCPU, 8–16 GB RAM, \$25–\$50/month) is sufficient to handle thousands of monthly conversions with zero recurring third-party API fees.

---

## 2. Summary of the Eight Audit Deliverables

The complete technical findings, matrices, and architectural specifications have been delivered in the `docs/reports/conversion-center-audit/` directory:

| Document Reference | Title | Scope & Content |
| :--- | :--- | :--- |
| [`CC_01_CURRENT_CAPABILITIES_INVENTORY.md`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/docs/reports/conversion-center-audit/CC_01_CURRENT_CAPABILITIES_INVENTORY.md) | Current Capabilities Inventory | Granular, file-by-file audit of existing ingestion, parsing, rendering, and export components with exact line references. |
| [`CC_02_FORMAT_SUPPORT_MATRIX.md`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/docs/reports/conversion-center-audit/CC_02_FORMAT_SUPPORT_MATRIX.md) | Format Support Matrix | Master $N \times M$ input-output conversion matrix covering 5 input categories and 8 target formats with feasibility and zero-fabrication gates. |
| [`CC_03_ENGINE_AND_LICENSE_EVALUATION.md`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/docs/reports/conversion-center-audit/CC_03_ENGINE_AND_LICENSE_EVALUATION.md) | Engine & License Evaluation | Exhaustive evaluation of candidate engines (Basic Pitch, Madmom, Whisper.cpp, Demucs, Audiveris, Verovio), compute profiles, and strict licensing boundaries (MIT/Apache vs GPLv3 vs AGPL). |
| [`CC_04_TARGET_ARCHITECTURE.md`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/docs/reports/conversion-center-audit/CC_04_TARGET_ARCHITECTURE.md) | Target Architecture | Comprehensive system architecture: Hub-and-Spoke model centered on `CanonicalMusicPayload`, Node.js API Gateway, containerized worker sidecars, and state lifecycle diagrams. |
| [`CC_05_UI_UX_CONVERSION_CENTER.md`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/docs/reports/conversion-center-audit/CC_05_UI_UX_CONVERSION_CENTER.md) | UI/UX Specification | Complete 6-stage user workflow, visual wireframes, dynamic format matrix, real-time SSE progress card, side-by-side human-in-the-loop review studio, and accessibility standards. |
| [`CC_06_SECURITY_SCALABILITY_AND_COST.md`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/docs/reports/conversion-center-audit/CC_06_SECURITY_SCALABILITY_AND_COST.md) | Security, Scalability & Cost | Threat modeling (MIME spoofing, zip bombs, SSRF, DoS), container hardening (`cap-drop=ALL`), pg-boss queue concurrency limits, storage lifecycle, and \$30/mo zero-API-fee hosting budget. |
| [`CC_07_IMPLEMENTATION_ROADMAP.md`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/docs/reports/conversion-center-audit/CC_07_IMPLEMENTATION_ROADMAP.md) | Implementation Roadmap | Phased 5-milestone engineering schedule (Phases 2A through 2E) spanning 12 weeks, with detailed deliverables, acceptance criteria, test strategies, and risk mitigations. |
| [`CC_08_EXECUTIVE_AUDIT_AND_PRODUCT_OWNER_DECISIONS.md`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/docs/reports/conversion-center-audit/CC_08_EXECUTIVE_AUDIT_AND_PRODUCT_OWNER_DECISIONS.md) | Executive Synthesis & Decisions | High-level synthesis, status of repository, and 5 foundational architectural decisions requiring Product Owner confirmation. |

---

## 3. Product Owner Architectural Decision Framework

The implementation of the Conversion Center hinges on **five strategic technical decisions**. The engineering recommendations are presented below for formal Product Owner approval:

---

### Decision 1: Background Queue & Job Runner Engine
- **Option 1A (RECOMMENDED): PostgreSQL-Native `pg-boss`**
  - *Rationale:* Operates directly inside the existing PostgreSQL 16 database. Requires **zero new containers or infrastructure** (no Redis to manage, monitor, or backup). Provides 100% ACID transactional atomicity between job registration and source persistence. Easily handles 500–1,000 conversions/sec.
- **Option 1B: Redis + BullMQ**
  - *Rationale:* Adds a mandatory Redis server. Higher raw throughput (>10k jobs/sec), but introduces dual-database operational complexity and non-atomic cross-store writes.
- **Engineering Recommendation:** **Approve Option 1A (`pg-boss`).**

---

### Decision 2: Machine Learning & MIR Worker Runtime Topology
- **Option 2A (RECOMMENDED): Python 3.11 / FastAPI Container Sidecar (`bethesda-ml-worker`)**
  - *Rationale:* Isolates Spotify Basic Pitch (ONNX), Madmom (audio chord recognition), Whisper.cpp (lyric transcription), and FFmpeg inside an unprivileged Docker sidecar. Communicates with Node.js via lightweight local HTTP REST/JSON. Keeps the main Node.js process lean and crash-proof.
- **Option 2B: In-Process Node.js ONNX Runtime (`onnxruntime-node`)**
  - *Rationale:* Eliminates the sidecar container, but severely limits audio capabilities: Madmom, FFmpeg transcode pipelines, and robust DSP libraries cannot run cleanly inside pure Node.js.
- **Engineering Recommendation:** **Approve Option 2A (Python Sidecar Container).**

---

### Decision 3: Optical Music Recognition (OMR) Engine & Legal Strategy
- **Option 3A (RECOMMENDED): Audiveris v5.3+ (Java 17 Headless) in Isolated Container**
  - *Rationale:* Audiveris is the most complete, mature open-source OMR engine, generating high-fidelity MusicXML from complex multi-system scores.
  - *Legal Protection:* Licensed under **GPLv3**. Contamination is strictly prevented by packaging Audiveris inside a dedicated Docker microservice (`bethesda-omr-worker`) invoked across an HTTP/CLI network boundary. No Java code or GPL headers are ever linked into Node.js.
- **Option 3B: Deep Learning Python OMR (`oemer` / MIT License)**
  - *Rationale:* Permissive MIT license, but recognition on dense multi-voice worship scores and hymn layouts is less deterministic and requires higher GPU/RAM resources.
- **Engineering Recommendation:** **Approve Option 3A (Audiveris in Isolated Container).**

---

### Decision 4: Compute Profile & Hardware Sizing for Audio Transcription
- **Option 4A (RECOMMENDED): CPU-Only Inference via Quantized Models**
  - *Rationale:* Whisper.cpp (quantized `base`/`small` models) and Basic Pitch ONNX execute in 15–30 seconds on a standard 4-vCPU cloud server using < 1 GB of RAM. The server costs **\$25–\$40/month**, maintaining the platform as permanently free with zero variable costs.
- **Option 4B: Cloud GPU Acceleration (NVIDIA T4 / A10G)**
  - *Rationale:* Reduces audio transcription to 3–5 seconds, but increases monthly hosting costs to **\$150–\$300+/month**, creating an unsustainable financial burden for a free ministry platform.
- **Engineering Recommendation:** **Approve Option 4A (CPU-Only Quantized Inference).**

---

### Decision 5: Engineering Phasing & Sequencing Strategy
- **Option 5A (RECOMMENDED): Phased 5-Milestone Delivery (Phases 2A -> 2E)**
  - *Milestone 1 (Phase 2A):* Foundational Outbound Exporters (MusicXML, MIDI, ChordPro serializers).
  - *Milestone 2 (Phase 2B):* Conversion Center UI Hub & Synchronous Transpile API.
  - *Milestone 3 (Phase 2C):* Asynchronous pg-boss Queue & SSE Progress Streaming.
  - *Milestone 4 (Phase 2D):* Audio & Video Ingestion Engines (Basic Pitch, Whisper.cpp, FFmpeg).
  - *Milestone 5 (Phase 2E):* Optical Music Recognition Engine (Audiveris Sidecar).
  - *Benefit:* Delivers immediate value in Weeks 1–4 (file export and synchronous conversions) while de-risking complex ML/OMR pipelines.
- **Option 5B: Monolithic Single-Phase Delivery**
  - *Risk:* High complexity and long delivery cycle before any conversion capability reaches musicians.
- **Engineering Recommendation:** **Approve Option 5A (Phased 5-Milestone Sequence).**

---

## 4. Execution Governance & Invariants

During this audit:
- **ZERO application source code, configuration files, or database schemas were modified.**
- **ZERO Git mutations (commit, push, merge, rebase, tag, reset) were executed.**
- **Working Tree Status:** Clean, perfectly synchronized with `origin/feature/phase-1a-core-foundation` at commit `51fef932b082df82bd31d643983a271c155eb4e2`.
- All eight reports are stored under `docs/reports/conversion-center-audit/`.

---

## 5. Next Step

Antigravity awaits explicit Product Owner instructions on the five architectural decisions outlined in Section 3 before commencing Milestone 1 (Phase 2A: Foundational Outbound Exporters).

