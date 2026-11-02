# WORSHIP STUDIO — PHASE 1A-R2
## Security, IDOR Prevention & Access Control Report

**Project:** Bethesda Worship Studio  
**Branch:** `feature/phase-1a-core-foundation`  
**Phase:** 1A-R2 (Final Integrity, Security & Transactional Consistency Remediation)  
**Author:** Antigravity (Implementation Agent)  
**Status:** `IMPLEMENTATION COMPLETE — AWAITING INDEPENDENT PRODUCT OWNER CERTIFICATION`  

---

## 1. Security Architecture & Threat Model

In Bethesda Worship Studio, church musical teams, worship leaders, and musicians manage copyrighted arrangements, sensitive rehearsal notes, and preliminary sheet music scans. A robust zero-trust access control model is essential to prevent:

1. **Insecure Direct Object Reference (IDOR):** An attacker guessing or enumerating UUIDs of proposals or sessions to read, modify, or commit another user's content.
2. **Privilege Escalation:** Unprivileged roles (such as `MUSICIAN`, `VIEWER`, or `MEMBER`) executing administrative actions such as approving proposals or writing to the canonical catalogue.
3. **Null-Owner Exploit:** Accessing unassigned or system proposals by exploiting loose ownership checks that only compare when `row.userId` is truthy.
4. **Buffer & File Header Spoofing:** Submitting maliciously crafted or oversized payloads disguised as valid PDF or image files.

---

## 2. Remediation of Security Controls in Phase 1A-R2

### 2.1 Elimination of the Null-Owner Vulnerability (R2-04)
- **Vulnerability Identified in Audit:**
  In Phase 1A-R, ownership checks were structured as:
  ```typescript
  if (row.userId && row.userId !== requestingUser.id) {
    throw new ForbiddenError('No tiene autorización...');
  }
  ```
  If an OMR proposal had `userId = null` (e.g., imported via a legacy script or unassigned batch job), the condition `row.userId` evaluated to falsy. Consequently, **any authenticated user** could read, modify, or delete that proposal.
- **Remediation Implemented:**
  In [`omr-proposal-repository.ts`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/backend/src/repositories/omr-proposal-repository.ts), null ownership is strictly treated as requiring administrative privileges:
  ```typescript
  if (!['ADMIN', 'SUPER_ADMIN'].includes(requestingUser.role)) {
    if (!row.userId) {
      throw new ForbiddenError(
        'Acceso denegado: la propuesta carece de propietario asignado y requiere privilegios de administrador.'
      );
    }
    if (row.userId !== requestingUser.id) {
      throw new ForbiddenError('No tiene autorización para acceder a una propuesta de otro usuario.');
    }
  }
  ```
  Ordinary users are categorically denied access to unassigned proposals (HTTP 403 `ForbiddenError`).
- **Verification:** Test 13.3 creates a proposal with `userId = null` and verifies that ordinary users (`WORSHIP_LEADER`, `MUSICIAN`) are blocked with HTTP 403, while `ADMIN` is permitted.

---

### 2.2 Mandatory Authenticated Requesting Identity (R2-04)
- **Vulnerability Identified in Audit:**
  Protected repository methods accepted an optional `requestingUser?: { id: string; role: string }`. If omitted, methods performed mutations or queries without identity verification.
- **Remediation Implemented:**
  - In `findProposalById`, `updateProposalStatusAndAudit`, `updateMeasure`, `getAuditHistory`, and `commitProposalTransaction`, the `requestingUser` identity is mandatory.
  - If `!requestingUser`, the method immediately throws `UnauthorizedError('Identidad de usuario autenticada requerida...', HTTP 401)`.
  - Application services and HTTP controllers must extract the identity from the verified session/token context (`req.user`) and pass it explicitly. Supplying a `userId` in the request body is never trusted as authorization.
- **Verification:** Test 13.4 verifies that calling `findProposalById` without a requesting user throws `UnauthorizedError` (HTTP 401).

---

