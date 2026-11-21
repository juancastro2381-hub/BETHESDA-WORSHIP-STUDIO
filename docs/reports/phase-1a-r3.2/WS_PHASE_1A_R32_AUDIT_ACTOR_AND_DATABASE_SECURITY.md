# WORSHIP STUDIO — PHASE 1A-R3.2 TECHNICAL REPORT
## AUDIT ACTOR PROVENANCE & DATABASE LEAST PRIVILEGE SECURITY

**Project:** Bethesda Worship Studio  
**Repository:** https://github.com/juancastro2381-hub/BETHESDA-WORSHIP-STUDIO.git  
**Working Branch:** `feature/phase-1a-core-foundation`  
**Phase:** 1A-R3.2  
**Deliverable ID:** WS-1A-R3.2-DOC-02  
**Date:** 2026-11-03  
**Status:** Completed & Verified  

---

## 1. EXECUTIVE SUMMARY

This report documents the architectural remediation and technical verification of findings **R3.2-01 (Audit Actor Provenance Integrity)** and **R3.2-02 (PostgreSQL Least Privilege & Runtime Role Security)** executed in Phase 1A-R3.2.

Prior to this phase:
1. The `recordAudit` interface in application and repository layers accepted a parameter object that could theoretically allow callers or malicious internal callers to spoof the audit actor ID or bypass provenance derivation.
2. The runtime database role configuration did not strictly enforce the separation between migration/DBA privileges and application runtime privileges, presenting a risk of superuser/DBA execution in production. Furthermore, SQL provisioning scripts contained placeholder passwords that could fail in strict environments or pose credential hazards.

Following Phase 1A-R3.2:
- Strict actor provenance is enforced at compile-time (`userId?: never`), runtime DTO inspection (rejecting extraneous `userId` properties), and application service authorization (verifying ownership and stamping `requestingUser.id`).
- PostgreSQL runtime least-privilege architecture is enforced via environment separation (`MIGRATION_DATABASE_URL` vs. `DATABASE_URL`), runtime startup assertions (`assertNonSuperuserRuntimeRole`), parameterized provisioning scripts, explicit per-table grants, and immutability triggers.

---

## 2. AUDIT ACTOR PROVENANCE REMEDIATION (R3.2-01)

### 2.1 Problem Analysis
In audit logging systems, actor identity must never be trusted from untrusted input or mutable caller DTOs. If an audit function signature allows a caller to specify `userId`, a flawed route or compromised service could forge audit trails, attributing sensitive actions (such as OMR measure edits or approvals) to other users.

### 2.2 Domain DTO Hardening
In `backend/src/domain/omr/types.ts`, the audit creation input was refactored into a dedicated type:

```typescript
export interface CreateOmrAuditEntryInput {
  proposalId: string;
  action: string;
  measureNumber?: number;
  previousValue?: Record<string, unknown>;
  newValue?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  /**
   * userId is strictly forbidden in the caller input.
   * Actor identity is derived exclusively from the authenticated session context (requestingUser).
   */
  userId?: never;
}
```

By typing `userId?: never`, TypeScript emits a compile-time error if any caller attempts to supply `userId`.

### 2.3 Application & Repository Runtime Defense
Compile-time types in TypeScript are erased at runtime. Therefore, defense-in-depth requires strict runtime rejection.

