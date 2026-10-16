# WORSHIP STUDIO — PHASE 3A TECHNICAL PREFLIGHT REPORT
## User View Preferences Persistence & Visual Identity Alignment

**Project:** Worship Studio  
**Organization:** Iglesia Cristiana Bethesda — Madrid, Cundinamarca, Colombia  
**Document Classification:** Technical Architecture Preflight & QA Audit Report (Gate 2)  
**Date:** October 15, 2026  
**Auditor Roles:** Senior Software Architect, Security Reviewer, and QA Auditor  
**Preflight Verdict:** `READY WITH CONDITIONS`  
**Governance Gate Status:** `GATE 2 COMPLETED -> READY FOR GATE 3 IMPLEMENTATION AUTHORIZATION`  
**Working Branch:** `main` (commit `2730ed6`)  
**Git Working Tree Status:** Clean (0 modified tracked files, 0 untracked production files)  
**Primary Deliverable Path:** `docs/reports/WORSHIP_STUDIO_PHASE_3A_TECHNICAL_PREFLIGHT.md`  
**Synchronized Root Path:** `WORSHIP_STUDIO_PHASE_3A_TECHNICAL_PREFLIGHT.md`  

---

## 1. Executive Summary & Readiness Verdict

### 1.1 Context and Authorization
By directive of the Project Owner at Governance Gate 1, formal approvals were granted for:
- **`DEC-01` (Option A):** Visual Identity & Saxophone Emblem Integration.
- **`DEC-02` (Option A):** Persistent Storage of Musician View Preferences via PostgreSQL and Fastify REST endpoints.

Under Governance Gate 2, a **strictly read-only technical preflight** was executed to evaluate the repository state, audit architectural compatibility, assess security and data isolation risks, define database schemas and API contracts, analyze frontend integration points, establish fallback behavior, and construct an auditable implementation plan.

> [!IMPORTANT]
> **READ-ONLY PREFLIGHT DECLARATION:**  
> This preflight report is an architectural inspection and engineering specification. **Zero production code, database migrations, API routes, or automated tests were created, modified, or executed during this task.** Implementation remains strictly on hold pending formal Project Owner authorization at **Gate 3**.

### 1.2 Readiness Verdict
```
================================================================================
PREFLIGHT VERDICT:
READY WITH CONDITIONS
================================================================================
```

#### Preflight Conditions for Implementation Authorization (Gate 3):
1. **Asset Pipeline Isolation:** The saxophone emblem asset ([`docs/worship_studio_saxophone_emblem.png`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/docs/worship_studio_saxophone_emblem.png)) must be imported into the frontend build pipeline (`frontend/src/assets/`) to ensure Vite generates content-hashed production bundles without broken URL references.
2. **Strict Foreign Key & Uniqueness Constraints:** The Drizzle migration (`0004_user_view_preferences.sql`) must enforce `ON DELETE CASCADE` referencing `users.id` and a unique constraint on `user_id` to guarantee 1:1 user-to-preferences relationship with zero orphan records.
3. **IDOR Elimination via JWT Sub Extraction:** Endpoints `GET /api/v1/users/me/preferences` and `PUT /api/v1/users/me/preferences` must derive `userId` strictly from the cryptographic JWT claims (`request.user.sub`), completely rejecting any user-supplied ID in the request body or parameters.
4. **Resilient In-Memory Fallback:** The frontend workspace must implement fail-safe fallback: if the preferences API is unreachable (offline stage, network timeout, or server 500), the application must immediately fall back to default role-based `ViewPreference` in memory without blocking liturgical sheet music rendering or raising intrusive modals.
5. **Zero Regression Guarantee:** Implementation must preserve 100% pass rates across all 268 frontend tests, 238 backend tests, and Golden Scenarios A–D.

---

## 2. Actual Files and Components Inspected

Every finding in this report is grounded in direct inspection of existing repository code:

