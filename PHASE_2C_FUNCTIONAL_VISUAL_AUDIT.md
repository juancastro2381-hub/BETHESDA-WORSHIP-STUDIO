# PHASE 2C — FUNCTIONAL, VISUAL, ROUTING, RBAC & INTEGRATION AUDIT
## Comprehensive Read-Only Audit of Phase 2C (WS1 through WS7)

**Project:** Bethesda Worship Studio  
**Organization:** Iglesia Cristiana Bethesda — Madrid, Cundinamarca, Colombia  
**Phase Audited:** 2C — Setlist Management, Service Moments & Liturgical Worship Flow  
**Workstreams Audited:** WS1 (Persistence), WS2 (Domain/RBAC/Zod), WS3 (Repository/Transactions), WS4 (Business Logic/Concurrency), WS5 (Fastify HTTP API), WS6 (API Client/Hook), WS7 (Visual Atril UI)  
**Date of Audit:** September 21, 2026  
**Auditor:** Lead QA Architect, UX Auditor & Integration Auditor  
**Audit Status:** COMPLETE — READ-ONLY  
**Deliverable Path:** `PHASE_2C_FUNCTIONAL_VISUAL_AUDIT.md` (and synchronized `docs/PHASE_2C_FUNCTIONAL_VISUAL_AUDIT.md`)  

---

## 1. Executive Summary

This document presents the official, read-only functional, visual, routing, role-based access control (RBAC), and API integration audit of **Phase 2C (Workstreams 1 through 7)** for the Bethesda Worship Studio.

The objective of this audit is to rigorously determine whether the functionality declared as implemented in Phase 2C engineering reports is:
1. Actually present in the repository codebase.
2. Exposed through the production user interface.
3. Accessible through intuitive, unbroken user flows.
4. Protected by runtime backend authorization and appropriate frontend UX gating.
5. Reliably connected to the live Fastify REST API and PostgreSQL database.
6. Capable of executing seamless liturgical worship transitions on physical music stands (*atriles*).

### Audit Verdict Summary
- **Classification:** **`PHASE 2C VERIFIED WITH DOCUMENTED LIMITATIONS`**
- **Core Atril Execution Flow:** **FUNCTIONAL & VERIFIED.** Authenticated users can access the setlist catalog, activate services, load setlists into the music stand, navigate sequentially with sticky top (desktop) or fixed bottom (mobile) toolbars, view dynamic transposition ($\Delta$ semitones), inspect pastoral service moments without notation overhead, and return safely from off-setlist views via *"Volver al Culto"*.
- **Security & RBAC:** **ENFORCED & VERIFIED.** Zero authentication bypass. Unauthenticated users cannot view or invoke setlists. Fastify guards verify JWT signatures and database roles on all mutating operations.
- **Identified UI Gaps:** While backend endpoints and frontend API client methods exist for full setlist item CRUD (`POST/PUT/DELETE /api/v1/setlists/:id/items`) and atomic transactional reordering (`PUT /api/v1/setlists/:id/reorder`), the current `SetlistsModal` UI does not yet expose interactive forms to attach songs/moments to a setlist or drag/reorder them from the browser interface.

---

## 2. Audit Scope

The audit covers all seven delivered workstreams of Phase 2C:
- **WS1 (Persistence Architecture):** Drizzle ORM schema, relations, and migration `0002_setlists_and_service_moments.sql`.
- **WS2 (Domain & Validation):** Permission registry (`setlists:*`), Zod validation schemas, and domain interfaces.
- **WS3 (Repository & Transactions):** `DrizzleSetlistRepository`, atomic sequence compaction, and transactional reordering.
- **WS4 (Business Rules & Concurrency):** `SetlistService`, state machine transitions, and TOCTOU concurrency remediation via partial unique index `0003_single_active_setlist_constraint.sql`.
- **WS5 (HTTP API Layer):** Fastify routes under `/api/v1/setlists`, `AuthGuard` middleware, audit logging, and HTTP error mapping.
- **WS6 (Frontend Client & Execution Hook):** `BethesdaApiClient` methods, pure harmonic transposition calculator (`calculateTranspositionSemitones`), and `useSetlistExecution` state machine.
- **WS7 (Visual Components & Atril Integration):** `SetlistsModal`, `SetlistNavigationToolbar`, `ServiceMomentCard`, and minimal internal composition in `MusicalWorkspace`.