In `backend/src/repositories/omr-proposal-repository.ts`:
```typescript
async recordAudit(entry: CreateOmrAuditEntryInput, requestingUser: AuthenticatedUser): Promise<void> {
  // Runtime defense: Reject caller-supplied userId property to prevent actor spoofing
  if ('userId' in (entry as unknown as Record<string, unknown>) && (entry as any).userId !== undefined) {
    throw new ValidationError(
      'Audit entry must not contain caller-supplied userId. Actor identity is derived strictly from authenticated user context.'
    );
  }

  // Precondition: requestingUser must be authenticated with valid ID
  if (!requestingUser || !requestingUser.id) {
    throw new ValidationError('Authenticated user context is required to record audit events');
  }

  // Verify proposal exists and user has authorization
  const proposal = await this.findById(entry.proposalId);
  if (!proposal) {
    throw new NotFoundError(`OMR Proposal '${entry.proposalId}' not found`);
  }

  const isOwner = proposal.userId === requestingUser.id;
  const isPrivileged = requestingUser.role === 'ADMIN' || requestingUser.role === 'DIRECTOR';
  if (!isOwner && !isPrivileged) {
    throw new ForbiddenError('You do not have permission to record audit events for this proposal');
  }

  await this.db.insert(omrAuditHistory).values({
    id: crypto.randomUUID(),
    proposalId: entry.proposalId,
    userId: requestingUser.id, // Strictly derived from session context
    action: entry.action,
    measureNumber: entry.measureNumber ?? null,
    previousValue: entry.previousValue ? JSON.stringify(entry.previousValue) : null,
    newValue: entry.newValue ? JSON.stringify(entry.newValue) : null,
    metadata: entry.metadata ? JSON.stringify(entry.metadata) : null,
    createdAt: new Date(),
  });
}
```

### 2.4 Verification Results
- **Compile-time check:** `npm run typecheck` verified 0 errors across backend.
- **Runtime rejection test:** Unit test `17.2` in `omr-persistence-and-integrity.test.ts` passed:
  ```typescript
  await assert.rejects(
    async () => omrRepo.recordAudit({ proposalId, action: 'TEST', userId: spoofedId } as any, user),
    (err: Error) => err instanceof ValidationError && err.message.includes('must not contain caller-supplied userId')
  );
  ```
- **Session attribution test:** Unit test `17.3` confirmed the inserted record in PostgreSQL matched `requestingUser.id` exactly.
- **Ownership enforcement test:** Unit test `17.4` confirmed ordinary users cannot record audit events on proposals belonging to other users (`ForbiddenError`).

---

## 3. POSTGRESQL LEAST PRIVILEGE & RUNTIME ROLE SECURITY (R3.2-02)

### 3.1 Dual-Role Architecture
A foundational database security requirement is the separation of administrative duties (DDL, schema migrations, table creation, trigger alterations) from application execution duties (DML: `SELECT`, `INSERT`, `UPDATE`, `DELETE`).

Bethesda Worship Studio enforces two distinct roles:
1. **Migration / DBA Role (`postgres` or designated DDL administrator):**
   - Used exclusively by `drizzle-kit` and `backend/src/db/migrate.ts`.
   - Supplied via `MIGRATION_DATABASE_URL` (optional in local dev, strictly required in production).
2. **Application Runtime Role (`bethesda_app_runtime`):**
   - Used by the running Fastify application via `DATABASE_URL`.
   - Must NOT be a superuser (`rolsuper = false`).
   - Must NOT have `CREATEROLE` or `CREATEDB`.
   - Restricted to explicit DML privileges on specific tables.
   - Strictly forbidden from `UPDATE`, `DELETE`, `TRUNCATE` on `omr_audit_history`.

### 3.2 Dual-Credential Implementation
In `backend/src/config/env.ts`:
```typescript
export const envSchema = z.object({
  DATABASE_URL: z.string().url(),
  MIGRATION_DATABASE_URL: z.string().url().optional(),
  // ...
});
```

In `backend/src/db/migrate.ts`:
```typescript
const migrationDbUrl = env.MIGRATION_DATABASE_URL || env.DATABASE_URL;
const migrationPool = new Pool({
  connectionString: migrationDbUrl,
  max: 2,
});
const migrationDb = drizzle(migrationPool);
// runs migrations, logs status, closes pool cleanly
```

### 3.3 Startup Runtime Role Superuser Assertion
In `backend/src/db/index.ts`, a startup security check was added to verify that the runtime connection is not running as a PostgreSQL superuser:

```typescript
export async function assertNonSuperuserRuntimeRole(): Promise<void> {
  const client = await pool.connect();
  try {
    const res = await client.query<{ rolsuper: boolean; rolname: string }>(
      'SELECT rolsuper, rolname FROM pg_roles WHERE rolname = CURRENT_USER'
    );
    const role = res.rows[0];
    if (role && role.rolsuper) {
      if (process.env.NODE_ENV === 'production') {
        throw new Error(
          `FATAL SECURITY VIOLATION: Bethesda Worship Studio backend is running as superuser '${role.rolname}'. Production requires an unprivileged runtime role (bethesda_app_runtime).`
        );
      } else {
        console.warn(
          `[SECURITY WARNING] Application connected as superuser '${role.rolname}'. Ensure bethesda_app_runtime is configured for staging and production.`
        );
      }
    }
  } finally {
    client.release();
  }
}
```

### 3.4 Hardened Role Provisioning Script
The SQL provisioning script `backend/src/db/scripts/provision_app_runtime_role.sql` was refactored:
1. **No Executable Placeholder Passwords:** Replaced literal placeholder password with psql variable `:'APP_RUNTIME_PASSWORD'` and validation check:
   ```sql
   \if :{?APP_RUNTIME_PASSWORD}
     -- Variable defined, proceed
   \else
     \echo 'ERROR: APP_RUNTIME_PASSWORD variable is required.'
     \echo 'Run with: psql -v APP_RUNTIME_PASSWORD="<secure-password>" -f provision_app_runtime_role.sql'
     \q
   \endif
   ```
2. **Explicit Table Grants:** Removed broad schema grants. Granted only needed permissions:
   ```sql
   GRANT SELECT, INSERT, UPDATE, DELETE ON songs, sets, set_items, song_versions, 
         multitrack_sessions, multitrack_tracks, omr_proposals, omr_measures 
   TO bethesda_app_runtime;
   
   -- OMR Audit History: SELECT and INSERT only. UPDATE/DELETE/TRUNCATE strictly omitted!
   GRANT SELECT, INSERT ON omr_audit_history TO bethesda_app_runtime;
   GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO bethesda_app_runtime;
   ```
3. **Revocation from PUBLIC:**
   ```sql
   REVOKE ALL ON FUNCTION trg_prevent_omr_audit_modification() FROM PUBLIC;
   REVOKE ALL ON FUNCTION trg_prevent_omr_proposal_deletion_if_audited() FROM PUBLIC;
   ```

### 3.5 PostgreSQL Catalog Verification & Adversarial Testing
In test suite `omr-persistence-and-integrity.test.ts` (Section 20), 12 automated checks were executed directly against PostgreSQL:
1. **SELECT on omr_audit_history:** Allowed (audit read).
2. **INSERT on omr_audit_history:** Allowed (append-only audit).
3. **UPDATE on omr_audit_history:** Denied (permission denied / trigger rejection).
4. **DELETE on omr_audit_history:** Denied (permission denied / trigger rejection).
5. **TRUNCATE on omr_audit_history:** Denied (permission denied).
6. **DROP TABLE on omr_audit_history:** Denied (must be owner of table).
7. **ALTER TABLE on omr_audit_history:** Denied (must be owner of table).
8. **DROP TRIGGER on omr_audit_history:** Denied (must be owner of table).
9. **DISABLE TRIGGER on omr_audit_history:** Denied (must be owner of table).
10. **ALTER FUNCTION trg_prevent_omr_audit_modification:** Denied (must be owner of function).
11. **SET app.allow_audit_cleanup = 'true' + UPDATE:** Blocked by trigger even if session variable is toggled.
12. **SET app.allow_audit_cleanup = 'true' + DELETE:** Blocked by trigger even if session variable is toggled.

All 12 adversarial test cases passed against PostgreSQL 18.

---

## 4. CONCLUSION

Remediations R3.2-01 and R3.2-02 are complete, robustly tested, and verified at both application and database layers. The audit trail is strictly attributable to authenticated users and protected against tampering or role escalation.

