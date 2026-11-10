# PHASE 2A-R2.2.1-R3.3.3 — REMAINING ARCHITECTURAL AND OPERATIONAL RISKS

**Project:** Bethesda Worship Studio  
**Role:** Principal Systems Architect, Reliability Engineer  
**Status Date:** 2026-11-10  

---

## 1. IN-PROCESS WIP VERIFICATION VS. DISTRIBUTED POSTGRESQL STATE

### 1.1 Technical Context
`pg-boss.getWipData()` queries the local Node.js process runtime memory (`Worker` instances registered within the singleton `boss` instance). It does not query remote database rows across other physical pods or nodes.

### 1.2 Risk Dynamics
- **Within a Single Pod:**
  `getWipData()` provides an authoritative inspection of all local worker loops, active job arrays, and subscription states. If a worker is stopped locally, it is guaranteed not to pull new jobs from PostgreSQL.
- **Across Clustered / Multi-Pod Deployments:**
  If Pod A shuts down, its local `getWipData()` only verifies workers running in Pod A. Workers in Pod B are unaware of Pod A's local shutdown, but they are coordinated via PostgreSQL advisory locks and `job.state` transitions (`FOR UPDATE SKIP LOCKED`).
- **Mitigation:**
  PostgreSQL database-level row locking and heartbeat expiration (`stale-job recovery`) act as the second line of defense. Even if an entire node experiences abrupt power loss (SIGKILL, hardware failure), the remaining nodes safely recover orphaned jobs after the heartbeat lease expires.

---

## 2. NETWORK PARTITIONS AND DATABASE DISCONNECTS DURING SHUTDOWN

### 2.1 Technical Context
If `boss.offWork()` or database queries are in flight when a network partition occurs between the Node.js application and the PostgreSQL primary:

1. **`offWork()` Network Latency or Timeout:**
   If the network times out during `offWork()`, our timeout guard (`WORKER_SHUTDOWN_TIMEOUT_MS`) trips cleanly. The worker transitions to `ERROR`, preserves the error state in telemetry, and cancels in-flight jobs via `AbortController`.
2. **Socket Severance:**
   `pg-boss` emits `'error'` events on connection drops. The Bethesda `ConversionWorker` supervisor traps these events, avoids resetting to `STOPPED`, and escalates to application monitoring.

---

## 3. PRODUCTION MONITORING & RUNBOOK RECOMMENDATIONS

To ensure operational excellence in production deployments:

1. **Prometheus / OpenTelemetry Metrics:**
   - `conversion_worker_active_jobs_gauge`: Real-time gauge of in-flight active jobs.
   - `conversion_worker_lifecycle_state`: Categorical metric (`STOPPED`, `STARTING`, `RUNNING`, `STOPPING`, `ERROR`).
   - `conversion_worker_shutdown_errors_total`: Counter incremented whenever `offWork()` times out or `validateWipData` rejects corrupted telemetry.
2. **Alerting Thresholds:**
   - **P1 Alert:** Any conversion worker remaining in `ERROR` state for > 60 seconds without supervisor recovery.
   - **P2 Alert:** Any graceful shutdown taking > 80% of `WORKER_SHUTDOWN_TIMEOUT_MS`.
3. **Operational Runbook for `MALFORMED_WIP_DATA`:**
   - If `MALFORMED_WIP_DATA` is logged, inspect `pg-boss` internal version consistency and verify no monkey-patching or conflicting worker registrations occurred.
   - Initiate graceful pod termination; allow Kubernetes or ECS orchestrator to spin up a clean replica.

