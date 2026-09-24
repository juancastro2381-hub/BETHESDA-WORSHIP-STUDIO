/**
 * @file transposition.ts
 * @description Motor de transposición analítica interválica, compensación para instrumentos
 * transpositores (Bb, Eb, F) y cálculo de cejilla (Capo) formalmente desacoplado de la tonalidad real.
 */

import { Chord } from './chord.ts';
import { EnharmonicSpelling } from './enharmonic-spelling.ts';
import { MusicalKey } from './musical-key.ts';
import { NoteName } from './note-name.ts';
import { PitchClass } from './pitch-class.ts';

export class TranspositionEngine {
  /**
   * Transpone una nota musical por un número de semitonos (+/-), resolviendo
   * la ortografía enarmónica según la tonalidad objetivo.
   */
  public static transposeNote(
    note: NoteName,
    semitones: number,
    targetKey?: MusicalKey
  ): NoteName {
    const originalPc = note.toPitchClass();
    const targetPc = originalPc.add(semitones);

    if (targetKey) {
      return EnharmonicSpelling.spell(targetPc, targetKey);
    }

    // Si no se especifica tonalidad, conservar preferencia de sostenido/bemol de la nota origen
    const preferSharp =
      note.accidental.semitoneOffset > 0 ||
      (note.accidental.semitoneOffset === 0 && semitones > 0);

    return EnharmonicSpelling.spellGeneric(targetPc, preferSharp);
  }

  /**
   * Transpone un acorde completo por semitonos, recalculando fundamental y bajo de inversión
   * sin alterar la cualidad, extensiones o alteraciones armónicas.
   */
  public static transposeChord(
    chord: Chord,
    semitones: number,
    targetKey?: MusicalKey
  ): Chord {
    if (semitones === 0) {
      return chord;
    }

    const newRoot = TranspositionEngine.transposeNote(chord.root, semitones, targetKey);
    const newBass = chord.bass
      ? TranspositionEngine.transposeNote(chord.bass, semitones, targetKey)
      : null;

    return new Chord({
      root: newRoot,
      quality: chord.quality,
      extensions: [...chord.extensions],
      alterations: [...chord.alterations],
      addedTones: [...chord.addedTones],
      suspended: chord.suspended,
      bass: newBass,
    });
  }

  /**
   * Transpone una tonalidad completa por un desplazamiento de semitonos,
   * encontrando la tonalidad canónica destino en el Círculo de Quintas.
   */
  public static transposeKey(sourceKey: MusicalKey, semitones: number): MusicalKey {
    if (semitones === 0) {
      return sourceKey;
    }

    const targetPc = sourceKey.tonic.toPitchClass().add(semitones);

    // Buscar entre las tonalidades canónicas del mismo modo (Mayor o Menor)
    // cuya tónica coincida enarmónicamente con targetPc
    const candidates = MusicalKey.ALL_CANONICAL_KEYS.filter(
      (k) => k.mode === sourceKey.mode && k.tonic.toPitchClass().equals(targetPc)
    );

    if (candidates.length === 0) {
      throw new Error(`No se encontró tonalidad canónica para semitonos: ${semitones}`);
    }

    if (candidates.length === 1) {
      return candidates[0]!;
    }

    // Si hay ambigüedad enarmónica (ej. F# vs Gb), elegir la más cercana en el círculo de quintas
    // a la armadura de la tonalidad origen
    const sourceCount = sourceKey.keySignature.accidentalCount;
    return candidates.reduce((prev, curr) =>
      Math.abs(curr.keySignature.accidentalCount - sourceCount) <
      Math.abs(prev.keySignature.accidentalCount - sourceCount)
        ? curr
        : prev
    );
  }
}

/**
 * Constantes y funciones de compensación para instrumentos transpositores.
 */
export class TransposingInstrumentEngine {
  public static readonly CONCERT_OFFSET = 0; // Piano, Flauta, Violín, Voz
  public static readonly BB_OFFSET = 2; // Saxo Tenor/Soprano, Trompeta, Clarinete (+2 semitonos escritos)
  public static readonly EB_OFFSET = 9; // Saxo Alto/Barítono (+9 semitonos escritos / -3 sonantes)
  public static readonly F_OFFSET = 7; // Corno Francés (+7 semitonos escritos)

  /**
   * Convierte una nota de tono de concierto (Concert Pitch) a tono escrito (Written Pitch)
   * que debe leer el instrumentista transpositor.
   * Ej: Banda toca en G (Concierto) -> Saxo Tenor (Bb, +2 semitonos) lee en A (Escrito).
   */
  public static toWrittenPitch(
    concertNote: NoteName,
    instrumentOffset: number,
    writtenKey?: MusicalKey
  ): NoteName {
    return TranspositionEngine.transposeNote(concertNote, instrumentOffset, writtenKey);
  }

  /**
   * Convierte una nota escrita leída por el instrumentista transpositor a su tono real sonante.
   */
  public static toConcertPitch(
    writtenNote: NoteName,
    instrumentOffset: number,
    concertKey?: MusicalKey
  ): NoteName {
    return TranspositionEngine.transposeNote(writtenNote, -instrumentOffset, concertKey);
  }
}

/**
 * Motor de cálculo de cejilla (Capo) para instrumentos de cuerda.
 *
 * Invariante de Dominio:
 * "La cejilla (Capo) modifica la estrategia de digitación y renderizado;
 * la transposición musical modifica el tono/frecuencia musical objetivo."
 */
export class CapoCalculator {
  /**
   * Calcula la forma/digitación de acorde que el guitarrista debe poner en sus dedos
   * cuando tiene un capo en 'capoFret' para que suene el 'concertChord' deseado.
   *
   * Ejemplo:
   *  - Tono deseado de concierto: G (Sol Mayor)
   *  - Capo puesto en traste 2
   *  - Digitación requerida: F (Fa Mayor) -> F + 2 semitonos = G real.
   */
  public static calculateFingeringChord(
    concertChord: Chord,
    capoFret: number,
    fingeringKeyContext?: MusicalKey
  ): Chord {
    if (!Number.isInteger(capoFret) || capoFret < 0 || capoFret > 12) {
      throw new Error(`Traste de cejilla fuera de rango válido (0 a 12): ${capoFret}`);
    }

    if (capoFret === 0) {
      return concertChord;
    }

    // La digitación es el acorde de concierto menos los semitonos del capo
    return TranspositionEngine.transposeChord(concertChord, -capoFret, fingeringKeyContext);
  }

  /**
   * Calcula el acorde de concierto que realmente suena cuando un guitarrista
   * pone la digitación 'fingeringChord' con un capo en 'capoFret'.
   *
   * Ejemplo:
   *  - Digitación: F (Fa Mayor)
   *  - Capo: 2
   *  - Acorde sonante real: G (Sol Mayor)
   */
  public static calculateSoundingChord(
    fingeringChord: Chord,
    capoFret: number,
    concertKeyContext?: MusicalKey
  ): Chord {
    if (capoFret === 0) {
      return fingeringChord;
    }

    return TranspositionEngine.transposeChord(fingeringChord, capoFret, concertKeyContext);
  }
}
