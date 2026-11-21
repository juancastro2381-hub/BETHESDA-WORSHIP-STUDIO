# MUSICAL CONTENT COMPLETENESS — ROOT CAUSE AND REMEDIATION REPORT
## Bethesda Worship Studio

**Rama:** `feature/phase-1a-core-foundation`  
**Commit base previo:** `1338cdf6b736d7ae5ee1d82c40de17105e066afc`  
**Fecha:** 2026-11-17  

---

## 1. Hallazgos de Investigación Pre-Flight (Causas Raíz Confirmadas)

### A. Letra incompleta y texto ajeno en *Tu Luz Me Guía* (`songId = 8e0261fd-6168-4414-b85a-1a82cf0641b7`)
1. **Metadatos tratados como letra:** `MusicalContentCompletionService.applyLyricsCompletion()` procesaba todas las líneas no vacías del archivo `Tu_Luz_Me_Guiara_Letra.txt` —incluyendo `"TU LUZ ME GUIARÁ"`, `"Canción original de prueba"`, `"Tonalidad: Sol mayor (G) | Compás: 4/4 | Tempo: 96 BPM"`— asignándolas secuencialmente como `LyricSyllable` en los compases `1`, `2` y `3`.
2. **Alineación ignorando secciones existentes:** Aunque la canción derivada de audio tenía `160` compases con secciones reales (`Intro`, `Verso 1`, `Coro`, `Final`), la importación ubicaba los versos desde el compás `1`, dejando `149` compases vacíos.
3. **Falso estado completo (`APPROVED` / `COMPLETE_AND_APPROVED`):** `StandFormatCapabilityResolver` solo verificaba `lyricSyllableCount > 0`, marcando como completo un guion cuya cobertura real era `11/160` compases (`6.8%`).
4. **Fuga de acordes en `LYRICS_ONLY`:** `LeadSheetDomAdapter` agregaba símbolos de acordes (`tokens.push({ chord: ch.symbol })`) incluso cuando `'CHORDS'` no estaba en `view.activeRepresentations`.

### B. MusicXML e Ingesta Canónica (`musicxml-importer.ts`, `musicxml-generator.ts`)
1. `<direction><direction-type><words>` convertía cualquier texto (p. ej. `"Moderato"`, dinámicas o anotaciones) en `Section` markers.
2. `<metronome><per-minute>` no era extraído como evento de tempo (solo `<sound tempo="...">`).
3. Solo se leía el primer `<lyric>` sin filtrar por verso principal (`number="1"`).
4. `parseHarmonyElement()` solo cubría 6 cualidades básicas, omitiendo `major`, `sus2`, `6`, `m6`, `dim`, `dim7`, `aug`, `5`, `9`, `m9`, `maj9`.
5. `MusicXmlGenerator` solo emitía `<attributes>` en el primer compás, perdiendo cambios intermedios de métrica o armadura.

### C. Tablatura (`tablature-calculator.ts`, `projection-service.ts`, `alphatab-adapter.ts`, `alphatex-generator.ts`)
1. `TablatureCalculator.selectBestCandidate()` priorizaba incondicionalmente `fret === 0`, produciendo ceros excesivos incluso en pasajes de zona media/alta del mástil, y permitía trastes hasta `24` sin distinguir el límite físico por instrumento ni evitar colisiones de cuerda en notas simultáneas.
2. `AlphaTexGenerator` y `AlphaTabAdapter` sustituían silenciosamente `tabCoord === undefined` (notas fuera de rango) por `string: 1, fret: 0` (`0.1`).

### D. Inconsistencia de Tempo y Metadatos (`143 BPM` vs `120 BPM` vs `96 BPM`)
- `143 BPM`: tempo real derivado del análisis de audio en `Tu Luz Me Guía.mp3` (`songs.default_bpm = 143`, `timeline.tempoMap`).
- `96 BPM`: texto del encabezado del archivo `.txt` importado erróneamente como sílabas del compás 3.
- `120 BPM`: valor fijo codificado (`\tempo 120`) en `AlphaTexGenerator.generate()` y fallback en `DatabaseSongsModal.tsx`.

---

## 2. Acciones Correctivas Implementadas

