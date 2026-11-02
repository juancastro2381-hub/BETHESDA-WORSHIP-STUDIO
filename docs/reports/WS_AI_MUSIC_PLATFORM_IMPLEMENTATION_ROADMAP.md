# BETHESDA WORSHIP STUDIO — PLAN DE IMPLEMENTACIÓN Y ROADMAP DE FASES
## Hoja de Ruta para la Plataforma Inteligente de Transcripción y Atril Musical

- **Fecha:** 2 de Noviembre de 2026
- **Estado:** FASE 0 — STRICTLY READ-ONLY ARCHITECTURAL ASSESSMENT
- **Autor:** Technical Product Lead & Principal Software Architect
- **Documento:** `docs/reports/WS_AI_MUSIC_PLATFORM_IMPLEMENTATION_ROADMAP.md`

---

## 1. ESTRUCTURA Y METODOLOGÍA DEL ROADMAP

Para garantizar la estabilidad operativa del sistema litúrgico existente en Bethesda Worship Studio y evitar regresiones, la implementación se estructura en **6 fases secuenciales e independientes**.

Cada fase cuenta con:
- **Criterios de Entrada (Entry Gates):** Requisitos técnicos indispensables antes de iniciar.
- **Entregables Concretos:** Código, esquemas de BD, microservicios y componentes UI.
- **Dependencias y Riesgos:** Factores críticos de bloqueo.
- **Criterios de Salida y Aceptación (Exit Gates):** Pruebas automatizadas y validación humana obligatoria antes de habilitar la siguiente fase.

```mermaid
flowchart LR
    P0["Fase 0: Auditoría y Blueprint (Completada)"] --> P1["Fase 1: Infraestructura Asíncrona y Colas"]
    P1 --> P2["Fase 2: Separación de Audio y Detección Rítmica"]
    P2 --> P3["Fase 3: Transcripción de Audio, Acordes y Letras"]
    P3 --> P4["Fase 4: Motor OMR y Captura Fotográfica"]
    P4 --> P5["Fase 5: Editor Musical Interactivo e Inspector"]
    P5 --> P6["Fase 6: Atril Avanzado y Salida a Producción"]
```

---

## 2. DESGLOSE DETALLADO DE FASES

---

### FASE 1: INFRAESTRUCTURA ASÍNCRONA, ALMACENAMIENTO DE OBJETOS Y EVENTOS EN VIVO

- **Objetivo:** Establecer la infraestructura de mensajería, colas de trabajo pesadas y almacenamiento escalable sin bloquear el servidor web principal.
- **Criterios de Entrada:**
  - Fase 0 aprobada por el Product Owner.
  - Entorno de desarrollo con Docker Compose activo.
- **Entregables:**
  1. **Contenedores de Infraestructura:** Configuración de Redis 7.x y MinIO (Object Storage compatible con S3) en `docker-compose.yml`.
  2. **Gestor de Colas en Backend:** Integración de `BullMQ` en Fastify para despacho de trabajos asíncronos (`transcription-jobs`).
  3. **Gateway de Notificación WebSocket:** Emisión reactiva de eventos de progreso (`JOB_PROGRESS: 0%..100%`, `JOB_FAILED`, `JOB_READY`) hacia el cliente.
  4. **Tabla de Base de Datos:** Migración Drizzle para la tabla `transcription_jobs` (UUID, userId, status, progress, inputStorageKey, outputPayload, errorMsg, createdAt).
  5. **Componente Frontend:** Barra de estado de procesamiento en segundo plano con cancelación y reintentos.
- **Estimación de Complejidad:** Media (2 a 3 semanas).
- **Riesgos Principales:** Desconexión de WebSockets durante trabajos largos (mitigado con reconexión automática y sondeo HTTP de respaldo).
- **Criterio de Salida (Exit Gate):**
  - Una tarea simulada de 30 segundos debe encolarse vía REST, procesarse en un worker independiente, emitir progreso porcentual por WebSocket en tiempo real y actualizar el estado en PostgreSQL sin degradar la respuesta del servidor HTTP Fastify.

---

### FASE 2: SEPARACIÓN DE AUDIO (STEMS) Y ANÁLISIS MÉTRICO/TEMPO

- **Objetivo:** Dotar a la plataforma de la capacidad de descomponer audio estéreo en pistas independientes (Voz, Batería, Bajo, Instrumental) y detectar el tempo/métrica automáticamente.
- **Criterios de Entrada:**
  - Fase 1 completada y validada con colas BullMQ activas.
  - Servidor worker con soporte de GPU (NVIDIA CUDA) o CPU multi-núcleo configurado.
