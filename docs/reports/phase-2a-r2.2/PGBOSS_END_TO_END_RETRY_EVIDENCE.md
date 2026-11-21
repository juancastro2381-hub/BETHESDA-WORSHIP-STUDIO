# BETHESDA WORSHIP STUDIO — PHASE 2A-R2.2
## WS02: REAL PG-BOSS END-TO-END RETRY & DURABLE RECOVERY EVIDENCE

**Document ID:** `DOC-P2A-R2.2-RETRY-03`  
**Phase:** 2A-R2.2 — Final Closure Remediation  
**Test Suite:** `backend/src/__tests__/conversion-pgboss-retry.test.ts`  
**Date:** November 9, 2026  
**Author:** Antigravity — Principal Software Engineer & Systems Architect  

---

### 1. AUDIT FINDING CONTEXT (WS02)

During the independent review of Phase 2A-R2.1, the auditor found:
> *"The test suite validates that `enqueueConversionJob` throws `PersistenceError` when `boss.send` is mocked to fail, but there is no end-to-end integration test demonstrating that when an active worker throws a transient exception, `pg-boss` actually catches the rejection, reschedules the job based on `retryDelay`, redelivers it, and the worker re-acquires it to succeed or exhausts attempts to a durable `FAILED` state in PostgreSQL."*

---

### 2. ARCHITECTURAL DESIGN & IMPLEMENTATION

Phase 2A-R2.2 implements complete end-to-end pg-boss retry verification using **real PostgreSQL 18** and **real `pg-boss 12.38.1`** with zero mock sends:

```
[Client / Service]
       │
       ▼
1. enqueueConversionJob(payload, { retryLimit: 2, retryDelay: 1s })
       │
       ▼
2. pg-boss persists job in PostgreSQL schema (`pgboss.job`)
       │
       ▼
3. pg-boss delivers job to ConversionWorker (Attempt 1)
       │
       ▼
4. worker.acquireJob(jobId, executionToken1)
   - PostgreSQL background_jobs: status='PROCESSING', attempts=1, leaseExpiresAt=NOW()+60s
       │
       ▼
5. Controlled Transient Failure injected at Stage C (e.g. temporary network drop)
       │
       ▼
6. worker detects isTransientError(err) && attempts (1) < maxAttempts (3):
   - Resets PostgreSQL lease: status='PENDING', leaseOwner=null, leaseToken=null, progress=0
   - Re-throws error to pg-boss handler
       │
       ▼
7. pg-boss records attempt failure and reschedules job with retryDelay (1 second)
       │
   [1-second delay passes]
       │
       ▼
8. pg-boss redelivers job to ConversionWorker (Attempt 2)
       │
       ▼
9. worker.acquireJob(jobId, executionToken2)
   - PostgreSQL background_jobs: status='PROCESSING', attempts=2
       │
       ▼
10. Stage C completes successfully without error
       │
       ▼
11. worker finalizes job in PostgreSQL:
   - status='COMPLETED', progress=100, attempts=2, errorCode=null
```

#### Exhaustion Scenario (Durable FAILED):
When `attempts >= maxAttempts`, the worker detects exhaustion:
- Does NOT re-throw to pg-boss.
- Invokes `failJobFenced(jobId, token, 'RETRIES_EXHAUSTED', err.message)`.
- Transitions PostgreSQL durably to `status: 'FAILED', errorCode: 'RETRIES_EXHAUSTED', progress: 100`.

---

### 3. EXECUTED INTEGRATION SUITE

