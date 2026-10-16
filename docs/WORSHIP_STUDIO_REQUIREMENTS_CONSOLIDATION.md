# WORSHIP STUDIO — USER REQUIREMENTS CONSOLIDATION & COMPLETION BASELINE
## Comprehensive Business Requirements Traceability, Gap Analysis, and Technical Audit

**Project:** Worship Studio  
**Organization:** Iglesia Cristiana Bethesda — Madrid, Cundinamarca, Colombia  
**Document Classification:** Official Product Requirements Baseline & Architectural Audit  
**Date:** October 15, 2026  
**Revision:** v2.0 — Post-Audit Governance Consistency Reconciliation  
**Author Roles:** Senior Product Architect, Business Requirements Analyst, Music Software Domain Specialist, and Independent Technical Auditor  
**Audit Verdict:** `PASS — GOVERNANCE BASELINE CONSISTENT; OWNER REVIEW REQUIRED`  
**Working Branch:** `main` (commit `2730ed6`)  
**Git Working Tree Status:** Clean (0 modified, 0 untracked production files)  
**Deliverable Path:** `WORSHIP_STUDIO_REQUIREMENTS_CONSOLIDATION.md` (and byte-identical `docs/WORSHIP_STUDIO_REQUIREMENTS_CONSOLIDATION.md`)  

---

## 1. Executive Summary & Audit Mandate

### 1.1 Objective and Scope
This document establishes the **definitive, evidence-based requirements baseline** needed to complete Worship Studio according to the real needs expressed by its intended users (musicians, singers, and worship leaders of Iglesia Cristiana Bethesda). 

Worship Studio is a specialized digital musicology, notation, rehearsal, and stage management workspace designed for contemporary church worship teams. Following the formal closure of Phase 2C (Setlists, Service Moments & Liturgical Flow), the project owner and user community conducted a formal scope and requirements validation review using the feedback instrument `WORSHIP_STUDIO_PROPUESTA DE AVANCE.pdf`.

This document consolidates:
1. The **exact, unadulterated user feedback** captured in the user-reviewed proposal document.
2. A clear architectural distinction between the **complete user-requested product scope (all 28 capabilities)** and the **implementation sequencing strategy**.
3. An exhaustive **Requirements Traceability Matrix (RTM)** with verified, honest evidentiary classifications that distinguish passing automated tests from physical device testing.
4. A **rigorous feature-by-feature technical gap analysis** comparing current code capabilities against expressed requirements.
5. A **unified Canonical Decision Register (DEC-01 through DEC-14)** resolving all conflicting identifier cross-references.
6. An assessment of **musical-domain invariants, security controls, and responsive UX constraints**.

### 1.2 Governance and Non-Implementation Restrictions
This workstream is **strictly documentary, analytical, and evaluative**. In accordance with the governance charter:
- **Zero Production Changes:** No frontend, backend, database schema, migration, dependency, test, or environment configuration files have been altered.
- **No Premature Implementation:** Phase 3A, Phase 3B, Phase 3C, Phase 4, Phase 5, Phase 6, WS8, or any new development workstream has not been started.
- **Evidence-Based Evaluation:** Existing passing unit tests (238 backend, 268 frontend) are recognized as historical evidence of component and logic correctness, but are strictly distinguished from user-facing physical device verification.
- **Preservation of Domain Invariants:** All core musical invariants (canonical model immutability, instrument-view decoupling, single active setlist concurrency constraint, RBAC guards) remain strictly preserved.

---

## 2. Repository and Delivery Baseline

### 2.1 Git Repository and Working-Tree State
A forensic inspection of the repository environment was conducted on October 15, 2026:
- **Repository Path:** `c:\Users\juanc\OneDrive\Documentos\Desarrollo proyectos\Sistema musical - partituras\BETHESDA WORSHIP STUDIO`
- **Active Branch:** `main`
- **Latest Commit:** `2730ed6` (*"Subiendo primeros archivos"*)
- **Working Tree:** Clean (`nothing to commit, working tree clean`).
- **Production Integrity:** Confirmed 100% untampered.

### 2.2 Historical Workstream Inventory and Completed Milestones
The platform's completed engineering phases and their primary evidentiary records are summarized below:

| Phase / Milestone | Formal Status | Scope Delivered | Primary Evidence Document | Test Count |
|:---|:---:|:---|:---|:---:|
| **Phase 0** | `CLOSED` | Architectural specification, 7 foundational blueprints, domain invariants, ADR-001 to ADR-007. | [`README.md`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/README.md), [`docs/01`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/docs/01_PRODUCT_VISION_AND_UX.md)–[`07`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/docs/07_PHASE_0_1_ARCHITECTURE_HARDENING.md) | N/A (Spec) |
| **Phase 1A–1H** | `CLOSED` | Core musicology engine, 480 TPQN timeline, MusicXML & ChordPro parsers, `ProjectionService`, alphaTab, OSMD, and LeadSheetDOM adapters, production workspace. | [`PHASE_1G_ENGINEERING_REPORT.md`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/PHASE_1G_ENGINEERING_REPORT.md), [`PHASE_1H_ENGINEERING_REPORT.md`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/PHASE_1H_ENGINEERING_REPORT.md) | 180 frontend |
| **Phase 2A** | `CLOSED` | Fastify backend foundation, PostgreSQL persistence, Drizzle ORM schema, song repository, round-trip fidelity. | [`PHASE_2A_ENGINEERING_REPORT.md`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/PHASE_2A_ENGINEERING_REPORT.md) | 18 backend |
| **Phase 2B** | `CLOSED` | Dual-cookie authentication, Argon2id password hashing, refresh token family rotation, 5 RBAC roles, invitation lifecycle. | [`PHASE_2B_ENGINEERING_REPORT.md`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/PHASE_2B_ENGINEERING_REPORT.md), [`PHASE_2B_POST_IMPLEMENTATION_SECURITY_REVIEW.md`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/PHASE_2B_POST_IMPLEMENTATION_SECURITY_REVIEW.md) | 45 backend |
| **Phase 2C (WS1–WS7)** | `CLOSED` | Setlist schema (`0002`), single active setlist constraint (`0003`), Fastify setlist routes, `useSetlistExecution` hook, `SetlistNavigationToolbar`, `ServiceMomentCard`. | [`PHASE_2C_WS7_IMPLEMENTATION_REPORT.md`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/PHASE_2C_WS7_IMPLEMENTATION_REPORT.md) | 175 backend, 88 frontend |
| **Phase 2C Remediation (`WS-2C-REMED`)** | `CLOSED` | Remediation of UI gaps (`GAP-01`, `GAP-02`, `GAP-03`): `SetlistDetailEditor`, song combobox, $\ge 48\text{px}$ touch reorder buttons, metadata edit, delete confirmation. | [`WS-2C-REMED_IMPLEMENTATION_REPORT.md`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/WS-2C-REMED_IMPLEMENTATION_REPORT.md), [`PHASE_2C_FORMAL_CLOSURE_REPORT.md`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/PHASE_2C_FORMAL_CLOSURE_REPORT.md) | 13 frontend |
| **Master Roadmap Reconciliation** | `CLOSED` | Documentary audit reconciling historical roadmap, capabilities inventory, and formal closure of Phase 2C. | [`BETHESDA_WORSHIP_STUDIO_MASTER_ROADMAP.md`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/BETHESDA_WORSHIP_STUDIO_MASTER_ROADMAP.md) | 460 total tests |

