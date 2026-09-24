# BETHESDA WORSHIP STUDIO
## Documento 02: Modelo de Dominio Musical, Modelo Canónico y Notación

---

## 1. La Canción como Fuente Canónica de la Verdad (Canonical Source of Truth)

En **Bethesda Worship Studio**, una canción no es una colección desarticulada de archivos PDF o textos planos con acordes pegados. 

El núcleo del sistema responde a una **Cadena de Transformación Musical Rigurosa**:

```
┌────────────────────────────────────────────────────────────────────────┐
│                                 SONG                                   │
│  (Entidad Primaria: Metadatos de la obra, autor/artista, tonalidad     │
│       de referencia y metadatos de derechos de autor)                  │
└──────────────────────────────────┬─────────────────────────────────────┘
                                   │
                                   ▼
┌────────────────────────────────────────────────────────────────────────┐
│                       CANONICAL MUSICAL MODEL                          │
│   (Grafo de Compases, Tiempos, Tonalidad, Métrica, Eventos Polifónicos,│
│              Sílabas de Letra, Cifrado Armónico Base)                  │
└──────────────────────────────────┬─────────────────────────────────────┘
                                   │
                                   ▼
┌────────────────────────────────────────────────────────────────────────┐
│                             ARRANGEMENT                                │
│   (Estructura de Secciones: Intro, Verso, Coro; Instrumentación,       │
│                Tempo BPM, Tonalidad del Servicio)                      │
└──────────────────────────────────┬─────────────────────────────────────┘
                                   │
                                   ▼
┌────────────────────────────────────────────────────────────────────────┐
│                           INSTRUMENT PART                              │
│   (Pista Específica: Piano, Guitarra, Voz, Saxo Tenor Bb, Batería;     │
│                 Transposición Instrumental Inherente)                  │
└──────────────────────────────────┬─────────────────────────────────────┘
                                   │
                                   ▼
┌────────────────────────────────────────────────────────────────────────┐
│                        USER PERFORMANCE VIEW                           │
│   (Representación Visual Elegida por el Músico: Partitura + Tab,       │
│             Solo Cifrado, Letra + Cifrado, Notación Percusión)         │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Modelo de Dominio de Canción y Estructura (Song & Section Domain Model)

### Entidades Centrales y Atributos

1. **Song (Canción Canónica):**
   - `id`: UUIDv7 (ordenable temporalmente).
   - `title`: Título de la obra.
   - `original_artist` / `ccli_number` / `copyright`: Metadatos y derechos de autor.
   - `default_key`: Tonalidad de referencia original (ej. `E_MAJOR`).
   - `default_tempo_bpm`: Tempo base.
   - `time_signature`: Métrica base (ej. `4/4`, `6/8`).
   - *(Nota de diseño: El contenido lírico musical no se almacena como texto plano en Song, sino que reside estructurado en el `canonical_music_payload` del Arreglo).*

2. **Section (Sección Musical):**
   - Una canción se compone de un conjunto ordenado o reordenable de secciones.
   - **Tipos de Sección Soportados:**
     - `INTRO` (Introducción instrumental o vocal)
     - `VERSE` (Verso / Estrofa)
     - `PRE_CHORUS` (Pre-Coro)
     - `CHORUS` (Coro / Estribillo)
     - `BRIDGE` (Puente)
     - `INTERLUDE` (Interludio)
     - `SOLO` (Solo instrumental de guitarra, saxofón, sintetizador)
     - `INSTRUMENTAL` (Paso instrumental)
     - `OUTRO` / `ENDING` (Final / Conclusión)
     - `TAG` (Reiteración de frase final)
     - `VAMP` (Patrón de acompañamiento repetitivo abierto para ministración)
     - `CUSTOM` (Sección libre con etiqueta personalizada por el usuario)

3. **Measure (Compás) y Tick Musical:**
   - La resolución temporal se mide en **Ticks por Negra (TPQN - Ticks Per Quarter Note)**, fijado canónicamente en **480 TPQN** (estándar profesional MIDI/MusicXML).
   - Cada compás define su compás numerador/denominador, armadura de clave (*Key Signature*), y un arreglo de voces polifónicas con notas, silencios, acordes y sílabas.

---

## 3. Modelo de Arreglos (Arrangement Model)

Una canción en la iglesia se interpreta de formas variadas según el contexto del servicio:
- **Arreglo Original / Full Band:** Batería completa, bajo, guitarras, teclados, coro a 4 voces, metales.
- **Arreglo Acústico:** Reducido a guitarra acústica, piano y voz solista.
- **Arreglo Congregacional / Rápido:** Formato simplificado y en tonalidad más accesible para la asamblea.
- **Medley / Popurrí:** Integración de estrofas de dos canciones concatenadas.

### Características del Arreglo:
- Posee su propia secuencia de secciones (ej. Arreglo A: *Intro → V1 → C → V2 → C → B → C → Outro*; Arreglo B: *Intro → C → B → C*).
- Define la tonalidad específica de interpretación y el tempo de esa versión.
- Gestiona qué pistas instrumentales (*Instrument Parts*) existen y están activas.

---

## 4. Instrumento ≠ Vista Musical (Desacoplamiento Fundamental)

Uno de los mayores errores de diseño en sistemas de música es asumir una relación 1:1 entre un instrumento y una única vista (ej. "Guitarra = Tablatura", "Voz = Solo Letra").

En **Bethesda Worship Studio**, **todo instrumento soportado puede renderizarse en cualquiera de las vistas compatibles con su naturaleza física y sonora**.

### Matriz Exhaustiva de Instrumentos vs. Vistas Disponibles

| Instrumento | Partitura Tradicional | Cifrado Armónico | Tablatura | Partitura + Tablatura | Letra + Cifrado | Partitura + Cifrado | Notación de Percusión | Diagramas de Acordes |
|:---|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| **Guitarra Eléctrica / Acústica** |  |  |  |  |  |  | ❌ |  (Opcional) |
| **Bajo Eléctrico (4, 5, 6 cuerdas)** |  (Clave Fa) |  |  |  |  |  | ❌ | ❌ |
| **Piano / Teclado** |  (Doble Pentagrama) |  | ❌ | ❌ |  |  | ❌ | ❌ |
| **Sintetizador / Pads** |  (Clave Sol) |  | ❌ | ❌ |  |  | ❌ | ❌ |
| **Voz Principal / Coros** |  (Línea melódica) | ❌ | ❌ | ❌ |  |  | ❌ | ❌ |
| **Saxofón Alto (Eb) / Tenor (Bb)** |  (Transpuesta) |  (Transpuesto) | ❌ | ❌ |  (Transpuesto) |  | ❌ | ❌ |
| **Trompeta (Bb)** |  (Transpuesta) |  (Transpuesto) | ❌ | ❌ |  (Transpuesto) |  | ❌ | ❌ |
| **Batería Acústica / Electrónica** | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |  (Percusión) | ❌ |
| **Percusión Menor / Congas** | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |  (Línea rítmica) | ❌ |

---

## 5. Instrumentos Transpositores (Concert Pitch vs. Written Pitch)

El sistema soporta intrínsecamente la distinción entre:
1. **Concert Pitch (Tono de Concierto / Sonido Real):** La tonalidad absoluta en la que tocan el piano, la guitarra, el bajo y la voz (instrumentos en Do).
2. **Written Pitch (Tono Escrito):** La notación leída por instrumentos transpositores para producir el tono de concierto correspondiente.

### Registro de Transposiciones Nativas:
- **Instrumentos en Do (C):** Offset = 0 semitonos (Piano, Voz, Guitarra [octava abajo real], Flauta, Violín, Bajo [octava abajo]).
- **Instrumentos en Si bemol (Bb):** Offset = +2 semitonos escritos (Saxo Tenor, Saxo Soprano, Trompeta, Clarinete).
  - *Ejemplo:* Banda toca en Sol Mayor (G) → Saxo Tenor lee en La Mayor (A).
- **Instrumentos en Mi bemol (Eb):** Offset = +9 semitonos escritos / -3 semitonos (Saxo Alto, Saxo Barítono).
  - *Ejemplo:* Banda toca en Sol Mayor (G) → Saxo Alto lee en Mi Mayor (E).
- **Instrumentos en Fa (F):** Offset = +7 semitonos escritos (Corno Francés).

El músico de saxofón simplemente elige su instrumento en su perfil (*"Saxo Alto"*); el sistema le presenta su partitura y cifrado en su tonalidad escrita de forma totalmente transparente, mientras que el director musical ve el tono de concierto.

---

## 6. Modelo Estructurado de Letras y Sílabas (Structured Lyrics Model)

Para permitir sincronización temporal en vivo, seguimiento de estrofas y renderizado de notación vocal precisa, las letras no son simples strings:

```json
{
  "syllable_id": "syl_0182",
  "text": "Glo",
  "is_hyphenated": true,
  "bound_note_id": "note_0481",
  "measure_number": 12,
  "tick_offset": 0,
  "chord_above": {
    "root": "C",
    "quality": "maj7",
    "bass": "E"
  }
}
```

- Cada sílaba se asocia a su nota correspondiente en la partitura vocal.
- Soporta corte silábico guionado (*hyphenation*) según reglas ortográficas del español.
- En la vista "Letra + Cifrado", el acorde se vincula a la sílaba exacta donde se produce el cambio armónico, impidiendo que cambios de tamaño de fuente desalineen la armonía.

---

## 7. Modelo Armónico y de Cifrado (Chord Model)

El modelo de cifrado es analítico y no una simple cadena de caracteres:

### Anatomía del Objeto Acorde:
```
[Fundamental (Root)] + [Calidad (Quality)] + [Extensiones/Alteraciones] / [Bajo (Bass)]
Ejemplo: "C#m7(b5)/G" -> Root: C#, Quality: minor, Ext: [b5, 7], Bass: G
```

### Capacidades del Motor Armónico:
1. **Transposición Cromática y Diatónica:** Algoritmo que respeta las armaduras de clave (evitando errores como escribir `D#` en lugar de `Eb` cuando la tonalidad destino es Si bemol).
2. **Sistema Nashville y Números Romanos:** Capacidad de alternar la visualización entre:
   - Cifrado Estándar: `G - C - D - Em`
   - Cifrado Latino: `Sol - Do - Re - Mim`
   - Números Romanos: `I - IV - V - vi`
   - Nashville Number System (NNS): `1 - 4 - 5 - 6m`
