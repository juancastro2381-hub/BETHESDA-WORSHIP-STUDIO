# Workstream C Implementation Report: Phase 3B Realtime Liturgical Flow
## Multi-Client Atril Synchronization via Server-Sent Events (SSE) & REST

- **Repository**: `BETHESDA-WORSHIP-STUDIO`
- **Workstream**: Phase 3B Realtime Liturgical Flow
- **Gate**: Gate C (Realtime Liturgical Flow Implementation & Verification)
- **Status**: IMPLEMENTED & VERIFIED (Automated Checks) — Manual Multi-Client Validation Pending Owner Testing
- **Exclusion Compliance**: STRICT COMPLIANCE — Zero physical pedal synchronization code, listeners, or dependencies.

---

### 1. Executive Summary & Architecture Decisions

Phase 3B implements synchronized liturgical execution across multiple atril clients (director, vocalists, band members). The implementation addresses:
- **Transport Decision**: Server-Sent Events (SSE, `text/event-stream`) for server-to-client event streaming + authenticated HTTP `POST` for client action dispatch. This architecture was selected based on repository preflight evidence:
  - Fastify v5 natively supports chunked streaming and SSE without adding heavy binary socket wrappers or external Redis message broker requirements.
  - Standard browser `EventSource` provides native reconnection semantics, resilient keepalive heartbeats, and zero external NPM runtime dependencies.
- **In-Memory Volatile State Machine**: Active sessions reside in `ManagedRealtimeSession` via `RealtimeSessionManager`.
- **Strict Invariance of Canonical Data**: Navigation between songs, section markers (Verso, Coro, Puente), and real-time harmonic/tempo overrides operate entirely in volatile memory. **They NEVER mutate persistent rows in PostgreSQL (`setlists`, `songs`)**, ensuring the canonical liturgy and master song catalogue remain strictly immutable.
- **Monotonic Event Sequencing & Idempotency**:
  - Monotonically increasing sequence counters (`epoch`, `sequence`).
  - Action deduplication cache (LRU window of 300 action IDs) ensures network retries do not re-execute transitions or inflate sequence numbers.
  - Out-of-order and stale actions (`expectedSequence < currentSequence`) are rejected with `409 Conflict` (`CONFLICT`).
- **Server-Side Authorization & RBAC**:
  - Joining/Listening requires `setlists:read` (all authenticated musicians).
  - State mutations (`SET_ITEM_INDEX`, `SET_SECTION`, `SET_KEY_OVERRIDE`, `SET_BPM_OVERRIDE`, `SET_STATUS`) require `isHost === true` OR global role `ADMIN` / `SUPER_ADMIN`.
  - Non-leaders attempting state mutations are categorically rejected with `403 Forbidden`.

---

### 2. Implementation Inventory

#### Backend Layer
1. **Domain Types & Contracts** ([`backend/src/domain/realtime/realtime-types.ts`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/backend/src/domain/realtime/realtime-types.ts)):
   - `RealtimeSessionStatus`: `'ACTIVE' | 'PAUSED' | 'CONCLUDED'`.
   - `RealtimeActionType`: `'SET_ITEM_INDEX' | 'SET_SECTION' | 'SET_KEY_OVERRIDE' | 'SET_BPM_OVERRIDE' | 'SET_STATUS'`.
   - `RealtimeSessionSnapshot`: Complete session state (session ID, setlist ID, host user ID, epoch, sequence, current item index, current section, key/bpm overrides, participants count and list).
   - `RealtimeEvent`: Event payload with `eventId`, `epoch`, `sequence`, `type`, `state`, and `action` provenance.

2. **In-Memory Realtime Session Manager** ([`backend/src/application/realtime-session-manager.ts`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/backend/src/application/realtime-session-manager.ts)):
   - `createOrGetSession()`: Creates or joins existing active session for a setlist.
   - `joinSession()`, `leaveSession()`, `heartbeat()`: Manages participant roster and updates `lastSeenAt`.
   - `dispatchAction()`: Enforces host/admin RBAC, verifies `expectedSequence`, checks idempotency cache, advances sequence, and broadcasts to active SSE subscribers.
   - `pruneStaleSessions()`: Automatically garbage-collects abandoned sessions (> 60 min inactivity) and offline participants (> 90 s without heartbeat).