---

## 3. Evidence Sources

The audit was conducted strictly against verified repository artifacts and live local runtimes:
- **Active Fastify Backend Server:** Running on port `3001` (`http://localhost:3001`).
- **Active Vite Frontend Client:** Running on port `5173` (`http://localhost:5173`).
- **Active PostgreSQL Database:** PostgreSQL 18.1 running on port `5432` (`bethesda_worship_dev`).
- **Codebase Source Tree:** `backend/src/` and `frontend/src/`.
- **Automated Test Suites:** 447 tests across 88 suites (Backend: 192, Frontend: 255).
- **TypeScript Compiler:** `tsc --noEmit` on both frontend and backend configurations.

---

## 4. Authentication Audit

### 4.1 Evaluation of Authentication Flow
1. **Application Startup:** The application starts cleanly without fatal exceptions or blank screens.
2. **Public Workspace Accessibility:** Unauthenticated users can immediately access the public `MusicalWorkspace` on `http://localhost:5173/`, explore Golden Scenarios A–D, switch instruments, and test local notation rendering.
3. **Login Entry Point:** Located in the top header (`.app-header .header-actions`), rendered via `UserProfileBadge.tsx`. When unauthenticated, it displays `<button id="open-login-modal-button">👤 Iniciar Sesión</button>`.
4. **Credential Capture & Verification:** Clicking the login button opens `LoginModal.tsx`. Submitting valid credentials (e.g., `admin@bethesda.org` / `BethesdaSuperAdmin2026!`) executes `POST /api/v1/auth/login`.
5. **Session Establishment:** The backend responds with HTTP 200, sets an HttpOnly refresh cookie, and returns an access token JWT. The token is stored purely in memory via `tokenManager`.
6. **Authentication Bypass Resistance:** Direct unauthenticated requests to `/api/v1/setlists` consistently return HTTP 401:
   ```json
   {
     "error": {
       "code": "UNAUTHORIZED",
       "message": "Autenticación requerida para acceder a este recurso.",
       "statusCode": 401
     }
   }
   ```
7. **Privileged Operation Protection:** Unauthenticated users cannot trigger setlist queries, creations, mutations, or deletions.

| Checkpoint | Expected Behavior | Observed Runtime Behavior | Status |
|:---|:---|:---|:---:|
| Public Workspace Access | Available without login | Operational on `http://localhost:5173/` | **PASS** |
| Login Button Visibility | Visible in header | Rendered with accessible name | **PASS** |
| JWT Issuance & Storage | Issued via POST /login, stored in memory | Token received; zero localStorage references | **PASS** |
| Unauthenticated Rejection | HTTP 401 on protected routes | Returns structured 401 JSON | **PASS** |
| Post-Login State Update | Header updates with user role badge | Name and role badge render immediately | **PASS** |

---

## 5. RBAC Audit

The repository defines 5 explicit user roles in `backend/src/domain/auth-types.ts` with zero implicit privilege inheritance. The actual runtime permissions for setlist operations were audited:

| Operation | HTTP Endpoint | Required Permission | SUPER_ADMIN | ADMIN | WORSHIP_LEADER | MUSICIAN | VIEWER | Unauthenticated |
|:---|:---|:---|:---:|:---:|:---:|:---:|:---:|:---:|
| **List Setlists** | `GET /api/v1/setlists` | `setlists:list` | ALLOW (200) | ALLOW (200) | ALLOW (200) | ALLOW (200) | ALLOW (200) | REJECT (401) |
| **Get Setlist Detail** | `GET /api/v1/setlists/:id` | `setlists:read` | ALLOW (200) | ALLOW (200) | ALLOW (200) | ALLOW (200) | ALLOW (200) | REJECT (401) |
| **Create Setlist** | `POST /api/v1/setlists` | `setlists:create` | ALLOW (201) | ALLOW (201) | ALLOW (201) | REJECT (403) | REJECT (403) | REJECT (401) |
| **Update Metadata** | `PUT /api/v1/setlists/:id` | `setlists:update` | ALLOW (200) | ALLOW (200) | ALLOW (200) | REJECT (403) | REJECT (403) | REJECT (401) |
| **Delete Setlist** | `DELETE /api/v1/setlists/:id` | `setlists:delete` | ALLOW (200) | ALLOW (200) | REJECT (403) | REJECT (403) | REJECT (403) | REJECT (401) |
| **Change Status** | `POST /api/v1/setlists/:id/status`| `setlists:activate`| ALLOW (200) | ALLOW (200) | ALLOW (200) | REJECT (403) | REJECT (403) | REJECT (401) |
| **Add Item** | `POST /api/v1/setlists/:id/items` | `setlists:update` | ALLOW (201) | ALLOW (201) | ALLOW (201) | REJECT (403) | REJECT (403) | REJECT (401) |
| **Modify Item** | `PUT /api/v1/setlists/:id/items/:i`| `setlists:update` | ALLOW (200) | ALLOW (200) | ALLOW (200) | REJECT (403) | REJECT (403) | REJECT (401) |
| **Delete Item** | `DELETE /api/v1/setlists/:id/items`| `setlists:update` | ALLOW (200) | ALLOW (200) | ALLOW (200) | REJECT (403) | REJECT (403) | REJECT (401) |
| **Reorder Items** | `PUT /api/v1/setlists/:id/reorder`| `setlists:reorder`| ALLOW (200) | ALLOW (200) | ALLOW (200) | REJECT (403) | REJECT (403) | REJECT (401) |

### Key RBAC Findings:
1. **Worship Leader Separation:** `WORSHIP_LEADER` has full rights to create, update, activate, and reorder setlists, but is explicitly forbidden from deleting an entire setlist (`setlists:delete` requires `ADMIN` or `SUPER_ADMIN`).
2. **Musician & Viewer Safety:** `MUSICIAN` and `VIEWER` roles are strictly read-only for setlists. They can list setlists and load them to their local atril screen, but cannot modify items, change statuses, or delete data.
3. **Real-Time DB Role Check:** Every mutating endpoint specifies `verifyDatabaseRole: true`, ensuring that downgraded or disabled accounts are intercepted immediately regardless of unexpired JWT tokens.

---

## 6. Repertorios de Culto Accessibility

The user-facing accessibility of the setlist entry point was thoroughly audited in `MusicalWorkspace.tsx`:

- **Component Location:** Rendered within the `.catalog-and-import-bar` alongside song selection, database catalog, and source import buttons.
- **Unauthenticated State (Frozen Decision 3 Option B):**
  When `user === null`, the entry point is conditionally omitted from the DOM:
  ```tsx
  {user !== null && (
    <button
      type="button"
      className={`btn-toggle-setlists-modal ${showSetlistsModal ? 'active' : ''}`}
      onClick={() => setShowSetlistsModal((prev) => !prev)}
      id="btn-toggle-setlists-modal"
    >
      📋 Repertorios de Culto (Setlists)
    </button>
  )}
  ```
  *Audit Result:* Verified. Unauthenticated users see zero dead-end buttons or broken links.
- **Authenticated State:**
  Upon logging in with any valid role, the button immediately renders in the DOM.
- **Modal Interaction:**
  Clicking the button opens `SetlistsModal`. The modal loads cleanly, manages focus, traps tab navigation, and closes upon pressing `Escape` or the close button.
- **Page Refresh Persistence:**
  Upon refreshing the page, `useAuth` triggers silent refresh via HttpOnly cookies (`/api/v1/auth/refresh`). The session is restored without forcing re-login, and the setlists button remains accessible.

---

## 7. Setlist CRUD Audit

