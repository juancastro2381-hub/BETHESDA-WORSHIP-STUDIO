# BETHESDA WORSHIP STUDIO — MATRIZ DE RIESGOS, SEGURIDAD, ASPECTOS LEGALES Y CRITERIOS DE ACEPTACIÓN
## Evaluación Integral de Riesgos y Gobernanza de la Plataforma de IA Musical

- **Fecha:** 2 de Noviembre de 2026
- **Estado:** FASE 0 — STRICTLY READ-ONLY ARCHITECTURAL ASSESSMENT
- **Autor:** Principal Software Architect & Technical Product Lead
- **Documento:** `docs/reports/WS_AI_MUSIC_PLATFORM_RISKS_AND_ACCEPTANCE_CRITERIA.md`

---

## 1. MATRIZ DE RIESGOS TÉCNICOS Y OPERACIONALES

| ID | Riesgo Identificado | Probabilidad | Impacto | Estrategia de Mitigación Rigurosa |
|---|---|---|---|---|
| **R-01** | **Sobrecarga de Cómputo / Cuello de Botella en GPU:** Modelos como Demucs v4 y Whisper large consumen alta memoria de VRAM, provocando caídas por Out-Of-Memory (OOM) ante peticiones concurrentes. | Alta | Crítico | **Mitigación Arquitectónica:** Aislamiento total de workers en colas BullMQ con concurrencia máxima acotada (ej. `maxJobs: 2` por GPU). Si la cola supera el umbral, los trabajos esperan en estado `QUEUED`. Implementación de *chunks* de audio con solapamiento (*crossfade*) para evitar procesar archivos enteros de golpe en memoria. |
| **R-02** | **Alucinación o Imprecisión en Transcripción de IA:** Transcripción de notas fantasma debido a vibrato vocal, reverberación de la sala o distorsión armónica en guitarras. | Alta | Alto | **Mitigación de Verdad Musical:** Umbrales de confianza mínimos (descarte de eventos con energía < 0.30 y duración < 60 ms). Marcado visual explícito de compases dudosos (Confidence Heatmap) y **revisión humana obligatoria antes de consolidar en el catálogo canónico**. Cero notas falsas garantizado. |
| **R-03** | **Contaminación Legal por Licencias GPL / AGPL:** El uso de herramientas maduras como Audiveris (AGPL-3.0) o Aubio (GPL-3.0) podría forzar la apertura del código fuente de toda la aplicación si se vinculan estáticamente o comparten espacio de memoria. | Media | Crítico | **Aislamiento Estricto por Red (Network Boundary):** Se prohíbe importar librerías GPL/AGPL dentro del backend Node.js o frontend React. Audiveris se encapsula en un microservicio Docker independiente con interfaz HTTP/CLI externa que solo intercambia archivos MusicXML limpios, cumpliendo estrictamente con la doctrina de aislamiento de licencias de software libre. |
| **R-04** | **Infracción de Derechos de Autor por Ripeo de Plataformas Externas:** La descarga directa de audio desde URLs de YouTube, TikTok o plataformas similares viola los Términos de Servicio de dichas plataformas y expone a la organización a demandas por DMCA / piratería. | Alta | Crítico | **Cumplimiento Legal Mandatorio:** **NO implementar descargadores automáticos de YouTube ni herramientas tipo yt-dlp en el servidor.** La plataforma aceptará únicamente archivos de audio/partituras subidos directamente por los usuarios con declaración jurada de derechos o licencia CCLI válida. Para videos, solo se admitirá incrustación legítima mediante `<iframe>` oficial de YouTube sin extracción de audio. |
| **R-05** | **Saturación y Fugas de Almacenamiento en Disco:** Los archivos de audio originales más los 4 stems WAV descompresos generan entre 150 y 250 MB por cada canción procesada. 1,000 canciones demandarían 250 GB rápidamente. | Alta | Alto | **Políticas de Ciclo de Vida (Bucket Lifecycle):** Solo se conservan indefinidamente la canción canónica (`CanonicalMusicPayload`), los metadatos y el audio original. Los stems intermedios de trabajo no confirmados por el usuario en 48 horas se eliminan automáticamente mediante tareas cron programadas en MinIO/S3. Los stems de canciones confirmadas se comprimen a FLAC u OGG de alta tasa de bits. |
| **R-06** | **Fallas de Red Durante el Culto en Vivo (Servicio Litúrgico):** Pérdida de conexión Wi-Fi en el templo que inhabilite el visor de partituras para los músicos en el atril. | Media | Crítico | **Arquitectura Offline-First:** Los setlists y canciones programadas para el servicio se descargan automáticamente en la memoria IndexedDB de las tablets del equipo mediante `OfflineManager`. El atril funciona al 100% sin conexión a internet una vez cargado el servicio. |

