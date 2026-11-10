# 04 — SUBSCRIPTION IDENTITY AND CONSUMER ISOLATION
## Bethesda Worship Studio — Phase 2A-R2.2.1-R3.3.2

### 1. The Multi-Consumer Isolation Challenge
In enterprise musical architectures, multiple worker instances or microservices may register consumers on the same PostgreSQL queue (`bethesda-musical-conversion`).
If worker A encounters an anomaly during registration or teardown, invoking `boss.offWork('bethesda-musical-conversion')` without `{ id }` would terminate every consumer on the queue, including healthy workers B and C.

### 2. The `workerInstanceId` Tagging Strategy
When `ConversionWorker` registers with pg-boss in `performStart()`:
```typescript
const subId = await boss.work<ConversionJobPayload>(
  CONVERSION_QUEUE_NAME,
  { workerInstanceId: this.workerId } as any,
  async (jobs) => { ... }
);
```
- `this.workerId` is uniquely generated during worker instantiation (e.g., `cert-ws02-r32-07-w1` or `crypto.randomUUID()`).
- In `pg-boss` 12.38.1:
  - `Attorney.checkWorkArgs` preserves `options.workerInstanceId`.
  - `createWorker` assigns `options` to the new `Worker`.
  - `Worker.toWipData()` returns `options` as an object containing `workerInstanceId`.
- This creates an unforgeable, tamper-proof correlation link directly between the Node.js application worker instance and the pg-boss in-memory worker registry.

### 3. Targeted Teardown Semantics
To stop or recover a worker, Bethesda Worship Studio exclusively executes targeted teardown:
```typescript
await boss.offWork(CONVERSION_QUEUE_NAME, { id: targetSubId, wait: true });
```
- In `manager.offWork`, the predicate is:
  `query = (i) => i.name === name && (options?.id ? (i.id === options.id || i.workId === options.id) : true);`
- Passing `targetSubId` matches either `i.id === targetSubId` (targeting a specific thread) or `i.workId === targetSubId` (targeting all localConcurrency workers belonging to that registration).
- Unrelated peer consumers with different `id` and `workId` evaluate to `false` and remain 100% untouched and operational.

### 4. Banning of Global `offWork`
Under NO circumstances is `boss.offWork(CONVERSION_QUEUE_NAME)` invoked without `{ id }`.
If a worker lacks a subscription ID and cannot locate its consumer in `getWipData()`, and other workers exist on the queue:
- It **fails closed**: transitions to `ERROR` and `UNRESOLVED_ERROR`.
- It logs a detailed error and refuses to unregister the queue globally.
- Peer consumers are preserved without disruption.