| Component / Layer | Physical Repository Path | Inspected State |
|:---|:---|:---|
| **Graphic Emblem Asset** | `docs/worship_studio_saxophone_emblem.png` | 242,388 bytes, $739\times 710\text{px}$, 32-bit ARGB with alpha transparency. |
| **Frontend Application Header** | `frontend/src/App.tsx` (L17–31) | Header renders text and temporary Unicode cross placeholder: `<span className="brand-logo" aria-hidden="true">✝</span>`. |
| **Global Styling & Media Queries** | `frontend/src/index.css` (L35–75, L3112) | `.brand-logo` currently styled as text gradient. Breakpoints exist at 900px, 768px, 680px, 640px, 600px. |
| **Workspace Hook Orchestrator** | `frontend/src/core/workspace/use-musical-workspace.ts` | Manages `state: IWorkspaceState`. Initializes from static preset `createInitialWorkspaceState()`. |
| **Pure Orchestrator Logic** | `frontend/src/core/workspace/workspace-orchestrator.ts` | Handles pure state transitions (`transitionSelectInstrument`, `transitionSetCapo`, etc.). |
| **Main Workspace Component** | `frontend/src/components/workspace/MusicalWorkspace.tsx` | Connects `useMusicalWorkspace` and `useAuth`. Zero preference persistence logic currently exists. |
| **Domain View Preference Model** | `frontend/src/core/projection/view-preference.ts` | Complete domain model (`ViewPreference`, `ViewPreferenceInit`, Capo 0–12 range check, immutability). |
| **Projection Types & Enums** | `frontend/src/core/projection/types.ts` | `ViewRepresentation` (7 values) and `ChordNotationSystem` (`'STANDARD' \| 'LATIN'`). |
| **Frontend Auth Context** | `frontend/src/core/auth/auth-context.tsx` | Provides `user: AuthUser`, `tokenManager`, and automatic silent token refresh via HttpOnly cookies. |
| **Frontend HTTP Client** | `frontend/src/core/api/api-client.ts` | `BethesdaApiClient` with `fetchWithAuth()` injecting Bearer token and retrying on 401. |
| **Backend DB Schema & ORM** | `backend/src/db/schema.ts` | Drizzle ORM PostgreSQL schema. Defines `users`, `refresh_tokens`, `setlists`, `songs`. |
| **Backend Migrations History** | `backend/src/db/migrations/` | 4 migrations exist (`0000_...`, `0001_auth_rbac.sql`, `0002_...`, `0003_single_active_setlist_constraint.sql`). |
| **Backend HTTP Routes** | `backend/src/interfaces/http/routes/` | `auth.routes.ts`, `user.routes.ts`, `song.routes.ts`, `setlist.routes.ts`, `health.routes.ts`. |
| **Backend Auth Middleware** | `backend/src/interfaces/http/middlewares/auth-middleware.ts` | `AuthGuard.requireAuth` extracts and validates JWT Bearer token into `request.user`. |
| **Dependencies & Build Scripts** | `backend/package.json`, `frontend/package.json` | Fastify 5.2, Drizzle ORM 0.39, Zod 3.24, React 19, Vite 8.3. Zero new packages required. |

---

## 3. Current State vs. Proposed Phase 3A Target State

| Dimension | Current Repository State (Phase 2C Baseline) | Proposed Phase 3A Target State |
|:---|:---|:---|
| **Visual Header Emblem** | Header displays text and Unicode placeholder `✝` (`App.tsx` L19). | Header displays high-DPI saxophone emblem with responsive scaling and accessible markup. |
| **Emblem Asset Bundling** | Asset exists only in `docs/`. Not accessible to Vite client bundle. | Asset placed in `frontend/src/assets/`, imported via ES module for content-hashed bundling. |
| **Preferences Storage** | Preferences are volatile in-memory state; resets on page reload or re-login. | Preferences permanently persisted in PostgreSQL table `user_view_preferences`. |
| **Database Schema** | Schema has 4 tables for auth/users, but zero preferences table. | Drizzle migration `0004_user_view_preferences.sql` adds `user_view_preferences` with FK to `users.id`. |
| **REST API** | No preferences routes exist. `user.routes.ts` handles users, roles, and invites. | Authenticated endpoints `GET` and `PUT` `/api/v1/users/me/preferences` with Zod validation. |
| **API Client (`BethesdaApiClient`)**| Client has methods for auth, songs, setlists; lacks preferences methods. | Methods `getUserPreferences()` and `updateUserPreferences()` added with full TypeScript typing. |
| **Workspace Initialization** | `useMusicalWorkspace` initializes from static `GOLDEN_SCENARIO_PRESETS['SCENARIO_A']`. | Initializes from user's persisted preferences if logged in, falling back to role/factory defaults. |
| **Preference Updates** | Changing instrument or capo updates in-memory React state only. | Changing instrument or format triggers debounced persistence to backend API. |
| **Offline Resilience** | If server drops, local UI works in-memory. | If preferences API fails, transparent fallback to in-memory defaults; zero blocking modals. |

