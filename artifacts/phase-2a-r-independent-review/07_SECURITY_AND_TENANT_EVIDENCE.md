# PHASE 2A-R — INDEPENDENT AUDIT EVIDENCE PACKAGE
# 07. SECURITY, ANTI-IDOR & TENANT ISOLATION EVIDENCE

**Project:** Bethesda Worship Studio  
**Phase:** Phase 2A-R — Conversion Center Remediation & Certification  
**Working Branch:** `feature/phase-1a-core-foundation`  
**Commit SHA:** `fa69b4e89da6d9d813771fc358463f4005819c6f`  
**Auditor / Agent:** Antigravity — Principal Software Engineer & Systems Architect  
**Evidence Generation Date:** 2026-11-07  

---

## 1. AUTHENTICATION & ACCESS CONTROL ARCHITECTURE

All stateful and resource-access endpoints in the Musical Conversion Center require strict JWT authentication verified by [`AuthGuard`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/backend/src/interfaces/http/middlewares/auth-middleware.ts) and [`extractAuthenticatedUser()`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/backend/src/interfaces/http/routes/conversion.routes.ts#L76-L85).

### Identity Extraction Method
- **Source File:** [`backend/src/interfaces/http/routes/conversion.routes.ts`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/backend/src/interfaces/http/routes/conversion.routes.ts#L76-L85)
```typescript
function extractAuthenticatedUser(request: any): AuthenticatedUser {
  if (!request.user || (!request.user.sub && !request.user.id)) {
    throw new UnauthorizedError('Autenticación requerida para acceder a este recurso.');
  }
  return {
    id: request.user.sub || request.user.id,
    role: request.user.role,
    email: request.user.email,
  };
}
```
This correctly resolves standard JWT claims where the user UUID is placed in the `sub` claim.

---

## 2. ENDPOINT SECURITY & AUTHORIZATION MATRIX

| Endpoint | HTTP Method | Authentication | Authorization Rule | Anti-IDOR Enforcement |
| :--- | :---: | :---: | :--- | :--- |
| `/api/v1/conversion/validate` | `POST` | Public | None (in-memory format matrix validation) | N/A (Stateless) |
| `/api/v1/conversion/transpile` | `POST` | Public | None (immediate in-memory transpile) | N/A (Stateless) |
| `/api/v1/conversion/jobs` | `POST` | Required | Any authenticated user | Creates job strictly bound to `user.id` |
| `/api/v1/conversion/jobs` | `GET` | Required | Authenticated user | Queries `findJobsByUserId(user.id)` |
| `/api/v1/conversion/jobs/:jobId` | `GET` | Required | Job Owner or (`ADMIN` / `SUPER_ADMIN`) | `job.userId === user.id` enforced |
| `/api/v1/conversion/jobs/:jobId/retry` | `POST` | Required | Job Owner or (`ADMIN` / `SUPER_ADMIN`) | `job.userId === user.id` enforced |
| `/api/v1/conversion/jobs/:jobId/cancel` | `POST` | Required | Job Owner or (`ADMIN` / `SUPER_ADMIN`) | `job.userId === user.id` enforced |
| `/api/v1/conversion/jobs/:jobId/download` | `GET` | Required | Job Owner or (`ADMIN` / `SUPER_ADMIN`) | `job.userId === user.id` enforced |
| `/api/v1/conversion/jobs/:jobId/commit` | `POST` | Required | Job Owner or (`ADMIN` / `SUPER_ADMIN`) | `job.userId === user.id` enforced |

---

## 3. ANTI-IDOR IMPLEMENTATION EVIDENCE

Anti-IDOR protection is enforced centrally in [`ConversionJobService.getJob()`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/backend/src/application/conversion-job-service.ts#L74-L88):
```typescript
public async getJob(jobId: string, user: AuthenticatedUser): Promise<BackgroundJobRow> {
  const job = await this.jobRepo.findJobById(jobId);
  if (!job) {
    throw new NotFoundError('Trabajo de conversión', jobId);
  }
  const isOwner = job.userId === user.id;
  const isPrivileged = user.role === 'ADMIN' || user.role === 'SUPER_ADMIN';
  if (!isOwner && !isPrivileged) {
    throw new ForbiddenError('No tienes autorización para consultar este trabajo de conversión.');
  }
  return job;
}
```

Because `cancelJob`, `retryJob`, `download`, and `commitJobToCatalog` all delegate to `this.getJob(jobId, user)`, it is architecturally impossible for a standard user to view, cancel, retry, download, or commit another user's job.

### Automated Test Evidence (`backend/src/__tests__/conversion-security.test.ts`)
- **Test 1:** `GET /jobs/:id` with non-owner token $\rightarrow$ `403 Forbidden`.
- **Test 2:** `POST /jobs/:id/cancel` with non-owner token $\rightarrow$ `403 Forbidden`.
- **Test 3:** `POST /jobs/:id/retry` with non-owner token $\rightarrow$ `403 Forbidden`.
- **Test 4:** `GET /jobs/:id/download` with non-owner token $\rightarrow$ `403 Forbidden`.
- **Test 5:** `POST /jobs/:id/commit` with non-owner token $\rightarrow$ `403 Forbidden`.
- **Test 6:** `GET /jobs` listing $\rightarrow$ User A sees only User A's jobs (isolated result sets).
- **Test 7:** Privileged access $\rightarrow$ `ADMIN` role is allowed to inspect any user's job.

---

## 4. INPUT VALIDATION & FILE SIZE ENFORCEMENT

### Zod Schema Hardening
- **Filename Validation:** `z.string().min(1).max(255)`
- **Base64 Payload Ceiling:** Enforced via `MAX_OMR_BASE64_LENGTH = 20,971,520` bytes (corresponding to 15 MiB raw binary).
- **Musical Parameter Constraints:**
  - `transposeSemitones`: Integer between `-24` and `+24`.
  - `bpmOverride`: Integer between `20` and `300`.
  - `keyOverride`: String max length `10`.
  - `timeSignatureOverride`: String max length `10`.

---

## 5. TENANT ISOLATION & HARDCODED VALUES DISCLOSURE

> [!IMPORTANT]
> **Audit Disclosure on Tenant Identification:**
> In `backend/src/application/conversion-job-service.ts`:
> - Line 173: `tenantId: 'bethesda-default'`
> - Line 264: `tenantId: 'bethesda-default'`
> 
> In the current database schema, isolation is enforced at the **User boundary** (`user_id = user.id`). The application does not yet have a multi-tenant relational column (`community_id` or `tenant_id`) in the `users` or `background_jobs` table. The string `'bethesda-default'` is passed as a payload attribute to `pg-boss` to preserve future multi-tenancy compatibility. True multi-tenancy boundaries are currently coextensive with User account ownership boundaries.

