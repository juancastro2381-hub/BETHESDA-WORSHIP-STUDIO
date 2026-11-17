# MUSICXML, LYRICS AND TABLATURE VALIDATION REPORT
## Bethesda Worship Studio

**Rama:** `feature/phase-1a-core-foundation`  
**Fecha:** 2026-11-17

---

## 1. Validación de MusicXML y Reconstrucción Lírica

### Reglas Verificadas
1. **Reconstrucción silábica (`single`, `begin`, `middle`, `end`):**
   - [`musicxml-importer.ts`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/frontend/src/core/ingestion/musicxml/musicxml-importer.ts) captura `<lyric number="1">` preservando `isHyphenated = (syllabic === 'begin' || syllabic === 'middle')`.
   - [`leadsheet-dom-adapter.ts`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/frontend/src/core/rendering/adapters/leadsheet-dom-adapter.ts) reconstruye palabras continuas (`gui` + `a` + `rás` $\to$ `guiarás`) en `LYRICS_ONLY` sin emitir cifrados de acordes cuando `'CHORDS'` no forma parte de `view.activeRepresentations`.
2. **Protección contra metadatos como letra:**
   - [`musical-content-completion-service.ts`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/backend/src/application/musical-content-completion-service.ts) filtra líneas de título, etiquetas `Tonalidad: ...`, `Tempo: ...`, `Canción original de prueba` y las registra únicamente como trazabilidad (`metadata.lyricsHeaderMetadata`).
3. **Secciones vs texto expresivo en MusicXML:**
   - `<direction><direction-type><words>` ya no crea secciones falsas para indicaciones de tempo/dinámica (`Moderato`, etc.).
4. **Cobertura lírica y estado `PARTIAL`:**
   - `StandFormatCapabilityResolver` mide `measuresWithLyrics / measureCount` y degrada a `PARTIAL` (ámbar) cuando solo existe un fragmento parcial de la obra.

---

## 2. Validación de Tablatura (Guitarra y Bajo)

1. **Límites físicos por instrumento (`InstrumentRegistry` + `TablatureCalculator`):**
   - `acoustic_guitar`: 6 cuerdas (`E4, B3, G3, D3, A2, E2`), `maxFret: 20`.
   - `electric_guitar`: 6 cuerdas, `maxFret: 22`.
   - `bass`: 4 cuerdas (`G2, D2, A1, E1`), `maxFret: 20`.
2. **Estrategia de selección ergonómica (`TablatureCalculator.selectBestCandidate`):**
   - En posición abierta (`previousFret <= 7`), permite cuerdas al aire (`fret 0`) y trastes `1..5`.
   - En zona media/alta (`previousFret > 7`), evita saltos bruscos a `0` cuando existe digitación en trastes cómodos cercanos, y penaliza trastes `> 12` si hay alternativa en zona media.
   - Evita colisiones de cuerda entre notas simultáneas en el mismo `startTick` mediante `usedStringsAtTick`.
3. **Cero fabricación fuera de rango:**
   - Si `TablatureCalculator.calculatePosition()` retorna `null`, `ProjectionService` emite `NOTE_OUT_OF_TAB_RANGE`, y tanto `AlphaTexGenerator` como `AlphaTabAdapter` nunca fabrican `0.1` (`string: 1, fret: 0`).

---

## 3. Resultados de Pruebas Automatizadas Ejecutadas

| Suite | Resultado | Detalle |
| :--- | :--- | :--- |
| `npm --prefix frontend run typecheck` | **PASS** | `tsc --noEmit` — 0 errores |
| `npm --prefix backend run typecheck` | **PASS** | `tsc --noEmit` — 0 errores |
| `musical-completeness-remediation.test.ts` + 8 suites frontend (`musicxml-importer`, `leadsheet-dom-adapter`, `alphatab-adapter`, `capo-and-tablature`, `stand-format-capabilities`, `reading-format-selector`, `phase2c-liturgical-and-stand`, `login-must-change-password-flow`) | **PASS (57/57)** | 9 suites, 0 fallos, 0 omitidos |
| `musical-content-completion-api.test.ts` + `conversion-api.test.ts` + `audio-preservation-and-worker.test.ts` | **PASS (50/50)** | 3 suites, 0 fallos, 0 omitidos |
| `universal-ingestion-phase1b.test.ts` + `song-repository.test.ts` + `user-preferences-api.test.ts` | **PASS (52/52)** | 15 suites, 0 fallos, 0 omitidos |
| `pytest workers/audio_worker/tests -v` | **PASS (18/18)** | `18 passed in 11.35s` |
