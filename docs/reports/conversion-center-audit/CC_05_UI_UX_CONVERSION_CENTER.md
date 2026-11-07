# CC_05: UI/UX CONVERSION CENTER SPECIFICATION
## BETHESDA WORSHIP STUDIO — CONVERSION CENTER TECHNICAL AUDIT

- **Project:** Bethesda Worship Studio
- **Document ID:** `CC-05-UI-UX-CONVERSION-CENTER`
- **Audit Date:** November 2026
- **Status:** Complete UI/UX Specification & Design Guide
- **Repository Branch:** `feature/phase-1a-core-foundation`
- **Base Commit:** `51fef932b082df82bd31d643983a271c155eb4e2`
- **Execution Mode:** Read-Only Interface Design & User Flow Modeling

---

## 1. Product Vision & User Experience Goals

The **Bethesda Musical File Conversion Center** (`Centro de Conversión Musical`) is designed as a primary navigation hub in the Bethesda Worship Studio application.

### Key UX Principles:
1. **Frictionless Ingestion:** Drag-and-drop any musical artifact (MusicXML, ChordPro, MIDI, PDF, image, audio, or video link) into a single unified zone.
2. **Instant Capability Transparency:** The user immediately sees which output formats are available, which are approximate (AI/MIR), and which are strictly blocked by zero-fabrication rules with clear, educational explanations.
3. **Continuous Real-Time Feedback:** Long-running conversions (OMR, audio transcription) show multi-stage visual progress bars with estimated completion times via Server-Sent Events.
4. **Side-by-Side Verification (Human-in-the-Loop):** Probabilistic conversions display the original source document or audio waveform on the left and the editable musical transcription on the right.
5. **Multi-Action Fulfillment:** Users can immediately download the converted file (MusicXML, MIDI, ChordPro, PDF) or seamlessly commit it to their Bethesda Song Catalog or Digital Music Stand.

---

## 2. Six-Stage Conversion Workflow

```
 +---------------------------------------------------------------------------------------------------+
 | 1. INGESTION ZONE        | Drag & Drop file (MusicXML, MIDI, Audio, PDF, Image) or enter Video URL|
 +---------------------------------------------------------------------------------------------------+
                                            |
                                            v
 +---------------------------------------------------------------------------------------------------+
 | 2. TARGET SELECTOR       | Dynamic format grid (Sheet Music, MIDI, ChordPro, Lyrics, Tablature)   |
 +---------------------------------------------------------------------------------------------------+
                                            |
                                            v
 +---------------------------------------------------------------------------------------------------+
 | 3. CONFIGURATION         | Optional adjustments (Quantization, Key, Meter, Stem Separation)       |
 +---------------------------------------------------------------------------------------------------+
                                            |
                                            v
 +---------------------------------------------------------------------------------------------------+
 | 4. PROCESSING FEEDBACK   | Live progress bar, stages (Extracting -> Analyzing -> Assembling)     |
 +---------------------------------------------------------------------------------------------------+
                                            |
                                            v
 +---------------------------------------------------------------------------------------------------+
 | 5. SIDE-BY-SIDE REVIEW   | Original Source (Left) vs. Converted Interactive Music (Right)         |
 +---------------------------------------------------------------------------------------------------+
                                            |
                                            v
 +---------------------------------------------------------------------------------------------------+
 | 6. FULFILLMENT & COMMIT  | Download Converted File | Open in Digital Stand | Add to Song Catalog  |
 +---------------------------------------------------------------------------------------------------+
```

---

## 3. UI Component Specifications & Wireframes

### 3.1. Stage 1: Unified Ingestion Zone (`ConversionDropZone.tsx`)

The main entry point replaces fragmented modal triggers with a dedicated conversion dashboard:

```
+---------------------------------------------------------------------------------------------------+
|  CENTRO DE CONVERSIÓN MUSICAL BETHESDA                                    [ Mis Conversiones (3) ] |
|  Transforme cualquier fuente musical en formatos editables y reutilizables                        |
+---------------------------------------------------------------------------------------------------+
|                                                                                                   |
|    + - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - +    |
|    |                                                                                         |    |
|    |       [ 🎵 Icono de Carga / Nube Musical ]                                              |    |
|    |                                                                                         |    |
|    |       Arrastre y suelte su archivo musical aquí, o [ Explorar Archivos ]                |    |
|    |                                                                                         |    |
|    |       Formatos admitidos: MusicXML (.musicxml, .mxl), ChordPro (.cho, .crd),            |    |
|    |       MIDI (.mid), Partituras PDF, Imágenes (PNG, JPG), Audio (MP3, WAV, FLAC, M4A)     |    |
|    |       Límite máximo: 25 MB por archivo                                                  |    |
|    |                                                                                         |    |
|    + - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - +    |
|                                                                                                   |
|    O pegue el enlace de un video autorizado (YouTube / Vimeo):                                    |
|    [ https://www.youtube.com/watch?v=...                                    ] [ Ingestar Enlace ] |
|                                                                                                   |
+---------------------------------------------------------------------------------------------------+
```

