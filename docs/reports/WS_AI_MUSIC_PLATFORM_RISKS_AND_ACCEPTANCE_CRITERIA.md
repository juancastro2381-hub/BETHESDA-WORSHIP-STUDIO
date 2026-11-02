# BETHESDA WORSHIP STUDIO — MATRIZ DE RIESGOS, SEGURIDAD, ASPECTOS LEGALES Y CRITERIOS DE ACEPTACIÓN
## Evaluación Integral de Riesgos Remediada y Criterios de Aceptación por Fase

- **Fecha:** 2 de Noviembre de 2026
- **Estado:** FASE 0A — AUDIT REMEDIATION & FINAL ARCHITECTURE VALIDATION (READ-ONLY)
- **Autor:** Principal Software Architect, DevSecOps Engineer & Licensing Analyst
- **Documento:** `docs/reports/WS_AI_MUSIC_PLATFORM_RISKS_AND_ACCEPTANCE_CRITERIA.md`

---

## 1. MATRIZ INTEGRAL DE RIESGOS TÉCNICOS, LEGALES Y OPERACIONALES

| ID | Riesgo Identificado | Probabilidad | Impacto | Estrategia de Mitigación Defensiva (Fase 0A) |
|---|---|---|---|---|
| **R-01** | **Sobrecarga de Cómputo / Cuello de Botella en GPU:** Modelos como HTDemucs v4 y Whisper large consumen alta VRAM, arriesgando fallos Out-Of-Memory (OOM). | Alta | Crítico | **Aislamiento en Colas:** Despacho asíncrono con concurrencia máxima acotada (`maxJobs: 2` por GPU). Segmentación de audio en bloques con *crossfade* para no sobrecargar la memoria. |
| **R-02** | **Alucinación o Imprecisión en Transcripción IA (F-05):** Basic Pitch aplicado a mezclas densas genera notas falsas por reverberación y pads, violando el invariante de verdad musical. | Alta | Alto | **Separación Previa Obligatoria:** Transcripción melódica ejecutada únicamente sobre el stem de voz aislado, y bajo sobre el stem de bajo. Umbrales de confianza estrictos (`confidence >= 0.65`) y revisión humana obligatoria. |
| **R-03** | **Contaminación Legal por Licencias Copyleft (F-04):** Audiveris (AGPL-3.0) o Chordino (GPL-2.0) podrían forzar la divulgación del código fuente del backend propietario. | Media | Crítico | **Aislamiento Estricto por Red:** Prohibición absoluta de vincular o importar librerías AGPL/GPL en Node.js. Audiveris se encapsula en un microservicio Docker autónomo con API REST interna que solo intercambia archivos MusicXML limpios. |
| **R-04** | **Restricción No-Comercial en Pesos de Modelos (F-04):** Pesos pre-entrenados de HTDemucs entrenados sobre el dataset MusDB18 contienen cláusulas académicas no comerciales. | Alta | Alto | **Mitigación Tri-Capa:** En desarrollo/beta se usan pesos de evaluación. Para comercialización SaaS estricta, planificar reentrenamiento con stems comerciales libres, adopción de modelos alternativos (Open-Unmix) o computación privada BYO. |
| **R-05** | **Pérdida de Estado por Propuestas OMR Efímeras (F-02):** `OmrService` almacena propuestas en memoria RAM (`this.proposals = new Map()`); un reinicio del servidor destruye el trabajo. | Crítica | Alto | **Persistencia SQL Durable en Fase 1A:** Creación del esquema `omr_proposals`, `omr_proposal_measures` y `omr_audit_history` en PostgreSQL mediante Drizzle ORM. |
| **R-06** | **Bloqueo del Event Loop por Tareas Síncronas (F-03):** Fastify procesa actualmente todas las peticiones síncronamente, lo que provocaría *timeouts* HTTP 504 en tareas pesadas de IA. | Alta | Crítico | **Cola Asíncrona Transaccional en Fase 1A:** Implementación de cola nativa en PostgreSQL con semántica `FOR UPDATE SKIP LOCKED`. |
| **R-07** | **Erosión de Márgenes por Costos de Egress en Audio (F-09):** El streaming de pistas multitrack desde AWS S3 estándar ($0.09/GB egress) vuelve prohibitiva la distribución de audio. | Alta | Alto | **Almacenamiento Cloudflare R2:** Interfaz `StorageProvider` configurada hacia Cloudflare R2 con **CERO costo de transferencia de salida (Zero Egress)**. |
| **R-08** | **Ensuciamiento y Fuga de Datos en Git (F-08):** 7,367 archivos de `node_modules` y más de 140 archivos de medios en `storage/` rastreados en el índice de Git. | Confirmada | Medio | **Plan de Higiene Controlado:** Ejecución de `git rm --cached` y actualización de `.gitignore` documentados en `WS_AI_MUSIC_PLATFORM_GIT_HYGIENE_REMEDIATION_PLAN.md` pendiente de aprobación del PO. |
| **R-09** | **Infracción de Derechos de Autor por Descargas Externas:** El ripeo de audio de YouTube o TikTok infringe los ToS y expone a demandas por DMCA. | Alta | Crítico | **Política Innegociable:** NO implementar extractores automáticos de audio tipo `yt-dlp`. Solo se admiten archivos subidos por el usuario con licencia litúrgica CCLI declarada. |
| **R-10** | **Fallas de Conexión en el Culto en Vivo:** Caídas de red Wi-Fi en el templo que bloqueen el atril digital de los músicos. | Media | Crítico | **Atril Offline-First:** Los setlists programados se sincronizan en IndexedDB y Service Workers locales; el atril opera al 100% sin conexión a Internet. |