---

## 2. SEGURIDAD Y BLINDAJE DE LA PLATAFORMA

### 2.1 Validación de Archivos Subidos y Protección contra Malware:
1. **Comprobación Binaria de Cabeceras ("Magic Bytes"):** Se mantiene la verificación en backend implementada en `validateAudioMagicBytes` y `validateDocumentFileSignature`. La extensión del archivo y el encabezado `Content-Type` enviado por el navegador son tratados como no confiables; el servidor inspecciona los primeros bytes del buffer real.
2. **Saneamiento Estricto de Nombres de Archivo:** Prevención de ataques de *Path Traversal* (`../`, secuencias de control, caracteres `\x00-\x1F`) mediante `sanitizeSafeFilename`.
3. **Escaneo de Antivirus en Tránsito:** Integración de un contenedor ClamAV en la cola de subidas para escanear archivos binarios antes de transferirlos a MinIO.

### 2.2 Control de Acceso y Segregación de Pistas (Anti-IDOR):
- **Aislamiento Multitenant:** En `MultitrackService`, toda sesión valida que los `audioAssetId` pertenezcan exclusivamente a la misma canción (`songId`) y que el usuario posea el permiso `songs:update_draft` o `songs:create`.
- **Tickets Multimedia con TTL y Cuota:** Las peticiones a archivos multimedia en streaming usan tokens efímeros firmados (60s TTL, máximo 25 peticiones) mediante `StreamTicketService`, impidiendo el acceso directo o enlaces compartidos permanentes no autorizados.

---

## 3. CONSIDERACIONES LEGALES Y POLÍTICA DE DERECHOS DE AUTOR

1. **Gestión de Licencias Litúrgicas (CCLI / Christian Copyright Licensing International):**
   - La plataforma debe incorporar en la ficha de cada canción el número de reporte CCLI (`ccliNumber` ya presente en el esquema `songs`).
   - Al registrar una canción, el usuario debe marcar una casilla obligatoria:  
     *“Confirmo que el ministerio de alabanza cuenta con los derechos de reproducción litúrgica o licencia CCLI vigente para el uso de esta obra.”*
2. **Tratamiento de Plataformas de Terceros (YouTube / Spotify):**
   - Se establece como política innegociable **no incorporar capacidades de extracción de audio (*audio ripping*) en el backend**. Las URLs de YouTube solo se almacenan como referencia visual en el atril mediante reproductores oficiales incrustados (*embeds* autorizados con consentimiento de cookies).

---

## 4. CRITERIOS DE ACEPTACIÓN DEFINITIVOS (DEFINITION OF DONE - DoD) POR FASE

Para dar por concluida cada una de las fases del roadmap y proceder a la siguiente, se deben cumplir rigurosamente los siguientes criterios medibles:

### Criterios de Aceptación — Fase 1 (Infraestructura Asíncrona):
- [ ] Redis 7 y MinIO corriendo bajo Docker Compose con salud comprobada por endpoints de healthcheck.
- [ ] Encolamiento de tareas de prueba mediante BullMQ con reintentos configurables (máximo 3 intentos con retroceso exponencial).
- [ ] Emisión de eventos de progreso por WebSocket recibidos en el cliente React en tiempo real (0% a 100%).
- [ ] Cobertura de pruebas unitarias e integración en backend >= 90% para la capa de colas.