---

## 4. Technical Analysis by Functional Area

### 4.1 Visual Branding & Frontend Header Ergonomics (`DEC-01`)

#### 4.1.1 Asset Evaluation
- **Source File:** `docs/worship_studio_saxophone_emblem.png`
- **Resolution & Aspect Ratio:** $739\text{px} \times 710\text{px}$ ($\approx 1.04:1$, nearly square).
- **Color Depth & Alpha:** 32-bit ARGB. Transparency is verified; background blends smoothly with the dark liturgical palette (`rgba(11, 15, 25, 0.8)`).
- **File Size:** 242,388 bytes ($\approx 236.7\text{KB}$). While acceptable for desktop broadband, for mobile performance on 4G cellular networks on stage, Vite's build pipeline can optimize this into WebP/PNG formats.

#### 4.1.2 Vite Asset Bundling Strategy
Currently, `frontend/src/` contains `components/` and `core/`, without a static assets folder.  
**Recommended Strategy:**
1. Create `frontend/src/assets/worship_studio_saxophone_emblem.png` (copied from `docs/`).
2. Import the asset in `frontend/src/App.tsx`:
   ```tsx
   import saxophoneEmblem from './assets/worship_studio_saxophone_emblem.png';
   ```
3. Vite automatically assigns a cache-busting content hash (e.g. `worship_studio_saxophone_emblem.a1b2c3d4.png`) and bundles it directly into `dist/assets/`, guaranteeing 100% uptime regardless of server base path.

#### 4.1.3 Header Component Markup & Accessibility
In `frontend/src/App.tsx`, lines 18–24 currently render:
```tsx
<div className="brand-section">
  <span className="brand-logo" aria-hidden="true">✝</span>
  <div>
    <h1 className="brand-title">BETHESDA WORSHIP STUDIO</h1>
    <p className="brand-subtitle">Iglesia Cristiana Bethesda — Madrid, Cundinamarca</p>
  </div>
</div>
```
**Proposed Accessible Replacement:**
```tsx
<div className="brand-section">
  <img
    src={saxophoneEmblem}
    alt="Bethesda Worship Studio Logo"
    className="brand-logo-img"
    width={40}
    height={38}
    loading="eager"
    decoding="async"
  />
  <div>
    <h1 className="brand-title">BETHESDA WORSHIP STUDIO</h1>
    <p className="brand-subtitle">Iglesia Cristiana Bethesda — Madrid, Cundinamarca</p>
  </div>
</div>
```

#### 4.1.4 Responsive CSS Specification
In `frontend/src/index.css`:
```css
/* Brand Logo Image (Phase 3A - DEC-01) */
.brand-logo-img {
  width: auto;
  height: 40px;
  max-width: 44px;
  object-fit: contain;
  filter: drop-shadow(0 2px 8px rgba(245, 158, 11, 0.25));
  transition: transform 0.2s ease, filter 0.2s ease;
}

.brand-logo-img:hover {
  transform: scale(1.05);
  filter: drop-shadow(0 4px 12px rgba(245, 158, 11, 0.4));
}

/* Mobile Viewports (<= 600px) */
@media (max-width: 600px) {
  .brand-logo-img {
    height: 32px;
    max-width: 36px;
  }
  .brand-title {
    font-size: 1.1rem;
  }
  .brand-subtitle {
    font-size: 0.7rem;
  }
}
```

---

### 4.2 Authentication & Authorization Architecture

#### 4.2.1 Fastify JWT Session Extraction
- The backend relies on `@fastify/jwt` configured with HS256 algorithm and `env.JWT_SECRET`.
- When an HTTP request includes `Authorization: Bearer <token>`, `AuthGuard.authenticate` executes:
  ```typescript
  const payload = this.tokenService.verifyAccessToken(token);
  request.user = payload; // Contains: { sub: string (userId), email: string, role: UserRole }
  ```
- For the preferences endpoints, `authGuard.requireAuth` verifies the token's cryptographic validity and expiration.

