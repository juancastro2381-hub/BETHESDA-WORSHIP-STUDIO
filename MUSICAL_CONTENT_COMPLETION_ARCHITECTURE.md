# MUSICAL CONTENT COMPLETION ARCHITECTURE
## Bethesda Worship Studio — Evolución Funcional Audio Scope 1C & Atril Digital

**Fecha:** 2026-11-16  
**Rama:** `feature/phase-1a-core-foundation`  
**Alcance:** Completitud controlada de contenido musical faltante y habilitación inteligente de los 4 formatos del Atril Digital (`PARTITURE`, `CHORDS_WITH_LYRICS`, `LYRICS_ONLY`, `TABLATURE`) bajo el principio rector de **Cero Fabricación**.

---

## 1. Principio Arquitectónico Rector: Cero Fabricación + Autoridad en Backend

Bethesda Worship Studio distingue estrictamente entre:

1. **Formato preferido del músico (`user_view_preferences`)**: preferencia individual persistida por instrumento y usuario. Nunca se sobrescribe ni se borra cuando una canción específica no tiene el contenido requerido.
2. **Disponibilidad real de la obra (`StandFormatCapabilityDescriptor`)**: evaluación determinista calculada sobre el `CanonicalMusicPayload` vigente de la versión activa de la canción y el `InstrumentProfile` activo.

Reglas invariantes:

- **Prohibido fabricar contenido musical**: ningún adaptador, proyector ni controlador puede inventar notas melódicas desde acordes, acordes desde letra, letra desde reconocimiento automático sin confirmación humana, ni posiciones de traste únicas cuando un acorde o nota ambigua no está verificada.
- **Autoridad del Backend**: aunque `frontend/src/core/workspace/stand-format-capabilities.ts` evalúa el modelo canónico de forma inmediata en cliente para vistas previas, el servidor (`backend/src/application/musical-content-completion-service.ts`) es la fuente autoritativa que valida fuentes, persiste propuestas, exige aprobación RBAC y genera nuevas versiones canónicas `v(N+1)`.
- **Cero migraciones de esquema de base de datos**: la evolución reutiliza las tablas PostgreSQL existentes (`songs`, `song_versions`, `song_sources`, `omr_proposals`, `audit_logs`, `audio_assets`).

---

## 2. Arquitectura por Capas

```text
+-----------------------------------------------------------------------------------+
| UI & Atril Digital (Frontend React / Pure TS)                                     |
| - MusicalWorkspace.tsx                                                            |
| - ReadingFormatSelector (reading-format-selector-component.ts)                    |
| - MusicalControls.tsx                                                             |
| - FormatCompletionWizardModal.tsx (con preservedDraftState en memoria del padre)   |
+-----------------------------------------+-----------------------------------------+
                                          |
                                          v
+-----------------------------------------------------------------------------------+
| Evaluador Unificado Compartido + Proyección Fiel                                  |
| - frontend/src/core/workspace/stand-format-capabilities.ts                        |
|   * StandFormatCapabilityResolver.summarizeContent()                              |
|   * StandFormatCapabilityResolver.evaluateAll()                                   |
|   * extractValidatedTablatureOverride()                                           |
| - frontend/src/core/projection/projection-service.ts                              |
|   * Honra note.notationMetadata.tablature antes de calcular heurística automática |
+-----------------------------------------+-----------------------------------------+
                                          | REST API /api/v1/songs/:songId/...
                                          v
+-----------------------------------------------------------------------------------+
| API HTTP Fastify + Validación Zod + RBAC                                          |
| - backend/src/interfaces/http/routes/song.routes.ts                               |
| - backend/src/interfaces/http/schemas/song.schemas.ts                             |
|   * GET  /api/v1/songs/:songId/format-capabilities                                |
|   * POST /api/v1/songs/:songId/completion/validate-preview                        |
|   * GET  /api/v1/songs/:songId/completion/proposals                               |
|   * POST /api/v1/songs/:songId/completion/proposals                               |
|   * POST /api/v1/songs/:songId/completion/proposals/:proposalId/review            |
+-----------------------------------------+-----------------------------------------+
                                          |
                                          v
+-----------------------------------------------------------------------------------+
| Servicio de Aplicación & Gobernanza de Versiones (Backend)                        |
| - backend/src/application/musical-content-completion-service.ts                   |
|   * MusicalContentCompletionService                                               |
|   * Preservación física/SHA-256 en SourceStorage + song_sources                   |
|   * Propuesta de revisión en omr_proposals (canonicalSongId = null, metadata JSON)|
|   * Publicación no destructiva en song_versions v(N+1) tras aprobación RBAC       |
|   * Auditoría en audit_logs                                                       |
+-----------------------------------------------------------------------------------+
```

---

## 3. Modelo de Datos y Estrategia de Persistencia (Sin Migraciones)

