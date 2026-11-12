# BETHESDA WORSHIP STUDIO
# PHASE 2C — SETLIST LITURGICAL MANAGEMENT & EXECUTION UI
## INDEPENDENT CODE REVIEW, CRITICAL DEFECT REMEDIATION & FINAL ACCEPTANCE REPORT

**Repository:** `https://github.com/juancastro2381-hub/BETHESDA-WORSHIP-STUDIO.git`  
**Branch:** `feature/phase-1a-core-foundation`  
**Phase 2B.2 Accepted Baseline Commit:** `6f85920b78abbeae3a182bf1071d1fb49b03acc5`  
**Initial Phase 2C Delivery Commit:** `bdad8b4e7db686109a9e9a3c68bf8e4e86cb329c`  
**Final Acceptance Determination:** **`PASS`**

---

## 1. EXECUTIVE SUMMARY

Phase 2C delivers the liturgical service planning, setlist management, per-entry musical configuration, individual musician preference resolution, and stage-ready Music Stand (`Modo Atril`) execution experience for Bethesda Worship Studio.

Following the independent code review of commit `bdad8b4e7db686109a9e9a3c68bf8e4e86cb329c`, a targeted remediation and acceptance pass was executed to resolve **Critical Finding A** (Reading Format Resolution silent fallback in `music-stand-controller.ts`) and **Critical Finding B** (Concurrent Setlist Activation atomic transaction enforcement in `setlist-service.ts` and `setlist-repository.ts`), alongside full verification of all Section 4 acceptance criteria (RBAC & ownership, transactional duplication rollback, timezone-aware date/time handling, individual musician preference isolation/compatibility, database migration safety, and Music Stand UI/UX).

---

## 2. INDEPENDENT REVIEW FINDINGS, ROOT CAUSES & EXACT CORRECTIONS APPLIED

### 2.1 Critical Finding A — Reading Format Resolution (`frontend/src/core/workspace/music-stand-controller.ts`)

1. **Finding:**
   In `resolveReadingFormatForSong()`, the expression:
   ```typescript
   const matched = definitions.find((d) => d.id === targetId) ?? definitions[0]!;
   ```
   silently substituted the first available definition (`STAFF_NOTATION` / `STANDARD_NOTATION`) whenever the requested format was not found in `definitions`. Furthermore, when `matched` was found with `isAvailable === false`, `ResolvedFormatMapping` still exposed `primary: matched.primary` and `secondary: [...matched.secondary]` without explicitly distinguishing `requestedFormat` from `resolvedFormat`.
2. **Root Cause:**
   The non-null fallback `?? definitions[0]!` assumed `definitions` would always contain all four format IDs and conflated the caller's requested format (`readingFormat`) with the resolved format definition.
3. **Exact Corrections Applied:**
   - **Removed silent fallback (`?? definitions[0]!`)** in `frontend/src/core/workspace/music-stand-controller.ts`.
   - **Explicitly distinguished requested vs. resolved format** in `ResolvedFormatMapping`:
     - `requestedFormat: FrontendReadingFormat` (and `readingFormat: FrontendReadingFormat` preserved for compatibility)
     - `resolvedFormat: FrontendReadingFormat | null`
     - `selectorId: ReadingFormatId | null`
     - `label: string | null`
     - `primary: ViewRepresentation | null`
     - `secondary: ViewRepresentation[]`
     - `isAvailable: boolean`
     - `unavailabilityReason?: string`
   - When the requested format is unrecognized, missing from `definitions`, or `matched.isAvailable === false`, `resolveReadingFormatForSong()` deterministically returns:
     - `isAvailable: false`
     - `resolvedFormat: null`
     - `primary: null`
     - `secondary: []`
     - an explicit `unavailabilityReason` explaining why the requested format is unavailable.
   - Updated `MusicalWorkspace.tsx` (`handleQuickSelectFormat`) to verify `!check.isAvailable || check.resolvedFormat !== format || check.primary === null`, ensuring the UI never switches the musician's active representation to an incompatible or substituted format.
   - Hardened `resolveEffectiveStandView()` so saved `userPreferences` are also checked against `resolveReadingFormatForSong()` for the current `(song, instrumentProfile)` pair before application, preventing an incompatible saved preference (e.g., `TABLATURE` when switching to `acoustic_piano` or loading a chord-only lead sheet) from forcing an invalid representation.

