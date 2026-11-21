# 05 — MULTI-CONSUMER ISOLATION EVIDENCE (R331-REAL-02)
## Bethesda Worship Studio — Phase 2A-R2.2.1-R3.3.1

### 1. Test Specification: `R331-REAL-02 [INTEGRATION]`
- **Test File:** `backend/src/__tests__/conversion-worker-certification.test.ts`
- **Test Name:** `2.4 R331-REAL-02 [INTEGRATION]: Multiple real consumers on same queue under registration uncertainty safely preserves peer consumer and avoids global offWork`
- **Execution Target:** Real PostgreSQL 16 database + Real `pg-boss` (v12.38.1) instance with multiple concurrent consumers on the identical queue name.

### 2. Multi-Consumer Scenario & Isolation Guarantee
1. **Peer Consumer Registration:**
   A peer consumer (`peerId`) is registered directly on the shared queue:
   ```typescript
   const peerId = await realBoss.work(queueName, {}, async () => {});
   ```
2. **Second Worker Enters Uncertainty:**
   `worker2` attempts registration, but `boss.work` intercepts and returns empty whitespace (`"  "`).
   - Real consumer is registered in `realBoss` with `{ workerInstanceId: worker2.workerId }`.
   - `worker2` throws `WorkerRegistrationError`, enters `ERROR` / `UNCERTAIN`.
3. **Multi-Consumer State Inspection:**
   `realBoss.getWipData()` verifies exactly 2 active workers on `queueName`:
   - Worker 1: `peerId`
   - Worker 2: `worker2` (carrying `workerInstanceId = worker2.workerId`)
4. **Targeted Recovery Execution:**
   `worker2.recover()` is called.
   - Discovers `worker2` via tagged `workerInstanceId`.
   - Executes targeted `boss.offWork(queueName, { id: matchingWorker.workId, wait: true })`.
   - **Crucial Verification:** Global `boss.offWork(queueName)` is NOT invoked.
5. **Post-Recovery Isolation Proof:**
   `realBoss.getWipData()` is queried immediately after recovery:
   - Exactly 1 worker remains active on the queue.
   - The remaining worker's ID matches `peerId` exactly.
   - Peer consumer was never interrupted, unregistered, or corrupted.
   - `worker2` settles authoritatively to `STOPPED`.

### 3. Execution Result
- Status: **PASSED** (Duration: 5.25ms)
- Exit code: 0
- Log extract:
  ```
  ✔ 2.4 R331-REAL-02 [INTEGRATION]: Multiple real consumers on same queue under registration uncertainty safely preserves peer consumer and avoids global offWork (5.2478ms)
  ```

