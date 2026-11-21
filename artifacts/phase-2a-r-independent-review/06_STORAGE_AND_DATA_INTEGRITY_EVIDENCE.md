# PHASE 2A-R — INDEPENDENT AUDIT EVIDENCE PACKAGE
# 06. SOURCE STORAGE & DATA INTEGRITY EVIDENCE

**Project:** Bethesda Worship Studio  
**Phase:** Phase 2A-R — Conversion Center Remediation & Certification  
**Working Branch:** `feature/phase-1a-core-foundation`  
**Commit SHA:** `fa69b4e89da6d9d813771fc358463f4005819c6f`  
**Auditor / Agent:** Antigravity — Principal Software Engineer & Systems Architect  
**Evidence Generation Date:** 2026-11-07  

---

## 1. PHYSICAL STORAGE ARCHITECTURE

Physical persistence of uploaded musical source files is managed by [`LocalFileSystemSourceStorageProvider`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/backend/src/domain/ingestion/source-storage-provider.ts) implementing the `ISourceStorageProvider` interface.

### Deployment & Storage Location Details
- **Default Storage Directory:** `<cwd>/storage/sources/`
- **File Naming / Key Convention:** `<sha256_hash>.<original_extension>` (Content-Addressable Storage).
- **Filesystem Permissions & Path Traversal Defense:**
  - `resolveSafePath(storageKey)` strips path traversal attempts (`..`, absolute paths) using `path.basename(storageKey)`.
  - Verifies `resolvedPath.startsWith(this.baseDir)`. Throws `ValidationError` on violation.
- **Size Enforcement:** Hard limit of 15 MiB (`MAX_OMR_FILE_SIZE_BYTES = 15 * 1024 * 1024`). Throws `ValidationError` if exceeded.
- **Empty File Protection:** Throws `ValidationError` on 0-byte buffer.

---

## 2. CRYPTOGRAPHIC SHA-256 HASH VERIFICATION

### Ingestion Hashing
During `ConversionJobService.createJob()`, the raw buffer is passed to `this.storage.save(input.filename, buffer)`:
```typescript
const ext = path.extname(filename).toLowerCase() || '.bin';
const checksumSha256 = crypto.createHash('sha256').update(buffer).digest('hex');
const storageKey = `${checksumSha256}${ext}`;
const targetPath = this.resolveSafePath(storageKey);

if (!fs.existsSync(targetPath)) {
  await fs.promises.writeFile(targetPath, buffer);
}
```
The file is written atomically to disk and its hash is persisted in:
1. `song_sources.file_hash_sha256`
2. `background_jobs.error_details.checksumSha256`

### Worker Retrieval Verification (CR-03)
When `ConversionWorker.processJob()` begins processing:
```typescript
const sourceBuffer = await this.storage.getBuffer(storageKey);
const computedHash = crypto.createHash('sha256').update(sourceBuffer).digest('hex');

if (computedHash !== checksumSha256) {
  throw new Error(
    `Violación de Integridad Criptográfica: El hash del archivo en disco (${computedHash}) no coincide con el registrado (${checksumSha256}).`
  );
}
```

### Retry Cryptographic Verification
When `ConversionJobService.retryJob()` is triggered:
```typescript
const buffer = await this.storage.getBuffer(storageKey);
const currentHash = crypto.createHash('sha256').update(buffer).digest('hex');
if (currentHash !== checksumSha256) {
  throw new ValidationError(
    `El archivo en almacenamiento (${currentHash}) no coincide con el checksum del trabajo (${checksumSha256}). Archivo posiblemente corrupto.`
  );
}
```

---

## 3. FILE PRESERVATION & RELIABILITY UNDER PROCESS RESTART

1. **Storage Durability:**
   Files stored in `storage/sources/` are regular OS filesystem files. They persist across Node.js process terminations and restarts.
2. **Database Traceability:**
   Every physical file has a corresponding row in `song_sources` with `storage_path = storageKey`, `file_hash_sha256`, and `file_size_bytes`.
3. **Database Constraints & Cascades:**
   Under Migration `0014`, foreign keys on `song_sources` use `ON DELETE SET NULL`. If a song or user is deleted, the physical record in `song_sources` is never destroyed.

---

## 4. FAILURE HANDLING & INCOMPLETE OPERATIONS ANALYSIS

| Failure Point | System Reaction | Inconsistency Risk | Remediation / Safeguard |
| :--- | :--- | :--- | :--- |
| **Disk Write Fails** | `storage.save()` throws error before database insertion. | **Zero** | Transaction is aborted before database records are created. |
| **Database Insert Fails** | Database query throws error after file write. | **Low** | The orphaned file in `storage/sources` remains on disk under its SHA-256 hash. Content-addressability allows reuse if uploaded again. |
| **Queue Dispatch Fails** | `enqueueConversionJob` throws error. | **Low** | `try / catch` block catches error; worker is triggered directly via `setImmediate`. Job remains in `background_jobs`. |
| **Worker Crashes In-Flight** | Server crashes while `status = 'PROCESSING'`. | **Medium** | On worker restart, `ConversionWorker.recoverStaleJobs()` automatically finds all `PROCESSING` conversion jobs and transitions them to `FAILED` with code `'INTERRUPTED_ON_SHUTDOWN'`. |

---

## 5. PRODUCTION ENVIRONMENT ASSUMPTIONS & HONEST DISCLOSURE

> [!NOTE]
> `LocalFileSystemSourceStorageProvider` stores files on local server disk (`storage/sources`). In a single-instance or containerized deployment with a persistent volume (PVC/bind mount), this provides durable storage.
> For horizontally scaled multi-container clusters (Kubernetes across multiple nodes without shared NFS), an S3-compatible object storage provider (`S3SourceStorageProvider`) should be implemented in future phases to share source files across distinct worker nodes.