3. **Diagramas de Diapasón para Guitarra/Ukelele:** Generación de diagramas SVG para posiciones de acordes con indicación de dedos, cejillas y cuerdas muteadas.
4. **Soporte de Capo (Cejilla):** Cálculo automático de acordes tocados (*Chord Fingerings*) versus acordes sonantes reales (*Concert Chords*). Ej: Canción en Ab con Capo 1 se lee como acordes en G.

---

## 8. Notación de Percusión para Batería (Drum Percussion Model)

La batería no es un instrumento temperado tonal. Su modelo representa instrumentos físicos del kit según el estándar internacional **General MIDI Percussion** y **PAS (Percussive Arts Society)**:

```
Clave de Percusión Neutral (Neutral Clef: ||)
Posiciones en el Pentagrama:
- Espacio superior (G5): Platillo Crash / Splash (cabeza en 'x')
- Línea superior (F5): Ride Cymbal (cabeza en 'x')
- Espacio 4 (E5): Hi-Hat cerrado (cabeza en 'x') / abierto ('x' circulada)
- Espacio 3 (C5): Tom agudo (cabeza normal)
- Espacio 2 (A4): Snare / Caja (cabeza normal) / Rimshot ('x') / Cross-stick
- Espacio 1 (F4): Tom de piso (cabeza normal)
- Espacio inferior (D4): Bombo / Bass Drum (cabeza normal)
- Línea inferior exterior (D3): Hi-Hat accionado con pedal (cabeza en 'x')
```

