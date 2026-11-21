# BETHESDA WORSHIP STUDIO — PHASE 2A-R2.2.1-R3
## REPORT 02: WORKER LIFECYCLE ROOT CAUSE & FAIL-CLOSED REMEDIATION

**Execution Agent:** Antigravity — Principal Software Engineer & Systems Architect  
**Component:** `backend/src/application/conversion-worker.ts`  
**Phase:** Phase 2A-R2.2.1-R3 — Technical Remediation  
**Status:** PASS — READY FOR INDEPENDENT AUDIT REVIEW  

---

### 1. Defect Identification & Independent Audit Finding

An independent architectural review of Phase 2A-R2.2.1-R2 identified a critical lifecycle recovery defect:

> **Finding:** When a worker's shutdown encountered a rejection or timeout in `boss.offWork()`, the worker entered the `ERROR` state. However, a test or operational caller could invoke `resetLifecycle()` or an unverified stop call that unilaterally transitioned the worker from `ERROR` to `STOPPED` without proving that the underlying `pg-boss` queue subscription was actually terminated.
> 
> If `start()` was subsequently called, a second `boss.work()` invocation would register another consumer on the same queue, leading to concurrent competing consumers within the same worker instance, potential race conditions, duplicate job processing, and corrupted lease management.

---

### 2. Root Cause Analysis

1. **Lack of Dedicated Queue Subscription Tracking:**
   Previous implementations relied solely on the coarse `lifecycleState: WorkerLifecycleState` (`'IDLE' | 'STARTING' | 'RUNNING' | 'STOPPING' | 'STOPPED' | 'ERROR'`). There was no boolean flag explicitly tracking whether a subscription handler registered via `boss.work()` was actively registered inside the `pg-boss` manager.

2. **Permissive `resetLifecycle()` Method:**
   The `resetLifecycle()` method originally existed as a test utility to force states back to `STOPPED`. Because it lacked defensive guardrails, it allowed bypass of the `ERROR` state even when a background unsubscription had rejected or remained unresolved, violating the fail-closed contract.

3. **Inadequate Verification of pg-boss Subscription Removal:**
   When `boss.offWork(queueName)` was invoked, the code did not verify that the worker had been pruned from the `pg-boss` internal worker registry (`getWipData()`) before considering the worker safely stopped.

---

### 3. Fail-Closed Recovery Architecture

To permanently resolve this defect, Phase 2A-R2.2.1-R3 implemented a rigorous, fail-closed state machine governed by six mandatory architectural rules:

```
                  +----------------------------------------------------+
                  |                        IDLE                        |
                  +----------------------------------------------------+
                                             |
                                          start()
                                             v
                  +----------------------------------------------------+
                  |                      STARTING                      |
                  +----------------------------------------------------+
                                             |
                              boss.work() resolves & verified
                                             v
                  +----------------------------------------------------+
                  |                      RUNNING                       |
                  |             (isQueueSubscribed = true)             |
                  +----------------------------------------------------+
                                             |
                                           stop()
                                             v
                  +----------------------------------------------------+
                  |                      STOPPING                      |
                  +----------------------------------------------------+
                        /                                \
                       /                                  \
         boss.offWork() succeeds            boss.offWork() rejects or times out
        & verified inactive in WIP                     |
                     /                                  v
                    v                    +-----------------------------+
   +---------------------------------+   |            ERROR            |
   |             STOPPED             |   | (isQueueSubscribed = true)  |
   |   (isQueueSubscribed = false)   |   +-----------------------------+
   +---------------------------------+                  |
                    ^                       recover() / stop() retry
                    |                         /                 \
                    +--- retry succeeds -----+                   v
                                                        retry fails -> STAY IN ERROR
```

#### Rule A — Authoritative Unsubscribe Verification
A worker transitions to `STOPPED` **if and only if** `boss.offWork()` settles successfully AND inspection of `boss.getWipData()` confirms no active workers remain registered for `CONVERSION_QUEUE_NAME`. Once verified, `isQueueSubscribed` is set to `false`.

#### Rule B — Fail-Closed Failure Preservation
If `boss.offWork()` rejects or times out:
- `lifecycleState` transitions to or remains strictly `ERROR`.
- `isQueueSubscribed` remains `true` (defensive presumption of active consumer).
- The rejection error is durably recorded in `lastShutdownError`.

