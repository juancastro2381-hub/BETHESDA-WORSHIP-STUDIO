/**
 * @file golden-fixtures.ts
 * @description Los 11 Golden Fixtures oficiales requeridos para pruebas de regresión e ingesta:
 *  A. Simple MusicXML melody
 *  B. Piano/polyphonic MusicXML
 *  C. Guitar MusicXML
 *  D. MusicXML with lyrics
 *  E. MusicXML with chords/harmony
 *  F. MusicXML with repeats
 *  G. Simple ChordPro
 *  H. ChordPro with sections
 *  I. ChordPro with capo
 *  J. ChordPro with complex chords
 *  K. ChordPro with lyrics and no melody
 */

// A. Simple MusicXML melody (C Major, 4/4, C4 - D4 - E4 - F4)
export const GOLDEN_FIXTURE_A_SIMPLE_MELODY = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <work><work-title>Melodía Simple</work-title></work>
  <part-list>
    <score-part id="P1"><part-name>Voz</part-name></score-part>
  </part-list>
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>1</divisions>
        <key><fifths>0</fifths><mode>major</mode></key>
        <time><beats>4</beats><beat-type>4</beat-type></time>
        <clef><sign>G</sign><line>2</line></clef>
      </attributes>
      <direction><sound tempo="120"/></direction>
      <note>
        <pitch><step>C</step><octave>4</octave></pitch>
        <duration>1</duration>
        <voice>1</voice>
      </note>
      <note>
        <pitch><step>D</step><octave>4</octave></pitch>
        <duration>1</duration>
        <voice>1</voice>
      </note>
      <note>
        <pitch><step>E</step><octave>4</octave></pitch>
        <duration>1</duration>
        <voice>1</voice>
      </note>
      <note>
        <pitch><step>F</step><octave>4</octave></pitch>
        <duration>1</duration>
        <voice>1</voice>
      </note>
    </measure>
  </part>
</score-partwise>`;

// B. Piano / Polyphonic MusicXML (Dos voces / staves con <backup>)
export const GOLDEN_FIXTURE_B_PIANO_POLYPHONY = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <work><work-title>Preludio Polifónico</work-title></work>
  <part-list>
    <score-part id="P1"><part-name>Piano</part-name></score-part>
  </part-list>
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>2</divisions>
        <key><fifths>0</fifths><mode>major</mode></key>
        <time><beats>4</beats><beat-type>4</beat-type></time>
        <staves>2</staves>
        <clef number="1"><sign>G</sign><line>2</line></clef>
        <clef number="2"><sign>F</sign><line>4</line></clef>
      </attributes>
      <!-- Voz 1: Mano Derecha (2 blancas) -->
      <note>
        <pitch><step>E</step><octave>4</octave></pitch>
        <duration>4</duration>
        <voice>1</voice>
        <staff>1</staff>
      </note>
      <note>
        <pitch><step>G</step><octave>4</octave></pitch>
        <duration>4</duration>
        <voice>1</voice>
        <staff>1</staff>
      </note>
      <!-- Retroceder el compás completo -->
      <backup><duration>8</duration></backup>
      <!-- Voz 2: Mano Izquierda (1 redonda) -->
      <note>
        <pitch><step>C</step><octave>3</octave></pitch>
        <duration>8</duration>
        <voice>2</voice>
        <staff>2</staff>
      </note>
    </measure>
  </part>
</score-partwise>`;

// C. Guitar MusicXML con acordes
export const GOLDEN_FIXTURE_C_GUITAR_CHORDS = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <work><work-title>Guitarra de Acompañamiento</work-title></work>
  <part-list>
    <score-part id="P1"><part-name>Guitarra Acústica</part-name></score-part>
  </part-list>
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>1</divisions>
        <key><fifths>1</fifths><mode>major</mode></key>
        <time><beats>4</beats><beat-type>4</beat-type></time>
      </attributes>
      <harmony>
        <root><root-step>G</root-step></root>
        <kind>major</kind>
      </harmony>
      <note>
        <pitch><step>G</step><octave>3</octave></pitch>
        <duration>2</duration>
        <voice>1</voice>
      </note>
      <harmony>
        <root><root-step>D</root-step></root>
        <kind>major</kind>
      </harmony>
      <note>
        <pitch><step>D</step><octave>3</octave></pitch>
        <duration>2</duration>
        <voice>1</voice>
      </note>
    </measure>
  </part>
