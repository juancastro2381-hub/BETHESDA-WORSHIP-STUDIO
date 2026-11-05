# BETHESDA WORSHIP STUDIO — PHASE 1B
## INFORME TÉCNICO DEL MODELO MUSICAL CANÓNICO
**Documento:** `WS_PHASE_1B_CANONICAL_MUSIC_MODEL_REPORT.md`  
**Ruta:** `docs/reports/phase-1b/WS_PHASE_1B_CANONICAL_MUSIC_MODEL_REPORT.md`  
**Fase:** Phase 1B — Universal Music Ingestion, Canonical Music Pipeline & Multi-Format Conversion  
**Fecha de Emisión:** 2026-11-05  
**Estado:** COMPLETADO Y VERIFICADO TÉCNICAMENTE

---

### 1. PROPÓSITO DEL MODELO CANÓNICO

El Modelo Musical Canónico de Bethesda Worship Studio constituye el núcleo ontológico y de datos de la plataforma. Su objetivo primordial es desacoplar de manera definitiva los formatos de entrada heterogéneos (MusicXML, MIDI, ChordPro, Notas Manuales, OMR) y los motores de renderizado de salida (OSMD, AlphaTab, DOM LeadSheet, Tablatura, Cifrado Litúrgico).

El modelo canónico garantiza que la información musical se almacene, manipule, transponga y proyecte sin ambigüedades, sin redondeos acumulativos y sin pérdida de semántica litúrgica.

---

### 2. LA COLUMNA TEMPORAL DE 480 TPQN (*TICKS PER QUARTER NOTE*)

El tiempo musical en Bethesda Worship Studio se modela exclusivamente en ticks enteros utilizando una resolución de **480 TPQN**.

#### 2.1 Justificación Matemática
480 es una base altamente compuesta seleccionada deliberadamente porque es exactamente divisible por todos los submúltiplos comunes de la notación musical occidental:
- Redonda ($4 \times 480 = 1920$ ticks)
- Blanca ($2 \times 480 = 960$ ticks)
- Negra ($1 \times 480 = 480$ ticks)
- Corchea ($480 / 2 = 240$ ticks)
- Semicorchea ($480 / 4 = 120$ ticks)
- Fusa ($480 / 8 = 60$ ticks)
- Semifusa ($480 / 16 = 30$ ticks)
- Tresillo de negras ($960 / 3 = 320$ ticks)
- Tresillo de corcheas ($480 / 3 = 160$ ticks)
- Tresillo de semicorcheas ($240 / 3 = 80$ ticks)
- Quintillos ($480 / 5 = 96$ ticks)
- Notas con puntillo: Negra con puntillo ($480 \times 1.5 = 720$ ticks), Corchea con puntillo ($240 \times 1.5 = 360$ ticks).

Al trabajar estrictamente con aritmética entera en ticks, se elimina por completo el error de punto flotante característico de cálculos basados en segundos o compases decimales.

---

### 3. JERARQUÍA DE ENTIDADES CANÓNICAS

```
CanonicalMusicPayload
 ├── Timeline (duración total en ticks, tempoMap con eventos de tempo)
 ├── Sections (Intro, Estrofa, Coro, Puente, Outro con rangos de compases)
 ├── InstrumentTracks (id, nombre, familia: 'KEYS' | 'VOCALS' | 'GUITAR' ..., voiceIds)
 └── Measures [1 .. N]
      ├── timeSignature (numerador, denominador, duración de compás en ticks)
      ├── keySignature (tonalidad armónica, alteraciones de armadura)
      ├── startTick & durationTicks
      ├── Voices [1 .. M]
      │    └── Events: Array<Note | Rest>
      │         ├── Note: pitch (step, alter, octave), startTick, durationTicks, velocity, tie
      │         └── Rest: startTick, durationTicks
      ├── Chords: Array<ChordEvent>
      │    └── root, quality, bassNote, startTick, extension
      └── Lyrics: Array<LyricSyllable>
           └── text, tickOffset, sequenceNumber, chordAbove, isHyphenated
```

---

### 4. INVARIANTES Y REGLAS DE INTEGRIDAD DEL VALIDADOR CANÓNICO

Todo objeto `CanonicalMusicPayload` procesado por el subsistema de ingesta universal debe superar la validación estricta de `CanonicalModelValidator` antes de persistirse en la base de datos PostgreSQL:

1. **Compases Correlativos Estrictos:**  
   Los compases deben estar indexados con números enteros correlativos iniciando en 1: $1, 2, 3, \dots, N$. No se admiten saltos, números negativos ni duplicaciones.
2. **Consistencia de Límites Temporales:**  
   Para todo compás $m$, su `startTick` debe ser idéntico al `endTick` del compás anterior $m - 1$:
   $$\text{startTick}(m_i) = \text{startTick}(m_{i-1}) + \text{durationTicks}(m_{i-1})$$
3. **Contención de Eventos de Voz:**  
   Todo evento (`Note` o `Rest`) de una voz debe comenzar en un tick $\ge \text{startTick}(m)$ y su finalización no puede exceder el límite del compás $\text{startTick}(m) + \text{durationTicks}(m)$.
4. **Validación Tonal y Enarmonía:**  
   Los objetos `Pitch` validan que el paso tonal pertenezca estrictamente al conjunto de letras $\{A, B, C, D, E, F, G\}$ y que la octava se encuentre en el rango acústico válido $0 \le n \le 9$.
5. **CERO Relleno Silencioso o Do Mayor por Defecto:**  
   El validador rechaza cualquier payload que intente introducir notas "por defecto" para enmascarar errores de lectura o fuentes vacías. Si la fuente es un LeadSheet (ChordPro), el validador verifica que `totalNotes === 0`.
6. **Desacoplamiento Estricto de Claves de Cifrado y Armaduras:**  
   Las tonalidades armónicas conservan la distinción entre modo mayor y menor, así como la nomenclatura internacional y en español (ej. `Sol Mayor (G)`), sin contaminar la representación del pitch subyacente.

---

### 5. PERSISTENCIA EN POSTGRESQL Y SERIALIZACIÓN DETERMINISTA

La persistencia del modelo canónico se realiza en la tabla `song_versions` a través de una columna de tipo `JSONB` denominada `canonical_payload`.

- **Serialización (`CanonicalSerializer`):** Convierte el grafo de objetos inmutables en una representación JSON normalizada, verificando la validez previa mediante `CanonicalModelValidator` y calculando estadísticas cuantitativas (`totalMeasures`, `totalNotes`, `totalChords`).
- **Deserialización (`CanonicalDeserializer`):** Reconstruye completamente la jerarquía de clases TypeScript (`CanonicalMusicPayload`, `Measure`, `Voice`, `Note`, `Rest`, `Chord`, `TimeSignature`, `KeySignatureReference`), garantizando que la aplicación opere siempre con objetos de dominio fuertemente tipados.
- **Round-Trip Fidelity:** Verificado al 100% mediante pruebas automatizadas de regresión (`round-trip-integrity.test.ts`), comprobando que:
  $$\text{JSON.stringify}(\text{deserialize}(\text{serialize}(\text{model}))) \equiv \text{JSON.stringify}(\text{serialize}(\text{model}))$$

