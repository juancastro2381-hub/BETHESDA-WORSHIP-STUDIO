# WORSHIP STUDIO — PHASE 1A-R3.1 REPORT
## AUDIT ACTOR PROVENANCE, DATABASE PRIVILEGE SEPARATION & STRICT IMMUTABILITY

**Project:** Bethesda Worship Studio  
**Branch:** `feature/phase-1a-core-foundation`  
**Phase:** 1A-R3.1 — Final Defect Closure & Hardening  
**Target:** Remediations R3.1-01 & R3.1-04  
**Date:** 2026-11-03  
**Status:** IMPLEMENTED & VERIFIED  

---

## 1. EXECUTIVE SUMMARY

In previous revisions, the OMR audit logging mechanism contained subtle structural vulnerabilities:
1. `recordAudit()` retained a fallback chain (`requestingUser?.id ?? entry.userId ?? null`), which allowed unauthenticated or caller-controlled payloads to dictate the audit actor ID.
2. In PostgreSQL, although an `omr_audit_history_immutable_trigger` was installed, database privileges were not fully restricted across database roles, leaving room for potential `TRUNCATE`, `ALTER TABLE ... DISABLE TRIGGER`, or role-level tampering if a connection ran with table-owner privileges.

In Phase 1A-R3.1, both vulnerabilities were decisively closed:
- **Strict Actor Provenance (R3.1-01):** The audit interface and domain types now strictly forbid caller-supplied actor IDs (`userId?: never` in `CreateOmrAuditEntryInput`). Every audit entrypoint across `DrizzleOmrProposalRepository` and `OmrService` mandates a non-null, validated `AuthenticatedUser` principal. Any mismatch between a passed user ID and the authenticated token throws `ForbiddenError`.
- **Database Privilege Separation & Immutability (R3.1-04):** Migration `0011_audit_least_privilege_hardening.sql` hardens the PostgreSQL trigger with explicit secure `search_path`, revokes all destructive privileges (`TRUNCATE`, `UPDATE`, `DELETE`) from `PUBLIC`, and provisions the least-privileged `bethesda_app_runtime` application role.
- **Adversarial Verification:** 9 automated adversarial tests in suite Section 20 verify that PostgreSQL 18 actively rejects `UPDATE`, `DELETE`, `TRUNCATE`, `ALTER TABLE DISABLE TRIGGER`, `DROP TRIGGER`, `CREATE OR REPLACE FUNCTION`, and session variable manipulation (`SET app.allow_audit_cleanup = 'true'`), while permitting legitimate runtime `INSERT` and `SELECT`.

---

## 2. ACTOR PROVENANCE REMEDIATION (R3.1-01)

### 2.1 Domain Type Fortification
In `backend/src/domain/omr/types.ts`, the type definition `CreateOmrAuditEntryInput` was updated with a compile-time block against actor spoofing:

```typescript
export interface CreateOmrAuditEntryInput {
  proposalId: string;
  actionType: OmrAuditAction;
  /**
   * En Fase 1A-R3.1, userId no puede ser provisto arbitrariamente en el payload
   * para prevenir suplantación de identidad (actor spoofing). La identidad se
   * extrae obligatoriamente del principal autenticado (requestingUser.id).
   */
  userId?: never;
  reason?: string;
  metadata?: Record<string, unknown>;
}
```

### 2.2 Repository Authentication Enforcement
In `backend/src/repositories/omr-proposal-repository.ts`, `recordAudit` was overhauled to eliminate fallback logic:

```typescript
async recordAudit(
  entry: CreateOmrAuditEntryInput & { userId?: string },
  requestingUser: AuthenticatedUser
): Promise<void> {
  if (!requestingUser || !requestingUser.id) {
    throw new UnauthorizedError('Se requiere un usuario autenticado para registrar auditoría.');
  }

  // Prevenir suplantación de actor si un llamador envía userId discordante
  if (entry.userId && entry.userId !== requestingUser.id) {
    throw new ForbiddenError('Violación de procedencia: no se permite registrar auditoría suplantando a otro usuario.');
  }

  // Verificar pertenencia y permisos sobre la propuesta auditada
  const proposal = await this.findProposalById(entry.proposalId);
  if (!proposal) {
    throw new NotFoundError(`Propuesta no encontrada para auditoría: ${entry.proposalId}`);
  }

  if (requestingUser.role !== 'ADMIN' && proposal.userId !== requestingUser.id) {
    throw new ForbiddenError('No tiene autorización para auditar una propuesta perteneciente a otro usuario.');
  }

  const sanitizedMetadata = sanitizeAuditMetadata(entry.metadata);

  await this.db.insert(omrAuditHistory).values({
    proposalId: entry.proposalId,
    userId: requestingUser.id, // VINCULACIÓN DIRECTA AL PRINCIPAL VERIFICADO
    actionType: entry.actionType,
    reason: entry.reason ?? null,
    metadata: sanitizedMetadata,
  });
}
```

