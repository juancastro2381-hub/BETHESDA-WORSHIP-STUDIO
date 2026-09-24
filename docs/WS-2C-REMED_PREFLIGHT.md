# WS-2C-REMED — TECHNICAL PREFLIGHT
## UI Authoring, Item Management, and Setlist Lifecycle Remediation

**Project:** Bethesda Worship Studio  
**Organization:** Iglesia Cristiana Bethesda — Madrid, Cundinamarca, Colombia  
**Phase:** 2C — Setlist Management, Service Moments & Liturgical Worship Flow  
**Proposed Workstream:** WS-2C-REMED — UI Remediation & Item Authoring  
**Author:** Lead Software Architect & Preflight Auditor  
**Date:** September 21, 2026  
**Status:** PROPOSED — NOT AUTHORIZED (PREFLIGHT ONLY)  
**Deliverable Path:** `WS-2C-REMED_PREFLIGHT.md` (and synchronized `docs/WS-2C-REMED_PREFLIGHT.md`)  

---

## 1. Executive Summary

During the formal, read-only audit of Phase 2C (`PHASE_2C_FUNCTIONAL_VISUAL_AUDIT.md`), the core liturgical atril execution pipeline was verified as fully operational across desktop and mobile devices. However, the audit identified three functional presentation gaps where backend endpoints and frontend API client methods exist, but are not yet surfaced in the user interface:
1. **`GAP-01` (Medium Severity):** Inability to author setlist items (add canonical songs or liturgical service moments) directly from the browser UI.
2. **`GAP-02` (Medium Severity):** Inability to visually reorder items within a setlist from the browser UI.
3. **`GAP-03` (Low Severity):** Inability to edit setlist metadata (title, scheduled date, notes) or delete setlists from the browser UI.

This technical preflight evaluates the feasibility, architecture, risk profile, RBAC compliance, and scope boundaries for a focused remediation workstream: **`WS-2C-REMED`**.

### Core Preflight Findings:
- **Zero Database Changes:** The PostgreSQL schema (`setlists`, `setlist_items`) and constraints (`idx_setlists_single_active`) fully support all required authoring operations.
- **Zero API Changes:** The Fastify REST API already exposes all 10 necessary endpoints under `/api/v1/setlists` with runtime RBAC guards and atomic transactions.
- **Zero New Dependencies:** The entire authoring, reordering, and metadata UI can be implemented using native React 18, standard DOM controls, and existing CSS tokens.
- **Zero Musical Domain Disruption:** The remediation is strictly confined to setlist authoring UI components; `CanonicalMusicPayload`, projection pipelines, transposition math, and score renderers are completely untouched.
- **Implementation Status:** **STRICTLY NOT AUTHORIZED.** This document is a preflight analysis only.

---

## 2. Authorization Status

```
===============================================================================
WORKSTREAM STATUS:           PROPOSED
AUTHORIZATION STATUS:        NOT AUTHORIZED (READ-ONLY PREFLIGHT)
IMPLEMENTATION CODE:         STRICTLY PROHIBITED BY THIS TASK
NEXT GOVERNANCE ACTION:      PROJECT OWNER REVIEW & EXPLICIT AUTHORIZATION
===============================================================================
```

This preflight does **NOT** authorize code modifications. Execution is completely halted pending explicit approval from the project owner.

---

## 3. Audit Findings Being Remediated

The authoritative audit (`PHASE_2C_FUNCTIONAL_VISUAL_AUDIT.md`) classified exactly three findings:

| Finding ID | Severity | Capability | Current Backend State | Current Client State | Current UI State | Remediation Objective |
|:---|:---:|:---|:---:|:---:|:---:|:---|
| **GAP-01** | Medium | Setlist Item Authoring | `POST /:id/items` (Operational) | `addSetlistItem()` (Operational) | Not exposed in `SetlistsModal` | Provide in-modal UI to search canonical songs and configure service moments. |
| **GAP-02** | Medium | Item Reordering | `PUT /:id/reorder` (Atomic SQL) | `reorderSetlist()` (Operational) | Not exposed in `SetlistsModal` | Provide accessible Move Up / Move Down buttons ($\ge 48\text{px}$) to reorder sequence. |
| **GAP-03** | Low | Metadata Edit & Deletion | `PUT /:id`, `DELETE /:id` (Operational)| `updateSetlist()`, `deleteSetlist()` | Not exposed on setlist cards | Provide edit metadata modal/form and secure delete action with confirmation dialog. |

