# BETHESDA WORSHIP STUDIO — EVALUACIÓN COMPARATIVA DE TECNOLOGÍAS DE IA Y MÚSICA
## Análisis Técnico Remediado: Licenciamiento Tri-Capa, Cómputo Realista y Arquitectura de Motores

- **Fecha:** 2 de Noviembre de 2026
- **Estado:** FASE 0A — AUDIT REMEDIATION & FINAL ARCHITECTURE VALIDATION (READ-ONLY)
- **Autor:** Principal Software Architect, Senior Music Technology Engineer & Licensing Analyst
- **Documento:** `docs/reports/WS_AI_MUSIC_PLATFORM_TECHNOLOGY_EVALUATION.md`

---

## 1. INTRODUCCIÓN Y CRITERIOS DE EVALUACIÓN REMEDIADOS

Para transformar a Bethesda Worship Studio en una plataforma de referencia superior a SongScription sin incurrir en riesgos legales ni asunciones de costos irreales, se aplica un análisis riguroso en cuatro dimensiones:

1. **Marco de Licenciamiento Tri-Capa (F-04):**
   - **Capa 1: Licencia del Código Fuente:** (MIT, Apache 2.0, BSD, GPL, AGPL).
   - **Capa 2: Licencia de los Pesos Pre-entrenados:** Términos de los checkpoints neuronales.
   - **Capa 3: Licencia del Conjunto de Entrenamiento (Dataset):** Restricciones de origen (e.g. cláusulas no-comerciales en datasets académicos como MusDB18).
2. **Realismo de Transcripción y Cero Notas Falsas (F-05):** Preservación del invariante de calidad. La polifonía densa de mezclas de adoración (guitarras con delay/overdrive, pads atmosféricos, coros) genera ruido inaceptable si se procesa directamente con modelos monofónicos o de solo piano. La separación de pistas previa es obligatoria.
3. **Perfil de Cómputo y Costos Empíricos (F-06):** Modelado basado en latencias medidas en GPUs reales (NVIDIA T4 y L4), considerando arranque en frío (*cold starts*) y costos de almacenamiento/egress.
4. **Desacoplamiento Legal de Copyleft (F-01 / F-04):** Todo componente bajo AGPL-3.0 (Audiveris) o GPL (Chordino) debe operar estrictamente encapsulado en microservicios independientes sobre la red, sin vinculación con el código propietario.

---

## 2. EVALUACIÓN DETALLADA POR CAPACIDAD TECNOLÓGICA

### 2.1 Separación de Fuentes de Audio (Source Separation / Stems)

| Tecnología | Licencia Código | Licencia Pesos | Licencia Dataset | Requerimientos de Cómputo | Precisión (SDR dB) | Viabilidad Comercial SaaS |
|---|---|---|---|---|---|---|
| **Hybrid Demucs v4 (HTDemucs)** | **MIT** | MIT | **MusDB18 (No-Comercial)** | GPU (NVIDIA T4 / L4 >= 6 GB VRAM). En T4: ~45s por canción de 5 min. | **Excelente (SDR ~9.2 dB).** Separa Voz, Batería, Bajo y Otros. | **Condicional / Requiere Mitigación:** Para SaaS comercial estricto, entrenar/afinar con stems comerciales o usar modelos con pesos 100% libres de restricciones académicas. |
| **Spleeter** | MIT | MIT | In-house Deezer | CPU (2-4 cores). | Media (SDR ~6.0 dB). Sangrado vocal notorio. | Comercial Permitido, pero calidad musical deficiente. |
| **Open-Unmix (UMX)** | MIT | BSD-3 | Permisivo / Sintético | GPU ligera o CPU. | Buena (SDR ~6.8 dB). | Comercial Permitido. |

> **RECOMENDACIÓN:** Emplear **HTDemucs v4** en entorno de microservicio desacoplado. Para la versión comercial SaaS final, planificar una de las tres rutas de conformidad de datos (pesos afinados comercialmente, integración con API de stems comerciales, o procesamiento en computación privada del usuario).

---

### 2.2 Transcripción de Audio a MIDI y Detección Melódica (F-05)

