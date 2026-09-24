# Bethesda Worship Studio — Phase 2A Engineering Report
## Backend & Persistence Architecture Foundation

**Organization:** Iglesia Cristiana Bethesda — Madrid, Cundinamarca, Colombia  
**Phase:** 2A — Backend & Persistence Architecture Foundation  
**Status:** COMPLETE  
**Date:** September 20, 2026  
**Document Path:** `docs/PHASE_2A_ENGINEERING_REPORT.md` (and root `PHASE_2A_ENGINEERING_REPORT.md`)  

---

## 1. Executive Summary

Phase 2A establishes the **production-grade backend and persistence foundation** for the Bethesda Worship Studio platform. Following the successful completion of Phase 1H (real MusicXML and ChordPro ingestion and normalization), Phase 2A transitions the application from a session-scoped in-memory client to a robust, versioned, persistent client-server architecture backed by a relational PostgreSQL database and a high-performance Fastify backend written in TypeScript.

The central architectural principle has been strictly preserved and proven:
$$\text{Database} \to \text{Persistence Repository} \to \text{Domain Mapping} \to \text{CanonicalMusicPayload} \to \text{ProjectionService} \to \text{DerivedMusicalView} \to \text{RendererRegistry} \to \text{Browser}$$
$$\text{Writes: CanonicalMusicPayload} \to \text{Domain/Application Service} \to \text{Persistence Repository} \to \text{Database}$$

- The database does **NOT** become the source of musical truth; `CanonicalMusicPayload` remains the sole authoritative musical domain model.
- React components never access the database directly; renderers never access persistence.
- Zero invented melody notes for lyric/chord-only ChordPro content is strictly preserved (`totalMelodyNotes === 0`).
- Automated tests expanded to **198 tests across 39 suites** (180 frontend tests + 18 backend tests) with 0 failures and 0 skipped tests.
- TypeScript typecheck passes with 0 errors across the entire codebase (`frontend` and `backend`).
- End-to-end browser validation confirmed live PostgreSQL connectivity, song persistence, database song retrieval into the music stand, and zero regression across Golden Scenarios A–D.

---

## 2. Phase Objective

The explicit mandates authorized for Phase 2A:
1. Establish a modular, production-grade backend service using TypeScript, Node.js, Fastify, and PostgreSQL.
2. Implement schema definitions and migrations using Drizzle ORM without competing ORMs.
3. Design a versioned relational schema storing song metadata, version history, source provenance, and liturgical metadata.
4. Adopt the evaluated Hybrid Storage Strategy (Option C): relational tables for indexed metadata and queries, combined with validated JSONB snapshots for the full canonical musical graph (`canonical_music_payload`).
5. Establish deterministic serialization (`CanonicalSerializer`) and server-side deserialization (`CanonicalDeserializer`) boundaries with mandatory `CanonicalModelValidator` integrity checks.
6. Provide a versioned RESTful API under `/api/v1/` with Zod validation, structured error diagnostics, and OpenAPI Swagger documentation.
7. Implement the Repository Pattern decoupling business use cases from ORM infrastructure.
8. Support local reproducible execution via Docker Compose (`docker-compose.yml`) and native PostgreSQL.
9. Execute a mandatory **Round-Trip Integrity Test** proving that real MusicXML and ChordPro files persist, load, and deserialize without losing musical fidelity, strictly maintaining `totalMelodyNotes === 0` for ChordPro.
10. Integrate frontend workspace with the backend API without breaking built-in Golden Scenarios or session functionality.

---

## 3. Baseline Audit

Prior to implementation, a complete audit of the repository was performed:
- **Repository Layout:** Existing workspace contained `frontend/`, `docs/`, and phase reports. No backend or database configuration existed.
- **Node.js Environment:** Node.js v24.12.0 installed.
- **Database Engine:** PostgreSQL 18.1 actively running on port 5432 on the host machine.
- **Domain Reusability:** The musical theory and canonical models in `frontend/src/core/canonical-model` and ingestion parsers in `frontend/src/core/ingestion` are completely decoupled from browser DOM/UI APIs (`XmlParser` is pure TypeScript without `DOMParser`).
- **Decision:** Rather than duplicating parsers or models, the backend imports and shares domain contracts and validation directly, satisfying Step 16: *"Do not duplicate MusicXML or ChordPro parsing in the backend."*

