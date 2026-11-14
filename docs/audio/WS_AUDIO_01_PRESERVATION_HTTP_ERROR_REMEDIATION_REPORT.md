# BETHESDA WORSHIP STUDIO
# WS-AUDIO-01 — AUDIO PRESERVATION HTTP 400/401 REMEDIATION REPORT
## Root-Cause Forensic Analysis, Request/Response Trace, Remediation & Verification

**Repository:** `https://github.com/juancastro2381-hub/BETHESDA-WORSHIP-STUDIO.git`  
**Branch:** `feature/phase-1a-core-foundation`  
**Baseline Commit Inspected:** `7c9c71d81198373bdec8a66f78fe04f0cf521b45`  
**Workstream:** `WS-AUDIO-01 — Audio Ingestion, Integrity, Durable Preservation & Digital Music Stand Playback`  
**Scope Boundary:** Strictly limited to WS-AUDIO-01. Zero implementation of WS-AUDIO-02 or WS-AUDIO-03.

---

## 1. Root Cause of HTTP 400 (`POST /api/v1/songs/{songId}/audio`)

### 1.1 Primary Root Cause — Missing `Content-Type: application/json` Header on Stringified JSON Body
In [`frontend/src/core/api/api-client.ts`](../../frontend/src/core/api/api-client.ts) (`uploadSongAudio()`, lines 733–756 prior to remediation), the frontend sent the audio preservation payload as a JSON-serialized string (`body: JSON.stringify({ title, filename, mimeType, dataBase64, durationSeconds })`) via `this.fetchWithAuth()`, **without setting `headers: { 'Content-Type': 'application/json' }`**:

```ts
// BEFORE REMEDIATION (frontend/src/core/api/api-client.ts:741-750)
const res = await this.fetchWithAuth(`/songs/${params.songId}/audio`, {
  method: 'POST',
  body: JSON.stringify({
    title: params.title,
    filename: params.filename,
    mimeType: params.mimeType,
    dataBase64: params.dataBase64,
    durationSeconds: params.durationSeconds,
  }),
});
```

Per the WHATWG Fetch Standard, when `fetch()` is invoked with a `USVString` `body` and no explicit `Content-Type` header in `RequestInit`, the browser automatically sets:

```http
Content-Type: text/plain;charset=UTF-8
```

On the backend, Fastify's built-in `text/plain` content-type parser left `request.body` as an unparsed raw `string` rather than a parsed JavaScript object. When [`backend/src/interfaces/http/routes/audio.routes.ts`](../../backend/src/interfaces/http/routes/audio.routes.ts) executed:

```ts
const body = UploadAudioBodySchema.parse(request.body);
```

`ZodObject.parse()` immediately rejected `request.body` with `ZodError` (`code: "invalid_type"`, `expected: "object"`, `received: "string"`), which [`backend/src/interfaces/http/error-handler.ts`](../../backend/src/interfaces/http/error-handler.ts) mapped to **HTTP 400 `VALIDATION_ERROR`**.

### 1.2 Contributing Secondary Factors Identified & Remediated in the Same Upload Path
1. **Route Body Size Limit (`backend/src/app.ts` vs `backend/src/interfaces/http/routes/audio.routes.ts`):**
   - `app.ts` sets a global Fastify `bodyLimit` of `MAX_OMR_HTTP_BODY_LIMIT_BYTES` (`25 MiB`), whereas `MAX_AUDIO_FILE_SIZE_BYTES` is `50 MiB` (`~66.7 MiB` when Base64-encoded). Route-level `bodyLimit: 80 * 1024 * 1024` (`80 MiB`) was added to `POST /api/v1/songs/:songId/audio`.
2. **Multipart Form-Data & Content-Type Normalization (`backend/src/interfaces/http/routes/audio.routes.ts`):**
   - Added a scoped `multipart/form-data` binary parser (`parseAs: 'buffer'`) and `normalizeAudioUploadPayload()` supporting both `application/json` (and JSON string fallback) and `multipart/form-data` (`file`/`audio` binary part + metadata fields), with explicit field-level `ValidationError` diagnostics.
3. **Browser MIME Aliases & Chained ID3v2 Headers (`audio-service.ts`, `audio-signature-validator.ts`, `audio-signature.ts`):**
   - Added parameter stripping (`; codecs=...`) and canonical mapping for browser-reported MIME variants (`audio/x-mp3`, `audio/x-mpeg`, `audio/mpeg3`, `audio/x-flac`, `audio/vnd.wave`, `application/ogg`, `audio/vorbis`, `audio/opus`, `audio/aacp`).
   - Extended `inspectAudioSignature()` in both frontend and backend to traverse up to 4 consecutive/chained `ID3v2` tags and scan up to `131,072` bytes after ID3v2 padding for the first chained MPEG frame while preserving strict fail-closed rejection of ID3-only or non-audio buffers.