### 2.2 Critical Finding B — Concurrent Setlist Activation (`backend/src/application/setlist-service.ts` & `backend/src/repositories/setlist-repository.ts`)

1. **Finding:**
   `SetlistService.createSetlist()` and `SetlistService.transitionStatus()` checked for an existing `ACTIVE` setlist in a separate pre-check query (`assertNoOtherActiveSetlist()`, which called `setlistRepo.list({ status: 'ACTIVE', limit: 5 })`) and read the target setlist (`setlistRepo.findById(id)`) outside of the status update transaction.
2. **Root Cause:**
   Performing application-level pre-checks in separate queries before `INSERT` or `UPDATE` creates a Time-Of-Check to Time-Of-Use (TOCTOU) window between reading the current state and mutating the row unless the state machine validation, row locking, and single-`ACTIVE` invariant are enforced atomically inside the database transaction and backed by a database-level unique constraint.
3. **Exact Corrections Applied (`Database Concurrency Guarantees`):**
   - **Removed non-transactional `assertNoOtherActiveSetlist()` pre-check** from `backend/src/application/setlist-service.ts` and delegated status transitions directly to the atomic transaction in `DrizzleSetlistRepository`.
   - **Atomic Transaction with Pessimistic Row Locking (`SELECT ... FOR UPDATE`) in `DrizzleSetlistRepository.updateStatus(id, status)`:**
     1. Opens `this.db.transaction(async (tx) => ...)`.
     2. Locks the target setlist row via `SELECT ... FROM setlists WHERE id = ${id} FOR UPDATE`, serializing concurrent requests targeting the same setlist.
     3. Handles idempotent same-state transitions (`currentStatus === status`) safely under the row lock.
     4. Validates the liturgical state machine (`ALLOWED_STATUS_TRANSITIONS[currentStatus]`) inside the transaction against the locked row's actual committed status.
     5. When `status === 'ACTIVE'`, locks any existing active setlist row (`SELECT id, title FROM setlists WHERE status = 'ACTIVE' AND id <> ${id} FOR UPDATE`) inside the transaction and throws `ConflictError` if one exists.
     6. Executes `UPDATE setlists SET status = ${status}, updated_at = NOW() WHERE id = ${id} RETURNING *`, which is enforced at the PostgreSQL storage engine level by the partial unique index:
        ```sql
        CREATE UNIQUE INDEX "idx_setlists_single_active" ON "setlists" USING btree ("status") WHERE ("status" = 'ACTIVE');
        ```
     7. If two concurrent transactions attempt to activate different setlists when none is initially active, PostgreSQL's B-tree partial unique index `idx_setlists_single_active` serializes the index insertion, commits the first transaction, and aborts the second transaction with SQLSTATE `23505` (`unique_violation`), rolling back the second transaction completely and translating `23505` via `handleUniqueActiveConflict()` into the domain `ConflictError` (`409 Conflict`).
   - **Atomic Transaction in `DrizzleSetlistRepository.create(dto)`:**
     Wraps setlist creation in `this.db.transaction(async (tx) => ...)`, locking any existing `ACTIVE` setlist (`FOR UPDATE`) when `dto.status === 'ACTIVE'` and relying on `idx_setlists_single_active` + `handleUniqueActiveConflict()` for atomic conflict translation and rollback.

---

## 3. SECTION 4 ADDITIONAL ACCEPTANCE REVIEW VERIFICATION

### 3.A Authorization and Resource Ownership
- **Read & Write Access Across Services and Setlists:**
  - `GET /api/v1/worship-services` (`services:list`), `GET /api/v1/worship-services/:id` (`services:read`), `GET /api/v1/setlists` (`setlists:list`), `GET /api/v1/setlists/:id` (`setlists:read`): Accessible to all authenticated roles (`SUPER_ADMIN`, `ADMIN`, `WORSHIP_LEADER`, `MUSICIAN`, `VIEWER`); unauthenticated requests are rejected with `401 Unauthorized`.
  - `POST / PUT` on `/api/v1/worship-services` and `/api/v1/setlists` (including `/items`, `/reorder`, `/status`, `/duplicate`): Restricted to `SUPER_ADMIN`, `ADMIN`, and `WORSHIP_LEADER` with real-time PostgreSQL role verification (`verifyDatabaseRole = true`). `MUSICIAN` and `VIEWER` receive `403 Forbidden`.
  - `DELETE /api/v1/worship-services/:id` (`services:delete`) and `DELETE /api/v1/setlists/:id` (`setlists:delete`): Strictly restricted to `SUPER_ADMIN` and `ADMIN` (`verifyDatabaseRole = true`). `WORSHIP_LEADER`, `MUSICIAN`, and `VIEWER` receive `403 Forbidden`.