---

## 4. Architecture Before Phase 2A

```
[Real Source File / In-Memory Fixtures]
                  │
                  ▼
         IngestionService
                  │
                  ▼
       CanonicalMusicPayload (Session-Only, In-Memory)
                  │
                  ▼
          ProjectionService
                  │
                  ▼
          DerivedMusicalView
                  │
                  ▼
           RendererRegistry
       (AlphaTab / OSMD / LeadSheetDOM)
```
*Limitation:* All imported songs and adjustments were strictly session-scoped in client memory and lost upon page refresh.

---

## 5. Architecture After Phase 2A

```
  ┌───────────────────────────────────────────────────────────┐
  │                 React Musical Workspace                   │
  │  (Golden Scenarios Catalog + Database Modal + View State) │
  └─────────────┬───────────────────────────▲─────────────────┘
                │                           │
                │ (HTTP REST API / JSON)    │ (HTTP REST API / JSON)
                ▼                           │
  ┌─────────────────────────────────────────┴─────────────────┐
  │                   BethesdaApiClient                       │
  └─────────────┬─────────────────────────────────────────────┘
                │
                ▼
  ┌───────────────────────────────────────────────────────────┐
  │                    Fastify API v1                         │
  │   - GET /health, /songs, /songs/:id, /songs/:id/versions  │
  │   - POST /songs, /songs/import, /songs/:id/versions       │
  │   - Zod Validation + Structured Error Diagnostics         │
  │   - OpenAPI 3.0 Documentation (/documentation)            │
  └─────────────┬─────────────────────────────────────────────┘
                │
                ▼
  ┌───────────────────────────────────────────────────────────┐
  │                Application Services Layer                 │
  │   - SongService (Song & Version use cases)                │
  │   - IngestionPersistenceService (Server-side Ingest)      │
  └─────────────┬─────────────────────────────────────────────┘
                │
                ▼
  ┌───────────────────────────────────────────────────────────┐
  │          Domain & Canonical Serialization Layer           │
  │   - CanonicalSerializer (Deterministic Snapshot + Stats)  │
  │   - CanonicalDeserializer (Hydration + CanonicalModelVal) │
  │   - CanonicalMusicPayload (Single Source of Truth)        │
  └─────────────┬─────────────────────────────────────────────┘
                │
                ▼
  ┌───────────────────────────────────────────────────────────┐
  │                 Repository Abstraction                    │
  │   - ISongRepository / DrizzleSongRepository               │
  │   - ISongVersionRepository / DrizzleSongVersionRepository │
  └─────────────┬─────────────────────────────────────────────┘
                │
                ▼
  ┌───────────────────────────────────────────────────────────┐
  │                 PostgreSQL 18 Database                    │
  │   - songs (Relational Metadata & Identity)                │
  │   - song_versions (Relational Versions + JSONB Payload)   │
  │   - song_sources (Source Provenance & Raw Content)        │
  │   - song_metadata (Tags, Themes, Copyright, Notes)        │
  └───────────────────────────────────────────────────────────┘
```

---

## 6. Backend Architecture