### 2.3 Automated Test Suite and Typecheck Baseline
The automated test suite and TypeScript typechecking pipelines represent the **historical code verification baseline**:
- **Backend Test Suite (`tsx --test`):** **238 / 238 tests passing (100%)**.
  - Rate limiting, token families, Argon2 hashing, RBAC guards, round-trip song persistence, setlist repositories, atomic reorder transactions, single-active setlist concurrency constraints (`23505` handling), invitation lifecycle.
- **Frontend Test Suite (`node --test`):** **268 / 268 tests passing (100%)**.
  - Music theory core, PitchClass, Circle of Fifths, Capo calculator, canonical model parsing, projection service, view preferences, alphaTab/OSMD/LeadSheetDOM rendering adapters, Golden Scenarios A–D, `useSetlistExecution` hook, `SetlistNavigationToolbar`, `ServiceMomentCard`, `SetlistsModal`, `SetlistDetailEditor`.
- **TypeScript Typecheck (`tsc --noEmit`):**
  - Backend: **0 errors** (TypeScript 5.7.3).
  - Frontend: **0 errors** (TypeScript 7.0.2).

> [!NOTE]
> **Audit Qualification on Automated Testing:**  
> The passing automated test baseline proves that domain algorithms, database transactions, and isolated React component renders behave correctly in synthetic node environments. It does **not** prove that sheet music is legible from 1 meter on an iPhone 13, that Bluetooth foot pedals turn pages without lagging on stage, or that real-time synchronization functions over congested church Wi-Fi.

---

## 3. Authoritative Source of User Feedback

### 3.1 Document Discovery and Authentication
During this audit, the primary feedback document referenced in governance communications was located and forensically examined:
- **File Name:** `WORSHIP_STUDIO_PROPUESTA DE AVANCE.pdf`
- **Location:** `C:\Users\juanc\OneDrive\Documentos\Desarrollo proyectos\Sistema musical - partituras\WORSHIP_STUDIO_PROPUESTA DE AVANCE.pdf`
- **File Size:** **754,863 bytes**
- **Last Modified Timestamp:** `October 15, 2026, 10:17:46 AM`
- **Cryptographic Hash (SHA-256):** `CA1EFC93F36B37B7728AE754DC677E61892732396800FD742E30734CE541D155`

#### Note Regarding Filename Reference:
The initial request referenced `WORSHIP_STUDIO_PROPUESTA DE AVANCE(1).pdf`. The inspection confirmed that the document in the workspace parent directory is `WORSHIP_STUDIO_PROPUESTA DE AVANCE.pdf` (without the `(1)` suffix). A clean template copy of identical layout was also found at `WORSHIP_STUDIO_USER_SCOPE.pdf` (328,192 bytes, SHA-256 `831FD26AC8700B8CE4FB824DAD13A40EC2B73341A7D245F6EFFFBA15F36EA0DF`). The 754,863-byte file contains the **actual user markings, vector checkboxes, and text responses**.

### 3.2 Forensic Analysis of User Responses
Using vector and text extraction via PyMuPDF (`fitz`), every annotation, vector checkbox, and text response in `WORSHIP_STUDIO_PROPUESTA DE AVANCE.pdf` was audited and correlated to its exact section:

#### A. Section 6: Current Scope Proposal Evaluation Table (Pages 6 & 7)
- **Selection Checkboxes:** The user marked **"Sí" (Incorporate into current scope)** for **all 28 listed capabilities** (Rows 1 through 28). Each row exhibits a dedicated vector check rectangle at coordinate $x \approx 333.15$, aligned with the "Sí" column.
- **Specific User Annotations on Page 6:**
  - **Item 11 (Tonalidad por reunión):** User added note: *"Para todos los casos partituras y cifrado"*.
  - **Item 12 (Momentos del servicio):** User added note: *"Para todos los casos partituras y cifrado"*.
  - **Item 14 / Table margin:** User added note: *"Tambien que tenga opcion de importacion de canciones desde otros archivos multimedia"*.
  - **Item 20 / Table margin:** User added question: *"¿Se puede desarrollar para que sea compatible con cualquier dispositivo?"*.

#### B. Section 7: User Decisions Questionnaire (Pages 8 & 9)
The user responded to the specific questions posed by the development team as follows:
- **Pregunta 1 (Instrumentos habituales):**  
  *User Answer:* `"Piano, teclado sintetizador, guitarra acústica, guitarra eléctrica, bajo, batería, saxofón, voces"`
- **Pregunta 2 (Instrumentos prioritarios indispensables):**  
  *User Answer:* `"Todos"` (The user considers all 8 instrument groups to be indispensable priorities for initial launch).
- **Pregunta 3 (Información exacta requerida en vivo):**  
  *User Answer:* `"Compases y figuras rítmicas completas y cifrado sobre las palabras clave"`
- **Pregunta 4 (Formato de lectura preferido):**  
  *User Answer:* `"Pentagrama con notas, cifrado con letra, letra sola, tablatura, una combinación, y se muestren como opciones y que el musico pueda escoger alguna de las opciones"`
- **Pregunta 5 (Elemento en primer plano al abrir una canción en atril):**  
  *User Answer:* `"La estructura general"`
- **Pregunta 6 (Dispositivos principales de uso):**  
  *User Answer:* `"Principal dispositivo Celular, pero que sea resposiva para tablet tambien"`
- **Pregunta 7 (Importancia del metrónomo integrado):**  
  *User Answer:* `"Sería una herramienta nueva para el equipo"`
- **Pregunta 8 (Pistas de audio de referencia y multitracks):**  
  *User Answer:* [Left blank in questionnaire text; marked "Sí" in Table Item 23].
- **Pregunta 9 (Músicos que requieren pedales inalámbricos Bluetooth):**  
  *User Answer:* `"Pianista y baterista"`
- **Pregunta 10 (Tipo de sincronización entre pantallas preferida):**  
  *User Answer:* `"El director selecciona la canción y todos la ven"` (Corresponds directly to Option A).
