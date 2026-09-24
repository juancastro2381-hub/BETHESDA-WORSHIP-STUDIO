/**
 * @file note-name.ts
 * @description Modela nombres de notas con distinción explícita entre letra base y alteración,
 * diferenciando la identidad ortográfica (ej. C# vs Db) de su equivalencia enarmónica.
 */

import { Accidental } from './accidental.ts';
import { PitchClass } from './pitch-class.ts';

export type BaseNoteLetter = 'C' | 'D' | 'E' | 'F' | 'G' | 'A' | 'B';

export interface NoteNameProperties {
  readonly diatonicStep: number;
  readonly naturalSemitones: number;
  readonly latinName: string;
}

const BASE_NOTE_DATA: Record<BaseNoteLetter, NoteNameProperties> = {
  C: { diatonicStep: 0, naturalSemitones: 0, latinName: 'Do' },
  D: { diatonicStep: 1, naturalSemitones: 2, latinName: 'Re' },
  E: { diatonicStep: 2, naturalSemitones: 4, latinName: 'Mi' },
  F: { diatonicStep: 3, naturalSemitones: 5, latinName: 'Fa' },
  G: { diatonicStep: 4, naturalSemitones: 7, latinName: 'Sol' },
  A: { diatonicStep: 5, naturalSemitones: 9, latinName: 'La' },
  B: { diatonicStep: 6, naturalSemitones: 11, latinName: 'Si' },
};

const LATIN_TO_LETTER: Record<string, BaseNoteLetter> = {
  do: 'C',
  re: 'D',
  mi: 'E',
  fa: 'F',
  sol: 'G',
  la: 'A',
  si: 'B',
};

export class NoteName {
  // Constantes comunes inmutables
  public static readonly C = new NoteName('C', Accidental.NATURAL);
  public static readonly CS = new NoteName('C', Accidental.SHARP);
  public static readonly DB = new NoteName('D', Accidental.FLAT);
  public static readonly D = new NoteName('D', Accidental.NATURAL);
  public static readonly DS = new NoteName('D', Accidental.SHARP);
  public static readonly EB = new NoteName('E', Accidental.FLAT);
  public static readonly E = new NoteName('E', Accidental.NATURAL);
  public static readonly F = new NoteName('F', Accidental.NATURAL);
  public static readonly FS = new NoteName('F', Accidental.SHARP);
  public static readonly GB = new NoteName('G', Accidental.FLAT);
  public static readonly G = new NoteName('G', Accidental.NATURAL);
  public static readonly GS = new NoteName('G', Accidental.SHARP);
  public static readonly AB = new NoteName('A', Accidental.FLAT);
  public static readonly A = new NoteName('A', Accidental.NATURAL);
  public static readonly AS = new NoteName('A', Accidental.SHARP);
  public static readonly BB = new NoteName('B', Accidental.FLAT);
  public static readonly B = new NoteName('B', Accidental.NATURAL);

  public readonly letter: BaseNoteLetter;
  public readonly accidental: Accidental;

  public constructor(
    letter: BaseNoteLetter,
    accidental: Accidental = Accidental.NATURAL
  ) {
    this.letter = letter;
    this.accidental = accidental;
  }

  public get diatonicStep(): number {
    return BASE_NOTE_DATA[this.letter].diatonicStep;
  }

  public get naturalSemitones(): number {
    return BASE_NOTE_DATA[this.letter].naturalSemitones;
  }

  public get latinBaseName(): string {
    return BASE_NOTE_DATA[this.letter].latinName;
  }

  /**
   * Proyecta el nombre ortográfico a su clase de tono canónica (0–11).
   */
  public toPitchClass(): PitchClass {
    const rawSemitones = this.naturalSemitones + this.accidental.semitoneOffset;
    return PitchClass.from(rawSemitones);
  }

  /**
   * Compara igualdad estricta ortográfica (ej. C# !== Db).
   */
  public equals(other: NoteName): boolean {
    return this.letter === other.letter && this.accidental.equals(other.accidental);
  }

  /**
   * Compara equivalencia enarmónica sonora (ej. C# y Db suenan igual).
   */
  public isEnharmonicallyEquivalent(other: NoteName): boolean {
    return this.toPitchClass().equals(other.toPitchClass());
  }

  /**
   * Parsea cadenas estándar o latinas con alteraciones ('C#', 'Bb', 'Sol', 'Fa#', 'Ebb').
   */
  public static parse(noteStr: string): NoteName {
    const trimmed = noteStr.trim();
    if (!trimmed) {
      throw new Error('Cadena vacía no válida como NoteName');
    }

    // Comprobar si comienza con notación latina (Do, Re, Mi, Fa, Sol, La, Si)
    const lower = trimmed.toLowerCase();
    for (const [latin, letter] of Object.entries(LATIN_TO_LETTER)) {
      if (lower.startsWith(latin)) {
        const accidentalPart = trimmed.slice(latin.length);
        const accidental = accidentalPart ? Accidental.parse(accidentalPart) : Accidental.NATURAL;
        return new NoteName(letter, accidental);
      }
    }

    // Notación estándar anglosajona (A-G)
    const firstChar = trimmed[0]?.toUpperCase();
    if (!firstChar || !['C', 'D', 'E', 'F', 'G', 'A', 'B'].includes(firstChar)) {
      throw new Error(`Letra base de nota no válida: "${trimmed}"`);
    }

    const letter = firstChar as BaseNoteLetter;
    const accidentalPart = trimmed.slice(1);
    const accidental = accidentalPart ? Accidental.parse(accidentalPart) : Accidental.NATURAL;

    return new NoteName(letter, accidental);
  }

  public toString(format: 'STANDARD' | 'LATIN' | 'UNICODE' = 'STANDARD'): string {
    const accStr =
      format === 'UNICODE'
        ? this.accidental.unicodeSymbol
        : this.accidental.standardSymbol;

    if (format === 'LATIN') {
      return `${this.latinBaseName}${accStr}`;
    }
    return `${this.letter}${accStr}`;
  }
}