The backend application is structured according to clean architecture principles:
```
backend/
├── src/
│   ├── config/
│   │   └── env.ts                     # Environment validation via Zod
│   ├── db/
│   │   ├── schema.ts                  # Drizzle ORM table definitions
│   │   ├── index.ts                   # Postgres connection pool & Drizzle instance
│   │   ├── migrate.ts                 # Programmatic migration runner
│   │   └── migrations/                # SQL migration files
│   ├── domain/
│   │   ├── types.ts                   # Domain entities and interfaces
│   │   ├── canonical-serializer.ts    # Deterministic CanonicalSerializer & Deserializer
│   │   └── errors.ts                  # Structured domain error hierarchy
│   ├── repositories/
│   │   ├── song-repository.ts         # ISongRepository & DrizzleSongRepository
│   │   └── version-repository.ts      # ISongVersionRepository & DrizzleSongVersionRepository
│   ├── application/
│   │   ├── song-service.ts            # Song & version application use cases
│   │   └── ingestion-persistence-service.ts # Ingest and persist orchestrator
│   ├── interfaces/
│   │   ├── http/
│   │   │   ├── schemas/               # Zod route schemas
│   │   │   ├── routes/
│   │   │   │   ├── health.routes.ts   # GET /api/v1/health
│   │   │   │   └── song.routes.ts     # /api/v1/songs endpoints
│   │   │   └── error-handler.ts       # Global error handler
│   ├── app.ts                         # Fastify factory with CORS, Swagger & routes
│   └── server.ts                      # Server entry point
├── drizzle.config.ts                  # Drizzle Kit configuration
├── package.json                       # Scripts and dependencies
├── tsconfig.json                      # Strict TypeScript configuration
└── __tests__/
    ├── canonical-serializer.test.ts   # Serialization / deserialization tests
    ├── song-repository.test.ts        # Database integration & CRUD tests
    ├── api-routes.test.ts             # Fastify HTTP API tests
    └── round-trip-integrity.test.ts   # Mandatory round-trip integrity test
```

---

## 7. Database Architecture

### Relational Schema (PostgreSQL)

1. **`songs`**:
   - `id`: UUID Primary Key (`gen_random_uuid()`).
   - `title`: VARCHAR(255) NOT NULL (B-Tree indexed).
   - `artist`: VARCHAR(255) (B-Tree indexed).
   - `ccli_number`: VARCHAR(64).
   - `default_key`: VARCHAR(16) NOT NULL (B-Tree indexed).
   - `default_bpm`: INTEGER NOT NULL DEFAULT 120.
   - `time_signature`: VARCHAR(16) NOT NULL DEFAULT '4/4'.
   - `status`: VARCHAR(32) NOT NULL DEFAULT 'DRAFT' (`DRAFT`, `APPROVED`, `ARCHIVED`).
   - `current_version_id`: UUID Foreign Key referencing `song_versions(id)`.
   - `created_at`, `updated_at`: TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW().

2. **`song_versions`**:
   - `id`: UUID Primary Key.
   - `song_id`: UUID NOT NULL REFERENCES `songs(id)` ON DELETE CASCADE.
   - `version_number`: INTEGER NOT NULL.
   - `name`: VARCHAR(255) NOT NULL DEFAULT 'Principal'.
   - `description`: TEXT.
   - `source_format`: VARCHAR(32) NOT NULL (`MUSIC_XML`, `CHORD_PRO`, `INTERNAL`).
   - `canonical_payload`: JSONB NOT NULL (Complete `CanonicalMusicPayloadJSON`).
   - `total_measures`: INTEGER NOT NULL DEFAULT 0.
   - `total_notes`: INTEGER NOT NULL DEFAULT 0.
   - `total_chords`: INTEGER NOT NULL DEFAULT 0.
   - `is_current`: BOOLEAN NOT NULL DEFAULT FALSE.
   - `created_at`: TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW().
   - *Constraint:* UNIQUE(`song_id`, `version_number`).

3. **`song_sources`**:
   - `id`: UUID Primary Key.
   - `song_id`: UUID NOT NULL REFERENCES `songs(id)` ON DELETE CASCADE.
   - `version_id`: UUID REFERENCES `song_versions(id)` ON DELETE SET NULL.
   - `source_type`: VARCHAR(32) NOT NULL (`MUSIC_XML`, `CHORD_PRO`).
   - `filename`: VARCHAR(255).
   - `raw_content`: TEXT.
   - `importer_name`: VARCHAR(64) NOT NULL.
   - `importer_version`: VARCHAR(32) NOT NULL.
   - `imported_at`: TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW().

