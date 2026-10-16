# Bethesda Worship Studio — First-Release Reading View Implementation Report

**Project:** Bethesda Worship Studio  
**Organization:** Iglesia Cristiana Bethesda — Madrid, Cundinamarca, Colombia  
**Document Classification:** Technical Implementation Report  
**Work Package:** First-Release Priority 1 — Musician-Selectable Reading Views with Authenticated Persistence  
**Governance Authority:** Explicit Project Owner Authorization  
**Proposal Reference:** `WORSHIP_STUDIO_PROPUESTA DE AVANCE.pdf` (p. 10, Idea 4: Formato de Lectura / Partitura, Cifrado, Tablatura)  
**Date:** October 16, 2026  
**Auditor / Implementer:** Antigravity (Senior Frontend & Music Systems Architect)  
**Starting Commit SHA:** `6477e18e8ba894940713b20365615a685734cf9e`  
**Deliverable Path:** `docs/reports/WORSHIP_STUDIO_FIRST_RELEASE_READING_VIEW_IMPLEMENTATION_REPORT.md`  

---

## 1. Executive Summary

This report documents the completed implementation of the **First-Release Priority 1** requirement defined in `WORSHIP_STUDIO_PROPUESTA DE AVANCE.pdf` and authorized by the Project Owner.

Musicians interacting with the digital music stand (`Atril Digital`) can now:
1. Select among **4 supported music-reading formats** directly in the workspace controls:
   - **Partitura (Staff Notation):** Standard notation or grand staff.
   - **Cifrado con Letra (Chord Chart + Lyrics):** Syllable-aligned chord lead sheet.
   - **Letra Sola (Lyrics Only):** Vocal and worship leader reading format.
   - **Tablatura (Guitar Tablature):** Fretboard tablature for tuned string instruments.
2. Inspect format availability driven strictly by **canonical song data and instrument capabilities** with **zero synthetic/fabricated musical data**.
3. Persist their preferred reading format to PostgreSQL via the authenticated **WP-02 User Preferences API** (`/api/v1/users/me/preferences`).
4. Experience automatic loading and application of their preferred format on subsequent song and setlist visits.

---

## 2. Music-Reading Format Matrix & Availability Engine

### 2.1 The 4 Supported Formats

| Format Key | Name in Spanish | Canonical Primary Representation | Required Secondary Representations | Song Data Prerequisites | Instrument Capability Prerequisites |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `STAFF` | **Partitura** | `STANDARD_NOTATION` (or `GRAND_STAFF` for piano) | None (Chords optional overlay) | $\ge 1$ Melodic Note (`voices.notes.length > 0`) | Instrument supports `STANDARD_NOTATION` or `GRAND_STAFF` |
| `CHORDS_LYRICS` | **Cifrado con Letra** | `CHORDS` | `LYRICS` | $\ge 1$ Chord Event AND $\ge 1$ Lyric Syllable | Instrument supports `CHORDS` and `LYRICS` |
| `LYRICS_ONLY` | **Letra Sola** | `LYRICS` | None | $\ge 1$ Lyric Syllable (`lyrics.length > 0`) | Instrument supports `LYRICS` |
| `TABLATURE` | **Tablatura** | `TABLATURE` | None | $\ge 1$ Musical Note (`voices.notes.length > 0`) | Instrument has string tuning (`tuning !== undefined`) and supports `TABLATURE` |

### 2.2 Strict Invariant: Zero Fabricated Musical Content

A core architectural invariant mandates that Bethesda Worship Studio **never fabricates musical data**:
- **Pure Lead Sheet (0 melody notes):** If a song was imported from a ChordPro file or text lead sheet lacking melodic pitch data, the **Partitura** and **Tablatura** buttons are deterministically disabled. The UI displays an informative badge/tooltip: *"La canción no contiene notas de melodía registradas (Lead Sheet puro)"*.
- **Instrumental Song (0 lyrics):** If a prelude, interlude, or instrumental arrangement has no text, the **Letra Sola** button is disabled with tooltip: *"La canción no contiene letra registrada"*.
- **Non-String Instruments:** If the active instrument is Piano, Saxophone, or Lead Vocals, **Tablatura** is disabled with tooltip: *"La tablatura solo está disponible para instrumentos de cuerda con afinación definida (Guitarra, Bajo)"*.

---

## 3. Preference Persistence & Architecture Flow

### 3.1 WP-02 API Reuse (Single Source of Truth)

Rather than inventing duplicate storage, the frontend reuses the authenticated endpoints established in **WP-01** and **WP-02**:
- **Read:** `GET /api/v1/users/me/preferences`
- **Write:** `PUT /api/v1/users/me/preferences`

