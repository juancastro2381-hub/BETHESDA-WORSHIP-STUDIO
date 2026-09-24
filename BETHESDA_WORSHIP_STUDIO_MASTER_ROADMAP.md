# BETHESDA WORSHIP STUDIO — MASTER ROADMAP RECONCILIATION
## Complete Architectural Audit, Capability Inventory, and Phased Future Roadmap

**Organization:** Iglesia Cristiana Bethesda — Madrid, Cundinamarca, Colombia  
**Document Classification:** Architectural Baseline & Strategic Master Roadmap  
**Date:** September 21, 2026  
**Author:** Lead Software Architect & Technical Program Manager  
**Status:** RECONCILED — CURRENT BASELINE VERIFIED (FUTURE IMPLEMENTATION NOT AUTHORIZED)  
**Deliverable Path:** `BETHESDA_WORSHIP_STUDIO_MASTER_ROADMAP.md` (and synchronized `docs/BETHESDA_WORSHIP_STUDIO_MASTER_ROADMAP.md`)  

---

## 1. Executive Summary

The **Bethesda Worship Studio** is a mission-critical digital musicology, notation, rehearsal, and stage management platform tailored for contemporary Christian worship ministries. The platform combines mathematically exact musical theory, multi-track polyphonic notation, dynamic chord transposition, lyric-syllable synchronization, setlist orchestration, and liturgical atril (music stand) execution.

This document represents the definitive **Master Roadmap Reconciliation** of the project. It conducts an exhaustive forensic audit of the actual codebase, historical engineering reports, and foundational architectural blueprints (`docs/01` through `docs/07`) to eliminate all ambiguity regarding:
1. **What has actually been implemented and verified** in the production codebase.
2. **What was specified in early architecture but remains unimplemented or partially implemented.**
3. **The formal closure of Phase 2C**, reconciling historical planning artifacts (including the administrative WS8 exit gate) with actual execution evidence.
4. **The comprehensive inventory of future capabilities** across stage execution, rehearsal, real-time synchronization, advanced notation editing, AI-assisted ingestion, and multi-tenant operations.
5. **The proposed future roadmap and workstream sequencing**, establishing rigorous technical prerequisites and governance quality gates.

### Official Implementation Position
Based strictly on repository evidence, the current verified implementation state is:
- **Phase 0 (Architecture & Specification):** `CLOSED`
- **Phase 1 (Core Music Model, Ingestion, Projection & Workspace):** `CLOSED` (Sub-phases 1A through 1H fully implemented and verified).
- **Phase 2A (Backend & Persistence Foundation):** `CLOSED` (Fastify + PostgreSQL + Drizzle ORM operational).
- **Phase 2B (Authentication, Authorization & RBAC Foundation):** `CLOSED` (JWT, refresh token family rotation, invitations, 5 RBAC roles operational).
- **Phase 2C (Setlist Management & Liturgical Atril Integration):** `CLOSED` (WS1 through WS7 and WS-2C-REMED fully implemented, verified, audited, and formally closed via `PHASE_2C_FORMAL_CLOSURE_REPORT.md` satisfying 19/19 closure criteria).
- **No Open Phase 2C Functional Defects:** All findings (`GAP-01`, `GAP-02`, `GAP-03`) were remediated, tested, and verified.
- **Current Test Baseline:** **460 / 460 tests PASSING** (Backend: 192 / 192, Frontend: 268 / 268), **0 TypeScript errors**, **0 regressions**.
- **Future Workstreams (Phase 3+):** **STRICTLY NOT AUTHORIZED.**

---

## 2. Scope and Methodology

### 2.1 Governance Rules for this Audit
- **Zero Production Modifications:** This task makes zero alterations to backend, frontend, database, migrations, APIs, packages, or tests.
- **Evidence-Based Reconciliation:** Claims of implementation must be substantiated by actual source code files, registered endpoints, active React components, or passing automated test suites.
- **Strict Distinction between Specification and Reality:** Architectural specifications in early design documents (e.g., Python FastAPI, Redis Pub/Sub, WebSockets, OMR) that were adapted or deferred during actual engineering are explicitly identified.

### 2.2 Evidence Classification Framework
Every capability examined across the project is classified into one of six standardized categories:

| Classification | Definition | Criteria |
|:---|:---|:---|
| **1. IMPLEMENTED** | Fully operational and verified. | Production code exists, automated tests pass, and functionality is integrated. |
| **2. IMPLEMENTED WITH LIMITATIONS** | Functionality exists with documented boundaries. | Core feature works, but secondary features or optimizations are explicitly bounded. |
| **3. PARTIALLY IMPLEMENTED** | Components exist, but flow is incomplete. | Some domain models or UI structures exist, but full end-to-end integration is absent. |
| **4. SPECIFIED / NOT IMPLEMENTED** | Fully documented, zero implementation code. | Detailed architectural specification exists, but zero code has been written. |
| **5. CONCEPTUAL / FUTURE** | High-level vision or product idea. | Conceptual outline exists without complete technical or protocol specification. |
| **6. UNDEFINED** | Unspecified or unchartered. | Mentioned informally without formal architectural definition or workstream. |

---

## 3. Source-of-Truth Documents

The following authoritative documents were audited to construct this master reconciliation:

| Document Path | Title & Description | Historical Role |
|:---|:---|:---|
| [`README.md`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/README.md) | Architectural Index & Deliverables Master Summary | Phase 0 Master Index (Deliverables 1–41+) |
| [`docs/01_PRODUCT_VISION_AND_UX.md`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/docs/01_PRODUCT_VISION_AND_UX.md) | Product Vision, User Personas, UX Levels 1–3 | Foundational UX Architecture |
| [`docs/02_MUSIC_DOMAIN_AND_CANONICAL_MODEL.md`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/docs/02_MUSIC_DOMAIN_AND_CANONICAL_MODEL.md) | Canonical Musical Model, Part/Instrument Decoupling | Core Musicology Domain Specification |
| [`docs/03_PERFORMANCE_REHEARSAL_AND_REALTIME.md`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/docs/03_PERFORMANCE_REHEARSAL_AND_REALTIME.md) | Performance View, Rehearsal Metronome, WebSocket Protocol | Live Session & Stage Spec |
| [`docs/04_INGESTION_AND_NOTATION_ENGINE.md`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/docs/04_INGESTION_AND_NOTATION_ENGINE.md) | 7-Way Ingestion, AI Principles, Renderer Comparison | Ingestion & Notation Architecture |
| [`docs/05_DATA_ARCHITECTURE_AND_API.md`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/docs/05_DATA_ARCHITECTURE_AND_API.md) | Relational + JSONB ERD, API Architecture, PWA/Offline | Persistence & Data Architecture |
| [`docs/06_ROADMAP_QUALITY_GATES_AND_ADR.md`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/docs/06_ROADMAP_QUALITY_GATES_AND_ADR.md) | Original 5-Phase Roadmap, ADR-001 to ADR-007 | Early Phased Roadmap & Decisions |
| [`docs/07_PHASE_0_1_ARCHITECTURE_HARDENING.md`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/docs/07_PHASE_0_1_ARCHITECTURE_HARDENING.md) | Phase 0.1 Architecture Hardening & Invariant Freezing | Pre-Implementation Formal Verification |
| [`PHASE_1G_ENGINEERING_REPORT.md`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/PHASE_1G_ENGINEERING_REPORT.md) | Production Musical Workspace & View Orchestration | Phase 1G Completion Report (165 tests) |
| [`PHASE_1H_ENGINEERING_REPORT.md`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/PHASE_1H_ENGINEERING_REPORT.md) | Real Music Ingestion (MusicXML 4.0 & ChordPro) | Phase 1H Completion Report (180 tests) |
| [`PHASE_2A_ENGINEERING_REPORT.md`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/PHASE_2A_ENGINEERING_REPORT.md) | Backend & Persistence Architecture (Fastify + Drizzle) | Phase 2A Completion Report (198 tests) |
| [`PHASE_2B_ENGINEERING_REPORT.md`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/PHASE_2B_ENGINEERING_REPORT.md) | Authentication, Authorization & RBAC Foundation | Phase 2B Completion Report (243 tests) |
| [`PHASE_2C_IMPLEMENTATION_PLAN.md`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/PHASE_2C_IMPLEMENTATION_PLAN.md) | Setlists, Service Moments & Liturgical Flow Plan | Historical Phase 2C Execution Plan (WS1–WS8 planning) |
| [`PHASE_2C_WS4_CONCURRENCY_REMEDIATION_REPORT.md`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/PHASE_2C_WS4_CONCURRENCY_REMEDIATION_REPORT.md) | Remediation of Concurrency TOCTOU on Single Active Setlist | WS4 Concurrency Fix (Partial Unique Index) |
| [`PHASE_2C_WS7_IMPLEMENTATION_REPORT.md`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/PHASE_2C_WS7_IMPLEMENTATION_REPORT.md) | Visual Setlist Components & Liturgical Atril Integration | WS7 Final Report (447 tests, 47 criteria) |
| [`PHASE_2C_FUNCTIONAL_VISUAL_AUDIT.md`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/PHASE_2C_FUNCTIONAL_VISUAL_AUDIT.md) | Read-Only Functional & Visual Audit of Phase 2C | Post-WS7 Audit (GAP-01, GAP-02, GAP-03 identified) |
| [`WS-2C-REMED_IMPLEMENTATION_REPORT.md`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/WS-2C-REMED_IMPLEMENTATION_REPORT.md) | Remediation of Audit Findings & UI Item Authoring | WS-2C-REMED Report (460 tests, 15 criteria) |
| [`PHASE_2C_FORMAL_CLOSURE_REPORT.md`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/PHASE_2C_FORMAL_CLOSURE_REPORT.md) | Formal Governance & Technical Closure Report | Phase 2C Milestone Closure (19/19 criteria PASS) |

---

## 4. Current Project State

