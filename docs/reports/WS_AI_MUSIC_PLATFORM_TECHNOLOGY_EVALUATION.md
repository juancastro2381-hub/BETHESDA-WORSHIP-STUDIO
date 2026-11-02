# BETHESDA WORSHIP STUDIO — EVALUACIÓN COMPARATIVA DE TECNOLOGÍAS DE IA Y MÚSICA
## Análisis Técnico, Licenciamiento, Cómputo y Recomendación de Motores

- **Fecha:** 2 de Noviembre de 2026
- **Estado:** FASE 0 — STRICTLY READ-ONLY ARCHITECTURAL ASSESSMENT
- **Autor:** Principal Software Architect, Senior Music Technology Engineer & AI Specialist
- **Documento:** `docs/reports/WS_AI_MUSIC_PLATFORM_TECHNOLOGY_EVALUATION.md`

---

## 1. INTRODUCCIÓN Y CRITERIOS DE EVALUACIÓN

Para convertir a Bethesda Worship Studio en una plataforma de referencia comparable y superior a SongScription, se evaluaron los principales proyectos de código abierto y modelos del estado del arte en Music Information Retrieval (MIR), procesamiento de señales y redes neuronales profundas.

### Criterios de Selección Rigurosos:
1. **Seguridad Jurídica y Licenciamiento:** Se priorizan licencias comerciales permisivas (**MIT**, **Apache 2.0**, **BSD**). Las licencias recíprocas restrictivas como **AGPL-3.0** o **GPL-3.0** se evalúan con extrema precaución, requiriendo aislamiento estricto en microservicios sobre la red sin vinculación dinámica ni estática.
2. **Eficiencia de Cómputo y Costos de Infraestructura:** Distinción entre tareas que pueden resolverse eficientemente en CPU frente a aquellas que requieren aceleración por GPU (CUDA / Tensor Cores).
3. **Precisión Musical (Frecuencia, Métrica y Tempo):** Capacidad de cuantizar notas a duraciones musicales reales (negras, corcheas, semicorcheas, tresillos) sin ruido espurio.
4. **Compatibilidad con el Stack de Bethesda:** Facilidad de empaquetado en contenedores Docker y exportación directa hacia `CanonicalMusicPayload` a 480 TPQN y MusicXML 4.0.

---

## 2. EVALUACIÓN DETALLADA POR CAPACIDAD TECNOLÓGICA

### 2.1 Separación de Fuentes de Audio (Source Separation / Stems)

| Tecnología | Madurez / Mantenedor | Licencia | Requerimientos de Hardware | Complejidad de Despliegue | Precisión (SDR dB) | Compatibilidad con el Stack |
|---|---|---|---|---|---|---|
| **Hybrid Demucs v4 (HTDemucs)** | Muy Alta (Meta Research / FAIR) | **MIT** (Permisiva total) | **GPU recomendada:** NVIDIA T4, RTX 3060 o superior (VRAM >= 6 GB). En CPU: ~4-8x tiempo real. | Media (Docker con PyTorch y CUDA). | **Excelente (SDR ~9.2 dB).** Separa 4 o 6 stems (Voz, Batería, Bajo, Guitarra, Piano, Otros). | **100% Compatible.** Genera WAVs listos para `AudioService` y `MultitrackService`. |
| **Spleeter** | Media-Baja (Deezer - Mantenimiento mínimo) | **MIT** | Funciona en CPU modesta (2-4 cores). | Baja (TensorFlow 2.x). | **Media (SDR ~6.0 dB).** Frecuentes artefactos de fase y sangrado vocal. | Compatible, pero calidad inferior a Demucs. |
| **Open-Unmix (UMX)** | Alta (Inria / PyTorch) | **MIT** | GPU moderada o CPU multi-core. | Media. | **Buena (SDR ~6.8 dB).** Menos artefactos que Spleeter, pero inferior a HTDemucs. | Compatible. |

> **RECOMENDACIÓN TÉCNICA:** **Hybrid Demucs v4 (HTDemucs)**. Es el estándar de la industria, cuenta con licencia MIT libre de regalías, y la separación limpia de voz y bajo es el prerrequisito fundamental para que la transcripción de notas posterior sea exacta.

---

### 2.2 Transcripción de Audio a MIDI y Polifonía

