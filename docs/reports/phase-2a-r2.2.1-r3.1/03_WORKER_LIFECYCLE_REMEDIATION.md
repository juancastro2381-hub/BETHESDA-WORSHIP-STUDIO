# BETHESDA WORSHIP STUDIO — PHASE 2A-R2.2.1-R3.1
## REPORT 03: WORKER LIFECYCLE REMEDIATION ARCHITECTURE

**Author:** Antigravity — Principal Backend Engineer & Distributed Systems Architect  
**Date:** 2026-11-09  
**Target File:** `backend/src/application/conversion-worker.ts`  

---

### 1. Architectural Defects Identified in Phase 2A-R2.2.1-R3

The independent audit identified critical lifecycle hazards in the worker runtime:
1. **Unsafe Optional Verification:** The shutdown verification check in `performStop()` treated `boss.getWipData` as optional (`if (typeof boss.getWipData === 'function')`). If the method was missing or threw, the worker fell through to `STOPPED` despite the queue consumer remaining active.
2. **False Shutdown on Partial pg-boss Failure:** Because `pg-boss` implements `Promise.allSettled` in `offWork()`, an unstopping internal worker does not reject `offWork()`. Without authoritative verification, the worker falsely reported `STOPPED`.
3. **Missing Subscription Identity Tracking:** Workers did not store the `subscriptionId` (returned by `boss.work()`), preventing targeted unsubscription (`offWork({ id })`) and causing multi-worker collisions when inspecting `getWipData()`.
4. **Asynchronous Generation Races:** A timed-out stop operation could settle late in the background and overwrite a newer lifecycle state with stale values.
5. **Concurrent Start Race:** Concurrent invocations of `worker.start()` could register duplicate queue consumers before `lifecycleState` changed to `RUNNING`.

---

### 2. Remediation Implementations

#### 2.1 Subscription Ownership Tracking & Targeted Unsubscription

The worker now records the exact subscription ID returned by `boss.work()` and passes it to `boss.offWork(...)`:

```typescript
// backend/src/application/conversion-worker.ts
private subscriptionId: string | null = null;

// During performStart():
const boss = await startConversionQueue();
const subId = await boss.work<ConversionJobPayload>(CONVERSION_QUEUE_NAME, async (jobs) => {
  for (const job of jobs) {
    await this.processJob(job.data);
  }
});
this.subscriptionId = typeof subId === 'string' ? subId : null;
this.isQueueSubscribed = true;
this.lifecycleState = 'RUNNING';

// During performStop():
if (this.subscriptionId) {
  await boss.offWork(CONVERSION_QUEUE_NAME, { id: this.subscriptionId, wait: true });
} else {
  await boss.offWork(CONVERSION_QUEUE_NAME, { wait: true });
}
```

#### 2.2 Authoritative Fail-Closed Shutdown Verification

Shutdown verification is now mandatory and strictly fail-closed:

```typescript
// AC-01 / AC-02 / AC-03: Mandatory authoritative verification
if (typeof (boss as any).getWipData !== 'function') {
  throw new WorkerShutdownError(
    'Fallo autoritativo de verificación de shutdown: la instancia de pg-boss no implementa getWipData() para auditar el estado de los consumidores.'
  );
}

const activeWorkers = (boss as any).getWipData();
if (!Array.isArray(activeWorkers)) {
  throw new WorkerShutdownError(
    'Fallo autoritativo de verificación de shutdown: getWipData() retornó una respuesta malformada o inesperada (no es un arreglo).'
  );
}

// Check if this worker instance's subscription remains active
const isTargetWorkerStillActive = activeWorkers.some((w: any) => {
  if (w.name !== CONVERSION_QUEUE_NAME) return false;
  if (this.subscriptionId) {
    return w.workId === this.subscriptionId || w.id === this.subscriptionId;
  }
  return true;
});

if (isTargetWorkerStillActive) {
  throw new WorkerShutdownError(
    `Fallo autoritativo de verificación de shutdown: pg-boss reporta que el consumidor (${this.subscriptionId ?? 'global'}) sigue activo o en estado no detenido tras offWork().`
  );
}
```

#### 2.3 Lifecycle Generation Tokens (`lifecycleGeneration`)

