# WORSHIP STUDIO — PHASE 1A-R3.1 REPORT
## END-TO-END AUTHENTICATION PROVENANCE, RBAC & IDOR PREVENTION

**Project:** Bethesda Worship Studio  
**Branch:** `feature/phase-1a-core-foundation`  
**Phase:** 1A-R3.1 — Final Defect Closure & Hardening  
**Target:** Remediation R3.1-05  
**Date:** 2026-11-03  
**Status:** IMPLEMENTED & VERIFIED  

---

## 1. EXECUTIVE SUMMARY

Prior to Phase 1A-R3.1, authentication and authorization for the OMR subsystem were verified primarily through service-layer and repository-layer unit/integration tests. There was no dedicated Fastify HTTP route module exposing OMR endpoints protected by `AuthGuard` with JWT token verification and granular role-based permissions (`songs:create`, `songs:read`, `songs:update_draft`, `audit:read`, `songs:delete`).

In Phase 1A-R3.1, remediation R3.1-05 was executed:
- Created `backend/src/interfaces/http/routes/omr.routes.ts` mounted at prefix `/api/v1/omr`.
- Integrated `AuthGuard` middlewares (`requireAuth`, `requirePermission`) across all OMR HTTP endpoints.
- Extracted `AuthenticatedUser` (`id: request.user.sub`, `role: request.user.role`) strictly from validated JWT claims.
- Enforced strict multi-tenant IDOR protection ensuring users cannot access or mutate proposals owned by others unless granted the `ADMIN` role.
- Delivered a comprehensive E2E test suite (`backend/src/__tests__/omr-e2e-auth-provenance.test.ts`) comprising 15 automated integration tests. All 15 tests pass with 100% success.

---

## 2. HTTP ROUTE ARCHITECTURE & PERMISSIONS CATALOG

The OMR HTTP router (`backend/src/interfaces/http/routes/omr.routes.ts`) exposes 7 RESTful endpoints:

| Endpoint | HTTP Method | Required Permission | Allowed Roles | Functionality & Constraints |
|:---|:---:|:---:|:---:|:---|
| `/api/v1/omr/upload` | `POST` | `songs:create` | `ADMIN`, `WORSHIP_LEADER` | Uploads sheet music file (PDF/TIFF/PNG), verifies MIME/signature and 15MB limit, creates OMR proposal bound to `request.user.sub`. |
| `/api/v1/omr/proposals/:id` | `GET` | `songs:read` | `ADMIN`, `WORSHIP_LEADER`, `MUSICIAN` | Retrieves proposal details asynchronously from PostgreSQL. Enforces IDOR: owner or ADMIN only. |
| `/api/v1/omr/proposals/:id/review` | `POST` | `songs:update_draft` | `ADMIN`, `WORSHIP_LEADER` | Submits human review (`APPROVED_FOR_IMPORT` or `REJECTED`). Enforces owner or ADMIN. |
| `/api/v1/omr/proposals/:id/measures/:measureNumber` | `PATCH` | `songs:update_draft` | `ADMIN`, `WORSHIP_LEADER` | Edits musical content of a measure before canonical commit. Enforces owner or ADMIN. |
| `/api/v1/omr/proposals/:id/commit` | `POST` | `songs:create` | `ADMIN`, `WORSHIP_LEADER` | Commits approved proposal to canonical songs catalog in an atomic transaction. Enforces owner or ADMIN. |
| `/api/v1/omr/proposals/:id/audit` | `GET` | `audit:read` | `ADMIN` only | Retrieves immutable audit trail for the proposal. Strict RBAC rejects non-admin users. |
| `/api/v1/omr/proposals/:id` | `DELETE` | `songs:delete` | `ADMIN`, `WORSHIP_LEADER` | Deletes an uncommitted proposal without audit history. Restrictive foreign key blocks deletion if audit records exist. Enforces owner or ADMIN. |

---

## 3. SECURITY MECHANISMS & PROVENANCE EXTRACTION