3. **Validation Schemas** ([`backend/src/interfaces/http/schemas/realtime.schemas.ts`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/backend/src/interfaces/http/schemas/realtime.schemas.ts)):
   - Zod validation for session creation, action payloads, and query parameters.

4. **HTTP & SSE Routes** ([`backend/src/interfaces/http/routes/realtime.routes.ts`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/backend/src/interfaces/http/routes/realtime.routes.ts)):
   - `POST /api/v1/realtime/sessions`: Create or retrieve active session.
   - `GET /api/v1/realtime/sessions/by-setlist/:setlistId`: Check for live session on setlist.
   - `GET /api/v1/realtime/sessions/:sessionId`: Fetch full state snapshot.
   - `POST /api/v1/realtime/sessions/:sessionId/join`: Join participant roster.
   - `POST /api/v1/realtime/sessions/:sessionId/leave`: Exit participant roster.
   - `POST /api/v1/realtime/sessions/:sessionId/heartbeat`: Liveness ping.
   - `POST /api/v1/realtime/sessions/:sessionId/actions`: Dispatch liturgical command.
   - `GET /api/v1/realtime/sessions/:sessionId/stream`: SSE stream (`text/event-stream`, `X-Accel-Buffering: no`, 15-second keepalive `: ping`).

5. **AuthGuard Query Token Support** ([`backend/src/interfaces/http/middlewares/auth-middleware.ts`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/backend/src/interfaces/http/middlewares/auth-middleware.ts)):
   - Allows EventSource clients to authenticate via `?token=<JWT>` when headers cannot be customized by browser API.

#### Frontend Layer
1. **Domain Types** ([`frontend/src/core/realtime/realtime-types.ts`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/frontend/src/core/realtime/realtime-types.ts)).
2. **Client Layer** ([`frontend/src/core/realtime/realtime-client.ts`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/frontend/src/core/realtime/realtime-client.ts)):
   - SSE subscription, automatic reconnect with exponential backoff, snapshot processing, and action dispatch.
3. **React Hook** ([`frontend/src/core/realtime/use-realtime-flow.ts`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/frontend/src/core/realtime/use-realtime-flow.ts)):
   - Connects active setlist execution to live session. Provides `broadcastItemIndex`, `broadcastSection`, `broadcastKeyOverride`, `broadcastBpmOverride`, and `toggleDecoupled`.
4. **UI Badge Component** ([`frontend/src/components/navigation/RealtimeLiturgicalBadge.tsx`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/frontend/src/components/navigation/RealtimeLiturgicalBadge.tsx)):
   - Dynamic live indicators (`🔴 EN VIVO — DIRECTOR`, `🟢 EN VIVO — SINCRONIZADO`, `🟡 ATRIL INDEPENDIENTE`).
   - Section selector dropdown for Worship Leader (`INTRO`, `VERSO 1`, `CORO`, `PUENTE`, `MINISTRACIÓN`, `ESPONTÁNEO`).
   - Participant count display and decoupling toggle.

---

### 3. Verification Evidence

#### Backend Integration Tests
```bash
npx tsx --test src/__tests__/realtime-session.test.ts
```
**Working Directory**: `c:\Users\juanc\OneDrive\Documentos\Desarrollo proyectos\Sistema musical - partituras\BETHESDA WORSHIP STUDIO\backend`
**Exit Code**: `0`

**Output**:
```text
▶ Workstream C — Phase 3B Realtime Liturgical Flow Suite
  ✔ 1. should create or get a realtime liturgical session with initial snapshot
  ✔ 2. should allow a musician to join the session and register in participants
  ✔ 3. should process participant heartbeats successfully
  ✔ 4. should reject state mutation from an unauthorized participant (403 Forbidden)
  ✔ 5. should allow authorized leader to advance item index and increment sequence
  ✔ 6. should allow authorized leader to set section and harmonic/tempo overrides
  ✔ 7. should enforce idempotency: duplicate actionId returns state without advancing sequence
  ✔ 8. should reject out-of-order or stale actions (409 Conflict)
  ✔ 9. should guarantee strict preservation of PostgreSQL canonical truth
  ✔ 10. should allow participant to leave and reflect in snapshot
✔ Workstream C — Phase 3B Realtime Liturgical Flow Suite (779.6598ms)
ℹ tests 10
ℹ suites 1
ℹ pass 10
ℹ fail 0
```

