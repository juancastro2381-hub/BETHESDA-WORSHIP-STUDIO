# WORSHIP STUDIO — PHASE 1A-R3.1 REPORT
## CACHE HYGIENE, PERSISTENCE INVARIANTS & TRANSACTIONAL CONSISTENCY

**Project:** Bethesda Worship Studio  
**Branch:** `feature/phase-1a-core-foundation`  
**Phase:** 1A-R3.1 — Final Defect Closure & Hardening  
**Target:** Remediations R3.1-02 & R3.1-07  
**Date:** 2026-11-03  
**Status:** IMPLEMENTED & VERIFIED  

---

## 1. EXECUTIVE SUMMARY

In previous iterations, `OmrService` maintained a synchronous method `getProposal(id: string, requestingUser?: AuthenticatedUser): OmrProposal` that retrieved proposals directly from the in-memory L1 cache (`proposalCache.get(id)`). This violated the architectural invariant that PostgreSQL is the authoritative single source of truth:
- If a proposal was deleted or altered directly in PostgreSQL, the service would continue serving stale cached data.
- If the database was unavailable or severed, the cache could mask infrastructure failure.

In Phase 1A-R3.1, remediation R3.1-02 eliminated cache-only retrieval:
- Synchronous `getProposal` was completely removed from the service contract and replaced by `async getProposal(id: string, requestingUser: AuthenticatedUser): Promise<OmrProposal>`.
- `getProposal` now strictly delegates to `omrRepo.getProposalAsync(id, requestingUser)`, querying PostgreSQL directly.
- If the record is missing in PostgreSQL, the repository evicts any stale L1 cache entry and throws `NotFoundError`.
- If the database connection is severed, the error is immediately propagated; the cache is never used as an uncoordinated fallback.
- All transactional mutation operations (`saveProposal`, `updateProposalStatusAndAudit`, `updateMeasure`, `commitProposalTransaction`) adhere to strict write-through and cache synchronization invariants.

---

## 2. REPOSITORY & SERVICE ASYNCHRONOUS RETRIEVAL ARCHITECTURE (R3.1-02)

### 2.1 Authoritative PostgreSQL Querying
In `backend/src/repositories/omr-proposal-repository.ts`, `getProposalAsync` guarantees that PostgreSQL is always queried:

```typescript
async getProposalAsync(
  proposalId: string,
  requestingUser: AuthenticatedUser
): Promise<OmrProposal> {
  if (!requestingUser || !requestingUser.id) {
    throw new UnauthorizedError('Se requiere un usuario autenticado para consultar la propuesta OMR.');
  }

  // Consulta directa y autoritativa a PostgreSQL
  const proposal = await this.findProposalById(proposalId);
  if (!proposal) {
    // Si la propuesta no existe en PostgreSQL (por ejemplo, eliminada externamente),
    // se purga inmediatamente de la caché L1 para prevenir inconsistencias.
    this.proposalCache.delete(proposalId);
    throw new NotFoundError(`Propuesta OMR no encontrada: ${proposalId}`);
  }

  // Verificación estricta de control de acceso (IDOR)
  if (requestingUser.role !== 'ADMIN' && proposal.userId !== requestingUser.id) {
    throw new ForbiddenError('No tiene autorización para acceder a una propuesta perteneciente a otro usuario.');
  }

  // Refrescar caché L1 con el estado verificado de PostgreSQL
  this.proposalCache.set(proposalId, proposal);
  return proposal;
}
```

### 2.2 Application Service Integration
In `backend/src/application/omr-service.ts`, `getProposal` is fully asynchronous:

```typescript
async getProposal(
  proposalId: string,
  requestingUser: AuthenticatedUser
): Promise<OmrProposal> {
  return await this.omrRepo.getProposalAsync(proposalId, requestingUser);
}
```

---

## 3. PERSISTENCE & TRANSACTIONAL INVARIANTS (R3.1-07)

### 3.1 Write-Through Cache Coherence
Every mutation follows a strict sequence:
1. **Database Write First:** PostgreSQL transaction executes all inserts/updates/deletes.
2. **Commit Confirmation:** If the database operation fails, the transaction is rolled back, the cache is NOT populated or is purged, and the error propagates to the caller.
3. **Cache Synchronization:** Only upon confirmed database commit is the in-memory cache updated with the freshly persisted entity.

### 3.2 Concurrency Serialization via `SELECT FOR UPDATE`
In `commitProposalTransaction`, race conditions and double-commit hazards are mitigated through row-level locking:
```sql
SELECT * FROM omr_proposals WHERE id = $1 FOR UPDATE;
```
If two concurrent requests attempt to commit the same proposal:
- The first acquires the row lock, transitions status to `COMMITTED`, inserts the canonical song and song version, records the audit trail, and commits.
- The second request waits on the lock, reads the updated `COMMITTED` status, and cleanly returns the existing canonical song without creating duplicate records or throwing unexpected errors (idempotent commit).

---

## 4. AUTOMATED TEST EVIDENCE

The persistence and cache hygiene behaviors are verified across multiple test suites:

| Test ID | Verified Behavior | Expected Result | Status |
|:---|:---|:---|:---:|
| **18.1** | `getProposal` queries PostgreSQL asynchronously and updates cache | Hydrated proposal returned; L1 cache populated | **PASS** |
| **18.2** | Record deleted directly in PostgreSQL (`DELETE FROM omr_proposals`) | `NotFoundError` thrown; stale L1 cache evicted | **PASS** |
| **18.3** | Database query fails due to severed connection | Database error propagated; cache does NOT mask failure | **PASS** |
| **1.1** | Persistence survives total cache clearing (`proposalCache.clear()`) | Proposal, measures, and audit successfully reloaded from PostgreSQL | **PASS** |
| **1.2** | Simulated DB write failure during proposal creation | Error propagated; cache remains empty | **PASS** |
| **1.3** | Simulated DB write failure during review | Error propagated; review status not updated in DB or cache | **PASS** |
| **1.4** | Atomic confirmation of status and audit in single transaction | Both status and audit record persisted together | **PASS** |
| **14.1** | Idempotent canonical commit retry | Re-running commit returns existing canonical song ID without duplicates | **PASS** |
| **14.2** | Concurrent canonical commits under race condition | `SELECT FOR UPDATE` serializes execution; exactly 1 song created | **PASS** |
| **15.1** | Proposal deleted directly in PostgreSQL | L1 cache evicted; subsequent access throws `NotFoundError` | **PASS** |

### Execution Excerpt:
```text
  ✔ 18.1: should retrieve proposal asynchronously from PostgreSQL and update cache (R3.1-02) (4.5783ms)
  ✔ 18.2: should fail with NotFoundError and evict cache when record deleted directly in PostgreSQL (R3.1-02) (5.0299ms)
  ✔ 18.3: should propagate infrastructure error if database query fails during getProposal (R3.1-02) (0.431ms)
```

---

## 5. CONCLUSION

Remediations R3.1-02 and R3.1-07 are fully implemented and verified. Production cache-only proposal retrieval has been eliminated, and PostgreSQL reigns as the single authoritative source of truth.