### 2.3 Strict Role-Based Access Control (RBAC) Enforcement (R2-04)
- **Rules Enforced:**
  - **Proposal Creation (`processUpload`):** Any authenticated user (`WORSHIP_LEADER`, `MUSICIAN`, `ADMIN`, `SUPER_ADMIN`).
  - **Proposal Review (`reviewProposal`):** Restricted to `WORSHIP_LEADER`, `ADMIN`, and `SUPER_ADMIN`. Unprivileged roles (`MUSICIAN`, `VIEWER`, `MEMBER`) are denied with `ForbiddenError` (HTTP 403).
  - **Canonical Commitment (`commitToCanonicalSong`):** Restricted to `WORSHIP_LEADER`, `ADMIN`, and `SUPER_ADMIN`.
  - **Proposal Deletion (`deleteProposal`):** Strictly restricted to `ADMIN` and `SUPER_ADMIN`.
- **Verification:** Test 13.2 verifies that users with `role: 'MUSICIAN'` or `role: 'VIEWER'` cannot review proposals or commit them to the canonical catalogue.

---

### 2.4 Audit History Access Protection (R2-04)
- **Vulnerability Identified in Audit:**
  Audit history was accessible without verifying whether the requesting user owned the underlying proposal.
- **Remediation Implemented:**
  [`omrProposalRepository.getAuditHistory`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/backend/src/repositories/omr-proposal-repository.ts) requires `requestingUser` and validates proposal ownership via `findProposalById(proposalId, requestingUser)`. If an ordinary user attempts to read another user's audit trail, the query is blocked with HTTP 403 `ForbiddenError`.
- **Verification:** Test 13.5 verifies that unauthorized users cannot inspect audit history.

---

### 2.5 Input Buffer Validation, Size Coherence & Magic Bytes (R2-07)
- **Threat Vector:**
  Exploiting file upload endpoints with mismatched Content-Length, zero-byte empty files, files exceeding memory thresholds, or uploading executable/malicious payloads masked as `.pdf` or `.png`.
- **Remediation Implemented in [`OmrService.processUpload`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/backend/src/application/omr-service.ts):**
  1. **Zero-Byte Check:** Buffers with `buffer.length === 0` are rejected with `ValidationError` (HTTP 400).
  2. **Declared vs Actual Size Match:** If `input.buffer.length !== input.fileSizeBytes`, upload is rejected with `ValidationError`.
  3. **15 MB Boundary:** If `input.buffer.length > MAX_OMR_FILE_SIZE_BYTES` (15,728,640 bytes), upload is rejected with `ValidationError`.
  4. **Magic Bytes Header Verification (`validateOmrFileSignature`):**
     - PDF: must begin with `%PDF-` (`0x25 0x50 0x44 0x46 0x2D`).
     - PNG: must begin with `\x89PNG\r\n\x1a\n` (`0x89 0x50 0x4E 0x47 0x0D 0x0A 0x1A 0x0A`).
     - JPEG: must begin with `0xFF 0xD8 0xFF`.
     - Invalid headers trigger immediate `ValidationError`.
- **Verification:** Tests 10.1, 10.2, 10.3, 10.4, 10.5, and 10.6 verify buffer boundary and magic byte enforcement.

---

## 3. Authorization & Security Test Matrix

| Test ID | Control | Scenario | Expected Status | Result |
| :---: | :---: | :--- | :---: | :---: |
| **10.1** | R2-07 | Upload empty 0-byte buffer | `ValidationError` (400) | **PASS** |
| **10.2** | R6 | Standardized 15 MB boundary consistency | Invariant match | **PASS** |
| **10.3** | R2-07 | Buffer length larger than declared size | `ValidationError` (400) | **PASS** |
| **10.4** | R2-07 | Buffer length smaller than declared size | `ValidationError` (400) | **PASS** |
| **10.5** | R2-07 | Buffer exceeds 15 MB by 1 byte | `ValidationError` (400) | **PASS** |
| **10.6** | R2-07 | Invalid PDF binary signature / header spoofing | `ValidationError` (400) | **PASS** |
| **13.1** | R2-04 | User attempts to access another user's proposal | `ForbiddenError` (403) | **PASS** |
| **13.2** | R2-04 | Unprivileged role (`MUSICIAN`) attempts proposal review | `ForbiddenError` (403) | **PASS** |
| **13.3** | R2-04 | Ordinary user attempts access to proposal with null owner | `ForbiddenError` (403) | **PASS** |
| **13.4** | R2-04 | Request without authenticated requesting identity | `UnauthorizedError` (401) | **PASS** |
| **13.5** | R2-04 | Unauthorized user attempts to inspect audit history | `ForbiddenError` (403) | **PASS** |