- **Articulaciones:** Acentos (`>`), notas fantasma (*ghost notes* entre paréntesis `(o)`), flam y redobles.
- **Vistas Especiales para el Baterista:** 
  1. *Notación Completa:* Pentagrama de batería con groove y fills detallados.
  2. *Guía Rítmica / Lead Sheet:* Estructura de la canción con compases en blanco (*slash notation*), marcaciones de cortes rítmicos de la banda (*kicks over time*) y cambios de dinámica (*mp, mf, f, ff*).

---

## 9. Estrategia de Notación, MusicXML y SMuFL

### Interoperabilidad MusicXML
- **MusicXML 4.0** es el estándar de la industria adoptado como formato de intercambio canónico para importar y exportar partituras hacia y desde software profesional (Dorico, Sibelius, MuseScore, Finale).
- El sistema parsea MusicXML y lo transforma en el **Modelo Canónico Interno en memoria/JSONB**, manteniendo la fidelidad de ligaduras, compases de repetición, dinámicas y texto expresivo.

### Fuente Tipográfica Musical Estándar: SMuFL (Standard Music Font Layout)
- Para el renderizado de glifos musicales (claves, alteraciones, cabezas de nota, banderas, silencios, signos de coda y segnos), se adopta la especificación **W3C SMuFL**.
- Fuentes recomendadas integradas: **Bravura** y **Petaluma** (estilo manuscrito / real book para alabanza contemporánea).