---

## 4. Repository Evidence

Forensic inspection of the repository verified the exact assets that exist and will be reused:

### 4.1 Backend Infrastructure (`backend/src/`)
- **Routes:** `backend/src/interfaces/http/routes/setlist.routes.ts` registers all 10 endpoints.
- **Schemas:** `backend/src/interfaces/http/schemas/setlist.schemas.ts` defines Zod validation schemas:
  - `CreateSongItemPayloadSchema`: validates `songId` (UUID), `targetKey` (max 16 chars), `targetBpm` (20–300), `transitionType` (`SEGUE`, `CROSSFADE`, `STOP`, `MEDLEY`), `notesForTeam`.
  - `CreateServiceMomentItemPayloadSchema`: validates `momentTitle` (1–255 chars), `durationMinutes` (1–180), `musicalKey` (max 16 chars), `notesForTeam`, and forbids `songId`.
  - `ReorderSetlistItemsBodySchema`: validates non-empty UUID array with zero duplicates.
  - `UpdateSetlistBodySchema`: validates `title`, `scheduledDateTime`, `notes`.
- **Application Logic:** `backend/src/application/setlist-service.ts` enforces single ACTIVE invariant, finalized setlist immutability, and transactional atomic reordering.
- **Repository:** `backend/src/repositories/setlist-repository.ts` manages SQL transactions with sequence gap compaction.

### 4.2 Frontend Client & State (`frontend/src/`)
- **API Client:** `frontend/src/core/api/api-client.ts` exposes:
  - `addSetlistItem(setlistId, item)`
  - `updateSetlistItem(setlistId, itemId, item)`
  - `deleteSetlistItem(setlistId, itemId)`
  - `reorderSetlist(setlistId, itemIds)`
  - `updateSetlist(id, payload)`
  - `deleteSetlist(id)`
  - `listSongs({ limit, search })`
- **Execution Hook:** `frontend/src/core/workspace/use-setlist-execution.ts` maintains execution state and auto-refreshes when loaded setlists are updated.
- **Active Components:** `SetlistsModal.tsx`, `SetlistNavigationToolbar.tsx`, `ServiceMomentCard.tsx`, `DatabaseSongsModal.tsx`.

---

## 5. Current Architecture vs. Remediated Architecture

### Current User Flow:
```
[ Login ] ──► [ Open Repertorios Modal ] ──► [ View Setlist Cards ] ──► [ Cargar en Atril ]
                      │
                      └──► [ + Nuevo Repertorio ] (Header only, 0 items)
```
*Limitation:* If a setlist has no items, the user cannot add songs from the UI. Items can currently only be seeded or added via curl/Postman.

### Remediated User Flow:
```
[ Login ] ──► [ Open Repertorios Modal ]
                      │
                      ├─► [ + Nuevo Repertorio ] ──► Creates Setlist
                      │
                      ├─► [ Administrar Ítems ] ──► Opens Setlist Detail Editor
                      │                                 │
                      │                                 ├─► [ + Canción ] ──► Song Picker (DB)
                      │                                 ├─► [ + Momento ] ──► Liturgical Form
                      │                                 ├─► [ ▲ / ▼ ]     ──► Reorder Sequence
                      │                                 ├─► [ 🗑️ Eliminar ]──► Delete Item
                      │                                 └─► [ ✏️ Editar ]   ──► Edit Metadata
                      │
                      └─► [ Cargar en Atril ] ──► Full Live Worship Execution
```

---

## 6. GAP-01 Preflight — Setlist Item Authoring

### 6.1 Adding a SONG Item
- **Source of Canonical Songs:** Reuses `client.listSongs({ limit: 100 })` from the existing song catalog (251 songs available in the database).
- **Required Fields:**
  - `songId` (UUID): selected from catalog dropdown or modal picker.
- **Optional Overrides:**
  - `targetKey` (string): pre-populated with song's `defaultKey`, editable by leader.
  - `targetBpm` (number): pre-populated with song's `defaultBpm`, editable (20–300).
  - `transitionType` (enum): select option (`STOP`, `SEGUE`, `CROSSFADE`, `MEDLEY`), defaults to `STOP`.
  - `notesForTeam` (string): textarea for rehearsal directions.