To prevent late asynchronous callbacks from overwriting newer lifecycle state:

```typescript
private lifecycleGeneration = 0;

private async performStop(timeoutMs: number, throwOnError: boolean = false): Promise<WorkerStopResult> {
  const deadline = Date.now() + Math.max(0, timeoutMs);
  const operationGen = ++this.lifecycleGeneration;

  // ...
  const unsubscribeTask = (async () => {
    try {
      await boss.offWork(...);
      // Authoritative verification ...

      if (this.lifecycleGeneration !== operationGen) {
        return; // Stale operation discarded
      }

      this.subscriptionId = null;
      this.isQueueSubscribed = false;
      this.unsubscribeSettled = true;
      this.pendingUnsubscribePromise = null;
      this.lastShutdownError = null;
      if (this.lifecycleState === 'STOPPING' || (this.lifecycleState as WorkerLifecycleState) === 'ERROR') {
        this.lifecycleState = 'STOPPED';
      }
    } catch (err) {
      if (this.lifecycleGeneration !== operationGen) {
        return; // Stale error discarded
      }
      this.isQueueSubscribed = true;
      this.unsubscribeSettled = true;
      this.pendingUnsubscribePromise = null;
      this.lastShutdownError = err;
      this.lifecycleState = 'ERROR';
      throw err;
    }
  })();
}
```

#### 2.4 Concurrent Start Deduplication (`startingPromise`)

To prevent concurrent `start()` calls from registering duplicate consumers:

```typescript
private startingPromise: Promise<void> | null = null;

public async start(): Promise<void> {
  // Idempotency check:
  if (this.lifecycleState === 'RUNNING') {
    return;
  }

  // Shared in-flight promise:
  if (this.startingPromise) {
    return this.startingPromise;
  }

  // Guard against pending unsubscription or active error:
  if (this.pendingUnsubscribePromise !== null || !this.unsubscribeSettled) {
    throw new WorkerLifecycleError(...);
  }
  if ((this.lifecycleState as WorkerLifecycleState) === 'ERROR') {
    throw new WorkerLifecycleError(...);
  }
  if (this.isQueueSubscribed) {
    throw new WorkerLifecycleError(...);
  }

  this.lifecycleState = 'STARTING';

  this.startingPromise = (async () => {
    try {
      await this.performStart();
    } finally {
      this.startingPromise = null;
    }
  })();

  return this.startingPromise;
}
```

#### 2.5 Modern Error Cause Chaining (`WorkerShutdownError`)

`WorkerShutdownError` now chains the underlying root error to `this.cause` using standard Node.js error options:

```typescript
export class WorkerShutdownError extends Error {
  public constructor(message: string, public readonly originalError?: unknown) {
    super(message, originalError !== undefined ? { cause: originalError } : undefined);
    this.name = 'WorkerShutdownError';
    if (originalError !== undefined && !this.cause) {
      (this as any).cause = originalError;
    }
  }
}
```

---

### 3. State Invariant Matrix

| Current State | Invocation | Condition | New State | Result / Behavior |
|:---|:---|:---|:---|:---|
| `IDLE` | `start()` | Clean | `RUNNING` | Creates 1 pg-boss subscription, starts recovery |
| `STARTING` | `start()` | Concurrent call | `STARTING` | Awaits `startingPromise`, shares single startup |
| `RUNNING` | `stop()` | Clean shutdown | `STOPPED` | Unsubscribes, verifies `getWipData()`, drains jobs |
| `RUNNING` | `stop()` | Verification missing | `ERROR` | Throws `WorkerShutdownError`, marks `isQueueSubscribed=true` |
| `RUNNING` | `stop()` | Worker in `getWipData` | `ERROR` | Throws `WorkerShutdownError`, marks `isQueueSubscribed=true` |
| `ERROR` | `start()` | Any | `ERROR` | Rejects with `WorkerLifecycleError` |
| `ERROR` | `resetLifecycle()`| Any | `ERROR` | Rejects with `WorkerLifecycleError` (no bypass) |
| `ERROR` | `recover()` | Still failing | `ERROR` | Re-verifies, fails closed, preserves `ERROR` |
| `ERROR` | `recover()` | Condition cleared | `STOPPED` | Retries, verifies `getWipData()`, transitions to `STOPPED` |

