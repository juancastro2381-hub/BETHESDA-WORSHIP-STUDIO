/**
 * @file key-signature.ts
 * @description Modela la armadura de clave y el Círculo de Quintas con conteo exacto
 * de sostenidos (+1 a +7) y bemoles (-1 a -7), determinando las alteraciones fijas.
 */

import { Accidental } from './accidental.ts';
import { type BaseNoteLetter, NoteName } from './note-name.ts';

export const SHARP_ORDER: BaseNoteLetter[] = ['F', 'C', 'G', 'D', 'A', 'E', 'B'];
export const FLAT_ORDER: BaseNoteLetter[] = ['B', 'E', 'A', 'D', 'G', 'C', 'F'];

export class KeySignature {
  /**
   * Conteo de alteraciones:
   *  0 = Ninguna (Do Mayor / La menor)
   * +1 a +7 = Sostenidos (Fa#, Do#, Sol#, Re#, La#, Mi#, Si#)
   * -1 a -7 = Bemoles (Sib, Mib, Lab, Reb, Solb, Dob, Fab)
   */
  public readonly accidentalCount: number;

  public constructor(accidentalCount: number) {
    if (!Number.isInteger(accidentalCount) || accidentalCount < -7 || accidentalCount > 7) {
      throw new Error(`Conteo de armadura no válido (-7 a +7): ${accidentalCount}`);
    }
    this.accidentalCount = accidentalCount;
  }

  public get isSharp(): boolean {
    return this.accidentalCount > 0;
  }

  public get isFlat(): boolean {
    return this.accidentalCount < 0;
  }

  public get isNeutral(): boolean {
    return this.accidentalCount === 0;
  }

  /**
   * Obtiene la alteración fija que le corresponde a una letra dada en esta armadura.
   */
  public getAccidentalForLetter(letter: BaseNoteLetter): Accidental {
    if (this.isSharp) {
      const index = SHARP_ORDER.indexOf(letter);
      if (index >= 0 && index < this.accidentalCount) {
        return Accidental.SHARP;
      }
    } else if (this.isFlat) {
      const index = FLAT_ORDER.indexOf(letter);
      if (index >= 0 && index < Math.abs(this.accidentalCount)) {
        return Accidental.FLAT;
      }
    }
    return Accidental.NATURAL;
  }

  /**
   * Devuelve la lista ordenada de notas alteradas en la armadura.
   */
  public getAlteredNotes(): NoteName[] {
    if (this.isSharp) {
      return SHARP_ORDER.slice(0, this.accidentalCount).map(
        (letter) => new NoteName(letter, Accidental.SHARP)
      );
    }
    if (this.isFlat) {
      return FLAT_ORDER.slice(0, Math.abs(this.accidentalCount)).map(
        (letter) => new NoteName(letter, Accidental.FLAT)
      );
    }
    return [];
  }

  public equals(other: KeySignature): boolean {
    return this.accidentalCount === other.accidentalCount;
  }

  public toString(): string {
    if (this.isNeutral) return 'KeySignature(0 alteraciones)';
    if (this.isSharp) return `KeySignature(+${this.accidentalCount} sostenidos)`;
    return `KeySignature(${this.accidentalCount} bemoles)`;
  }
}
