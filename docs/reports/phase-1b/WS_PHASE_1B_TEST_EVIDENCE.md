# BETHESDA WORSHIP STUDIO — PHASE 1B
## EVIDENCIA DE PRUEBAS AUTOMATIZADAS Y CERTIFICACIÓN TÉCNICA
**Documento:** `WS_PHASE_1B_TEST_EVIDENCE.md`  
**Ruta:** `docs/reports/phase-1b/WS_PHASE_1B_TEST_EVIDENCE.md`  
**Fase:** Phase 1B — Universal Music Ingestion, Canonical Music Pipeline & Multi-Format Conversion  
**Fecha de Ejecución:** 2026-11-05  
**Entorno de Pruebas:** Node.js v24.12.0, PostgreSQL 18, Windows 11, Fastify v4  
**Resultado Global:** 100% EXITOSO (0 FALLOS, 0 REGRESIONES)

---

### 1. RESUMEN EJECUTIVO DE EJECUCIÓN

Todas las pruebas automatizadas diseñadas para la Fase 1B, así como las suites de regresión del backend y del frontend, fueron ejecutadas contra la base de datos real PostgreSQL (`bethesda_worship_test`) y el entorno de compilación TypeScript estricto.

```
+-------------------------------------------------------------------------------+
| MATRIZ DE CERTIFICACIÓN AUTOMATIZADA DE PRUEBAS                              |
+------------------------------------------------------+---------+-------+------+
| Suite de Pruebas                                     | Total   | Pasa  | Falla|
+------------------------------------------------------+---------+-------+------+
| Phase 1B Universal Music Ingestion Suite             | 25      | 25    | 0    |
| Phase 2A Round-Trip Integrity Suite                  | 2       | 2     | 0    |
| Document Ingestion & Storage Suite                   | 31      | 31    | 0    |
| OMR End-to-End Authentication & Provenance Suite     | 24      | 24    | 0    |
| OMR Persistence, Audit Immutability & Integrity Suite| 68      | 68    | 0    |
| Multitracks & OMR Suite (Workstream D)               | 29      | 29    | 0    |
+------------------------------------------------------+---------+-------+------+
| TOTAL BACKEND                                        | 179     | 179   | 0    |
+------------------------------------------------------+---------+-------+------+
| TOTAL FRONTEND (Atril, Transposición, Setlists, OMR) | 426     | 426   | 0    |
+------------------------------------------------------+---------+-------+------+
| CONSOLIDADO GLOBAL                                   | 605     | 605   | 0    |
+------------------------------------------------------+---------+-------+------+
```

---

### 2. DESGLOSE DETALLADO DE LA SUITE DE FASE 1B (`universal-ingestion-phase1b.test.ts`)

**Comando ejecutado:**
```powershell
cd backend; npx tsx --env-file=.env --test src/__tests__/universal-ingestion-phase1b.test.ts
```

#### 2.1 Workstream B1: MusicXML Ingestion & Security
- `✔ B1.1: should import valid MusicXML via POST /upload and persist canonical song` (42.18ms)
  - Valida la conversión completa de XML musical a canción canónica con compases, métrica 4/4, tempo 105 BPM, tonalidad Sol Mayor (`G Mayor`) y 3 notas en la voz 1.
- `✔ B1.2: should strictly reject MusicXML containing XXE entity injection` (14.67ms)
  - Valida el bloqueo preventivo de directivas `<!DOCTYPE>` con `<!ENTITY>` maliciosas (`VALIDATION_ERROR`, HTTP 400).
- `✔ B1.3: should reject malformed MusicXML with missing root element` (6.59ms)
  - Valida el rechazo de XML con elementos raíz no reconocidos.

#### 2.2 Workstream B2: Standard MIDI File (SMF) Parsing & Normalization
- `✔ B2.1: should parse Format 0 MIDI file, extract notes, tempos and time signature` (0.98ms)
  - Valida la decodificación de eventos `MThd`, `MTrk`, `0x51` (Tempo), `0x58` (Métrica) y mensajes Note-On/Note-Off.
- `✔ B2.2: should normalize MIDI with non-480 division (e.g. 96 TPQN) into 480 TPQN exactly` (0.33ms)
  - Valida el reescalado temporal proporcional sin errores de truncamiento.
- `✔ B2.3: should parse Format 1 Multi-track MIDI and separate instrument tracks` (18.57ms)
  - Valida la separación de pistas independientes en `InstrumentTrack` con familia `KEYS`.
- `✔ B2.4: should guarantee ZERO note fabrication: no fake chords or lyrics added in MIDI` (11.96ms)
  - Valida que la importación MIDI nunca sintetiza acordes ni texto lírico fantasma.

