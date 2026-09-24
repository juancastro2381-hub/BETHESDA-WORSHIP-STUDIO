# BETHESDA WORSHIP STUDIO
## Documento 04: Ingesta Multicanal, Asistencia con IA y Evaluación de Motores de Renderizado

---

## 1. Arquitectura de Ingesta de Canciones (+ Nueva Canción)

Uno de los principales cuellos de botella en las iglesias es la digitalización de su cancionero. Bethesda Worship Studio ofrece una pantalla de bienvenida amigable con 7 vías de entrada claras:

```
┌────────────────────────────────────────────────────────────────────────┐
│                        + NUEVA CANCIÓN                                 │
│                                                                        │
│  [ 🎼 Tengo una partitura ]           [ 📄 Tengo letra y acordes ]    │
│    (MusicXML, MuseScore, PDF)           (Texto plano o formato cifrado)│
│                                                                        │
│  [ 🎹 Tengo un archivo MIDI ]         [ 📝 Tengo solamente la letra ]  │
│    (Pistas de teclado, secuencias)      (Texto para estructurar versos)│
│                                                                        │
│  [ 🎙️ Tengo un audio / grabación ]    [ ✏️ Quiero crearla desde cero ] │
│    (MP3, M4A, nota de voz ensayo)       (Lienzo en blanco para autores)│
│                                                                        │
│  [ 📷 Tomar foto a una partitura impresa ]                             │
│    (Cámara de tablet o móvil)                                          │
└────────────────────────────────────────────────────────────────────────┘
```

### Distinción Categórica Esencial:
El sistema distingue inequívocamente tres tipos de procesamiento:

```
                    ┌───────────────────────────────┐
                    │           CANAL               │
                    └──────────────┬────────────────┘
                                   │
         ┌─────────────────────────┼─────────────────────────┐
         ▼                         ▼                         ▼
   1. IMPORTACIÓN            2. TRANSCRIPCIÓN           3. CREACIÓN
    DETERMINISTA                 ASISTIDA                MANUAL
   (MusicXML, MIDI,         (Audio a Cifrado,          (Editor Nivel 1/2,
     ChordPro)               OMR/Fotos, IA)             Lienzo en Blanco)
   Fidelidad: 100%          Estado inicial: "BORRADOR"  Control Total Humano
   Aprobación Directa       Requiere Revisión Humana   Publicación Directa
```

---

## 2. Las 7 Vías de Entrada Detalladas

### Vía A: Partitura Estructurada (MusicXML / MXL / MuseScore)
- **Proceso:** Parseo determinista de árboles XML mediante parser seguro contra ataques XXE.
- **Resultado:** Importación exacta e inmediata de compases, polifonía, claves, armaduras y ligaduras. Cero ambigüedad.

### Vía B: Archivo MIDI (.mid / .kar)
- **Proceso:** Decodificación de pistas, canales, eventos `NoteOn`/`NoteOff`, tempo map y marcadores de texto.
- **Cuantización Inteligente:** El motor aplica cuantización adaptativa (triplete, corchea, semicorchea) para evitar notación caótica producida por ejecuciones sin cuantizar.

### Vía C: Documento PDF de Partitura
- **Proceso:** Pipeline híbrido:
  1. Extracción de metadatos y texto incrustado.
  2. Detección de capas vectoriales de fuentes musicales.
  3. Si es un PDF escaneado (raster): Se envía al canal de Reconocimiento Óptico Musical (OMR).

### Vía D: Foto / Imagen de Partitura Impresa (Mobile OMR)
- **Proceso:** Preprocesamiento en cliente (detección de bordes, corrección de perspectiva, binarización de contraste) seguido de procesamiento OMR (*Optical Music Recognition*).
- **Tratamiento:** Se etiqueta como **"Borrador OMR"** con mapas de confianza visual.

### Vía E: Audio / Grabación (MP3, WAV, M4A)
- **Proceso:** 
  1. Detección de BPM y compás mediante autocorrelación rítmica y detección de onsets (*OnsetsDS / Librosa*).
  2. Estimación de tonalidad cromática (*Chromagram Analysis*).
  3. Detección de acordes tentativa mediante modelos de redes neuronales de seguimiento armónico.
- **Tratamiento:** El usuario recibe una propuesta de estructura con BPM sugerido y acordes tentativos que puede escuchar y corregir con un reproductor de audio sincronizado en pantalla.

### Vía F: Letra y Acordes (Texto plano o ChordPro)
- **Proceso:** Detección de formato:
  - Si es **ChordPro** (`[G]Sublime [C]gracia [G]del Señor`): Parseo inmediato.
  - Si es texto de dos líneas (línea de acordes sobre línea de letra): Algoritmo de alineación espacial según coordenadas de columnas de texto.

### Vía G: Solamente la Letra
- **Proceso:** Detección automática de estrofas por dobles saltos de línea; sugerencia de secciones (*Verso 1, Verso 2, Coro*); el músico puede posteriormente añadir los acordes pulsando sobre cada sílaba.

---

## 3. Principio Rector de Inteligencia Artificial: "Asistente, No Autoridad"

Bethesda Worship Studio rechaza la falacia de que la IA musical sustituye el discernimiento del músico de adoración:

```
┌────────────────────────────────────────────────────────────────────────┐
│                        PRINCIPIO ÉTICO Y TÉCNICO DE IA                 │
│                                                                        │
│   "La Inteligencia Artificial es un asistente para acelerar tareas     │
│   tediosas, NUNCA la autoridad final sobre la música del altar."       │
└────────────────────────────────────────────────────────────────────────┘
```