#### Frontend Unit & Exclusion Tests
```bash
npx tsx --test src/core/realtime/__tests__/realtime.test.ts
```
**Working Directory**: `c:\Users\juanc\OneDrive\Documentos\Desarrollo proyectos\Sistema musical - partituras\BETHESDA WORSHIP STUDIO\frontend`
**Exit Code**: `0`

**Output**:
```text
▶ Workstream C — Phase 3B Realtime Client Suite
  ✔ 1. should initialize in DISCONNECTED state with default configuration (1.0822ms)
  ✔ 2. should notify onConnectionChange callback when status updates (0.5226ms)
  ✔ 3. should handle incoming snapshot and update subscribers (1.1312ms)
  ✔ 4. should handle state change event and sequence tracking (0.3979ms)
  ✔ 5. should strictly verify ZERO physical pedal code, APIs, or listeners exist (1.167ms)
✔ Workstream C — Phase 3B Realtime Client Suite (5.7261ms)
ℹ tests 5
ℹ suites 1
ℹ pass 5
ℹ fail 0
```

#### Overall Regression Test Passes
- **Backend Typecheck**: `npm run typecheck` $\to$ **0 errors**.
- **Frontend Typecheck**: `npx tsc --noEmit` $\to$ **0 errors**.
- **Frontend Full Test Suite**: `npm test` $\to$ **329 passed across 51 test suites (0 failed)**.

---

### 4. Strict Exclusion Compliance: Physical Pedal Synchronization

In accordance with Section 1 of the instructions:
- No Bluetooth / WebUSB / WebHID APIs are used.
- Test 5 in `src/core/realtime/__tests__/realtime.test.ts` statically verifies that no files in `frontend/src/core/realtime/` contain references to `pedal`, `bluetooth`, `navigator.bluetooth`, `navigator.usb`, `navigator.hid`, `gamepad`, `PageUp`, or `PageDown`.

---

### 5. Known Limitations & Owner Manual Test Plan

As mandated by governance, multi-client browser testing was **NOT RUN** using browser automation. The Project Owner must perform manual validation using two real browser windows or devices:

| Test Scenario | Verification Procedure | Expected Result |
| :--- | :--- | :--- |
| **Two-Client Setup** | Open Window A logged in as `WORSHIP_LEADER`. Open Window B logged in as `MUSICIAN`. Both open the same setlist. | Window A shows "Iniciar Culto en Vivo". Window B shows setlist in standard reading mode. |
| **Start Live Session** | In Window A, click **Iniciar Culto en Vivo**. | Window A transitions to `🔴 EN VIVO (DIRECTOR)`. Window B automatically connects to SSE and shows `🟢 EN VIVO (SINCRONIZADO)`. |
| **Leader Navigation Sync** | In Window A, click "Siguiente" in the navigation toolbar. | Window B instantaneously advances to the same song/item without user input. |
| **Section Marker Broadcast** | In Window A, select "CORO" from the section dropdown. | Window B displays the blue `[ CORO ]` badge immediately. |
| **Musician Decoupling** | In Window B, click **Desvincular**. In Window A, advance to the next song. | Window B stays on the current song and shows `🟡 ATRIL INDEPENDIENTE`. Window A's navigation does not interrupt Window B. |
| **Musician Re-sync** | In Window B, click **Sincronizar**. | Window B immediately jumps to the song currently active in Window A. |
| **Musician Non-Authority** | Verify Window B has no section dropdown or live navigation broadcast controls. | Only the director has broadcast controls. |
| **Leader End Session** | In Window A, click **Finalizar**. | Both windows return cleanly to normal offline/independent mode. |

---

### 6. Gate C Exit Decision

- **Gate C Result**: **PASSED (Automated Verification Complete)**.
- **Pre-requisite for Gate D**: Multitracks and OMR may now proceed.