#### 2.3 Workstream B3: ChordPro Ingestion & Alignment
- `✔ B3.1: should import ChordPro and preserve chord/lyric relationships` (14.57ms)
  - Valida la extracción de acordes y texto con preservación de tonalidad Re Mayor (`D Mayor`) y BPM 72.
- `✔ B3.2: should maintain ZERO fake melody notes for ChordPro (LeadSheet invariant)` (15.46ms)
  - Valida que para todos los compases y voces, el número de notas melódicas es exactamente 0 (`totalNotes === 0`).

#### 2.4 Workstream B4: Written Musical Notes Manual Ingestion
- `✔ B4.1: should accept structured note entry and produce valid canonical song` (11.78ms)
  - Valida la creación de canción desde payload JSON con pasos tonales, octavas, figuras y acordes.
- `✔ B4.2: should reject invalid note step letter (X) with ValidationError` (2.85ms)
  - Valida el rechazo de letras no musicales mediante la regla estricta `^[A-G]$`.
- `✔ B4.3: should reject out-of-range octave (15)` (2.24ms)
  - Valida el límite acústico $0 \le \text{octava} \le 9$.

#### 2.5 Workstream C: PDF & Image Score Ingestion
- `✔ C1.1: should inspect and store legitimate PDF score with SHA-256 and report RECOGNITION_UNAVAILABLE` (8.32ms)
  - Valida la inspección de cabecera `%PDF-`, cálculo de digest SHA-256 y stub honesto con 0 notas inventadas.
- `✔ C1.2: should inspect legitimate PNG image score and preserve original file` (7.02ms)
  - Valida la detección de firma mágica PNG y almacenamiento inmutable.
- `✔ C1.3: should reject MIME spoofing: HTML disguised as PDF` (5.20ms)
  - Valida el bloqueo de archivos con extensión engañosa que no cumplen la firma binaria real.

#### 2.6 Workstream D: Audio Ingestion & Video URL SSRF Defense
- `✔ D1.1: should inspect WAV audio and report RECOGNITION_UNAVAILABLE without fake notes` (7.09ms)
  - Valida la cabecera `RIFF...WAVE`, cálculo de duración y respuesta honesta sin fabricación melódica.
- `✔ D1.2: should accept authorized YouTube URL and register video reference` (11.34ms)
  - Valida la aceptación de URLs legítimas de YouTube.
- `✔ D1.3: should strictly block SSRF attempt to localhost (127.0.0.1)` (5.47ms)
  - Valida el bloqueo de direcciones de bucle local.
- `✔ D1.4: should strictly block SSRF attempt to AWS/Cloud Metadata (169.254.169.254)` (5.06ms)
  - Valida el bloqueo de IPs de metadatos de computación en la nube.
- `✔ D1.5: should reject non-whitelisted domain (malicious-site.com)` (4.57ms)
  - Valida la restricción a dominios en lista blanca.

#### 2.7 Workstream H: Security, Idempotency & Tenant Boundaries
- `✔ H1.1: should reject unauthenticated requests to POST /upload with 401 Unauthorized` (2.65ms)
  - Valida la protección del endpoint con `authGuard`.
- `✔ H1.2: should reject Base64 payload exceeding MAX_OMR_BASE64_LENGTH with ValidationError` (54.90ms)
  - Valida el límite de cuota de 15 MiB en la capa Fastify.
- `✔ H1.3: should detect duplicate upload and return existing song (Idempotency)` (11.47ms)
  - Valida que una carga idéntica reutiliza la canción previa sin duplicar datos en PostgreSQL.
- `✔ H1.4: should reject cross-user access to another user background job (IDOR Prevention)` (3.59ms)
  - Valida que un usuario ordinario o director de alabanza recibe `403 Forbidden` al consultar la tarea de otro usuario.
- `✔ H1.5: should allow owner to query their own background job` (3.25ms)
  - Valida que el propietario de la tarea consulta exitosamente su progreso (`200 OK`).

---

### 3. VERIFICACIÓN ESTÁTICA Y DE TIPOS

#### 3.1 Backend
```powershell
cd backend; npm run typecheck; npm run build
```
- **Salida:**
  - `tsc --noEmit`: 0 errores.
  - `tsc`: Compilación limpia a `dist/`.
  - Código de salida: `0`.

#### 3.2 Frontend
```powershell
cd frontend; npm run typecheck; npm test -- --run
```
- **Salida:**
  - `tsc --noEmit`: 0 errores.
  - `node --test`: 426 pruebas aprobadas en 66 suites, 0 fallos.
  - Código de salida: `0`.

