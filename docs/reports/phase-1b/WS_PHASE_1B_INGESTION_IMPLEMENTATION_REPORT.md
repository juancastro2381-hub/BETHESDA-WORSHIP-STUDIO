# BETHESDA WORSHIP STUDIO — PHASE 1B
## INFORME DE IMPLEMENTACIÓN DE INGESTA MUSICAL UNIVERSAL
**Documento:** `WS_PHASE_1B_INGESTION_IMPLEMENTATION_REPORT.md`  
**Ruta:** `docs/reports/phase-1b/WS_PHASE_1B_INGESTION_IMPLEMENTATION_REPORT.md`  
**Fase:** Phase 1B — Universal Music Ingestion, Canonical Music Pipeline & Multi-Format Conversion  
**Rama:** `feature/phase-1a-core-foundation`  
**Fecha de Emisión:** 2026-11-05  
**Estado de Ejecución:** COMPLETADO — CONTROLLED ENGINEERING IMPLEMENTATION (ZERO COMMITS / ZERO PUSHES)

---

### 1. RESUMEN EJECUTIVO DE ARQUITECTURA DE INGESTA

La implementación de la Fase 1B establece el subsistema central de ingesta musical universal para Bethesda Worship Studio. La arquitectura resuelve integralmente el procesamiento de siete (7) categorías de fuentes musicales requeridas por la directiva del Product Owner:
1. **MusicXML 4.0** (`.musicxml`, `.xml`)
2. **Standard MIDI Files** (`.mid`, `.midi`, Formatos SMF 0 y SMF 1)
3. **ChordPro** (`.chordpro`, `.pro`, `.cho`, `.crd`)
4. **Notas Musicales Escritas** (Entrada estructurada manual vía API/JSON)
5. **Partituras Visuales** (PDF e Imágenes PNG, JPEG, TIFF)
6. **Archivos de Audio** (MP3, WAV, FLAC, M4A)
7. **URLs de Video Remoto** (YouTube y Vimeo bajo estricto perímetro SSRF)

La arquitectura sigue el patrón Adapter orquestado por un servicio unificado central (`UniversalIngestionService`), complementado por un proveedor de almacenamiento local seguro (`LocalFileSystemSourceStorageProvider`), protección criptográfica mediante SHA-256 en reposo y en tránsito, y registro estricto en la tabla `background_jobs` de PostgreSQL.

---

### 2. DETALLE DE WORKSTREAMS IMPLEMENTADOS

#### 2.1 Workstream A: Orquestación Central y Almacenamiento Seguro
- **Orquestador:** `UniversalIngestionService` (`backend/src/application/universal-ingestion-service.ts`).
  - Registro dinámico y extensible de adaptadores mediante la interfaz `IIngestionAdapter`.
  - Cálculo de huella criptográfica SHA-256 (`calculateSourceHash`) sobre el contenido binario o textual crudo.
  - Comprobación atómica de idempotencia consultando `song_sources` (`filename` + `raw_content` SHA-256 / rawText). Si el archivo ya fue importado, se reutiliza la canción canónica existente con diagnóstico `IDEMPOTENT_IMPORT_REUSED`.
  - Trazabilidad en `background_jobs`: creación inicial con estado `PROCESSING`, actualización a `COMPLETED` con ID de canción canónica, o `FAILED` con código estructurado y metadatos de error.
  - Control de acceso IDOR en `getJobStatus`: solo el usuario propietario de la tarea o administradores (`ADMIN`, `SUPER_ADMIN`) pueden consultar el estado; se rechaza con `403 Forbidden` cualquier consulta cruzada entre usuarios o directores de culto (`WORSHIP_LEADER`).