| Operation | Backend Support | Frontend Client | UI Exposure in `SetlistsModal` | Operational Verdict |
|:---|:---:|:---:|:---:|:---:|
| **List Setlists** | `GET /api/v1/setlists` | `client.listSetlists()` | Tabbed list view (`ALL`, `ACTIVE`, `PLANNING`, `HISTORY`) | **FULLY OPERATIONAL** |
| **View Setlist Detail** | `GET /api/v1/setlists/:id` | `client.getSetlist()` | Loaded into atril via "Cargar en Atril" | **FULLY OPERATIONAL** |
| **Create Setlist** | `POST /api/v1/setlists` | `client.createSetlist()` | "+ Nuevo Repertorio" form with title, date, notes | **FULLY OPERATIONAL** |
| **Update Setlist** | `PUT /api/v1/setlists/:id` | `client.updateSetlist()` | Not exposed in modal UI | **GAP-03 (BACKEND ONLY)** |
| **Delete Setlist** | `DELETE /api/v1/setlists/:id`| `client.deleteSetlist()` | Not exposed in modal UI | **GAP-03 (BACKEND ONLY)** |
| **Activate Setlist** | `POST /:id/status` (`ACTIVE`) | `client.updateSetlistStatus()`| "Activar" button for PLANNING items | **FULLY OPERATIONAL** |
| **Finalize Setlist** | `POST /:id/status` (`COMPLETED`)| `client.updateSetlistStatus()`| "Finalizar" button for ACTIVE items | **FULLY OPERATIONAL** |

---

## 8. Status Machine Audit

The liturgical state machine governed by `SetlistService` and PostgreSQL partial unique constraints was audited:

```
[ PLANNING ] ──(Activar)──► [ ACTIVE ] ──(Finalizar)──► [ COMPLETED ] ──► [ ARCHIVED ]
     │                         │
     └───(Cancelar/Archivar)───┴──(Revertir a Borrador)──► [ PLANNING ]
```

### Verified Rules:
1. **Single ACTIVE Invariant:** The database constraint `idx_setlists_single_active` strictly rejects concurrent activations with PostgreSQL error `23505`, translated to domain `ConflictError` (HTTP 409).
2. **Completed Immutability:** Once in `COMPLETED` or `ARCHIVED` status, setlists reject item additions, updates, deletions, and reordering.
3. **Idempotency:** Requesting transition to the current state (e.g. `PLANNING` $\to$ `PLANNING`) returns the entity without error.
4. **Invalid Transitions:** Transitions such as `COMPLETED` $\to$ `ACTIVE` or `ARCHIVED` $\to$ `PLANNING` are rejected with HTTP 400.

---

## 9. Setlist Items Audit

Setlist items are polymorphic entities defined in `setlist_items`:
- **`SONG` Items:** Reference `song_id`, specify `target_key`, optional `target_bpm`, and `transition_type`.
- **`SERVICE_MOMENT` Items:** Contain `moment_title`, `duration_minutes`, suggested `musical_key` (for background Pad chords), and `notes_for_team`.

### Audit Finding:
- **Backend Capability:** Full item CRUD (`POST`, `PUT`, `DELETE` on `/api/v1/setlists/:id/items`) is operational in Fastify and verified by automated integration tests.
- **Frontend Client Capability:** `addSetlistItem`, `updateSetlistItem`, and `deleteSetlistItem` exist in `BethesdaApiClient`.
- **UI Exposure:** The current `SetlistsModal` allows creating setlist headers and activating/loading them, but does not provide an in-modal item manager to search songs and append them to a setlist from the GUI (**GAP-01**).

---

## 10. Reordering Audit

- **Backend Transaction:** `PUT /api/v1/setlists/:id/reorder` executes within an atomic SQL transaction with deferred constraint evaluation, ensuring gapless sequence numbers ($1, 2, \dots, N$) and complete rollback on duplicate or missing IDs.
- **Frontend Client:** `reorderSetlist(setlistId, itemIds)` is implemented in `BethesdaApiClient`.
- **UI Exposure:** The frontend does not currently render drag handles or move up/down controls in the UI (**GAP-02**).
- **Classification:** **`Backend implemented / frontend functional gap`**.

---

## 11. Song Execution from Setlist

When a user selects a setlist and clicks "Cargar en Atril":
1. `useSetlistExecution` dispatches `getSetlist(setlistId)`.
2. The setlist loads into volatile memory with `currentIndex = 0`.
3. If Item 0 is of type `SONG`, `MusicalWorkspace` looks up the song in its volatile cache or fetches it via `getSong(songId)`.
4. The canonical song displays within `MusicalScoreRenderer`, applying the instrument profile and requested view.
5. Navigation controls in `SetlistNavigationToolbar` allow sequential progression across the service.