### 4.1 Phase 1A–1H: Core Music Model, Projection, Renderers & Ingestion
- **Official Sub-Phases:**
  - **Phase 1A (Music Theory Core):** Circle of Fifths, PitchClass, interval transposition, accidental spelling, and Capo calculation algorithms.
  - **Phase 1B (Canonical Music Model):** `CanonicalMusicPayload`, timeline representations at 480 TPQN, voices, measures, chords, and lyric syllables.
  - **Phase 1C (Musical Ingestion & Normalization):** Parsers for MusicXML and ChordPro formats. Invariant: `totalMelodyNotes === 0` for lyrics/chords.
  - **Phase 1D (Musical Transformation & Projection):** `ProjectionService`, `InstrumentRegistry`, `DerivedMusicalView`, `TablatureCalculator`. Decoupling invariant: *Instrument ≠ View*.
  - **Phase 1E (Rendering Adapter Architecture):** Multi-renderer abstraction layer (`IMusicRenderer`) decoupling React from rendering engines.
  - **Phase 1F (Browser Rendering Integration):** Native DOM lifecycle management (`AlphaTabAdapter`, `OsmdAdapter`, `LeadSheetDomAdapter`), Web Workers, and XSS sanitization.
  - **Phase 1G (Production Musical Workspace):** Production-grade UI workspace orchestrating instrument switching, view transitions, and presentation settings across Golden Scenarios A–D (`PHASE_1G_ENGINEERING_REPORT.md`).
  - **Phase 1H (Real Music Ingestion):** Real-world file upload and drag-and-drop ingestion with XXE protection and structural normalization (`PHASE_1H_ENGINEERING_REPORT.md`).
- **Implementation Status:** `IMPLEMENTED`
- **Known Limitations:**
  - Ingestion is limited to MusicXML (4.0) and ChordPro. MIDI, PDF, OMR, and audio are not yet supported.
  - Musical workspace is currently performance/consumption-oriented; in-place interactive polyphonic notation editing is not implemented.

### 4.2 Phase 2A: Backend & Persistence Foundation
- **Objective:** Establish a high-performance, versioned client-server architecture with PostgreSQL persistence and a Fastify REST API.
- **Architectural Shift from Phase 0:** Phase 0 spec proposed Python FastAPI + SQLAlchemy. Phase 2A formally transitioned to **TypeScript + Fastify + Drizzle ORM**, unifying the entire stack in TypeScript and eliminating cross-language type divergence.
- **Core Entities Implemented:**
  - `songs` (relational metadata, artist, default key, bpm, time signature).
  - `song_versions` (immutable version snapshots with JSONB `canonical_music_payload`).
- **Persistence Pattern:** Hybrid Storage (Option C) storing searchable metadata in relational B-Tree/GIN columns while encapsulating polyphonic notation in validated JSONB snapshots.
- **Implementation Status:** `IMPLEMENTED`
- **Known Limitations:**
  - Single-node architecture; clustering or multi-region replication is not yet configured.
  - File asset storage (e.g. S3/MinIO for raw original files) is deferred; raw payloads reside directly in database columns.

### 4.3 Phase 2B: Authentication, Authorization & RBAC Foundation
- **Objective:** Production-grade security, session management, and role-based access control (RBAC).
- **Security Primitives Implemented:**
  - Passwords hashed via Argon2id (`@node-rs/argon2`).
  - Access tokens: Short-lived JWTs (HS256 only), stored strictly in memory on the frontend.
  - Refresh tokens: Stored in HttpOnly cookies with automatic family rotation and replay-attack revocation.
  - Role System: 5 explicit roles (`SUPER_ADMIN`, `ADMIN`, `WORSHIP_LEADER`, `MUSICIAN`, `VIEWER`) with zero implicit privilege escalation.
  - Rate Limiting: Dual-dimension rate limiting (IP address + account/email).
  - User Invitation Lifecycle: Secure 256-bit token invitation flow with forced password setup.
- **Implementation Status:** `IMPLEMENTED`
- **Known Limitations:**
  - OAuth2/OIDC social logins (Google, Microsoft) are not implemented; authentication is email/password only.
  - Two-Factor Authentication (2FA/MFA via TOTP) is specified conceptually but not implemented.

### 4.4 Phase 2C: Setlist Management, Service Moments & Liturgical Flow (WS1–WS7 & WS-2C-REMED)
- **Objective:** Provide end-to-end service planning, liturgical sequencing, transposition offsets, and atril execution.
- **Workstream Execution:**
  - **WS1 (Persistence):** Schema migration `0002_setlists_and_service_moments.sql` creating `setlists` and polymorphic `setlist_items`.
  - **WS2 (Domain & RBAC):** Zod schemas and domain permission checks (`setlists:create`, `setlists:update`, `setlists:delete`, `setlists:read`).
  - **WS3 (Repository):** `DrizzleSetlistRepository` with atomic SQL reordering transactions and gapless sequence compaction.
  - **WS4 (Application Service & Concurrency Remediation):** `SetlistService` business rules. Identified and resolved a TOCTOU race condition by applying PostgreSQL partial unique index `0003_single_active_setlist_constraint.sql` enforcing that at most ONE setlist is `ACTIVE` per organization at any time.
  - **WS5 (HTTP API):** 10 Fastify endpoints under `/api/v1/setlists` with runtime database guards.
  - **WS6 (Frontend Core):** `BethesdaApiClient` setlist methods, pure harmonic transposition calculator (`calculateTranspositionSemitones`), and `useSetlistExecution` hook.
  - **WS7 (Frontend UI & Atril Integration):** `SetlistsModal`, `SetlistNavigationToolbar` (responsive top desktop / bottom mobile with $\ge 48\text{px}$ touch targets), `ServiceMomentCard` (zero song renderers initialized), and non-blocking in-memory $N+1$ prefetch with safe fallback.
  - **WS-2C-REMED (Remediation of Functional Audit Findings):** `SetlistDetailEditor`, search-as-you-type canonical song combobox, accessible $\ge 48\text{px}$ touch reorder buttons, metadata editing form, and Admin-only deletion with confirmation modal. Resolving `GAP-01`, `GAP-02`, and `GAP-03`.