| Tecnología | Madurez / Mantenedor | Licencia | Requerimientos de Hardware | Complejidad de Despliegue | Precisión Musical | Compatibilidad con el Stack |
|---|---|---|---|---|---|---|
| **Spotify Basic Pitch** | Alta (Spotify Research) | **Apache 2.0** (Comercial libre) | **CPU o GPU ligera.** Soporta ONNX Runtime y TensorFlow Lite. Inferencia ultrarrápida (~10-20x tiempo real en CPU). | **Muy Baja.** Microservicio Python o worker Node.js vía ONNX. | **Alta en polifonía acústica/eléctrica.** Detecta bends de tono, onsets y duraciones limpias. | **100% Compatible.** Emite eventos de nota cuantizables directamente al modelo canónico a 480 TPQN. |
| **Google MT3 (Magenta)** | Alta investigación (Google) | **Apache 2.0** | **GPU Pesada Obligatoria** (VRAM >= 16 GB, A100/V100/A10G). Inferencia lenta basada en T5 Transformers. | Muy Alta (Transformers multitrack). | **Excelente en polifonía compleja**, pero costo de cómputo prohibitivo para producción local. | Difícil de justificar por costos de infraestructura cloud. |
| **Onsets and Frames** | Muy Alta (Google Magenta) | **Apache 2.0** | GPU recomendada; CPU lenta en canciones completas. | Media. | **Especializado en Piano acústico.** Sobresaliente en teclas, deficiente en guitarras/voz. | Compatible como modelo complementario de piano. |
| **Omnizart** | Media (Academia Sinica) | **GPL-3.0** (Riesgo de licenciamiento) | GPU intermedia. Entorno con muchas dependencias conflictivas. | Alta. | Buena, pero la licencia viral GPL obliga a aislar completamente el código. | Desaconsejado por términos de licencia. |

> **RECOMENDACIÓN TÉCNICA:** **Spotify Basic Pitch**. Su velocidad de inferencia en CPU/GPU ligera, soporte nativo de polifonía y licencia Apache 2.0 lo convierten en la opción óptima para transcripción de instrumentos individuales tras la separación de Demucs.

---

### 2.3 Reconocimiento de Acordes desde Audio (Chord Recognition)

| Tecnología | Madurez / Mantenedor | Licencia | Requerimientos de Hardware | Complejidad de Despliegue | Precisión de Acordes | Compatibilidad con el Stack |
|---|---|---|---|---|---|---|
| **BTC (Bidirectional Transformer for Chords)** | Alta (Investigación académica) | **MIT** | GPU modesta o CPU. Tiempo de inferencia < 5 segundos por canción. | Media (PyTorch). | **Sobresaliente.** Detecta tríadas mayores, menores, 7mas, maj7, disminuidos, aumentados y notas de bajo invertidas. | **100% Compatible.** Sus etiquetas de acorde mapean directamente a `Chord.fromString()` de Bethesda. |
| **Chordino (NNLS Chroma)** | Muy Alta (Centre for Digital Music, QMUL) | **GPL-2.0+** | CPU ultraliviano (Algoritmo DSP determinista sin deep learning). | Media (Vamp plugin CLI / Python wrapper). | **Buena en tríadas básicas**, propensa a confusiones en acordes suspendidos o con extensiones litúrgicas (add9, sus4). | Licencia GPL requiere ejecución como CLI externo aislado. |

> **RECOMENDACIÓN TÉCNICA:** **BTC (Bidirectional Transformer)** alimentado con la mezcla instrumental (con la voz atenuada por Demucs para evitar que las armonías vocales ensucien la detección de acordes).

---

### 2.4 Detección de Ritmo, Compás y Tempo (Beat & Downbeat Tracking)

| Tecnología | Madurez / Mantenedor | Licencia | Requerimientos de Hardware | Complejidad de Despliegue | Precisión Rítmica | Compatibilidad con el Stack |
|---|---|---|---|---|---|---|
| **Madmom** | Muy Alta (Johannes Kepler University Linz) | **BSD-2-Clause** (Comercial libre) | **CPU ligero.** Inferencia instantánea (< 2 segundos). | Baja (Python / NumPy / SciPy). | **Estado del Arte.** Detección precisa de BPM constante o variable, pulsos de compás (downbeats) y estimación métrica (3/4, 4/4, 6/8). | **100% Compatible.** Mapea directo a `TimeSignature` y `Timeline.tempoMap`. |
| **Aubio** | Muy Alta (C/Python) | **GPL-3.0** | CPU ultraligero. | Baja. | Buena en ataques percusivos, pero inferior a Madmom en compases compuestos y downbeats. | Limitado por licencia GPL. |

