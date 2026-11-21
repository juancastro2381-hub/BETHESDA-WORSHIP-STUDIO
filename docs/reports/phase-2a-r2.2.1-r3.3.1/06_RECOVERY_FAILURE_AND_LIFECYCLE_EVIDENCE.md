# 06 — RECOVERY FAILURE AND LIFECYCLE EVIDENCE (R331-REAL-03 & 2.30)
## Bethesda Worship Studio — Phase 2A-R2.2.1-R3.3.1

### 1. Test Specification: `R331-REAL-03 [INTEGRATION]`
- **Test File:** `backend/src/__tests__/conversion-worker-certification.test.ts`
- **Test Name:** `2.29 R331-REAL-03 [INTEGRATION]: Real recovery failure under identity loss preserves ERROR and fail-closed state without corrupting peer consumers`
- **Objective:** Prove that if targeted recovery encounters a real infrastructure failure when stopping the consumer (e.g. `offWork` throws or worker teardown rejects), the system preserves fail-closed `ERROR`, forbids false `STOPPED`, blocks restart, and preserves peer consumers.

### 2. Failure Injection & Behavior
1. **Peer Consumer Registration:**
   A peer consumer is registered on queue `test-r331-real-03`.
2. **Worker Registration with Corrupted Return:**
   `worker` registers on queue, but return value is corrupted (`undefined`). Worker enters `UNCERTAIN` and `ERROR`.
3. **Simulated Teardown Failure during Recovery:**
   `realBoss.offWork` is temporarily wrapped to reject with `new Error('Simulated pg-boss connection drop during offWork')`.
4. **Recovery Attempt:**
   `worker.recover()` is called.
   - Throws `WorkerShutdownError`.
   - `worker.getLifecycleState()` remains strictly in `ERROR`.
   - `worker.getRegistrationState()` remains `UNRESOLVED_ERROR`.
   - Attempting `worker.start()` is rejected with `WorkerStateError` ("Worker can only be started from IDLE or STOPPED state; current state: ERROR").
5. **Subsequent Successful Recovery:**
   Once the transient offWork failure is cleared, a subsequent `worker.recover()` succeeds.
   - Target consumer is cleanly removed.
   - Peer consumer remains active in `realBoss.getWipData()`.
   - Worker settles to `STOPPED`.

### 3. Unrelated Consumer Safety (Test 2.30)
- **Test Name:** `2.30 Residual consumer detection with unrelated consumer preserves ERROR when no match found [Integration]`
- **Scenario:** Queue has active consumers, but none carry `workerInstanceId === worker.workerId`.
- **Behavior:**
  Because the queue is NOT empty, `reconcileRegistration()` refuses to assume the worker was already stopped. It fails closed to `ERROR` with `WorkerShutdownError` and `registrationState = 'UNRESOLVED_ERROR'`.

### 4. Execution Result
- Status: **PASSED** (Duration: 4.63ms & 3.08ms)
- Exit code: 0
- Log extract:
  ```
  ✔ 2.29 R331-REAL-03 [INTEGRATION]: Real recovery failure under identity loss preserves ERROR and fail-closed state without corrupting peer consumers (4.6304ms)
  ✔ 2.30 Residual consumer detection with unrelated consumer preserves ERROR when no match found [Integration] (3.083ms)
  ```