4. **`song_metadata`**:
   - `id`: UUID Primary Key.
   - `song_id`: UUID NOT NULL REFERENCES `songs(id)` ON DELETE CASCADE.
   - `tags`: JSONB NOT NULL DEFAULT '[]'::jsonb.
   - `themes`: JSONB NOT NULL DEFAULT '[]'::jsonb.
   - `copyright`: TEXT.
   - `notes`: TEXT.
   - `updated_at`: TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW().

---

## 8. Domain/Persistence Boundary

To prevent the database schema from polluting domain logic:
1. Repositories accept and return strongly typed DTOs and entities (`SongEntity`, `SongVersionEntity`, `SongWithVersion`).
2. Persisted JSONB payloads are never consumed raw by presentation components. They pass through `CanonicalDeserializer.deserialize()` to produce verified `CanonicalMusicPayload` instances before reaching `ProjectionService`.
3. Conversely, writes must pass through `CanonicalSerializer.serialize()`, which validates canonical invariants before committing rows.

---

## 9. Canonical Serialization Strategy

### Evaluation of Storage Options
- **Option A (Pure Relational Normalization):** Requires separate tables for timelines, tempo events, key signatures, measures, voices, staves, notes, accidentals, ties, chords, lyrics, sections, and track definitions. A 100-measure score would require >3,000 relational row inserts across 12 tables and deeply nested joins for reads.
- **Option B (Unvalidated JSON Blob):** Stores notation as arbitrary opaque text. High risk of data corruption, unqueryable, no relational referential integrity.
- **Option C (Hybrid Relational + Canonical JSONB Snapshot) — SELECTED:**
  - Fast indexed queries on song metadata, versions, and source provenance using standard relational B-Tree indexes.
  - Full canonical fidelity preserved in a validated JSONB column (`canonical_payload`).
  - Measures, polyphony, micro-timings, and syllable bindings are stored intact.
  - Quantitative metrics (`total_measures`, `total_notes`, `total_chords`) are extracted and stored relationally for fast filtering and statistics without parsing JSONB.

### Serialization Boundary Implementation
- `CanonicalSerializer.serialize(payload: CanonicalMusicPayload)`: Validates model integrity via `CanonicalModelValidator.validate()` and outputs `CanonicalMusicPayloadJSON`.
- `CanonicalDeserializer.deserialize(input: unknown)`: Validates structure, invokes `CanonicalMusicPayload.fromJSON()`, and executes `CanonicalModelValidator.validate()` server-side. Throws `InvalidMusicPayloadError` (HTTP 422) if invalid.

---

## 10. API Architecture

The Fastify application exposes versioned RESTful routes under `/api/v1/`:

| Method | Endpoint | Description | Status Code |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/v1/health` | Diagnostic health check (database connection check) | `200 OK` / `503 Service Unavailable` |
| `GET` | `/api/v1/songs` | List songs with search, status, limit, and offset | `200 OK` |
| `POST` | `/api/v1/songs` | Create song with initial canonical version | `201 Created` |
| `POST` | `/api/v1/songs/import` | Import raw MusicXML/ChordPro and persist in DB | `201 Created` |
| `GET` | `/api/v1/songs/:songId` | Retrieve song details and current version payload | `200 OK` / `404 Not Found` |
| `POST` | `/api/v1/songs/:songId/versions` | Create a new version for an existing song | `201 Created` / `404 Not Found` |
| `GET` | `/api/v1/songs/:songId/versions` | List all version history for a song | `200 OK` / `404 Not Found` |
| `GET` | `/api/v1/songs/:songId/versions/:versionId` | Retrieve specific version snapshot | `200 OK` / `404 Not Found` |

---

## 11. Repository Architecture

Repositories follow the dependency inversion principle:
- Interfaces: `ISongRepository` and `ISongVersionRepository` defined in domain contracts.
- Implementations: `DrizzleSongRepository` and `DrizzleSongVersionRepository` interact with PostgreSQL using Drizzle ORM queries and transactions.
- Atomicity: `create()` executes inside `database.transaction(async (tx) => ...)`, ensuring that `songs`, `song_versions`, `song_sources`, and `song_metadata` are created atomically or rolled back entirely.

---

## 12. Validation

Multi-layered server-side validation is enforced:
1. **HTTP Parameter & Body Validation:** Fastify routes parse inputs using Zod schemas (`SongReviewStatusSchema`, `CreateSongBodySchema`, `CreateVersionBodySchema`, `SongIdParamSchema`, `VersionIdParamSchema`).
2. **Canonical Integrity Validation:** Reconstructed payloads must pass `CanonicalModelValidator.validate()`. Corrupted timelines, missing measures, or out-of-range pitches are rejected with `InvalidMusicPayloadError`.
3. **Structured Diagnostics:** Errors are formatted uniformly:
   ```json
   {
     "error": {
       "code": "VALIDATION_ERROR",
       "message": "Los datos enviados en la solicitud no cumplen con el esquema requerido.",
       "statusCode": 400,
       "details": [{ "field": "title", "message": "El título es obligatorio" }]
     }
   }
   ```

---

## 13. Security

- **SQL Injection Prevention:** 100% parameterization via Drizzle ORM query builders and `sql` template tags. Zero string-concatenated SQL queries.
- **Server-Side Validation:** Browser input is treated as untrusted. Canonical models are re-validated on the server prior to persistence.
- **Body Size Limit:** Fastify limits request bodies to 10 MB to prevent memory exhaustion DoS attacks from malicious payloads.
- **Information Leakage Prevention:** Global error handler catches unhandled exceptions and returns generic `INTERNAL_ERROR` with HTTP 500 without exposing database connection strings, paths, or stack traces.
- **CORS Protection:** Configured with `@fastify/cors` restricting allowed origins to client domains (`http://localhost:5173`).

