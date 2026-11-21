# BETHESDA WORSHIP STUDIO — PHASE 1B-R
## PREFLIGHT, RECONCILIACIÓN Y LÍNEA BASE DE REMEDIACIÓN
**Documento:** `WS_PHASE_1B_R_PREFLIGHT_AND_BASELINE.md`  
**Ruta:** `docs/reports/phase-1b-r/WS_PHASE_1B_R_PREFLIGHT_AND_BASELINE.md`  
**Fase:** Phase 1B-R — Source Preservation, Musical Fidelity & Ingestion Reliability Remediation  
**Rama:** `feature/phase-1a-core-foundation`  
**Commit HEAD:** `ba9780a` (`PHASE 1B: UNIVERSAL MUSIC INGESTION, CANONICAL MUSIC PIPELINE & MULTI-FORMAT CONVERSION`)  
**Fecha de Emisión:** 2026-11-05  
**Modo de Ejecución:** CONTROLLED ENGINEERING IMPLEMENTATION (STRICT ZERO COMMITS / ZERO PUSHES)

---

### 1. DIAGNÓSTICO PRE-VUELO DE GIT Y ENTORNO

#### 1.1 Estado del Repositorio y Git Tree
- **Rama activa:** `feature/phase-1a-core-foundation`
- **Seguimiento remoto:** `origin/feature/phase-1a-core-foundation` (en sincronía exacta al inicio).
- **Commit HEAD verificado:** `ba9780a01d49d8a87af4a5ed59eeeba0aedd086f`
- **Árbol de trabajo:** Limpio (`nothing to commit, working tree clean`) al momento del inicio.
- **Entorno de ejecución:**
  - Node.js: `v24.12.0`
  - PostgreSQL: `18` (puerto 5432, base de datos `bethesda_worship_test` y `bethesda_worship_dev`)
  - Sistema Operativo: Windows 11
  - Shell: PowerShell 7

#### 1.2 Historial Reciente de Commits
```
ba9780a (HEAD -> feature/phase-1a-core-foundation, origin/feature/phase-1a-core-foundation) PHASE 1B: UNIVERSAL MUSIC INGESTION, CANONICAL MUSIC PIPELINE & MULTI-FORMAT CONVERSION
a2dd18f PHASE 1A-R3.2 INFORME TÉCNICO DE CIERRE DE DEFECTOS Y READINESS GATE PARA CERTIFICACIÓN INDEPENDIENTE
fe10653 FINAL DEFECT CLOSURE, SECURITY HARDENING & INDEPENDENT CERTIFICATION READINESS
c16b0ef PHASE 1A-R3: FINAL REMEDIATION REPORT
161bb47 PHASE 1A-R2: EXECUTIVE REMEDIATION SUMMARY
```

---

### 2. MATRIZ DE DEFECTOS IDENTIFICADOS EN LA AUDITORÍA DE FASE 1B

A partir de la inspección exhaustiva del código fuente en `backend/src/domain/ingestion/` y `backend/src/application/universal-ingestion-service.ts`, se identificaron los siguientes diez (10) defectos críticos y de alta prioridad:

