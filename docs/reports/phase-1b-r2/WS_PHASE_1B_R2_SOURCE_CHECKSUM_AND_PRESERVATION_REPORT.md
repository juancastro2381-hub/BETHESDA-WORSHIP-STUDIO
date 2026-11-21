# WORSHIP STUDIO — PHASE 1B-R2
## SOURCE CHECKSUM & CRYPTOGRAPHIC PRESERVATION REPORT

**Project:** Bethesda Worship Studio  
**Workstream:** B — Cryptographic Source Integrity & Immutability  
**Working Branch:** `feature/phase-1a-core-foundation`  
**Phase:** 1B-R2 — Final Integrity Remediation  
**Status:** Certified Remediated & Fully Verified  

---

## 1. PURPOSE & PRINCIPLE

Original musical source files (MusicXML, MIDI, ChordPro, PDF, Audio, Written Notes) constitute the legal and musical truth of the user's score library.

The platform guarantees:
1. **Unconditional Preservation Before Parsing:** Sources are written to physical disk storage and registered in PostgreSQL before any parsing or interpretation begins.
2. **Cryptographic Invariance Contract:**
   $$\text{SHA256}(\text{originalUploadedBytes}) \equiv \text{SHA256}(\text{bytesStoredOnDisk}) \equiv \text{SHA256}(\text{bytesRetrievedByClient})$$
3. **Deterministic Serialization:** Text and structured JSON sources use canonical key ordering so that hashing is 100% deterministic across operating systems and platforms.
4. **Active Tamper Detection:** Physical file retrieval verifies the SHA-256 hash on read and aborts with `SourceIntegrityError` (HTTP 500) if storage corruption or unauthorized modification occurs.

---

## 2. DEFECT REMEDIATION & ROOT CAUSE ANALYSIS

### 2.1 Resolution of Phase 1B-R Checksum Discrepancy
* **Root Cause in Phase 1B-R:** In Phase 1B-R, `calculateSourceHash` used compact JSON stringification (`JSON.stringify(input.writtenNotes)`), whereas `prepareBufferAndMime` stored pretty-printed JSON (`JSON.stringify(input.writtenNotes, null, 2)`). As a result, the database stored the hash of the compact string, while the file on disk contained the pretty-printed string. The hashes differed!
* **Remediation in Phase 1B-R2:**
  - `UniversalIngestionService.prepareBufferAndMime` was refactored to construct the authoritative `bufferToSave` first.
  - The hash is computed directly from this exact buffer:
    ```typescript
    const sourceHash = crypto.createHash('sha256').update(bufferToSave).digest('hex');
    ```
  - This single hash is stored in `song_sources.checksumSha256`, passed to the adapter, and returned to the client.
  - For structured JSON (`writtenNotes` and `videoUrl`), `UniversalIngestionService.canonicalJsonStringify` recursively sorts all object keys, guaranteeing byte-level determinism.

### 2.2 Tamper Detection with `SourceIntegrityError`
In `UniversalIngestionService.getSourceFile`:
```typescript
const fileBuffer = await this.storageProvider.getBuffer(source.storagePath);
const retrievedChecksum = crypto.createHash('sha256').update(fileBuffer).digest('hex');

if (source.checksumSha256 && retrievedChecksum !== source.checksumSha256) {
  throw new SourceIntegrityError(
    `Fallo de integridad criptográfica al recuperar la fuente original: se esperaba ${source.checksumSha256}, pero el archivo en almacenamiento tiene ${retrievedChecksum}.`
  );
}
```
If a file is corrupted by disk errors, bitten by ransomware, or tampered with by an unauthorized actor, the API refuses to serve corrupted content to musicians and logs a high-severity alert.

### 2.3 Video URL Reference Ingestion
* Video URLs (YouTube, Vimeo) are treated strictly as **external liturgical references** (`sourceKind: 'VIDEO_REFERENCE'`).
* The platform does **NOT** attempt to download gigabytes of video streams, violate external platform terms of service, or pretend to hash unretrieved media bytes.
* The preserved source is a deterministic JSON metadata document containing the validated URL, platform, and registration timestamp.

---

## 3. AUTOMATED TEST EVIDENCE

Tests in `backend/src/__tests__/universal-ingestion-phase1b-r2.test.ts`:

| Test ID | Test Description | Result | Execution Time |
| :--- | :--- | :--- | :--- |
| **B1.1** | `should guarantee SHA256(original) === SHA256(stored) === SHA256(retrieved) for binary SMF` | **PASS** | 20.9 ms |
| **B1.2** | `should guarantee SHA256(original) === SHA256(stored) === SHA256(retrieved) for Written Notes` | **PASS** | 20.6 ms |
| **B1.3** | `should detect file tampering on disk and refuse to serve corrupted bytes (SourceIntegrityError)` | **PASS** | 26.6 ms |
| **B1.4** | `should register VIDEO_REFERENCE without downloading stream or pretending to hash media bytes` | **PASS** | 20.6 ms |

**Workstream B Total:** 4 passed, 0 failed.

