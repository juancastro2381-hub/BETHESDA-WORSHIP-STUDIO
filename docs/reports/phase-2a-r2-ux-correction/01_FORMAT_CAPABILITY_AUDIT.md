# BETHESDA WORSHIP STUDIO — PHASE 2A-R2 UX CORRECTION
## REPORT 01: AUDITORÍA TÉCNICA EXHAUSTIVA DE CAPACIDADES DE FORMATO

**Proyecto:** Bethesda Worship Studio  
**Rama:** `feature/phase-1a-core-foundation`  
**Fase:** Phase 2A-R2 UX Correction — Conversion Capability Accuracy  
**Agente:** Antigravity — Principal Software Engineer & Systems Architect  
**Estado:** PENDING INDEPENDENT REVIEW  

---

### 1. OBJETIVO DE LA AUDITORÍA

Realizar una auditoría técnica basada en evidencia del código fuente para clasificar fidedignamente las capacidades reales del sistema frente a los 8 formatos musicales y documentales, distinguiendo entre lo que el sistema realmente implementa y ejecuta frente a lo planificado para la Fase 2B o bloqueado por el Principio de CERO Fabricación.

---

### 2. MATRIZ DE CICLO DE VIDA POR FORMATO (7 ETAPAS)

Cada formato fue evaluado a lo largo de las 7 etapas críticas del ciclo de vida musical en Bethesda Worship Studio:
1. **Carga (Upload):** Capacidad del sistema para recibir el archivo binario o de texto.
2. **Validación:** Detección fidedigna mediante Magic Bytes (MThd, %PDF, RIFF, PNG, JPEG, OggS, ID3) y esquemas.
3. **Extracción:** Separación de metadatos, pistas, capas de texto y secuencias binarias.
4. **Parseo / Normalización:** Procesamiento de sintaxis y notación musical hacia estructuras de datos.
5. **Payload Canónico:** Representación completa sin pérdida en `CanonicalMusicPayload`.
6. **Renderizado (Atril Digital):** Visualización interactiva o reproducción sonora en el atril de adoración.
7. **Conversión Viable:** Transpilación autoritativa hacia otros formatos musicales estándar.

| # | Formato Musical / Documental | 1. Carga | 2. Validación | 3. Extracción | 4. Parseo | 5. Payload Canónico | 6. Renderizado (Atril) | 7. Conversión Viable | Estado de Capacidad Canónico |
|---|---|---|---|---|---|---|---|---|---|
| **1** | **MusicXML 4.0** (`.musicxml`, `.xml`, `.mxl`) | ✅ Soportado | ✅ Soportado (XML Schema & Headers) | ✅ Soportado (Parts, Measures, Voices) | ✅ Soportado (`MusicXmlImporter`) | ✅ Soportado (`CanonicalMusicPayload`) | ✅ Soportado (Partitura interactiva) | ✅ A MusicXML, MIDI, ChordPro, TXT Letra | `SUPPORTED` |
| **2** | **MIDI Estándar** (`.mid`, `.midi`) | ✅ Soportado | ✅ Soportado (Magic Bytes `MThd` SMF 1) | ✅ Soportado (Tracks, Ticks, Velocity) | ✅ Soportado (`MidiParser` / `MidiIngestionAdapter`) | ✅ Soportado (`CanonicalMusicPayload`) | ✅ Soportado (Piano Roll / Partitura) | ✅ A MIDI, MusicXML, ChordPro, TXT Letra | `SUPPORTED` |
| **3** | **ChordPro / Cifrado** (`.cho`, `.crd`, `.pro`) | ✅ Soportado | ✅ Soportado (Directivas y regex `[Acorde]`) | ✅ Soportado (Secciones, Acordes, Letra) | ✅ Soportado (`ChordProImporter`) | ✅ Soportado (`CanonicalMusicPayload`, 0 notas) | ✅ Soportado (Cifrado interactivo Atril) | ✅ A ChordPro, TXT Letra, MusicXML lead sheet. 🚫 MIDI bloqueado (Cero Fabricación) | `SUPPORTED` |
| **4** | **Solo Letra / TXT** (`.txt`) | ✅ Soportado | ✅ Soportado (UTF-8 / Plain text) | ✅ Soportado (Estrofas, Coros, Versos) | ⚠️ Parcial (Parseo de lírica sin notas ni cifrado) | ⚠️ Parcial (Syllables/Lyrics únicamente) | ✅ Soportado (Visor de letra Atril) | ✅ A TXT Letra, ChordPro borrador, MusicXML lead sheet. 🚫 MIDI bloqueado | `PARTIALLY_SUPPORTED` |
| **5** | **Partitura en PDF** (`.pdf`) | ✅ Soportado | ✅ Soportado (Magic Bytes `%PDF`) | ⚠️ Parcial (Preservación duradera SHA-256) | ❌ OMR No implementado en 2A | ❌ Sin Payload de notas (Documento visual) | ✅ Soportado (Visor de documento PDF) | ⏱️ Transcripción a notas diferida (Audiveris / OMR) | `PARTIALLY_SUPPORTED` |
| **6** | **Partitura en Imagen** (`.png`, `.jpg`, `.webp`, `.tiff`) | ✅ Soportado | ✅ Soportado (Magic Bytes PNG, JPG, TIFF) | ⚠️ Parcial (Almacenamiento inmutable) | ❌ OMR No implementado en 2A | ❌ Sin Payload de notas (Asset gráfico) | ✅ Soportado (Visor de imagen Atril) | ⏱️ OMR planificado para Fase 2B | `PARTIALLY_SUPPORTED` |
| **7** | **Tablatura ASCII** (`.tab`) | ❌ No Ingestable | ⚠️ Solo verificación de extensión | ❌ Sin extractor de tablatura | ❌ Sin parser ASCII de tablatura | ❌ Sin payload de tablatura ASCII | ⚠️ Cálculo en Atril mediante `TablatureCalculator` desde notas | ⏱️ Ingesta y exportación de tablatura planificadas para Fase 2B | `NOT_SUPPORTED` |
| **8** | **Grabación de Audio** (`.mp3`, `.wav`, `.m4a`, `.flac`) | ✅ Soportado | ✅ Soportado (Magic Bytes ID3, RIFF, OggS) | ✅ Soportado (Almacenamiento físico SHA-256) | ❌ Transcripción de audio no implementada | ❌ Sin Payload de notas (Asset de audio) | ✅ Soportado (Reproductor de audio en Atril) | ⏱️ Transcripción polifónica diferida para Fase 2B (Basic Pitch / Demucs) | `PARTIALLY_SUPPORTED` |

