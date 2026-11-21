# 10 — REMAINING RISKS, RESIDUAL UNCERTAINTIES & LIMITATIONS
## Bethesda Worship Studio — Phase 2A-R2.2.1-R3.3.1

### 1. Scope Boundaries
1. **Remediation Limited to Worker Lifecycle & Registration Resilience:**
   This remediation solely resolves the worker lifecycle uncertainty and registration recovery defects.
   Phase 2B (AI-assisted audio transcription, Demucs/Basic Pitch/WhisperX, optical music recognition) has NOT been implemented, in accordance with the project roadmap.
2. **PostgreSQL / pg-boss In-Process Nature:**
   `pg-boss.getWipData()` reports in-progress workers registered within the active Node.js `PgBoss` instance.
   Across physically separate Node.js server processes, workers do not share an in-memory `manager.workers` array. However, distributed job leasing and fencing tokens (`fencing_token`, `lease_expires_at`, `attempts`) enforce cross-process correctness in PostgreSQL at the database row level.

### 2. Operational Considerations
1. **Database Connectivity Outages:**
   If PostgreSQL drops connection entirely while a worker is running or stopping, `boss.offWork()` or `boss.getWipData()` will reject. The worker safely transitions to or remains in `ERROR`, failing closed until network connectivity is restored and `recover()` can be invoked.
2. **Node.js Process Crash / SIGKILL:**
   In the event of an ungraceful process termination (`SIGKILL` or hardware power loss), the in-memory `PgBoss` instance terminates abruptly.
   In this scenario, active jobs held by the terminated process will naturally expire when `lease_expires_at` is reached, and the periodic `recoverStaleJobs()` background task running on surviving workers will safely reclaim them for re-processing.

