# Bethesda Worship Studio — WP-03 & First-Release Priority 1 Preflight Report

**Project:** Bethesda Worship Studio  
**Organization:** Iglesia Cristiana Bethesda — Madrid, Cundinamarca, Colombia  
**Document Classification:** Technical Preflight Audit & Implementation Specification  
**Date:** October 16, 2026  
**Auditor Roles:** Senior Software Architect, Security Reviewer, QA Auditor, Music Domain Specialist  
**Authorization Context:** Project Owner explicit authorization lifting prior governance hold on WP-03 (Visual Identity Alignment) and authorizing First-Release Priority 1 (Musician-Selectable Reading Views with Authenticated Persistence).  
**Starting Branch:** `main`  
**Starting Commit SHA:** `6477e18e8ba894940713b20365615a685734cf9e` (*"docs: reconcile WP-02 audit records and publish documentary remediation"*)  
**Remote Synchronized State:** `origin/main` at `6477e18e8ba894940713b20365615a685734cf9e` (100% in sync)  
**Deliverable Path:** `docs/reports/WORSHIP_STUDIO_WP03_FIRST_RELEASE_PREFLIGHT.md`  

---

## 1. Executive Preflight Mandate & Authorization

The Project Owner has explicitly authorized the commencement of:
1. **WP-03 — Visual Identity Alignment:** Bringing the production web application into complete alignment with the official brand identity established in the user-approved requirements document `WORSHIP_STUDIO_PROPUESTA DE AVANCE.pdf` and formal governance decision **`DEC-01` (Option A)**.
2. **First-Release Priority 1 — Musician-Selectable Reading View & Persistence:** Exposing genuinely supported music-reading formats (Staff Notation/Partitura, Chord Chart/Cifrado with lyrics, Lyrics-Only, and Guitar Tablature when compatible data exists), preventing fabricated notation, and persisting user-selected preferred views via the authenticated WP-02 persistence path (`/api/v1/users/me/preferences`).

### Governance Boundaries (Non-Negotiable)
- **WP-04, WP-05, Phase 3B, Phase 3C, and all subsequent work packages remain strictly NOT AUTHORIZED.**
- The following capabilities mentioned in broader documentation remain **explicitly out of scope**:
  - Offline/PWA caching
  - Auto-scroll synchronized to tempo
  - Bluetooth foot pedal integration
  - Metronome, count-in, practice loops, tempo ramping, reference audio, multitracks
  - Live director-to-musician WebSocket synchronization
  - MIDI import, PDF/photo OMR, AI audio chord analysis
  - In-place interactive score editing
  - Multi-church tenancy
- **No Git commit or push** will be performed in this task. All code changes will be left in the working tree for Project Owner inspection.
- **No deployment or release** will be executed.

---

## 2. Workspace & Baseline Forensic State

### 2.1 Git Status & Worktree Cleanliness
- **Active Branch:** `main`
- **HEAD Commit SHA:** `6477e18e8ba894940713b20365615a685734cf9e`
- **Parent Commit SHA:** `20449a51cb4dd4909a28d06dde37d6aad834eb18`
- **Working Tree Inspection:**
  - Tracked modifications: **0 files** (clean).
  - Untracked files: Exactly 1 local file: `docs/reports/BETHESDA_WORSHIP_STUDIO_WP02_DOCUMENTARY_PUBLICATION_REPORT.md` (deliberately preserved untracked to honor the strict 13-path scope of the prior commit).
  - Pre-existing user modifications: None overwritten or discarded.

---

## 3. Visual Identity Asset & Surface Mapping (WP-03)

### 3.1 Authoritative Brand Asset Identification
- **Proposal Source of Truth:** `WORSHIP_STUDIO_PROPUESTA DE AVANCE.pdf` (p.10, Idea 2):
  > *"Utilizar el mismo logo propuesto en este documento"* (Priority: Alta, Incorporate: Sí).
- **Approved Decision:** `DEC-01` (Option A) in `docs/WORSHIP_STUDIO_GATE_1_OWNER_DECISIONS.md`:
  > *"Replace the Unicode placeholder ✝ in frontend/src/App.tsx with an optimized, responsive image component referencing the official saxophone emblem asset."*
- **Repository Asset File:** `docs/worship_studio_saxophone_emblem.png`
  - File Size: `242,388 bytes`
  - Timestamp: `2026-09-23 11:34:38`
  - Visual description: High-resolution emblem featuring the Bethesda saxophone worship identity.
  - Ambiguity Status: **Zero ambiguity**. The asset is verified and accepted.

