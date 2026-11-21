# BETHESDA WORSHIP STUDIO — PHASE 1B
## MATRIZ DE COMPATIBILIDAD DE FORMATOS MUSICALES
**Documento:** `WS_PHASE_1B_FORMAT_COMPATIBILITY_MATRIX.md`  
**Ruta:** `docs/reports/phase-1b/WS_PHASE_1B_FORMAT_COMPATIBILITY_MATRIX.md`  
**Fase:** Phase 1B — Universal Music Ingestion, Canonical Music Pipeline & Multi-Format Conversion  
**Fecha de Emisión:** 2026-11-05  
**Estado:** REVISADO Y VERIFICADO TÉCNICAMENTE

---

### 1. OBJETIVO DE LA MATRIZ

Este documento establece la especificación técnica formal y contractual de compatibilidad para cada uno de los formatos de origen musical admitidos en Bethesda Worship Studio. Define las capacidades de extracción, normalización canónica, preservación del archivo original y la disponibilidad resultante en los diferentes modos de visualización del Atril Digital (*Digital Music Stand*).

---

### 2. MATRIZ MAESTRA DE FORMATOS DE ENTRADA

| Categoría | Formatos / Extensiones | Adaptador | Firma / Detección | Estado de Ingesta (Fase 1B) | Extracción de Notas | Extracción de Acordes | Extracción de Letras | Pistas / Instrumentos |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **MusicXML 4.0** | `.musicxml`, `.xml` | `MusicXmlIngestionAdapter` | XML raíz `<score-partwise>` o `<score-timewise>` | **PARSED & CONVERTED** | Completa (alturas, alteraciones, duraciones) | Sí (armonías declaradas `<harmony>`) | Sí (sílabas líricas con extensión) | Múltiples pentagramas / partes |
| **MIDI Standard** | `.mid`, `.midi` (SMF 0 y 1) | `MidiIngestionAdapter` | Bloque cabecera `MThd` (`0x4D 0x54 0x68 0x64`) | **PARSED & CONVERTED** | Completa (NoteOn/NoteOff mapeadas a 480 TPQN) | N/A (cero invención) | N/A (cero invención) | Separadas por track (SMF 1) o canal |
| **ChordPro** | `.chordpro`, `.pro`, `.cho`, `.crd` | `ChordProIngestionAdapter` | Texto con directivas `{title:...}` o `[Acorde]` | **PARSED & CONVERTED** | N/A (Invariante LeadSheet: 0 notas) | Sí (cifrados parseados formalmente) | Sí (texto con alineación silábica) | Voz / LeadSheet unificado |
| **Notas Escritas** | JSON estructurado | `WrittenNotesIngestionAdapter` | Esquema Zod `writtenNotesPayloadSchema` | **PARSED & CONVERTED** | Completa (step `^[A-G]$`, octava 0-9) | Sí (parseo armónico formal) | Sí (`LyricSyllable` con `tickOffset`) | Pista 'VOCALS' / Melodía |
| **Partituras Visuales** | PDF, PNG, JPEG, TIFF | `VisualScoreIngestionAdapter` | Firmas binarias `%PDF-`, PNG, JFIF, TIFF | **PRESERVED (HONEST STUB)** | Requiere motor OMR (Fase 1C/3C) | Requiere motor OMR (Fase 1C/3C) | Texto preliminar embebido PDF | Pista visual única |
| **Audio** | MP3, WAV, FLAC, M4A | `AudioIngestionAdapter` | Cabeceras binarias `ID3`, `RIFF...WAVE`, `fLaC`, `ftypM4A` | **PRESERVED (HONEST STUB)** | Requiere transcripción AI (Fase 4A) | Requiere transcripción AI (Fase 4A) | N/A (Audio original) | Pista estéreo/mono |
| **Video Remoto** | YouTube, Vimeo | `VideoUrlIngestionAdapter` | Whitelist de dominio + Sanitización SSRF | **REGISTERED** | N/A | N/A | N/A | Referencia audiovisual para streaming |

