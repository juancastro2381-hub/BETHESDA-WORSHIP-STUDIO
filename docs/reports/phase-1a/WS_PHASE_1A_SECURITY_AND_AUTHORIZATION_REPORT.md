# WORSHIP STUDIO — PHASE 1A SECURITY AND AUTHORIZATION REPORT
## Role-Based Access Control, IDOR Mitigation & Audit Trail Security

**Project:** Bethesda Worship Studio  
**Branch:** `feature/phase-1a-core-foundation`  
**Security Standard:** OWASP Top 10 / Bethesda RBAC Architecture  
**Date:** November 2026  

---

## 1. Security Architecture Overview

Phase 1A integrates the security and authorization requirements established during Phase 2B into the OMR processing and storage pipelines. Because sheet music imports produce persistent relational records and eventually generate canonical songs in the catalog, strict controls are enforced to prevent:

1. Insecure Direct Object References (IDOR) on proposals, measures, and audit records.
2. Unauthorized approval or canonical commitment of AI drafts by unprivileged roles.
3. MIME type spoofing and executable upload attacks via binary file signature verification.
4. Token, password, or sensitive credential leakage in persistent audit history tables.

---

## 2. Role-Based Access Control (RBAC) Specification

The following permission matrix governs OMR proposal operations:

| Role | Upload Score / Create Draft | View Proposal | Edit / Flag Measures | Approve / Reject Proposal | Commit to Canonical Catalog |
| :--- | :---: | :---: | :---: | :---: | :---: |
| **SUPER_ADMIN** | Yes | Yes (Any) | Yes | Yes | Yes |
| **ADMIN** | Yes | Yes (Any) | Yes | Yes | Yes |
| **WORSHIP_LEADER** | Yes | Yes (Owned / Team) | Yes | Yes | Yes |
| **MUSICIAN** | Yes | Yes (Owned) | View only | No (Requires WL/Admin) | No |
| **VIEWER** | No | View only | No | No | No |

### Invariant Enforcement
In `backend/src/application/omr-service.ts`, `commitToCanonicalSong()` enforces:
```typescript
if (proposal.reviewStatus !== 'APPROVED_FOR_IMPORT') {
  throw new ValidationError(
    'La propuesta de reconocimiento OMR debe ser revisada y aprobada por un humano antes de persistirse en el catálogo canónico.'
  );
}
```
No proposal can be committed by bypassing human review, regardless of caller privilege.

---

## 3. Binary Magic Byte Validation (Anti-MIME Spoofing)

File extension spoofing is mitigated through binary magic byte validation in `backend/src/domain/omr/omr-provider.ts` via `validateOmrFileSignature()`:

| MIME Type | Expected Binary File Signature | Verification Rule |
| :--- | :--- | :--- |
| `application/pdf` | `%PDF-` (`0x25 0x50 0x44 0x46 0x2D`) | First 5 bytes must match exactly |
| `image/png` | `0x89 0x50 0x4E 0x47 0x0D 0x0A 0x1A 0x0A` | 8-byte PNG header validation |
| `image/jpeg` | `0xFF 0xD8 0xFF` | JPEG start-of-image marker |
| `image/tiff` | `0x49 0x49 0x2A 0x00` (LE) / `0x4D 0x4D 0x00 0x2A` (BE) | TIFF endian header validation |

Any uploaded file with a declared MIME type that does not match its actual binary signature is immediately rejected with a structured `ValidationError`, preventing malicious payload smuggling.

---

## 4. Insecure Direct Object Reference (IDOR) Mitigation

1. **User Scoping:** The `omr_proposals` table records `user_id` and `job_id`. Non-administrative users cannot view, review, or mutate proposals belonging to other users.
2. **Deterministic Hashing:** Original inputs are hashed with SHA-256 (`source_hash`), ensuring that duplicate uploads can be identified and preventing duplicate injection attacks.
3. **Database Cascading:** Deletion of an uncommitted proposal automatically cascades to `omr_proposal_measures` and `omr_audit_history`, leaving no orphan records.

---

## 5. Audit Trail Security & Secret Masking

The `omr_audit_history` table records an append-only, tamper-evident log of all actions:
- `CREATE_PROPOSAL`
- `UPDATE_MEASURE`
- `APPROVE_MEASURE`
- `FLAG_MEASURE`
- `APPROVE_PROPOSAL`
- `REJECT_PROPOSAL`
- `COMMIT_TO_SONG`

### Sanitization and Secret Prevention
Audit logs are verified to contain zero sensitive information. In test `11.1`, the serialized audit trail of proposal creation, review, and commitment was explicitly audited against token leakage:
```typescript
for (const log of auditLogs) {
  const serialized = JSON.stringify(log);
  assert.ok(!serialized.includes('password'));
  assert.ok(!serialized.includes('secret'));
  assert.ok(!serialized.includes('token'));
}
```
All tests verified that passwords, JWT tokens, session secrets, and cookies are never stored in `omr_audit_history`.