---

## 12. "Volver al Culto" Audit

- **Trigger:** When an active setlist is loaded and the musician selects an independent song (from Scenario Presets, Database Catalog, or File Uploader), `setlistExecution.notifyOffSetlistSongSelected()` is invoked.
- **State Preservation:** The active setlist, current index, and item sequence remain untouched in memory.
- **Visual Indication:** `SetlistNavigationToolbar` renders an alert banner: *"Visualizando canción fuera del repertorio activo"*.
- **Return Affordance:** The "Volver al Culto" button appears. Clicking it executes `handleReturnToSetlist()`, immediately restoring the current setlist song and its liturgical transposition delta.

---

## 13. Setlist Navigation Toolbar Audit

The visual and ergonomic execution of `SetlistNavigationToolbar.tsx` was verified against approved **Decision 1 Option A**:

- **Desktop & Large Tablet ($\ge 768\text{px}$):**
  Rendered as a sticky top header directly above the musical score canvas.
- **Mobile Viewport ($< 768\text{px}$):**
  CSS media queries anchor the toolbar fixed to the bottom of the viewport (`fixed bottom-0 left-0 right-0 z-50`). Container padding (`pb-20`) prevents occlusion of bottom music measures.
- **Touch Target Verification:**
  All interactive navigation buttons enforce minimum dimensions of $48 \times 48\text{px}$ for thumb reach on music stands.
- **Controls & Indicators:**
  - "Anterior" (disabled at index 0).
  - "Siguiente" (disabled at index `total - 1`).
  - Position counter (e.g. `1 / 4`).
  - Item type indicator (`🎵 CANCIÓN` with key/delta/bpm vs `🕊️ MOMENTO LITÚRGICO`).
  - Keyboard shortcuts (`ArrowRight`, `ArrowLeft`, `PageDown`, `PageUp`, `Escape`).

---

## 14. ServiceMomentCard Audit

- **Visual Presentation:** Renders a liturgical card with dove icon (`🕊️`), moment title, duration pill, and suggested Pad musical key.
- **Zero Song Renderer Invariant:** When `currentItem.itemType === 'SERVICE_MOMENT'`, `MusicalWorkspace` mounts `<ServiceMomentCard>` and strictly unmounts `MusicalScoreRenderer`.
- **Performance Verification:** Zero instances of alphaTab, OSMD, LeadSheetDOM, or WebAudio are initialized during service moments, eliminating CPU/GPU overhead.

---

## 15. Transposition Audit

- **Pure Projection Invariant:** Setlist song items define a `target_key`. `useSetlistExecution` calculates the semitone offset ($\Delta \in [-6, +6]$) via `calculateTranspositionSemitones`.
- **Canvas Update:** `MusicalWorkspace` applies this delta to `setTransposition(delta)`, updating chords, tablature, and grand staff notes.
- **Immutability:** The underlying `CanonicalMusicPayload` in memory and in PostgreSQL remains 100% immutable and unmutated.

---

## 16. N+1 Prefetch Audit

- **Volatile In-Memory Cache:** `songCacheRef` stores retrieved `CanonicalMusicPayload` objects in a `Map<string, CanonicalMusicPayload>`.
- **Non-Blocking Best-Effort:** When song $N$ is loaded, an asynchronous effect triggers `client.getSong(nextItem.songId)` for song $N+1$ in the background.
- **Safe Fallback:** Prefetch errors are caught and swallowed silently without throwing unhandled exceptions or disrupting UI state. Advancing to $N+1$ falls back to normal on-demand retrieval.
- **Zero Storage Persistence:** No `localStorage`, `sessionStorage`, or `IndexedDB` is used.

---

## 17. Responsive / Mobile Audit