- **Implementation Status:** `CLOSED` (WS1 through WS7 and WS-2C-REMED complete, verified, and formally closed via `PHASE_2C_FORMAL_CLOSURE_REPORT.md`).

---

## 5. Current Technical Baseline

The latest engineering baseline verified across the repository (as of Phase 2C Formal Closure on September 21, 2026) is documented below:

| Metric | Verified Baseline | Source & Context |
|:---|:---:|:---|
| **Backend Automated Tests** | **192 / 192 PASS** (100%) | Node.js native test runner (`backend/src/**/__tests__/*.test.ts`) |
| **Frontend Automated Tests** | **268 / 268 PASS** (100%) | Node.js native test runner (`frontend/src/**/__tests__/*.test.ts`) |
| **Global Automated Tests** | **460 / 460 PASS** (100%) | Consolidated test pass across all layers |
| **TypeScript Compilation Errors** | **0 errors** | `tsc --noEmit` on both frontend and backend (`strict: true`) |
| **Canonical Songs in Database** | **125 songs** | Preserved with complete polyphonic versions and invariant integrity |
| **Registered System Users** | **108 users** | Preserved across active, pending invitation, and administrative roles |
| **Residual Test Artifacts in DB** | **0 setlists / 0 dirty rows** | Clean database state following transactional test teardowns |
| **Active DB Migrations** | **4 applied migrations** | `0000_normal_randall_flagg`, `0001_auth_rbac`, `0002_setlists`, `0003_single_active` |
| **External Dependencies Added (WS-2C-REMED)**| **0 new packages** | Implemented using standard React 19 and vanilla CSS tokens |

---

## 6. Phase 2C Reconciliation

The planning document `PHASE_2C_IMPLEMENTATION_PLAN.md` drafted prior to Phase 2C proposed an 8-workstream sequential breakdown:
```
WS1 (Schema) → WS2 (Domain/Zod) → WS3 (Repository) → WS4 (Service) → 
WS5 (Fastify API) → WS6 (Frontend Client/Hook) → WS7 (Atril UI) → WS8 (Exit Gate Verification)
```

### Forensic Audit of Workstream Execution:
- **WS1 through WS7:** Fully implemented in dedicated, authorized phases. Each workstream delivered code, tests, and audited implementation reports.
- **The Concurrency Remediation:** Following WS4, a formal concurrency audit (`PHASE_2C_WS4_CONCURRENCY_AUDIT.md`) identified a TOCTOU window where concurrent requests could produce two `ACTIVE` setlists. A dedicated remediation workstream was authorized, implementing migration `0003_single_active_setlist_constraint.sql` and verifying transactional conflict translation (PostgreSQL error `23505` $\to$ `ConflictError`).
- **Workstream 8 in Preliminary Planning:** Section 11 of `PHASE_2C_IMPLEMENTATION_PLAN.md` defined WS8 as:
  > *"Workstream 8 (Exit Gate): Ejecutar suites completas de pruebas, validación de tipos tsc --noEmit y reporte final de ingeniería."*
- **Actual Reality & Execution:** During actual execution, every workstream performed full regression runs and executed its own exit gate. In WS7, the global regression suite (447 tests), TypeScript typecheck (0 errors), and the 47-criteria Exit Gate evaluation were completed (`PHASE_2C_WS7_IMPLEMENTATION_REPORT.md`). Following an official functional audit (`PHASE_2C_FUNCTIONAL_VISUAL_AUDIT.md`), workstream `WS-2C-REMED` resolved all 3 presentation gaps (`GAP-01`, `GAP-02`, `GAP-03`), bringing the baseline to 460 tests. Phase 2C was then formally evaluated and closed via `PHASE_2C_FORMAL_CLOSURE_REPORT.md` (19/19 criteria satisfied).

---

## 7. WS8 Historical Planning vs. Actual Execution Audit

A comprehensive forensic audit across the entire repository for references to `"WS8"`, `"WS9"`, `"WS10"`, and subsequent workstreams establishes the following factual findings:

1. **No Production Code for WS8+:** Exactly zero production files, endpoints, components, or services exist for WS8, WS9, or WS10.
2. **No Authorized Preflight for WS8+:** No formal preflight document or authorized implementation plan exists for WS8, WS9, or WS10.
3. **References to WS8:** The only existing references to WS8 in project history are:
   - The preliminary diagram and single-sentence entry in `PHASE_2C_IMPLEMENTATION_PLAN.md` line 300, which originally envisioned WS8 as an administrative, non-coding exit gate and test verification step for Phase 2C.
   - The explicit boundary statement in `PHASE_2C_WS7_IMPLEMENTATION_REPORT.md`: `WS8 Status: Strictly NOT STARTED`.
4. **References to WS9, WS10, etc.:** Exactly zero occurrences exist anywhere in the repository.
5. **Phase 2C Closure Execution:** Rather than executing a separate synthetic "WS8" implementation workstream, Phase 2C verification was completed across WS1–WS7, verified at 447 tests, audited in `PHASE_2C_FUNCTIONAL_VISUAL_AUDIT.md`, remediated to 460 tests in `WS-2C-REMED`, and formally closed with full cryptographic verification in `PHASE_2C_FORMAL_CLOSURE_REPORT.md`.