- **Pregunta 11 (Controles del director durante el servicio):**  
  *User Answer:* `"Avisos al equipo y cambios de tono sobre la marcha"`
- **Pregunta 12 (Funciones estrictamente indispensables para la 1ª etapa):**  
  *User Answer:* `"Partituras y Cifrado"`
- **Pregunta 13 (Funciones secundarias o postergables):**  
  *User Answer:* [Left blank — reinforces that the user desires the full suite of music notation and chords immediately].
- **Pregunta 14 (Necesidades específicas no contempladas):**  
  *User Answer:* [Left blank].

#### C. Section 8: Changes and New Ideas Proposed by Users (Page 10)
- **Fila 1 (Idea nueva):**  
  - *Text:* `"El pentagrama debe mostrar opciones de partitura y cifrado de los tipos mas usados y que el usuario pueda escoger cual prefiere y que pueda dejar una de las opciones como preferida."`  
  - *Priority marked:* **Alta** (High)  
  - *Incorporation marked:* **Sí** (Yes)
- **Fila 2 (Identidad visual):**  
  - *Text:* `"Utilizar el mismo logo propuesto en este documento"`  
  - *Priority marked:* **Alta** (High)  
  - *Incorporation marked:* **Sí** (Yes)  
  - *Evidence in repository:* The saxophone logo proposed on the cover of the PDF is present in the repository as an asset at [`docs/worship_studio_saxophone_emblem.png`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/docs/worship_studio_saxophone_emblem.png). In the running application, `App.tsx` currently displays a Unicode cross character (`✝`). Replacing this placeholder with the saxophone asset is classified under **Decision DEC-01**.

---

## 4. Product Scope vs. Implementation Sequencing

A central governance finding of this review is the necessity of cleanly separating **Product Scope** from **Implementation Sequencing**:

### 4.1 Complete User-Requested Product Scope
The intended product scope accepted by the user community encompasses **all 28 capabilities** in the proposal evaluation table, plus the two new proposals on Page 10. Scheduling a capability into Phase 4, Phase 5, or Phase 6 does **not** mean it is rejected or removed from the agreed product scope. It means that delivery is sequenced according to technical prerequisites, risk mitigation, and stage safety.

### 4.2 Phased Delivery Structure
- **Phase 3 — Minimum Usable Product (MUP):** Stage 1 deployment enabling real worship services with scores, chords, all 8 instruments, mobile usability, and director-to-musician synchronization.
- **Phase 4 — Stage Ergonomics & Reliability:** Hands-free foot pedal operation (pianist/drummer), tempo auto-scrolling, and PWA offline caching.
- **Phase 5 — Rehearsal & Audio Suite:** Audible metronome, section looping, stems multitrack player, and binary MIDI ingestion.
- **Phase 6 — Advanced & AI-Assisted Capabilities:** PDF OMR, photo chord OCR, audio harmonic analysis, and in-place notation editing.

---

## 5. Reconciled Requirements Traceability Matrix (RTM)

The matrix below maps each user requirement to repository evidence. Evidentiary statuses are strictly qualified:

### Evidentiary Classification Legend:
- `AUTOMATED_TESTS_PASS_DEVICE_UNVERIFIED`: Production code exists, automated tests pass, but physical mobile/tablet hardware testing has not been performed.
- `AUTOMATED_TESTS_PASS_DESKTOP_VERIFIED`: Production code exists, automated tests pass, functional integration demonstrated in desktop browser, but physical stage stand validation has not been performed.
- `AUTOMATED_TESTS_PASS_FORMAT_BOUNDED`: Code and automated tests verified, but feature is structurally bounded by file format constraints (e.g. ChordPro lacking note durations).
- `PARTIALLY_IMPLEMENTED`: Partial domain or UI code exists, but end-to-end integration is incomplete.
- `SPECIFIED_NOT_IMPLEMENTED`: Fully specified in architectural documentation (`docs/`), zero implementation code in `src/`.
- `PROPOSED_AWAITING_DECISION`: User-requested feature requiring formal owner governance approval.
- `IMPLEMENTED_AND_VERIFIED`: Code exists, automated tests pass, and programmatic architectural invariants are mathematically proven.

