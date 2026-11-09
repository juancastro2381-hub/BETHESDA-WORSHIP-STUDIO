# BETHESDA WORSHIP STUDIO — PHASE 2A-R2.2.1-R3
## REPORT 03: DETERMINISTIC REGRESSION TEST SUITE (SCENARIOS A – H)

**Execution Agent:** Antigravity — Principal Software Engineer & Systems Architect  
**Test File:** `backend/src/__tests__/conversion-worker-certification.test.ts`  
**Phase:** Phase 2A-R2.2.1-R3 — Technical Remediation  
**Status:** PASS (37/37 Tests Passed)  

---

### 1. Overview of WS02 Deterministic Scenarios

In Phase 2A-R2.2.1-R3, the shutdown and restart lifecycle test suite (WS02) was refactored and expanded to explicitly codify Scenarios A through H as defined by the Product Owner directive.

Every test uses real asynchronous execution, deterministic coordination barriers (promises/deferreds), and strict assertions against internal and observable lifecycle state.

---

### 2. Detailed Breakdown: Scenarios A through H

#### Scenario A (Test 2.1): Normal Clean Shutdown
- **Purpose:** Verify that when `boss.offWork()` resolves cleanly within deadline, the worker smoothly transitions to `STOPPED`, clears `isQueueSubscribed`, and reports successful unsubscription.
- **Verification:**
  - `result.success === true`
  - `result.state === 'STOPPED'`
  - `result.offWorkSettled === true`
  - `worker.isActive() === false`
  - `worker.isSubscribed() === false`

#### Scenario B (Test 2.2): Unsubscribe Rejection Transitions to ERROR and Blocks New Subscriptions
- **Purpose:** Verify Rule B: when `boss.offWork()` rejects with an unexpected error, the worker transitions to `ERROR`, preserves `isQueueSubscribed = true`, and blocks subsequent calls to `start()`.
- **Implementation:**
  - `boss.offWork` spy rejects with `new Error('Simulated network failure on offWork')`.
  - Worker enters `ERROR`.
  - Subsequent `await worker.start()` rejects with `WorkerLifecycleError`.
  - Verifies error message specifically explains that the worker is in `ERROR` state due to previous unsubscribe failure.

#### Scenario C (Test 2.3): Recovery Attempt Fails Closed
- **Purpose:** Verify Rule C: when an explicit recovery attempt (`worker.recover()`) is made but `offWork()` continues to fail, the worker preserves `ERROR` state and does not transition to `STOPPED`.
- **Implementation:**
  - Worker is put in `ERROR` via failed `stop()`.
  - `boss.offWork` is configured to fail again.
  - `const recoveryResult = await worker.recover(500);`
  - `recoveryResult.success === false`
  - `recoveryResult.state === 'ERROR'`
  - `worker.getLifecycleState() === 'ERROR'`
  - `worker.isSubscribed() === true`

#### Scenario D (Test 2.4): Successful Recovery via Documented Retry Permits Exactly One Subscription
- **Purpose:** Verify Rule C & D: after an initial unsubscription failure puts the worker in `ERROR`, when the underlying issue clears, a call to `recover()` or `stop()` successfully unsubscribes, confirms removal, transitions to `STOPPED`, and allows exactly one clean subsequent `start()`.
- **Implementation:**
  - Unsubscribe failure occurs -> worker in `ERROR`.
  - Retry succeeds -> `boss.offWork` resolves.
  - `const recoveryResult = await worker.recover(500);`
  - `recoveryResult.success === true`
  - `recoveryResult.state === 'STOPPED'`
  - `worker.isSubscribed() === false`
  - `await worker.start();` succeeds and registers exactly 1 consumer.
  - `worker.isActive() === true`
  - Clean shutdown completes.

#### Scenario E (Test 2.5): Concurrent `stop()` Calls Share Single Operation
- **Purpose:** Verify Rule E: multiple concurrent callers invoking `stop()` while shutdown is in progress share the same underlying promise and return identical results.
- **Implementation:**
  - Delayed `offWork` (75ms).
  - Parallel invocation: `Promise.all([worker.stop(500), worker.stop(500)])`.
  - Both promises resolve to identical result objects (`res1.success === true`, `res2.success === true`).
  - `boss.offWork` was invoked exactly once.