```
┌────────────────────────────────────────────────────────────────────────┐
│                          Atril Digital (Frontend)                      │
│                                                                        │
│  [ ReadingFormatSelector ] ──► onChange(format)                        │
│             │                                                          │
│             ▼                                                          │
│   useMusicalWorkspace                                                  │
│   ├── setReadingFormat() ────────► Ephemeral View Projection           │
│   │                                (Canonical payload unchanged)       │
│   │                                                                    │
│   └── handleSavePreference() ────► BethesdaApiClient.updateUserPrefs() │
└───────────────────────────────────────────────┬────────────────────────┘
                                                │ PUT /api/v1/users/me/preferences
                                                │ Authorization: Bearer <jwt>
                                                ▼
┌────────────────────────────────────────────────────────────────────────┐
│                          Fastify HTTP Backend                          │
│                                                                        │
│   authMiddleware                                                       │
│   ├── Verify HS256 JWT signature                                       │
│   └── Derive userId = request.user.sub (Server-side identity)          │
│                                                                        │
│   userPreferencesRoutes (PUT)                                          │
│   ├── Zod Schema Validation (updateUserPreferencesSchema)              │
│   └── DrizzleUserPreferencesRepository.upsert(userId, payload)         │
│                                                                        │
│   PostgreSQL (user_view_preferences table)                             │
│   └── Atomic UPSERT on UNIQUE (user_id)                                │
└────────────────────────────────────────────────────────────────────────┘
```

### 3.2 Server-Side Security & Identity Isolation (Anti-IDOR)
- **Zero Client-Supplied User IDs:** The HTTP request payload strictly excludes any `userId`.
- **Server Identity Derivation:** Identity is extracted exclusively from the cryptographically verified JWT payload (`request.user.sub`).
- **User Isolation:** An authenticated user cannot read, overwrite, or mutate another user's preferred format.

### 3.3 Default Application Lifecycle
1. When `MusicalWorkspace` mounts, an effect issues `GET /api/v1/users/me/preferences` via `BethesdaApiClient`.
2. Upon receiving the persisted record:
   - The primary representation is mapped to the corresponding reading format.
   - If the active song supports the user's preferred format, it is projected immediately.
   - If the active song does not have source data for that format (e.g., user prefers Partitura, but song is Lead Sheet), the system falls back safely to the highest available fidelity (`CHORDS_LYRICS`) without crashing or corrupting state.
3. The musician can freely switch reading formats during rehearsal or service.
4. Clicking **"★ Guardar como preferida"** persists the currently active format and instrument setup to PostgreSQL.

---

## 4. Source Files Created & Modified

| File Path | Status | Purpose |
| :--- | :--- | :--- |
| `frontend/src/core/api/preference-types.ts` | **Created** | TypeScript interfaces for preference contracts matching backend DTOs |
| `frontend/src/core/api/api-client.ts` | **Modified** | Added `getUserPreferences()` and `updateUserPreferences()` methods |
| `frontend/src/components/workspace/ReadingFormatSelector.tsx` | **Created** | Accessible 4-button selector card with data validation, tooltips, and save trigger |
| `frontend/src/components/workspace/MusicalControls.tsx` | **Modified** | Integrated `ReadingFormatSelector` into workspace control panel |
| `frontend/src/components/workspace/MusicalWorkspace.tsx` | **Modified** | Connected API client, orchestrator transitions, and preference persistence |
| `frontend/src/components/workspace/index.ts` | **Modified** | Exported `ReadingFormatSelector` |
| `frontend/src/core/workspace/use-musical-workspace.ts` | **Modified** | Implemented `setReadingFormat()` and `applyUserPreference()` actions |
| `frontend/src/index.css` | **Modified** | Responsive styling for format buttons, tooltips, and save feedback banners |

---

## 5. Automated Test Coverage & Invariant Verification

Two dedicated test suites were implemented and executed:

1. **`frontend/src/core/api/__tests__/user-preferences-api-client.test.ts` (3 tests):**
   - Verified HTTP `GET /api/v1/users/me/preferences` headers and payload deserialization.
   - Verified HTTP `PUT /api/v1/users/me/preferences` payload dispatch and updated state return.
   - Verified graceful handling and structured error propagation for unauthenticated requests.

2. **`frontend/src/core/workspace/__tests__/reading-format-selector.test.ts` (6 tests):**
   - Verified format compatibility for full score (Guitar): all 4 formats available.
   - Verified invariant: Lead Sheet Puro disables Partitura and Tablatura with clear reasons.
   - Verified invariant: Tablatura is disabled for non-string instruments (Piano, Sax, Voice).
   - Verified invariant: Instrumental song disables Lyrics-only format.
   - Verified non-negotiable invariant: **Strict immutability of `CanonicalMusicPayload`** when switching reading views.
   - Verified orchestrator projection applying persisted user preference with high fidelity.

---

## 6. Boundaries & Excluded Capabilities

As mandated by project governance:
- **Offline / PWA caching:** Excluded.
- **Auto-scroll synchronized to tempo:** Excluded.
- **Bluetooth foot pedal integration:** Excluded.
- **Interactive score note editing:** Excluded.
- **Audio playback / Multitracks / Metronome:** Excluded.
- All Phase 3B/3C and WP-04/WP-05 items remain unauthorized.