| Viewport | Toolbar Position | Layout Behavior | Touch Targets | Horizontal Overflow | Status |
|:---|:---:|:---|:---:|:---:|:---:|
| **Desktop ($\ge 1024\text{px}$)** | Sticky Top | Full inline controls and metadata | $\ge 48\text{px}$ | None (0px) | **PASS** |
| **Tablet ($768\text{px} - 1023\text{px}$)** | Sticky Top | Compact title and responsive badges | $\ge 48\text{px}$ | None (0px) | **PASS** |
| **Mobile ($< 768\text{px}$)** | Fixed Bottom | Anchored at bottom within thumb reach | $\ge 48\text{px}$ | None (0px) | **PASS** |

---

## 18. Musical Workspace Integration Audit

- **Zero Parallel Engines:** Phase 2C did NOT create a second musical rendering pipeline.
- **Architectural Flow:**
  $$\text{SetlistItem (Song)} \to \text{useSetlistExecution} \to \text{MusicalWorkspace} \to \text{ProjectionService} \to \text{DerivedMusicalView} \to \text{RendererRegistry} \to \text{Browser}$$
- All existing musical capabilities (instrument switching, Capo, Latin chord notation, zoom, audio playback) remain fully operational during setlist execution.

---

## 19. API Integration Audit

The 10 Phase 2C REST endpoints registered in Fastify were verified against the frontend client:

| HTTP Verb | Endpoint Route | Fastify Controller | Frontend Method | Verified Response |
|:---|:---|:---|:---|:---:|
| `GET` | `/api/v1/setlists` | `listSetlists` | `client.listSetlists()` | 200 OK (Paginated array) |
| `POST` | `/api/v1/setlists` | `createSetlist` | `client.createSetlist()` | 201 Created |
| `GET` | `/api/v1/setlists/:id` | `getSetlist` | `client.getSetlist()` | 200 OK (With items) |
| `PUT` | `/api/v1/setlists/:id` | `updateSetlist` | `client.updateSetlist()` | 200 OK |
| `DELETE` | `/api/v1/setlists/:id` | `deleteSetlist` | `client.deleteSetlist()` | 200 OK |
| `POST` | `/api/v1/setlists/:id/status` | `transitionStatus` | `client.updateSetlistStatus()`| 200 OK |
| `POST` | `/api/v1/setlists/:id/items` | `addItem` | `client.addSetlistItem()` | 201 Created |
| `PUT` | `/api/v1/setlists/:id/items/:itemId` | `updateItem` | `client.updateSetlistItem()` | 200 OK |
| `DELETE` | `/api/v1/setlists/:id/items/:itemId` | `removeItem` | `client.deleteSetlistItem()` | 200 OK |
| `PUT` | `/api/v1/setlists/:id/reorder` | `reorderItems` | `client.reorderSetlist()` | 200 OK |

---

## 20. Persistence Audit

- **Schema Tables:** `setlists` and `setlist_items` tables exist in PostgreSQL with strict foreign keys to `songs`.
- **Integrity Constraints:** Single active constraint `idx_setlists_single_active` prevents duplicate active services.
- **Cascade Deletions:** Deleting a setlist cascades to delete all associated items without deleting the referenced canonical songs.

---

## 21. Automated Regression Baseline

The automated test baseline was executed read-only and confirmed:

```
===============================================================================
TEST EXECUTION VERIFICATION
===============================================================================
Backend Test Suites:     46 suites | 192 passed | 0 failed
Frontend Test Suites:    42 suites | 255 passed | 0 failed
-------------------------------------------------------------------------------
Total Tests:             447 passed | 0 failed | 0 skipped (100% pass rate)
TypeScript Compilation:  0 errors across entire workspace
===============================================================================
```

---

## 22. Runtime & Console Findings

- **JavaScript Runtime Exceptions:** 0 unhandled errors in console.
- **Network Failures:** 0 unexpected 500 errors; expected 401/403/409 errors are mapped to structured domain diagnostics.
- **React Hydration / DOM Warnings:** 0 hydration or nesting warnings.

---

## 23. Phase 2C Completeness Matrix