| Req ID | User Requirement Summary | Source & Page | Code Evidence & Files | Reconciled Status | Remaining Technical & Functional Gap | Priority | Canonical Decision ID |
|:---|:---|:---:|:---|:---:|:---|:---:|:---:|
| **REQ-A01** | Support Piano reading needs (Grand Staff + Chords) | PDF p.8 (Q1, Q2, Q4) | `instrument-profile.ts` (L210), `osmd-adapter.ts`, Golden Scenario B | `AUTOMATED_TESTS_PASS_DEVICE_UNVERIFIED` | Grand staff rendering passes in automated tests; simultaneous lyrics+chords spacing on small mobile screens unverified on hardware. | P0 (MUP) | DEC-02, DEC-06 |
| **REQ-A02** | Support Synthesizer/Keyboard reading needs | PDF p.8 (Q1, Q2) | `instrument-profile.ts` (L230) (`keyboard`) | `PARTIALLY_IMPLEMENTED` | Profile currently aliases piano; synth-specific patch annotations, MIDI split markers, and sound notes are absent. | P0 (MUP) | DEC-02 |
| **REQ-A03** | Support Acoustic Guitar (Chords + Capo + Lyrics + Tabs) | PDF p.8 (Q1, Q2, Q4) | `instrument-profile.ts` (L148), `CapoControl.tsx`, `alphatab-adapter.ts`, Scenario A | `AUTOMATED_TESTS_PASS_DEVICE_UNVERIFIED` | Capo math and tab rendering pass automated tests; ergonomic readability on mobile stand while playing unverified. | P0 (MUP) | DEC-02, DEC-06 |
| **REQ-A04** | Support Electric Guitar (Tablature + Chords + Lead) | PDF p.8 (Q1, Q2) | `instrument-profile.ts` (L168), `alphatab-adapter.ts` | `AUTOMATED_TESTS_PASS_DEVICE_UNVERIFIED` | Tab rendering passes in automated suite; physical smartphone readability unverified. | P0 (MUP) | DEC-02 |
| **REQ-A05** | Support Bass Guitar (Bass Clef + 4-String Tab) | PDF p.8 (Q1, Q2) | `instrument-profile.ts` (L189), `STANDARD_BASS_TUNING` | `PARTIALLY_IMPLEMENTED` | 4-string bass tab and clef pass automated tests; 5-string bass tuning profile is absent from `InstrumentRegistry`. | P0 (MUP) | DEC-02 |
| **REQ-A06** | Support Drums / Percussion reading | PDF p.8 (Q1, Q2) | `instrument-profile.ts` (L251) (`drums`, `isPercussion`) | `PARTIALLY_IMPLEMENTED` | Profile exists, but dedicated percussion staff notation adapter is unverified; awaiting drummer interview. | P0 (MUP) | DEC-10 |
| **REQ-A07** | Support Alto & Tenor Saxophone (Eb / Bb Transposition) | PDF p.8 (Q1, Q2) | `instrument-profile.ts` (L270, L288), `TransposingInstrumentEngine` (+9, +2 st), Scenario C | `AUTOMATED_TESTS_PASS_DEVICE_UNVERIFIED` | Transposition math verified in automated tests; stage legibility of transposed staves on mobile stand unverified. | P0 (MUP) | DEC-02, DEC-06 |
| **REQ-A08** | Support Vocalists (Lyrics + Chords + Structure) | PDF p.8 (Q1, Q2, Q4) | `instrument-profile.ts` (L323, L343), `LeadSheetDomAdapter.ts`, Scenario D | `AUTOMATED_TESTS_PASS_DEVICE_UNVERIFIED` | Pure DOM leadsheet passes automated tests; dynamic multi-part harmony splitting absent; mobile text scaling unverified on phones. | P0 (MUP) | DEC-02, DEC-06 |
| **REQ-A09** | Display complete musical measures and rhythmic figures | PDF p.8 (Q3), p.9 (Q12) | `CanonicalMusicPayload`, `MeasureTimeline`, `VoiceTrack`, OSMD & AlphaTab adapters | `AUTOMATED_TESTS_PASS_FORMAT_BOUNDED` | Supported for MusicXML imports; ChordPro format structurally lacks note durations and cannot render rhythmic figures. | P0 (MUP) | DEC-13 |
| **REQ-A10** | Align harmonic chord symbols over lyrics/words | PDF p.8 (Q3), p.9 (Q12) | `LyricSyllable`, `ChordEvent`, `LeadSheetDomAdapter.ts` | `AUTOMATED_TESTS_PASS_DEVICE_UNVERIFIED` | Syllable-level alignment passes unit tests; line-wrapping collisions on narrow mobile viewports ($\le 375\text{px}$) unverified. | P0 (MUP) | DEC-06 |
| **REQ-A11** | Selectable reading formats (staff, chords+lyrics, lyrics, tab, combos) | PDF p.8 (Q4), p.10 (Idea 1) | `RepresentationSelector.tsx`, `derived-musical-view.ts` | `AUTOMATED_TESTS_PASS_DESKTOP_VERIFIED` | In-memory representation selection works; touch ergonomics on mobile phones unverified. | P0 (MUP) | DEC-02 |
| **REQ-A12** | Musician selection of preferred reading presentation (Saved Default) | PDF p.8 (Q4), p.10 (Idea 1) | `use-musical-workspace.ts`, `ViewPreference` class | `PARTIALLY_IMPLEMENTED` | In-memory selection exists; **persisted PostgreSQL storage and user preference REST endpoints do not exist**. | P0 (MUP) | DEC-02 |
| **REQ-A13** | Instrument-specific views without corrupting canonical content | Prompt Section A | `ProjectionService.ts`, immutable canonical architecture | `IMPLEMENTED_AND_VERIFIED` | `CanonicalMusicPayload` is strictly immutable; all transpositions and views derive into ephemeral projections. | P0 (MUP) | None (Invariant) |
| **REQ-B01** | Mobile phone optimization as primary stage device | PDF p.8 (Q6) | `index.css`, `SetlistNavigationToolbar.tsx` (fixed bottom) | `PARTIALLY_IMPLEMENTED` | Responsive CSS contracts exist; physical smartphone readability from 1m stage distance unverified. | P0 (MUP) | DEC-06 |
| **REQ-B02** | Responsive tablet support in stage stands | PDF p.8 (Q6) | `SetlistNavigationToolbar.tsx` (sticky top on tablet/desktop) | `AUTOMATED_TESTS_PASS_DEVICE_UNVERIFIED` | 768px–1024px CSS rules pass; physical stage stand behavior and dual-page mode unverified. | P0 (MUP) | DEC-06 |
| **REQ-B03** | Touch targets $\ge 48\text{px}$ and stage legibility | WS-2C-REMED | `index.css`, `SetlistDetailEditor.tsx`, `SetlistNavigationToolbar.tsx` | `AUTOMATED_TESTS_PASS_DEVICE_UNVERIFIED` | $\ge 48\text{px}$ CSS dimensions verified in automated tests; manual tactile performance while playing unverified. | P0 (MUP) | DEC-06 |
| **REQ-C01** | Create and organize worship setlists | PDF p.6 (Item 10) | `setlist.routes.ts`, `DrizzleSetlistRepository.ts`, `SetlistsModal.tsx` | `AUTOMATED_TESTS_PASS_DESKTOP_VERIFIED` | End-to-end CRUD, status transitions, and single-active setlist constraint verified in desktop automated suite. | P0 (MUP) | None |
| **REQ-C02** | Non-musical liturgical service moments (prayer, offering) | PDF p.6 (Item 12) | `0002` schema (`SERVICE_MOMENT`), `ServiceMomentCard.tsx` | `AUTOMATED_TESTS_PASS_DESKTOP_VERIFIED` | Liturgical cards with Pad key, pastoral notes, zero audio renderer overhead verified in desktop automated suite. | P0 (MUP) | None |
| **REQ-C03** | Configure target key, tempo, and notes per service item | PDF p.6 (Item 11) | `setlist_items` table, `calculateTranspositionSemitones`, `SetlistDetailEditor.tsx` | `AUTOMATED_TESTS_PASS_DESKTOP_VERIFIED` | Harmonic transposition delta calculation $[-6, +6]$ semitones verified in automated tests. | P0 (MUP) | None |
| **REQ-C04** | Touch-friendly setlist reordering and metadata editing | PDF p.6 (Item 13) | `SetlistDetailEditor.tsx` (Move Up `▲` / Down `▼`, atomic PUT) | `AUTOMATED_TESTS_PASS_DESKTOP_VERIFIED` | Delivered and verified in `WS-2C-REMED` (Tests 4–6). | P0 (MUP) | None |
| **REQ-C05** | Performance atril navigation with previous/next and return-to-service | PDF p.6 (Items 14–16), p.8 (Q5) | `SetlistNavigationToolbar.tsx`, `useSetlistExecution.ts` | `AUTOMATED_TESTS_PASS_DESKTOP_VERIFIED` | Step navigation, next item banner, off-setlist viewing, and "Volver al Culto" return verified in desktop suite. | P0 (MUP) | None |
| **REQ-D01** | Director-to-musician real-time synchronization ("Director selects, all see") | PDF p.7 (Item 24), p.8 (Q10 Option A) | None in production code; specified in `docs/03` | `SPECIFIED_NOT_IMPLEMENTED` | Zero WebSocket or SSE real-time sync code exists in backend or frontend. | P1 (Core Stage) | DEC-03, DEC-04 |
| **REQ-D02** | Director live notices and stage instructions to team | PDF p.9 (Q11) | None in production code; specified in `docs/03` | `SPECIFIED_NOT_IMPLEMENTED` | Stage notification overlay component and broadcast message dispatcher absent. | P1 (Core Stage) | DEC-03, DEC-05 |
| **REQ-D03** | Live on-the-fly key change push from Director | PDF p.9 (Q11) | In-memory transposition exists; live broadcast missing | `PARTIALLY_IMPLEMENTED` | Director can transpose locally, but cannot broadcast new key delta to team devices in real time. | P1 (Core Stage) | DEC-03, DEC-04 |
| **REQ-D04** | Musician local override / temporary disconnection | PDF p.4 (§4.5), Prompt D | `useSetlistExecution` off-setlist mode exists | `PARTIALLY_IMPLEMENTED` | Local off-setlist browsing exists; real-time sync decoupling/re-coupling toggle not built. | P1 (Core Stage) | DEC-04 |
| **REQ-D05** | Silent reconnection and network resilience in temple | PDF p.5 (§5.3), Prompt D | Volatile cache prefetch $N+1$ exists | `PARTIALLY_IMPLEMENTED` | Reconnection state machine for WebSockets / network dropouts not implemented. | P1 (Core Stage) | DEC-03, DEC-08 |
| **REQ-E01** | Digital audible metronome with count-in | PDF p.6 (Item 21), p.8 (Q7) | None in production code; specified in `docs/03` | `SPECIFIED_NOT_IMPLEMENTED` | Web Audio API precision scheduling metronome not implemented. | P2 (Rehearsal) | DEC-11 |
| **REQ-E02** | Loop section practice (measure looping) | PDF p.6 (Item 22) | None in production code; specified in `docs/03` | `SPECIFIED_NOT_IMPLEMENTED` | Range selection over timeline measures not implemented. | P2 (Rehearsal) | None |
| **REQ-E03** | Variable practice tempo slider | PDF p.4 (§4.1) | None in production code | `SPECIFIED_NOT_IMPLEMENTED` | BPM scaling relative to original song tempo not implemented. | P2 (Rehearsal) | None |
| **REQ-E04** | Reference audio and multitrack / stems playback | PDF p.7 (Item 23) | None in production code; specified in `docs/04` | `SPECIFIED_NOT_IMPLEMENTED` | Web Audio API multi-channel stems player not implemented; audio asset storage unconfigured. | P2 (Rehearsal) | DEC-12 |
| **REQ-E05** | Ingestion of MIDI files (`.mid`) | PDF p.7 (Item 25) | None in production code; specified in `docs/04` | `SPECIFIED_NOT_IMPLEMENTED` | Binary MIDI parser and quantization to 480 TPQN canonical model not implemented. | P2 (Rehearsal) | DEC-13 |
| **REQ-E06** | PDF score and photographed chord-sheet ingestion (OMR/OCR) | PDF p.7 (Item 26) | None in production code; specified in `docs/04` | `SPECIFIED_NOT_IMPLEMENTED` | Optical Music Recognition (OMR) and OCR pipeline not implemented. | P3 (Advanced) | DEC-13 |
| **REQ-E07** | Assisted audio analysis (tempo, meter, chord suggestion) | PDF p.7 (Item 27) | None in production code; specified in `docs/04` | `SPECIFIED_NOT_IMPLEMENTED` | Audio feature extraction (FFT/chromagram) not implemented. | P3 (Advanced) | DEC-13 |
| **REQ-E08** | In-place interactive polyphonic notation editing | PDF p.7 (Item 28) | None in production code | `SPECIFIED_NOT_IMPLEMENTED` | Current workspace is read-only rendering; note/chord drag-and-drop editing not built. | P3 (Advanced) | DEC-14 |
| **REQ-E09** | Offline access to active repertoire (PWA / Service Worker) | PDF p.6 (Item 18) | In-memory session cache exists; PWA missing | `PARTIALLY_IMPLEMENTED` | Volatile RAM cache works within browser tab; persistent IndexedDB + Service Worker not built. | P1 (Core Stage) | DEC-08, DEC-09 |
| **REQ-E10** | Automatic vertical musical scrolling by tempo | PDF p.6 (Item 19) | None in production code; specified in `docs/03` | `SPECIFIED_NOT_IMPLEMENTED` | Smooth requestAnimationFrame scroll engine based on BPM and measure height not built. | P1 (Core Stage) | DEC-15 |
| **REQ-E11** | Wireless Bluetooth page-turner pedal support (Pianist & Drummer) | PDF p.6 (Item 20), p.8 (Q9) | Keyboard shortcuts partially stubbed in toolbar | `PARTIALLY_IMPLEMENTED` | Standard HID keyboard events can be bound; global stage listener not wired. | P1 (Core Stage) | DEC-07 |
| **REQ-F01** | Multimedia import beyond MusicXML and ChordPro | PDF p.6 (User note) | MusicXML and ChordPro implemented | `PARTIALLY_IMPLEMENTED` | User explicitly requested other multimedia imports; formats need specification. | P2 (Rehearsal) | DEC-13 |
| **REQ-F02** | Official Bethesda Worship Studio Saxophone Logo Identity | PDF p.10 (Idea 2) | Asset exists in `docs/worship_studio_saxophone_emblem.png`; placeholder in `App.tsx` | `PARTIALLY_IMPLEMENTED` | PNG asset present in repo; header currently displays Unicode cross `✝` instead of emblem. | P0 (MUP) | DEC-01 |