### Formal Determination:
$$\mathbf{WS8\ IS\ A\ HISTORICAL\ PLANNING\ ITEM\ —\ SUPERSEDED\ BY\ ACTUAL\ EXECUTION.}$$
WS8 was never an authorized production coding workstream, nor is any fake or synthetic implementation required. Phase 2C is **FORMALLY CLOSED**. No additional Phase 2C workstreams exist or are needed.

---

## 8. Future Capability Inventory

The following inventory evaluates all capabilities envisioned in foundational specifications (`docs/01` through `docs/07`) and classifies them against current implementation evidence:

| Capability Domain | Authoritative Source Document | Current State in Repository | Implementation Evidence / Gap | Evidence Classification |
|:---|:---|:---|:---|:---:|
| **1. Performance / Stage View** | `docs/01` §7, `docs/03` §1, `docs/06` §3 | High-contrast dark theme, large typography, and musical workspace exist. | Auto-scroll by BPM, Bluetooth pedal drivers (AirTurn), and PWA Service Worker + IndexedDB offline caching are not yet built. | **PARTIALLY IMPLEMENTED** |
| **2. Rehearsal Engine** | `docs/03` §3, `docs/06` §3 | Zero rehearsal code exists in frontend or backend. | Precision Web Audio metronome (`AudioContext.currentTime`), lookahead scheduler ($<1\text{ms}$ jitter), count-in, section looping, and multitrack audio playback are unbuilt. | **SPECIFIED / NOT IMPLEMENTED** |
| **3. Advanced Setlist Execution** | `docs/03` §2, `docs/05` §2 | Setlist metadata, sequential navigation, and transposition calculation are fully operational. | Audio crossfading, synthesizer Pad continuous tone generation, and automated medley transitions are unbuilt. | **IMPLEMENTED WITH LIMITATIONS** |
| **4. Advanced Musical Editing (Levels 1–3)** | `docs/01` §5, `docs/02` §2–§4 | Canonical model fully supports polyphonic measures and voices. | UI workspace is currently consumption/display-only. Level 1 (lyrics/chords), Level 2 (sections), and Level 3 (polyphonic notation editor) are not built. | **SPECIFIED / NOT IMPLEMENTED** |
| **5. Advanced Ingestion: MusicXML & ChordPro** | `docs/04` §2 | Ingestion service, XML validator, XXE protection, and ChordPro parser fully operational. | MusicXML 4.0 and ChordPro files ingest into `CanonicalMusicPayload` preserving `totalMelodyNotes === 0`. | **IMPLEMENTED** |
| **6. Advanced Ingestion: MIDI** | `docs/04` §2 (Vía B) | Zero MIDI parsing code exists. | Decodification of `.mid`/`.kar`, track separation, note onset mapping, and adaptive quantization are unbuilt. | **SPECIFIED / NOT IMPLEMENTED** |
| **7. Advanced Ingestion: PDF** | `docs/04` §2 (Vía C) | Zero PDF parsing code exists. | PDF vector font extraction and rasterization pipelines are unbuilt. | **SPECIFIED / NOT IMPLEMENTED** |
| **8. Advanced Ingestion: Mobile OMR** | `docs/04` §2 (Vía D) | Zero OMR code exists. | Edge detection, perspective correction, optical musical symbol recognition, and visual confidence scoring are unbuilt. | **SPECIFIED / NOT IMPLEMENTED** |
| **9. Advanced Ingestion: Audio to Chords** | `docs/04` §2 (Vía E) | Zero audio DSP code exists. | Beat tracking, onset detection, chromagram analysis, and harmonic chord estimation are unbuilt. | **SPECIFIED / NOT IMPLEMENTED** |
| **10. AI-Assisted Music Intelligence** | `docs/04` §3 | Domain entities (`AI_ANALYSIS_RECORD`) specified in ERD. | No machine learning models, external LLM/AI integrations, or approval gate UI (`is_ai_draft`) have been implemented. | **SPECIFIED / NOT IMPLEMENTED** |
| **11. Real-Time WebSocket Infrastructure** | `docs/03` §4–§5 | Zero WebSocket endpoints or clients exist. | Fastify WebSocket plugin, Redis Pub/Sub, connection security handshake, and JSON message framing are unbuilt. | **SPECIFIED / NOT IMPLEMENTED** |
| **12. Director / Broadcaster Session** | `docs/03` §4 | Zero real-time session state exists. | Director live dispatch controls, `SECTION_CHANGE` event emission, and leader session management are unbuilt. | **SPECIFIED / NOT IMPLEMENTED** |
| **13. Musician / Follower Synchronization** | `docs/03` §4 | Musical workspace renders static score. | Real-time receiver listener, automatic measure scroll, and local override toggle are unbuilt. | **SPECIFIED / NOT IMPLEMENTED** |
| **14. Real-Time Clock & Tick Sync** | `docs/03` §6 | Zero timing synchronization code exists. | Lightweight NTP sync algorithm ($<15\text{ms}$ discrepancy) and `TICK_SYNC` beat emission are unbuilt. | **SPECIFIED / NOT IMPLEMENTED** |
| **15. Network Resiliency & Reconnect** | `docs/03` §6 | Frontend handles standard HTTP retries via fetch. | Silent WebSocket reconnect with exponential backoff, amber stage indicator, and full state snapshot recovery are unbuilt. | **SPECIFIED / NOT IMPLEMENTED** |
| **16. Production Operations & Multi-Tenancy** | `docs/05` §1, `docs/06` §3 | Single-organization schema in place. | Self-service multi-church registration, billing integration, CCLI / SongSelect API integration, and console audio capture are conceptual. | **CONCEPTUAL / FUTURE** |

