# 03 — REAL IDENTITY LOSS ROOT CAUSE AND REMEDIATION
## Bethesda Worship Studio — Phase 2A-R2.2.1-R3.3.1

### 1. Root Cause Analysis
During worker startup, `ConversionWorker.start()` invokes `boss.work(queue, options, handler)`.
Under anomalous runtime conditions (such as API proxy wrappers, network framing corruption, or unexpected middleware returns), `boss.work()` may register the consumer inside pg-boss's internal manager, but return an invalid identifier to the caller:
- `null`
- `undefined`
- `""` (empty string)
- `"   "` (whitespace string)
- Malformed non-string object (`{ id: 123 }`, `[object Object]`, etc.)

Prior to R3.3.1:
1. `validateSubscriptionIdentity` correctly classified these anomalies and transitioned `registrationState = 'UNCERTAIN'` and `lifecycleState = 'ERROR'`.
2. However, calling `recover()` when the returned ID was missing had no deterministic mechanism to discover the actual pg-boss consumer without either:
   - Calling global `boss.offWork(queue)` (which unregisters all peer consumers on the same queue, violating isolation); or
   - Passing an explicit `reconciledSubscriptionId` from the caller.

### 2. The Deterministic Remediation Architecture
To resolve this blocker definitively without guessing, fabricating IDs, or modifying pg-boss library code:

1. **Deterministic Tagging at Registration (`performStart`):**
   ```typescript
   const workOptions = {
     workerInstanceId: this.workerId,
     // standard options
   };
   const subResult = await (this.boss as any).work(
     this.queueName,
     workOptions,
     async (jobs: any[]) => this.handlePgBossJob(jobs)
   );
   ```
   Because pg-boss preserves custom option fields in `worker.options` and exposes them in `getWipData()`, every registered worker in pg-boss carries the unique `workerId` of its parent `ConversionWorker`.

2. **Autonomous Subscription Discovery in `reconcileRegistration()`:**
   When `recover()` is called (either with an explicit ID or during autonomous recovery from an uncertain state):
   - Queries `boss.getWipData()`.
   - Locates matching worker in the WIP list by:
     - Matching `reconciledSubscriptionId` against `w.workId` or `w.id`; OR
     - Matching `(w.options as any)?.workerInstanceId === this.workerId`.
   - If a matching worker is found:
     - Adopts its authoritative ID (`matchingWorker.workId || matchingWorker.id`).
     - Transitions `registrationState = 'REGISTERED'`.
     - Executes targeted `performStop(timeoutMs, throwOnError)`.
     - Targeted `offWork(queue, { id, wait: true })` removes only that specific consumer.
   - If no matching worker is found:
     - If the queue has 0 workers in pg-boss (`queueWorkers.length === 0`), settles authoritatively to `STOPPED`.
     - If other workers exist on the queue (`queueWorkers.length > 0`), the worker **fails closed**: remains in `ERROR`, sets `registrationState = 'UNRESOLVED_ERROR'`, and throws `WorkerShutdownError`.

3. **Protection Against Global `offWork()`:**
   - Under no circumstances does `ConversionWorker` call `boss.offWork(queue)` without a valid `{ id }` option.
   - If an ID is missing and reconciliation fails, `performStop()` refuses to unregister and fails closed.