### 3.B Transactional Duplication
- `DrizzleSetlistRepository.duplicate()` runs inside `this.db.transaction(async (tx) => ...)`:
  - Copies all items in ascending `sequenceOrder`, preserving `itemType`, `songId` (by reference), `targetKey`, `targetBpm`, `transitionType`, `momentTitle`, `durationMinutes`, `musicalKey`, `notesForTeam`, `preferredInstrument`, `preferredTuning`, and `preferredFormat`.
  - Resets the duplicated setlist status to `'PLANNING'` so historical (`COMPLETED`/`ARCHIVED`) setlists and templates can be reused safely.
  - Performs zero mutation on the `songs` or `song_versions` tables.
  - Rolls back atomically on any intermediate failure during item insertion (verified in Test `3.5` of `worship-services-and-setlist-enhancements.test.ts`), leaving zero orphaned `setlists` or `setlist_items` rows.

### 3.C Date and Time Handling
- Both `worship_services.scheduled_at` and `setlists.scheduled_date_time` use PostgreSQL `TIMESTAMP WITH TIME ZONE`.
- `CreateWorshipServiceBodySchema`, `UpdateWorshipServiceBodySchema`, `CreateSetlistBodySchema`, `UpdateSetlistBodySchema`, and `DuplicateSetlistBodySchema` validate ISO-8601 datetime strings with `{ offset: true }`, preserving explicit timezone offsets (e.g., `'2026-12-24T19:30:00-05:00'`) as exact UTC instants while rejecting malformed dates (`'mañana'`, `'2026-13-45T99:00:00Z'`) with `400 Bad Request` (`ValidationError`).

### 3.D Individual Musician Preferences & Zero-Fabrication Validation
- **Personal Preference Precedence:** `resolveEffectiveStandView()` prioritizes a musician's saved `user_view_preferences` (`USER_PREFERENCE`) over the setlist entry's `preferredFormat` (`SETLIST_SUGGESTION`), without mutating the shared setlist item.
- **Instrument Compatibility & Canonical Data Integrity (Zero-Fabrication):** Both `resolveReadingFormatForSong()` and `resolveEffectiveStandView()` validate requested and preferred formats against `computeFormatDefinitions(song, instrumentProfile)`. Requesting `TAB` on a non-string instrument (`acoustic_piano`) or requesting `SCORE`/`TAB` on a chord/lyric-only lead sheet is deterministically rejected (`isAvailable: false`, `resolvedFormat: null`, `primary: null`) without fabricating notes, chords, lyrics, or tablature.
- **No Cross-User Preference Leakage:** `/api/v1/users/me/preferences` scopes all reads and writes strictly to `request.user.sub` (`user_id` primary key in `user_view_preferences`), verified in Test `4.3` of `worship-services-and-setlist-enhancements.test.ts`.

### 3.E Database Migrations & Rollback Verification
- **Forward Migration:** `backend/src/db/migrations/0020_worship_services_and_setlist_enhancements.sql` idempotently creates enum `worship_service_status`, table `worship_services` (with `worship_leader_id REFERENCES users(id) ON DELETE SET NULL` and `setlist_id REFERENCES setlists(id) ON DELETE SET NULL`), indexes (`idx_worship_services_status`, `idx_worship_services_scheduled`, `idx_worship_services_leader`, `idx_worship_services_setlist`, `idx_worship_services_type`), `setlists.is_template` + `idx_setlists_is_template`, and `setlist_items` columns (`preferred_instrument`, `preferred_tuning`, `preferred_format`).
- **Down Migration Safety:** `backend/src/db/migrations/0020_worship_services_and_setlist_enhancements.down.sql` cleanly drops the added columns, index, table, and enum in reverse dependency order using `IF EXISTS`.
- **Existing Records Preservation & Journal Consistency:** All new columns on `setlists` (`is_template DEFAULT FALSE`) and `setlist_items` (`NULL`-able) preserve existing records without data loss. `backend/src/db/migrations/meta/_journal.json` entry `idx: 18` maps to `0020_worship_services_and_setlist_enhancements`.

