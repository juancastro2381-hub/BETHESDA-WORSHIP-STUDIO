# MUSIC STAND FORMAT AVAILABILITY MATRIX
## Bethesda Worship Studio — Reglas Deterministas de Disponibilidad y Completitud (Atril Digital)

**Fuente autoritativa compartida:** [`stand-format-capabilities.ts`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/frontend/src/core/workspace/stand-format-capabilities.ts)  
**Consumidor en backend:** [`musical-content-completion-service.ts`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/backend/src/application/musical-content-completion-service.ts)  
**Consumidor en frontend:** [`reading-format-selector-component.ts`](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/frontend/src/components/workspace/reading-format-selector-component.ts)

---

## 1. Taxonomía de Estados (`StandFormatCapabilityDescriptor`)

### `availabilityStatus` (`StandFormatAvailabilityStatus`)
| Estado | `isAvailable` | Significado |
| :--- | :---: | :--- |
| `APPROVED` | `true` | Contenido completo, válido y aprobado (`songStatus === 'APPROVED'` o metadata `approvalStatus === 'APPROVED'`). |
| `AVAILABLE` | `true` | Contenido válido completo y compatible con el instrumento (sin bloqueo ni revisión pendiente). |
| `REVIEW_REQUIRED` | `true` o `false` | `false` si existe evidencia bloqueante sin verificar (ej. notas con `noteExtractionStatus === 'AMBIGUOUS'`, letra `UNVERIFIED_AUDIO_SPEECH` sin `lyricsVerifiedByHuman`, o formato faltante con propuesta en curso). `true` únicamente cuando el contenido estructural mínimo es válido en borrador (`DRAFT`) y se permite previsualización sujeta a aprobación oficial. |
| `INCOMPLETE` | `false` | Existe contenido parcial pero insuficiente para proyección limpia (ej. notas sin `durationTicks`/`startTick`, o letra en `metadata.unalignedLyrics` no alineada con los acordes). |
| `MISSING_CONTENT` | `false` | Falta contenido musical fundamental para el formato (ej. canción solo con acordes para `PARTITURE`/`TABLATURE`, o solo con notas sin letra para `LYRICS_ONLY`, o instrumento sin afinación para `TABLATURE`). |
| `VALIDATION_REQUIRED` | `false` | Reservado para fuentes cuya validación estructural aún no concluye. |
| `BLOCKED` | `false` | Incompatibilidad dura (instrumento sin soporte del formato en `InstrumentProfile` o 100 % de las notas fuera del registro físico de afinación/capo). |

---

## 2. Matriz por Formato del Atril Digital

### Formato 1: `PARTITURE` (`STAFF_NOTATION`)

| Condición del `CanonicalMusicPayload` + `InstrumentProfile` | `availabilityStatus` | `isAvailable` | `reviewRequired` | Mensaje / Acción recomendada |
| :--- | :--- | :---: | :---: | :--- |
| Instrumento no soporta `STANDARD_NOTATION` ni `GRAND_STAFF` (ej. perfiles sin pentagrama melódico) | `BLOCKED` | `false` | `false` | Bloqueado por perfil; cambiar a instrumento compatible. |
| `noteCount === 0` (incluye obras solo con `ChordEvent` o solo `Rest`) | `MISSING_CONTENT` (o `REVIEW_REQUIRED` si hay propuesta pendiente) | `false` | `hasPending` | Un cifrado o silencios no generan partitura; importar MusicXML / MIDI o transcribir notas manuales (`WRITTEN_NOTES`). |
| `noteCount > 0` pero `timedNoteCount < noteCount` (notas sin `startTick` o `durationTicks > 0`) | `INCOMPLETE` | `false` | `true` | No inventa subdivisión rítmica; completar duraciones. |
| `metadata.noteExtractionStatus === 'AMBIGUOUS'` y `!isApproved` | `REVIEW_REQUIRED` | `false` | `true` | Requiere verificación humana de alturas y ritmo antes de habilitar lectura. |
| Notas válidas con ritmo completo en borrador/propuesta (`DRAFT`) o evidencia `ESTIMATED` | `REVIEW_REQUIRED` | `true` | `true` | Habilitado como vista previa de borrador; requiere aprobación RBAC. |
| Notas válidas con ritmo completo en versión aprobada (`APPROVED`) | `APPROVED` | `true` | `false` | Partitura oficial lista para lectura en Atril Digital. |

**Fuentes de completitud aceptadas en Backend (`MUSICXML`, `MIDI`, `WRITTEN_NOTES`):**
- `MUSICXML`: parseo estricto con rechazo de XXE (`UnifiedMusicImporter`), exige `<score-partwise>`/`<score-timewise>` y `getAllNotes().length > 0`.
- `MIDI`: exige Base64 válido $\le 15\text{ MiB}$, cabecera binaria `MThd` (`MidiParser.isMidiFile`), y eventos Note On utilizables (`getAllNotes().length > 0`).
- `WRITTEN_NOTES`: exige estructura de compases con notas explícitas (`step`, `octave`, `alter`, `duration`) y al menos una nota melódica.

---

### Formato 2: `CHORDS_WITH_LYRICS` (`CHORD_CHART`)

