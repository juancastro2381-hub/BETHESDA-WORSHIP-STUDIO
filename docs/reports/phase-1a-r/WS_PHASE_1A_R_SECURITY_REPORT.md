# WORSHIP STUDIO — PHASE 1A-R
# SECURITY REPORT: ACCESS CONTROL, IDOR MITIGATION & INPUT SANITIZATION

**Project:** Bethesda Worship Studio  
**Phase:** 1A-R — Controlled Remediation & Security Hardening  
**Target:** OMR Processing Subsystem & Proposal Lifecycle  
**Execution Date:** 2026-11-02  
**Status:** HARDENED & VERIFIED  

---

## 1. THREAT MODEL & AUDIT FINDINGS

Prior to Phase 1A-R, the OMR service layer suffered from two critical security vulnerabilities:
1. **Insecure Direct Object Reference (IDOR):**
   - Querying `findProposalById(proposalId)` fetched any proposal solely by UUID without checking if the caller was the proposal's creator or held administrative privileges.
   - An authenticated user in a multi-user worship environment could inspect confidential, unreleased sheet music uploaded by another team member.
2. **Missing Role-Based Access Control (RBAC):**
   - Reviewing and approving proposals (`reviewProposal`) and committing them to the canonical song library (`commitToCanonicalSong`) lacked service-level role verification. A viewer or unprivileged band musician could approve arbitrary sheet music drafts into the church's canonical repertoire.

---

## 2. ROLE-BASED ACCESS CONTROL (RBAC) MATRIX

| Method / Endpoint | Permitted Roles | Ownership Constraint | Unprivileged Response |
| :--- | :--- | :--- | :--- |
| `processUpload` | `MUSICIAN`, `WORSHIP_LEADER`, `ADMIN`, `SUPER_ADMIN` | Caller becomes proposal owner (`userId`). | HTTP 401 Unauthorized |
| `getProposalAsync` / `findProposalById` | `MUSICIAN`, `WORSHIP_LEADER`, `ADMIN`, `SUPER_ADMIN` | Must be proposal owner OR have `ADMIN`/`SUPER_ADMIN`. | **HTTP 403 Forbidden** (`ForbiddenError`) |
| `reviewProposalAsync` | `WORSHIP_LEADER`, `ADMIN`, `SUPER_ADMIN` | Must have role with `songs:update_draft` permission. | **HTTP 403 Forbidden** (`ForbiddenError`) |
| `commitToCanonicalSong` | `WORSHIP_LEADER`, `ADMIN`, `SUPER_ADMIN` | Must have role with canonical publication permission. | **HTTP 403 Forbidden** (`ForbiddenError`) |
| `deleteProposal` | `ADMIN`, `SUPER_ADMIN` | Blocked if audit logs exist (`ON DELETE RESTRICT`). | HTTP 403 / HTTP 400 |

---

## 3. IDOR PREVENTION IMPLEMENTATION

### 3.1 Repository-Level Ownership Verification
In [`backend/src/repositories/omr-proposal-repository.ts`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/backend/src/repositories/omr-proposal-repository.ts#L167-L172):

```typescript
// Aislamiento de usuario (IDOR mitigation): si no es ADMIN/SUPER_ADMIN, debe ser el propietario
if (requestingUser && !['ADMIN', 'SUPER_ADMIN'].includes(requestingUser.role)) {
  if (row.userId && row.userId !== requestingUser.id) {
    throw new ForbiddenError('No tiene autorización para acceder a una propuesta de otro usuario.');
  }
}
```

### 3.2 Service-Level Role Verification
In [`backend/src/application/omr-service.ts`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/backend/src/application/omr-service.ts#L235-L237):

```typescript
if (requestingUser && !['WORSHIP_LEADER', 'ADMIN', 'SUPER_ADMIN'].includes(requestingUser.role)) {
  throw new ForbiddenError('No tiene los permisos requeridos (songs:update_draft) para revisar propuestas OMR.');
}
```

### 3.3 Test Verification
1. **Test 13.1 (IDOR Mitigation):**
   - User `Juan` creates an OMR proposal.
   - User `Pedro` (`role: MUSICIAN`) attempts to read the proposal via `omrRepo.findProposalById`.
   - Execution throws `ForbiddenError` with message: *"No tiene autorización para acceder a una propuesta de otro usuario."*
2. **Test 13.2 (RBAC Enforcement):**
   - User with `role: VIEWER` attempts to approve a proposal via `omrService.reviewProposalAsync`.
   - Execution throws `ForbiddenError` with message: *"No tiene los permisos requeridos (songs:update_draft) para revisar propuestas OMR."*

---

## 4. INPUT VALIDATION & DENIAL-OF-SERVICE (DOS) PREVENTION

### 4.1 Unified 15 MB Boundary (Finding R6)
The constant `MAX_OMR_FILE_SIZE_BYTES = 15 * 1024 * 1024` (15,728,640 bytes) is strictly enforced:
- Validation schema rejects `fileSizeBytes > 15 * 1024 * 1024`.
- Standard OMR Provider validates buffer length against the boundary before parsing.
- Prevents memory exhaustion attacks via oversized multi-gigabyte files.

### 4.2 Zero-Byte File Rejection
- Inputs with `fileSizeBytes: 0` or empty buffers are rejected immediately with `ValidationError` ("El archivo no puede estar vacío"). Verified in Test 10.1.

### 4.3 Supported MIME Types
Only verified score document types are accepted:
- `application/pdf`
- `image/png`
- `image/jpeg`
- Any unsupported MIME type (e.g. `audio/mp3`, `application/zip`) is rejected with HTTP 400.

---

## 5. AUDIT LOG SANITIZATION & ZERO-TOKEN LEAKAGE

In accordance with DevSecOps logging policies:
- Table `omr_audit_history` captures metadata only: `proposalId`, `userId`, `actionType`, `oldValue`, `newValue`, `reason`.
- No sensitive user credentials, bearer tokens, API keys, or raw file binary blobs are ever logged in `newValue` or `reason`.
- Verified in Test 11.1.

---
*End of Phase 1A-R Security Report.*