### 3.F Music Stand (`Modo Atril`) Experience
- **Reading Format Switching:** Quick format switcher (`🎼 Partitura`, `🎸 Acordes`, `🎤 Letra`, `🔢 Tab`) in `SetlistNavigationToolbar.tsx` and `MusicalWorkspace.tsx` validates availability via `resolveReadingFormatForSong()` before switching, showing a dismissible warning banner if unavailable and never switching to an incompatible or substituted representation.
- **Navigation & Keyboard Shortcut Lifecycle:** `SetlistNavigationToolbar.tsx` registers `window.addEventListener('keydown', handleKeyDown)` only when `loadedSetlist !== null`, ignores events originating in `<input>`, `<textarea>`, or `contentEditable` elements (preventing interference with normal workspace interactions), and removes the listener cleanly on unmount or setlist unload.
- **Tablet Responsive Layout, High Contrast & Zoom Limits:** Touch targets are $\ge 48\text{px}$, zoom is strictly clamped between $80\%$ and $160\%$ in $10\%$ increments (`clampStandZoom`), and high-contrast stage mode (`high-contrast-stand`) + distraction-free stand mode (`music-stand-mode`) toggle cleanly.

---

## 4. TEST EXECUTION EVIDENCE (FOCUSED VS. FULL REGRESSION SUITES)

### 4.1 Focused Test — Critical Finding A (Reading Format Resolution & Music Stand Controller)
- **Exact Command:**
  ```bash
  node --test --experimental-strip-types frontend/src/core/workspace/__tests__/phase2c-liturgical-and-stand.test.ts
  ```
- **Exit Code:** `0`
- **Test Counts:** `11 tests | 1 suite | 11 pass | 0 fail`
- **Actual Output:**
  ```text
  ▶ Phase 2C — Liturgical Setlist Management, Worship Services & Music Stand Suite
    ✔ 1.1 should initialize Music Stand display state and enforce zoom bounds (80% - 160%) (1.3503ms)
    ✔ 1.2 should detect LANDSCAPE vs PORTRAIT stand orientation deterministically (0.1929ms)
    ✔ 1.3 should map reading format identifiers bidirectionally and provide human-readable labels (0.1399ms)
    ✔ 2.1 should validate reading formats against real CanonicalMusicPayload content (Zero-Fabrication) (3.9397ms)
    ✔ 2.2 should NEVER silently substitute definitions[0] when requested format is missing from definitions or unrecognized (Critical Finding A) (0.6245ms)
    ✔ 2.3 should not apply incompatible saved user preference when instrument or canonical song lacks support (Section 4.D) (0.6779ms)
    ✔ 3.1 should prioritize individual musician preferences over setlist entry suggestion without mutating shared setlist (0.4763ms)
    ✔ 3.2 should apply setlist entry suggested format when musician has no saved personal preference and format is valid (0.2304ms)
    ✔ 3.3 should fallback safely to instrument default if setlist suggestion is incompatible with canonical song (Zero-Fabrication) (0.2724ms)
    ✔ 4.1 should filter worship services across UPCOMING, DRAFT, COMPLETED, ALL and free-text category (0.3337ms)
    ✔ 5.1 should expose duplicateSetlist and worship service CRUD methods on BethesdaApiClient and execute requests properly (27.0095ms)
  ✔ Phase 2C — Liturgical Setlist Management, Worship Services & Music Stand Suite (36.7903ms)
  ℹ tests 11
  ℹ suites 1
  ℹ pass 11
  ℹ fail 0
  ℹ cancelled 0
  ℹ skipped 0
  ℹ todo 0
  ℹ duration_ms 433.0787
  ```

### 4.2 Focused Test — Critical Finding B (PostgreSQL Concurrency & Independent Connections)
- **Exact Command:**
  ```bash
  npx --prefix backend tsx --test backend/src/__tests__/setlist-concurrency.test.ts
  ```