---

## 10. Arquitectura de Transposición Profesional

La transposición en Bethesda Worship Studio **nunca se implementa como reemplazo de texto o regex**. Se basa en cálculo interválico exacto:

### Algoritmo de Transposición:
1. **Conversión a Pitch Class (0 a 11):** `C=0, C#/Db=1, D=2, ..., B=11`.
2. **Cálculo de Intervalo:** $\Delta Semitonos = \text{Key}_{\text{target}} - \text{Key}_{\text{source}}$.
3. **Preservación Diatónica y Ortografía Enarmónica:**
   - La nueva tonalidad determina la armadura de clave según el **Círculo de Quintas**.
   - Cada nota y fundamental de acorde se proyecta sobre la escala de la armadura destino para garantizar que no existan nombres incorrectos (ej. en tonalidad de F Mayor, la cuarta debe llamarse obligatoriamente `Bb` y nunca `A#`).
4. **Recálculo de Tablatura de Guitarra/Bajo:**
   - Si la canción se transpone hacia arriba o abajo, el motor de tablatura recalcula los trastes (*frets*) manteniendo las cuerdas preferidas o aplicando desplazamientos de cejilla lógica cuando una nota caiga fuera del rango de la cuerda al aire.

### Distinción Formal: Transposición Musical vs. Cejilla (Capo)

Es mandatorio separar conceptual y matemáticamente dos fenómenos frecuentemente confundidos:

> [!IMPORTANT]
> **Invariante de Dominio:**  
> *"La cejilla (Capo) modifica la estrategia de digitación y renderizado; la transposición musical modifica el tono/frecuencia musical objetivo."*

1. **Transposición Musical (`transpositionSemitones`):**
   - Modifica la altura sonora real (*concert pitch*) o el tono objetivo de la pieza (ej. modular de Sol Mayor a Mi Mayor para el rango vocal).
   - Afecta a toda la banda: notas de pentagrama, armaduras y fundamentales de acordes cambian a nivel ontológico.
2. **Cejilla de Instrumento de Cuerda (`capoFret`):**
   - Es un artefacto mecánico en el mástil que **no altera la tonalidad canónica de concierto de la banda**.
   - **Ejemplo:**
     - Tonalidad Canónica de Concierto: **Sol Mayor (G)**.
     - Si el guitarrista coloca Capo en Traste 2 (`capoFret = 2`), utiliza digitaciones de **Fa Mayor (F)** ($F + 2 \text{ semitonos} = G$).
     - La canción **sigue sonando en Sol Mayor**. El pianista, bajista y cantante leen y tocan en Sol Mayor. Solo la capa visual de digitación del guitarrista muestra acordes con forma de Fa.
   - `transpositionSemitones` y `capoFret` son ortogonales e independientes en todos los esquemas (`InstrumentPart`, `ArrangementViewPreset`, `RuntimeDisplayState`).
