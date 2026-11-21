# WORSHIP STUDIO — PHASE 2A-R2.1
## REPORT 05: STORAGE & DATABASE ATOMIC RECONCILIATION

**Project:** Bethesda Worship Studio  
**Workstream Covered:** WS06 (Storage & Database Reconciliation)  
**Author:** Antigravity — Principal Software Engineer & Systems Architect  
**Status:** COMPLETE & VERIFIED

---

### 1. Root Cause Analysis of Pre-Remediation Storage Defects

1. **Non-Atomic Database Inserts during Job Creation:**
   In [`ConversionJobService.createJob`](file:///backend/src/application/conversion-job-service.ts), the creation of records in `background_jobs` and `song_sources` previously executed as separate, uncoordinated statements without an enclosing SQL transaction:
   - Step 3: `await this.jobRepo.createJob(...)`
   - Step 4: `await this.db.insert(songSources).values(...)`
   If Step 4 failed (e.g. database constraint violation, connection timeout), a job existed in `background_jobs` with no corresponding audit record in `song_sources`.

2. **Lack of Storage Provider File Listing & Reconciliation:**
   [`LocalFileSystemSourceStorageProvider`](file:///backend/src/domain/ingestion/source-storage-provider.ts) did not expose a `listKeys()` method, making it impossible to audit physical storage directories for orphaned files (files written to disk but never committed to DB) or missing files (database records pointing to non-existent disk paths).

---

### 2. Engineering Architecture & Remediation

#### 2.1 Single Atomic DB Transaction in `createJob()`

In [`ConversionJobService.createJob`](file:///backend/src/application/conversion-job-service.ts#L270-L320), both insertions are wrapped inside an ACID transaction (`this.db.transaction`):

```typescript
// 3. Registrar atómicamente el trabajo en background_jobs y song_sources en una transacción DB única (CR-06)
const job = await this.db.transaction(async (tx) => {
  const [newJob] = await tx
    .insert(backgroundJobs)
    .values({
      jobType: 'CONVERSION',
      status: 'PENDING',
      progress: 0,
      userId: user.id,
      tenantId: 'bethesda-default',
      inputRef: input.filename,
      outputRef: null,
      errorDetails: {
        storageKey: storageResult.storageKey,
        checksumSha256: storageResult.checksumSha256,
        fileSizeBytes: storageResult.fileSizeBytes,
        targetFormat: input.targetFormat,
        options: input.options ?? {},
      },
      startedAt: new Date(),
    })
    .returning();

  if (!newJob) {
    throw new PersistenceError('Fallo al registrar la tarea de conversión en background_jobs.');
  }

  await tx.insert(songSources).values({
    userId: user.id,
    sourceType: detectedCategory,
    filename: input.filename,
    storagePath: storageResult.storageKey,
    mimeType: this.resolveMimeType(input.filename, input.targetFormat),
    fileSizeBytes: storageResult.fileSizeBytes,
    checksumSha256: storageResult.checksumSha256,
    jobId: newJob.id,
    rawContent: input.rawText ?? null,
    importerName: 'ConversionJobService',
    importerVersion: '2.0.0',
  });

  return newJob;
});
```

If either insert fails, the transaction rolls back cleanly, leaving zero orphaned rows.

#### 2.2 Storage Provider Extension: `listKeys()`

In [`ISourceStorageProvider`](file:///backend/src/domain/ingestion/source-storage-provider.ts#L20-L28) and [`LocalFileSystemSourceStorageProvider`](file:///backend/src/domain/ingestion/source-storage-provider.ts#L130-L142):
```typescript
public async listKeys(): Promise<string[]> {
  try {
    if (!fs.existsSync(this.baseDir)) return [];
    const entries = await fs.promises.readdir(this.baseDir, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && !entry.name.includes('.tmp.'))
      .map((entry) => entry.name);
  } catch {
    return [];
  }
}
```
Excludes temporary write buffers (`.tmp.`) and returns all durable storage keys.

#### 2.3 Safe Storage Reconciliation Method: `reconcileStorage()`

In [`ConversionJobService.reconcileStorage`](file:///backend/src/application/conversion-job-service.ts#L615-L660):
1. Reads all physical keys on disk via `this.storage.listKeys()`.
2. Queries all `storagePath` entries in `song_sources`.
3. Queries all `storageKey` entries in active/recoverable/terminal `background_jobs.errorDetails`.
4. Computes:
   - `orphanedFiles`: Physical files on disk with zero references in database.
   - `missingFiles`: Database records whose physical files cannot be found on disk.
   - `healthyFilesCount`: Consistent files existing in both disk and database.
5. **Safety Guarantee:** Does NOT destructively delete any files, preserving active and recoverable job sources indefinitely.

---

### 3. Verification & Evidence

In [`conversion-audit-remediation.test.ts`](file:///backend/src/__tests__/conversion-audit-remediation.test.ts#L180-L235):
- Saved genuine ChordPro file into test storage provider.
- Injected an orphaned file directly onto disk.
- Executed `service.reconcileStorage()`.
- Asserted:
  - `report.orphanedFiles` accurately reported `archivo_huerfano_en_disco.txt`.
  - `report.healthyFilesCount >= 1` accurately counted the active record.
  - Test passed cleanly.