- **Exit Code:** `0`
- **Test Counts:** `8 tests | 3 suites | 8 pass | 0 fail`
- **Actual Output:**
  ```text
  ▶ Phase 2C — WS4: Concurrency Remediation & Verification Suite
    ▶ 1. Historical Audit Evidence (Pre-Remediation TOCTOU Window)
      ✔ 1.1 should demonstrate how application-level check alone was vulnerable to TOCTOU (1.1544ms)
    ✔ 1. Historical Audit Evidence (Pre-Remediation TOCTOU Window) (1.6681ms)
    ▶ 2. Post-Remediation Verification (Independent PostgreSQL Connections & Atomic Transactions)
      ✔ 2.1 should enforce partial unique index in PostgreSQL: reject 2nd ACTIVE insert directly with 23505 (169.3526ms)
      ✔ 2.2 should reject activation while another setlist is already ACTIVE across independent connections (220.356ms)
      ✔ 2.3 should handle two concurrent activation requests for DIFFERENT setlists over independent PostgreSQL connections (exactly 1 succeeds, 1 fails with ConflictError) (22.0291ms)
      ✔ 2.4 should serialize two concurrent activation requests for the SAME setlist over independent PostgreSQL connections (SELECT ... FOR UPDATE) (9.9495ms)
      ✔ 2.5 should perform complete transaction rollback after an activation conflict, preserving previous state in PostgreSQL (12.7677ms)
      ✔ 2.6 should ensure sequential and concurrent deactivation + activation transitions never violate single-ACTIVE invariant (11.9833ms)
      ✔ 2.7 should permit UNLIMITED coexistence of setlists in PLANNING, COMPLETED, and ARCHIVED (19.5451ms)
    ✔ 2. Post-Remediation Verification (Independent PostgreSQL Connections & Atomic Transactions) (466.9322ms)
  ✔ Phase 2C — WS4: Concurrency Remediation & Verification Suite (755.5343ms)
  ℹ tests 8
  ℹ suites 3
  ℹ pass 8
  ℹ fail 0
  ℹ cancelled 0
  ℹ skipped 0
  ℹ todo 0
  ℹ duration_ms 33469.214
  ```

### 4.3 Focused Test — Phase 2C PostgreSQL & Fastify Integration Suite
- **Exact Command:**
  ```bash
  npx --prefix backend tsx --test backend/src/__tests__/worship-services-and-setlist-enhancements.test.ts
  ```
- **Exit Code:** `0`
- **Test Counts:** `19 tests | 5 suites | 19 pass | 0 fail`
- **Actual Output Summary:**
  ```text
  ▶ Phase 2C — Worship Services, Setlist Duplication/Templates & Per-Entry Musical Configuration
    ▶ 1. Worship Services CRUD
      ✔ 1.1 WORSHIP_LEADER creates a service with free-text category, leader, notes and linked setlist (293.3902ms)
      ✔ 1.2 should reject missing name or invalid scheduledAt with 400 (54.7312ms)
      ✔ 1.3 should return 404 when linking a non-existent setlist (20.1142ms)
      ✔ 1.4 should update, transition status, and unlink setlist (64.2185ms)
      ✔ 1.5 should filter by timeframe (upcoming vs completed) and serviceType (48.9021ms)
      ✔ 1.6 deleting a linked setlist sets worship_services.setlist_id to NULL (service preserved) (52.4418ms)
    ▶ 2. Worship Services RBAC Matrix
      ✔ 2.1 MUSICIAN and VIEWER can read but not create/update/delete (403) (44.819ms)
      ✔ 2.2 WORSHIP_LEADER cannot delete (403); ADMIN and SUPER_ADMIN can (200, audited) (58.312ms)
      ✔ 2.3 unauthenticated requests are rejected with 401 (3.412ms)
    ▶ 3. Setlist Duplication & Reusable Templates
      ✔ 3.1 duplicates items by reference (same songId), preserves order/config, resets status to PLANNING (78.512ms)
      ✔ 3.2 saves a duplicate as a reusable template and filters with ?isTemplate=true (39.104ms)
      ✔ 3.3 duplicate RBAC: MUSICIAN/VIEWER get 403; empty title 400; unknown id 404 (28.615ms)
      ✔ 3.4 can duplicate a COMPLETED (read-only) setlist into an editable PLANNING copy (29.441ms)
      ✔ 3.5 performs atomic rollback on intermediate failure during DrizzleSetlistRepository.duplicate (no orphaned setlist or items) (38.912ms)
    ▶ 4. Per-Entry Musical Configuration, Timezones, User Preference Isolation & Schema Integrity
      ✔ 4.1 updates preferred instrument/tuning/format and rejects unknown reading formats (26.3522ms)
      ✔ 4.2 preserves timezone offsets accurately and rejects invalid dates across services and setlists (Section 4.C) (15.7682ms)
      ✔ 4.3 isolates individual musician preferences without cross-user leakage (Section 4.D) (22.8339ms)
      ✔ 4.4 verifies Phase 2C database migration columns, indexes, and foreign keys in PostgreSQL (Section 4.E) (14.3119ms)
      ✔ 4.5 canonical song row remains byte-identical after all Phase 2C operations (0.9137ms)
  ✔ Phase 2C — Worship Services, Setlist Duplication/Templates & Per-Entry Musical Configuration (6364.2421ms)
  ℹ tests 19
  ℹ suites 5
  ℹ pass 19
  ℹ fail 0
  ℹ cancelled 0
  ℹ skipped 0
  ℹ todo 0
  ℹ duration_ms 45430.0749
  ```