- **Recommended UI Approach:** A clean, collapsible sub-panel within the Setlist Detail Editor with search-as-you-type input filtering songs by title or artist.

### 6.2 Adding a SERVICE_MOMENT Item
- **Domain Constraint:** `songId` must NOT be sent.
- **Required Fields:**
  - `momentTitle` (string): 1–255 characters (e.g. "Oración de Apertura", "Momento de Ofrenda").
- **Optional Fields:**
  - `durationMinutes` (number): 1–180 minutes.
  - `musicalKey` (string): suggested Pad background key (e.g. "Re Mayor (D)").
  - `notesForTeam` (string): pastoral directions.
  - `transitionType` (enum): select option, defaults to `STOP`.
- **Validation:** Enforced client-side before dispatching `client.addSetlistItem()`.

---

## 7. GAP-02 Preflight — Reordering

### 7.1 Reordering Mechanism Comparison

| Mechanism | Mobile Stand Usability | Tablet Usability | Desktop Usability | Accessibility (WCAG) | Dependencies Required | Accidental Drop Risk | Recommendation |
|:---|:---:|:---:|:---:|:---:|:---:|:---:|
| **Option A: HTML5 Drag & Drop** | Very Poor (touch gestures conflict with scroll) | Poor | Good | Poor (no native keyboard) | 0 (Native HTML5) | High on touch | Not recommended alone |
| **Option B: Move Up / Down Buttons** | **Excellent ($\ge 48\text{px}$ touch targets)** | **Excellent** | **Excellent** | **Complete (keyboard & screen readers)** | **0 (Zero packages)** | **Zero (deterministic)** | **RECOMMENDED PRIMARY** |
| **Option C: Hybrid (Buttons + Drag)** | Good | Good | Excellent | Good | Moderate (touch dnd library required) | Moderate | Overkill for Phase 2C |

### 7.2 Technical Recommendation:
Implement **Option B (Move Up / Move Down controls)**:
- Each item row in the setlist displays `[ ▲ ]` and `[ ▼ ]` buttons.
- First item has `[ ▲ ]` disabled; last item has `[ ▼ ]` disabled.
- Minimum touch target: $48 \times 48\text{px}$ on mobile.
- Clicking Move Up/Down swaps adjacent IDs in the array and dispatches `client.reorderSetlist(setlistId, updatedItemIds)`.
- Backend executes `PUT /api/v1/setlists/:id/reorder` atomically within an SQL transaction and returns the reordered list.

---

## 8. GAP-03 Preflight — Metadata Edit & Deletion

### 8.1 Editing Setlist Metadata
- **Endpoint:** `PUT /api/v1/setlists/:id`
- **Fields:** `title` (required, 1–255), `scheduledDateTime` (optional ISO date), `notes` (optional text).
- **Permissions:** `setlists:update` (`SUPER_ADMIN`, `ADMIN`, `WORSHIP_LEADER`).
- **State Rule:** Allowed in `PLANNING` and `ACTIVE`. Prohibited in `COMPLETED` and `ARCHIVED`.

### 8.2 Deleting a Setlist
- **Endpoint:** `DELETE /api/v1/setlists/:id`
- **Permissions:** `setlists:delete` (`SUPER_ADMIN`, `ADMIN` ONLY).
- **Critical RBAC Finding:** `WORSHIP_LEADER` has **NO** `setlists:delete` permission. The delete button must be **HIDDEN** for Worship Leaders and Musicians.
- **Safety Requirement:** Destructive action requires an explicit confirmation modal with warning: *"Esta acción eliminará permanentemente la secuencia litúrgica. Las canciones del cancionario no se verán afectadas."*

---

## 9. RBAC Matrix for Remediation UI

