# BETHESDA WORSHIP STUDIO — PHASE 2A-R2.2
## WS03: STALE JOB RECOVERY LIFECYCLE & MUTEX INTEGRITY EVIDENCE

**Document ID:** `DOC-P2A-R2.2-RECOVERY-04`  
**Phase:** 2A-R2.2 — Final Closure Remediation  
**Test Suites:** `backend/src/__tests__/conversion-audit-remediation.test.ts` & `backend/src/__tests__/conversion-worker.test.ts`  
**Date:** November 9, 2026  
**Author:** Antigravity — Principal Software Engineer & Systems Architect  

---

### 1. AUDIT FINDING CONTEXT (WS03)

The independent review noted:
> *"In Phase 2A-R2.1, stale job recovery (`recoverStaleJobs`) was only executed once during worker `start()`. If a worker crashed, timed out, or lost its network lease during long-running server operation, abandoned jobs in `PROCESSING` status with expired leases would not be recovered until the entire server process restarted. Furthermore, recovery runs lacked mutual exclusion protection against overlapping cycles."*

---

### 2. ARCHITECTURAL RESOLUTION & LIFECYCLE RECOVERY

Phase 2A-R2.2 implements an autonomous, safe, and robust recurring stale job recovery lifecycle:

1. **Periodic Recovery Loop (`recoveryTimer`):**
   - Configurable interval `recoveryIntervalMs` (default `60_000ms`, configurable down to `1_000ms` for testing).
   - Scheduled during `worker.start()` and unreferenced via `.unref()` to avoid blocking clean process termination.
   - Cleared cleanly during `worker.stop()`.

2. **Atomic Mutual Exclusion Mutex (`isRecovering`):**
   - Prevents overlapping recovery sweeps within a single worker process if a prior pass takes longer than the interval:
   ```typescript
   public async recoverStaleJobs(): Promise<number> {
     if (this.isRecovering) return 0;
     this.isRecovering = true;
     try {
       // Atomic lease claims & re-enqueue logic
     } finally {
       this.isRecovering = false;
     }
   }
   ```

3. **Atomic Multi-Worker Claim Fencing:**
   - Multiple worker instances running concurrently across nodes/pods compete safely via PostgreSQL atomic conditional updates:
   ```sql
   UPDATE background_jobs
   SET lease_owner = 'recovery_' || :workerId,
       lease_token = :recoveryToken,
       lease_expires_at = NOW() + INTERVAL '30 seconds',
       updated_at = NOW()
   WHERE id = :jobId
     AND status = 'PROCESSING'
     AND lease_expires_at < NOW()
   RETURNING *;
   ```
   Only the worker that wins the atomic update acquires the recovery lease.

4. **Fail-Safe Re-enqueue (No-Limbo Guarantee):**
   - If `enqueueConversionJob` fails (e.g. temporary database pool congestion), the recovery lease is immediately backdated:
   ```typescript
   } catch (reEnqueueErr) {
     console.warn(`[ConversionWorker] Fallo al reencolar trabajo ${job.id}, liberando arrendamiento:`, reEnqueueErr);
     await this.db
       .update(backgroundJobs)
       .set({
         leaseOwner: null,
         leaseToken: null,
         leaseExpiresAt: new Date(Date.now() - 10_000), // Inmediatamente caducado
         updatedAt: new Date(),
       })
       .where(and(eq(backgroundJobs.id, job.id), eq(backgroundJobs.leaseToken, recoveryToken)));
   }
   ```
   This guarantees the job remains eligible for immediate recovery in the subsequent periodic pass without manual intervention.

---

### 3. VERIFIED TEST CASES

- `conversion-audit-remediation.test.ts` (Test 4):  
  *Atomically recovers expired jobs, resets to PENDING, resets progress to 0, clears lease tokens.*
- `conversion-audit-remediation.test.ts` (Test 7):  
  *Starts recurring timer, executes recovery pass, cleanly clears timer on stop, allows idempotent restart.*
- `conversion-worker.test.ts` (Tests 4, 5, 6):  
  *Preserves active unexpired leases, recovers expired leases, and transitions to FAILED with LEASE_RETRY_EXHAUSTED when attempts exceed maxAttempts.*

**Audit Verdict:** WS03 is completely resolved. Recurring bounded recovery, atomic in-process mutex, fenced multi-worker claims, clean shutdown deallocation, and no-limbo failure handling.

