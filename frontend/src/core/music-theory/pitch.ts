/**
 * @file pitch.ts
 * @description Modela la altura absoluta de una nota en un registro específico (octava),
 * con conversión a número de nota MIDI y frecuencia acústica en Hertz.
 */

import { NoteName } from './note-name.ts';
import { PitchClass } from './pitch-class.ts';

export class Pitch {
  public static readonly MIDDLE_C = new Pitch(NoteName.C, 4); // C4 = MIDI 60
  public static readonly CONCERT_A4 = new Pitch(NoteName.A, 4); // A4 = MIDI 69 = 440 Hz

  public readonly noteName: NoteName;
  public readonly octave: number;

  public constructor(
    noteName: NoteName,
    octave: number
  ) {
    if (!Number.isInteger(octave) || octave < -2 || octave > 10) {
      throw new Error(`Octava fuera de rango físico razonable (-2 a 10): ${octave}`);
    }
    this.noteName = noteName;
    this.octave = octave;
  }

  public get pitchClass(): PitchClass {
    return this.noteName.toPitchClass();
  }

  /**
   * Número de nota MIDI estándar (C-1 = 0, C4 = 60, A4 = 69, G9 = 127).
   */
  public get midiNumber(): number {
    return (this.octave + 1) * 12 + this.pitchClass.value;
  }

  /**
   * Frecuencia fundamental en Hertz según afinación estándar A4 = 440 Hz (temperamento igual).
   */
  public get frequencyHz(): number {
    return 440 * Math.pow(2, (this.midiNumber - 69) / 12);
  }

  /**
   * Parsea cadenas de altura absoluta como "C4", "F#3", "Bb2", "A4".
   */
  public static parse(pitchStr: string): Pitch {
    const trimmed = pitchStr.trim();
    // Extraer dígitos finales correspondientes a la octava (soporta octavas negativas)
    const match = trimmed.match(/^(.+?)(-?\d+)$/);
    if (!match || !match[1] || !match[2]) {
      throw new Error(`Formato de tono absoluto inválido (se esperaba Nota+Octava, ej. "C4"): "${pitchStr}"`);
    }

    const notePart = match[1];
    const octavePart = parseInt(match[2], 10);
    const noteName = NoteName.parse(notePart);

    return new Pitch(noteName, octavePart);
  }

  public equals(other: Pitch): boolean {
    return this.noteName.equals(other.noteName) && this.octave === other.octave;
  }

  public isEnharmonicallyEquivalent(other: Pitch): boolean {
    return this.midiNumber === other.midiNumber;
  }

  public toString(format: 'STANDARD' | 'LATIN' | 'UNICODE' = 'STANDARD'): string {
    return `${this.noteName.toString(format)}${this.octave}`;
  }
}
