# BETHESDA WORSHIP STUDIO
## PHASE 2A — FINAL INDEPENDENT CERTIFICATION READINESS
### DOCUMENT 04: WORKER LIFECYCLE & DISTRIBUTED SECURITY AUDIT

**Target Module:** `backend/src/application/conversion-worker.ts`  
**Installed Dependency:** `pg-boss v12.38.1`  
**Auditor:** Principal Software Architect, Distributed Systems Specialist  
**Status:** FULLY VERIFIED — ZERO CRITICAL LIFECYCLE DEFECTS  

---

## 1. COMPREHENSIVE AUDIT OF DISTRIBUTED LIFECYCLE INVARIANTS

The conversion worker implementation was subjected to a detailed semantic code audit across all ten distributed lifecycle invariants:

### 1.1 Deterministic Worker Registration (Lines 398–425)
- **Mechanism:** Worker registration invokes `boss.work<ConversionJobPayload>(CONVERSION_QUEUE_NAME, { workerInstanceId: this.workerId }, ...)`.
- **Identity Corroboration:** The unique instance ID (`this.workerId = crypto.randomUUID()`) is embedded into the pg-boss registration options object.
- **Fail-Closed Gate:** If `boss.work` resolves with `null`, `undefined`, or whitespace string, the worker does NOT proceed to `RUNNING`. It transitions immediately to `ERROR` with `registrationState = 'UNCERTAIN'` (Lines 418–425).
- **Security Consequence:** Prevents "phantom consumers" where pg-boss consumes jobs in PostgreSQL while the application runtime is unaware of the subscription.

### 1.2 Subscription Identity Tracking (Lines 420–425)
- **Mechanism:** The returned subscription identifier is captured into `this.subscriptionId`.
- **Strict Validation:** An assertion ensures `typeof subId === 'string' && subId.trim().length > 0`.
- **Registration State:** `this.registrationState = 'REGISTERED'`, and `this.isQueueSubscribed = true`.
- **Lifecycle Transition:** Only after successful registration does the worker transition to `RUNNING`.

### 1.3 Safe Targeted Unsubscription (Lines 988–1007)
- **Invariant:** Unsubscription MUST be targeted to the specific subscription identifier. Global `boss.offWork(queue)` is strictly prohibited.
- **Implementation:**
  ```typescript
  if (!this.subscriptionId) {
    throw new WorkerShutdownError(
      'Fallo crítico de seguridad en desuscripción: la suscripción figura activa pero el identificador de suscripción es nulo. ' +
      'Se prohíbe terminantemente la invocación de offWork() global para preservar a otros consumidores en la cola.'
    );
  }
  const targetSubId = this.subscriptionId;
  await boss.offWork(CONVERSION_QUEUE_NAME, { id: targetSubId, wait: true });
  ```
- **Security Consequence:** Unrelated consumers on the same queue in the same process are guaranteed not to be killed during single-worker teardown.

### 1.4 Mandatory Fail-Closed `getWipData()` Verification (Lines 1008–1030)
- **Invariant:** The application must never assume `boss.offWork()` succeeded merely because the promise resolved without error.
- **Implementation:** Immediately following `boss.offWork()`, the worker calls `boss.getWipData()`, runs `ConversionWorker.validateWipData(rawWip)`, and executes:
  ```typescript
  const isTargetWorkerStillActive = validatedWorkers.some((w) => {
    if (w.name !== CONVERSION_QUEUE_NAME) return false;
    return w.workId === targetSubId || w.id === targetSubId;
  });
  if (isTargetWorkerStillActive) {
    throw new WorkerShutdownError(
      `Fallo autoritativo de verificación de shutdown: pg-boss reporta que el consumidor (${targetSubId}) sigue activo o en estado no detenido tras offWork().`
    );
  }
  ```
- **Security Consequence:** Guarantees that internal errors inside pg-boss's unsubscription loop cannot result in false `STOPPED` reports.

### 1.5 Partial pg-boss Shutdown Failures (Lines 1045–1056)
- **Context:** In pg-boss 12.38.1, `offWork()` uses `Promise.allSettled()` internally when stopping workers, which swallows unhandled rejection errors from worker shutdown.
- **Fail-Closed Protection:** Because Bethesda verifies through `getWipData()`, if an internal error caused the worker to remain registered, Bethesda catches it, sets `this.lifecycleState = 'ERROR'`, sets `this.registrationState = 'UNRESOLVED_ERROR'`, and throws `WorkerShutdownError`.

### 1.6 Concurrent Worker Startup Fencing (Lines 313–329)
- **Invariant:** Concurrent or repeated calls to `start()` must not spawn duplicate consumers.
- **Implementation:**
  - If `this.lifecycleState === 'RUNNING'`, returns immediately (idempotent).
  - If `this.startingPromise` exists, shares the in-flight promise (`return this.startingPromise`).
  - If `this.lifecycleState === 'STOPPING'`, throws `WorkerLifecycleError`.
  - If unsubscription is pending, throws `WorkerLifecycleError`.

### 1.7 Asynchronous Lifecycle Generation Races (Lines 972, 999, 1032, 1046)
- **Context:** If `stop()` times out, the unsubscription promise may resolve seconds later.
- **Implementation:** `this.lifecycleGeneration` is incremented on every lifecycle transition. Upon asynchronous resolution:
  ```typescript
  if (this.lifecycleGeneration !== taskGen) {
    return; // Discard stale state mutation
  }
  ```
- **Security Consequence:** Late-resolving unsubscriptions cannot overwrite a subsequent `start()` or `recover()` cycle.

### 1.8 Residual Consumer Detection (Lines 531–555)
- **Mechanism:** Implemented in `reconcileRegistration()`. If a worker's registration state is `UNCERTAIN`, it queries `boss.getWipData()`, filters for `w.options?.workerInstanceId === this.workerId`, and recovers the exact `workId` generated by pg-boss without fabrication or guessing.

### 1.9 Recovery after Corrupted or Missing Worker Subscription Identifiers
- **Mechanism:** `worker.recover({ reconciledSubscriptionId?: string })` allows explicit operator recovery or automatic residual discovery. If zero matches or ambiguous duplicate matches exist, it fails closed to `ERROR`.

### 1.10 Isolation of Concurrent Consumers on Same Queue
- **Verification:** Proven in Tests 2.4, 2.60, and 2.80. Multiple workers operate on `music-conversion` concurrently; stopping or recovering Worker A leaves Worker B completely undisturbed in memory and database.

---

## 2. PG-BOSS V12.38.1 RUNTIME CONTRACT CONFORMANCE

In pg-boss 12.38.1 `types.d.ts`, `WipData` is defined as:
```typescript
export interface WipData {
  id: string;
  workId: string;
  name: string;
  options: object;
  state: WorkerState;
  count: number;
  createdOn: number;
  lastFetchedOn: number | null;
  lastJobStartedOn: number | null;
  lastJobEndedOn: number | null;
  lastJobDuration: number | null;
  lastError: object | null;
  lastErrorOn: number | null;
}
```

Bethesda's `ConversionWorker.validateWipData()` strictly enforces:
1. `Object.prototype.hasOwnProperty.call(rec, prop)` for all 13 properties.
2. Rejection of `undefined` for nullable properties.
3. Acceptance of explicit `null` and strict types.
4. Total rejection of malformed or partial records.