---

## 9. Architectural Dependency Map

To avoid building brittle capabilities on unverified foundations, future development must follow strict architectural dependency layers:

```mermaid
graph TD
    subgraph Layer 0: Completed Solid Foundation
        L0_Core[Phase 1A-1B: Music Theory & Canonical Model]
        L0_Proj[Phase 1D: Transformation & Projection Engine]
        L0_Rend[Phase 1E-1F: Multi-Renderer Adapters alphaTab/OSMD/LeadSheet]
        L0_Ing[Phase 1C, 1H: MusicXML 4.0 & ChordPro Ingestion]
        L0_Work[Phase 1G: Musical Workspace Orchestrator]
        L0_Back[Phase 2A: PostgreSQL + Drizzle + Fastify API]
        L0_Auth[Phase 2B: JWT + Argon2id + 5 RBAC Roles]
        L0_Set[Phase 2C: Setlist Management & Liturgical Atril UI]
        
        L0_Core --> L0_Proj --> L0_Rend --> L0_Work
        L0_Ing --> L0_Core
        L0_Back --> L0_Auth --> L0_Set
        L0_Work --> L0_Set
    end

    subgraph Layer 1: Stage Ergonomics & Offline Readiness
        L1_Off[Phase 3A: PWA Offline-First & IndexedDB Cache]
        L1_Ergo[Phase 3B: Stage Controls: Auto-Scroll & Bluetooth Pedals]
        L0_Set --> L1_Off
        L0_Set --> L1_Ergo
    end

    subgraph Layer 2: Rehearsal & Precision Audio Engine
        L2_Audio[Phase 4A: Web Audio Metronome & Lookahead Scheduler]
        L2_Loop[Phase 4B: Rehearsal Looping, Stem Audio & Tempo Ramping]
        L1_Ergo --> L2_Audio --> L2_Loop
    end

    subgraph Layer 3: Real-Time Live Worship Synchronization
        L3_WS[Phase 5A: WebSocket Gateway & Session Lifecycle]
        L3_Sync[Phase 5B: Director Broadcaster & Musician Follower Protocol]
        L3_NTP[Phase 5C: NTP Clock Sync, Beat Tick & Silent Reconnect]
        L0_Auth --> L3_WS
        L0_Set --> L3_WS
        L3_WS --> L3_Sync --> L3_NTP
        L2_Audio -.-> L3_NTP
    end

    subgraph Layer 4: Advanced Creation & Assisted Ingestion
        L4_Edit[Phase 6A: Interactive Song & Arrangement Editor]
        L4_MIDI[Phase 6B: MIDI Ingestion & Adaptive Quantization]
        L4_OMR[Phase 6C: PDF & Mobile Camera OMR Processing]
        L4_AI[Phase 6D: AI Harmonic Analysis & Human Review Gate]
        L0_Core --> L4_Edit
        L0_Ing --> L4_MIDI --> L4_OMR --> L4_AI
    end

    subgraph Layer 5: Enterprise Production & Multi-Tenancy
        L5_Ten[Phase 7: Multi-Church Tenancy & External CCLI Sync]
        L0_Back --> L5_Ten
    end

    style Layer 0: Completed Solid Foundation fill:#e6f4ea,stroke:#137333,stroke-width:2px;
    style Layer 1: Stage Ergonomics & Offline Readiness fill:#e8f0fe,stroke:#1a73e8,stroke-width:2px;
    style Layer 2: Rehearsal & Precision Audio Engine fill:#fef7e0,stroke:#f9ab00,stroke-width:2px;
    style Layer 3: Real-Time Live Worship Synchronization fill:#fce8e6,stroke:#d93025,stroke-width:2px;
    style Layer 4: Advanced Creation & Assisted Ingestion fill:#f3e8fd,stroke:#9334e6,stroke-width:2px;
    style Layer 5: Enterprise Production & Multi-Tenancy fill:#e0f2f1,stroke:#00897b,stroke-width:2px;
```

---

## 10. Proposed Future Roadmap

> [!IMPORTANT]
> **PROPOSAL STATUS DECLARATION:**  
> The roadmap below represents the **formally proposed engineering sequencing**. It does **NOT** authorize implementation. Every subsequent phase and workstream requires explicit project owner authorization and an approved preflight audit before code execution. Phase 2C is already **FORMALLY CLOSED** and is excluded from the future proposal table.