---

## 14. Environment Configuration

Managed via `backend/src/config/env.ts` with strict Zod validation:
- `DATABASE_URL`: Primary PostgreSQL connection string.
- `TEST_DATABASE_URL`: Isolated test database connection string.
- `PORT`: HTTP listener port (default `3001`).
- `HOST`: Listener host (default `0.0.0.0`).
- `NODE_ENV`: Execution environment (`development`, `test`, `production`).
- `CORS_ORIGIN`: Allowed client origin.
- `LOG_LEVEL`: Fastify Pino log level (`fatal`, `error`, `warn`, `info`, `debug`, `trace`).

---

## 15. Migration Strategy

- **Tooling:** Drizzle Kit (`drizzle-kit`).
- **Migrations Directory:** `backend/src/db/migrations/`.
- **Generated Migration:** `0000_normal_randall_flagg.sql` creates all 4 tables, foreign key constraints with cascade rules, and B-Tree / Unique indexes.
- **Execution:** Programmatic runner `runMigrations()` in `backend/src/db/migrate.ts` uses `migrate(db, { migrationsFolder })`. Runs automatically on server startup or via `npm run migrate`.

---

## 16. Testing

The backend test suite is executed using Node.js test runner with `tsx`:
```
npm test (backend)
```

Test coverage includes:
1. `db-connection.test.ts` / `song-repository.test.ts`:
   - Connection to PostgreSQL 18.
   - Song creation with initial canonical version.
   - Version creation and retrieval in descending order.
   - Rollback of active version.
   - Graceful handling of non-existent songs/versions.
   - Search and pagination filtering.
2. `canonical-serializer.test.ts`:
   - Deterministic JSON snapshot generation.
   - Full hydration into `CanonicalMusicPayload`.
   - Rejection of malformed JSON structures with `InvalidMusicPayloadError`.
3. `api-routes.test.ts`:
   - `GET /api/v1/health` connectivity check.
   - `POST /api/v1/songs` creation (HTTP 201).
   - `GET /api/v1/songs` pagination (HTTP 200).
   - `GET /api/v1/songs/:id` retrieval (HTTP 200).
   - `POST /api/v1/songs/:id/versions` version creation (HTTP 201).
   - Structured error responses: HTTP 400 `VALIDATION_ERROR`, HTTP 404 `NOT_FOUND`, HTTP 422 `INVALID_MUSIC_PAYLOAD`.
4. `round-trip-integrity.test.ts`:
   - Full round-trip test from real disk files to PostgreSQL and back to `ProjectionService`.

---

