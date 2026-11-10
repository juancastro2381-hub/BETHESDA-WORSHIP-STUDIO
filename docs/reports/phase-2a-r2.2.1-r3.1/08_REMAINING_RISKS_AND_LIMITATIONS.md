# BETHESDA WORSHIP STUDIO — PHASE 2A-R2.2.1-R3.1
## REPORT 08: REMAINING RISKS, ARCHITECTURAL LIMITATIONS & DEFERRED ITEMS

**Author:** Antigravity — Principal Backend Engineer & Distributed Systems Architect  
**Date:** 2026-11-09  

---

### 1. In-Scope Architectural Limitations

1. **In-Process vs Multi-Process Worker Mutual Exclusion:**
   - The current `ConversionWorker` implements in-process mutual exclusion (`this.isRecovering`) for its internal periodic stale-job recovery cycle, while multi-worker database-level coordination is handled by PostgreSQL transactional row locks (`FOR UPDATE SKIP LOCKED` and lease timestamps).
   - In a multi-replica horizontal deployment (e.g. Kubernetes with multiple worker pods), stale-job recovery remains safe due to PostgreSQL lease fencing, but distributed leader election (e.g., via PostgreSQL advisory locks `pg_try_advisory_lock`) could further optimize database query load by electing a single active recovery coordinator.
2. **Process Termination During Graceful Drain:**
   - If an operating system sends an immediate `SIGKILL` (kill -9) instead of `SIGTERM`, graceful drain cannot run.
   - *Mitigation:* The existing lease fencing architecture (`leaseExpiresAt`) automatically recovers any abandoned processing jobs on the next worker cycle or subsequent worker startup without human intervention.
3. **pg-boss Schema Migration Boundaries:**
   - `pg-boss` handles its own schema creation and migration in the `pgboss` schema. If database permissions restrict DDL operations, `startConversionQueue()` will reject during initialization. This is fail-closed and intentional.

---

### 2. Strictly Deferred Phase 2B Scope Items

The following features were intentionally excluded from Phase 2A-R2.2.1-R3.1 in strict compliance with the Product Owner scope boundaries:

1. **Optical Music Recognition (OMR):** Audiveris, sheet music image parsing, PDF raster scanning.
2. **Audio AI Stem Separation & Transcription:** Demucs, WhisperX, Basic Pitch, audio pitch detection.
3. **Cloud Object Storage Providers:** Cloudflare R2, AWS S3, Azure Blob Storage (Local FileSystem Provider preserved).
4. **Alternative Queue Engines:** Redis, BullMQ, RabbitMQ (PostgreSQL `pg-boss` preserved).
5. **Real-time Push Notifications:** WebSockets, Server-Sent Events for job progress (HTTP polling preserved).

---

### 3. Conclusion & Audit Readiness

No blocker defects or unhandled failure paths remain within the Phase 2A-R2.2.1-R3.1 scope. The codebase is prepared for independent verification.