| Proposed Phase | Title | Primary Focus & Deliverables | Architectural Pre-requisites | Status |
|:---:|:---|:---|:---|:---:|
| **Phase 3** | Stage Ergonomics & Resilient Offline Atril | Full PWA Service Worker caching of active setlists in IndexedDB, adaptive BPM auto-scroll, and Bluetooth AirTurn pedal support. | Phase 2C Setlist execution operational (CLOSED) | `PROPOSED / NOT AUTHORIZED` |
| **Phase 4** | Precision Rehearsal Engine | High-precision Web Audio metronome ($<1\text{ms}$ jitter), count-in, section loop playback, and stem/reference audio player. | Phase 1 Workspace & Phase 3 timing | `PROPOSED / NOT AUTHORIZED` |
| **Phase 5** | Real-Time Live Worship Synchronization | WebSocket infrastructure, Director broadcaster, Musician follower, NTP clock synchronization, and silent reconnection. | Phase 2B RBAC & Phase 2C Setlist state | `PROPOSED / NOT AUTHORIZED` |
| **Phase 6** | Advanced Editing & Multi-Channel Ingestion | Interactive Level 1 & 2 song/arrangement editing, MIDI import with adaptive quantization, and PDF/OMR ingestion. | Phase 1 Canonical model & Ingestion engine | `PROPOSED / NOT AUTHORIZED` |
| **Phase 7** | AI Intelligence & Multi-Church Platform | Audio chord/beat tracking with human review gates, multi-congregation tenant isolation, and CCLI/SongSelect API integration. | Phase 5 Realtime & Phase 6 Editing | `PROPOSED / NOT AUTHORIZED` |

---

## 11. Proposed Workstream Definitions

### 11.1 Historical Item: Phase 2C Formal Closure (WS-2C-CLOSE / WS8 Candidate) — COMPLETED & SUPERSEDED
- **Workstream ID:** `WS-2C-CLOSE` (superseding preliminary `WS8` administrative planning)
- **Status:** **COMPLETED & CLOSED**
- **Outcome:** Formally sealed Phase 2C via `PHASE_2C_FORMAL_CLOSURE_REPORT.md` on September 21, 2026.
- **Scope Executed:** Zero production code changes; comprehensive 19-criteria governance audit, baseline lock (460/460 tests PASS, 0 TypeScript errors), and root/docs cryptographic synchronization.
- **Conclusion:** Phase 2C is fully closed; no candidate closure workstream remains open or pending.

### 11.2 Phase 3: Stage Ergonomics & Offline-First Atril
- **Workstream 3.1 (PWA & Service Worker):** Implement Service Worker with stale-while-revalidate caching for static assets and notation fonts.
- **Workstream 3.2 (IndexedDB Setlist Cache):** Provide automatic local persistence of the active setlist and its canonical song payloads, allowing full performance in airplane mode.
- **Workstream 3.3 (Adaptive Auto-Scroll):** Implement continuous vertical auto-scroll calculated dynamically from song BPM and measure count, with manual pause/resume touch gestures.
- **Workstream 3.4 (Bluetooth Pedal Drivers):** Implement Web Keyboard / Gamepad API integration supporting standard AirTurn, PageFlip, and Coda Stomp Bluetooth pedals for hands-free page navigation.
- **Major Architectural Risks:** IndexedDB storage quota limits on mobile devices; smooth auto-scroll performance during high-DPI canvas rendering.
- **Exit Gate:** Complete setlist navigated and scrolled hands-free on an iPad in airplane mode for 60 consecutive minutes without memory leaks.

### 11.3 Phase 4: Precision Rehearsal Engine
- **Workstream 4.1 (Web Audio Metronome):** Implement audio scheduling via `AudioContext.currentTime` and Web Workers using a lookahead scheduler to achieve $<1\text{ms}$ jitter.
- **Workstream 4.2 (Section Looping & Count-In):** Provide visual UI to select a measure range (e.g. compases 17–24) and loop playback continuously with audible count-in.
- **Workstream 4.3 (Stem Audio Integration):** Synchronize multi-track reference audio files with score timeline and playback cursor.
- **Major Architectural Risks:** Audio buffer memory consumption on mobile devices; audio/visual desynchronization when the main UI thread experiences garbage collection.
- **Exit Gate:** Metronome and visual score cursor remain strictly synchronized across a 120-measure piece with measured audio-visual drift $< 15\text{ms}$.

### 11.4 Phase 5: Real-Time Live Worship Synchronization
- **Workstream 5.1 (WebSocket Gateway & Sessions):** Implement Fastify WebSocket gateway with JWT authentication and Redis Pub/Sub room management.
- **Workstream 5.2 (Director Broadcaster Protocol):** Develop MD control panel allowing the worship leader to dispatch `SECTION_CHANGE` events.
- **Workstream 5.3 (Musician Follower & Local Override):** Develop follower listener adapting the atril view to the director's location while allowing musicians to engage a temporary "Local Override" mode.
- **Workstream 5.4 (NTP Clock Sync & Silent Reconnect):** Implement lightweight client-server NTP ping-pong algorithm and zero-popup silent reconnection.
- **Major Architectural Risks:** Wi-Fi packet drops and jitter in crowded sanctuary environments; race conditions during simultaneous section dispatches.
- **Exit Gate:** 10 simulated client devices follow leader section jumps with visual alignment achieved across all devices in $< 30\text{ms}$.

---

## 12. Open Decisions Requiring User Authorization

Before authorizing any future workstream, the project owner and ministry leadership must resolve the following open decisions:

1. **Phase 2C Milestone Disposition:**
   - **RESOLVED & CLOSED:** Phase 2C was formally closed on September 21, 2026 via `PHASE_2C_FORMAL_CLOSURE_REPORT.md` (19/19 criteria satisfied). No administrative closure decision remains pending.
2. **Next Feature Priority:**
   - *Option A (Stage First):* Implement Phase 3 (Offline-first IndexedDB caching, auto-scroll, Bluetooth pedals) to maximize reliability on the physical altar stand.
   - *Option B (Rehearsal First):* Implement Phase 4 (Web Audio metronome, section looping, stems) to empower mid-week band rehearsals.
   - *Option C (Realtime First):* Implement Phase 5 (WebSockets, Director-Follower synchronization) to link band members in live worship.
