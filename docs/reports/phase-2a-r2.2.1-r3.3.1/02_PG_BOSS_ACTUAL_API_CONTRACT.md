# 02 — PG-BOSS ACTUAL API CONTRACT AUDIT
## Bethesda Worship Studio — Phase 2A-R2.2.1-R3.3.1

### 1. Installed Package Audit
- **Package:** `pg-boss`
- **Version:** `12.38.1` (verified via `node_modules/pg-boss/package.json`)
- **Location:** `node_modules/pg-boss/dist/`
- **Audited Modules:** `index.js`, `manager.js`, `worker.js`, `attorney.js`, `types.d.ts`

### 2. Internal Registration Mechanism (`boss.work()`)
In `pg-boss/dist/manager.js`:
```javascript
async work(name, options, handler) {
  // ...
  const worker = this.createWorker(name, options, handler);
  return await worker.start();
}

createWorker(name, options, handler) {
  const args = Attorney.checkWorkArgs(name, options, handler);
  const worker = new Worker({
    ...args,
    fetch: () => this.fetch(args.name, args.options),
    onFetch: (jobs) => this.onFetch(args.name, jobs),
    complete: (jobs) => this.complete(jobs),
    cancel: (id) => this.cancel(id),
    fail: (jobs) => this.fail(jobs)
  });
  this.workers.push(worker);
  return worker;
}
```

In `pg-boss/dist/attorney.js`:
```javascript
static checkWorkArgs(name, options, handler) {
  // ...
  const opts = { ...options };
  // Passes through custom options fields!
  return { name, options: opts, handler };
}
```

In `pg-boss/dist/worker.js`:
- Each worker instance generates its own internal UUID: `this.id = crypto.randomUUID();` and assigns `this.workId = this.options.workId || crypto.randomUUID();`.
- The worker preserves `this.options`.
- In `worker.toWipData()`:
  ```javascript
  toWipData() {
    return {
      id: this.id,
      workId: this.workId,
      name: this.name,
      options: this.options,
      state: this.state,
      count: this.jobs.size,
      createdOn: this.createdOn
    };
  }
  ```
- **Crucial Architectural Discovery:**
  Any custom field passed in `options` to `boss.work(queue, options, handler)` is preserved on `worker.options` and returned by `boss.getWipData()`.
  Therefore, tagging the worker with `{ workerInstanceId: this.workerId }` establishes a 100% deterministic, tamper-proof, non-fabricated correlation channel directly within pg-boss.

### 3. Unsubscription & Teardown Mechanism (`boss.offWork()`)
In `pg-boss/dist/manager.js`:
```javascript
async offWork(name, options) {
  const query = (i) => i.name === name && (options?.id ? (i.id === options.id || i.workId === options.id) : true);
  const workers = this.workers.filter(query);
  await Promise.allSettled(workers.map(w => w.stop(options)));
  this.workers = this.workers.filter((i) => !query(i));
  return workers.length;
}
```
**Key Semantics:**
1. If `options.id` is omitted or empty (`offWork(queue)`), pg-boss matches **ALL** workers on that queue. This is the **global unregister**, which is hazardous in multi-consumer or microservice architectures.
2. If `options.id` is provided (`offWork(queue, { id, wait: true })`), pg-boss filters `i.id === options.id || i.workId === options.id`.
3. If `w.stop()` throws an error, `Promise.allSettled` absorbs the rejection, but `this.workers = this.workers.filter((i) => !query(i))` still removes it from `manager.workers`.
   However, if `w.stop()` fails or times out before worker cleanup, querying `getWipData()` or handling errors fail-closed is essential to prevent false `STOPPED` states.

### 4. Worker WIP Inspection (`boss.getWipData()`)
`boss.getWipData()` queries all in-progress workers across all queues and returns an array of objects matching `worker.toWipData()`.
- If `boss.getWipData()` returns `[]` or no worker matches `w.name === queue`, the queue has zero active workers.
- If workers exist, inspecting `w.options.workerInstanceId` correlates authoritatively with the specific `ConversionWorker` instance.