| Action | HTTP Endpoint | Required Permission | SUPER_ADMIN | ADMIN | WORSHIP_LEADER | MUSICIAN | VIEWER | Unauthenticated |
|:---|:---|:---|:---:|:---:|:---:|:---:|:---:|:---:|
| **Create Setlist** | `POST /setlists` | `setlists:create` | **ALLOW** | **ALLOW** | **ALLOW** | HIDDEN | HIDDEN | HIDDEN |
| **Add Item (Song/Moment)**| `POST /:id/items` | `setlists:update` | **ALLOW** | **ALLOW** | **ALLOW** | HIDDEN | HIDDEN | HIDDEN |
| **Delete Item** | `DELETE /:id/items/:itemId` | `setlists:update` | **ALLOW** | **ALLOW** | **ALLOW** | HIDDEN | HIDDEN | HIDDEN |
| **Reorder Items** | `PUT /:id/reorder` | `setlists:reorder` | **ALLOW** | **ALLOW** | **ALLOW** | HIDDEN | HIDDEN | HIDDEN |
| **Edit Setlist Metadata** | `PUT /:id` | `setlists:update` | **ALLOW** | **ALLOW** | **ALLOW** | HIDDEN | HIDDEN | HIDDEN |
| **Delete Setlist** | `DELETE /:id` | `setlists:delete` | **ALLOW** | **ALLOW** | **HIDDEN** | HIDDEN | HIDDEN | HIDDEN |
| **Activate Setlist** | `POST /:id/status` | `setlists:activate` | **ALLOW** | **ALLOW** | **ALLOW** | HIDDEN | HIDDEN | HIDDEN |
| **Load in Atril** | `GET /:id` | `setlists:read` | **ALLOW** | **ALLOW** | **ALLOW** | **ALLOW** | **ALLOW** | HIDDEN |

---

## 10. State Machine Compatibility

The UI must reflect the lifecycle constraints enforced by `SetlistService`:

| Operation | PLANNING | ACTIVE | COMPLETED | ARCHIVED |
|:---|:---:|:---:|:---:|:---:|
| **Add Song / Service Moment** | ALLOW | ALLOW | DISABLED (Rule C) | DISABLED (Rule C) |
| **Delete Item** | ALLOW | ALLOW | DISABLED (Rule C) | DISABLED (Rule C) |
| **Reorder Items** | ALLOW | ALLOW | DISABLED (Rule C) | DISABLED (Rule C) |
| **Edit Metadata** | ALLOW | ALLOW | DISABLED (Rule C) | DISABLED (Rule C) |
| **Delete Setlist** | ALLOW | ALLOW | ALLOW | ALLOW |
| **Load in Atril** | ALLOW | ALLOW | ALLOW | ALLOW |

When viewing a setlist in `COMPLETED` or `ARCHIVED` status, the editor switches to a read-only inspection mode, rendering an informational pill: *"Repertorio finalizado — Modo de solo lectura"*.

---

## 11. API Contract Analysis

- **New Endpoints Required:** **ZERO (0)**.
- **Modifications to Existing Endpoints:** **ZERO (0)**.
- **Schema Changes:** **ZERO (0)**.
- All needed operations are already serviced by the 10 Fastify endpoints delivered in WS5.

---

## 12. Database Impact

- **Schema Changes:** **ZERO (0)**.
- **New Migrations:** **ZERO (0)**.
- Existing tables `setlists` and `setlist_items`, foreign keys, cascade delete constraints, and the partial unique index `idx_setlists_single_active` are 100% sufficient.

---

## 13. Musical Domain Protection

- **`CanonicalMusicPayload`:** Remains completely untouched and immutable.
- **Transposition Math:** Continues to use WS6 `calculateTranspositionSemitones`.
- **Renderer Adapters:** No modifications to alphaTab, OSMD, or LeadSheetDOM.
- **Workspace Orchestration:** Musical workspace remains an isolated consumer of setlist state.

---

## 14. UX & Accessibility Preflight

- **Semantic Tags:** Form groups wrapped in `<fieldset>`, buttons with descriptive `aria-label` (e.g. `aria-label="Mover Gracia Sublime hacia arriba"`).
- **Focus Management:** Focus trapped inside modal; restored to trigger button on close.
- **Escape Key:** Dismisses sub-forms or returns to catalog view.
- **Touch Targets:** All interactive icons and buttons enforce $\ge 48 \times 48\text{px}$ minimum bounding box on touch screens.
- **Destructive Actions:** Delete operations styled with red danger tokens and require modal confirmation.

---

## 15. Responsive Design Preflight

