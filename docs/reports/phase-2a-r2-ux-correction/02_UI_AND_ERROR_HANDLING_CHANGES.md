# BETHESDA WORSHIP STUDIO — PHASE 2A-R2 UX CORRECTION
## REPORT 02: MODIFICACIONES DE INTERFAZ DE USUARIO Y TRATAMIENTO DE ERRORES

**Proyecto:** Bethesda Worship Studio  
**Rama:** `feature/phase-1a-core-foundation`  
**Fase:** Phase 2A-R2 UX Correction — Conversion Capability Accuracy  
**Agente:** Antigravity — Principal Software Engineer & Systems Architect  
**Estado:** PENDING INDEPENDENT REVIEW  

---

### 1. OBJETIVO DEL COMPONENTE VISUAL Y MANEJO DE ERRORES

Alinear la experiencia de usuario del Centro de Conversión Musical (`ConversionCenterWorkspace.tsx`) con la realidad técnica de las capacidades del sistema, previniendo solicitudes condenadas al fracaso, eliminando bucles infinitos de reintento y ofreciendo diagnósticos empáticos y transparentes en español.

---

### 2. PRINCIPALES CAMBIOS IMPLEMENTADOS

#### 2.1 Barra Superior de Estado del Sistema y Compatibilidad (`conversion-health-bar`)
Se introdujo una barra de estado desacoplada en la parte superior del espacio de trabajo que discrimina 3 dimensiones independientes de salud y disponibilidad:
1. **Conectividad del Servidor API:** Indica si el backend Fastify responde adecuadamente (`🟢 Servidor API: En línea`).
2. **Motor de Cola & Workers:** Indica si el sistema de procesamiento persistente en segundo plano (`pg-boss`) se encuentra activo o si el cliente opera en modo local transpilador (`🟢 Motor de Cola: pg-boss Activo`).
3. **Compatibilidad del Archivo:** Notifica el estado de capacidad del archivo cargado:
   - Sin archivo: `⚪ Esperando archivo...`
   - Formato Soportado: `🟢 Formato Soportado (MusicXML, MIDI, ChordPro)`
   - Compatibilidad Parcial: `⚠️ Soporte Parcial (Audio, PDF, Imagen, Letra)`
   - No Soportado: `❌ No Soportado (Tablatura)`
   - Planificado: `⏱️ Planificado Fase 2B`

#### 2.2 Banners Asesores de Capacidad de Fuente (`capability-advisory-banner`)
Al cargar un archivo cuya capacidad de conversión inmediata no está habilitada o presenta restricciones críticas, la UI presenta inmediatamente un banner contextual:
- **Audio (.mp3, .wav):**  
  > *"Archivo de audio reconocido y preservado de forma duradera. Puede reproducir el archivo en el atril digital. La transcripción automática polifónica a partitura (Demucs / Basic Pitch / Whisper) está planificada para la Fase 2B sin servicios comerciales de terceros."*
- **Documento PDF (.pdf):**  
  > *"Documento PDF reconocido y preservado de forma íntegra. Puede visualizarlo en el atril digital. La digitalización óptica de partituras (OMR) para convertir a notas editables está planificada para la Fase 2B."*
- **Partitura en Imagen (.png, .jpg):**  
  > *"Partitura en imagen reconocida y preservada. Puede visualizarla en el atril digital. El reconocimiento óptico de partituras (OMR) está planificado para la Fase 2B."*
- **ChordPro (.cho):**  
  > *"Conversión a formatos de texto y lead sheet disponible. La exportación a MIDI melódico está bloqueada por Cero Fabricación (la fuente no contiene notas melódicas)."*
- **Tablatura ASCII (.tab):**  
  > *"La ingesta y conversión directa de tablaturas ASCII no está soportada en esta versión. El motor de tablatura está planificado para la Fase 2B."*

#### 2.3 Matriz de Capacidades con Estados Canónicos Explícitos
En la Sección B y Sección C, cada formato objetivo ahora expone dos niveles de información visual:
1. **Badges de Estado de Capacidad Canónica:**
   - `badge-state-supported`: Verde (`SOPORTADO`)
   - `badge-state-partially-supported`: Ámbar (`PARCIAL`)
   - `badge-state-not-supported`: Rojo (`NO SOPORTADO`)
   - `badge-state-planned-phase-2b`: Pizarra (`PLANIFICADO FASE 2B`)
2. **Badges de Naturaleza de Salida:**
   - `NATIVO` | `CONVERTIBLE` | `BLOQUEADO (Cero Fabricación)` | `DIFERIDO (Fase 2B)`

#### 2.4 Blindaje del Botón de Ejecución de Conversión (Guards)
El botón de conversión (`btn-execute-conversion`) fue estrictamente blindado:
- Se deshabilita cuando `!canConvert` (ningún formato disponible para la fuente) o cuando el formato objetivo seleccionado no está disponible (`!isTargetAvailable`).
- El texto del botón refleja dinámicamente la situación:
  - `⚙️ Procesando...` (durante ejecución)
  - `🚫 Conversión no disponible (Planificado Fase 2B)` (cuando la fuente es audio o documento visual)
  - `🚫 Formato Objetivo No Disponible` (cuando se selecciona un destino bloqueado como ChordPro -> MIDI)
  - `🚀 Convertir Archivo` (cuando la operación es válida y viable)
- Si la conversión está deshabilitada, se presenta un cuadro explicativo que orienta al usuario hacia el atril digital.

#### 2.5 Tratamiento de Errores Empáticos en Español y Preservación de Diagnósticos
En lugar de presentar códigos internos en crudo (`SOURCE_CATEGORY_DEFERRED_PHASE`, `BLOCKED_ZERO_FABRICATION`), la UI renderiza la tarjeta `.human-friendly-error-card`:
- **Título comprensible:** e.g., *"Conversión Planificada para la Fase 2B"* o *"Conversión Bloqueada por Cero Fabricación"*.
- **Explicación clara en español:** Detalla por qué ocurrió y aclara que el archivo original no se perdió y fue preservado duraderamente.
- **Diagnóstico técnico preservado:** En una caja monoespaciada inferior para soporte y trazabilidad del desarrollador.

#### 2.6 Supresión de Reintentos Condenados (Infinite Retry Prevention)
Si el error responde a una imposibilidad permanente del formato (`isPermanentFailure`), el botón *"🔄 Reintentar Trabajo"* se oculta completamente y se sustituye por:
> *"ℹ️ Reintento deshabilitado: La conversión no es viable para este tipo de archivo en la versión actual."*  
Evitando que el usuario gaste recursos o caiga en un ciclo frustrante de fallos repetitivos.

#### 2.7 Validación Temprana en Backend (`ConversionJobService.createJob`)
En el servidor, si una petición de creación de trabajo llega para una fuente no convertible (e.g. `adoracion.mp3` a `MUSIC_XML` o ChordPro a `MIDI`), el backend responde de inmediato con `HTTP 400 Bad Request` (`ValidationError`), impidiendo encolar trabajos sentenciados a fallar en `pg-boss` o ensuciar la tabla `background_jobs`.

