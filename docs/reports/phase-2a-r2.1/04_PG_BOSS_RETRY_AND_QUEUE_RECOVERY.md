# WORSHIP STUDIO — PHASE 2A-R2.1
## REPORT 04: PG-BOSS ERROR PROPAGATION, RETRY RELIABILITY & SAFE QUEUE RECOVERY

**Project:** Bethesda Worship Studio  
**Workstreams Covered:** WS03 (pg-boss Error Propagation & Retry) & WS04 (Safe Stale Job Recovery)  
**Author:** Antigravity — Principal Software Engineer & Systems Architect  
**Status:** COMPLETE & VERIFIED

---

### 1. Root Cause Analysis of Pre-Remediation Queue Defects

#### 1.1 Premature Acknowledgment of Transient Errors to pg-boss (WS03)
In the previous implementation of [`ConversionWorker.processJob`](file:///backend/src/application/conversion-worker.ts), all exceptions were caught and converted into a failure response object `{ success: false, ... }`:
```ts
// PRE-REMEDIATION CATCH BLOCK:
} catch (err: any) {
  await this.failJobFenced(jobId, executionToken, 'WORKER_PROCESSING_EXCEPTION', err.message);
  return { success: false, ... };
}
```
Because the promise returned successfully to `boss.work()`, pg-boss acknowledged the job as complete at the queue layer. This prevented pg-boss from ever executing its built-in exponential backoff retries (`retryLimit: 2`) when transient errors occurred (e.g. database network blips, connection pool saturation, transient I/O delays).

#### 1.2 Stale Job Recovery "Limbo" Vulnerability (WS04)
In [`ConversionWorker.recoverStaleJobs`](file:///backend/src/application/conversion-worker.ts#L365-L385), expired jobs were immediately reset to `status = 'PENDING'` with `leaseExpiresAt = null`. Following the reset, the worker invoked `enqueueConversionJob(...)` with a swallowed error handler:
```ts
// PRE-REMEDIATION RECOVERY:
const [reset] = await this.db.update(backgroundJobs).set({ status: 'PENDING', leaseExpiresAt: null, ... });
if (reset) {
  await enqueueConversionJob(...).catch(() => {}); // If this failed, job stayed in PENDING forever!
}
```
If `enqueueConversionJob()` failed (e.g., pg-boss broker temporarily unavailable), the job was left in `status = 'PENDING'` with `leaseExpiresAt = null`. Subsequent passes of `recoverStaleJobs()` query only `status = 'PROCESSING' AND leaseExpiresAt < NOW()`. Thus, the job was permanently orphaned in limbo.

---

### 2. Engineering Architecture & Remediation

#### 2.1 Error Classification & Selective Propagation (WS03)

In [`ConversionWorker`](file:///backend/src/application/conversion-worker.ts#L33-L65):
```typescript
export class TransientWorkerError extends Error {
  public constructor(message: string, public readonly originalError?: unknown) {
    super(message);
    this.name = 'TransientWorkerError';
  }
}

export function isTransientError(err: any): boolean {
  if (err instanceof TransientWorkerError) return true;
  if (!err) return false;
  const msg = String(err.message || '').toLowerCase();
  const code = String(err.code || '').toLowerCase();
  return (
    code === 'econnreset' ||
    code === 'econnrefused' ||
    code === 'etimedout' ||
    code === '57p01' || // PostgreSQL admin shutdown
    code === '08006' || // PostgreSQL connection failure
    code === '08001' || // PostgreSQL unable to establish connection
    code === '40001' || // PostgreSQL serialization failure / deadlock
    msg.includes('connection terminated') ||
    msg.includes('timeout') ||
    msg.includes('network') ||
    msg.includes('transient') ||
    msg.includes('deadlock')
  );
}
```

In `processJob()`:
1. **Permanent Errors (Invalid format, Parse failure, Zero-fabrication, Deferred phase, Checksum mismatch):**
   - Marks job `FAILED` in PostgreSQL.
   - Does NOT throw to pg-boss, avoiding wasted retry cycles.
2. **Transient Errors (Connection lost, timeout, deadlock):**
   - Inspects `attempts` vs `maxAttempts` from the authoritative database.
   - If `attempts < maxAttempts`: Resets lease to `PENDING` and **re-throws the error**. This causes `boss.work()` to reject, allowing pg-boss to schedule the retry with backoff.
   - If `attempts >= maxAttempts`: Marks the job `FAILED` with `errorCode = 'RETRIES_EXHAUSTED'`.

#### 2.2 Atomic Recovery Claim with Zero-Limbo Guarantee (WS04)

In [`ConversionWorker.recoverStaleJobs`](file:///backend/src/application/conversion-worker.ts#L375-L490):
1. **Atomic Claim Token:** Instead of directly resetting to `PENDING`, the worker claims the expired job with a temporary recovery lease:
   ```typescript
   const recoveryToken = crypto.randomUUID();
   const recoveryLeaseExpires = new Date(Date.now() + 30_000);

   const [claimed] = await this.db
     .update(backgroundJobs)
     .set({
       leaseOwner: `recovery_${this.workerId}`,
       leaseToken: recoveryToken,
       leaseExpiresAt: recoveryLeaseExpires,
       updatedAt: new Date(),
     })
     .where(
       and(
         eq(backgroundJobs.id, job.id),
         eq(backgroundJobs.status, 'PROCESSING'),
         lt(backgroundJobs.leaseExpiresAt, now)
       )
     )
     .returning();
   ```
2. **Post-Enqueue Transition:** Only after `enqueueConversionJob()` resolves successfully does the worker transition `status = 'PENDING'` and clear `leaseExpiresAt`.
3. **Fail-Safe On Enqueue Failure:** If `enqueueConversionJob()` throws, the worker immediately sets `leaseExpiresAt = new Date(Date.now() - 10_000)` (expired in the past). This guarantees that the very next recovery cycle will re-attempt recovery without manual intervention.
4. **Max Attempts Guard:** If `job.attempts >= job.maxAttempts`, the job is marked `FAILED` with `LEASE_EXPIRED_MAX_ATTEMPTS`.

---

### 3. Verification & Evidence

#### 3.1 Suite [`conversion-audit-remediation.test.ts`](file:///backend/src/__tests__/conversion-audit-remediation.test.ts)
- Test 3: Verified `isTransientError()` correctly classifies connection drops and timeouts as transient, while classifying corrupt files and syntax errors as permanent.
- Test 4: Inserted expired processing job; verified `recoverStaleJobs()` claimed it, enqueued, and reset status to `PENDING` with all lease fields cleared.

#### 3.2 Concurrency & Queue Suites
- [`conversion-concurrency-leases.test.ts`](file:///backend/src/__tests__/conversion-concurrency-leases.test.ts): 6/6 tests passing (heartbeats, fencing tokens, stale recovery, retry limits).
- [`conversion-queue-lifecycle.test.ts`](file:///backend/src/__tests__/conversion-queue-lifecycle.test.ts): 5/5 tests passing (idempotent start, worker shutdown, error handling).