| ID Defecto | Workstream | Módulo Afectado | Descripción del Hallazgo | Impacto y Severidad |
| :--- | :--- | :--- | :--- | :--- |
| **DEF-01** | Workstream A | Ingesta Estructurada (`musicxml`, `midi`, `chordpro`, `written-notes`) | Las fuentes estructuradas no guardaban el archivo original en `SourceStorageProvider`; solo se procesaban en memoria. | **ALTO:** Pérdida del archivo fuente original; no cumple el principio de preservación incondicional. |
| **DEF-02** | Workstream A & H | Base de Datos (`song_sources`) | La tabla `song_sources` requería obligatoriamente `song_id NOT NULL` y carecía de columnas para `user_id`, `storage_path`, `mime_type`, `file_size_bytes` y `checksum_sha256`. | **CRÍTICO:** Los archivos no estructurados (PDF, audio, video) no se persistían en PostgreSQL; carencia de propiedad de usuario. |
| **DEF-03** | Workstream E | `UniversalIngestionService.ingest` | La comprobación de idempotencia (`matchCriteria`) buscaba duplicados globalmente sin filtrar por `user_id`. | **CRÍTICO:** Violación de aislamiento multi-inquilino. Si el usuario B subía el mismo archivo que el usuario A, se le retornaba la canción privada del usuario A. |
| **DEF-04** | Workstream B | Todos los adaptadores y orquestador | Valores musicales asumidos por defecto sin evidencia: `defaultKey: 'C'`, `timeSignature: '4/4'`, `defaultBpm: 120`. | **ALTO:** Violación del principio de integridad musical ("Zero Note Guessing" e información desconocida explícita). |
| **DEF-05** | Workstream C | `midi-parser.ts` (Línea 357) | Las notas sin evento Note-Off recibían automáticamente una duración fabricada de una negra (`division`). | **ALTO:** Fabricación de información musical inexistente en el archivo MIDI. |
| **DEF-06** | Workstream C | `midi-parser.ts` & `midi-adapter.ts` | Duración mínima artificial de 15 ticks (`Math.max(15, ...)`). Truncamiento silencioso de notas en los límites de compás. | **ALTO:** Modificación espuria de la interpretación rítmica y duración de notas sostenidas. |
| **DEF-07** | Workstream C | `midi-adapter.ts` | Ignoraba cambios de métrica (*time signature*) entre compases; asumía un compás global idéntico para toda la secuencia. | **MEDIO-ALTO:** Pérdida de métrica variable en obras musicales litúrgicas complejas. |
| **DEF-08** | Workstream D | `video-url-adapter.ts` | Retornaba `status: 'CONVERTED'` y creaba una canción canónica vacía con clave Do Mayor, 120 BPM y 4/4 para una URL de YouTube. | **CRÍTICO:** Confusión semántica entre referencia de video y partitura musical convertida. |
| **DEF-09** | Workstream D | `audio-adapter.ts` | No realizaba validación profunda de coherencia entre tipo MIME declarado y contenido binario real. | **MEDIO:** Vulnerabilidad de suplantación MIME si un atacante sube ejecutables con extensión `.wav`. |
| **DEF-10** | Workstream F & E | Rutas HTTP (`ingestion.routes.ts`) | No existían endpoints para que los usuarios autenticados descargaran o consultaran de forma segura sus fuentes originales preservadas con control IDOR. | **ALTO:** Imposibilidad de auditar o recuperar los archivos originales cargados. |

---

### 3. PLAN DE ACCIÓN DE REMEDIACIÓN

1. **Migración de Base de Datos (Workstream H):** Crear `0012_source_preservation_and_ownership.sql` haciendo `song_sources.song_id` nullable y añadiendo `user_id`, `storage_path`, `mime_type`, `file_size_bytes`, `checksum_sha256` y `job_id`.
2. **Contrato Universal de Preservación (Workstream A):** Modificar `UniversalIngestionService` para almacenar incondicionalmente en `SourceStorageProvider` todo archivo recibido (binario, texto o JSON estructurado) y registrarlo de inmediato en `song_sources` vinculado al `user.id`.
3. **Aislamiento Multi-inquilino e Idempotencia (Workstream E):** Restringir la búsqueda de idempotencia al `user.id` actual. Incorporar endpoints de consulta y descarga de fuentes (`GET /sources/:sourceId` y `GET /sources/:sourceId/file`) con verificación de propiedad.
4. **Eliminación de Valores Inventados (Workstream B):** Actualizar todos los adaptadores para que los metadatos musicales ausentes sean estrictamente `null` (clave tonal, tempo, métrica), registrando diagnósticos de campo no resuelto.
5. **Corrección Integral del Parser MIDI (Workstream C):**
   - Eliminar `Math.max(15, ...)`.
   - Manejar notas sin Note-Off extendiéndolas hasta el final del track o marcándolas con diagnóstico `UNMATCHED_NOTE_ON`, sin fabricar negras.
   - Soportar notas que cruzan compases dividiéndolas con ligaduras musicales canónicas (`tie: 'START'` / `tie: 'STOP'`).
   - Soportar cambios de métrica y tempo dinámicos.
   - Proteger la decodificación VLQ contra bucles infinitos o secuencias malformadas (> 4 bytes).
6. **Semántica de Video y Audio (Workstream D):**
   - Video URL: estado `SOURCE_PRESERVED` / `REGISTERED`, sin notas, sin clave falsa, sin canción canónica creada.
   - Audio: comprobación binaria estricta de coherencia MIME y estado `SOURCE_PRESERVED`.
7. **Suite de Pruebas y Reportes (Workstreams I y J):** Implementar la suite exhaustiva de remediación `universal-ingestion-phase1b-r.test.ts` y redactar los 9 informes requeridos.