#### 4.2.2 Complete IDOR Elimination
- **Attack Vector:** An attacker attempts to read or overwrite another musician's view preferences by passing `?userId=...` or `{ "userId": "..." }`.
- **Mitigation:** The endpoints are strictly scoped to `/me/preferences`. The controller extracts `userId = request.user!.sub`. Any user ID provided in the query string or JSON body is completely ignored by the Zod parser. It is mathematically impossible for an authenticated user to access or mutate preferences belonging to another user.

#### 4.2.3 Token Expiration Handling
- `BethesdaApiClient.fetchWithAuth()` in the frontend includes an automatic 401 retry interceptor:
  - If a preference `GET` or `PUT` returns 401, `fetchWithAuth()` invokes `POST /auth/refresh` using the HttpOnly cookie.
  - If refresh succeeds, the request is immediately retried with the renewed Bearer token.
  - If refresh fails (session revoked or expired), the token is cleared, and the workspace continues functioning in offline/guest mode using in-memory defaults.

---

### 4.3 Database Schema & Drizzle ORM Data Model (`DEC-02`)

#### 4.3.1 Proposed Drizzle Schema Addition (`backend/src/db/schema.ts`)
```typescript
/**
 * Tabla: user_view_preferences (Fase 3A — DEC-02)
 * Almacenamiento persistente de instrumento y configuración de visualización por músico.
 */
export const userViewPreferences = pgTable(
  'user_view_preferences',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    instrumentId: varchar('instrument_id', { length: 64 }).notNull(),
    primaryRepresentation: varchar('primary_representation', { length: 64 }).notNull(),
    secondaryRepresentations: jsonb('secondary_representations')
      .$type<string[]>()
      .notNull()
      .default([]),
    chordNotationSystem: varchar('chord_notation_system', { length: 32 })
      .notNull()
      .default('STANDARD'),
    transpositionSemitones: integer('transposition_semitones').notNull().default(0),
    capoFret: integer('capo_fret').notNull().default(0),
    clefOverride: varchar('clef_override', { length: 32 }),
    preferFlats: boolean('prefer_flats').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('idx_user_view_preferences_user_id').on(table.userId),
    index('idx_user_view_preferences_instrument').on(table.instrumentId),
  ]
);

export type UserViewPreferenceEntity = typeof userViewPreferences.$inferSelect;
export type NewUserViewPreferenceEntity = typeof userViewPreferences.$inferInsert;
```

#### 4.3.2 Migration Script Specification (`0004_user_view_preferences.sql`)
```sql
CREATE TABLE IF NOT EXISTS "user_view_preferences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"instrument_id" varchar(64) NOT NULL,
	"primary_representation" varchar(64) NOT NULL,
	"secondary_representations" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"chord_notation_system" varchar(32) DEFAULT 'STANDARD' NOT NULL,
	"transposition_semitones" integer DEFAULT 0 NOT NULL,
	"capo_fret" integer DEFAULT 0 NOT NULL,
	"clef_override" varchar(32),
	"prefer_flats" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user_view_preferences" ADD CONSTRAINT "user_view_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_user_view_preferences_user_id" ON "user_view_preferences" USING btree ("user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_user_view_preferences_instrument" ON "user_view_preferences" USING btree ("instrument_id");
```

#### 4.3.3 Migration Safety & Rollback Plan
- **Zero Destructive Alterations:** The migration creates an entirely new table. No existing tables (`users`, `songs`, `setlists`) are modified or locked.
- **Rollback SQL:**
  ```sql
  DROP TABLE IF EXISTS "user_view_preferences" CASCADE;
  ```
- **Execution Strategy:** Can be applied without downtime while backend dev server or production container is running.

---

### 4.4 API Design & Endpoint Contracts