## 17. Round-Trip Integrity

The mandatory architectural test (Step 20) was executed and PASSED:

### A. MusicXML Round-Trip
1. Read real file `valid_full_score.musicxml` from disk.
2. Ingest via `IngestionService` $\to$ produce `CanonicalMusicPayload A`.
3. Persist into PostgreSQL via `IngestionPersistenceService`.
4. Fetch persisted version from PostgreSQL $\to$ deserialize via `CanonicalDeserializer` $\to$ produce `CanonicalMusicPayload B`.
5. **Semantic Equivalence Verified:**
   - Title: `"Sublime Gracia - Himno Canónico"`
   - Meter: 4/4
   - Key: G Major
   - Measures: 2 measures
   - Notes: G4 (480 ticks), B4 (480 ticks), D5 (960 ticks), D5 (1920 ticks)
   - Chords: G, C, D
   - Lyrics: "Sub", "li", "me", "gracia"
6. **Projection Verification:** `payloadB` passed to `ProjectionService.project()` for Piano (Grand Staff) and Alto Sax (Eb transposed notation); both projections succeeded with `status: "SUCCESS"`.

### B. ChordPro Round-Trip & Zero Invented Melody Invariant
1. Read real file `valid_lead_sheet.chordpro` from disk.
2. Ingest and persist into PostgreSQL.
3. Fetch persisted version from PostgreSQL $\to$ deserialize.
4. **Invariant Verified:** `payloadB.getAllNotes().length === 0` and `totalNotes === 0` in database column.
5. **Projection Verification:** Passed to `ProjectionService` for Lead Vocal (`LYRICS` + `CHORDS`); projected view has strictly `0` melody notes.

---

## 18. Browser Validation

Real browser validation was performed using Chrome via the browser subagent:
1. **Initial Workspace:** Loaded `http://localhost:5173/`. Golden Scenario A rendered with AlphaTab notation and tablature (`initial_workspace_top_1789886034037.png`).
2. **Database Catalog Modal:** Clicked `💾 Catálogo en Base de Datos`. The modal opened displaying `🟢 PostgreSQL: Conectado y Operativo` (`database_modal_open_1789886095867.png`).
3. **Persist Song:** Clicked `💾 Guardar Canción Actual en BD`. Success banner displayed: `¡Canción "Sublime Gracia (Golden G Major)" guardada exitosamente en PostgreSQL!` and the catalog list updated immediately (`song_saved_success_1789886133711.png`).
4. **Load Persisted Song:** Clicked `Abrir en Atril` on the persisted song. The modal closed, the song loaded into the workspace, and the `SongHeader` displayed the badge `💾 PostgreSQL (v1)` (`song_loaded_from_db_1789886237133.png`).
5. **Notation Rendering:** AlphaTab rendered the notation and tablature for the loaded song (`score_notation_rendered_1789886277122.png`).
6. **Scenario Regression:** Switched through Escenarios A, B, C, and D without errors.
7. **Diagnostics Check:** System diagnostics bar confirmed `▶ Diagnósticos del Sistema (0)` and `Sistema Saludable` (`diagnostic_panel_healthy_1789886612434.png`).

---

## 19. Regression Results

All existing test suites were executed concurrently:
- **Frontend Test Suites:** 35 suites, 180 tests, 0 failures, 0 skipped.
  - Phase 1A Musical Theory Core: 100% PASS
  - Phase 1B Canonical Music Model: 100% PASS
  - Phase 1C Ingestion Architecture: 100% PASS
  - Phase 1D Musical Projection Engine: 100% PASS
  - Phase 1E Rendering Adapters: 100% PASS
  - Phase 1F Browser Rendering: 100% PASS
  - Phase 1G Workspace Orchestration: 100% PASS
  - Phase 1H Real Music Ingestion: 100% PASS
- **Backend Test Suites:** 4 suites, 18 tests, 0 failures, 0 skipped.
  - Canonical Serializer & Deserializer: 100% PASS
  - Persistence Repository (PostgreSQL + Drizzle): 100% PASS
  - Fastify HTTP API Integration (/api/v1): 100% PASS
  - Round-Trip Persistence & Invariants: 100% PASS