- **Desktop ($\ge 1024\text{px}$):** Expanded two-column layout: left column displays setlist metadata and item sequence; right column displays add-item form and song search preview.
- **Tablet ($768\text{px} - 1023\text{px}$):** Single column with collapsible accordion sections for adding items.
- **Mobile ($< 768\text{px}$):** Full-screen modal overlay with sticky save actions and stacked item rows.

---

## 16. Error Handling Preflight

The remediation UI will cleanly handle Fastify error responses via `ApiError`:
- **400 Bad Request:** Form validation errors highlighted adjacent to inputs.
- **401 Unauthorized:** Prompts re-login without destroying dirty form state.
- **403 Forbidden:** Display alert: *"No cuenta con permisos para modificar repertorios"*.
- **404 Not Found:** Re-fetches catalog and informs user that setlist was deleted.
- **409 Conflict:** Displays church conflict alert: *"Ya existe otro culto activo o el repertorio fue finalizado por otro usuario"*.

---

## 17. Concurrency Preflight

- **Optimistic vs. Server-Confirmed:** All reorder and item operations will use **server-confirmed updates**. The UI will display a discrete spinner on the active item during network dispatch and update the sequence only after HTTP 200/201 response.
- **Conflict Handling:** If another user finalizes a setlist while a leader has it open, any attempt to add or reorder items returns HTTP 409, which the UI presents as an inline alert and reloads the setlist into read-only mode.

---

## 18. Test Strategy Preflight

If authorized, WS-2C-REMED will implement a focused automated test suite (`frontend/src/core/workspace/__tests__/setlist-authoring-remed.test.ts`):
1. Adding a `SONG` item with valid `songId`, `targetKey`, and `transitionType`.
2. Adding a `SERVICE_MOMENT` item with `momentTitle`, `durationMinutes`, and Pad key.
3. Rejecting `SERVICE_MOMENT` creation if `songId` is supplied.
4. Swapping item sequence via Move Up / Move Down buttons.
5. Verifying boundary disabling (Move Up disabled for item 0, Move Down disabled for item $N-1$).
6. Updating setlist metadata via `updateSetlist`.
7. Deleting a setlist via `deleteSetlist` with confirmation.
8. Enforcing RBAC UI gating (Worship Leader cannot see delete setlist button).
9. Enforcing state machine immutability (Controls disabled in `COMPLETED` / `ARCHIVED`).
10. Preserving 100% passing baseline across all 447 existing regression tests.

---

## 19. Dependency Audit

- **New Dependencies Required:** **ZERO (0)**.
- Reordering implemented via pure React state array manipulation and API dispatch.
- Dialogs, forms, and accordions implemented using existing vanilla CSS tokens.

---

## 20. Security Preflight

- All mutations protected by JWT Bearer header and Fastify `AuthGuard`.
- Real-time PostgreSQL database check (`verifyDatabaseRole: true`) actively enforced on all mutating routes.
- Audit logging: Fastify automatically logs `SETLIST_CREATED`, `SETLIST_ACTIVATED`, and `SETLIST_DELETED`.

---

## 21. Proposed Implementation Boundary

If authorized, WS-2C-REMED should be executed as a **single, unified remediation workstream** consisting of 3 focused milestones:
- **Milestone 1:** Setlist Item Authoring UI (`SetlistDetailEditor` component with song picker and moment form).
- **Milestone 2:** Item Reordering UI (Move Up / Move Down controls with atomic API reorder).
- **Milestone 3:** Metadata Edit & Deletion UI (Edit modal + delete confirmation with strict RBAC).

---

## 22. Out-of-Scope Confirmation

The following capabilities are strictly **EXCLUDED** from WS-2C-REMED:
- MIDI, Audio, OMR, PDF Ingestion.
- Rehearsal Metronome & Web Audio Looping.
- Real-time WebSockets & Director-Follower synchronization.
- PWA Offline Caching & IndexedDB.
- Interactive Polyphonic Score Editing.

---

## 23. Risks

| Risk Category | Description | Severity | Mitigation |
|:---|:---|:---:|:---|
| **UX Clutter** | Overloading `SetlistsModal` with too many editing controls. | Medium | Use a clean sub-view pattern (`catalog` $\leftrightarrow$ `detail/editor`) within the modal. |
| **Mobile Touch Target** | Reorder buttons too small on mobile atril stands. | Medium | Enforce strict $\ge 48 \times 48\text{px}$ touch targets. |
| **RBAC Leak** | Exposing setlist delete button to Worship Leaders. | High | Strict frontend check: `user.role === 'ADMIN' \|\| user.role === 'SUPER_ADMIN'`. |
| **State Desync** | Editing a setlist currently loaded in the atril. | Low | On item mutation, notify `useSetlistExecution` to reload active setlist silently. |