3. **PWA Storage Ceiling & Retention:**
   - Determine how many historical setlists should remain cached in client IndexedDB (e.g., last 3 services vs. all services for 30 days).
4. **Hardware Footprint in Bethesda Madrid:**
   - Establish whether the primary atril hardware target is iPadOS (Safari), Android Tablets (Chrome), or mobile smartphones, to calibrate touch target and rendering performance budgets.
5. **Multi-Tenancy vs. Single-Church Deployment:**
   - Confirm whether the upcoming phases continue as a dedicated single-congregation instance (Bethesda Madrid) or begin incorporating multi-church organization partitions.

---

## 13. Roadmap Governance Rules

To guarantee software excellence, zero regression, and structural integrity throughout the Bethesda Worship Studio lifecycle, all future engineering must adhere to these non-negotiable governance principles:

1. **Roadmap Precedence:** No feature or workstream may be implemented unless it is defined within this Master Roadmap.
2. **Strict Phased Progression:** No workstream may begin until its architectural prerequisites have passed their respective Exit Gates.
3. **Preflight Requirement:** Every workstream must execute an exhaustive preflight contract audit before production code is touched.
4. **Explicit Authorization Gate:** The assistant/agent MUST NOT self-authorize or automatically advance across workstream boundaries. Every workstream transition requires explicit user approval.
5. **Document-First Delivery:** All technical results, architectural decisions, and verification proofs must be delivered as byte-identical repository markdown documents in the root and `docs/` directories.
6. **Canonical Music Model Immutability:** No future workstream may mutate, duplicate, or compromise the canonical musical domain (`CanonicalMusicPayload`, `totalMelodyNotes === 0`, and `Instrument ≠ View` decoupling).
7. **Zero Regression Standard:** All existing automated tests must pass 100% on every commit; no test may be weakened, commented out, or deleted.

---

## 14. Recommended Next Gate

$$\mathbf{RECOMMENDED\ NEXT\ GATE:\ MASTER\ ROADMAP\ APPROVAL\ /\ NEXT-PHASE\ SELECTION}$$

The immediate next milestone in the governance pipeline is the explicit review and formal adoption of this reconciled Master Roadmap by the project owner, followed by next-phase prioritization.

### Action Plan Upon Approval:
1. Project Owner reviews the reconciled findings, capability classifications, and proposed future roadmap.
2. Project Owner selects the next capability priority (e.g., Phase 3 Stage Ergonomics or Phase 4 Precision Rehearsal).
3. Upon receiving explicit authorization, the project advances to the **Pre-Flight Audit** of the selected workstream.
4. **NO IMPLEMENTATION MAY OCCUR UNTIL THAT PREFLIGHT IS COMPLETED AND APPROVED.**

---

## 15. Explicit Non-Authorization Statement

> [!CAUTION]
> ### FORMAL STATEMENT OF NON-AUTHORIZATION
> At the conclusion of this Master Roadmap reconciliation and Phase 2C Formal Closure, **no future implementation workstream is authorized.**  
> In particular, **Phase 3, Phase 4, Phase 5, Phase 6, Phase 7, and all subsequent workstreams remain NOT AUTHORIZED** until this roadmap is formally reviewed and explicitly approved by the project owner.  
> The codebase remains locked at the formally closed Phase 2C baseline.

---

## 16. Evidence and Verification Summary

The architectural findings and baseline assertions in this report were verified against the local repository:

```
===============================================================================
BASELINE VERIFICATION AUDIT
===============================================================================
Active Database Connection:   PostgreSQL 18.1 (Port 5432)
Database Migration Status:    0000, 0001, 0002, 0003 applied & intact
Canonical Songs in DB:        125 verified intact
Registered Users in DB:       108 verified intact
Backend Automated Tests:      192 / 192 PASS
Frontend Automated Tests:     268 / 268 PASS
Total Consolidated Tests:     460 / 460 PASS (100% pass rate)
TypeScript Compilation:       0 errors (frontend: strict, backend: strict)
Production Files Modified:    0 (Codebase protected)
Tests Modified or Deleted:    0 (Baseline protected)
Dependencies Modified:        0 (Zero package modifications)
===============================================================================
```

---

## 17. Document Integrity & Cryptographic Verification

To guarantee complete document authenticity, transparency, and immutability:
1. This authoritative document is recorded in the repository root as `BETHESDA_WORSHIP_STUDIO_MASTER_ROADMAP.md`.
2. A byte-identical copy is placed in `docs/BETHESDA_WORSHIP_STUDIO_MASTER_ROADMAP.md`.
3. An external SHA-256 manifest file (`BETHESDA_WORSHIP_STUDIO_MASTER_ROADMAP.sha256`) records the cryptographic hash of the finalized markdown representation.
4. Both files have been verified to possess identical byte counts and matching SHA-256 hashes using native cryptographic utilities (`certutil` / `Get-FileHash`), preventing self-referential paradoxes.

```
===============================================================================
MASTER ROADMAP RECONCILIATION: COMPLETE
GOVERNANCE GATE: AWAITING USER APPROVAL / NEXT-PHASE SELECTION
SYSTEM STATUS: PHASE 2C CLOSED — AWAITING NEXT PHASE PREFLIGHT AUTHORIZATION
===============================================================================
```