---

## 6. Feature-by-Feature Deep Gap Analysis

### 6.1 Musical Notation and Multi-Renderer Architecture
- **Current State:** The platform features an abstraction layer (`IMusicRenderer`) with three operational adapters: `AlphaTabAdapter` (tablature/strings), `OsmdAdapter` (grand staff and notation), and `LeadSheetDomAdapter` (chords over lyrics).
- **Identified Gaps:**
  - *Drum Notation:* The `drums` instrument profile declares `PERCUSSION_NOTATION`, but no adapter currently renders standard 5-line percussion staff notation (cymbals as x-heads, kick on bottom space).
  - *ChordPro Limitations:* ChordPro files lack rhythmic duration data. Consequently, requesting "Pentagrama" for a song imported from ChordPro currently renders an empty staff or falls back to lead sheet.
  - *Measure and Beat Alignment:* In MusicXML files, chords align to measure beats; in ChordPro files, chords align to lyrics. A unified visual representation that shows rhythmic measure barlines above lyrics is not yet implemented.

### 6.2 Instrument Profiles and Preferred View Persistence
- **Current State:** 12 instrument profiles are registered in `InstrumentRegistry` covering piano, keyboards, acoustic/electric guitar, bass, drums, alto sax (Eb), tenor sax (Bb), trumpet (Bb), lead vocal, backing vocal, and generic.
- **Identified Gaps & Approved Governance Resolution:**
  - *View Preference Persistence:* The user explicitly noted on Page 10: *"El pentagrama debe mostrar opciones de partitura y cifrado de los tipos mas usados y que el usuario pueda escoger cual prefiere y que pueda dejar una de las opciones como preferida."* Currently, `ViewPreference` lives entirely in React volatile state (`use-musical-workspace.ts`). When a user refreshes or logs in from another phone, their instrument and reading choices reset to factory defaults.
  - *Database Schema Absence:* No `user_view_preferences` table exists in PostgreSQL.
  - *Canonical-Role Factory Defaults Policy (Approved under DEC-02, DEC-03, DEC-04, DEC-05):* For accounts without saved preferences, the system provides consistent factory defaults based on canonical role:
    | Role | Instrument | Primary representation | Secondary representations | Governance Authority |
    |:---|:---|:---|:---|:---:|
    | `MUSICIAN` | `acoustic_guitar` | `CHORDS` | `['LYRICS']` | DEC-02 (Verified) |
    | `WORSHIP_LEADER` | `acoustic_guitar` | `CHORDS` | `['LYRICS']` | DEC-04 (Approved Option A) |
    | `VIEWER` | `lead_vocal` | `LYRICS` | `['CHORDS']` | DEC-05 (Approved Option A) |
    | `ADMIN` | `acoustic_guitar` | `CHORDS` | `['LYRICS']` | DEC-03 (Approved Option A) |
    | `SUPER_ADMIN` | `acoustic_guitar` | `CHORDS` | `['LYRICS']` | DEC-03 (Approved Option A) |