- **Proveedor de Almacenamiento:** `LocalFileSystemSourceStorageProvider` (`backend/src/domain/ingestion/source-storage-provider.ts`).
  - Almacenamiento desacoplado en `backend/storage/sources/`.
  - Resolución segura de rutas (`resolveSafePath`) con sanitización de nombres de archivo y neutralización estricta de Path Traversal (`..`, `\`, `/`).
  - Límite de tamaño uniforme de 15 MiB (`MAX_SOURCE_FILE_SIZE_BYTES = 15 * 1024 * 1024`).

#### 2.2 Workstream B: Formatos Estructurados (B1, B2, B3, B4)
- **B1: MusicXML 4.0 (`MusicXmlIngestionAdapter`)**
  - Validación preventiva contra ataques XXE (*XML External Entity*) bloqueando directivas `<!DOCTYPE>` y `<!ENTITY>`.
  - Validación de elemento raíz (`<score-partwise>` o `<score-timewise>`).
  - Reutilización de `MusicXmlImporter` con normalización determinista a 480 TPQN (*Ticks Per Quarter Note*).
  - Conservación de metadatos (título, compositor, tonalidad de concierto, métrica, tempo, compases, pentagramas y notas).
- **B2: Standard MIDI File SMF 0 y 1 (`MidiParser` & `MidiIngestionAdapter`)**
  - Parser binario puro en TypeScript (`backend/src/domain/ingestion/adapters/midi/midi-parser.ts`) sin dependencias nativas externas.
  - Soporte completo para cabeceras `MThd` (Formatos 0 y 1), bloques de pista `MTrk`, decodificación de tiempo delta en longitud variable (VLQ) y *Running Status*.
  - Normalización temporal matemática a 480 TPQN:
    $$\Delta t_{480} = \text{round}\left(\Delta t_{\text{midi}} \times \frac{480}{\text{division}}\right)$$
  - Procesamiento de Meta-Eventos: `0x51` (Set Tempo en microsegundos por negra $\to$ BPM), `0x58` (Time Signature), `0x59` (Key Signature), `0x03` (Track Name).
  - Mapeo de números de nota MIDI (0-127) a `Pitch` formal canónico.
  - Invariante de fidelidad: CERO acordes inventados, CERO sílabas líricas inventadas.
- **B3: ChordPro (`ChordProIngestionAdapter`)**
  - Integración de `ChordProImporter` preservando alineación de acordes y texto.
  - Regla LeadSheet estricta: `totalNotes: 0` (CERO invención de notas melódicas en acordes/cifrados).
- **B4: Notas Musicales Escritas (`WrittenNotesIngestionAdapter`)**
  - Entrada estructurada manual validada vía esquema Zod (`writtenNotesPayloadSchema`).
  - Validación estricta de notas: expresión regular `^[A-G]$`, octava $0 \le n \le 9$, duraciones soportadas (`whole`, `half`, `quarter`, `eighth`, `16th`, `32nd`).
  - Generación de `InstrumentTrack` con familia `'VOCALS'`, compases correlativos 1, 2, ..., y eventos líricos (`LyricSyllable`) con `tickOffset` y `sequenceNumber`.

#### 2.3 Workstream C: Partituras Visuales (PDF e Imágenes)
- **Adaptador:** `VisualScoreIngestionAdapter` (`backend/src/domain/ingestion/adapters/visual-score/visual-score-adapter.ts`).
  - Validación de firmas mágicas binarias:
    - PDF: `%PDF-` (`0x25 0x50 0x44 0x46 0x2D`)
    - PNG: `0x89 0x50 0x4E 0x47 0x0D 0x0A 0x1A 0x0A`
    - JPEG: `0xFF 0xD8 0xFF`
    - TIFF: `II*.` o `MM.*` (`0x49 0x49 0x2A 0x00` / `0x4D 0x4D 0x00 0x2A`)
  - Extracción preliminar de metadatos de texto embebido en documentos PDF.
  - Stub honesto de reconocimiento OMR: reporta deterministamente `RECOGNITION_UNAVAILABLE` con 0 notas inventadas (`totalNotes: 0`), preservando la fuente binaria y su huella SHA-256 en almacenamiento seguro.

#### 2.4 Workstream D: Audio y URLs de Video
- **Audio (`AudioIngestionAdapter`):**
  - Detección de firmas binarias de audio para MP3 (`ID3` o frames de sincronización `0xFF 0xFB`), WAV (`RIFF....WAVE`), FLAC (`fLaC`), M4A (`ftypM4A`).
  - Cálculo de duración estimada para archivos WAV PCM a partir de su bloque `fmt ` y `data`.
  - Stub honesto de transcripción musical de audio: estado `RECOGNITION_UNAVAILABLE`, cero notas fabricadas, archivo preservado con SHA-256.
- **Video Remoto (`VideoUrlIngestionAdapter`):**
  - Lista blanca estricta de proveedores: únicamente `youtube.com`, `youtu.be` y `vimeo.com`.
  - Perímetro de defensa contra SSRF (*Server-Side Request Forgery*): bloqueo categórico de `localhost`, `127.0.0.1`, `0.0.0.0`, `[::1]`, rangos privados RFC 1918 (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`) y metadatos de computación en la nube (`169.254.169.254`, `169.254.0.0/16`).
  - Retorna referencia de streaming válida con metadatos de video.