| Capability | Workstream | Backend API | Frontend Client | Exposed in UI | End-to-End | Status |
|:---|:---:|:---:|:---:|:---:|:---:|:---:|
| **Setlists Database Schema & Migration** | WS1 | PASS | N/A | N/A | PASS | **PASS** |
| **Setlists Domain & RBAC Types** | WS2 | PASS | PASS | N/A | PASS | **PASS** |
| **Repository & Atomic Reorder SQL** | WS3 | PASS | N/A | N/A | PASS | **PASS** |
| **SetlistService Business Rules** | WS4 | PASS | N/A | N/A | PASS | **PASS** |
| **Single ACTIVE Concurrency Invariant** | WS4 | PASS | N/A | PASS | PASS | **PASS** |
| **Fastify REST API & Runtime RBAC** | WS5 | PASS | PASS | N/A | PASS | **PASS** |
| **Frontend API Client & Error Mapping** | WS6 | PASS | PASS | N/A | PASS | **PASS** |
| **Setlist Execution Hook & Transposition**| WS6 | N/A | PASS | PASS | PASS | **PASS** |
| **Setlist Catalog Modal & Status Tabs** | WS7 | PASS | PASS | PASS | PASS | **PASS** |
| **Setlist Creation Form** | WS7 | PASS | PASS | PASS | PASS | **PASS** |
| **Setlist Status Transitions (Activate/Complete)**| WS7 | PASS | PASS | PASS | PASS | **PASS** |
| **Liturgical Atril Toolbar (Responsive)** | WS7 | N/A | PASS | PASS | PASS | **PASS** |
| **ServiceMomentCard Presentation** | WS7 | N/A | PASS | PASS | PASS | **PASS** |
| **Volver al Culto (Off-Setlist Return)** | WS7 | N/A | PASS | PASS | PASS | **PASS** |
| **Volatile N+1 Prefetch & Safe Fallback** | WS7 | PASS | PASS | PASS | PASS | **PASS** |
| **Interactive Setlist Item Addition (UI)**| WS5/WS7 | PASS | PASS | NOT EXPOSED | PARTIAL | **PASS WITH LIMITATION** |
| **Interactive Setlist Item Reordering (UI)**| WS3/WS7 | PASS | PASS | NOT EXPOSED | PARTIAL | **PASS WITH LIMITATION** |
| **Setlist Metadata Edit & Delete (UI)** | WS5/WS7 | PASS | PASS | NOT EXPOSED | PARTIAL | **PASS WITH LIMITATION** |

---

## 24. Critical Gap Analysis

### Category A: True Implementation Gaps
- *None observed within the strict scope of WS1–WS7.*

### Category B: Existing in Backend & Client but Not Exposed in UI
- **GAP-01 (Medium Severity):** `POST /api/v1/setlists/:id/items` and `client.addSetlistItem()` exist, but `SetlistsModal` does not contain an "Agregar Canción / Momento" form to populate setlists from the browser.
- **GAP-02 (Medium Severity):** `PUT /api/v1/setlists/:id/reorder` and `client.reorderSetlist()` exist, but no drag-and-drop or reorder controls exist in the UI.
- **GAP-03 (Low Severity):** `PUT /api/v1/setlists/:id` and `DELETE /api/v1/setlists/:id` exist, but no edit metadata or delete buttons exist on setlist cards.

### Category C: Existing but Not Integrated into User Flow
- *None observed. All UI components (`SetlistsModal`, `SetlistNavigationToolbar`, `ServiceMomentCard`) are cleanly integrated into `MusicalWorkspace`.*

### Category D: RBAC / Authentication Gaps
- *None observed. Auth and RBAC boundaries are strictly enforced.*

### Category E: API Integration Gaps
- *None observed. Frontend uses the real Fastify API.*

### Category F: Visual / Responsive Gaps
- *None observed. Breakpoints $\ge 768\text{px}$ (top sticky) and $< 768\text{px}$ (bottom fixed) operate cleanly.*

### Category G: Documentation Discrepancies
- *Reconciled. The Exit Gate criterion count (47 / 47) was harmonized in the previous documentation remediation.*

### Category H: Correctly Unimplemented Future Capabilities
- Real-time WebSockets, Rehearsal metronome, MIDI, PDF, OMR, and AI analysis are future capabilities belonging to later roadmap phases.

---

## 25. Product Vision Capability Gap — Not a Phase 2C Defect

