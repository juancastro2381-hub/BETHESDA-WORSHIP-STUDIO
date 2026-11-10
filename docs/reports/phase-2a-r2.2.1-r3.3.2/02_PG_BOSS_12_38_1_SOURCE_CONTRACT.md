# 02 — PG-BOSS 12.38.1 SOURCE CONTRACT AND RUNTIME BEHAVIOR
## Bethesda Worship Studio — Phase 2A-R2.2.1-R3.3.2

### 1. Installed Package and Lockfile Verification
- **Package:** `pg-boss`
- **Installed Version:** `12.38.1`
- **Declared in:** `backend/package.json` (`"pg-boss": "^12.38.1"`)
- **Resolved in Lockfile:** `backend/package-lock.json` -> `packages['node_modules/pg-boss'].version: "12.38.1"`
- **Physical Package Metadata:** `backend/node_modules/pg-boss/package.json` -> `"version": "12.38.1"`
- **Distribution Files Inspected:**
  - `backend/node_modules/pg-boss/dist/manager.js`
  - `backend/node_modules/pg-boss/dist/worker.js`
  - `backend/node_modules/pg-boss/dist/attorney.js`
  - `backend/node_modules/pg-boss/dist/types.d.ts`
  - `backend/node_modules/pg-boss/dist/index.d.ts`

---

### 2. Forensic Source Code Analysis

#### A. Registration Mechanism (`boss.work()`)
In `backend/node_modules/pg-boss/dist/manager.js`:
```javascript
// Spawn workers based on localConcurrency setting
for (let i = 0; i < localConcurrency; i++) {
    const workerId = i === 0 ? firstWorkerId : randomUUID({ disableEntropyCache: true });
    const worker = createWorker(workerId, firstWorkerId);
    this.addWorker(worker);
    worker.start();
}
return firstWorkerId;
```
In `createWorker`:
```javascript
const args = Attorney.checkWorkArgs(name, args);
// ...
return new Worker({ id: workerId, workId, name, options, resolveInterval, fetch, onFetch, onError, clock: this.config.clock });
```
**Key Observations:**
1. `firstWorkerId` is generated once per `boss.work()` invocation and returned to the caller.
2. For `localConcurrency: 1` (default):
   - Exactly one worker is spawned with `worker.id === firstWorkerId` and `worker.workId === firstWorkerId`.
   - Here `id === workId`.
3. For `localConcurrency > 1`:
   - Worker 0 has `id: firstWorkerId`, `workId: firstWorkerId`.
   - Subsequent workers have `id: randomUUID()`, `workId: firstWorkerId`.
   - `workId` is the shared correlation key for all workers spawned by that single `work()` call.
4. `Attorney.checkWorkArgs` preserves custom option properties (such as `options.workerInstanceId`), passing them into `Worker.options`.

---

#### B. Teardown Mechanism (`boss.offWork()`)
In `backend/node_modules/pg-boss/dist/manager.js`:
```javascript
async offWork(name, options = { wait: true }) {
    assert(name, 'queue name is required');
    assert(typeof name === 'string', 'queue name must be a string');
    
    const query = (i) => i.name === name && (options?.id ? (i.id === options.id || i.workId === options.id) : true);

    const workers = this.getWorkers().filter(query);
    if (workers.length === 0) {
        return;
    }
    const cleanupPromise = Promise.allSettled(workers.map(async (worker) => {
        await worker.stop();
        this.removeWorker(worker);
    }));
    if (options.wait) {
        await cleanupPromise;
        this.#cleanupLocalGroupTracking(name);
    }
    else {
        this.trackCleanup(cleanupPromise);
        cleanupPromise.finally(() => this.#cleanupLocalGroupTracking(name));
    }
}
```

---

### 3. Mandatory Technical Distinction (What actually happens during offWork)

#### Case 1: Targeted `offWork(queue, { id, wait: true })` — Internal Stop Succeeds
1. `query` matches only the workers where `w.name === queue && (w.id === id || w.workId === id)`.
2. `await worker.stop()` runs, halts polling, drains active jobs, and transitions `worker.state = 'stopped'`.
3. `this.removeWorker(worker)` is executed: `this.workers.delete(worker.id)`. The worker is purged from the internal Map.
4. `cleanupPromise` resolves.
5. In `getWipData()`, the worker is omitted (both because `state === 'stopped'` and because it was deleted from `this.workers`).
6. Removal is authoritatively confirmed.

#### Case 2: Targeted `offWork(queue, { id, wait: true })` — Internal `Worker.stop()` Throws
1. `await worker.stop()` throws an unexpected rejection.
2. The remaining statement `this.removeWorker(worker)` in that map callback is **SKIPPED**!
3. `this.workers.delete(worker.id)` is NEVER called. The worker remains stored in `manager.workers`.
4. Because `Promise.allSettled()` is used, the rejection of `worker.stop()` is **SILENTLY ABSORBED** by `allSettled`.
5. The aggregate `cleanupPromise` resolves successfully!
6. `offWork()` **DOES NOT REJECT**! It returns cleanly with `undefined`.
7. **Crucial Architectural Conclusion:**
   A resolved `offWork()` promise **DOES NOT PROVE** successful worker removal!
   The target worker is still present in `this.workers` and its state is not `'stopped'`.
   Only an independent, authoritative query to `boss.getWipData()` will reveal that the worker is still active.

#### Case 3: Missing `options.id` (`boss.offWork(queue)`)
1. If `options.id` is omitted, `(options?.id ? ... : true)` evaluates to `true` for EVERY worker where `w.name === name`.
2. This invokes unregistration across all active consumers on that queue, destroying peer worker subscriptions.
3. Therefore, Bethesda Worship Studio strictly bans untargeted `boss.offWork(queue)` calls.

---

#### C. Worker WIP Registry Contract (`boss.getWipData()`)
In `backend/node_modules/pg-boss/dist/manager.js`:
```javascript
getWipData(options = {}) {
    const { includeInternal = false } = options;
    const data = this.getWorkers()
        .map(i => i.toWipData())
        .filter(i => i.state !== 'stopped' && (!INTERNAL_QUEUES[i.name] || includeInternal));
    return data;
}
```
In `backend/node_modules/pg-boss/dist/worker.js`:
```javascript
toWipData() {
    return {
        id: this.id,
        workId: this.workId,
        name: this.name,
        options: this.options,
        state: this.state,
        count: this.jobs.length,
        createdOn: this.createdOn,
        lastFetchedOn: this.lastFetchedOn,
        lastJobStartedOn: this.lastJobStartedOn,
        lastJobEndedOn: this.lastJobEndedOn,
        lastError: this.lastError,
        lastErrorOn: this.lastErrorOn,
        lastJobDuration: this.lastJobDuration
    };
}
```
In `backend/node_modules/pg-boss/dist/types.d.ts`:
```typescript
export type WorkerState = 'created' | 'active' | 'stopping' | 'stopped';
export interface WipData {
    id: string;
    workId: string;
    name: string;
    options: WorkOptions;
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

**Field Semantics:**
- **Mandatory Identity Fields:** `id` (string), `workId` (string), `name` (string), `state` ('created' | 'active' | 'stopping' | 'stopped'), `options` (object).
- **Mandatory Metrics:** `count` (number), `createdOn` (number).
- **Optional/Nullable Runtime Telemetry:** `lastFetchedOn`, `lastJobStartedOn`, `lastJobEndedOn`, `lastJobDuration`, `lastError`, `lastErrorOn`.