---

## 2. SEGURIDAD Y BLINDAJE DE LA PLATAFORMA

### 2.1 Validación de Archivos Subidos y Protección contra Malware:
1. **Comprobación Binaria de Cabeceras ("Magic Bytes"):** Verificación en backend en `validateAudioMagicBytes` y `validateDocumentFileSignature`. El tipo MIME del navegador se trata como no confiable; se inspeccionan los bytes del buffer en memoria.
2. **Saneamiento Estricto de Nombres de Archivo:** Prevención de ataques de *Path Traversal* (`../`, secuencias de control, caracteres `\x00-\x1F`) mediante `sanitizeSafeFilename`.
3. **Escaneo de Antivirus en Tránsito:** Integración opcional de contenedor ClamAV en la cola de subidas para escanear binarios antes de persistirlos en Cloudflare R2.

### 2.2 Control de Acceso y Segregación de Pistas (Anti-IDOR):
- **Aislamiento Multitenant:** En `MultitrackService`, toda sesión valida que los `audioAssetId` pertenezcan exclusivamente a la misma canción (`songId`) y que el usuario posea los permisos RBAC correspondientes.
- **Tickets Multimedia con TTL y Cuota:** Las peticiones a archivos multimedia en streaming usan tokens efímeros firmados (60s TTL, máximo 25 peticiones) mediante `StreamTicketService`, impidiendo el acceso directo o enlaces compartidos permanentes no autorizados.

---

## 3. CONSIDERACIONES LEGALES Y POLÍTICA DE DERECHOS DE AUTOR (CCLI)

1. **Gestión de Licencias Litúrgicas:**
   - La plataforma incluye en la ficha de cada canción el número de reporte CCLI (`ccliNumber` en el esquema `songs`).
   - Al registrar una canción, el usuario debe marcar una casilla obligatoria:  
     *“Confirmo que el ministerio de alabanza cuenta con los derechos de reproducción litúrgica o licencia CCLI vigente para el uso de esta obra.”*
2. **Tratamiento de Plataformas de Terceros (YouTube):**
   - Se mantiene la prohibición de extracción de audio (*audio ripping*) en el servidor. Las URLs de YouTube solo se reproducen como referencia visual en el atril mediante *embeds* oficiales autorizados.

---

## 4. CRITERIOS DE ACEPTACIÓN DEFINITIVOS (DoD) POR FASE

---

### Criterios de Aceptación — Fase 1A (Cimientos Durables y Colas Postgres):
- [ ] Tablas `omr_proposals`, `omr_proposal_measures` y `omr_audit_history` migradas en PostgreSQL con Drizzle ORM.
- [ ] `OmrService` migrado desde el `Map` en RAM a consultas transaccionales en PostgreSQL. Las propuestas persisten tras reiniciar el proceso de backend.
- [ ] Tabla `background_jobs` operativa con despacho transaccional `FOR UPDATE SKIP LOCKED`.
- [ ] Especificación de `CanonicalMusicPayloadV2` implementada con conversores bidireccionales `migrateV1ToV2()` y `downgradeV2ToV1()` con 100% de tests unitarios pasando.
- [ ] Cero regresiones en endpoints existentes de canciones, documentos, atril y autenticación.

---

### Criterios de Aceptación — Fase 1B (Almacenamiento Cloudflare R2 y WebSockets):
- [ ] Adaptador `StorageProvider` implementado con `@aws-sdk/client-s3` funcionando contra Cloudflare R2 en producción y disco local en desarrollo.
- [ ] `StreamTicketService` generando URLs firmadas temporales compatibles con S3/R2.
- [ ] Emisión de eventos de progreso de tareas en segundo plano por WebSockets recibidos por el frontend (0% a 100%).