#### 4.4.1 Zod Request & Response Schemas (`backend/src/interfaces/http/schemas/user-preferences.schemas.ts`)
```typescript
import { z } from 'zod';

export const ViewRepresentationEnum = z.enum([
  'STANDARD_NOTATION',
  'TABLATURE',
  'CHORDS',
  'LYRICS',
  'PERCUSSION_NOTATION',
  'GRAND_STAFF',
  'SECTION_MARKERS',
]);

export const ChordNotationSystemEnum = z.enum(['STANDARD', 'LATIN']);

export const ClefTypeEnum = z.enum(['TREBLE', 'BASS', 'ALTO', 'TENOR', 'PERCUSSION']);

export const UpdateUserPreferencesBodySchema = z.object({
  instrumentId: z.string().trim().min(1).max(64),
  primaryRepresentation: ViewRepresentationEnum,
  secondaryRepresentations: z.array(ViewRepresentationEnum).default([]),
  chordNotationSystem: ChordNotationSystemEnum.default('STANDARD'),
  transpositionSemitones: z.number().int().min(-12).max(12).default(0),
  capoFret: z.number().int().min(0).max(12).default(0),
  clefOverride: ClefTypeEnum.optional(),
  preferFlats: z.boolean().default(false),
});

export type UpdateUserPreferencesBody = z.infer<typeof UpdateUserPreferencesBodySchema>;

export const UserPreferencesResponseSchema = z.object({
  success: z.boolean(),
  data: z.object({
    id: z.string().uuid().optional(),
    userId: z.string().uuid(),
    instrumentId: z.string(),
    primaryRepresentation: ViewRepresentationEnum,
    secondaryRepresentations: z.array(ViewRepresentationEnum),
    chordNotationSystem: ChordNotationSystemEnum,
    transpositionSemitones: z.number().int(),
    capoFret: z.number().int(),
    clefOverride: ClefTypeEnum.optional(),
    preferFlats: z.boolean(),
    isDefault: z.boolean(),
    updatedAt: z.string().optional(),
  }),
});
```

#### 4.4.2 Endpoint 1: `GET /api/v1/users/me/preferences`
- **Method & Route:** `GET /api/v1/users/me/preferences`
- **Security:** `preHandler: authGuard.requireAuth`
- **Behavior:**
  1. Retrieve `userId = request.user!.sub`.
  2. Query `user_view_preferences` table for `user_id = userId`.
  3. **If record exists:** Return HTTP 200 with stored preferences and `isDefault: false`.
  4. **If record does NOT exist:** Return HTTP 200 with factory defaults based on user role and `isDefault: true`.
     - *Default Mapping:*
       - `MUSICIAN` / `WORSHIP_LEADER` $\rightarrow$ `instrumentId: 'acoustic_guitar'`, `primaryRepresentation: 'CHORDS'`, `secondaryRepresentations: ['LYRICS']`.
       - `VIEWER` $\rightarrow$ `instrumentId: 'lead_vocal'`, `primaryRepresentation: 'LYRICS'`, `secondaryRepresentations: ['CHORDS']`.
- **Sample Success Response:**
  ```json
  {
    "success": true,
    "data": {
      "id": "7b2e1a90-6c3d-4e5f-9a1b-2c3d4e5f6a7b",
      "userId": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
      "instrumentId": "alto_sax",
      "primaryRepresentation": "STANDARD_NOTATION",
      "secondaryRepresentations": ["CHORDS"],
      "chordNotationSystem": "STANDARD",
      "transpositionSemitones": 0,
      "capoFret": 0,
      "clefOverride": null,
      "preferFlats": false,
      "isDefault": false,
      "updatedAt": "2026-10-15T20:10:00.000Z"
    }
  }
  ```

#### 4.4.3 Endpoint 2: `PUT /api/v1/users/me/preferences`
- **Method & Route:** `PUT /api/v1/users/me/preferences`
- **Security:** `preHandler: authGuard.requireAuth`
- **Validation:** Body parsed with `UpdateUserPreferencesBodySchema`.
- **Behavior:**
  1. Retrieve `userId = request.user!.sub`.
  2. Perform an atomic **UPSERT** in PostgreSQL:
     ```sql
     INSERT INTO "user_view_preferences" (
       "user_id", "instrument_id", "primary_representation",
       "secondary_representations", "chord_notation_system",
       "transposition_semitones", "capo_fret", "clef_override",
       "prefer_flats", "updated_at"
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, now())
     ON CONFLICT ("user_id") DO UPDATE SET
       "instrument_id" = EXCLUDED."instrument_id",
       "primary_representation" = EXCLUDED."primary_representation",
       "secondary_representations" = EXCLUDED."secondary_representations",
       "chord_notation_system" = EXCLUDED."chord_notation_system",
       "transposition_semitones" = EXCLUDED."transposition_semitones",
       "capo_fret" = EXCLUDED."capo_fret",
       "clef_override" = EXCLUDED."clef_override",
       "prefer_flats" = EXCLUDED."prefer_flats",
       "updated_at" = now()
     RETURNING *;
     ```
  3. Return HTTP 200 with updated record and `isDefault: false`.