> **RECOMENDACIÓN TÉCNICA:** **Madmom**. Es la biblioteca de referencia en MIR para sincronizar la grilla métrica de compases y tiempos canónicos antes de mapear notas y acordes.

---

### 2.5 Transcripción de Letras y Alineación Sílaba-Tiempo (Speech-to-Text & Forced Alignment)

| Tecnología | Madurez / Mantenedor | Licencia | Requerimientos de Hardware | Complejidad de Despliegue | Precisión en Canto | Compatibilidad con el Stack |
|---|---|---|---|---|---|---|
| **WhisperX (faster-whisper + wav2vec2)** | Alta (m-bain et al.) | **BSD-2-Clause** | **GPU recomendada (T4 / RTX 3060)** para Whisper large-v3. En CPU con modelo *medium.en/es*: ~0.5x tiempo real. | Media (CTranslate2 + PyTorch). | **Líder en la industria.** Transcribe la letra en español/inglés y ejecuta alineación forzada fonema por fonema con marcas de tiempo en milisegundos. | **100% Compatible.** Permite asociar exactamente cada sílaba (`LyricSyllable`) al tick canónico de la nota melódica correspondiente. |
| **OpenAI Whisper (Vainilla)** | Muy Alta (OpenAI) | **MIT** | GPU moderada. | Baja. | Alta en transcripción léxica, pero solo provee marcas de tiempo a nivel de frase, no de palabra/sílaba. | Requiere aligner adicional. |

> **RECOMENDACIÓN TÉCNICA:** **WhisperX** aplicado exclusivamente sobre el stem de voz aislado (`vocals.wav`) generado por Demucs. Esto elimina el ruido del instrumental y dispara la precisión de reconocimiento de palabras en alabanza y adoración.

---

### 2.6 Reconocimiento Óptico de Música (OMR para Partituras y Escaneos)

| Tecnología | Madurez / Mantenedor | Licencia | Requerimientos de Hardware | Complejidad de Despliegue | Precisión en Partituras | Compatibilidad con el Stack |
|---|---|---|---|---|---|---|
| **Audiveris (v5.3+)** | Muy Alta (Proyecto maduro Java) | **AGPL-3.0** (Licencia restrictiva de red) | CPU con 4-8 núcleos y 4 GB RAM. No requiere GPU. | Media (Java JRE 17+ en contenedor Docker independiente con CLI headless). | **Muy Alta en partituras formales impresas.** Detecta pentagramas, claves, armaduras, plicas, silencios y letras. Exporta MusicXML 3.0/4.0 nativo. | **100% Compatible mediante exportación MusicXML.** La salida MusicXML se ingesta limpiamente a través de `MusicXmlImporter` sin vincular librerías AGPL al backend Node.js. |
| **oemer (Deep Learning OMR)** | Media (Investigación reciente PyTorch) | **Apache 2.0** | CPU moderna o GPU ligera. | Media (Python / PyTorch). | **Buena en pentagramas modernos y lead sheets.** Menos tolerante a escaneos torcidos o arrugados que Audiveris. | Exporta MusicXML directamente. |
| **Sheet Sage** | Experimental | **GPL-3.0** | GPU recomendada. | Alta. | Especializado en cancioneros de acordes y melodías pop, pero en fase alfa. | Inmaduro para producción. |

> **RECOMENDACIÓN TÉCNICA:** **Audiveris v5.3 empaquetado como Microservicio Docker REST/CLI aislado de la red**. Al comunicarse con Fastify estrictamente mediante intercambio de archivos (recibe imagen/PDF -> retorna MusicXML 4.0), se respeta con rigor el aislamiento legal de la licencia AGPL-3.0 y se aprovechan 15 años de madurez en reconocimiento de figuras musicales tradicionales. Para cancioneros de texto, el actual `PdfTextExtractor` + `ChordSheetConverter` continuará operando en memoria local sin latencia.

---

## 3. MATRIZ CONSOLIDADA DE TECNOLOGÍAS RECOMENDADAS