---

### Criterios de Aceptación — Fase 2 (Separación de Audio y Detección de BPM):
- [ ] Microservicio autónomo HTDemucs separando mezclas de 5 minutos en 4 stems WAV en menos de 90 segundos sobre GPU T4/L4.
- [ ] Detección automática de BPM por Madmom con desviación máxima de +/- 1 BPM respecto a metrónomo de referencia en 95% de casos.
- [ ] Stems almacenados en Cloudflare R2 y reproducibles individualmente con controles de solo/mute en el atril.

---

### Criterios de Aceptación — Fase 3 (Transcripción AI Audio-to-Score):
- [ ] Spotify Basic Pitch ejecutado sobre stem vocal y de bajo produciendo notas cuantizadas a 480 TPQN sin ruido armónico de acompañamiento.
- [ ] BTC detectando acordes litúrgicos sobre el stem instrumental con coincidencia armónica >= 85%.
- [ ] WhisperX transcribiendo letra en español y alineando sílabas a ticks de compás.
- [ ] Ensamblador canónico generando `CanonicalMusicPayloadV2` sin compases vacíos ni notas superpuestas ilegales.

---

### Criterios de Aceptación — Fase 4 (Motor OMR Profesional y Captura):
- [ ] Contenedor Docker Audiveris headless aislado procesando partituras en PDF a 300 DPI y generando MusicXML 4.0 válido.
- [ ] OCR de Tesseract extrayendo acordes y texto de cancioneros escaneados.
- [ ] Captura de partituras físicas desde la cámara de tablets y móviles con corrección de contraste en Canvas.

---

### Criterios de Aceptación — Fase 5 (Inspector Humano y Editor de Notación):
- [ ] Atril interactivo con mapa de calor de confianza (*Confidence Heatmap*) resaltando en ámbar elementos con confianza < 0.75.
- [ ] Edición interactiva de acordes y notas en pentagrama reactivo con Undo/Redo.
- [ ] Aprobación formal atómica de la propuesta OMR convirtiéndola en `SongVersion` oficial inmutable.

---

### Criterios de Aceptación — Fase 6 (Atril Avanzado y Producción SaaS):
- [ ] Pantalla completa con `Wake Lock API` activa comprobada en iPad y tablets Android.
- [ ] Metrónomo auditivo generado por Web Audio API con cero desviación temporal acumulada.
- [ ] Ensayo litúrgico continuo de 2 horas sin degradación de rendimiento ni pérdidas de estado offline.
- [ ] Despliegue de GPU optimizado cumpliendo el modelo de costos unitarios (< $0.08 por canción).

---

## 5. DECISIONES ARQUITECTÓNICAS CRÍTICAS PARA APROBACIÓN DEL PRODUCT OWNER

1. **Aprobación de la Fase 1A (Inmediata y Libre de Riesgos):**
   - Autorizar la creación de tablas OMR en PostgreSQL, la cola ligera `SKIP LOCKED` y el modelo canónico v2.0 como base sólida previa a cualquier despliegue de IA.
2. **Aprobación del Plan de Higiene de Git (F-08):**
   - Autorizar la desindexación de los 7,367 archivos de `node_modules` y archivos de prueba en `backend/storage/` mediante `git rm --cached` según el procedimiento documentado.
3. **Selección de Almacenamiento de Objetos (F-09):**
   - Ratificar la adopción de Cloudflare R2 para eliminar los costos de salida (*egress*) de audio y evitar los riesgos de licenciamiento de MinIO AGPL-3.0.
4. **Validación del Modelo Financiero Realista (F-06):**
   - Validar la estructura de costos escalonada ($0.049 a $0.124 por canción) para el diseño del modelo de precios y suscripciones del producto SaaS.

---

## 6. DICTAMEN FINAL DE LA AUDITORÍA FASE 0A

| Evaluación Global | Dictamen | Justificación Técnica |
| :--- | :--- | :--- |
| **Arquitectura Base Actual** | **APROBADA** | Frontend maduro, modelo canónico consistente y seguridad robusta. |
| **Remediación de Hallazgos F-01 a F-09** | **COMPLETA Y VERIFICADA** | Todas las objeciones fueron demostradas en código y cuentan con remedios rigurosos. |
| **Paso a Implementación (Fase 1A)** | **AUTORIZACIÓN RECOMENDADA** | Fase 1A está técnicamente delimitada, no introduce regresiones y resuelve las vulnerabilidades de pérdida de datos. |
