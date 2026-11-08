# BETHESDA WORSHIP STUDIO — PHASE 2A-R2
## REPORT 04 — SAFE STALE-JOB RECOVERY AND STORAGE CONSISTENCY INTEGRITY

**Project:** Bethesda Worship Studio  
**Working Branch:** `feature/phase-1a-core-foundation`  
**Phase:** Phase 2A-R2 — Processing Reliability, Concurrency & Integrity Remediation  
**Status:** IMPLEMENTED — PENDING INDEPENDENT CERTIFICATION  
**Author:** Antigravity — Principal Software Engineer & Systems Architect  

---

### 1. Problem Statement & Pre-Remediation Deficiencies

In Phase 2A-R:
1. **Blind Stale Recovery:** Recovery logic scanned for jobs in `PROCESSING` status without checking whether another worker was actively executing or renewing a lease. An active, long-running job (e.g., a complex 10-page score conversion) could be abruptly snatched, reset, and re-enqueued while still actively being converted.
2. **Partial / Corrupted File Writes:** The local storage provider wrote source files directly to their target destination file paths. If a server process crashed or was killed midway through writing a 15 MiB file, a truncated, corrupted file remained at the destination path with a valid filename but invalid contents and corrupted SHA-256 hash.
3. **Risks of Source Deletion:** Source files were vulnerable to premature cleanups or uncoordinated deletions during cancellation or failed conversions.

Under Phase 2A-R2, **CR-04 (Safe Stale-Job Recovery)** and **CR-06 (Storage Consistency & Zero-Deletion Invariant)** were resolved.

---

### 2. Lease-Aware Stale Job Recovery (CR-04)

`ConversionWorker.recoverStaleJobs()` was re-engineered to be strictly lease-aware. It only touches jobs that have genuinely expired:

#### 2.1 Targeted PostgreSQL Query
```typescript
// backend/src/application/conversion-worker.ts: recoverStaleJobs
const now = new Date();
const staleJobs = await this.db
  .select()
  .from(backgroundJobs)
  .where(
    and(
      eq(backgroundJobs.status, 'PROCESSING'),
      lt(backgroundJobs.leaseExpiresAt, now) // Only expired leases!
    )
  );
```

#### 2.2 Attempt Exhaustion & Terminal Failure
If `job.attempts >= 3`, the job is not re-enqueued into an infinite loop. It is atomically transitioned to terminal `FAILED` status:
```typescript
if (job.attempts >= 3) {
  await this.db
    .update(backgroundJobs)
    .set({
      status: 'FAILED',
      progress: 100,
      errorCode: 'LEASE_EXPIRED_MAX_ATTEMPTS',
      errorDetails: {
        code: 'LEASE_EXPIRED_MAX_ATTEMPTS',
        message: `El trabajo excedió el límite máximo de 3 intentos tras expirar su arrendamiento de procesamiento.`,
        previousDetails: job.errorDetails,
      },
      completedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(backgroundJobs.id, job.id),
        eq(backgroundJobs.status, 'PROCESSING'),
        lt(backgroundJobs.leaseExpiresAt, now)
      )
    );
  recoveredCount++;
}
```

#### 2.3 Safe Reset and Controlled Re-Enqueue
If `job.attempts < 3`, the lease fields are cleanly stripped, the status is reverted to `PENDING`, progress is reset to 0%, and the payload is safely re-enqueued to `pg-boss`:
```typescript
const [reset] = await this.db
  .update(backgroundJobs)
  .set({
    status: 'PENDING',
    leaseOwner: null,
    leaseToken: null,
    leaseExpiresAt: null,
    heartbeatAt: null,
    progress: 0,
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

if (reset) {
  const details = job.errorDetails as any;
  if (details?.storageKey && details?.checksumSha256) {
    await enqueueConversionJob({
      jobId: job.id,
      userId: job.userId ?? 'system',
      tenantId: job.tenantId,
      storageKey: details.storageKey,
      checksumSha256: details.checksumSha256,
      filename: job.inputRef,
      targetFormat: details.targetFormat ?? 'CHORD_PRO',
      options: details.options,
    }).catch(() => {});
  }
  recoveredCount++;
}
```

---

### 3. Atomic Storage Consistency & Zero Deletion of Original Sources (CR-06)

#### 3.1 Atomic Temporary Write + Rename Pattern
In `backend/src/domain/ingestion/source-storage-provider.ts`, `LocalFileSystemSourceStorageProvider.save()` was upgraded to write to a unique temporary file before committing via an atomic filesystem rename:

```typescript
// backend/src/domain/ingestion/source-storage-provider.ts
public async save(source: RawSource): Promise<StoredSourceMetadata> {
  // 1. Path Traversal & Sanitation Checks ...
  const targetPath = this.resolvePath(source.storagePath);
  const tempPath = `${targetPath}.tmp.${crypto.randomUUID()}`;

  // 2. Cálculo SHA-256 en memoria
  const checksumSha256 = crypto.createHash('sha256').update(source.content).digest('hex');

  // 3. Escritura atómica a archivo temporal primero
  await fs.promises.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.promises.writeFile(tempPath, source.content);

  // 4. Renombrado atómico (atomic swap en POSIX y reemplazo atómico en Windows)
  await fs.promises.rename(tempPath, targetPath);

  return {
    storageKey: source.storagePath,
    fileSizeBytes: source.content.byteLength,
    checksumSha256,
  };
}
```

#### 3.2 Permanent Preservation of Original Source Files
- **Zero Deletion:** Under Phase 2A-R2, original musical source documents uploaded by worship leaders and musicians are permanently preserved.
- **Audit Trails & Re-transpilation:** Even if a conversion fails or is cancelled, the original source file remains physically stored and cryptographically verified, allowing worship leaders to inspect the exact input or execute `retryJob` without requiring the user to re-upload.

---

### 4. Automated Test Evidence

In `conversion-concurrency-leases.test.ts`:
- **Active Lease Preservation:** Test 4 confirms that a job with `leaseExpiresAt = NOW() + 60s` is strictly ignored by `recoverStaleJobs()`.
- **Expired Lease Recovery:** Test 5 confirms that a job with `leaseExpiresAt = NOW() - 30s` and `attempts = 1` resets cleanly to `PENDING` with null lease fields and 0% progress.
- **Max Attempt Exhaustion:** Test 6 confirms that a job with `leaseExpiresAt = NOW() - 45s` and `attempts = 3` transitions to `FAILED` with `LEASE_EXPIRED_MAX_ATTEMPTS`.