### Protocolo de Calificación y Aprobación:
1. **Bandera de Estado:** Toda entidad creada o modificada por modelos automáticos nace con `is_ai_draft = true` y `review_status = "PENDING_REVIEW"`.
2. **Niveles de Confianza Visual:**
   - Acorde con confianza > 90%: Se muestra con estilo tipográfico normal.
   - Acorde con confianza entre 60% y 90%: Se muestra con un indicador sutil (ej. subrayado punteado).
   - Acorde con confianza < 60%: Se marca en amarillo tenue indicando: *"Verificar acorde con el instrumento"*.
3. **Compuerta de Aprobación Humana:** Ninguna canción con estado "Borrador sin revisar" se despliega por defecto en los atriles del servicio dominical sin que el Director Musical o un arreglista pulse **"Aprobar Canción para Culto"**.

---

## 4. Evaluación Comparativa de Tecnologías de Renderizado de Notación

Para seleccionar el motor de partituras digitales en navegadores y dispositivos móviles sin reinventar la rueda innecesariamente, se realizó una evaluación exhaustiva entre las 4 alternativas líderes de código abierto:

| Criterio de Evaluación | **OpenSheetMusicDisplay (OSMD)** | **Verovio** | **VexFlow (Core)** | **alphaTab** |
|:---|:---:|:---:|:---:|:---:|
| **Base Tecnológica** | TypeScript / VexFlow wrapper | C++ compilado a WebAssembly (Wasm) | TypeScript / HTML5 Canvas & SVG | C# transpilado a TypeScript/JS |
| **Licencia de Software** | MIT (Comercial / Permisiva) | LGPL-3.0 (Restrictiva en wrappers) | MIT (Comercial / Permisiva) | MPL-2.0 (Permisiva de archivo) |
| **Entrada Nativa** | MusicXML / MXL | MEI, MusicXML, Humdrum, PAE | API Programática JSON/Objetos | AlphaTex, MusicXML, GuitarPro (GPX) |
| **Soporte Tablatura** | Muy limitado / Experimental | Básico | Excelente (API nativa de tablaturas) | **Excepcional (Líder en Tablatura)** |
| **Notación de Batería** | Limitada | Moderada | Completa (requiere mapeo manual) | **Nativa completa con audio MIDI** |
| **Rendimiento en Móviles** | Moderado (alto consumo memoria) | Muy rápido (Wasm) | **Extremadamente rápido y ligero** | **Extremadamente rápido (Web Workers)** |
| **Sintetizador Audio Integrado** | Requiere librería externa | Básico MIDI | No (solo visual) | **Sí (SoundFont / Web Audio nativo)** |
| **Edición Interactiva** | Solo visualizador (Read-only) | Difícil de hacer interactivo | **Excelente para edición por clics** | Moderada (orientado a reproducción) |
| **Capacidades Responsive** | Zoom básico | Re-renderizado continuo | Manual / Controlable vía CSS | **Auto-wrap responsivo nativo** |

---

## 5. Recomendación Arquitectónica y Decisión de Motor

### Decisión Arquitectónica Adoptada: **Estrategia Híbrida Especializada**

Ningún motor único resuelve de forma perfecta la totalidad del espectro que exige Bethesda Worship Studio (desde la partitura polifónica coral de conservatorio hasta la tablatura de bajo de 5 cuerdas con diagramas de acordes y cifrado móvil). 

Se adopta una **Arquitectura de Doble Motor con Capa de Abstracción Unificada (`MusicRendererAdapter`)**:

```
                              ┌─────────────────────────────┐
                              │    CANONICAL MUSIC MODEL    │
                              │        (JSON Canónico)      │
                              └──────────────┬──────────────┘
                                             │
                       ┌─────────────────────┴─────────────────────┐
                       ▼                                           ▼
         [ VISTA: PARTITURA Y CORAL ]                [ VISTA: GUITARRA / BAJO / BATERÍA ]
             OSMD / Verovio Worker                           alphaTab Engine
        • Notación tradicional pura                 • Tablatura + Pentagrama unificado
        • Claves Sol / Fa / Do                      • Notación de percusión batería
        • Texto lírico en pentagrama                • Reproducción de SoundFonts de audio
        • Exportación exacta MusicXML               • Sincronización de cursor en tiempo real
```

### Justificación Técnica de la Decisión:
1. **alphaTab:** Es el estándar indiscutible para guitarra, bajo, batería y lead sheets modernas en la web, con soporte integrado de tablaturas de múltiples afinaciones, acordes visuales, metrónomo de baja latencia y cursor interactivo con aceleración por Web Workers.
2. **OSMD (OpenSheetMusicDisplay):** Permite renderizar partituras orquestales y corales completas directamente desde MusicXML sin conversiones intermedias, con licencia permisiva MIT que garantiza total libertad de distribución para la iglesia y futuros inquilinos.
3. **Capa `MusicRendererAdapter`:** El frontend de React interactúa exclusivamente con una interfaz unificada:
   ```typescript
   interface IMusicRenderer {
     render(songPart: CanonicalPart, container: HTMLElement, options: RenderOptions): void;
     highlightMeasure(measureNumber: number): void;
     transpose(semitones: number): void;
     destroy(): void;
   }
   ```
   Esto inmuniza a Bethesda Worship Studio frente a cambios o actualizaciones de librerías externas en el futuro.
