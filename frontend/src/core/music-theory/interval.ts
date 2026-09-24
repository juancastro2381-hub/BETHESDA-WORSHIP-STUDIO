/**
 * @file interval.ts
 * @description Modela intervalos musicales distinguiendo formalmente la distancia diatónica
 * de la distancia cromática en semitonos y la cualidad interválica (justo, mayor, menor, etc.).
 */

import { NoteName } from './note-name.ts';

export type IntervalQuality =
  | 'PERFECT'
  | 'MAJOR'
  | 'MINOR'
  | 'DIMINISHED'
  | 'AUGMENTED';

export class Interval {
  public readonly diatonicSteps: number; // 0 = unísono, 1 = segunda, 2 = tercera, etc.
  public readonly semitones: number;
  public readonly quality: IntervalQuality;
  public readonly number: number; // 1 = primera, 2 = segunda, ..., 8 = octava

  public constructor(
    diatonicSteps: number,
    semitones: number,
    quality: IntervalQuality,
    number: number
  ) {
    this.diatonicSteps = diatonicSteps;
    this.semitones = semitones;
    this.quality = quality;
    this.number = number;
  }

  // Intervalos Canónicos Estándar
  public static readonly UNISON = new Interval(0, 0, 'PERFECT', 1);
  public static readonly MINOR_SECOND = new Interval(1, 1, 'MINOR', 2);
  public static readonly MAJOR_SECOND = new Interval(1, 2, 'MAJOR', 2);
  public static readonly AUGMENTED_SECOND = new Interval(1, 3, 'AUGMENTED', 2);
  public static readonly MINOR_THIRD = new Interval(2, 3, 'MINOR', 3);
  public static readonly MAJOR_THIRD = new Interval(2, 4, 'MAJOR', 3);
  public static readonly PERFECT_FOURTH = new Interval(3, 5, 'PERFECT', 4);
  public static readonly AUGMENTED_FOURTH = new Interval(3, 6, 'AUGMENTED', 4);
  public static readonly DIMINISHED_FIFTH = new Interval(4, 6, 'DIMINISHED', 5);
  public static readonly PERFECT_FIFTH = new Interval(4, 7, 'PERFECT', 5);
  public static readonly AUGMENTED_FIFTH = new Interval(4, 8, 'AUGMENTED', 5);
  public static readonly MINOR_SIXTH = new Interval(5, 8, 'MINOR', 6);
  public static readonly MAJOR_SIXTH = new Interval(5, 9, 'MAJOR', 6);
  public static readonly DIMINISHED_SEVENTH = new Interval(6, 9, 'DIMINISHED', 7);
  public static readonly MINOR_SEVENTH = new Interval(6, 10, 'MINOR', 7);
  public static readonly MAJOR_SEVENTH = new Interval(6, 11, 'MAJOR', 7);
  public static readonly OCTAVE = new Interval(7, 12, 'PERFECT', 8);

  /**
   * Alias de Tritono (6 semitonos).
   */
  public static readonly TRITONE = Interval.AUGMENTED_FOURTH;

  /**
   * Invierte el intervalo musical (ej. 3ra Mayor -> 6ta Menor, 5ta Justa -> 4ta Justa).
   */
  public invert(): Interval {
    const newNumber = 9 - (this.number % 7 || 7);
    const newSteps = (7 - (this.diatonicSteps % 7)) % 7;
    const newSemitones = (12 - (this.semitones % 12)) % 12;

    let newQuality: IntervalQuality;
    switch (this.quality) {
      case 'PERFECT':
        newQuality = 'PERFECT';
        break;
      case 'MAJOR':
        newQuality = 'MINOR';
        break;
      case 'MINOR':
        newQuality = 'MAJOR';
        break;
      case 'AUGMENTED':
        newQuality = 'DIMINISHED';
        break;
      case 'DIMINISHED':
        newQuality = 'AUGMENTED';
        break;
    }

    return new Interval(newSteps, newSemitones, newQuality, newNumber);
  }

  /**
   * Calcula el intervalo exacto entre dos notas diatónicas.
   */
  public static between(from: NoteName, to: NoteName): Interval {
    const diatonicSteps = (to.diatonicStep - from.diatonicStep + 7) % 7;
    const intervalNumber = diatonicSteps + 1;

    // Distancia cromática real ascendente entre las notas
    const semitones = (to.toPitchClass().value - from.toPitchClass().value + 12) % 12;

    const quality = Interval.determineQuality(intervalNumber, semitones);
    return new Interval(diatonicSteps, semitones, quality, intervalNumber);
  }

  private static determineQuality(intervalNumber: number, semitones: number): IntervalQuality {
    // Clasificación según tipo de intervalo (justos: 1, 4, 5, 8 vs mayores/menores: 2, 3, 6, 7)
    const isPerfectType = [1, 4, 5, 8].includes(intervalNumber);

    if (isPerfectType) {
      const standardSemitones: Record<number, number> = { 1: 0, 4: 5, 5: 7, 8: 12 };
      const standard = standardSemitones[intervalNumber] ?? 0;
      const diff = semitones - standard;
      if (diff === 0) return 'PERFECT';
      if (diff === 1) return 'AUGMENTED';
      if (diff === -1) return 'DIMINISHED';
      return diff > 1 ? 'AUGMENTED' : 'DIMINISHED';
    } else {
      // 2, 3, 6, 7
      const majorSemitones: Record<number, number> = { 2: 2, 3: 4, 6: 9, 7: 11 };
      const standardMajor = majorSemitones[intervalNumber] ?? 0;
      const diff = semitones - standardMajor;
      if (diff === 0) return 'MAJOR';
      if (diff === -1) return 'MINOR';
      if (diff === 1) return 'AUGMENTED';
      if (diff === -2) return 'DIMINISHED';
      return diff > 1 ? 'AUGMENTED' : 'DIMINISHED';
    }
  }

  public equals(other: Interval): boolean {
    return (
      this.diatonicSteps === other.diatonicSteps &&
      this.semitones === other.semitones &&
      this.quality === other.quality &&
      this.number === other.number
    );
  }

  public toString(): string {
    const qualityPrefix: Record<IntervalQuality, string> = {
      PERFECT: 'P',
      MAJOR: 'M',
      MINOR: 'm',
      DIMINISHED: 'd',
      AUGMENTED: 'A',
    };
    return `${qualityPrefix[this.quality]}${this.number} (${this.semitones}st)`;
  }
}