### 4.4 Frontend Typecheck
- **Exact Command:** `npm --prefix frontend run typecheck`
- **Exit Code:** `0`
- **Actual Output:**
  ```text
  > @bethesda/frontend@0.1.0 typecheck
  > tsc --noEmit
  ```

### 4.5 Backend Typecheck
- **Exact Command:** `npm --prefix backend run typecheck`
- **Exit Code:** `0`
- **Actual Output:**
  ```text
  > @bethesda/backend@0.1.0 typecheck
  > tsc --noEmit
  ```

### 4.6 Full Frontend Regression Suite
- **Exact Command:** `npm --prefix frontend test`
- **Exit Code:** `0`
- **Test Counts:** `592 tests | 85 suites | 592 pass | 0 fail`
- **Actual Output Summary:**
  ```text
  > @bethesda/frontend@0.1.0 test
  > node --test --experimental-strip-types "src/core/**/__tests__/**/*.test.ts"
  ...
  ℹ tests 592
  ℹ suites 85
  ℹ pass 592
  ℹ fail 0
  ℹ cancelled 0
  ℹ skipped 0
  ℹ todo 0
  ℹ duration_ms 4050.9894
  ```

### 4.7 Full Backend Regression Suite
- **Exact Command:** `npm --prefix backend test`
- **Exit Code:** `0`
- **Test Counts:** `745 tests | 115 suites | 745 pass | 0 fail`
- **Actual Output Summary:**
  ```text
  > @bethesda/backend@0.1.0 test
  > tsx --test --test-concurrency=1 "src/**/__tests__/**/*.test.ts"
  ...
  ℹ tests 745
  ℹ suites 115
  ℹ pass 745
  ℹ fail 0
  ℹ cancelled 0
  ℹ skipped 0
  ℹ todo 0
  ℹ duration_ms 459954.7936
  ```

---

## 5. RESIDUAL RISKS OR LIMITATIONS

1. **Single-Congregation Global `ACTIVE` Invariant:** By architectural design (Rule A), the partial unique index `idx_setlists_single_active` enforces at most one `ACTIVE` setlist globally across the database instance. Multi-campus or multi-room simultaneous live services would require scoping the partial unique index by room/service context in a future phase if authorized.
2. **Per-Instrument Personal Preference Granularity:** `user_view_preferences` stores one active preference profile per authenticated user (`user_id` PK). When a musician switches instruments locally, `resolveEffectiveStandView()` validates compatibility of their saved preference against the active `InstrumentProfile` and `CanonicalMusicPayload` so an incompatible representation (such as `TABLATURE` on piano) is never forced.

---

## 6. FINAL ACCEPTANCE DETERMINATION

All Critical Findings (A and B) and all Section 4 review items have been remediated and verified with zero regressions across **592/592 frontend tests** and **745/745 backend tests** (`0` failures, `0` typecheck errors).

**Final Determination:** **`PASS`**