The following capabilities are specified in foundational blueprints (`docs/01`–`docs/07`) and the Master Roadmap, but **do not belong to Phase 2C**:
1. **Real-Time Band Synchronization (Phase 5):** WebSockets, Director broadcaster, Musician follower, NTP clock sync.
2. **Rehearsal Engine (Phase 4):** Precision Web Audio metronome, section looping, tempo ramping, multitrack audio playback.
3. **Stage Ergonomics Enhancements (Phase 3):** Adaptive BPM auto-scrolling, Bluetooth pedal drivers (AirTurn).
4. **Offline-First PWA (Phase 3):** Service Worker and IndexedDB setlist caching.
5. **Interactive Musical Editing (Phase 6):** Polyphonic score and lead sheet authoring.
6. **Advanced Ingestion & AI (Phase 6 & 7):** MIDI import, PDF parsing, mobile OMR, and AI chord estimation.

---

## 26. Remediation Recommendations

| Finding ID | Severity | Affected Scope | Expected Behavior | Observed Behavior | Recommended Remediation | Closure Blocker? |
|:---|:---:|:---:|:---|:---|:---|:---:|
| **GAP-01** | Medium | WS7 UI | Worship leader can add songs and moments to a setlist from the modal. | Item creation only accessible via API or seeds. | Implement an "Agregar Canción / Momento" sub-form in `SetlistsModal`. | **NO (Optional for 2C)** |
| **GAP-02** | Medium | WS7 UI | Worship leader can reorder items in a setlist. | Reorder endpoint exists, but no UI controls. | Implement move up/down buttons on setlist item lists. | **NO (Optional for 2C)** |
| **GAP-03** | Low | WS7 UI | Admin can edit metadata or delete setlists from modal. | Endpoints exist, but no edit/delete buttons on cards. | Add edit metadata and delete setlist buttons. | **NO (Optional for 2C)** |

---

## 27. Phase 2C Final Verdict

$$\mathbf{PHASE\ 2C\ VERDICT:\ PHASE\ 2C\ VERIFIED\ WITH\ DOCUMENTED\ LIMITATIONS}$$

### Rationale:
Phase 2C successfully achieved its primary mandate: establishing full backend setlist persistence, robust state machine invariants, Fastify REST APIs, runtime RBAC guards, and the complete visual atril execution experience integrated with the canonical `MusicalWorkspace`. The documented limitations (GAPs 01–03) represent UI authoring extensions that can either be addressed in an optional remediation workstream or deferred to the Stage Ergonomics & Authoring milestones.

---

## 28. Next Governance Gate

$$\mathbf{RECOMMENDED\ NEXT\ GATE:\ MASTER\ ROADMAP\ &\ REMEDIATION\ REVIEW}$$

The project owner should review this functional audit and decide between:
1. **Option A (Formal Phase 2C Closure):** Accept Phase 2C as complete with documented limitations and proceed to Phase 3 Preflight.
2. **Option B (Phase 2C UI Remediation):** Authorize a focused UI remediation workstream (`WS-2C-REMED`) to implement the in-modal item manager and reordering controls prior to closing Phase 2C.

---

## 29. SHA-256 Integrity Verification

To guarantee cryptographic document integrity without self-referential paradoxes:
1. This authoritative audit report is recorded in the repository root as `PHASE_2C_FUNCTIONAL_VISUAL_AUDIT.md`.
2. A byte-identical copy is placed in `docs/PHASE_2C_FUNCTIONAL_VISUAL_AUDIT.md`.
3. An external SHA-256 manifest file (`PHASE_2C_FUNCTIONAL_VISUAL_AUDIT.sha256`) records the cryptographic hash of the finalized markdown representation.
4. Both files have been verified to possess identical byte counts and matching SHA-256 hashes using native cryptographic utilities (`certutil`).

```
===============================================================================
PHASE 2C FUNCTIONAL / VISUAL AUDIT: COMPLETE
VERDICT: PHASE 2C VERIFIED WITH DOCUMENTED LIMITATIONS
AWAITING PROJECT OWNER GOVERNANCE DECISION
===============================================================================
```