### Criterios de Aceptación — Fase 2 (Separación de Audio y Detección de BPM):
- [ ] Microservicio Demucs v4 procesando archivos estéreo y produciendo 4 stems WAV con separación nítida.
- [ ] Detección automática de BPM por Madmom con una desviación máxima de +/- 1 BPM respecto al metrónomo real en el 95% de canciones de prueba.
- [ ] Almacenamiento seguro de stems en MinIO con claves UUID y cálculo de checksum SHA-256.
- [ ] El reproductor `AudioPlayerBar` permite mezclar volúmenes independientes por stem en el navegador.

### Criterios de Aceptación — Fase 3 (Transcripción AI Audio-to-Score):
- [ ] Spotify Basic Pitch genera eventos de nota con cuantización temporal válida a 480 TPQN.
- [ ] BTC detecta acordes armónicos mayores, menores y séptimas con una precisión de coincidencia armónica >= 85%.
- [ ] WhisperX transcribe la letra en español y genera marcas de tiempo fonéticas vinculadas a los compases.
- [ ] El ensamblador canónico consolida un `CanonicalMusicPayload 2.0` válido que pasa la validación de `CanonicalModelValidator` sin compases vacíos ni notas superpuestas ilegales.

### Criterios de Aceptación — Fase 4 (Motor OMR y Captura):
- [ ] Audiveris headless procesa partituras en PDF e imágenes a 300 DPI generando MusicXML 4.0 válido.
- [ ] La interfaz permite captura directa desde cámara de tablet o móvil con previsualización y recorte rectangular.
- [ ] El MusicXML generado por OMR se carga en `MusicXmlImporter` sin excepciones y se proyecta en el atril digital.

### Criterios de Aceptación — Fase 5 (Editor Interactivo y Revisión Humana):
- [ ] El atril despliega el mapa de calor de confianza (*Confidence Heatmap*) resaltando en ámbar elementos con confianza < 0.80.
- [ ] Edición interactiva de acordes y notas con funcionalidad de Deshacer/Rehacer (*Undo/Redo*).
- [ ] Reproducción simultánea A/B de audio original y síntesis de notas para validación de afinación de oído.
- [ ] La aprobación formal del usuario persiste la canción como `SongVersion` oficial con número de versión autoincrementado.

### Criterios de Aceptación — Fase 6 (Atril Avanzado y Producción):
- [ ] Modo pantalla completa con `Wake Lock API` activa comprobada en dispositivos iPad y Android.
- [ ] Metrónomo auditivo generado por Web Audio API con cero desviación temporal acumulada.
- [ ] Ensayo litúrgico simulado de 2 horas sin caídas, fugas de memoria ni interrupciones del atril offline.
- [ ] Auditoría de seguridad sin vulnerabilidades críticas o altas (OWASP Top 10) y suite de pruebas completa en verde.

---

## 5. DECISIONES ARQUITECTÓNICAS CRÍTICAS QUE REQUIEREN APROBACIÓN DEL PRODUCT OWNER

Antes de pasar a la Fase 1 de implementación, se somete a consideración y decisión formal del Product Owner los siguientes puntos estratégicos:

1. **Decisión 1: Estrategia de Infraestructura para Inferencia de IA (Local vs Nube):**
   - *Opción A (Recomendada):* Servidor dedicado local (Bare-metal) con GPU NVIDIA de gama media (RTX 4060 Ti 16GB) por un costo único de hardware de ~\$1,400 USD y costos mensuales marginales.
   - *Opción B:* Workers serverless en la nube (RunPod / AWS g4dn bajo demanda) a ~\$0.013 USD por canción transcrita.
2. **Decisión 2: Política de URLs Externas (YouTube):**
   - *Recomendación del Arquitecto:* Rechazar el ripeo de audio en el servidor por riesgos de infracción de términos de YouTube y DMCA. Admitir únicamente archivos originales subidos por el usuario (MP3/WAV) o grabación directa con micrófono.
3. **Decisión 3: Nivel de Automatización de Catálogo:**
   - *Recomendación del Arquitecto:* Mantener estricto el principio *Human-in-the-Loop*. Ninguna salida de IA u OMR debe publicarse en el catálogo oficial de la congregación sin la revisión y firma previa del director de alabanza.