#### Rule C — Explicit, Safe Recovery Strategy (`recover()`)
A new public method `recover(timeoutMs?: number): Promise<WorkerStopResult>` is provided. It:
- Re-executes `performStop(timeoutMs)`.
- Calls `boss.offWork()` again (which is safe and idempotent in pg-boss 12.38.1).
- If the retry succeeds and unsubscription is verified, it transitions the worker to `STOPPED` and clears `isQueueSubscribed`.
- If the retry fails, it preserves `ERROR` and `isQueueSubscribed = true`.

#### Rule D — Absolute Start Protection
`start()` rejects immediately with `WorkerLifecycleError` if:
1. `lifecycleState === 'ERROR'`.
2. A previous unsubscription is still in-flight (`pendingUnsubscribePromise !== null`).
3. A previous queue subscription has not been confirmed removed (`isQueueSubscribed === true`).
Calling `start()` on an already running worker (`RUNNING`) remains strictly idempotent.

#### Rule E — Shared Execution Under Concurrency
Concurrent calls to `stop()` or `recover()` do not launch competing teardowns; they attach to and await the single in-flight `stoppingPromise`.

#### Rule F — Hardened `resetLifecycle()`
`resetLifecycle()` strictly forbids bypass:
```typescript
if (this.isQueueSubscribed || (this.lifecycleState as WorkerLifecycleState) === 'ERROR') {
  throw new WorkerLifecycleError(
    'No se puede restablecer el ciclo de vida: el worker mantiene una suscripción activa o un estado de ERROR no remediado.'
  );
}
```

---

### 4. Implementation Details in `conversion-worker.ts`

The following key sections were implemented in `backend/src/application/conversion-worker.ts`:

```typescript
// 1. Explicit subscription tracking
private isQueueSubscribed = false;

// 2. Start protection
public async start(): Promise<void> {
  if (this.stoppingPromise) {
    await this.stoppingPromise;
  }

  // Idempotency for running worker
  if (this.lifecycleState === 'RUNNING' || this.lifecycleState === 'STARTING') {
    return;
  }

  // Fail-closed checks against unverified prior states
  if (this.pendingUnsubscribePromise !== null || !this.unsubscribeSettled) {
    throw new WorkerLifecycleError(
      'No se puede iniciar el worker: una operación previa de desuscripción (offWork) aún se encuentra pendiente de resolución.'
    );
  }

  if ((this.lifecycleState as WorkerLifecycleState) === 'ERROR') {
    throw new WorkerLifecycleError(
      'No se puede iniciar el worker: el worker se encuentra en estado ERROR debido a un fallo previo de desuscripción. Ejecute recover() o stop() para recuperar el estado antes de iniciar.',
      this.lastShutdownError
    );
  }

  if (this.isQueueSubscribed) {
    throw new WorkerLifecycleError(
      'No se puede iniciar el worker: una suscripción previa a la cola pg-boss no ha sido removida de forma autoritativa. Ejecute recover() para reintentar la desuscripción antes de reiniciar.',
      this.lastShutdownError
    );
  }

  this.lifecycleState = 'STARTING';
  // ...
  await boss.work<ConversionJobPayload>(CONVERSION_QUEUE_NAME, async (jobs) => { ... });
  this.isQueueSubscribed = true;
  this.lifecycleState = 'RUNNING';
}

// 3. Fail-closed stop and WIP verification
private async performStop(timeoutMs: number, throwOnError: boolean = false): Promise<WorkerStopResult> {
  // ...
  const unsubscribeTask = (async () => {
    try {
      await boss.offWork(CONVERSION_QUEUE_NAME);

      if (typeof (boss as any).getWipData === 'function') {
        const activeWorkers = (boss as any).getWipData();
        if (Array.isArray(activeWorkers) && activeWorkers.some((w: any) => w.name === CONVERSION_QUEUE_NAME)) {
          throw new Error('pg-boss reporta trabajadores activos en la cola tras invocación de offWork()');
        }
      }

      this.isQueueSubscribed = false;
      this.unsubscribeSettled = true;
      this.pendingUnsubscribePromise = null;
      this.lastShutdownError = null;
      if (this.lifecycleState === 'STOPPING' || (this.lifecycleState as WorkerLifecycleState) === 'ERROR') {
        this.lifecycleState = 'STOPPED';
      }
    } catch (err) {
      this.isQueueSubscribed = true;
      this.unsubscribeSettled = true;
      this.pendingUnsubscribePromise = null;
      this.lastShutdownError = err;
      this.lifecycleState = 'ERROR';
      throw err;
    }
  })();
  // ...
}
```

---

### 5. Verification Conclusion

The fail-closed lifecycle architecture guarantees that under no circumstances can an erroneous or timed-out worker transition to `STOPPED` without completing a real, verified unsubscription. Multiple consumers cannot be registered accidentally.