---

## 24. Open Decisions Requiring Project Owner Authorization

Before authorizing implementation, the project owner should decide:
1. **Reorder UI Paradigm:**
   - *Option A (Recommended):* Move Up / Move Down buttons ($\ge 48\text{px}$, zero dependencies, mobile & touch stand optimized).
   - *Option B:* Dual controls (Move Up/Down buttons + native HTML5 desktop drag handles).
2. **Song Selection UX:**
   - *Option A (Recommended):* Searchable dropdown/combobox querying the existing 251 database songs.
   - *Option B:* Secondary modal picker styled like `DatabaseSongsModal`.
3. **Execution Milestone:**
   - *Option A:* Authorize `WS-2C-REMED` immediately to achieve 100% UI feature completeness for Phase 2C before formal closure.
   - *Option B:* Formally close Phase 2C as-is (with documented limitations) and implement item authoring in Phase 3.

---

## 25. Implementation Readiness

$$\mathbf{PREFLIGHT\ VERDICT:\ READY\ WITH\ OPEN\ DECISIONS}$$

The technical architecture, backend APIs, data contracts, and security guards are 100% prepared. Implementation may proceed **only after explicit authorization from the project owner**.

---

## 26. Proposed High-Level Implementation Sequence

1. **Step 1:** Construct `SetlistDetailEditor.tsx` sub-component for item authoring.
2. **Step 2:** Integrate canonical song picker with target key and transition selectors.
3. **Step 3:** Integrate service moment creation form.
4. **Step 4:** Implement Move Up / Move Down buttons and wire to `client.reorderSetlist()`.
5. **Step 5:** Implement metadata edit form and delete confirmation dialog (with ADMIN-only gating).
6. **Step 6:** Mount editor inside `SetlistsModal.tsx`.
7. **Step 7:** Implement automated test suite covering all authoring flows.
8. **Step 8:** Run complete regression test suite (verify 447+ tests PASS, 0 TypeScript errors).
9. **Step 9:** Execute Exit Gate and deliver final engineering report.

---

## 27. Exit Gate

The remediation workstream will be considered complete only if all criteria pass:
- [ ] `GAP-01` resolved: User can add songs and moments to a setlist from the UI.
- [ ] `GAP-02` resolved: User can reorder items in a setlist via Move Up / Down controls.
- [ ] `GAP-03` resolved: User can edit metadata and delete setlists with confirmation.
- [ ] Worship Leader cannot delete setlists (RBAC verified in UI and API).
- [ ] Minimum 48px touch targets verified for all reorder and action buttons.
- [ ] Fastify backend remains 100% unmodified (0 route changes, 0 schema changes).
- [ ] Canonical musical truth remains 100% immutable.
- [ ] Zero new npm dependencies added.
- [ ] All new remediation tests pass.
- [ ] Full regression suite passes with 0 failures.
- [ ] TypeScript compiler reports 0 errors across frontend and backend.
- [ ] Implementation report and byte-identical copies verified with external SHA-256.

---

## 28. Final Preflight Verdict

```
===============================================================================
WS-2C-REMED PREFLIGHT RESULT: READY WITH OPEN DECISIONS
AUTHORIZATION STATUS:         NOT AUTHORIZED
CODEBASE STATUS:              UNTOUCHED (0 changes made)
ACTION:                       STOP AND AWAIT USER DECISION
===============================================================================
```

---

## 29. SHA-256 Integrity Verification

To maintain cryptographic document integrity without self-referential paradoxes:
1. This authoritative preflight report is recorded in the repository root as `WS-2C-REMED_PREFLIGHT.md`.
2. A byte-identical copy is placed in `docs/WS-2C-REMED_PREFLIGHT.md`.
3. An external SHA-256 manifest file (`WS-2C-REMED_PREFLIGHT.sha256`) records the cryptographic hash of the finalized markdown representation.
4. Both files have been verified to possess identical byte counts and matching SHA-256 hashes using native cryptographic utilities (`certutil`).