4. **Silent Error Suppression in IDLE Preservation State (`ConversionCenterWorkspace.tsx`):**
   - Previously, `errorMessage` was only rendered when `conversionStatus === 'FAILED'`, whereas clicking `"Preservar Audio para el Atril Digital"` kept `conversionStatus === 'IDLE'`. Added an explicit `role="alert"` error banner inside `.audio-preservation-panel` when `errorMessage && conversionStatus === 'IDLE'`, plus chunked `uint8ArrayToBase64()` conversion to avoid call-stack limits on large audio files.
5. **Retry / Double-Click Idempotency (`backend/src/application/audio-service.ts`):**
   - Added single-flight coalescing (`inFlightUploadsByKey`) and completed-asset idempotency checks in `AudioService.uploadAudio()` verifying physical existence and SHA-256 + byte-size integrity before returning an existing asset on retry, preventing duplicate `audio_assets` rows or duplicate disk files.

---

## 2. Root Cause of HTTP 401 (`/api/v1/auth/refresh`)

### 2.1 Forensic Timeline in PostgreSQL (`audit_logs` & `refresh_tokens`)
Inspection of PostgreSQL `audit_logs` and `refresh_tokens` confirmed the exact sequence:
1. On `2026-11-13T09:20:12.352Z`, `LOGOUT` (`clean: true`) was executed for `admin@bethesda.org` (`e74e31aa-8eba-4e95-af4b-23d5b87cc91b`), revoking refresh token `f0c45765-c90f-4384-9586-a14996d0a98b` and clearing the `bethesda_refresh_token` HttpOnly cookie.
2. On cold application boot on `2026-11-14` prior to login, `AuthProvider` (`frontend/src/core/auth/auth-context.tsx:188`) executed `performSilentRefresh()` -> `apiClient.refreshSession()` -> `/api/v1/auth/refresh` without a `bethesda_refresh_token` cookie, which returned **HTTP 401** (`"Cookie de refresco ausente o inválida."`).
3. At `2026-11-14T09:20:33.833Z`, the Project Owner logged in (`LOGIN_SUCCESS`), receiving an active access token (`tokenManager`) and a valid HttpOnly cookie (`cb84e18f-f1fe-493e-97c3-b3e735ce684f`), which subsequently rotated cleanly at `09:34:34.942Z` (`40a0d2bd-3550-4637-92dc-aed177ef40e7`).

### 2.2 Frontend Refresh Error Classification & Stale Auth State Defects Remediated
1. **`refreshSession()` Discarded HTTP Status and Error Code (`frontend/src/core/api/api-client.ts:201-204`):**
   - Previously, `refreshSession()` threw `new Error(err?.error?.message ?? ...)` instead of `await ApiError.fromResponse(res)`. Because the backend message `"Cookie de refresco ausente o inválida."` did not match the substring list in `isServerAuthRejectionError()` (`frontend/src/core/offline/offline-session-identity.ts:443`) and had no `statusCode: 401` or `code: 'UNAUTHORIZED'`, `performSilentRefresh()` misclassified an online 401 server rejection as a network outage and restored a stale `OfflineSessionIdentity` from `localStorage`.
2. **Failed Refresh During `fetchWithAuth()` Did Not Invalidate `AuthProvider` State (`api-client.ts:146-148` & `auth-context.tsx`):**
   - When `fetchWithAuth()` received a `401` on a protected endpoint and `refreshSession()` failed, it cleared `tokenManager` but did not notify `AuthProvider`. Added `registerAuthFailureListener()` on `BethesdaApiClient` wired to `AuthProvider` so any server-rejected refresh immediately purges `tokenManager`, clears `OfflineSessionIdentity`, and transitions `authStatus` to `'UNAUTHENTICATED'`.
3. **HTTP Method Parity on `/api/v1/auth/refresh` (`backend/src/interfaces/http/routes/auth.routes.ts:114`):**
   - Registered both `POST /api/v1/auth/refresh` and `GET /api/v1/auth/refresh` bound to `handleRefreshSession`, enforcing the same strict `bethesda_refresh_token` HttpOnly cookie validation and single-use token rotation.

---

## 3. Exact Request/Response Trace Before Remediation

### 3.1 Request Sent by Frontend (`ConversionCenterWorkspace.tsx:236` -> `api-client.ts:741` -> `api-client.ts:126`)
- **Method & URL:** `POST /api/v1/songs/4cb6240b-3657-4662-b26c-abb26dd4fa8d/audio`
- **Headers:**
  - `Authorization: Bearer <valid_jwt>`
  - `Content-Type: text/plain;charset=UTF-8` *(browser default for string body without explicit Content-Type)*