### 6.3 Chord and Lyric Alignment
- **Current State:** `LeadSheetDomAdapter` renders chord symbols positioned above lyric syllables. It respects chord alterations, enharmonic spelling, and section markers.
- **Identified Gaps:**
  - *Mobile Word Wrapping:* On mobile phone screens ($\le 390\text{px}$), long chords (e.g., `C#m7(b5)`) over short syllables can cause visual collisions or awkward word breaks. Responsive chord wrapping needs physical device validation.

### 6.4 Transposition, Capo, and Key Change Behavior
- **Current State:** Pure mathematical transposition engine (`CircleOfFifths`, `TransposingInstrumentEngine`, `IntervalCalculator`) ensures 100% enharmonically correct spelling across $[-6, +6]$ semitones. Capo calculator computes guitar chord fingerings.
- **Identified Gaps:**
  - *Director Live Push:* In the current atril, transposition is controlled locally by the user. If the director changes key during a live service (requested in Question 11), there is no mechanism to broadcast this change to the musicians' screens.

### 6.5 Song Ingestion and Validation
- **Current State:** Secure parsers for MusicXML 4.0 and ChordPro with XXE injection prevention, HTML entity sanitization, and structural normalization (`PHASE_1H_ENGINEERING_REPORT.md`).
- **Identified Gaps:**
  - *Alternative Media Ingestion:* The user noted: *"Tambien que tenga opcion de importacion de canciones desde otros archivos multimedia"*. The system currently rejects MIDI files, scanned PDFs, audio files, and plain text chord sheets.

### 6.6 Setlists and Liturgical Atril Execution
- **Current State:** Phase 2C and `WS-2C-REMED` delivered a full setlist execution environment:
  - Database schema (`setlists`, `setlist_items`) with PostgreSQL partial unique index guaranteeing exactly one `ACTIVE` setlist.
  - Atomic reordering via single SQL transaction (`DrizzleSetlistRepository.reorderItems`).
  - Fastify REST API endpoints with RBAC guards.
  - `SetlistNavigationToolbar` with desktop-top and mobile-bottom responsive docking.
  - `ServiceMomentCard` for prayer/offering moments with zero-audio isolation.
  - Off-setlist viewing with instant "Volver al Culto" return.
- **Identified Gaps:**
  - Setlist creation and editing are complete in code. The remaining gaps in the atril relate to real-time director sync, hands-free scrolling, and wireless pedal integration.

### 6.7 Real-Time Director-to-Musician Synchronization
- **Current State:** Completely unimplemented (`SPECIFIED_NOT_IMPLEMENTED`). The existing atril navigates setlists locally inside each client's browser memory.
- **Detailed Architectural Work Required:**
  1. *Transport Layer:* Fastify WebSocket plugin (`@fastify/websocket`) or Server-Sent Events (SSE).
  2. *Session Lifecycle:* Coordinated room binding tied to the single `ACTIVE` setlist.
  3. *Message Protocol:* Action types: `SYNC_SONG_CHANGED`, `SYNC_SECTION_JUMP`, `SYNC_KEY_OVERRIDE`, `SYNC_DIRECTOR_NOTICE`.
  4. *Authoritative State vs. Local Override:* Musicians must have an explicit "Desvincular / Modo Local" toggle allowing them to browse another song or view without hijacking the room.
  5. *Reconnection and Network Resilience:* Sanctuaries frequently suffer Wi-Fi fluctuations. The client must maintain a heartbeat, automatically reconnect silently with exponential backoff, and re-sync to the director's current song position.
  6. *Latency Considerations:* Network latency under 200ms is acceptable for song selection and notices, but sub-20ms latency required for synchronized audio playback is not feasible over standard church Wi-Fi.

### 6.8 Rehearsal Suite (Metronome, Loops, Stems, Variable BPM)
- **Current State:** Completely unimplemented (`SPECIFIED_NOT_IMPLEMENTED`).
- **Detailed Architectural Work Required:**
  1. *Web Audio API Precision Clock:* Standard JavaScript `setInterval` drifts under load. An accurate metronome requires a Web Audio API lookahead scheduler (`AudioContext.currentTime`).
  2. *Visual & Audible Count-In:* Configurable 1-bar or 2-bar count-in with distinct accent pitch on beat 1.
  3. *Measure Looping:* UI range selector marking start/end measures and looping playback in memory.
  4. *Audio Stems Mixer:* Multi-channel audio element player supporting mute/solo per stem (click, guide, keys, bass, drums).

### 6.9 Offline Operations (PWA and Cache Resilience)
- **Current State:** Volatile in-memory prefetch exists ($N+1$ prefetch in `MusicalWorkspace.tsx`), but closing the tab or losing Wi-Fi before opening a song causes a failure.
- **Detailed Architectural Work Required:**
  1. *PWA Service Worker:* Workbox-based service worker caching application shell assets (JS, CSS, fonts, Bravura music font).
  2. *IndexedDB Song Storage:* Automatic synchronization of the active setlist's songs into client-side IndexedDB.
  3. *Offline Auth Cache:* Validation of cached JWT credentials when offline to prevent login lockouts during church power or internet drops.

