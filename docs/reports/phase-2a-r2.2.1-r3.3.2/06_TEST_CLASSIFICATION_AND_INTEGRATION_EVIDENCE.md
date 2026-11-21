# 06 — TEST CLASSIFICATION AND INTEGRATION EVIDENCE
## Bethesda Worship Studio — Phase 2A-R2.2.1-R3.3.2

### 1. Honest Test Classification Rationale
In compliance with Section 8 and Section 9:
- **`[INTEGRATION]` Tests:** Run against a real PostgreSQL 16 database instance and real `pg-boss` queues. Register real background consumers, exercise real database transactions, and inspect real in-memory WIP data.
- **`[CONTRACT]` Tests:** Validate contract invariants, error boundaries, schema structural validation, state machines, and generation tokens using controlled mocks or stubs at the library boundary.
- **`[UNIT]` Tests:** Test isolated class methods and logic without external I/O.

---

### 2. Resolution of Test 2.30 Classification Discrepancy
- **Audit Finding in R3.3.1:** Previous test 2.30 was labeled `[Integration]`, but it manually mutated `workerUnrelated.registrationState = 'UNCERTAIN'` without the worker ever interacting with `pg-boss`.
- **R3.3.2 Remediation:**
  Test 2.30 was completely rewritten as a 100% genuine integration test:
  1. `workerPeer` starts against real pg-boss on `CONVERSION_QUEUE_NAME`.
  2. `workerTarget` calls `start()` with intercepted return value, causing `start()` to throw naturally and enter `UNCERTAIN` and `ERROR` via real application code path.
  3. `workerTarget.reconcileRegistration()` is executed against real pg-boss, queries real `getWipData()`, discovers `workerPeer` but no consumer matching `workerTarget`, and cleanly fails closed (`ERROR`, `UNRESOLVED_ERROR`).
  4. Real `workerPeer` is verified to remain operational throughout.

---

### 3. Detailed Trace of Key Integration Tests

#### `R331-REAL-01 [INTEGRATION]` (Test 2.3)
- Intercepts return value of `boss.work` at application boundary (returns `null`).
- Real pg-boss registers consumer internally.
- `worker.start()` throws `WorkerLifecycleError`.
- `realBoss.getWipData()` verifies residual consumer exists.
- `worker.recover()` runs without manual ID, discovers consumer via `workerInstanceId`, executes targeted `offWork`, verifies absence in real pg-boss, and settles to `STOPPED`.

#### `R331-REAL-02 [INTEGRATION]` (Test 2.4)
- Registers real peer consumer on `CONVERSION_QUEUE_NAME`.
- Target worker experiences registration uncertainty.
- Targeted recovery executes.
- Real peer consumer verified to remain active in `realBoss.getWipData()`.
- Global `offWork` proven not called.

#### `R331-REAL-03 [INTEGRATION]` (Test 2.29)
- Simulates real teardown failure during recovery.
- Fail-closed state `ERROR` preserved. Restart rejected. Subsequent recovery succeeds when fault is cleared.

#### `R332-30 [INTEGRATION]` (Test 2.30)
- Real peer worker registered on queue.
- Unrelated worker attempts recovery, finds only peer, fails closed to `ERROR`, preserves peer.

---

### 4. WIP Structural Validation Contract Suite (`R332-05` to `R332-17`)
- `2.31 R332-05 [CONTRACT]`: `[{}]` fails closed to `ERROR`, prevents false `STOPPED`.
- `2.32 R332-06 [CONTRACT]`: `[null]` fails closed to `ERROR`.
- `2.33 R332-07 [CONTRACT]`: Missing worker ID fails closed to `ERROR`.
- `2.34 R332-08 [CONTRACT]`: Missing queue name fails closed to `ERROR`.
- `2.35 R332-09 [CONTRACT]`: Invalid worker state fails closed to `ERROR`.
- `2.36 R332-10 [CONTRACT]`: Duplicate conflicting identities reject ambiguous target.
- `2.37 R332-11 [CONTRACT]`: Malformed options object fails closed to `ERROR`.
- `2.38 R332-12 [CONTRACT]`: Whitespace-only ID or workId fails closed to `ERROR`.
- `2.39 R332-15 [CONTRACT]`: Reconcile rejects ambiguous target subscription ID.
- `2.40 R332-17 [CONTRACT]`: Reconcile rejects invalid or whitespace-only subscription ID.