- **Entregables:**
  1. **Microservicio Worker Python:** Contenedor Docker con Python 3.11, PyTorch y `HTDemucs v4`.
  2. **Módulo de Análisis Rítmico:** Integración de `Madmom` para detección de BPM, mapa de cambios de tempo y compás (downbeat tracking 4/4, 3/4, 6/8).
  3. **Almacenamiento de Stems:** Guardado estructurado de las 4 pistas WAV resultantes en MinIO.
  4. **Actualización de `MultitrackService`:** Vinculación automática de los stems generados con la sesión multipista de la canción.
  5. **Reproductor Multipista Frontend:** Mejora de `AudioPlayerBar` para permitir silenciar (*mute*), solear (*solo*) y ajustar volumen independiente de la voz o la batería.
- **Estimación de Complejidad:** Media-Alta (3 a 4 semanas).
- **Riesgos Principales:** Consumo de VRAM en canciones largas mayores a 6 minutos (mitigado con segmentación de audio por trozos con solapamiento *crossfade* en Demucs).
- **Criterio de Salida (Exit Gate):**
  - Subida de un archivo MP3 de 4 minutos; separación exitosa en 4 pistas en menos de 90 segundos; detección exacta del BPM (+/- 1 BPM frente a referencia humana).

---

### FASE 3: PIPELINE DE TRANSCRIPCIÓN IA (AUDIO-TO-SCORE: NOTAS, ACORDES Y LETRAS)

- **Objetivo:** Convertir los stems de audio en información musical estructurada (notas melódicas, acordes cifrados y letras sincronizadas) ensambladas en `CanonicalMusicPayload 2.0`.
- **Criterios de Entrada:**
  - Fase 2 completada con stems aislados disponibles.
- **Entregables:**
  1. **Worker de Transcripción Melódica:** Integración de `Spotify Basic Pitch` (ONNX) para extraer notas MIDI con cuantización automática a la grilla métrica de 480 TPQN.
  2. **Worker de Acordes Armónicos:** Integración de `BTC (Bidirectional Transformer for Chords)` para identificar tríadas, séptimas, disminuidos e inversiones sobre la pista instrumental.
  3. **Worker de Letras y Fonemas:** Integración de `WhisperX` sobre el stem de voz para transcribir el texto litúrgico en español/inglés y alinear cada sílaba con su marca temporal.
  4. **Algoritmo de Fusión Canónica (Score Synthesizer):** Enlace determinista que asocia notas melódicas, acordes en el compás y sílabas líricas, generando un `CanonicalMusicPayload 2.0` con etiquetas `confidenceScore`.
- **Estimación de Complejidad:** Alta (4 a 5 semanas).
- **Riesgos Principales:** Falsos positivos en notas de adorno o vibrato vocal (mitigado con filtros de umbral de energía y duración mínima de 60 ms).
- **Criterio de Salida (Exit Gate):**
  - Una canción de alabanza en audio produce automáticamente una propuesta estructurada con acordes, letra y melodía vocal con una precisión subjetiva superior al 85% y confianzas explícitas por elemento.

---

### FASE 4: MOTOR OMR PROFESIONAL Y CAPTURA FOTOGRÁFICA / SCAN

- **Objetivo:** Integrar un motor OMR real para procesar partituras escaneadas, PDFs con pentagramas y captura directa desde la cámara de tablets o móviles.
- **Criterios de Entrada:**
  - Fases 1 a 3 operativas.
  - Contenedor Java 17 headless para Audiveris.
- **Entregables:**
  1. **Microservicio OMR Audiveris:** Contenedor Docker aislado que recibe imágenes/PDFs, ejecuta binarización, deskewing (corrección de inclinación) y exporta MusicXML 4.0.
  2. **Adaptador en Backend:** Conexión de `OmrService` con el microservicio Audiveris, reemplazando el stub actual por la llamada real al CLI headless.
  3. **Captura con Cámara en Frontend:** Componente web con acceso a `navigator.mediaDevices.getUserMedia` para fotografiar partituras físicas directamente desde el atril digital en tablets.
  4. **Filtro de Preprocesamiento:** Normalización de contraste y eliminación de sombras en el navegador mediante Canvas antes del envío al servidor OMR.
- **Estimación de Complejidad:** Media-Alta (3 a 4 semanas).
- **Riesgos Principales:** Partituras manuscritas o de baja iluminación (mitigado con advertencias de calidad y rechazo automático si la resolución es menor a 150 DPI).
- **Criterio de Salida (Exit Gate):**
  - El escaneo de una partitura tradicional de himnario (como *Grande es tu fidelidad*) genera un MusicXML válido que se proyecta en el atril sin intervención manual con más del 90% de notas y armaduras correctas.