### 3.2 Product Surfaces & Defect Remediation Scope

| Surface | File Location | Current Defect / Stale State | Approved Target State |
| :--- | :--- | :--- | :--- |
| **Main App Header** | `frontend/src/App.tsx` (L19) | Renders temporary Unicode cross placeholder: `<span className="brand-logo">✝</span>` | Renders official saxophone emblem (`<img src="/worship_studio_saxophone_emblem.png" alt="Bethesda Worship Studio" className="brand-emblem-img" />`). |
| **Header Phase Badge** | `frontend/src/App.tsx` (L26–28) | Stale tag: `<div className="phase-tag">Fase 2B — Seguridad RBAC</div>` | Removed or updated to clean Bethesda Worship Studio brand indicator. |
| **Favicon & Web App Mark** | `frontend/index.html` (L5) | Generic emoji data URI: `<link rel="icon" href="...🎵..." />` | Dedicated PNG favicon referencing `/worship_studio_saxophone_emblem.png`. |
| **Page Title** | `frontend/index.html` (L7) | Stale title: `Bethesda Worship Studio — Verificación de Renderizado en Navegador Real (Fase 1F)` | Aligned product title: `Bethesda Worship Studio — Sistema Musical y Atril Digital`. |
| **Auth Modal** | `frontend/src/components/auth/LoginModal.tsx` | Plain text title with generic emoji | Integrated brand styling matching header identity. |
| **Static Asset Distribution** | `frontend/public/` | Missing static asset directory | Copy `docs/worship_studio_saxophone_emblem.png` to `frontend/public/` for Vite static serving. |
| **Responsive CSS** | `frontend/src/index.css` | Typography-only `.brand-logo` rule ($2\text{rem}$) | Responsive height rules: $44\text{px}$ on desktop, $36\text{px}$ on mobile ($\le 768\text{px}$), maintaining aspect ratio and readable contrast against dark palette. |

---

## 4. First-Release Reading View Capability Matrix

The user proposal explicitly requests four primary music-reading formats (PDF p.8 Q4 & p.10 Idea 1):
1. **Pentagrama con notas / Partitura** (Staff notation)
2. **Cifrado con letra** (Chord chart with lyrics)
3. **Letra sola** (Lyrics-only)
4. **Tablatura** (Guitar tablature, only when compatible data exists)

### 4.1 Musical Invariant: Content-Driven Format Availability
The platform enforces a strict domain invariant: **never fabricate musical content**. The format selector must inspect both the canonical song data and the active instrument capabilities:

| Reading Format | Required Song Source Data | Compatible Instrument Families | Rendering Engine | Availability Classification | Unavailability Handling |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Partitura / Pentagrama** (`STANDARD_NOTATION` / `GRAND_STAFF`) | $\ge 1$ melodic note (`measures.some(m => m.getAllNotes().length > 0)`) | All except pure percussion / drums (`drums`) | OSMD / AlphaTab | **Available when source notes exist** | Disabled with badge: *"Sin notas melódicas en la fuente canónica (Lead Sheet Puro)"*. |
| **Cifrado con Letra** (`CHORDS` + `LYRICS`) | $\ge 1$ chord symbol (`measures.some(m => m.chords.length > 0)`) | All 12 instrument profiles | LeadSheetDOM / AlphaTab / OSMD | **Available when chord data exists** | Disabled with badge: *"Canción sin cifrado armónico"*. |
| **Letra Sola** (`LYRICS`) | $\ge 1$ lyric syllable (`measures.some(m => m.lyrics.length > 0)`) | All 12 instrument profiles | LeadSheetDOM | **Available when lyric syllables exist** | Disabled with badge: *"Fuente instrumental sin letra"*. |
| **Tablatura** (`TABLATURE`) | $\ge 1$ melodic note AND instrument tuning defined | Guitar (`acoustic_guitar`, `electric_guitar`) and Bass (`bass`) | AlphaTab | **Available ONLY when instrument has tuning AND song has notes** | Disabled with badge: *"No aplicable para este instrumento"* or *"Sin notas para digitar"*. |

---

## 5. User View Preference Persistence Architecture (WP-02 Reuse)

The platform has already delivered and verified the database schema (WP-01) and REST endpoints (WP-02). This implementation reuses that infrastructure without modifying the database or creating duplicate storage:

