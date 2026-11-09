# BETHESDA WORSHIP STUDIO — PHASE 2A-R2.2.1-R2
## REPORT 02: WORKER SHUTDOWN LIFECYCLE & CONCURRENCY REMEDIATION

**Execution Agent:** Antigravity — Principal Software Engineer & Systems Architect  
**Location:** `backend/src/application/conversion-worker.ts`  
**Phase:** Phase 2A-R2.2.1-R2 — Technical Remediation  
**Status:** PASS — READY FOR INDEPENDENT AUDIT REVIEW  

---

### 1. Root Cause Analysis of Pre-Remediation Defects

Prior to Phase 2A-R2.2.1-R2, independent review identified critical lifecycle vulnerabilities in `backend/src/application/conversion-worker.ts`:

1. **Unconditional State Overwrite in `.finally()`:**
   In R2.2.1-R1, `stop()` executed:
   ```ts
   this.stoppingPromise = this.performStop(timeoutMs).finally(() => {
     this.lifecycleState = 'STOPPED';
     this.stoppingPromise = null;
   });
   ```
   If `boss.offWork()` timed out or rejected, the worker was unconditionally forced into `STOPPED`, falsely signaling to callers that the worker was cleanly stopped and safe to restart.

2. **Shutdown / Restart Race Condition & Overlapping Subscriptions:**
   When `stop(timeoutMs)` reached its deadline while `boss.offWork()` remained pending in the background, a subsequent call to `start()` would create a new pg-boss subscription (`await boss.work(...)`) while the earlier unsubscription was still unresolved. If the earlier unsubscribe subsequently settled or if jobs arrived in between, duplicate message consumers or silent unsubscription of the new worker instance occurred.

3. **Masked Unsubscribe Errors:**
   Errors during `offWork()` were swallowed in a generic `catch {}` block. The worker provided no visibility into failed unsubscriptions, and neither stored the error nor transitioned to an explicit `ERROR` state.

4. **Caller Deadline Conflated with Background Settlement:**
   The caller's bounded wait (`stop(timeoutMs)`) was conflated with the actual settlement of the underlying pg-boss promise.

---

### 2. Architectural Solution Implemented (WS01)

#### 2.1 Explicit Typed Errors
```ts
export class WorkerLifecycleError extends Error {
  public constructor(message: string, public readonly originalError?: unknown) {
    super(message);
    this.name = 'WorkerLifecycleError';
  }
}

export class WorkerShutdownError extends Error {
  public constructor(message: string, public readonly originalError?: unknown) {
    super(message);
    this.name = 'WorkerShutdownError';
  }
}
```

#### 2.2 Comprehensive State Machine & Return Types
```ts
export type WorkerLifecycleState =
  | 'IDLE'
  | 'STARTING'
  | 'RUNNING'
  | 'STOPPING'
  | 'STOPPED'
  | 'ERROR';

export interface WorkerStopOptions {
  timeoutMs?: number;
  throwOnError?: boolean;
}

export interface WorkerStopResult {
  readonly success: boolean;
  readonly state: WorkerLifecycleState;
  readonly offWorkSettled: boolean;
  readonly activeJobsDrained: boolean;
  readonly remainingJobsCount: number;
  readonly timedOut: boolean;
  readonly error?: unknown;
}
```

#### 2.3 Authoritative In-Flight Unsubscribe Tracking
Four dedicated fields track the exact status of underlying unsubscriptions independently from caller timeouts:
- `pendingUnsubscribePromise: Promise<void> | null` — Permanent reference to the background task until full resolution.
- `unsubscribeSettled: boolean` — Indicates whether `boss.offWork()` has genuinely settled.
- `lastShutdownError: unknown | null` — Stores any rejection from `boss.offWork()`.
- `isShutdownTimedOut: boolean` — Indicates whether the caller's bounded wait expired before unsubscription or drain settled.

#### 2.4 Separation of Caller Wait from Background Settlement
In `performStop()`:
1. When unsubscription begins, `pendingUnsubscribePromise` is assigned and attached with permanent settlement handlers.
2. The caller races against their deadline via a bounded timeout promise.
3. If the timeout fires:
   - `timedOutDuringOffWork = true`
   - `isShutdownTimedOut = true`
   - `lifecycleState` remains `'STOPPING'` (never `'STOPPED'`).
   - The returned `WorkerStopResult` reports `{ success: false, state: 'STOPPING', offWorkSettled: false, timedOut: true }`.
4. When the underlying `offWork()` finishes in the background, its permanent continuation transitions state:
   - On resolution: `if (this.lifecycleState === 'STOPPING') this.lifecycleState = 'STOPPED';`
   - On rejection: `this.lifecycleState = 'ERROR'; this.lastShutdownError = err;`

#### 2.5 Fail-Closed Restart Semantics in `start()`
When `start()` is invoked:
1. **Synchronization with active shutdown:** If `stoppingPromise` is running, `start()` awaits it to permit clean settlement within the deadline.
2. **Pending Unsubscribe Protection:** If `pendingUnsubscribePromise !== null || !unsubscribeSettled`, `start()` immediately rejects with `WorkerLifecycleError('No se puede iniciar el worker: una operación previa de desuscripción (offWork) aún se encuentra pendiente de resolución.')`. Under no circumstances is `boss.work()` invoked, eliminating duplicate or overlapping queue subscriptions.
3. **Error State Protection:** If `lifecycleState === 'ERROR'`, `start()` rejects with `WorkerLifecycleError`, demanding explicit recovery via `resetLifecycle()` or `stop()`.

#### 2.6 Shared Concurrency on `stop()`
If `stop()` is called concurrently from multiple callers, the first invocation initializes `stoppingPromise`. Subsequent calls immediately share and await the identical `stoppingPromise`, receiving the exact same `WorkerStopResult` without duplicate unsubscriptions or race conditions.

#### 2.7 Inspector and Safe Recovery Methods
- `getLifecycleState(): WorkerLifecycleState`
- `getPendingUnsubscribeOperation(): Promise<void> | null`
- `isUnsubscribePending(): boolean`
- `getLastShutdownError(): unknown | null`
- `hasShutdownTimedOut(): boolean`
- `resetLifecycle(): void` (guarded: throws `WorkerLifecycleError` if unsubscribe is still in flight; safely resets `'ERROR'` to `'STOPPED'`).

---

### 3. Verification Summary

- **Typecheck:** Clean (`tsc --noEmit` exited with code 0).
- **Concurrency Safety:** Verified across Scenarios A through H in `backend/src/__tests__/conversion-worker-certification.test.ts`.
- **Status:** PASS — READY FOR INDEPENDENT AUDIT REVIEW.