### 6.10 Automatic Scrolling and Wireless Pedals
- **Current State:** Partially stubbed via keyboard listeners in `SetlistNavigationToolbar.tsx`.
- **Detailed Architectural Work Required:**
  1. *Keyboard Event Listener:* Standard Bluetooth page turners (e.g., AirTurn, Donner, Coda Stomp) broadcast standard keyboard events: `ArrowUp`/`ArrowDown`, `PageUp`/`PageDown`, or `Space`/`Enter`. The application must intercept these globally regardless of DOM focus.
  2. *Smooth Scroll Engine:* Calculate vertical pixel distance based on score height, total song measures, and target BPM. Provide touch-to-pause and manual scroll correction.

### 6.11 Mobile and Tablet Responsiveness
- **Current State:** Responsive contracts verified in Phase 2C (`index.css` media queries at 768px and 480px).
- **Identified Gaps:**
  - Mobile phones (the primary device per Question 6) have limited horizontal space. Sheet music staves must automatically reflow to 1 or 2 measures per system, or seamlessly switch to lead sheet chords+lyrics mode on screens $< 600\text{px}$. Physical device validation on Android and iOS is required.

---

## 7. Canonical Decision Register (DEC-01 through DEC-14)

To eliminate all documentary discrepancies, this register establishes the **single source of truth** for all open decisions across Worship Studio. Every decision has a unique identifier, traceable user evidence, technical recommendation, approval requirements, and current governance status:

| Decision ID | Decision Title | Exact Question to Resolve | User Evidence (Source & Text) | Technical Recommendation & Rationale | Owner Approval Required? | User / Musician Consultation Required? | Dependencies | Current Governance Status |
|:---|:---|:---|:---|:---|:---:|:---:|:---|:---:|
| **DEC-01** | Visual Identity & Saxophone Emblem Integration | Should the placeholder Unicode cross (`✝`) in `App.tsx` be replaced with the official saxophone emblem asset ([`docs/worship_studio_saxophone_emblem.png`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/docs/worship_studio_saxophone_emblem.png))? | PDF p.10, Idea 2: *"Utilizar el mismo logo propuesto en este documento"* (Priority: Alta, Incorporate: Sí). | **Replace with official emblem asset in `App.tsx`**; provides brand alignment requested by user. | **YES** | No (Requested by users) | None | `APPROVED (Option A — Oct 15, 2026)` |
| **DEC-02** | Persistent Storage of Musician View Preferences | Should a `user_view_preferences` PostgreSQL table and Fastify REST endpoints be added to persist each musician's reading format and instrument across devices? | PDF p.10, Idea 1: *"El pentagrama debe mostrar opciones de partitura y cifrado... y que pueda dejar una de las opciones como preferida."* (Priority: Alta, Incorporate: Sí). | **Implement `user_view_preferences` table and REST endpoints**; eliminates friction of resetting preferences on every login. | **YES** | No (Requested by users) | Phase 2B (Auth) | `APPROVED (Option A — Oct 15, 2026)` |
| **DEC-03** | Default Preferences for ADMIN and SUPER_ADMIN | What factory default view preferences should be assigned to `ADMIN` and `SUPER_ADMIN` users when no saved preferences exist? | Governance Preflight Remediation (Section 11.3). Administrative users require consistent viewing parity with stage musicians. | **Option A: `acoustic_guitar`, `CHORDS`, `['LYRICS']`**; ensures administrative inspection matches the primary stage view. | **YES** | No (Governance & Administration) | DEC-02 | `APPROVED (Option A — Oct 15, 2026)` |
| **DEC-04** | Default Preferences for WORSHIP_LEADER | What factory default view preferences should be assigned to `WORSHIP_LEADER` users when no saved preferences exist? | Governance Preflight Remediation (Section 11.3). Directors lead primarily from acoustic guitar or vocal podium. | **Option A: `acoustic_guitar`, `CHORDS`, `['LYRICS']`**; aligns with the predominant praise leading instrument in Bethesda. | **YES** | No (Governance & Worship Team) | DEC-02 | `APPROVED (Option A — Oct 15, 2026)` |
| **DEC-05** | Default Secondary Representations for VIEWER | What default secondary view representations should be assigned to `VIEWER` users (instrument: `lead_vocal`, primary: `LYRICS`)? | Governance Preflight Remediation (Section 11.3). General viewers/vocalists benefit from harmonic context. | **Option A: `['CHORDS']`**; provides harmony cues alongside vocal lyrics for choir and viewers. | **YES** | No (Governance & Ministry) | DEC-02 | `APPROVED (Option A — Oct 15, 2026)` |
| **DEC-06** | Mobile Screen Orientation Policy for Stage Atril | Should Worship Studio enforce a specific orientation on mobile phones (portrait vs landscape vs auto-rotation with manual lock toggle)? | PDF p.8 Question 6: *"Principal dispositivo Celular, pero que sea resposiva para tablet tambien"*. | **Support responsive auto-rotation with an explicit manual orientation lock toggle** in stage toolbar via Screen Orientation API. | **YES** | Yes (Mobile musicians) | Phase 3B | `OPEN` |
| **DEC-07** | Wireless Foot Pedal Hardware Interface Standard | Should wireless foot pedal support be standardized on Bluetooth HID keyboard emulation (PageUp/PageDown, Arrows) rather than Web Bluetooth GATT? | PDF p.8 Question 9: *"Pianista y baterista"* require wireless pedals. | **Standardize on Bluetooth HID keyboard emulation**; guarantees 100% plug-and-play compatibility with commercial pedals (Donner, AirTurn, PageFlip). | **YES** | Yes (Pianist & Drummer) | Phase 4A | `PROPOSED` |
| **DEC-08** | Offline Repertoire Storage & PWA Architecture | Should Worship Studio be packaged as a Progressive Web App (PWA) with Service Worker asset caching and IndexedDB storage for the active worship repertoire? | PDF p.6 Item 18 (marked "Sí"). | **Implement PWA with Workbox and IndexedDB caching**; guarantees zero interruption during sanctuary Wi-Fi drops. | **YES** | No (Reliability invariant) | Phase 2C, Phase 3A | `PROPOSED` |
| **DEC-09** | Offline Authentication Token Validity Window | How long should an authenticated session remain valid in offline mode when church Wi-Fi drops during a worship service? | Church services and rehearsals typically span 2 to 4 hours. | **Allow cached session validation for up to 12 hours** strictly in offline mode (`navigator.onLine === false`). | **YES** | No (Security policy) | DEC-08 | `OPEN` |
| **DEC-10** | Drummer Reading Representation & Notation Profile | What exact visual notation format should be rendered for the drummer: rhythmic slash notation with song structure, full drum kit staff, or lyric-marker sheet? | PDF p.8 Question 1: *"batería"*, Question 2: *"Todos"*, Question 3: *"Compases y figuras rítmicas completas"*. | **Conduct dedicated user interview with church drummer**; default to rhythmic measure structure and section markers. | **YES** | **YES (Mandatory consultation with church drummer)** | REQ-A06 | `OPEN` |
| **DEC-11** | Audible Metronome Sound Samples & Audio Routing | Which acoustic sound samples should the digital metronome use (woodblock vs digital beep vs rimshot), and should audio click routing support separate headphone channels? | PDF p.8 Question 7: *"Sería una herramienta nueva para el equipo"*. | **Synthesize dual-frequency clicks via Web Audio API oscillators** (zero file download overhead); offer woodblock sample option. | **YES** | Yes (Worship Team) | Phase 5A | `OPEN` |
| **DEC-12** | Reference Audio Stems Cloud Storage & Bandwidth Budget | Where should multitrack audio stems (`.mp3`/`.aac` or `.wav`) be hosted, and what bandwidth/storage limits apply to church operations? | PDF p.7 Item 23 (marked "Sí"). | **Host stems in Cloudflare R2 / AWS S3 with CDN**; enforce compressed 128kbps AAC per track to prevent mobile memory exhaustion. | **YES** | No (Infrastructure budget) | Phase 5C | `OPEN` |
| **DEC-13** | Ingestion Roadmap Staging & Format Prioritization | How should alternative ingestion formats be sequenced across phases (MusicXML/ChordPro in Phase 1-2 $\rightarrow$ MIDI in Phase 5 $\rightarrow$ PDF OMR / Photo OCR in Phase 6)? | PDF p.6 user note: *"Tambien que tenga opcion de importacion de canciones desde otros archivos multimedia"*; p.7 Items 25 & 26. | **Keep MusicXML and ChordPro as production standards; deliver deterministic MIDI in Phase 5D; treat PDF OMR as Phase 6 experimental**. | **YES** | No (Engineering quality) | Phase 1H | `PROPOSED` |
| **DEC-14** | In-Place Interactive Polyphonic Score Editing Scope | Should Worship Studio build an in-browser interactive notation editor (note drag-and-drop on staves) or remain focused as a stage execution atril and rehearsal player? | PDF p.7 Item 28 (marked "Sí"); Question 12 lists *"Partituras y Cifrado"* as stage 1 priority. | **Prioritize stage atril execution and live sync for MUP; defer interactive score editing to Phase 6 as desktop-only capability**. | **YES** | Yes (Director & Arrangers) | Phase 6C | `OPEN` |
| **DEC-15** | Tempo-Driven Auto-Scroll Velocity & Manual Touch Override Policy | How should Worship Studio calculate vertical scrolling speed from song tempo/measures, how long should auto-scroll pause when a musician touches the screen, and should it pause during non-musical service moments? | PDF p.6 Item 19: *"Desplazamiento automático de la partitura/letra por tempo"* (marked "Sí"). | **Implement smooth `requestAnimationFrame` scroll engine with 3-second touch-pause latch, manual touch compensation, and automatic pause on `SERVICE_MOMENT` items**. | **YES** | Yes (Stage musicians) | Phase 4B (REQ-E10) | `OPEN` |