#### Estados específicos de completitud (`LeadSheetCompletionState`)
1. `MISSING_BOTH`: 0 acordes y 0 sílabas/líneas.
2. `CHORDS_AVAILABLE_LYRICS_MISSING`: acordes $> 0$, letra $= 0$.
3. `LYRICS_AVAILABLE_CHORDS_MISSING`: acordes $= 0$, letra $> 0$.
4. `LYRICS_AVAILABLE_NOT_ALIGNED`: acordes $> 0$ y letra únicamente en `metadata.unalignedLyrics`.
5. `LYRICS_ALIGNED_AWAITING_REVIEW`: acordes $> 0$ y `measures[*].lyrics > 0`, en borrador/revisión (`DRAFT` o `lyricsSource === 'UNVERIFIED_AUDIO_SPEECH'`).
6. `LYRICS_VERIFIED`: acordes $> 0$ y letra verificada alineada (no aprobado aún como canción oficial).
7. `COMPLETE_AND_APPROVED`: canción/versión aprobada oficialmente.

| Condición | `availabilityStatus` | `isAvailable` | `leadSheetState` | Comportamiento |
| :--- | :--- | :---: | :--- | :--- |
| Instrumento no soporta `CHORDS` o `LYRICS` | `BLOCKED` | `false` | `MISSING_BOTH` | Incompatible con perfil del instrumento. |
| Acordes $> 0$, sin letra | `MISSING_CONTENT` | `false` | `CHORDS_AVAILABLE_LYRICS_MISSING` | Habilita CTA para agregar o importar letra. |
| Acordes $> 0$, letra presente en `unalignedLyrics` | `INCOMPLETE` | `false` | `LYRICS_AVAILABLE_NOT_ALIGNED` | Letra guardada pero formato bloqueado hasta alinear con compases/acordes. |
| Letra $> 0$, sin acordes | `MISSING_CONTENT` | `false` | `LYRICS_AVAILABLE_CHORDS_MISSING` | Sugiere importar ChordPro o ingresar acordes. |
| Sin acordes ni letra | `MISSING_CONTENT` | `false` | `MISSING_BOTH` | Bloqueado; solicita acordes y letra. |
| `lyricsSource === 'UNVERIFIED_AUDIO_SPEECH'` y `!isApproved` | `REVIEW_REQUIRED` | `false` | `LYRICS_ALIGNED_AWAITING_REVIEW` | Bloquea transcripción automática de voz hasta confirmación humana. |
| Acordes $> 0$ y letra alineada en `DRAFT` | `REVIEW_REQUIRED` | `true` | `LYRICS_ALIGNED_AWAITING_REVIEW` | Visible en vista previa de borrador; pendiente de aprobación RBAC. |
| Acordes $> 0$ y letra alineada en versión `APPROVED` | `APPROVED` | `true` | `COMPLETE_AND_APPROVED` | Disponible para Atril Digital oficial. |

---

### Formato 3: `LYRICS_ONLY`

| Condición | `availabilityStatus` | `isAvailable` | Comportamiento |
| :--- | :--- | :---: | :--- |
| Instrumento sin capa `LYRICS` | `BLOCKED` | `false` | Incompatible con perfil seleccionado. |
| Sin sílabas en compases ni `unalignedLyrics` | `MISSING_CONTENT` (o `REVIEW_REQUIRED` si hay propuesta) | `false` | Requiere texto lírico real (nunca fabrica letra desde título o acordes). |
| `metadata.lyricsSource === 'UNVERIFIED_AUDIO_SPEECH'` con `lyricsVerifiedByHuman !== true` y `!isApproved` | `REVIEW_REQUIRED` | `false` | Bloqueado por regla anti-alucinación de voz; exige verificación humana explícita. |
| Letra presente verificada en borrador (`DRAFT`) o con `lyricsVerifiedByHuman === false` | `REVIEW_REQUIRED` | `true` | Lectura permitida en borrador; advierte aprobación oficial pendiente. |
| Letra verificada en canción aprobada (`APPROVED`) | `APPROVED` | `true` | Formato oficial habilitado. |

---

### Formato 4: `TABLATURE`

| Condición | `availabilityStatus` | `isAvailable` | Reglas clave |
| :--- | :--- | :---: | :--- |
| Instrumento sin `tuning` definido o sin soporte `TABLATURE` (ej. Piano, Voz) | `MISSING_CONTENT` | `false` | Requiere perfil de cuerda con afinación (Guitarra Acústica/Eléctrica 6 cuerdas o Bajo 4 cuerdas). |
| `noteCount === 0` (incluso si existen `ChordEvent`) | `MISSING_CONTENT` (o `REVIEW_REQUIRED` si hay propuesta) | `false` | **Invariante estricto**: un símbolo de acorde por sí solo no define una digitación única; requiere notas reales. |
| Notas reales pero `playableCount === 0 && outOfRangeCount > 0` | `BLOCKED` | `false` | Todas las notas quedan fuera de trastes `[0..24]` para la afinación + `capoFret`. |
| Notas tocables presentes con posiciones ambiguas (`candidates.length > 1` sin override humano) o en `DRAFT` | `REVIEW_REQUIRED` / `AVAILABLE` | `true` | Muestra `tablatureSummary` (`ambiguousCount`, `outOfRangeCount`, `largeLeapCount`, `humanVerifiedPositionsCount`) y permite fijar overrides por nota en el asistente. |
| Versión `APPROVED` con instrumento y notas válidas | `APPROVED` | `true` | `ProjectionService.project()` respeta primero `note.notationMetadata.tablature` (`extractValidatedTablatureOverride`) siempre que `openPitch.midiNumber + capoFret + fret === note.pitch.midiNumber`. |

**Validación estricta de overrides de traste/cuerda en Backend:**
- Si `stringNumber` está fuera de `[1..stringCount]`, o `fret` fuera de `[0..24]`, o `openPitch.midiNumber + capoFret + fret !== note.pitch.midiNumber`, el backend rechaza la petición con HTTP `400 ValidationError` y nunca persiste una digitación físicamente imposible.