```typescript
describe('WS02 — End-to-End pg-boss Real Retry & Lifecycle Verification Suite', { concurrency: 1 }, () => {
  // Test 1: Falla transitoria en intento 1 -> pg-boss reintenta -> éxito en intento 2
  it('1. should acquire job from real pg-boss, handle transient failure, retry automatically, and succeed on attempt 2', async () => {
    const testContent = Buffer.from('{title: E2E Retry Test Song}\n[D]Alabanza y [A]gloria\n');
    const storageResult = await storage.save('retry_e2e_test.cho', testContent);

    const [job] = await db.insert(backgroundJobs).values({
      jobType: 'CONVERSION',
      status: 'PENDING',
      progress: 0,
      userId: testUserId,
      inputRef: 'retry_e2e_test.cho',
      attempts: 0,
      maxAttempts: 3,
      errorDetails: {
        storageKey: storageResult.storageKey,
        checksumSha256: storageResult.checksumSha256,
        targetFormat: 'LYRICS_ONLY',
      },
    }).returning();
    createdJobIds.push(job.id);

    let stageHits = 0;

    const worker = new ConversionWorker(db, storage, undefined, 'worker-retry-test-1', {
      onStageReached: async (stage, reachedJobId) => {
        if (stage === 'STAGE_C' && reachedJobId === job.id) {
          stageHits++;
          if (stageHits === 1) {
            throw new TransientWorkerError('Simulación controlada: error transitorio de red en intento 1');
          }
        }
      },
    });

    await worker.start();

    const payload: ConversionJobPayload = {
      jobId: job.id,
      userId: testUserId,
      tenantId: 'bethesda-default',
      storageKey: storageResult.storageKey,
      checksumSha256: storageResult.checksumSha256,
      filename: 'retry_e2e_test.cho',
      targetFormat: 'LYRICS_ONLY',
    };

    await enqueueConversionJob(payload, {
      retryLimit: 2,
      retryDelay: 1,
      expireInSeconds: 30,
    });

    const startTime = Date.now();
    let finalJob: any = null;

    while (Date.now() - startTime < 12_000) {
      const [current] = await db.select().from(backgroundJobs).where(eq(backgroundJobs.id, job.id));
      if (current && (current.status === 'COMPLETED' || current.status === 'FAILED')) {
        finalJob = current;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    await worker.stop();

    assert.ok(finalJob, 'El trabajo debió alcanzar un estado terminal dentro del tiempo esperado');
    assert.strictEqual(finalJob.status, 'COMPLETED');
    assert.strictEqual(finalJob.progress, 100);
    assert.strictEqual(finalJob.attempts, 2);
    assert.strictEqual(stageHits, 2);
    assert.strictEqual(finalJob.errorCode, null);
  });

  // Test 2: Falla transitoria repetida -> reintentos agotados -> estado duradero FAILED con RETRIES_EXHAUSTED
  it('2. should exhaust retries in real pg-boss and transition to durable FAILED state with RETRIES_EXHAUSTED', async () => {
    const testContent = Buffer.from('{title: E2E Exhaustion Test Song}\n[G]Santo [C]Dios\n');
    const storageResult = await storage.save('exhaust_e2e_test.cho', testContent);

    const [job] = await db.insert(backgroundJobs).values({
      jobType: 'CONVERSION',
      status: 'PENDING',
      progress: 0,
      userId: testUserId,
      inputRef: 'exhaust_e2e_test.cho',
      attempts: 0,
      maxAttempts: 2,
      errorDetails: {
        storageKey: storageResult.storageKey,
        checksumSha256: storageResult.checksumSha256,
        targetFormat: 'LYRICS_ONLY',
      },
    }).returning();
    createdJobIds.push(job.id);

    let stageHits = 0;

    const worker = new ConversionWorker(db, storage, undefined, 'worker-retry-exhaust-2', {
      onStageReached: async (stage, reachedJobId) => {
        if (stage === 'STAGE_C' && reachedJobId === job.id) {
          stageHits++;
          throw new TransientWorkerError(`Simulación controlada: error transitorio persistente en intento ${stageHits}`);
        }
      },
    });

    await worker.start();

    const payload: ConversionJobPayload = {
      jobId: job.id,
      userId: testUserId,
      tenantId: 'bethesda-default',
      storageKey: storageResult.storageKey,
      checksumSha256: storageResult.checksumSha256,
      filename: 'exhaust_e2e_test.cho',
      targetFormat: 'LYRICS_ONLY',
    };

    await enqueueConversionJob(payload, {
      retryLimit: 2,
      retryDelay: 1,
      expireInSeconds: 30,
    });

    const startTime = Date.now();
    let finalJob: any = null;

    while (Date.now() - startTime < 12_000) {
      const [current] = await db.select().from(backgroundJobs).where(eq(backgroundJobs.id, job.id));
      if (current && (current.status === 'COMPLETED' || current.status === 'FAILED')) {
        finalJob = current;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }

    await worker.stop();

    assert.ok(finalJob, 'El trabajo debió alcanzar un estado terminal dentro del tiempo esperado');
    assert.strictEqual(finalJob.status, 'FAILED');
    assert.strictEqual(finalJob.errorCode, 'RETRIES_EXHAUSTED');
    assert.strictEqual(finalJob.attempts, 2);
    assert.strictEqual(finalJob.progress, 100);
    assert.strictEqual(stageHits, 2);
  });
});
```

---

### 4. VERIFICATION LOG

```
▶ WS02 — End-to-End pg-boss Real Retry & Lifecycle Verification Suite
  ✔ 1. should acquire job from real pg-boss, handle transient failure, retry automatically, and succeed on attempt 2 (4265.0042ms)
  ✔ 2. should exhaust retries in real pg-boss and transition to durable FAILED state with RETRIES_EXHAUSTED (4209.5249ms)
✔ WS02 — End-to-End pg-boss Real Retry & Lifecycle Verification Suite (8796.2428ms)
ℹ tests 2 | suites 1 | pass 2 | fail 0 | cancelled 0 | duration_ms 10687.5073
```

**Audit Verdict:** WS02 is completely resolved. Real PostgreSQL, real pg-boss, automatic redelivery on retryDelay, durable attempt counting, and clean retry exhaustion.