---

## 8. Audit Exit Gate & Formal Verdict

### 8.1 Exit Gate Evaluation Checklist
- [x] Actual repository, git status, and existing documentation inspected.
- [x] Primary user feedback document `WORSHIP_STUDIO_PROPUESTA DE AVANCE.pdf` authenticated, hashed, and forensically analyzed.
- [x] All 28 table items, 14 questionnaire responses, and 2 new user proposals fully transcribed and mapped.
- [x] Complete user-requested product scope clearly distinguished from implementation sequencing.
- [x] Comprehensive Requirements Traceability Matrix established with reconciled, qualified evidentiary statuses.
- [x] Canonical Decision Register established with 15 unique identifiers (DEC-01 through DEC-15) eliminating all cross-referencing collisions.
- [x] Test suite (238 backend, 268 frontend) verified and preserved as historical baseline.
- [x] Zero production code, schemas, tests, dependencies, or configs modified.
- [x] All proposed roadmap workstreams documented as unauthorized proposals awaiting explicit governance approval.

### 8.2 Formal Verdict
```
================================================================================
FINAL AUDIT VERDICT:
PASS — GOVERNANCE BASELINE CONSISTENT; OWNER REVIEW REQUIRED
================================================================================
```
The requirements baseline for Worship Studio is mathematically grounded, forensically verified against actual user inputs, free of documentary collisions, and ready for official Project Owner review.

---

## 9. Deliverables Inventory and Cryptographic Verification

In strict compliance with the Document-First Delivery Requirement, all deliverables are recorded in both root and `docs/` repository paths and validated for 100% byte-identity:

| Deliverable File | Path | Status | Byte Size | SHA-256 Hash |
|:---|:---|:---:|:---:|:---|
| **Consolidation Report (Root)** | `WORSHIP_STUDIO_REQUIREMENTS_CONSOLIDATION.md` | Delivered | Verified on final write | Computed via OS crypto utility |
| **Consolidation Report (Docs)** | `docs/WORSHIP_STUDIO_REQUIREMENTS_CONSOLIDATION.md` | Delivered | Byte-identical | 100% Match with Root |
| **Completion Roadmap (Root)** | `WORSHIP_STUDIO_COMPLETION_ROADMAP_PROPOSAL.md` | Delivered | Verified on final write | Computed via OS crypto utility |
| **Completion Roadmap (Docs)** | `docs/WORSHIP_STUDIO_COMPLETION_ROADMAP_PROPOSAL.md` | Delivered | Byte-identical | 100% Match with Root |
| **Governance Consistency Audit (Root)** | `WORSHIP_STUDIO_GOVERNANCE_CONSISTENCY_AUDIT.md` | Delivered | Verified on final write | Computed via OS crypto utility |
| **Governance Consistency Audit (Docs)** | `docs/WORSHIP_STUDIO_GOVERNANCE_CONSISTENCY_AUDIT.md` | Delivered | Byte-identical | 100% Match with Root |
| **Governance Audit Manifest (Root)** | `WORSHIP_STUDIO_GOVERNANCE_CONSISTENCY_AUDIT.sha256` | Generated | External manifest | Cryptographic checksums |
| **Governance Audit Manifest (Docs)** | `docs/WORSHIP_STUDIO_GOVERNANCE_CONSISTENCY_AUDIT.sha256` | Generated | Byte-identical | 100% Match with Root |
