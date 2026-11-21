# 05 — LIFECYCLE AND CONCURRENCY INVARIANTS
## Bethesda Worship Studio — Phase 2A-R2.2.1-R3.3.2

### 1. State Machine Definitions

#### Lifecycle States (`WorkerLifecycleState`)
- `IDLE`: Worker instantiated, not started.
- `STARTING`: `performStart()` in progress.
- `RUNNING`: Successfully registered with pg-boss, background jobs being fetched and processed.
- `STOPPING`: `performStop()` in progress (active jobs draining, targeted `offWork` settling, WIP absence being verified).
- `STOPPED`: Cleanly stopped and confirmed absent in pg-boss.
- `ERROR`: Anomaly encountered during start, stop, recovery, or WIP verification. Fail-closed.

#### Registration States (`WorkerRegistrationState`)
- `NONE`: No active registration in pg-boss.
- `REGISTERING`: Registration call in flight.
- `REGISTERED`: Confirmed registered with valid subscription ID.
- `UNCERTAIN`: `boss.work()` threw or returned invalid ID; residual consumer may exist in pg-boss.
- `UNREGISTERING`: Targeted `offWork()` in flight.
- `REMOVAL_CONFIRMED`: Worker confirmed absent in pg-boss via `getWipData()`.
- `UNRESOLVED_ERROR`: Teardown or verification failed; consumer could not be confirmed absent.

---

### 2. Mandatory Concurrency Invariants

| Invariant | Description | Enforcement Mechanism |
| :--- | :--- | :--- |
| **INV-01: No Duplicate Starts** | Concurrent calls to `start()` cannot create duplicate subscriptions in pg-boss. | `this.startingPromise` deduplicates concurrent callers; subsequent calls share the initial promise. |
| **INV-02: Synchronized Stop** | Concurrent calls to `stop()` share the same shutdown operation. | `this.stoppingPromise` deduplicates concurrent callers; subsequent calls await the same promise. |
| **INV-03: Generation Protection** | A slow or late asynchronous completion cannot mutate a newer lifecycle state. | `this.lifecycleGeneration` increments on every lifecycle transition; late callbacks check `taskGen === this.lifecycleGeneration` before writing state. |
| **INV-04: Start Blocks on Unresolved** | `start()` cannot be called while previous shutdown or registration is unresolved. | `start()` checks `this.hasUnresolvedRegistration()` and `lifecycleState === 'ERROR'`; throws `WorkerLifecycleError`. |
| **INV-05: Recover Enforces Verification** | `recover()` cannot bypass unresolved subscription identity without authoritative reconciliation. | `recover()` routes through `reconcileRegistration()`, validates `getWipData()`, and confirms absence before settling to `STOPPED`. |
| **INV-06: resetLifecycle Guard** | `resetLifecycle()` cannot clear an unresolved error. | `resetLifecycle()` throws `WorkerLifecycleError` if `hasUnresolvedRegistration()` or `lifecycleState === 'ERROR'`. |
| **INV-07: Verified Teardown** | A resolved `offWork()` alone is insufficient to transition to `STOPPED`. | Authoritative inspection of `boss.getWipData()` must confirm that the worker is not active before setting `STOPPED`. |
| **INV-08: Fail-Closed on Malformed WIP** | Corrupted or malformed WIP responses cannot produce `STOPPED`. | `validateWipData()` rejects malformed records and transitions to `UNRESOLVED_ERROR` and `ERROR`. |