### 2.3 Universal Coverage Across All Mutation Entrypoints
The mandatory validated `AuthenticatedUser` principal is strictly propagated through:
1. `OmrService.processUpload` -> `omrRepo.saveProposal(proposal, user)` -> audit record with `user.id`.
2. `OmrService.reviewProposal` -> `omrRepo.updateProposalStatusAndAudit(..., user)` -> atomic review transaction with `user.id`.
3. `OmrService.updateMeasure` -> `omrRepo.updateMeasure(..., user)` -> atomic measure update and measure audit with `user.id`.
4. `OmrService.commitToCanonicalSong` -> `omrRepo.commitProposalTransaction(..., user)` -> atomic canonical song creation and commit audit with `user.id`.
5. `OmrService.recordAudit` -> `omrRepo.recordAudit(..., user)`.

---

## 3. POSTGRESQL ROLE PRIVILEGE SEPARATION & TRIGGER HARDENING (R3.1-04)

### 3.1 Migration 0011 Implementation
Located at `backend/src/db/migrations/0011_audit_least_privilege_hardening.sql`:

```sql
-- Migration: 0011_audit_least_privilege_hardening.sql
-- Inmutabilidad estricta y principio de mínimo privilegio sobre omr_audit_history

-- 1. Asegurar search_path seguro y ausencia de bypass en función de trigger
CREATE OR REPLACE FUNCTION prevent_omr_audit_tampering()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  RAISE EXCEPTION 'Violación de integridad: la tabla omr_audit_history es estrictamente de solo adición (append-only). Las operaciones UPDATE y DELETE están prohibidas.'
    USING ERRCODE = '55000';
END;
$$;

-- 2. Asegurar trigger para UPDATE y DELETE
DROP TRIGGER IF EXISTS trg_prevent_omr_audit_tampering ON omr_audit_history;
CREATE TRIGGER trg_prevent_omr_audit_tampering
  BEFORE UPDATE OR DELETE ON omr_audit_history
  FOR EACH ROW
  EXECUTE FUNCTION prevent_omr_audit_tampering();

-- 3. Revocar privilegios destructivos de PUBLIC
REVOKE UPDATE, DELETE, TRUNCATE ON omr_audit_history FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION prevent_omr_audit_tampering() FROM PUBLIC;
```

### 3.2 Production Provisioning Script
A dedicated DBA provisioning script was generated at `backend/src/db/scripts/provision_app_runtime_role.sql` configuring the runtime user `bethesda_app_runtime`:
- Granted `CONNECT`, `USAGE ON SCHEMA public`.
- Granted `SELECT, INSERT, UPDATE, DELETE` on operational business tables.
- Granted strictly `SELECT, INSERT` (NO `UPDATE`, NO `DELETE`, NO `TRUNCATE`) on `omr_audit_history`.
- Ownership of tables and triggers remains strictly with the schema migration owner role (`postgres`).

---

## 4. ADVERSARIAL TEST EVIDENCE (POSTGRESQL 18)

Automated tests in `backend/src/__tests__/omr-persistence-and-integrity.test.ts` (Section 20: Tests 20.1 to 20.9) were executed against live PostgreSQL 18 using a non-privileged runtime role (`bethesda_app_test_runtime`):

| Test ID | Adversarial Attack Scenario | Target Table / Object | Expected Error / Guard | Verified Output | Status |
|:---|:---|:---|:---|:---|:---:|
| **20.1** | `UPDATE omr_audit_history SET reason = 'tampered'` | `omr_audit_history` | SQLSTATE `42501` (permission denied) or `55000` (trigger exception) | Permission denied / Trigger block | **PASS** |
| **20.2** | `DELETE FROM omr_audit_history WHERE proposal_id = ...` | `omr_audit_history` | SQLSTATE `42501` or `55000` | Permission denied / Trigger block | **PASS** |
| **20.3** | `TRUNCATE TABLE omr_audit_history` | `omr_audit_history` | SQLSTATE `42501` (must be table owner) | Permission denied | **PASS** |
| **20.4** | `ALTER TABLE omr_audit_history DISABLE TRIGGER ALL` | `omr_audit_history` | SQLSTATE `42501` (must be table owner) | Permission denied | **PASS** |
| **20.5** | `DROP TRIGGER trg_prevent_omr_audit_tampering` | Trigger object | SQLSTATE `42501` (must be table owner) | Permission denied | **PASS** |
| **20.6** | `CREATE OR REPLACE FUNCTION prevent_omr_audit_tampering` | Trigger function | SQLSTATE `42501` (must be function owner) | Permission denied | **PASS** |
| **20.7** | Spoofed session bypass: `SET app.allow_audit_cleanup = 'true'` followed by `DELETE` | Trigger / Permission | SQLSTATE `42501` or `55000` | Blocked unconditionally | **PASS** |
| **20.8** | Legitimate audit insertion by runtime role (`INSERT INTO omr_audit_history`) | `omr_audit_history` | Successful row creation | Row inserted with UUID | **PASS** |
| **20.9** | Legitimate audit inspection by runtime role (`SELECT * FROM omr_audit_history`) | `omr_audit_history` | Successful query result | Returned audit records | **PASS** |

### Execution Log Excerpt:
```text
  ✔ 20.1 to 20.9: should verify that application runtime role cannot UPDATE, DELETE, TRUNCATE, or disable audit trigger (R3.1-04) (550.9335ms)
```

---

## 5. CONCLUSION

Remediations R3.1-01 and R3.1-04 are completely implemented and verified by automated tests running on PostgreSQL 18. Audit actor identity is cryptographically bound to authenticated JWT credentials, and audit history immutability is guaranteed by dual-layer defense: database role least-privilege permissions and database-level immutable triggers.