#### Scenario F (Test 2.6): Repeated Start/Stop Cycles Transition Cleanly
- **Purpose:** Verify Rule F: worker can undergo multiple sequential start/stop cycles without state corruption, memory leaks, or duplicate subscriptions.
- **Implementation:**
  - 3 consecutive cycles: `start() -> verify RUNNING -> stop() -> verify STOPPED`.
  - All 3 cycles succeed without warning or error.

#### Scenario G (Test 2.7): Timeout Followed by Eventual Background Settlement Updates Lifecycle Truthfully
- **Purpose:** Verify that when `offWork` exceeds the shutdown timeout, the worker truthfully reports timeout, stays in `ERROR` or unresolved while pending, and upon eventual background resolution updates state truthfully without data races.
- **Implementation:**
  - Controlled promise barrier holding `offWork` unresolved.
  - `await worker.stop(40)` -> reports `timedOut: true`, `offWorkSettled: false`.
  - Release barrier -> `await pendingUnsubscribePromise`.
  - Lifecycle updates truthfully to `STOPPED` and `isQueueSubscribed = false`.

#### Scenario H (Test 2.8): `resetLifecycle()` Cannot Bypass Recovery Guard
- **Purpose:** Verify Rule F: `resetLifecycle()` strictly refuses to reset a worker in `ERROR` or with an active/unconfirmed subscription, preventing accidental bypass of the recovery guard.
- **Implementation:**
  - Worker placed in `ERROR` via rejected `offWork()`.
  - Calling `worker.resetLifecycle()` immediately throws `WorkerLifecycleError`.
  - State remains strictly `ERROR` and `isQueueSubscribed = true`.

---

### 3. Additional WS02 Tests (Tests 2.9 through 2.13)

- **Test 2.9 (Active Job Preservation):** Verifies that active jobs in-flight during a timed-out shutdown are preserved with intact leases so they can be reclaimed by lease expiry recovery.
- **Test 2.10 (Graceful Drain):** Verifies that jobs finishing within deadline allow clean drain and normal `STOPPED` transition.
- **Test 2.11 (Bounded Shutdown Halts Without Indefinite Hanging):** Verifies that shutdown completes within deadline even if active jobs never finish.
- **Test 2.12 (Synchronization of `start()` Awaiting In-Progress `stop()`):** Verifies that calling `start()` while `stop()` is running waits for shutdown before evaluating start preconditions.
- **Test 2.13 (Clean State Progression):** Verifies strict state transitions: `IDLE -> STARTING -> RUNNING -> STOPPING -> STOPPED`.

---

### 4. Hardening of WS03 Periodic Recovery Tests

Tests 3.1 and 3.3 were fortified to eliminate timer jitter during heavy CPU load:
- **Test 3.1:** Active polling loop (`while (worker.getPeriodicRecoveryCycleCount() < 2)`) with 1500ms bounded deadline replaces fragile fixed timers.
- **Test 3.3:** Wraps `recoverStaleJobs()` to track completion of the second cycle via `secondCycleDone` in a `finally` block, guaranteeing that `isRecovering` has reset to `false` before asserting on mutex release.

---

### 5. Suite Execution Summary

```
▶ Phase 2A-R2.2.1 — Final Certification Suite (WS01 - WS04)
  ✔ WS01 — Active Job Tracking Leak-Free Lifecycle (7/7 passed)
  ✔ WS02 — Deterministic Shutdown & Restart Lifecycle (Scenarios A - H + 2.9-2.13) (13/13 passed)
  ✔ WS03 — Real Periodic Recovery & Mutual Exclusion (7/7 passed)
  ✔ WS04 — Filesystem Error Classification & Storage Reconciliation (10/10 passed)
✔ Phase 2A-R2.2.1 — Final Certification Suite (WS01 - WS04)
ℹ tests 37
ℹ suites 5
ℹ pass 37
ℹ fail 0
```

