# BETHESDA WORSHIP STUDIO — PHASE 2A-R2.2.1-R3.1
## REPORT 02: PG-BOSS API CONTRACT & SOURCE CODE ANALYSIS

**Author:** Antigravity — Principal Backend Engineer & Distributed Systems Architect  
**Date:** 2026-11-09  
**Component:** `pg-boss` (Queue Engine)  
**Version:** `12.38.1` (`backend/package.json`)  
**Source Reference:** `backend/node_modules/pg-boss/src/manager.js`, `backend/node_modules/pg-boss/src/worker.js`, `backend/node_modules/pg-boss/src/boss.js`

---

### 1. Executive Summary

During the Phase 2A-R2.2.1-R3 independent review, defects were identified concerning worker lifecycle transitions, pg-boss subscription tracking, and shutdown verification. A source-level audit of `pg-boss@12.38.1` was performed to identify the exact contracts, failure modes, and verification interfaces provided by the library runtime.

---

### 2. Deep Dive: `pg-boss` Manager and Worker Architecture

In `pg-boss` 12.38.1, background queue consumption is orchestrated by `manager.js`, which maintains an internal list of active worker instances (`this.workers`).

#### 2.1 Subscription Creation: `boss.work()`

In `boss.js` and `manager.js`:
```javascript
async work(name, options, handler) {
  // ...
  const worker = new Worker(name, options, handler, this.db);
  this.workers.push(worker);
  // ...
  return worker.workId; // Returns a UUID string representing the subscription
}
```
**Key Contract Finding:**
- `boss.work()` returns a `string` (UUID) representing `workId` / `subscriptionId`.
- In `manager.js`, each worker has two identifying properties:
  - `id`: The unique worker instance UUID.
  - `workId`: The subscription UUID returned by `work()`.

#### 2.2 Unsubscription Mechanics: `boss.offWork()`

In `manager.js`:
```javascript
async offWork(name, options) {
  const query = (i) =>
    i.name === name &&
    (options?.id ? i.id === options.id || i.workId === options.id : true);

  const workers = this.workers.filter(query);

  if (options?.wait) {
    await Promise.allSettled(
      workers.map(async (worker) => {
        await worker.stop();
        this.removeWorker(worker);
      })
    );
  } else {
    workers.forEach((worker) => worker.stop());
  }
}
```

**Critical Contract Findings:**
1. **Targeted Unsubscription:** `offWork` accepts an `options` parameter with `id`. If `{ id: subscriptionId, wait: true }` is supplied, `offWork` filters candidates specifically matching `i.id === options.id || i.workId === options.id`.
   - *Architectural Implication:* A worker instance can selectively unsubscribe its own consumer without terminating or affecting other concurrent workers operating on the same queue name.
2. **Error Absorption via `Promise.allSettled`:**
   - In `offWork()`, unstopping workers are mapped using `Promise.allSettled(...)`.
   - If an internal worker's `worker.stop()` rejects (due to pending job locks, network failure, or database transaction errors), `Promise.allSettled` catches and absorbs the rejection.
   - Consequently, `this.removeWorker(worker)` is **skipped** for that worker!
   - `offWork()` returns normally and **resolves without throwing**.
   - The failed worker instance **remains in `this.workers`** and continues polling/consuming.
   - **Conclusion:** A resolving `offWork()` promise is **NEVER** proof that the worker has stopped or that the subscription has been removed!

#### 2.3 Authoritative Verification: `boss.getWipData()`

In `manager.js`:
```javascript
getWipData() {
  return this.workers
    .filter((w) => w.state !== 'stopped')
    .map((w) => ({
      id: w.id,
      workId: w.workId,
      name: w.name,
      state: w.state,
      // ...
    }));
}
```

**Contract Invariants:**
1. `getWipData()` queries all internal workers whose state is not `'stopped'`.
2. Each item in the returned array exposes:
   - `id`: Worker instance ID.
   - `workId`: The subscription ID created by `boss.work()`.
   - `name`: The queue name (e.g., `music-conversion`).
   - `state`: The internal lifecycle state (`'active'`, `'stopping'`, etc.).

---

### 3. Fail-Closed Verification Design in `ConversionWorker`

Based on the verified contracts:

| Condition | Old Flawed Behavior | New R3.1 Fail-Closed Behavior |
|:---|:---|:---|
| `typeof boss.getWipData !== 'function'` | Skipped verification silently, assumed `STOPPED` | Throws `WorkerShutdownError`, marks `ERROR`, rejects restart |
| `getWipData()` returns `null` or non-array | Skipped or threw unhandled error | Throws `WorkerShutdownError`, marks `ERROR`, rejects restart |
| `getWipData()` throws an exception | Caught and ignored, assumed `STOPPED` | Captured in `lastShutdownError`, marks `ERROR`, rejects restart |
| `offWork()` resolves but worker is in `getWipData` | Ignored, assumed `STOPPED` (false shutdown) | Detected via `getWipData()`, throws `WorkerShutdownError`, marks `ERROR`, rejects restart |
| Concurrent workers on same queue | Global filter checked queue name only, causing collisions | Filters by `this.subscriptionId`, allowing isolated shutdown |

---

### 4. Summary of API Signatures Verified

- `boss.work<T>(name: string, handler: WorkHandler<T>): Promise<string>`
- `boss.offWork(name: string, options?: { id?: string; wait?: boolean }): Promise<void>`
- `boss.getWipData(): Array<{ id: string; workId: string; name: string; state: string }>`

