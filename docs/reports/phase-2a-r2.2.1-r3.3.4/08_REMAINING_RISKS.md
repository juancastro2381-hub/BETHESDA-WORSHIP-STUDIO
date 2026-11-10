# PHASE 2A-R2.2.1-R3.3.4 — REMAINING ARCHITECTURAL AND OPERATIONAL RISKS

**Project:** Bethesda Worship Studio  
**Role:** Principal Systems Architect, Reliability Engineer  
**Status Date:** 2026-11-10  

---

## 1. IN-PROCESS WIP VERIFICATION VS. DISTRIBUTED DATABASE STATE

### 1.1 Technical Boundary
The `pg-boss.getWipData()` method inspects in-memory `Worker` instances within the active Node.js process runtime. It verifies that local event loops and polling timers have ceased pulling jobs.

### 1.2 Multi-Node Cluster Dynamics
- In a horizontally scaled cluster (multiple Kubernetes pods or container instances), Pod A's `getWipData()` verifies only Pod A's workers.
- Pod B continues operating independently. Mutual exclusion across nodes is guaranteed by PostgreSQL row-level locks (`FOR UPDATE SKIP LOCKED`) and advisory leases established in WS03.
- If a pod experiences sudden catastrophic termination (SIGKILL / power loss), its in-flight jobs are recovered automatically by surviving pods after the 60-second lease expiration window.

---

## 2. TRANSIENT NETWORK DISCONNECTS DURING WORKER SHUTDOWN

### 2.1 Latency Spikes during `offWork()`
If communication with PostgreSQL stalls while `boss.offWork()` is attempting to cancel internal subscriptions:
- The worker's bounded shutdown timer (`WORKER_SHUTDOWN_TIMEOUT_MS = 2000ms` or configured limit) trips cleanly.
- The worker transitions to `ERROR` and aborts all local active jobs via standard `AbortController` signals.
- The worker preserves the failure state in `registrationState = UNRESOLVED_ERROR` and does not emit a false `STOPPED` event.

### 2.2 Operational Recommendation
- Maintain health check endpoints (`/health/liveness`, `/health/readiness`) that inspect `ConversionWorker.getLifecycleState()`.
- If a worker enters `ERROR` and does not recover within 60 seconds, orchestrators should cycle the pod.

---

## 3. PRODUCTION MONITORING & RUNBOOKS

1. **Key Prometheus Metrics:**
   - `conversion_worker_active_jobs_gauge`: Active in-flight conversion jobs.
   - `conversion_worker_lifecycle_state`: Categorical lifecycle status.
   - `conversion_worker_malformed_wip_total`: Counter for malformed pg-boss telemetry responses.
2. **Alerting Thresholds:**
   - **P1 Alert:** Any conversion worker remaining in `ERROR` for > 60s.
   - **P2 Alert:** Graceful shutdown duration > 80% of shutdown deadline.
3. **Runbook for `MALFORMED_WIP_DATA`:**
   - Check pg-boss package version integrity in the container image.
   - Verify that no third-party libraries or plugins are mutating global pg-boss instances.
   - Recycle the pod to re-establish a pristine in-memory supervisor state.