- **Combined Total:** 198 tests passing across 39 suites. 0 failures.

---

## 20. Files Created

1. `docker-compose.yml`: PostgreSQL 16 local container infrastructure with healthcheck.
2. `.env.example`: Documented environment variable template.
3. `backend/package.json`: Backend scripts, Fastify, Drizzle ORM, Zod, and test configurations.
4. `backend/tsconfig.json`: Strict TypeScript compiler configuration.
5. `backend/drizzle.config.ts`: Drizzle Kit migration configuration.
6. `backend/.env`: Local environment configuration pointing to local PostgreSQL 18.
7. `backend/src/config/env.ts`: Zod environment validation module.
8. `backend/src/db/schema.ts`: Drizzle ORM schema (`songs`, `song_versions`, `song_sources`, `song_metadata`).
9. `backend/src/db/index.ts`: PostgreSQL connection pool and Drizzle client.
10. `backend/src/db/migrate.ts`: Programmatic migration runner.
11. `backend/src/db/migrations/0000_normal_randall_flagg.sql`: Generated SQL migration.
12. `backend/src/domain/types.ts`: Domain entity and DTO types.
13. `backend/src/domain/errors.ts`: Structured backend error hierarchy.
14. `backend/src/domain/canonical-serializer.ts`: CanonicalSerializer and CanonicalDeserializer.
15. `backend/src/repositories/song-repository.ts`: ISongRepository and DrizzleSongRepository.
16. `backend/src/repositories/version-repository.ts`: ISongVersionRepository and DrizzleSongVersionRepository.
17. `backend/src/application/song-service.ts`: Application service for song and version use cases.
18. `backend/src/application/ingestion-persistence-service.ts`: Orchestrator for real file import and persistence.
19. `backend/src/interfaces/http/schemas/song.schemas.ts`: Zod HTTP request/response schemas.
20. `backend/src/interfaces/http/error-handler.ts`: Structured global error handler.
21. `backend/src/interfaces/http/routes/health.routes.ts`: `GET /api/v1/health` route.
22. `backend/src/interfaces/http/routes/song.routes.ts`: `GET /api/v1/songs`, `POST /api/v1/songs`, etc.
23. `backend/src/app.ts`: Fastify application factory with CORS, Swagger, and routes.
24. `backend/src/server.ts`: HTTP server entry point.
25. `backend/src/__tests__/canonical-serializer.test.ts`: Serializer unit tests.
26. `backend/src/__tests__/song-repository.test.ts`: Repository integration tests.
27. `backend/src/__tests__/api-routes.test.ts`: Fastify API integration tests.
28. `backend/src/__tests__/round-trip-integrity.test.ts`: Round-trip integrity test suite.
29. `frontend/src/core/api/api-client.ts`: Typed client for Fastify API.
30. `frontend/src/components/workspace/DatabaseSongsModal.tsx`: Database catalog exploration modal.
31. `docs/PHASE_2A_ENGINEERING_REPORT.md`: This comprehensive engineering document.
32. `PHASE_2A_ENGINEERING_REPORT.md`: Root mirror of this engineering report.

---

## 21. Files Modified

1. `frontend/src/components/workspace/SongHeader.tsx`: Added `isPersisted` and `versionNumber` badges.
2. `frontend/src/core/workspace/use-musical-workspace.ts`: Added `persistedMeta` state and `selectPersistedSong` handler.
3. `frontend/src/components/workspace/MusicalWorkspace.tsx`: Added database catalog button and `DatabaseSongsModal` integration.
4. `frontend/src/index.css`: Added styles for database modal, connection status badge, song items, and persistence badges.

---

## 22. Known Limitations

1. **Local Network / Single Node:** Backend currently runs as a standalone Fastify service on localhost. Multi-instance cluster synchronization with Redis will be addressed in Phase 3.
2. **No Authentication / Authorization:** As mandated by Step 25, user login, JWTs, and RBAC are deferred to Phase 2B.
3. **No File Binary Blob Storage (S3 / MinIO):** Imported file sources are stored as raw text in `song_sources.raw_content`. External S3-compatible bucket storage for large audio/PDF files is planned for later phases.