| Tecnología | Licencia Código | Licencia Pesos | Requerimientos de Cómputo | Precisión Musical | Limitación en Mezclas de Adoración |
|---|---|---|---|---|---|
| **Spotify Basic Pitch** | **Apache 2.0** | **Apache 2.0** | CPU o GPU ligera (ONNX Runtime). ~8-12s por pista. | **Alta en instrumentos solistas o limpios.** | **Falla en mezclas completas:** Si se aplica a la mezcla estéreo de alabanza, sintetiza decenas de notas falsas a partir de pads, reverberaciones y platillos. **Solución:** Ejecutar Basic Pitch ÚNICAMENTE sobre stems individuales (Voz aislada y Bajo aislado). |
| **Google MT3 (Magenta)** | Apache 2.0 | Apache 2.0 | GPU de gama alta (>= 16 GB VRAM, A100/L4). Lento. | Alta en partituras completas. | Demasiado pesado y costoso para producción concurrente en SaaS. |
| **Onsets and Frames** | Apache 2.0 | Apache 2.0 | GPU recomendada. | Sobresaliente solo en Piano acústico. | Inadecuado para guitarras o voz de alabanza. |

> **RECOMENDACIÓN:** **Basic Pitch de Spotify** precedido obligatoriamente por la separación de pistas de Demucs. Se establecen umbrales de confianza (`confidence >= 0.65`) para suprimir notas fantasmas generadas por resonancias armónicas.

---

### 2.3 Reconocimiento Armónico y Detección de Acordes (Chord Recognition)

| Tecnología | Licencia Código | Tipo de Algoritmo | Requerimientos | Precisión en Acordes de Adoración | Integración en Backend |
|---|---|---|---|---|---|
| **Madmom CRF + NNLS Chroma** | **BSD-2 / GPL-2** | DSP Determinista + HMM/CRF | CPU ultraligero (< 5s por canción). | **Alta en progresiones tonales estándar.** Excelente alineación con el compás. | **Excelente.** Puede empaquetarse en un script/worker Python ligero. |
| **BTC (Bidirectional Transformer)** | **MIT** | Deep Learning Transformer | CPU o GPU modesta (< 5s). | **Sobresaliente.** Detecta extensiones litúrgicas (sus4, add9, maj7, inversiones de bajo /3, /5). | **Excelente.** Sus etiquetas mapean 1:1 con la gramática de acordes de Bethesda. |

> **RECOMENDACIÓN:** Usar **Madmom** para fijar la grilla de compases y tiempos, y **BTC** sobre el stem instrumental (sin voz principal) para extraer los acordes con máxima fidelidad litúrgica.

---

### 2.4 Transcripción de Letras y Alineación Forzada (Speech-to-Text & Forced Alignment)

| Tecnología | Licencia Código | Licencia Pesos | Hardware | Precisión en Canto de Alabanza | Alineación Temporal |
|---|---|---|---|---|---|
| **WhisperX (faster-whisper + wav2vec2)** | **BSD-3** | MIT (OpenAI) | GPU recomendada (T4 / L4). ~20s en T4. | **Sobresaliente.** En stem de voz aislado elimina interferencia instrumental. | **Nivel de palabra y fonema.** Permite mapear sílabas exactas a ticks musicales. |
| **Whisper Vainilla** | MIT | MIT | GPU moderada. | Alta en texto. | Solo marcas a nivel de oración; insuficiente para atril musical. |

> **RECOMENDACIÓN:** **WhisperX** aplicado exclusivamente sobre el archivo `vocals.wav` extraído por Demucs.

---

### 2.5 Reconocimiento Óptico de Música (OMR para Partituras y Escaneos - F-01)

| Tecnología | Licencia Código | Tipo de Motor | Hardware | Calidad de Salida | Mecanismo de Aislamiento Legal |
|---|---|---|---|---|---|
| **Audiveris (v5.3+)** | **AGPL-3.0** | Híbrido (Procesamiento digital de imágenes + redes neuronales para glifos) | CPU (2-4 vCPU, 4 GB RAM). | **La más alta en partituras impresas y lead sheets.** Genera MusicXML estructurado con compases, plicas, claves y ligaduras. | **Microservicio Docker Aislado:** Contenedor autónomo con API REST interna. Prohibida toda vinculación en el backend principal. |
| **Tesseract OCR v5** | Apache 2.0 | Redes LSTM | CPU (1-2 vCPU). | Especializado en texto plano y acordes tipográficos. | Integración directa mediante CLI o worker Node/Python. |
| **oemer** | Apache 2.0 | Deep Learning end-to-end | CPU / GPU. | Experimental. Frecuentes fallos en compases con múltiples voces. | Aún no apto para producción litúrgica. |