---

### 3.2. Stage 2: Dynamic Target Format Selector (`FormatSelectorGrid.tsx`)

Once a file is dropped, the system detects its binary signature and renders the target format matrix:

```
+---------------------------------------------------------------------------------------------------+
| ARCHIVO DETECTADO: "Cancionero_Congregacional_2026.pdf" (Cancionero de Acordes y Letras)         |
| Tamaño: 3.4 MB | Firma: PDF Vectorial | Canciones detectadas: 14                                  |
+---------------------------------------------------------------------------------------------------+
| SELECCIONE EL FORMATO DE SALIDA DESEADO:                                                          |
|                                                                                                   |
| +-------------------------+ +-------------------------+ +-------------------------+               |
| | 📄 Cifrado ChordPro    | | 📝 Solo Letras (.txt)  | | 🎸 Tablaturas y Voicing |               |
| | Estado: DISPONIBLE      | | Estado: DISPONIBLE      | | Estado: DISPONIBLE      |               |
| | [✓] Nativo / Verificado | | [✓] Nativo / Verificado | | [✓] Digitación Guitarra |               |
| | Cifrado armónico sobre  | | Letra limpia sin       | | Diagramas de acordes y  |               |
| | cada sílaba poética.    | | acordes para proyección| | posiciones estándar.    |               |
| | [ Seleccionar ]         | | [ Seleccionar ]         | | [ Seleccionar ]         |               |
| +-------------------------+ +-------------------------+ +-------------------------+               |
|                                                                                                   |
| +-------------------------+ +-------------------------+                                           |
| | 🎼 Partitura Tradicional| | 🎹 Archivo MIDI (.mid) |                                           |
| | Estado: NO DISPONIBLE   | | Estado: NO DISPONIBLE   |                                           |
| | [🚫] Cero Invención     | | [🚫] Cero Invención     |                                           |
| | El documento no posee   | | No hay notas melódicas  |                                           |
| | pentagramas ni notas.   | | para secuenciar.        |                                           |
| | (Información bloqueada) | | (Información bloqueada) |                                           |
| +-------------------------+ +-------------------------+                                           |
+---------------------------------------------------------------------------------------------------+
```

---

### 3.3. Stage 3: Conversion Pre-Processing Options (`ConversionOptionsPanel.tsx`)

Depending on the chosen conversion pair, contextual tuning parameters are presented:
- **Audio to MIDI Options:**
  - *Sensibilidad de detección de notas:* Slider (Baja / Media / Alta).
  - *Rejilla de cuantización:* Select (`Sin cuantizar`, `Negras`, `Corcheas`, `Semicorcheas`, `Tresillos`).
  - *Umbral de pitch bend:* Toggle (Ignorar vibrato / Capturar modulación continua).
- **MIDI to MusicXML Options:**
  - *Tonalidad preferida:* Auto-detect vs Manual Override (ej. Sol Mayor / Mi Menor).
  - *Métrica sugerida:* Auto-detect vs Manual Override (ej. 4/4, 6/8, 3/4).
  - *Separación de pentagramas:* Manos divididas en Split Point (C4).
- **PDF Scanned Score (OMR) Options:**
  - *Detección de letra:* Activar OCR multilingüe (Español / Inglés).
  - *Transposición directa:* Transportar semitonos en el archivo resultante.

---

### 3.4. Stage 4: Real-Time Asynchronous Progress (`ConversionProgressCard.tsx`)

For asynchronous jobs, users receive immediate feedback:

```
+---------------------------------------------------------------------------------------------------+
| PROCESANDO CONVERSIÓN: "Alabanza_En_Vivo.mp3" -> Secuencia MIDI + Cifrado                         |
| ID de Tarea: 8f4a12c0-781e-458b-90ea-37bb8e390214                                                 |
+---------------------------------------------------------------------------------------------------+
|                                                                                                   |
|   [=====================================>.....................] 65%                               |
|                                                                                                   |
|   Etapa Actual: Extracción de progresión armónica y acordes cromáticos...                         |
|                                                                                                   |
|   ✓ 1. Verificación criptográfica SHA-256 completada (100%)                                       |
|   ✓ 2. Transcripción de alturas polifónicas (Basic Pitch ONNX) completada (100%)                  |
|   🔄 3. Reconocimiento armónico (Madmom Beat & Chroma Tracker) en curso...                        |
|   ⏳ 4. Ensamblado canónico y evaluación de confianza pendiente                                   |
|                                                                                                   |
|   Tiempo transcurrido: 14s | Tiempo estimado restante: 6s                                         |
+---------------------------------------------------------------------------------------------------+
```

---

### 3.5. Stage 5: Side-by-Side Verification & Correction Stage (`ConversionReviewStudio.tsx`)

