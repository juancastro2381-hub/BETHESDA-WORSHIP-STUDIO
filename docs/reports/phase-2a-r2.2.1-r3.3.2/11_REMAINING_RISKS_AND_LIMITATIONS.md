# 11 — REMAINING RISKS, RESIDUAL UNCERTAINTIES & LIMITATIONS
## Bethesda Worship Studio — Phase 2A-R2.2.1-R3.3.2

### 1. In-Process pg-boss State vs Cross-Process Workers
- `boss.getWipData()` audits the in-memory `manager.workers` Map within a single Node.js runtime.
- Across physically distinct server instances or containers, each Node.js process manages its own in-memory `manager.workers` collection.
- However, cross-process mutual exclusion and distributed safety are enforced by PostgreSQL at the database row level:
  - `lease_expires_at`: Enforces timeout boundaries for unacknowledged jobs.
  - `fencing_token`: Prevents stale or zombie workers from completing or updating jobs.
  - `attempts`: Guarantees dead-lettering after maximum retry threshold.

### 2. Network and Database Hard Drops
- In the event of a sudden network partition or database host reboot, `boss.getWipData()` or `boss.offWork()` may reject due to broken database sockets.
- In this situation, `ConversionWorker` transitions safely to fail-closed state (`ERROR` / `UNRESOLVED_ERROR`) and preserves `isQueueSubscribed = true` to prevent false claims of clean shutdown.
- Once database connectivity is restored, invoking `recover()` reconciles in-progress subscriptions.

### 3. Graceful Drain Deadlines
- When stopping a worker under active load, if jobs exceed the configured graceful shutdown deadline (e.g. 150ms–5000ms), the worker halts polling and allows uncompleted job leases to naturally expire in PostgreSQL.
- Surviving workers or a subsequent worker start will reclaim these expired jobs via `recoverStaleJobs()`.

### 4. Phase 2B Prerequisites
- Phase 2B requires dedicated ML compute infrastructure and model weight management which is intentionally out of scope for Phase 2A.