| Dominio | Tecnología Seleccionada | Licencia | Entorno de Ejecución | Hardware Requerido | Rol en la Plataforma |
|---|---|---|---|---|---|
| **Separación de Pistas** | **Hybrid Demucs v4** | MIT | Python 3.11 / PyTorch | GPU (NVIDIA T4 o superior) | Descompone audio estéreo en 4/6 stems para análisis individual. |
| **Transcripción de Notas** | **Spotify Basic Pitch** | Apache 2.0 | Python ONNX Runtime | CPU multi-core o GPU | Convierte stems instrumentales en notas con pitch, onset y duración. |
| **Detección de Acordes** | **BTC (Transformer)** | MIT | Python 3.11 / PyTorch | CPU o GPU ligera | Identifica progresiones armónicas complejas en tiempo real. |
| **Métrica y Tempo** | **Madmom** | BSD-2-Clause | Python / NumPy | CPU estándar | Establece la grilla métrica de compases y BPM canónico. |
| **Letras y Alineación** | **WhisperX** | BSD-2-Clause | Python CTranslate2 | GPU (o CPU con modelo *medium*) | Transcribe lírica y calcula marcas de tiempo fonema a nota. |
| **OMR de Partituras** | **Audiveris Headless** | AGPL-3.0 (Aislado) | Java 17 Microservice | CPU (2-4 vCPU, 4GB RAM) | Procesa escaneos de partituras tradicionales a MusicXML 4.0. |
| **Cancioneros Digitales** | **PdfTextExtractor (Propio)** | Propietaria / MIT | TypeScript / Node.js 20 | CPU nativa Fastify | Extracción instantánea de cancioneros vectoriales (CMB Azul/Music). |
| **Orquestación de Tareas** | **BullMQ + Redis 7** | MIT / BSD | Node.js + Redis | CPU (1 vCPU, 512MB RAM) | Manejo de colas asíncronas con reintentos y progreso porcentual. |
| **Almacenamiento de Medios** | **MinIO (S3 Compatible)** | AGPL-3.0 (Aislado) | Go / Docker | Almacenamiento en bloque | Guarda audio original, stems separados y PDFs de entrada. |

---

## 4. ESTIMACIÓN DE COSTOS DE INFRAESTRUCTURA DE INFERENCIA

Para planificar la viabilidad financiera del procesamiento de IA, se modelan dos escenarios operativos:

### Escenario A: Servidor Dedicado On-Premise / Bare Metal (Recomendado para Iglesias y Centros Comunitarios)
- **Especificaciones:** 1 Servidor con CPU AMD Ryzen 9 / Intel i7 (8 núcleos / 16 hilos), 32 GB RAM, 1 TB SSD NVMe, GPU NVIDIA RTX 4060 Ti (16 GB VRAM) o RTX 3060 (12 GB VRAM).
- **Inversión Inicial de Hardware:** \$1,200 - \$1,600 USD (pago único).
- **Costo Operativo Mensual:** Solo consumo eléctrico e Internet (~\$15 - \$30 USD/mes).
- **Rendimiento:** 
  - Separación de audio (Demucs): ~45 segundos para una canción de 4 minutos.
  - Transcripción completa (Audio -> Stems -> Acordes -> Letra -> Partitura): ~90 segundos por canción.
  - Capacidad: Hasta 40 transcripciones completas por hora.

### Escenario B: Despliegue en la Nube (AWS / Google Cloud / RunPod Serverless)
- **Instancia con GPU Bajo Demanda (ej. AWS `g4dn.xlarge` con NVIDIA T4 o RunPod Serverless):**
  - Costo por hora de GPU: \$0.25 - \$0.52 USD/hora.
  - Con arquitectura *serverless worker* activada solo durante la subida:
  - Tiempo de procesamiento por canción: ~1.5 minutos = **\$0.013 USD por canción transcrita**.
  - Costo mensual para 500 canciones/mes: ~**\$6.50 - \$15.00 USD/mes**.
  - Almacenamiento S3 / MinIO (50 GB audio + stems): ~**\$1.15 USD/mes**.

**Conclusión Financiera:** Al evitar APIs comerciales cerradas (cuyas tarifas superan los \$0.05 a \$0.15 USD por minuto de audio) y basar la arquitectura en modelos open-source de licencia permisiva desplegados en infraestructura propia o serverless, el costo por transcripción es inferior a **2 centavos de dólar por canción**, haciendo el proyecto 100% sostenible a escala litúrgica.