The critical **Human-in-the-Loop** verification interface:

```
+---------------------------------------------------------------------------------------------------+
| REVISIÓN Y VALIDACIÓN DE CONVERSIÓN: "Gracia Sublime Es"                [ ⚠️ Propuesta Preliminar ]|
| Confianza global: 88.5% | Compases: 32 | Tonalidad detectada: Sol Mayor | Métrica: 4/4            |
+-------------------------------------------------+-------------------------------------------------+
| FUENTE ORIGINAL (Documento PDF / Audio)         | RESULTADO EDITABLE (Partitura / Cifrado)        |
+-------------------------------------------------+-------------------------------------------------+
|                                                 | Título: [ Gracia Sublime Es           ]         |
|  [ Vista previa del PDF escaneado con marcas    | Tonalidad: [ G (Sol Mayor)  v] Métrica: [ 4/4 v]  |
|    de recuadros amarillos en regiones           | Tempo: [ 104 ] BPM                              |
|    de baja confianza ]                          |                                                 |
|                                                 | [ Compás 1 ]                                    |
|  +-------------------------------------------+  | Acorde: [ G       ]  Tiempo: 1                  |
|  | [Recuadro Amarillo: Compás 4, voz 2]      |  | Notas:  G4 (blanca), B4 (blanca)                |
|  | "Confianza 71% - Posible silencio omitido"|  | Letra:  Gra -                                   |
|  +-------------------------------------------+  |                                                 |
|                                                 | [ Compás 2 ]                                    |
|  [ Controles de zoom: (+) (-) (Ajustar) ]       | Acorde: [ C       ]  Tiempo: 1                  |
|  [ Reproductor A/B sincronizado: ▶ Play ]       | Notas:  C5 (redonda)                            |
|                                                 | Letra:  cia                                     |
+-------------------------------------------------+-------------------------------------------------+
| [ Descartar Borrador ]                       [ Corregir Regiones (1) ]    [ Aprobar y Continuar ] |
+---------------------------------------------------------------------------------------------------+
```

---

### 3.6. Stage 6: Fulfillment & Export (`ConversionFulfillmentModal.tsx`)

Upon approval, the musician is offered seamless multi-destination fulfillment:

```
+---------------------------------------------------------------------------------------------------+
| ¡CONVERSIÓN COMPLETADA CON ÉXITO!                                                                 |
| "Gracia Sublime Es" ha sido verificada y convertida a MusicXML y Secuencia MIDI                   |
+---------------------------------------------------------------------------------------------------+
| ¿QUÉ DESEA HACER CON EL RESULTADO?                                                                |
|                                                                                                   |
|   [ 📥 Descargar Archivos ]                                                                       |
|   - Descargar MusicXML 4.0 (.musicxml)                                                            |
|   - Descargar Archivo MIDI (.mid)                                                                 |
|   - Descargar Partitura PDF Grabada (.pdf)                                                        |
|   - Descargar Cifrado ChordPro (.chordpro)                                                        |
|                                                                                                   |
|   [ 📖 Abrir en Atril Digital ]                                                                   |
|   Carga inmediata en la pantalla de atril activo para ensayo o servicio dominical                 |
|                                                                                                   |
|   [ 💾 Guardar en Catálogo de Canciones ]                                                         |
|   Almacena en PostgreSQL con versionado inmutable, historial de auditoría y etiquetas pastorales |
+---------------------------------------------------------------------------------------------------+
```

---

## 4. Accessibility, Responsiveness & Stage Mode

### 4.1. Stage & Tablet Usability (Digital Music Stand)
- **High-Contrast Dark Theme (`worship-dark`):** Dark slate background (`#0f172a`) with high-contrast text (`#f8fafc`) to minimize glare in low-light sanctuary environments.
- **Touch-First Hit Targets:** All buttons, dropdowns, and chord-edit tags maintain a minimum touch target size of **48x48 px** for tablet stylus or finger interaction on iPads and Surface tablets.
- **Side-by-Side Stack Fallback:** On mobile screens (<768px), the side-by-side view collapses to an interactive toggle tab (`[ Ver Original ] | [ Ver Conversión ]`).

### 4.2. Keyboard Shortcuts & Accelerators
| Shortcut | Action |
| :--- | :--- |
| `Ctrl + U` / `Cmd + U` | Open file selector dialog |
| `Space` | Play / Pause synchronized audio preview |
| `Ctrl + Enter` / `Cmd + Enter` | Approve proposal and open fulfillment dialog |
| `Tab` / `Shift + Tab` | Navigate across editable measure cards |
| `Escape` | Close review modal or cancel operation |

### 4.3. WCAG 2.1 AA Compliance
- Full keyboard focus rings (`outline: 2px solid #38bdf8; outline-offset: 2px`).
- ARIA live regions (`aria-live="polite"`) for asynchronous progress announcements to screen readers.
- All status badges include dual indicators (color + distinct iconography + text label).