| Tabla existente | Rol en la completitud musical | Garantías de integridad |
| :--- | :--- | :--- |
| `song_sources` | Almacena la fuente aportada (`.musicxml`, `.mid`, `.cho`, `.txt`, `.tab`, JSON de notas escritas o `fretOverrides`) con ruta física y `checksumSha256`. | Preservación inmutable por SHA-256 mediante `LocalFileSystemSourceStorageProvider`; enlace a `versionId` al aprobarse. |
| `omr_proposals` | Almacena borradores de completitud con `reviewStatus = 'PENDING_REVIEW'`, `sourceHash`, `capabilitiesPreview` y `candidateCanonicalPayload`. | Usa `canonicalSongId: null` (al igual que `AudioTranscriptionService`) para evitar colisiones con el índice único `idx_omr_proposals_canonical_song_id` cuando existen múltiples propuestas para una misma canción; identifica la canción y tipo mediante `rawPayload.proposalType = 'MUSICAL_CONTENT_COMPLETION_DRAFT'` y `rawPayload.songId`. |
| `song_versions` | Mantiene historial lineal inmutable (`v1`, `v2`, `v3`, ..., `v(N+1)`). | Al aprobarse una propuesta (`APPROVED`), se crea una nueva fila con `versionNumber = max + 1` y nunca se sobrescriben ni modifican las versiones anteriores (`setAsCurrent` solo actualiza `isCurrent` y `songs.currentVersionId`). |
| `audio_assets` | Conserva intacto el audio original preservado (Scope 1C). | Nunca se modifica ni reemplaza el audio original al agregar partituras, letra o tablatura. |
| `audit_logs` | Traza `SONG_COMPLETION_PROPOSAL_CREATED`, `SONG_COMPLETION_PROPOSAL_APPROVED`, `SONG_COMPLETION_PROPOSAL_REJECTED` y `SONG_COMPLETION_CORRECTION_REQUESTED`. | Registro auditable de usuario, `proposalId`, `songId`, formato objetivo y hash de fuente. |

---

## 4. Preservación de Evidencia en Audio Scope 1C

Cuando la versión activa de una canción proviene de análisis de audio (como *El Señor Esta en Este Lugar*, `songId = d8f1d90f-0ec4-4053-b29f-1e73ccddb618`):

- Cada `ChordEvent` conserva su `evidenceStatus` (`DETECTED`, `ESTIMATED`, `AMBIGUOUS`, `HUMAN_VERIFIED`).
- `mergeChordsAndLyricsPreservingEvidence()` fusiona letra o compases nuevos sin promover automáticamente eventos armónicos `ESTIMATED` o `AMBIGUOUS` a `HUMAN_VERIFIED`.
- `mergeImportedNotationIntoSong()` incorpora pistas melódicas (`voices` con `Note`) conservando los acordes existentes del audio cuando la fuente importada no trae cifrado o combinando ambos en el `CanonicalMusicPayload` sin perder el audio original asociado.
- La aprobación solo promueve lo explicitado por el flujo revisado y siempre genera una versión nueva (`vN+1`).

---

## 5. Modelo RBAC y Transiciones de Propuesta

| Rol | Consultar capacidades y previsualizar (`validate-preview`) | Crear borrador/propuesta (`completion/proposals`) | Aprobar, rechazar o publicar versión `v(N+1)` (`review`) |
| :--- | :---: | :---: | :---: |
| `VIEWER` | Permitido (`songs:read`) | Bloqueado `403` (`songs:update_draft` requerido) | Bloqueado `403` |
| `MUSICIAN` | Permitido (`songs:read`) | Permitido (`songs:update_draft`) | Bloqueado `403` |
| `WORSHIP_LEADER` | Permitido | Permitido | Permitido |
| `ADMIN` | Permitido | Permitido | Permitido |
| `SUPER_ADMIN` | Permitido | Permitido | Permitido |

Estados de propuesta en `omr_proposals`:
- `PENDING_REVIEW` $\to$ `COMMITTED` (decisión `APPROVED`, crea versión `v(N+1)` y actualiza `songs.status = 'APPROVED'` si `setAsCurrent` es `true`).
- `PENDING_REVIEW` $\to$ `REJECTED` (decisión `REJECTED`, mantiene versión activa intacta).
- `REJECTED` $\to$ `APPROVED`: bloqueado con error HTTP `400 ValidationError` (exige crear una nueva propuesta corregida).
- `COMMITTED` $\to$ cualquier cambio: bloqueado con error HTTP `400 ValidationError`.

---

## 6. Experiencia UX sin Pérdida de Datos

`FormatCompletionWizardModal` recibe `preservedDraftState` y `onUpdateDraftState` elevados en `MusicalWorkspace`:

- Si un músico carga o digita letras, notas escritas, ChordPro, XML o ajustes de cuerda/traste y cierra temporalmente el modal con `↩️ Volver al Atril Digital` para inspeccionar el atril, su borrador en curso se conserva intacto en memoria mientras permanezca en la canción activa (solo se reinicia al cambiar de canción).
- La disponibilidad mostrada en `ReadingFormatSelector` separa claramente:
  - Banner informativo cuando el formato preferido del usuario no está disponible para la obra actual (`★ Tu formato preferido guardado ... no está disponible para esta obra porque falta contenido musical requerido; tu preferencia se conserva y el atril muestra temporalmente ...`).
  - Acciones contextuales en `.reading-format-completion-actions` para abrir directamente la pestaña del asistente correspondiente al formato faltante o en revisión.