| Área | Archivo | Corrección aplicada |
| :--- | :--- | :--- |
| Proyección única de metadatos | [`canonical-metadata-projection.ts`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/frontend/src/core/workspace/canonical-metadata-projection.ts) | Nuevo extractor autoritativo `extractAuthoritativeSongMetadata()` compartido para título, tono, tempo con origen (`SOURCE_DECLARED`, `AUDIO_DERIVED`, `MANUAL_OVERRIDE`, `UNRESOLVED`), métrica, cobertura lírica y conteos. |
| Completitud de letra | [`musical-content-completion-service.ts`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/backend/src/application/musical-content-completion-service.ts) | Filtrado de líneas de encabezado/metadatos (`isNonLyricHeaderOrMetadataLine`), preservación en `metadata.lyricsHeaderMetadata` y alineación consciente de secciones existentes. |
| Evaluador de disponibilidad | [`stand-format-capabilities.ts`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/frontend/src/core/workspace/stand-format-capabilities.ts), [`reading-format-selector-component.ts`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/frontend/src/components/workspace/reading-format-selector-component.ts), [`index.css`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/frontend/src/index.css) | Nuevo estado `PARTIAL` (ámbar, nunca verde) cuando la cobertura lírica es parcial (`< 25%` en obras `>= 16` compases), y distinción explícita de `AVAILABLE`, `PARTIAL`, `MISSING_CONTENT`, `REVIEW_REQUIRED`, `BLOCKED`. |
| Ingesta MusicXML | [`musicxml-importer.ts`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/frontend/src/core/ingestion/musicxml/musicxml-importer.ts) | Soporte de `<metronome><per-minute>`, filtro estricto de etiquetas de sección en `<words>`, selección de `<lyric number="1">`, y cualidades armónicas ampliadas. |
| Renderizado Atril | [`leadsheet-dom-adapter.ts`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/frontend/src/core/rendering/adapters/leadsheet-dom-adapter.ts), [`musicxml-generator.ts`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/frontend/src/core/rendering/utils/musicxml-generator.ts) | `LYRICS_ONLY` omite acordes y reconstruye palabras continuas desde sílabas (`begin`/`middle`/`end`/`single`); `MusicXmlGenerator` emite cambios intermedios de armadura/métrica y tempo resuelto. |
| Tablatura y AlphaTex | [`types.ts`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/frontend/src/core/projection/types.ts), [`instrument-profile.ts`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/frontend/src/core/projection/instrument-profile.ts), [`tablature-calculator.ts`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/frontend/src/core/projection/tablature-calculator.ts), [`projection-service.ts`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/frontend/src/core/projection/projection-service.ts), [`alphatab-adapter.ts`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical - partituras/BETHESDA%20WORSHIP STUDIO/frontend/src/core/rendering/adapters/alphatab-adapter.ts), [`alphatex-generator.ts`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/frontend/src/core/rendering/utils/alphatex-generator.ts) | Límites reales de trastes (`maxFret: 20/22`), continuidad de posición en mástil (`prevFret > 7`), prevención de colisión simultánea de cuerdas, enlace por `noteId`, eliminación de `\tempo 120` fijo y cero invención `0.1`. |
| Metadatos en UI | [`SongHeader.tsx`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/frontend/src/components/workspace/SongHeader.tsx), [`DatabaseSongsModal.tsx`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/frontend/src/components/workspace/DatabaseSongsModal.tsx) | Lectura unificada desde `extractAuthoritativeSongMetadata` con indicador `(Audio)` / `(Manual)` en tempo. |
| Retiro de Reproducción | [`MusicalWorkspace.tsx`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/frontend/src/components/workspace/MusicalWorkspace.tsx), [`AudioPlayerBar.tsx`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/frontend/src/components/workspace/AudioPlayerBar.tsx), [`ConversionCenterWorkspace.tsx`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/frontend/src/components/conversion/ConversionCenterWorkspace.tsx), [`OfflineInventoryModal.tsx`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/frontend/src/components/offline/OfflineInventoryModal.tsx), [`api-client.ts`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/frontend/src/core/api/api-client.ts) | Retiro completo de reproductores `<audio>`, botones de play/pause, barras de tiempo y enlaces de streaming en la UI manteniendo intacta la ingesta y análisis privado Audio Scope 1C. |

---

## 3. Preservación de Datos Canónicos Existentes

- **Cero migraciones destructivas** en PostgreSQL.
- Verificado mediante consulta directa tras las pruebas: *El Señor Esta en Este Lugar* (`d8f1d90f-0ec4-4053-b29f-1e73ccddb618`, `v1` y `v2`, MP3 `098bf5d6-67d2-4442-91b6-b7e36b1c8d11`, propuesta `a99f9a24-65f9-46d9-bb46-eb2f5b85e622`) permanece intacto.
- Los registros existentes de *Tu Luz Me Guía* (`8e0261fd-6168-4414-b85a-1a82cf0641b7`) no fueron borrados; la nueva evaluación de disponibilidad ahora expone honestamente la cobertura parcial (`PARTIAL`) en lugar de marcarlo como completo.