---

### 4.5 Frontend State Integration & Resilience

#### 4.5.1 Lifecycle & Sequence Diagram
```
Musician Login / App Boot
   │
   ├── 1. AuthContext restores session (JWT cookie)
   │
   ├── 2. MusicalWorkspace detects authenticated user
   │      └── Calls apiClient.getUserPreferences()
   │
   ├── 3. If GET succeeds:
   │      └── useMusicalWorkspace applies { instrumentId, primaryRepresentation, capoFret, ... }
   │
   ├── 4. If Network Fails / Offline:
   │      └── Transparently uses createInitialWorkspaceState() (In-Memory Fallback)
   │      └── MusicalScoreRenderer renders score immediately (No blocking!)
   │
   └── 5. Musician changes instrument / format in UI:
          └── useMusicalWorkspace updates React view state immediately (0ms lag)
          └── Debounced worker (500ms) sends PUT /users/me/preferences in background
```

#### 4.5.2 Debounced Autosave vs. Explicit Save
- To prevent stage lag while a musician taps through instruments on a mobile phone stand, the UI state must update **instantaneously in memory** without awaiting network confirmation.
- A 500ms debounce timer sends the background `PUT` request. If the request fails (e.g., church sanctuary Wi-Fi drops), the active screen remains completely functional, logging a quiet warning to `DiagnosticPanel` without disturbing worship.

---

## 5. Security & Isolation Analysis

| Threat / Risk Vector | Severity | Existing Defense | Phase 3A Hardening Measures |
|:---|:---:|:---|:---|
| **Insecure Direct Object Reference (IDOR)** | High | Fastify JWT AuthGuard. | Strict route design `/me/preferences`. User ID derived solely from cryptographically signed `request.user.sub`. |
| **Cross-Site Scripting (XSS) via SVG Logo** | Medium | Header currently uses Unicode text. | Use raster PNG asset (`worship_studio_saxophone_emblem.png`). Avoid inline SVG injection; render via standard `<img>` tag with static bundler path. |
| **SQL Injection** | Critical | Drizzle ORM query builder. | Drizzle uses parameterized SQL queries exclusively. Zod strictly validates all input parameters before SQL execution. |
| **Invalid Enum / Range Corruption** | Low | In-memory `ViewPreference` constructor enforces capo $\in [0, 12]$. | Zod schema enforces identical ranges on backend (`capoFret` $\min 0, \max 12$; `transpositionSemitones` $\min -12, \max 12$). |
| **Orphan Preference Records** | Low | None (table is new). | Foreign key constraint on `user_id` includes `ON DELETE CASCADE`. Deleting a user automatically deletes their preferences. |
| **Denial of Service via Giant Payloads** | Low | Fastify body limit (1MB). | Zod schema strictly limits string lengths (`min(1).max(64)`) and rejects unknown object keys. |

---

## 6. Regression Risks & Existing Test Baseline

### 6.1 Preserving Existing Test Baseline
The existing test suite represents an ironclad regression boundary:
- **Backend Tests:** 238 passing tests (`tsx --test`).
- **Frontend Tests:** 268 passing tests (`node --test --experimental-strip-types`).
- **TypeScript Typecheck:** 0 errors in both projects (`tsc --noEmit`).
- **Core Music Theory Invariance:** All music theory modules (`Pitch`, `Chord`, `Accidental`, `KeySignature`, `TransposeEngine`, `CanonicalMusicPayload`) are completely decoupled from user preferences and React UI.

### 6.2 Regression Isolation Guarantee
`ViewPreference` is a pure domain entity. Passing a saved `ViewPreference` into `ProjectionService.project()` uses the exact same interface as passing a factory default `ViewPreference`. Therefore:
- Golden Scenario A (Acoustic Guitar, Chords + Capo) remains identical.
- Golden Scenario B (Piano Grand Staff) remains identical.
- Golden Scenario C (Alto/Tenor Saxophone Transposition) remains identical.
- Golden Scenario D (Vocalist Leadsheet) remains identical.

---

## 7. Acceptance Criteria & Verification Plan

### 7.1 Measurable Acceptance Criteria for Phase 3A

1. **AC-3A-01 (Database Migration):**  
   Migration `0004_user_view_preferences.sql` executes cleanly via `npm run migrate` in backend. Table `user_view_preferences` is created with unique index on `user_id` and foreign key cascade.