---

### 3. CLASIFICACIÓN RIGUROSA DE CAPACIDADES Y REGLAS ARQUITECTÓNICAS

#### 3.1 `SUPPORTED` (Soportado Plenamente)
- **Formatos:** MusicXML (`STRUCTURED_MUSICXML`), MIDI (`STRUCTURED_MIDI`), ChordPro (`STRUCTURED_CHORDPRO`), Notas Escritas (`WRITTEN_NOTES`).
- **Comportamiento:** La fuente es digerida íntegramente hacia el modelo canónico unificado (`CanonicalMusicPayload`). Permite transpilación directa y ejecución de trabajos en segundo plano a los formatos objetivo compatibles.

#### 3.2 `PARTIALLY_SUPPORTED` (Soportado Parcialmente)
- **Formatos:** Solo Letra (`TXT_LYRICS`), Documento PDF (`PDF_SCORE`), Partitura en Imagen (`IMAGE_SCORE`), Grabación de Audio (`AUDIO_RECORDING`).
- **Comportamiento:**
  - El archivo se preserva de forma inmutable en el repositorio de fuentes con hash criptográfico SHA-256.
  - Se visualiza o reproduce en el Atril Digital (PDF, imagen, audio, letra).
  - **Restricción:** No posee conversión automática a partitura editable en Fase 2A. La interfaz y el backend impiden la creación de solicitudes de conversión destinadas al fracaso.

#### 3.3 `NOT_SUPPORTED` (No Soportado)
- **Formatos:** Tablatura ASCII cruda (`TABLATURE_ASCII`) y conversiones incompatibles por ausencia de información fuente (ej. ChordPro sin melodía hacia MIDI).
- **Comportamiento:** El sistema rechaza explícitamente la conversión informando al usuario la causa exacta.

#### 3.4 `PLANNED_PHASE_2B` (Planificado para Fase 2B)
- **Capacidades Diferidas:**
  - **OMR (Reconocimiento Óptico de Partituras):** Conversión de PDF e imágenes a MusicXML mediante Audiveris / oemer local.
  - **Audio Transcription:** Transcripción polifónica de audio (MP3/WAV) a partitura mediante modelos locales (Basic Pitch / Demucs / Whisper.cpp) sin servicios comerciales en la nube.
  - **Engraved PDF:** Grabado de partituras de alta calidad con Bravura server-side mediante Chromium headless.
  - **Tablatura:** Parser y exportador de tablatura ASCII de 6 y 4 cuerdas.

---

### 4. CONCLUSIÓN DE AUDITORÍA
La aplicación posee una base arquitectónica sólida de ingesta y preservación de fuentes. Las modificaciones de la presente fase corrigen la exposición superficial en la UI, garantizando que el usuario comprenda con exactitud qué formatos son convertibles de inmediato y cuáles están preservados para visualización mientras sus motores de digitalización maduran en la Fase 2B.