---

## 23. Deferred Work

1. User authentication, JWT sessions, and RBAC (Phase 2B).
2. Setlist management and service moments (Phase 2C).
3. Real-time rehearsal WebSocket synchronization (Phase 4).
4. S3/MinIO cloud file storage.
5. Multi-track audio and MIDI recording playback.

---

## 24. Architectural Deviations

**Zero architectural deviations.**  
- Drizzle ORM used exclusively.
- PostgreSQL relational + JSONB hybrid model matches Option C and documentation specifications.
- `CanonicalMusicPayload` remains the single source of truth.
- Zero invented melody notes for ChordPro strictly maintained.
- Renderers remain passive consumers of `DerivedMusicalView`.

---

## 25. Exit Gate Matrix

| Criterion | Requirement | Verification Result | Status |
| :--- | :--- | :--- | :--- |
| **PostgreSQL Dev Environment** | Local PostgreSQL or Docker Compose running | PostgreSQL 18.1 verified on port 5432 + `docker-compose.yml` | **PASSED** |
| **Database Migrations** | Clean migration execution via Drizzle Kit | `0000_normal_randall_flagg.sql` applied to dev & test DBs | **PASSED** |
| **Backend Startup** | Fastify server starts and listens | Started on port 3001 with Pino logger and Swagger UI | **PASSED** |
| **Health Endpoint** | `GET /api/v1/health` checks DB | Returns HTTP 200 `{ status: "ok", database: "connected" }` | **PASSED** |
| **Song Creation** | `POST /api/v1/songs` creates song + v1 | Returns HTTP 201 with atomic transaction | **PASSED** |
| **Song Retrieval** | `GET /api/v1/songs/:id` retrieves song | Returns HTTP 200 with current version canonical payload | **PASSED** |
| **Song Versioning** | `POST /api/v1/songs/:id/versions` increments | Version number 2 created, listed in descending order | **PASSED** |
| **Canonical Serialization** | Deterministic JSON snapshot generation | `CanonicalSerializer.serialize()` verified in tests | **PASSED** |
| **Canonical Deserialization**| Full hydration with validation | `CanonicalDeserializer.deserialize()` verified in tests | **PASSED** |
| **Round-Trip Integrity** | Source $\to$ Payload $\to$ DB $\to$ Load $\to$ Proj | 100% semantic equivalence verified for MusicXML | **PASSED** |
| **Zero Invented Melody** | ChordPro totalMelodyNotes === 0 | Strictly 0 notes in DB, model, and LeadSheet projection | **PASSED** |
| **API Validation** | Zod schemas reject invalid requests | HTTP 400 `VALIDATION_ERROR` verified | **PASSED** |
| **API Error Model** | Structured JSON without stack leaks | HTTP 400, 404, 422, 500 structured diagnostics verified | **PASSED** |
| **Security Controls** | Parameterized queries, 10MB limit, CORS | Drizzle parameterization and CORS verified | **PASSED** |
| **Phase 1A–1H Tests** | All 180 frontend tests passing | 180/180 passed across 35 test suites | **PASSED** |
| **Phase 2A Tests** | All new backend tests passing | 18/18 passed across 4 test suites | **PASSED** |
| **TypeScript Typecheck** | 0 errors across frontend and backend | `tsc --noEmit` exited with code 0 on both projects | **PASSED** |
| **Browser Validation** | Real browser validation of persistence UI | Verified in Chrome: DB modal, save, load, render, presets | **PASSED** |
| **No Regressions** | Golden Scenarios A–D operational | All 4 presets verified functional in browser and tests | **PASSED** |
| **Engineering Report** | Complete and factual documentation | Created in `docs/PHASE_2A_ENGINEERING_REPORT.md` | **PASSED** |

---

## 26. Final Phase Decision

All 20 mandatory Exit Gate criteria have been systematically implemented, tested, and verified.

**PHASE 2A IS FORMALLY COMPLETE AND PASSED.**