### 5.1 Existing Backend API Path
- `GET /api/v1/users/me/preferences`: Retrieves persisted view preferences for the authenticated user, or returns factory defaults based on RBAC role (DEC-03, DEC-04, DEC-05).
- `PUT /api/v1/users/me/preferences`: Validates (via Zod) and upserts preferences into PostgreSQL `user_view_preferences` table.
- **Security & User Isolation:** All requests require a valid JWT access token. User identity is derived strictly from `request.user.sub` on the server. Client-supplied IDs are rejected. Cross-user preference tampering (IDOR) is mathematically impossible.

### 5.2 Frontend Integration Plan
1. **API Client Extension:** Add `getUserPreferences()` and `updateUserPreferences(payload)` to `frontend/src/core/api/api-client.ts`.
2. **Preference Loading on Auth:** When the user authenticates, load preferences from `/api/v1/users/me/preferences` and apply them to `useMusicalWorkspace`.
3. **Format Selection & Persistence Control:**
   - Add a high-visibility, touch-friendly reading format control in the song header / toolbar.
   - Provide an explicit "Guardar como preferida" (Save as Preferred View) button.
   - When clicked, asynchronously call `PUT /api/v1/users/me/preferences`, providing visual feedback (saved confirmation badge).
4. **Default Application on Navigation:**
   - When navigating setlist items or opening new songs in the atril, apply the user's preferred format automatically, unless the song lacks data for it (in which case a safe fallback is selected with a non-intrusive notification).

---

## 6. Bounded File Change Scope

### 6.1 Frontend Files to Modify / Create
1. `frontend/public/worship_studio_saxophone_emblem.png` *(New static asset copied from `docs/`)*
2. `frontend/index.html` *(Update title and favicon)*
3. `frontend/src/App.tsx` *(Replace Unicode cross with emblem, clean header)*
4. `frontend/src/index.css` *(Add emblem styles, format selector controls, mobile-first rules)*
5. `frontend/src/core/api/preference-types.ts` *(New TypeScript types for preferences API)*
6. `frontend/src/core/api/api-client.ts` *(Add preference endpoints)*
7. `frontend/src/components/workspace/ReadingFormatSelector.tsx` *(New touch-friendly view selector)*
8. `frontend/src/components/workspace/MusicalControls.tsx` *(Integrate ReadingFormatSelector)*
9. `frontend/src/components/workspace/MusicalWorkspace.tsx` *(Preference loading and persistence coordination)*
10. `frontend/src/core/workspace/use-musical-workspace.ts` *(Expose preference application and song content inspection)*

### 6.2 Backend & Database Files to Modify
- **Zero.** No backend code, migrations, or database changes are required.

---

## 7. Dependencies, Risks & Mitigation Strategy

| Risk | Impact | Likelihood | Mitigation Strategy |
| :--- | :--- | :--- | :--- |
| **Inadvertent Canonical Mutation** | Corruption of original song notes when switching views | Very Low | `CanonicalMusicPayload` is strictly immutable (`ReadonlyArray`); `ProjectionService` produces ephemeral derived views. Existing immutability unit tests guarantee zero side effects. |
| **Narrow Viewport Collisions ($\le 375\text{px}$)** | Touch buttons overflowing on small smartphones | Medium | Mobile-first CSS with flexible grid/wrapping, min touch targets $\ge 48\text{px}$, and concise labels with icon indicators. |
| **Network Lag on Preference Save** | UI freezes during PUT request | Low | Non-blocking optimistic update with transient saving indicator and error banner fallback. |
| **Unauthenticated User Experience** | Crashes if preference endpoint is called without token | Low | Guard preference fetch/save behind `useAuth().user !== null`. For anonymous users, retain in-memory ephemeral preferences. |

---

## 8. Preflight Acceptance Criteria Verification

- [x] Live `main` branch inspected and confirmed matching starting commit `6477e18`.
- [x] Worktree confirmed clean (no untracked production files, no uncommitted edits).
- [x] Official logo asset verified at `docs/worship_studio_saxophone_emblem.png` (242,388 bytes) under `DEC-01` Option A.
- [x] Exact WP-02 backend API routes confirmed at `/api/v1/users/me/preferences`.
- [x] Content-driven format compatibility matrix formalized (no fabricated notation).
- [x] Strict non-negotiable boundaries acknowledged (WP-04/WP-05 unauthorized, no commit/push, no deploy).

**Preflight Status:** **PASS — ALL CHECKS SATISFIED. AUTHORIZED TO PROCEED WITH IMPLEMENTATION.**