---

### 3. CONTRATO DE DISPONIBILIDAD EN EL ATRIL DIGITAL

El Atril Digital (*Digital Music Stand*) de Bethesda Worship Studio proyecta la representación musical en cuatro (4) vistas especializadas. Cada vista requiere datos musicales canónicos específicos para estar disponible de forma interactiva:

| Formato de Origen | Vista 1: Partitura Completa (*Sheet Music*) | Vista 2: Tablatura de Guitarra / Bajo (*Tablature*) | Vista 3: Cifrado con Letra (*Chord Chart*) | Vista 4: Solo Letra (*Lyrics Only*) |
| :--- | :--- | :--- | :--- | :--- |
| **MusicXML** | **DISPONIBLE** (Pentagrama OSMD / AlphaTab interactivo) | **DISPONIBLE CONDICIONAL** (Solo si contiene instrumento de cuerda pulsada con afinación o digitación) | **DISPONIBLE** (Derivada automáticamente si contiene acordes o notas analizables) | **DISPONIBLE** (Si contiene capas de texto lírico) |
| **MIDI** | **DISPONIBLE** (Pentagrama melódico y rítmico derivado a 480 TPQN) | **DISPONIBLE CONDICIONAL** (Derivable mediante asignación de trastes si se selecciona instrumento con trastes) | No Disponible (CERO notas/acordes inventados) | No Disponible (CERO texto inventado) |
| **ChordPro** | No Disponible (Evita generar pentagramas vacíos o notas Do falsas) | No Disponible | **DISPONIBLE** (Modo LeadSheet nativo con transposición armónica en tiempo real) | **DISPONIBLE** (Extrayendo solo el texto lírico limpio) |
| **Notas Escritas** | **DISPONIBLE** (Pentagrama con melodía, compases y figuras) | **DISPONIBLE CONDICIONAL** (Si se proyecta sobre instrumento de trastes) | **DISPONIBLE** (Si el usuario suministró cifrados por compás) | **DISPONIBLE** (Si el usuario suministró sílabas líricas) |
| **Partitura Visual (PDF/Img)** | **DISPONIBLE VISUAL** (Renderizado directo del PDF o imagen de alta resolución en atril) | No Disponible hasta resolución OMR | No Disponible hasta resolución OMR | No Disponible hasta resolución OMR |
| **Audio / Video** | No Disponible (Panel de reproducción / sincronización de audio) | No Disponible | No Disponible | No Disponible |

---

### 4. REGLAS NO-NEGOCIABLES DE INTEGRIDAD MUSICAL

1. **CERO Invención de Notas (*Zero Note Guessing*):**  
   Bajo ninguna circunstancia un archivo de solo acordes (ChordPro) o de audio sin transcribir generará notas melódicas por defecto (ej. rellenar silencios con Do Mayor o notas centrales). La propiedad `totalNotes` es estrictamente 0 en fuentes de tipo acordes/letras.
2. **CERO Invención Armónica o Lírica en MIDI:**  
   Los archivos MIDI importados conservan fielmente sus eventos `NoteOn`, `SetTempo`, `TimeSignature` y `KeySignature`. No se sintetizan acordes ni textos si estos no están formalmente codificados como meta-eventos MIDI autorizados.
3. **Preservación Incondicional del Origen Binario:**  
   Todo archivo subido (PDF, imagen, MIDI, audio, XML) es almacenado de forma inmutable con su digest SHA-256 en `backend/storage/sources/` antes de cualquier transformación, garantizando la trazabilidad forense y la posibilidad de reprocesamiento futuro cuando nuevos motores de transcripción estén disponibles.
4. **Normalización Temporal Determinista:**  
   Toda fuente con resolución temporal (MIDI, MusicXML, Notas Escritas) es mapeada matemáticamente a la cuadrícula canónica de 480 TPQN de Bethesda Worship Studio sin pérdida de alineación rítmica ni desfases acumulativos.