> **RECOMENDACIÓN:** Pipeline híbrido en microservicio:
> 1. Para partituras estándar con pentagrama: **Audiveris headless** en contenedor aislado emitiendo MusicXML.
> 2. Para cancioneros de acordes y texto: `PdfTextExtractor` interno (existente) complementado con **Tesseract OCR** para PDFs rasterizados.

---

## 3. COMPARATIVA DE ALMACENAMIENTO DE OBJETOS: MINIO VS. CLOUDFLARE R2 (F-09)

| Criterio | MinIO Self-Hosted | AWS S3 Standard | Cloudflare R2 (Recomendado) |
|---|---|---|---|
| **Licencia de Software** | **AGPL-3.0** (Riesgo legal SaaS) | Propietaria Cloud (Cliente Apache 2.0) | Propietaria Cloud (Cliente Apache 2.0) |
| **Costo por GB Almacenado** | Costo del disco VM ($0.05 - $0.10/GB) | $0.023 / GB / mes | **$0.015 / GB / mes** |
| **Costo de Transferencia de Salida (Egress)** | Costo de red de la VM | **$0.09 / GB** (Muy costoso para audio) | **$0.00 / GB (CERO COSTO DE SALIDA)** |
| **Mantenimiento Operativo** | Alto (RAID, discos, backups, actualizaciones) | Cero (Totalmente administrado) | Cero (Totalmente administrado) |
| **Compatibilidad S3 API** | 100% | Nativo | 100% (Compatible con `@aws-sdk/client-s3`) |

> **DECISIÓN ARQUITECTÓNICA:** Desechar MinIO. Implementar una abstracción `StorageProvider` basada en el SDK oficial de AWS v3 configurada hacia **Cloudflare R2** en producción, eliminando riesgos legales y evitando costos de transferencia al reproducir pistas de audio multipista en los atriles digitales.

---

## 4. COMPARATIVA DE COLAS DE MENSAJERÍA (F-03)

| Criterio | PostgreSQL `SKIP LOCKED` (Fase 1A) | BullMQ + Redis / Dragonfly (Fase 2) |
|---|---|---|
| **Infraestructura Adicional** | **CERO.** Utiliza la base de datos PostgreSQL existente. | Requiere clúster Redis / Dragonfly dedicado. |
| **Transaccionalidad (ACID)** | **Nativa.** El trabajo se registra en la misma transacción que el archivo. | Eventual. Requiere doble escritura (DB + Redis). |
| **Rendimiento Máximo** | ~50 trabajos concurrentes / ~100 tareas por segundo. | > 10,000 tareas por segundo. |
| **Persistencia ante Reinicios** | 100% segura en disco mediante WAL de Postgres. | Depende de la configuración de RDB/AOF de Redis. |
| **Recomendación** | **ADOPTAR EN FASE 1A** (Suficiente para iglesias y beta SaaS). | **DIFERIR A FASE 2** (Cuando el volumen lo justifique). |

---

## 5. RECONCILIACIÓN DEL MODELO DE COSTOS (F-06)

Frente a la asunción preliminar de $0.013/canción, el modelo empírico validado en `docs/reports/WS_AI_MUSIC_PLATFORM_COST_AND_CAPACITY_MODEL.md` establece:

- **Pequeña Congregación (50 canciones/mes):** **$0.124 / canción** ($6.19/mes total en Serverless GPU).
- **Ministerio Mediano (250 canciones/mes):** **$0.078 / canción** ($30.30/mes total con warm pools).
- **Plataforma Comercial SaaS (1,500 canciones/mes):** **$0.049 / canción** ($251.75/mes total con GPU reservada dedicada).

El modelo demuestra que Bethesda Worship Studio es altamente rentable en todas sus escalas operativas, manteniendo márgenes brutos superiores al 80% en planes comerciales.