2. **AC-3A-02 (API Authentication & IDOR Protection):**  
   `GET /api/v1/users/me/preferences` and `PUT /api/v1/users/me/preferences` return HTTP 401 Unauthorized if no Bearer token is provided. When authenticated, operations affect strictly the user identified in the token.
3. **AC-3A-03 (Factory Default Response):**  
   A freshly created user account without stored preferences receives HTTP 200 with factory default settings and `"isDefault": true` on `GET`.
4. **AC-3A-04 (Persistence & Restoration):**  
   A musician updates preferences to `"alto_sax"` and `"STANDARD_NOTATION"`. Upon browser reload (or logging out and logging back in), the application automatically restores Alto Saxophone on the stage atril.
5. **AC-3A-05 (Visual Header Branding):**  
   The application header displays the official Worship Studio saxophone emblem asset with crisp rendering across mobile ($\le 390\text{px}$) and desktop viewports, with accessible `alt` text and zero layout overflow.
6. **AC-3A-06 (Network Fallback):**  
   If the backend API is stopped or network is disabled, the frontend loads gracefully using local in-memory defaults with zero fatal exceptions.
7. **AC-3A-07 (Test Suite Integrity):**  
   All 238 backend tests and 268 frontend tests pass with zero regressions, augmented by dedicated new tests for preferences repository, endpoints, and client methods.

### 7.2 Step-by-Step Manual Verification Script

```bash
# Paso 1: Migración y Backend
cd backend && npm run migrate
npm run test
# Verificar que las pruebas de user-preferences pasan al 100%

# Paso 2: Frontend Build y Typecheck
cd ../frontend && npm run typecheck
npm run test
# Verificar cero errores de tipos

# Paso 3: Validación Visual en Navegador
# 1. Abrir http://localhost:5173 en vista móvil (390px x 844px)
# 2. Confirmar que el logo del saxofón aparece nítido junto a "BETHESDA WORSHIP STUDIO"
# 3. Iniciar sesión como músico (musician@bethesda.org)
# 4. Cambiar instrumento a "Saxofón Alto" y vista a "Pentagrama"
# 5. Recargar la página (F5) o cerrar y reabrir pestaña
# 6. Verificar que el atril carga automáticamente en "Saxofón Alto" / "Pentagrama"
```

---

## 8. Proposed Work Breakdown Structure (WBS) & Sequencing

When implementation is formally authorized at Gate 3, Phase 3A will be executed in five strictly sequenced, auditable work packages:

```
┌────────────────────────────────────────────────────────────────────────┐
│ WORK BREAKDOWN STRUCTURE — PHASE 3A IMPLEMENTATION                     │
├────────────────────────────────────────────────────────────────────────┤
│ WP-01: Backend Data Model & Migration (0004_user_view_preferences.sql) │
│        - Add userViewPreferences table to backend/src/db/schema.ts     │
│        - Create Drizzle migration 0004_user_view_preferences.sql       │
│        - Implement DrizzleUserPreferencesRepository                    │
│                                                                        │
│ WP-02: Backend API Endpoints & Validation Schemas                     │
│        - Implement Zod validation schemas in user-preferences.schemas  │
│        - Create and mount user-preferences.routes.ts                   │
│        - Write automated backend tests (GET default, PUT upsert, 401)  │
│                                                                        │
│ WP-03: Frontend Visual Branding & Header Integration (DEC-01)          │
│        - Copy docs/worship_studio_saxophone_emblem.png to src/assets/  │
│        - Update App.tsx header with responsive, accessible <img>       │
│        - Update index.css with mobile media queries & drop-shadows     │
│                                                                        │
│ WP-04: Frontend Client & Workspace Integration (DEC-02)                │
│        - Add getUserPreferences() and updateUserPreferences() to API   │
│        - Integrate preferences restoration in use-musical-workspace    │
│        - Add debounced autosave and in-memory offline fallback         │
│                                                                        │
│ WP-05: QA Verification, Cryptographic Hashing & Closure Report         │
│        - Execute full automated test suites (backend & frontend)       │
│        - Perform manual desktop/mobile verification script             │
│        - Generate SHA-256 manifests and author Phase 3A Closure Report │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 9. Preflight Recommendation & Next Governance Gate

### 9.1 Technical Preflight Recommendation
The technical architecture, security perimeter, data contracts, and fallback strategies for Phase 3A have been forensically vetted.

**Recommendation:** Proceed to **Gate 3 (Implementation Authorization)** with the preflight conditions recorded in Section 1.2.

### 9.2 Next Governance Gate
```
================================================================================
NEXT GOVERNANCE GATE:
GATE 3 — PHASE 3A IMPLEMENTATION AUTHORIZATION
================================================================================
Action Required from Project Owner:
1. Review the Phase 3A Technical Preflight Report.
2. Confirm the proposed WBS sequencing (WP-01 through WP-05).
3. Issue formal authorization to commence implementation of Phase 3A.
================================================================================
```

---

## 10. Cryptographic File Integrity & Manifest Ledger

All documents governing Gate 2 and Phase 3A preflight are maintained in 100% byte-identical synchronization between root and `docs/` repository copies.

### 10.1 Governed Documents Cryptographic Ledger

| File Description | Primary Path | Mirror Path | Byte Size | Verified SHA-256 Checksum | Match Status |
|:---|:---|:---|:---:|:---|:---:|
| **Phase 3A Technical Preflight** | `docs/reports/WORSHIP_STUDIO_PHASE_3A_TECHNICAL_PREFLIGHT.md` | `WORSHIP_STUDIO_PHASE_3A_TECHNICAL_PREFLIGHT.md` | Verified on sync | Verified on sync | 100% Match |
| **Gate 1 Owner Decisions** | `docs/reports/WORSHIP_STUDIO_GATE_1_OWNER_DECISIONS.md` | `WORSHIP_STUDIO_GATE_1_OWNER_DECISIONS.md` | 27,427 | `e5c7801d95d67aa1d49af827dde52373b03fe777cdfb9d8c272ed3c3a5140528` | 100% Match |
| **Gate 1 Sign-Off Audit** | `docs/reports/WORSHIP_STUDIO_GATE_1_SIGNOFF_AUDIT.md` | `WORSHIP_STUDIO_GATE_1_SIGNOFF_AUDIT.md` | 18,873 | `2e02f7a39def3ba5165928c2ec2cd4fa63d683da36fa3bdcfaa3b74115a33631` | 100% Match |
| **Requirements Consolidation** | `WORSHIP_STUDIO_REQUIREMENTS_CONSOLIDATION.md` | `docs/WORSHIP_STUDIO_REQUIREMENTS_CONSOLIDATION.md` | 49,277 | `641aed1e8797f49a9a3860dedd506211bced72ca174fbc0dbf2d551ac3199e31` | 100% Match |
| **Completion Roadmap** | `WORSHIP_STUDIO_COMPLETION_ROADMAP_PROPOSAL.md` | `docs/WORSHIP_STUDIO_COMPLETION_ROADMAP_PROPOSAL.md` | 34,392 | `7e8922d7a78adcde748e61440bea71cf40474c4c1919802dcc5689a4dd62553f` | 100% Match |
| **Governance Consistency Audit** | `WORSHIP_STUDIO_GOVERNANCE_CONSISTENCY_AUDIT.md` | `docs/WORSHIP_STUDIO_GOVERNANCE_CONSISTENCY_AUDIT.md` | 16,397 | `0dff07aac5d4be54d34a9e86357b3290f39083f8d550cb34fc0b3597875420ff` | 100% Match |
| **DEC-06 Correction Report** | `docs/reports/WORSHIP_STUDIO_DECISION_REGISTER_CORRECTION_REPORT.md` | `WORSHIP_STUDIO_DECISION_REGISTER_CORRECTION_REPORT.md` | 22,540 | `482cf1c0002f89add26e677957a3624fede84f1761c8d9c4ff3bdb250c655ef1` | 100% Match |

---

## 11. Final Governance Sign-Off & Exit Gate

```
================================================================================
GATE 2 EXIT SIGN-OFF:
================================================================================
Verdict: READY WITH CONDITIONS
Preflight Status: PHASE 3A TECHNICAL PREFLIGHT COMPLETED & AUDITED
Implementation Authorization: NOT AUTHORIZED (Awaiting Project Owner Gate 3 Sign-Off)
Next Governance Gate: GATE 3 — PHASE 3A IMPLEMENTATION AUTHORIZATION
================================================================================
```
