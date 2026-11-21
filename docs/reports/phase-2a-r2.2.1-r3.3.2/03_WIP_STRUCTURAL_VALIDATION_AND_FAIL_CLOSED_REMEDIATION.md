# 03 — WIP STRUCTURAL VALIDATION AND FAIL-CLOSED REMEDIATION
## Bethesda Worship Studio — Phase 2A-R2.2.1-R3.3.2

### 1. The Vulnerability in Previous Reconciliations
In Phase 2A-R2.2.1-R3.3.1, verification checked if `boss.getWipData()` returned an array:
```typescript
if (!Array.isArray(activeWorkers)) { ... }
const queueWorkers = activeWorkers.filter((w: any) => w.name === CONVERSION_QUEUE_NAME);
if (queueWorkers.length === 0) {
  this.registrationState = 'REMOVAL_CONFIRMED';
  this.lifecycleState = 'STOPPED';
}
```
If `boss.getWipData()` returned an array with a malformed entry (e.g., `[{}]` or `[null]`), the `filter` condition `w.name === CONVERSION_QUEUE_NAME` evaluated to `false`.
As a result, `queueWorkers` became `[]` (length 0), causing the worker to erroneously deduce that the queue was empty and transition to `STOPPED` and `REMOVAL_CONFIRMED`!
This was a critical fail-open defect where malformed data was falsely interpreted as confirmation of removal.

---

### 2. Centralized Structural Validation Architecture
To resolve this blocker definitively, Phase 2A-R2.2.1-R3.3.2 introduced the centralized validator:
`ConversionWorker.validateWipData(raw: unknown): ValidatedWipEntry[]`

#### Rules Enforced by `validateWipData`:
1. `raw` must be an actual array (`Array.isArray(raw)`). If not, throws `WorkerShutdownError`.
2. Every item `raw[idx]` must be a non-null, non-array object.
3. `id`: Must be a string with `id.trim().length > 0`. Missing, null, undefined, or whitespace-only strings throw immediately.
4. `workId`: Must be a string with `workId.trim().length > 0`. Missing or whitespace-only throws immediately.
5. `name`: Must be a string with `name.trim().length > 0`. Missing or whitespace-only throws immediately.
6. `state`: Must strictly be one of `['created', 'active', 'stopping', 'stopped']`. Any other string throws immediately.
7. `options`: Must be a non-null, non-array object. Missing or primitive throws immediately.
8. `count`: If present, must be a non-negative number (`!isNaN(count) && count >= 0`).
9. `createdOn`: If present, must be a valid numeric timestamp.
10. **Zero Silent Discard:** No entry is ever dropped silently with `.filter()`. If a single entry in `raw` is malformed, the entire validation aborts and throws `WorkerShutdownError`.

---

### 3. Fail-Closed Integration Points

#### A. In `performStop(timeoutMs, throwOnError)`:
```typescript
const rawWip = (boss as any).getWipData();
const validatedWorkers = ConversionWorker.validateWipData(rawWip);

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
If `validateWipData` throws (due to `[{}]`, `[null]`, corrupted fields):
- The catch block in `performStop` triggers:
  - `this.registrationState = 'UNRESOLVED_ERROR'`
  - `this.lifecycleState = 'ERROR'`
  - `this.isQueueSubscribed = true` (preserves subscription flag, never assumes removal)
  - Throws `WorkerShutdownError`
  - Rejects transition to `STOPPED`!

#### B. In `reconcileRegistration(reconciledSubscriptionId, timeoutMs, throwOnError)`:
```typescript
let rawWip: unknown;
try {
  rawWip = (boss as any).getWipData();
} catch (e) {
  // Fail-closed to ERROR / UNRESOLVED_ERROR
}

let validatedWorkers: ValidatedWipEntry[];
try {
  validatedWorkers = ConversionWorker.validateWipData(rawWip);
} catch (e) {
  // Fail-closed to ERROR / UNRESOLVED_ERROR
}
```
If `rawWip` contains `[{}]`, `validateWipData` rejects it before any queue count check.
The worker remains strictly in `ERROR` and `UNRESOLVED_ERROR`.
`start()` cannot be called until authoritative reconciliation occurs.

---

### 4. Ambiguity and Malformed ID Rejection
- If caller provides an explicit `reconciledSubscriptionId`:
  - Empty string (`""`) or whitespace (`"   "`) is rejected with `WorkerShutdownError`.
  - If multiple entries match with divergent `workId` values, the match is rejected as ambiguous (`WorkerShutdownError: identificador ambiguo...`).
- If autonomous recovery is used via `workerInstanceId`:
  - If multiple entries match with divergent `workId` values, the match is rejected as ambiguous (`WorkerShutdownError: múltiples registros distintos...`).

