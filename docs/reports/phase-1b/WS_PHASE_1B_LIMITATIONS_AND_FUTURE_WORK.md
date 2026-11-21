# BETHESDA WORSHIP STUDIO — PHASE 1B
## INFORME DE LIMITACIONES TÉCNICAS, COMPROMISOS Y TRABAJO FUTURO
**Documento:** `WS_PHASE_1B_LIMITATIONS_AND_FUTURE_WORK.md`  
**Ruta:** `docs/reports/phase-1b/WS_PHASE_1B_LIMITATIONS_AND_FUTURE_WORK.md`  
**Fase:** Phase 1B — Universal Music Ingestion, Canonical Music Pipeline & Multi-Format Conversion  
**Fecha de Emisión:** 2026-11-05  
**Estado:** HONEST & EVIDENCE-BASED AUDIT

---

### 1. ALCANCE Y ESTADO DE CAPACIDADES EN LA FASE 1B

La directiva técnica para la Fase 1B exigía sentar las bases universales de ingesta musical y pipeline canónico, priorizando la verdad técnica sobre afirmaciones infladas. A continuación se delimita con precisión matemática qué componentes están plenamente operativos y cuáles están intencionalmente postergados a fases posteriores del roadmap.

```
+-------------------------------------------------------------------------------+
| ESTADO DE CAPACIDADES MUSICALES DE INGESTA (FASE 1B)                          |
+--------------------------+-----------------------+----------------------------+
| Fuente Musical           | Estado Actual         | Modo Operativo             |
+--------------------------+-----------------------+----------------------------+
| MusicXML 4.0             | PLENAMENTE OPERATIVO  | Parseo Canónico Completo   |
| MIDI SMF 0 y SMF 1       | PLENAMENTE OPERATIVO  | Parseo Canónico Completo   |
| ChordPro / LeadSheet     | PLENAMENTE OPERATIVO  | Parseo Canónico Completo   |
| Notas Escritas (Manual)  | PLENAMENTE OPERATIVO  | Ingesta Estructurada API   |
| Partituras PDF / Imagen  | PRESERVADO CON STUB   | Almacenado + SHA-256 (OMR) |
| Audio (MP3/WAV/FLAC)     | PRESERVADO CON STUB   | Almacenado + Duración WAV  |
| Enlaces Video Remoto     | REGISTRADO CON SSRF   | Validación + Streaming Ref |
+--------------------------+-----------------------+----------------------------+
```

---

### 2. LIMITACIONES TÉCNICAS RECONOCIDAS Y JUSTIFICACIÓN

#### 2.1 Reconocimiento Óptico de Música (OMR) para PDF e Imágenes
- **Limitación:** El adaptador `VisualScoreIngestionAdapter` almacena el documento de forma inmutable, valida sus firmas binarias y extrae texto plano preliminar si existe en capas PDF. Sin embargo, **no ejecuta un motor OMR neuronal o de visión artificial en tiempo real**.
- **Comportamiento Actual:** Retorna un estado honesto `RECOGNITION_UNAVAILABLE` y genera **cero (0) notas inventadas** (`totalNotes: 0`).
- **Justificación:** Los motores OMR de producción (ej. Audiveris, modelos basados en Deep Learning como End-to-End OMR) requieren procesos en lote asíncronos pesados, workers dedicados con GPU/CPU y dependencias nativas complejas. En la Fase 1B, simular reconocimiento o generar notas Do de relleno violaría de manera flagrante las directivas de integridad musical no negociables del Product Owner.
- **Plan de Trabajo Futuro:** Integración en la Fase 1C y Fase 3C mediante colas de mensajería (BullMQ/Redis) y workers dedicados que operarán sobre los archivos ya preservados en `backend/storage/sources/`.

#### 2.2 Transcripción Polifónica / Monofónica de Audio
- **Limitación:** El adaptador `AudioIngestionAdapter` valida cabeceras de audio (MP3, WAV, FLAC, M4A) y calcula la duración de archivos WAV, pero **no extrae notas ni acordes a partir de formas de onda de audio**.
- **Comportamiento Actual:** Retorna `RECOGNITION_UNAVAILABLE` con **cero (0) notas y cero acordes**.
- **Justificación:** La transcripción musical automática de audio polifónico (*Audio-to-Score / AMT*) representa un problema de investigación computacional avanzado (ej. Basic Pitch de Spotify, modelos MT3). Su incorporación sin la infraestructura adecuada generaría falsos positivos masivos e inaceptables para músicos en vivo.
- **Plan de Trabajo Futuro:** Fase 4A contemplará servicios de inferencia de modelos de estimación de tono fundamental (*pitch tracking*) y extracción armónica con umbrales estrictos de confianza supervisados por humanos.

#### 2.3 Procesamiento de Video Remoto (Descarga y Extracción de Audio)
- **Limitación:** `VideoUrlIngestionAdapter` valida exhaustivamente la URL contra ataques SSRF y registra la referencia de streaming (YouTube/Vimeo). No descarga el video localmente ni extrae la pista de audio mediante herramientas como `yt-dlp` o `ffmpeg`.
- **Justificación:** La descarga no autorizada de medios remotos plantea serios riesgos de bloqueo de IP por *rate-limiting*, uso excesivo de ancho de banda y potenciales conflictos legales con los términos de servicio de las plataformas de video.

---

### 3. FRONTERA LEGAL, DERECHOS DE AUTOR Y POLÍTICA DE USO JUSTO (*FAIR-USE*)

Bethesda Worship Studio es una plataforma concebida para la gestión litúrgica y musical sin fines de lucro en entornos eclesiásticos:
1. **Atribución de Licencias CCLI:**  
   La entidad de datos `songs` incluye el campo relacional `ccli_number` para permitir a las congregaciones registrar y auditar formalmente las canciones bajo su licencia CCLI (*Christian Copyright Licensing International*).
2. **Responsabilidad del Material del Usuario:**  
   Todo material subido (partituras, audios o textos) se almacena bajo el principio de responsabilidad del usuario final, con propósitos estrictos de ensayo litúrgico y adoración comunitaria.
3. **Preservación No Destructiva:**  
   Al almacenar el archivo original inalterado con su huella criptográfica SHA-256, se mantiene la trazabilidad de procedencia original y se evita cualquier alteración indebida de la obra.

---

### 4. HOJA DE RUTA PARA FASES SUBSECUENTES (POST-1B)

- **Fase 1C — OMR Pipeline & Asynchronous Workers:**
  - Despliegue de cola asíncrona de procesamiento de partituras visuales con workers aislados.
  - Implementación de preprocesamiento de imágenes (binarización Otsu, corrección de inclinación *deskewing*, eliminación de pentagramas).
  - Flujo de revisión humana obligatoria antes de promover partituras OMR a estado canónico.
- **Fase 2 — Digital Music Stand Rendering Enhancements:**
  - Habilitación de cambio dinámico de vista en tiempo real (Partitura $\leftrightarrow$ Cifrado $\leftrightarrow$ Letra) según la disponibilidad certificada en la Matriz de Compatibilidad.
- **Fase 3 — Audio Synchronization & Multitrack Stems:**
  - Sincronización de pistas de clic y pistas instrumentales multipista vinculadas a la cuadrícula temporal de 480 TPQN.