- **Body (raw string):**
  `{"title":"El Señor Está en Este Lugar","filename":"El Señor Está en Este Lugar.mp3","mimeType":"audio/mpeg","dataBase64":"SUQz..."}`

### 3.2 Backend Response Before Remediation (`audio.routes.ts:108`)
- **HTTP Status:** `400 Bad Request`
- **Response Body:**
  ```json
  {
    "error": {
      "code": "VALIDATION_ERROR",
      "message": "Los datos enviados en la solicitud no cumplen con el esquema requerido.",
      "statusCode": 400,
      "details": [
        {
          "field": "",
          "message": "Expected object, received string",
          "code": "invalid_type"
        }
      ]
    }
  }
  ```
- **Backend Exception Stack Trace:**
  `ZodError: [{"code":"invalid_type","expected":"object","received":"string","path":[],"message":"Expected object, received string"}] at ZodObject.parse (.../zod/v3/types.cjs:120:22) at backend/src/interfaces/http/routes/audio.routes.ts:108:42`

---

## 4. Exact Code Changes Applied

| File | Summary of Changes |
| :--- | :--- |
| [`frontend/src/core/api/api-client.ts`](../../frontend/src/core/api/api-client.ts) | Added `headers: { 'Content-Type': 'application/json' }` and clean optional field serialization in `uploadSongAudio()`; updated `refreshSession()` to throw `await ApiError.fromResponse(res)`; added `registerAuthFailureListener()` and notification on refresh failure inside `fetchWithAuth()`. |
| [`frontend/src/core/offline/offline-session-identity.ts`](../../frontend/src/core/offline/offline-session-identity.ts) | Expanded `isServerAuthRejectionError()` to recognize `TOKEN_INVALID`, `TOKEN_EXPIRED`, `INVALID_CREDENTIALS`, `ACCOUNT_LOCKED`, and Spanish refresh cookie/token rejection messages. |
| [`frontend/src/core/auth/auth-context.tsx`](../../frontend/src/core/auth/auth-context.tsx) | Subscribed `AuthProvider` to `apiClient.registerAuthFailureListener()` so failed token refresh during any protected request immediately clears stale auth state and transitions to `UNAUTHENTICATED`. |
| [`frontend/src/core/conversion/audio-signature.ts`](../../frontend/src/core/conversion/audio-signature.ts) | Added offset support in `parseId3v2TotalSize()`, chained ID3v2 tag traversal (up to 4 tags), 128 KiB post-ID3 MPEG frame scan window, and extended MIME alias family mapping. |
| [`frontend/src/components/conversion/ConversionCenterWorkspace.tsx`](../../frontend/src/components/conversion/ConversionCenterWorkspace.tsx) | Replaced byte-by-byte string concatenation with chunked `uint8ArrayToBase64()`, added `inferAudioMimeTypeFromFilename()`, validated `selectedSongId` & `user` before upload, and rendered an explicit `role="alert"` error banner inside `.audio-preservation-panel` when `conversionStatus === 'IDLE'`. |
| [`backend/src/interfaces/http/routes/audio.routes.ts`](../../backend/src/interfaces/http/routes/audio.routes.ts) | Added `AUDIO_UPLOAD_HTTP_BODY_LIMIT` (`80 MiB`), scoped `multipart/form-data` buffer parser, `parseMultipartFormDataUpload()`, `normalizeAudioUploadPayload()` (handling `application/json`, `multipart/form-data`, and JSON-over-`text/plain`), and structured diagnostic logging (`AUDIO_PRESERVATION_STARTED` / `COMPLETED` / `REJECTED`). |
| [`backend/src/interfaces/http/routes/auth.routes.ts`](../../backend/src/interfaces/http/routes/auth.routes.ts) | Extracted `handleRefreshSession` and registered both `POST /api/v1/auth/refresh` and `GET /api/v1/auth/refresh` with identical HttpOnly cookie validation and token rotation. |
| [`backend/src/application/audio-service.ts`](../../backend/src/application/audio-service.ts) | Expanded `ALLOWED_MIME_TYPES` and `CANONICAL_MIME_MAP` (stripping `; codecs=...`), added single-flight coalescing (`inFlightUploadsByKey`) and completed-upload idempotency verification (checking disk existence + size + SHA-256 before returning an existing asset). |
| [`backend/src/domain/audio/audio-signature-validator.ts`](../../backend/src/domain/audio/audio-signature-validator.ts) | Added offset-capable `parseId3v2TotalSize()`, chained ID3v2 header traversal, 128 KiB post-ID3 MPEG frame scan window, and extended MIME alias mapping. |

---

## 5. Security & Integrity Verification

