# WORSHIP STUDIO — WP-01 FORMAL EXIT GATE SIGN-OFF & WP-02 IMPLEMENTATION AUTHORIZATION
## Authoritative Governance Decision Record & Work Package 02 Execution Mandate

**Project:** Worship Studio  
**Organization:** Iglesia Cristiana Bethesda — Madrid, Cundinamarca, Colombia  
**Document Classification:** Authoritative Governance Decision Register & Gate Sign-Off Dossier  
**Date:** October 15, 2026  
**Decision-maker:** Project Owner (Authoritative Instruction)  
**Lead Roles:** Senior Software Architect, Backend Engineer, API Contract Specialist, Security Engineer, QA Auditor, and Repository Documentation Auditor  
**WP-01 Status:** `APPROVED BY PROJECT OWNER`  
**WP-02 Status:** `AUTHORIZED EXCLUSIVELY FOR IMPLEMENTATION`  
**Subsequent Scope Status:** `WP-03, WP-04, WP-05, PHASE 3B, PHASE 3C — STRICTLY NOT AUTHORIZED`  
**Working Branch:** `main`  
**Primary Deliverable Path:** `docs/reports/WORSHIP_STUDIO_PHASE_3A_WP01_EXIT_GATE_AND_WP02_AUTHORIZATION.md`  
**Synchronized Root Path:** `WORSHIP_STUDIO_PHASE_3A_WP01_EXIT_GATE_AND_WP02_AUTHORIZATION.md`  
**Synchronized Docs Path:** `docs/WORSHIP_STUDIO_PHASE_3A_WP01_EXIT_GATE_AND_WP02_AUTHORIZATION.md`  

---

## 1. Authoritative Project Owner Decision Record

The following formal decision is permanently registered in the canonical project governance record:

```yaml
================================================================================
FORMAL PROJECT OWNER DECISION REGISTER
================================================================================
Project: Worship Studio
Decision-maker: Project Owner
Decision: APPROVE WP-01 EXIT GATE AND AUTHORIZE WP-02 EXCLUSIVELY
Date: October 15, 2026
Observations: None

Work Package Allocations:
  WP-01 (Database Schema, Migration, Repository): APPROVED
  WP-02 (Fastify REST API, Zod Validation, Auth Endpoints): AUTHORIZED FOR IMPLEMENTATION
  WP-03 (Visual Identity & Saxophone Emblem Header Integration): NOT AUTHORIZED
  WP-04 (Frontend Workspace Integration & Preference Persistence): NOT AUTHORIZED
  WP-05 (End-to-End Golden Verification & Phase 3A Closure): NOT AUTHORIZED
  Phases 3B, 3C, and Subsequent Roadmap Phases: STRICTLY NOT AUTHORIZED
================================================================================
```

---

## 2. WP-01 Exit Gate Verification & Baseline Confirmation

The Project Owner has reviewed and approved the evidence documented in:
- `WORSHIP_STUDIO_PHASE_3A_WP01_IMPLEMENTATION_REPORT.md` (SHA-256: `867d2e4340dd89c85103550ba322d4cbfff7af2cd18cd66efd06cf7e5a4d12a9`)

### 2.1 Re-verified WP-01 Artefacts:
1. **Drizzle ORM Schema:** `backend/src/db/schema.ts` defining `userViewPreferences`, unique index `idx_user_view_preferences_user_id`, secondary index `idx_user_view_preferences_instrument_id`, and cascading foreign key `onDelete: 'cascade'`.
2. **Versioned SQL Migration:** `backend/src/db/migrations/0004_user_view_preferences.sql` and journal `backend/src/db/migrations/meta/_journal.json` (idx 4).
3. **Database Migration Execution:** Migration successfully applied to PostgreSQL instance.
4. **Repository Implementation:** `backend/src/repositories/user-preferences-repository.ts` implementing atomic upsert (`ON CONFLICT ("user_id") DO UPDATE`).
5. **Integration Test Suite:** `backend/src/__tests__/user-preferences-repository.test.ts` (7/7 tests passing).
6. **Regression Baseline:** 199 backend tests passing (47 suites), 268 frontend tests passing (43 suites), 0 typecheck errors.

---

## 3. WP-02 Authorized Implementation Scope & Boundary Rules

### 3.1 Scope of WP-02
Under this exclusive authorization, development is authorized to execute:
1. **Zod Validation Schemas (`backend/src/interfaces/http/schemas/user-preferences.schemas.ts`):**
   - Validation for `instrumentId`, `primaryRepresentation`, `secondaryRepresentations`, `chordNotationSystem`, `transpositionSemitones` ($-12$ to $+12$), `capoFret` ($0$ to $12$), and `clefOverride` (enum: 6 values, nullable and optional).
   - Cross-field compatibility refinement ensuring requested representations match the instrument's supported capabilities.
2. **Fastify REST API Routes (`backend/src/interfaces/http/routes/user-preferences.routes.ts`):**
   - `GET /api/v1/users/me/preferences`: Authenticated endpoint returning user preferences or computing canonical factory defaults based on user role (`request.user.sub`).
   - `PUT /api/v1/users/me/preferences`: Authenticated endpoint updating user preferences using `request.user.sub` for strict IDOR elimination.
   - Application of approved factory defaults:
     - `ADMIN` & `SUPER_ADMIN`: `acoustic_guitar`, `CHORDS`, `['LYRICS']` (DEC-03 Option A).
     - `WORSHIP_LEADER`: `acoustic_guitar`, `CHORDS`, `['LYRICS']` (DEC-04 Option A).
     - `VIEWER`: `lead_vocal`, `LYRICS`, `['CHORDS']` (DEC-05 Option A).
     - `MUSICIAN`: `acoustic_guitar`, `CHORDS`, `['LYRICS']` (DEC-02).
3. **Route Mounting & Integration:**
   - Registration within the Fastify API v1 routing pipeline.
4. **Automated Integration Testing:**
   - Creation of `backend/src/__tests__/user-preferences-api.test.ts` testing authentication, validation errors, role-based defaults, upsert persistence, and cross-user isolation (anti-IDOR).
   - Full regression suite execution (backend and frontend).

### 3.2 Prohibited Actions (Strict Boundaries)
- **NO WP-03 visual branding work:** Do not touch `frontend/src/App.tsx`, `index.css`, or graphic assets.
- **NO WP-04 frontend state integration:** Do not touch `use-musical-workspace.ts` or client API connectors.
- **NO WP-05 closure:** Do not sign off on Phase 3A until WP-02, WP-03, WP-04, and WP-05 are sequentially executed and gated.
- **NO unapproved dependencies:** No new npm packages may be installed.
- **NO music theory alterations:** Zero changes to `frontend/src/core/music-theory/` or canonical model.
- **NO automatic progression:** Stop immediately upon completing WP-02 and present the WP-02 Exit Gate to the Project Owner.
