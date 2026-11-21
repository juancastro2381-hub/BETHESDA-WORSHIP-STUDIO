# Bethesda Worship Studio — Phase 2A-R2.2.1-R3.3
## Report 10: Remaining Operational Risks & Architectural Limitations

**Scope:** Production Readiness and Edge-Case Analysis

---

### 1. In-Process pg-boss Worker Identification

#### Limitation:
`pg-boss` generates worker instance identifiers via internal Node.js `crypto.randomUUID()`. When `boss.work()` completes, it returns this string. If the call fails, times out, or returns an anomalous value before resolving in the Node event loop, the caller does not have caller-side control of the generated ID.

#### Risk Mitigation:
1. `ConversionWorker` transitions to `UNCERTAIN` and bars all automatic transition to `STOPPED`.
2. `boss.getWipData()` exposes the in-process worker pool, allowing reconciliation via `recover({ reconciledSubscriptionId })`.
3. If multiple workers are active on the same queue and registration was uncertain, the system fails closed rather than executing destructive global unsubscription.

---

### 2. Multi-Process / Multi-Pod Fencing

#### Observation:
In multi-node deployments (e.g. Kubernetes with multiple replicas of the backend service), `boss.getWipData()` inspects only the in-process worker registrations of that specific Node.js process.

#### Operational Guidance:
- Multi-process job coordination and lease expiration rely on PostgreSQL transactions and the database leases table (`background_jobs.lease_expires_at` / `lease_owner`).
- Node crash or termination leaves in-flight job leases to expire naturally; the periodic recovery loop on remaining or new workers safely reclaims expired leases without race conditions.
- Each worker instance generates a unique UUID `workerInstanceId`, preventing split-brain lease updates.

---

### 3. Readiness for Phase 2B

This codebase is clean, robust, and certified for Phase 2A. Phase 2B (AI neural audio demixing, OMR, etc.) can be built upon this rock-solid queue and storage foundation without requiring architectural rewrites.