1. **Authentication & RBAC Preserved:** `POST /api/v1/songs/:songId/audio` enforces `authGuard.requirePermission('songs:create', true)` with real-time PostgreSQL user status/lockout verification. Unauthenticated requests return `401`; `MUSICIAN` and `READ_ONLY` roles return `403`.
2. **Binary & Cryptographic Integrity:** Raw audio bytes are never decoded as text; SHA-256 is computed over the exact binary buffer, persisted in `audio_assets.checksum_sha256`, written atomically via `.tmp` + `datasync` + `rename` + `chmod 0o444`, and re-verified on download, stream, and retry idempotency.
3. **Storage Failure Compensation & Durable Recovery:** If worker verification or DB insertion fails after writing the physical file, `AudioService.uploadAudio()` deletes the physical file and attaches a structured `AudioUploadCompensationReport`; if physical cleanup fails, a durable `AUDIO_UPLOAD_COMPENSATION_FAILED` record is written to PostgreSQL `audit_logs` for startup/admin reconciliation.
4. **Canonical Music Protection:** Audio preservation operates exclusively on `audio_assets` and never mutates `songs` or `song_versions` canonical musical notation.

---

## 6. Regression Test Matrix (Section 8 — Scenarios 1 to 13)

| # | Scenario | Test Location | Verdict |
| :--- | :--- | :--- | :--- |
| **1** | Valid MP3 preservation (`El Señor Está en Este Lugar.mp3`, JSON, `multipart/form-data`, chained ID3v2) | `audio-preservation-and-worker.test.ts` (`22.1`) & `auth-lifecycle-and-admin.test.ts` (`10`) | **PASS** |
| **2** | Invalid song identifier (malformed UUID -> `400`; non-existent UUID -> `404`) | `audio-preservation-and-worker.test.ts` (`22.2`) | **PASS** |
| **3** | Missing or malformed multipart field / boundary / non-JSON body -> `400 VALIDATION_ERROR` | `audio-preservation-and-worker.test.ts` (`22.3`) | **PASS** |
| **4** | Invalid MIME/signature combination (WAV declared as MP3, spoofed bytes) -> `400` | `audio-preservation-and-worker.test.ts` (`22.4`) | **PASS** |
| **5** | Oversized upload exceeding quota -> `400 VALIDATION_ERROR` with zero orphan files | `audio-preservation-and-worker.test.ts` (`22.5`) | **PASS** |
| **6** | Unauthorized user (missing token -> `401`; `MUSICIAN` role -> `403`) | `audio-preservation-and-worker.test.ts` (`22.6`) | **PASS** |
| **7** | Expired session and successful refresh (`GET`/`POST /api/v1/auth/refresh`) followed by upload -> `201` | `audio-preservation-and-worker.test.ts` (`22.7`) | **PASS** |
| **8** | Failed refresh (`401`) and safe frontend session invalidation (`isServerAuthRejectionError` + listener) | `audio-preservation-and-worker.test.ts` (`22.8`) & `auth-lifecycle-and-admin.test.ts` (`11`, `12`) | **PASS** |
| **9** | Database failure with physical storage compensation (`compensation.succeeded === true`, zero orphans) | `audio-preservation-and-worker.test.ts` (`22.9`, `18.1`, `18.2`) | **PASS** |
| **10** | Physical storage failure without false database success (`dbCreateCalled === false`) | `audio-preservation-and-worker.test.ts` (`22.10`) | **PASS** |
| **11** | Duplicate request/retry idempotency (concurrent single-flight + sequential retry -> 1 row, 1 file) | `audio-preservation-and-worker.test.ts` (`22.11`) | **PASS** |
| **12** | SHA-256 verification and durable recovery reconciliation | `audio-preservation-and-worker.test.ts` (`22.12`, `19.1`–`19.5`) | **PASS** |
| **13** | HTTP Range streaming (`200` and `206 Partial Content`) after successful preservation | `audio-preservation-and-worker.test.ts` (`22.13`) | **PASS** |

---

## 7. Residual Limitations

1. **Base64 JSON Overhead vs Multipart:** While `POST /api/v1/songs/:songId/audio` now supports both `application/json` (up to `80 MiB` HTTP body for `50 MiB` raw audio) and binary `multipart/form-data`, the browser `uploadSongAudio()` client uses JSON Base64 for backward compatibility with existing response interceptors and offline mutation guards.
2. **Production Persistent Volume Durability:** As documented in Gate 1, production persistent volume snapshotting/replication for `AUDIO_STORAGE_PATH` remains **`NOT PRODUCTION VERIFIED`**.
3. **Scope Boundary:** WS-AUDIO-01 only preserves, verifies, and streams audio for the Digital Music Stand; harmonic analysis (WS-AUDIO-02) and melodic/polyphonic transcription (WS-AUDIO-03) remain unimplemented pending Gate 1 Project Owner sign-off.

