# 04 — REAL IDENTITY LOSS INTEGRATION EVIDENCE (R331-REAL-01)
## Bethesda Worship Studio — Phase 2A-R2.2.1-R3.3.1

### 1. Test Specification: `R331-REAL-01 [INTEGRATION]`
- **Test File:** `backend/src/__tests__/conversion-worker-certification.test.ts`
- **Test Name:** `2.3 R331-REAL-01 [INTEGRATION]: Real pg-boss registration identity loss safely detects residual consumer, recovers exact identity without fabrication, and settles cleanly to STOPPED`
- **Execution Target:** Real PostgreSQL 16 database + Real `pg-boss` (v12.38.1) instance. No mocks or stubs of `boss.work` or `boss.getWipData`.

### 2. Failure Injection & Execution Flow
1. **Real Infrastructure Initialization:**
   A real `PgBoss` instance is created and started against the real test database.
2. **Boundary Interception (Identity Loss Simulation):**
   ```typescript
   const realWork = realBoss.work.bind(realBoss);
   let workCalls = 0;
   (realBoss as any).work = async (name: string, options: any, handler: any) => {
     workCalls++;
     const realId = await realWork(name, options, handler);
     // Simulate return-value corruption at application boundary:
     // The consumer is fully registered in real pg-boss, but caller receives null
     return null;
   };
   ```
3. **Startup & Detection of Identity Loss:**
   `worker.start()` is invoked.
   - `boss.work()` executes for real, registering a real worker in `realBoss`.
   - The intercepted return value is `null`.
   - `worker.start()` throws `WorkerRegistrationError`.
   - Lifecycle state verifies as `ERROR`.
   - `registrationState` verifies as `UNCERTAIN`.
4. **Authoritative Evidence of Residual Consumer:**
   `realBoss.getWipData()` is inspected directly:
   - Contains exactly 1 active worker for queue `test-r331-real-01`.
   - Worker options verify as `{ workerInstanceId: worker.workerId }`.
   - Proves a real residual consumer exists in pg-boss despite application receiving `null`.
5. **Recovery Without Fabrication:**
   `worker.recover()` is called **without** any manual ID argument.
   - `reconcileRegistration()` queries `realBoss.getWipData()`.
   - Matches worker via `(w.options as any)?.workerInstanceId === worker.workerId`.
   - Recovers real subscription ID (`matchingWorker.workId || matchingWorker.id`).
   - Executes targeted `boss.offWork(queue, { id: recoveredId, wait: true })`.
6. **Authoritative Absence Verification:**
   - Direct query to `realBoss.getWipData()` confirms 0 workers remain for this queue.
   - `worker.getLifecycleState()` settles cleanly to `STOPPED`.
   - `worker.getRegistrationState()` transitions to `NONE`.
   - Subsequent `worker.start()` succeeds cleanly with valid ID.

### 3. Execution Result
- Status: **PASSED** (Duration: 24.66ms)
- Exit code: 0
- Log extract:
  ```
  ✔ 2.3 R331-REAL-01 [INTEGRATION]: Real pg-boss registration identity loss safely detects residual consumer, recovers exact identity without fabrication, and settles cleanly to STOPPED (24.6632ms)
  ```

