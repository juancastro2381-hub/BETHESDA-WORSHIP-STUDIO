/**
 * @file enharmonic-spelling.ts
 * @description Motor de ortografía enarmónica contextual basado en el Círculo de Quintas
 * y la tonalidad activa. Garantiza que en Fa Mayor jamás se emita La# en lugar de Sib.
 */

import { Accidental } from './accidental.ts';
import { MusicalKey } from './musical-key.ts';
import { type BaseNoteLetter, NoteName } from './note-name.ts';
import { PitchClass } from './pitch-class.ts';

export interface SpellingOptions {
  preferSharp?: boolean;
  direction?: 'ASCENDING' | 'DESCENDING';
}

export class EnharmonicSpelling {
  /**
   * Proyecta una clase de tono (0–11) en un NoteName exacto respetando la tonalidad dada.
   */
  public static spell(pc: PitchClass, key: MusicalKey, options?: SpellingOptions): NoteName {
    // 1. Si la clase de tono pertenece a las notas diatónicas de la tonalidad,
    // devolver la ortografía canónica exacta.
    const diatonicNotes = key.getScaleNotes();
    const diatonicMatch = diatonicNotes.find((n) => n.toPitchClass().equals(pc));
    if (diatonicMatch) {
      return diatonicMatch;
    }

    // 2. Si es una nota cromática (fuera de la escala), resolver según el sesgo de la armadura
    const isFlatKey = key.keySignature.isFlat;
    const isSharpKey = key.keySignature.isSharp;

    // Preferencia explícita o sesgo natural de la tonalidad
    let useSharp = false;
    if (options?.preferSharp !== undefined) {
      useSharp = options.preferSharp;
    } else if (options?.direction === 'ASCENDING') {
      useSharp = true;
    } else if (options?.direction === 'DESCENDING') {
      useSharp = false;
    } else if (isSharpKey) {
      useSharp = true;
    } else if (isFlatKey) {
      useSharp = false;
    } else {
      // Tonalidad neutra (Do Mayor / La menor):
      // Convención estándar de notas cromáticas: C#, Eb, F#, Ab, Bb
      const standardNeutralSharps = [1, 6]; // C#, F#
      useSharp = standardNeutralSharps.includes(pc.value);
    }

    return EnharmonicSpelling.spellGeneric(pc, useSharp);
  }

  /**
   * Resuelve ortografía genérica según preferencia de sostenido o bemol.
   */
  public static spellGeneric(pc: PitchClass, preferSharp: boolean): NoteName {
    const val = pc.value;

    switch (val) {
      case 0:
        return NoteName.C;
      case 1:
        return preferSharp
          ? new NoteName('C', Accidental.SHARP)
          : new NoteName('D', Accidental.FLAT);
      case 2:
        return NoteName.D;
      case 3:
        return preferSharp
          ? new NoteName('D', Accidental.SHARP)
          : new NoteName('E', Accidental.FLAT);
      case 4:
        return NoteName.E;
      case 5:
        return NoteName.F;
      case 6:
        return preferSharp
          ? new NoteName('F', Accidental.SHARP)
          : new NoteName('G', Accidental.FLAT);
      case 7:
        return NoteName.G;
      case 8:
        return preferSharp
          ? new NoteName('G', Accidental.SHARP)
          : new NoteName('A', Accidental.FLAT);
      case 9:
        return NoteName.A;
      case 10:
        return preferSharp
          ? new NoteName('A', Accidental.SHARP)
          : new NoteName('B', Accidental.FLAT);
      case 11:
        return NoteName.B;
      default:
        throw new Error(`PitchClass inválido: ${val}`);
    }
  }

  /**
   * Simplifica notas con dobles alteraciones o alteraciones teóricas infrecuentes
   * cuando no son requeridas por la armadura (ej. B# -> C, E# -> F, Cb -> B, Fb -> E).
   */
  public static simplify(note: NoteName): NoteName {
    // Si tiene doble sostenido o doble bemol, simplificar a natural
    if (note.accidental.equals(Accidental.DOUBLE_SHARP)) {
      return EnharmonicSpelling.spellGeneric(note.toPitchClass(), true);
    }
    if (note.accidental.equals(Accidental.DOUBLE_FLAT)) {
      return EnharmonicSpelling.spellGeneric(note.toPitchClass(), false);
    }

    // Simplificar notas como B# o Cb a sus equivalentes naturales directos
    if (note.letter === 'B' && note.accidental.equals(Accidental.SHARP)) {
      return NoteName.C;
    }
    if (note.letter === 'E' && note.accidental.equals(Accidental.SHARP)) {
      return NoteName.F;
    }
    if (note.letter === 'C' && note.accidental.equals(Accidental.FLAT)) {
      return NoteName.B;
    }
    if (note.letter === 'F' && note.accidental.equals(Accidental.FLAT)) {
      return NoteName.E;
    }

    return note;
  }
}
