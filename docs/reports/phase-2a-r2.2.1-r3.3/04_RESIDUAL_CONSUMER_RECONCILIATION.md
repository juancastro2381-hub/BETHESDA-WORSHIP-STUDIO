# Bethesda Worship Studio — Phase 2A-R2.2.1-R3.3
## Report 04: Authoritative Residual Consumer Reconciliation Architecture

**Audit Finding Reference:** Blocker R33-02  
**Target Code:** `ConversionWorker.reconcileRegistration()` and `ConversionWorker.recover()`

---

### 1. The Dilemma of Residual Consumers

In distributed systems backed by PostgreSQL work queues like `pg-boss`, worker unsubscription must never invoke global `offWork(queueName)` without `{ id }`, because doing so kills all active workers across the entire process on that queue.

When a worker's registration response is invalid, the worker lacks an exact `subscriptionId`. To safely reconcile this state without destructive side effects, `ConversionWorker` implements two deterministic reconciliation paths:

---

### 2. Reconciliation Path A: Exact Identity Reconciliation

When an operator, monitoring harness, or recovery routine discovers the exact worker subscription ID (via inspection of `pg-boss.getWipData()` or worker process logs):

1. The caller executes `worker.recover({ reconciledSubscriptionId: targetSubId })` or `worker.reconcileRegistration(targetSubId)`.
2. `reconcileRegistration()` verifies `getWipData()` from pg-boss.
3. It finds the matching worker in `getWipData()`.
4. It adopts `this.subscriptionId = targetSubId` and transitions to `'REGISTERED'`.
5. It executes targeted unsubscription `boss.offWork(CONVERSION_QUEUE_NAME, { id: targetSubId, wait: true })`.
6. It authoritatively confirms absence in `getWipData()`.
7. It transitions the worker to `'STOPPED'` with `registrationState = 'REMOVAL_CONFIRMED'`.

```typescript
if (typeof reconciledSubscriptionId === 'string' && reconciledSubscriptionId.trim().length > 0) {
  const targetId = reconciledSubscriptionId.trim();
  const matchingWorker = queueWorkers.find((w: any) => w.workId === targetId || w.id === targetId);
  if (!matchingWorker) {
    if (queueWorkers.length === 0) {
      // Authoritative absence: queue is completely empty in pg-boss
      this.registrationState = 'REMOVAL_CONFIRMED';
      this.lifecycleState = 'STOPPED';
      return { success: true, state: 'STOPPED', ... };
    }
    // Matching worker not found but other workers exist: fail closed
    throw new WorkerShutdownError(...);
  }
  this.subscriptionId = targetId;
  this.registrationState = 'REGISTERED';
  return this.performStop(timeoutMs, throwOnError);
}
```

---

### 3. Reconciliation Path B: Authoritative Absence Proof

When NO `reconciledSubscriptionId` is provided (e.g. standard `recover()` or `stop()` call):
1. `reconcileRegistration()` inspects `boss.getWipData()`.
2. If `queueWorkers.length === 0`:
   - This provides **authoritative mathematical proof** that no worker exists on `CONVERSION_QUEUE_NAME` anywhere in the current pg-boss instance.
   - The worker may safely transition to `'STOPPED'` and `registrationState = 'REMOVAL_CONFIRMED'`.
3. If `queueWorkers.length > 0`:
   - Other workers exist on the queue. Because we cannot know which one (if any) was created by our failed registration, **we must fail closed**.
   - Invoking global `offWork()` is strictly prohibited.
   - The worker remains in `'ERROR'`, `registrationState = 'UNRESOLVED_ERROR'`, and throws `WorkerShutdownError`.

---

### 4. Verification Capability Requirements (Fail-Closed)

In accordance with WS02 / WS03:
- If `boss.getWipData` is undefined: Fail closed with `WorkerShutdownError`.
- If `boss.getWipData()` throws: Fail closed with `WorkerShutdownError`.
- If `boss.getWipData()` returns null or non-array: Fail closed with `WorkerShutdownError`.