---

### FASE 5: EDITOR MUSICAL INTERACTIVO Y FLUJO DE REVISIÓN HUMANA (HUMAN-IN-THE-LOOP)

- **Objetivo:** Proporcionar al director de alabanza o músico una interfaz ergonómica para revisar la propuesta de la IA, corregir notas/acordes dudosos y aprobar la versión oficial.
- **Criterios de Entrada:**
  - Fases 3 y 4 entregando propuestas preliminares con `isAiDraft: true`.
- **Entregables:**
  1. **Inspector de Propuestas de IA:** Interfaz visual que resalta en color ámbar compases o notas con confianza < 0.80.
  2. **Editor de Acordes y Letras:** Edición directa en línea (hacer clic en un acorde para cambiarlo con sugerencias armónicas inteligentes del círculo de quintas).
  3. **Editor de Notación en Pentagrama:** Manipulación interactiva de notas (arrastrar altura, cambiar figura rítmica, añadir ligadura) utilizando Canvas reactivo.
  4. **Reproducción de Prueba A/B:** Escucha simultánea del stem original y la nota editada sintetizada por Web Audio API.
  5. **Botón de Aprobación Canónica:** Transición formal de `OmrProposal` / `TranscriptionDraft` a `SongVersion` oficial persistida en PostgreSQL.
- **Estimación de Complejidad:** Alta (4 a 5 semanas).
- **Riesgos Principales:** Complejidad ergonómica en pantallas táctiles (mitigado con botones grandes y teclado musical virtual emergente).
- **Criterio de Salida (Exit Gate):**
  - Un usuario músico puede corregir un acorde mal detectado y ajustar una sílaba en menos de 30 segundos y guardar la canción directamente en el repertorio litúrgico.

---

### FASE 6: ATRIL LITÚRGICO AVANZADO, MODO PERFORMANCE Y BLINDAJE DE PRODUCCIÓN

- **Objetivo:** Optimizar la experiencia de ejecución en vivo en el atril y garantizar el cumplimiento legal y de seguridad.
- **Criterios de Entrada:**
  - Editor y pipeline de transcripción totalmente funcionales y aprobados.
- **Entregables:**
  1. **Modo Rendimiento en Pantalla Completa:** Activación de `Fullscreen API` y `Wake Lock API` (evita que la pantalla de la tablet se apague durante el culto).
  2. **Metrónomo Sincronizado Visual/Auditivo:** Clic auditivo por Web Audio API y pulso visual sutil en el borde de la pantalla ajustado al BPM canónico.
  3. **Sincronización Litúrgica en Vivo:** Notificación a todos los atriles conectados cuando el director cambia de canción o momento litúrgico vía WebSocket.
  4. **Blindaje de Seguridad y Cuotas:** Rate limiting por usuario, escaneo antivirus ClamAV en subidas y políticas de retención con borrado automático de archivos temporales a las 48 horas.
- **Estimación de Complejidad:** Media (2 a 3 semanas).
- **Riesgos Principales:** Latencia de red en conexiones móviles deficientes (mitigado con la arquitectura Offline-First de IndexedDB).
- **Criterio de Salida (Exit Gate):**
  - Prueba de ensayo general de 2 horas sin fallos de pantalla, con setlist sincronizado y reproducción continua de atril offline sin conexión a internet.

---

## 3. RESUMEN CRONOLÓGICO Y ESTIMACIÓN DE ESFUERZO

| Fase | Enfoque Principal | Duración Estimada | Dependencias Críticas |
|---|---|---|---|
| **Fase 1** | Infraestructura Asíncrona (Redis, BullMQ, MinIO, WebSockets) | 2 - 3 semanas | Ninguna (Requiere Docker) |
| **Fase 2** | Separación de Audio (Demucs v4) y Detección de BPM (Madmom) | 3 - 4 semanas | Fase 1 completada |
| **Fase 3** | Transcripción AI (Basic Pitch, BTC Chords, WhisperX) | 4 - 5 semanas | Fase 2 completada |
| **Fase 4** | Motor OMR (Audiveris) y Captura Fotográfica | 3 - 4 semanas | Fase 1 completada |
| **Fase 5** | Editor Musical Interactivo y Revisión Humana | 4 - 5 semanas | Fases 3 y 4 completadas |
| **Fase 6** | Atril Avanzado, Modo Performance y Producción | 2 - 3 semanas | Fase 5 completada |
| **TOTAL** | **Transformación Completa de la Plataforma** | **18 - 24 semanas (~4.5 a 6 meses)** | Ejecución secuencial por compuertas |