</score-partwise>`;

// D. MusicXML con Lírica y Silábica (Canto litúrgico)
export const GOLDEN_FIXTURE_D_LYRICS = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <work><work-title>Himno de Alabanza</work-title></work>
  <part-list>
    <score-part id="P1"><part-name>Voz Líder</part-name></score-part>
  </part-list>
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>2</divisions>
        <key><fifths>0</fifths><mode>major</mode></key>
        <time><beats>4</beats><beat-type>4</beat-type></time>
      </attributes>
      <note>
        <pitch><step>G</step><octave>4</octave></pitch>
        <duration>2</duration>
        <voice>1</voice>
        <lyric>
          <syllabic>begin</syllabic>
          <text>Glo</text>
        </lyric>
      </note>
      <note>
        <pitch><step>A</step><octave>4</octave></pitch>
        <duration>2</duration>
        <voice>1</voice>
        <lyric>
          <syllabic>end</syllabic>
          <text>ria</text>
        </lyric>
      </note>
      <note>
        <pitch><step>G</step><octave>4</octave></pitch>
        <duration>4</duration>
        <voice>1</voice>
        <lyric>
          <syllabic>single</syllabic>
          <text>Dios</text>
        </lyric>
      </note>
    </measure>
  </part>
</score-partwise>`;

// E. MusicXML con Armonía y Acordes Complejos (slash chords, m7)
export const GOLDEN_FIXTURE_E_HARMONY = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <work><work-title>Armonía Contemporánea</work-title></work>
  <part-list>
    <score-part id="P1"><part-name>Teclado</part-name></score-part>
  </part-list>
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>1</divisions>
        <key><fifths>0</fifths><mode>major</mode></key>
        <time><beats>4</beats><beat-type>4</beat-type></time>
      </attributes>
      <harmony>
        <root><root-step>C</root-step></root>
        <kind text="maj7">major-seventh</kind>
      </harmony>
      <note>
        <pitch><step>C</step><octave>4</octave></pitch>
        <duration>2</duration>
        <voice>1</voice>
      </note>
      <harmony>
        <root><root-step>D</root-step></root>
        <kind>major</kind>
        <bass><bass-step>F</bass-step><bass-alter>1</bass-alter></bass>
      </harmony>
      <note>
        <pitch><step>D</step><octave>4</octave></pitch>
        <duration>2</duration>
        <voice>1</voice>
      </note>
    </measure>
  </part>
</score-partwise>`;

// F. MusicXML con Repeticiones y Casillas de 1ra y 2da vez
export const GOLDEN_FIXTURE_F_REPEATS = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <work><work-title>Estructura con Repetición</work-title></work>
  <part-list>
    <score-part id="P1"><part-name>Flauta</part-name></score-part>
  </part-list>
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>1</divisions>
        <key><fifths>0</fifths><mode>major</mode></key>
        <time><beats>4</beats><beat-type>4</beat-type></time>
      </attributes>
      <barline location="left"><repeat direction="forward"/></barline>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><voice>1</voice></note>
    </measure>
    <measure number="2">
      <barline location="right">
        <ending number="1" type="start"/>
        <repeat direction="backward"/>
      </barline>
      <note><pitch><step>D</step><octave>4</octave></pitch><duration>4</duration><voice>1</voice></note>
    </measure>
  </part>
</score-partwise>`;

// G. Simple ChordPro
export const GOLDEN_FIXTURE_G_SIMPLE_CHORDPRO = `{title: Cuan Grande es Dios}
{key: G}
{tempo: 76}
{time: 4/4}

[G]El esplendor de un [Em7]Rey
Vestido en majes[C2]tad`;

// H. ChordPro con Secciones Explícitas ({sov}, {soc}, {sob})
export const GOLDEN_FIXTURE_H_SECTIONS_CHORDPRO = `{title: Sublime Gracia}
{key: G}
{time: 4/4}
{tempo: 72}

{start_of_verse: Estrofa 1}
[G]Sublime gracia del [C]Señor
Que a un in[G]fiel salvó [D]
{end_of_verse}

{start_of_chorus: Coro}
[G]Ya libre soy, [C]salvado fui
Por Su [G]gracia me [D]rescató
{end_of_chorus}

{start_of_bridge: Puente}
[C]Aleluya, [G/B]Aleluya
[Am7]Dios es fiel [D]para siempre
{end_of_bridge}`;

// I. ChordPro con Capo ({capo: 2})
export const GOLDEN_FIXTURE_I_CAPO_CHORDPRO = `{title: Canción con Cejilla}
{key: G}
{capo: 2}
{tempo: 80}
{time: 4/4}

[G]Canto de victoria [C]en el altar
[D]Con el capo puesto [G]en traste dos`;

// J. ChordPro con Acordes Complejos (slash chords, 7b5, 9)
export const GOLDEN_FIXTURE_J_COMPLEX_CHORDS_CHORDPRO = `{title: Jazz Worship Progression}
{key: C}
{time: 4/4}
{tempo: 90}

[Cmaj7]Gracia inefable [C#m7(b5)/G]y santidad
[Dm9]Cristo vive en [G7(b9)]mí`;

// K. ChordPro con Letras y Sin Notas Melódicas Inventadas
export const GOLDEN_FIXTURE_K_LYRICS_NO_MELODY_CHORDPRO = `{title: Solo Letra y Cifrado}
{artist: Alabanza Bethesda}
{key: D}
{tempo: 70}
{time: 4/4}

{start_of_verse: Verso Único}
[D]En Tu presencia hay [G]plenitud de gozo
[A]Delicias a Tu diestra [Bm]para siempre
{end_of_verse}`;