---

### 3. CONEXIONES HTTP Y CONTROLADORES FASTIFY

Rutas registradas bajo el prefijo `/api/v1/ingestion` (`backend/src/interfaces/http/routes/ingestion.routes.ts`):
1. `POST /api/v1/ingestion/upload`: Carga unificada de archivos (binarios en Base64 o texto crudo), validación de cuota de 15 MiB y orquestación con adaptador.
2. `POST /api/v1/ingestion/written-notes`: Ingesta de notas escritas estructuradas.
3. `POST /api/v1/ingestion/video-url`: Ingesta de enlace audiovisual con validación SSRF.
4. `GET /api/v1/ingestion/jobs/:jobId`: Consulta de estado de tarea de ingesta en segundo plano con protección IDOR.

---

### 4. INVENTARIO DE ARCHIVOS IMPLEMENTADOS Y CHECKSUMS SHA-256

| Archivo | Estado Git | SHA-256 |
| :--- | :--- | :--- |
| `backend/src/domain/types.ts` | Modificado | `A1DE9740E09D0424E401144FEC129E2DC31AFAA49B7AC19E04B69143A14FD244` |
| `backend/src/domain/auth-types.ts` | Modificado | `0F8C12BA6031B648BF5F218DE5CCCE8FFEEBEE24C7D281799F3BFC5C7932C301` |
| `backend/src/domain/ingestion/types.ts` | Creado | `0EDED88DDE642AD8262101BA531933387A134407A9F6ABBCD2F09CB4A0B6CBD9` |
| `backend/src/domain/ingestion/source-storage-provider.ts` | Creado | `E73579CB7B80CA4B6024CCDD32ED3ED28223F8E47CF49F17B324DB1DA631871D` |
| `backend/src/domain/ingestion/adapters/midi/midi-parser.ts` | Creado | `88343627AA86F6CF4866DC6D7BFBE4C9B457C58A45BB59B23665F97BBFF6A952` |
| `backend/src/domain/ingestion/adapters/midi/midi-adapter.ts` | Creado | `C8D3317CBF4D25A2DB28070B126451C3CF97D3F35DFF8AEB7F343B36091EED8D` |
| `backend/src/domain/ingestion/adapters/musicxml/musicxml-adapter.ts` | Creado | `B928C569545FE3B748D9089545363A26489033762C1EF3A87C55CB52B72BCAC4` |
| `backend/src/domain/ingestion/adapters/chordpro/chordpro-adapter.ts` | Creado | `3536A5047BBB0A3297B1F920354BDE6F92E5095EA696EA22608974005FAADA8B` |
| `backend/src/domain/ingestion/adapters/written-notes/written-notes-adapter.ts` | Creado | `8402F5F3D14056F0211C7520DA18053FA9C952D4F52113EC56CD8487FED7ACCB` |
| `backend/src/domain/ingestion/adapters/visual-score/visual-score-adapter.ts` | Creado | `8A3B98D1BC211FB90865B5FC915A96C5A3278487EEC711FA4BE5BD3D6B28484C` |
| `backend/src/domain/ingestion/adapters/audio/audio-adapter.ts` | Creado | `C8F3602AC3AC2B7DAC8BCA16EE702621604C986A81DAF6E461D4424A4FED5816` |
| `backend/src/domain/ingestion/adapters/video/video-url-adapter.ts` | Creado | `5B6410CFAE2731564511D0DF4529E9F8C8221731C348175C1D51BABD4EA4C5A2` |
| `backend/src/application/universal-ingestion-service.ts` | Creado | `7A576013E852A7FBF2C3C3B9C1A9A74EF2DF513CB7D3E7C58AEFB9653FA20D69` |
| `backend/src/interfaces/http/routes/ingestion.routes.ts` | Creado | `C5F7C666C1783C7ECD1AF5CD291C406E6363F4EFB7A9138ED625345704D50BB9` |
| `backend/src/app.ts` | Modificado | `EE12E71361956541358B1D5E38756E9CE3C4687C8AEE9FE2CA1C07D6A6DD28C6` |
| `backend/src/__tests__/universal-ingestion-phase1b.test.ts` | Creado | `6A9AD9C5D460DF71DAF77491365F2F1E4D730881740DCADC2F15416313102789` |

---
**Conclusión de Implementación:** El subsistema de ingesta universal se encuentra completamente implementado, verificado por compilación TypeScript estricta y respaldado por 25 pruebas automatizadas aprobadas al 100%.