### 3.1 Principal Extraction from JWT Claims
In `omr.routes.ts`, caller identity is derived strictly from verified JWT tokens without accepting client-provided user IDs:

```typescript
function extractPrincipal(request: FastifyRequest): AuthenticatedUser {
  if (!request.user || !request.user.sub || !request.user.role) {
    throw new UnauthorizedError('Credenciales de autenticación no válidas en la petición.');
  }
  return {
    id: request.user.sub,
    role: request.user.role as AuthenticatedUser['role'],
  };
}
```

### 3.2 IDOR Defense Boundary
To guarantee isolation between users, the router asserts ownership before delegating to the application service:

```typescript
async function assertProposalAccess(
  omrRepo: IOmrProposalRepository,
  proposalId: string,
  user: AuthenticatedUser
): Promise<OmrProposal> {
  const proposal = await omrRepo.findProposalById(proposalId);
  if (!proposal) {
    throw new NotFoundError(`Propuesta OMR no encontrada: ${proposalId}`);
  }
  if (user.role !== 'ADMIN' && proposal.userId !== user.id) {
    throw new ForbiddenError('No tiene autorización para acceder a una propuesta perteneciente a otro usuario.');
  }
  return proposal;
}
```

---

## 4. AUTOMATED INTEGRATION TEST EVIDENCE

The dedicated E2E test suite (`backend/src/__tests__/omr-e2e-auth-provenance.test.ts`) executes full HTTP requests against the Fastify instance using `fastify.inject()`.

### Test Summary:
- **E2E 1.1:** Rejects unauthenticated upload with HTTP `401 Unauthorized`.
- **E2E 1.2:** Rejects upload with invalid Bearer token with HTTP `401 Unauthorized`.
- **E2E 1.3:** Rejects upload by `VIEWER` role with HTTP `403 Forbidden` (`songs:create` missing).
- **E2E 1.4:** Rejects upload by `MUSICIAN` role with HTTP `403 Forbidden` (`songs:create` missing).
- **E2E 1.5:** Successfully allows upload by `WORSHIP_LEADER`, creates proposal bound to `request.user.sub` with HTTP `201 Created`.
- **E2E 2.1:** Rejects retrieval of another user's proposal with HTTP `403 Forbidden` (IDOR check).
- **E2E 2.2:** Allows proposal owner to retrieve proposal with HTTP `200 OK`.
- **E2E 2.3:** Allows `ADMIN` to retrieve another user's proposal with HTTP `200 OK`.
- **E2E 3.1:** Rejects review submission by unprivileged role (`MUSICIAN`) with HTTP `403 Forbidden`.
- **E2E 3.2:** Rejects review of another user's proposal by non-owner `WORSHIP_LEADER` with HTTP `403 Forbidden`.
- **E2E 3.3:** Allows proposal owner (`WORSHIP_LEADER`) to approve proposal with HTTP `200 OK`.
- **E2E 4.1:** Rejects measure update on another user's proposal with HTTP `403 Forbidden`.
- **E2E 4.2:** Allows proposal owner to update measure with HTTP `200 OK`.
- **E2E 5.1:** Rejects canonical commit of another user's proposal with HTTP `403 Forbidden`.
- **E2E 5.2:** Allows owner to commit approved proposal to canonical song and version with HTTP `201 Created`.
- **E2E 6.1:** Rejects audit inspection by non-admin role (`MUSICIAN`) with HTTP `403 Forbidden` (`audit:read` missing).
- **E2E 6.2:** Allows `ADMIN` to inspect audit history with HTTP `200 OK`.

### Verification Output:
```text
✔ R3.1-05: Trazabilidad y Procedencia End-to-End de Autenticación OMR (1337.1544ms)
ℹ tests 15
ℹ suites 1
ℹ pass 15
ℹ fail 0
ℹ duration_ms 3093.3045
```

---

## 5. CONCLUSION

Remediation R3.1-05 is completely implemented, verified, and operational. All OMR endpoints require cryptographic authentication, granular RBAC permissions, and strict IDOR protection.

