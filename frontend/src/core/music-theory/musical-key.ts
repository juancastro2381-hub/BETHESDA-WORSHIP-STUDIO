/**
 * @file musical-key.ts
 * @description Modela tonalidades mayores y menores con armadura de clave canónica,
 * cálculo de notas diatónicas únicas y relaciones de relativa/paralela.
 */

import { Accidental } from './accidental.ts';
import { KeySignature } from './key-signature.ts';
import { type BaseNoteLetter, NoteName } from './note-name.ts';
import { PitchClass } from './pitch-class.ts';
import { ScaleDegree } from './scale-degree.ts';

export type KeyMode = 'MAJOR' | 'NATURAL_MINOR';

export class MusicalKey {
  private _scaleNotesCache?: NoteName[];
  public readonly tonic: NoteName;
  public readonly mode: KeyMode;
  public readonly keySignature: KeySignature;

  public constructor(
    tonic: NoteName,
    mode: KeyMode,
    keySignature: KeySignature
  ) {
    this.tonic = tonic;
    this.mode = mode;
    this.keySignature = keySignature;
  }

  public get isMajor(): boolean {
    return this.mode === 'MAJOR';
  }

  public get isMinor(): boolean {
    return this.mode === 'NATURAL_MINOR';
  }

  /**
   * Genera las 7 notas diatónicas de la escala asegurando que cada una
   * de las 7 letras del alfabeto musical aparezca exactamente una vez.
   */
  public getScaleNotes(): NoteName[] {
    if (this._scaleNotesCache) {
      return this._scaleNotesCache;
    }

    const baseLetters: BaseNoteLetter[] = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
    const tonicIndex = baseLetters.indexOf(this.tonic.letter);

    // Semitonos relativos para cada grado
    // Mayor: 1(0), 2(2), 3(4), 4(5), 5(7), 6(9), 7(11)
    // Menor: 1(0), 2(2), 3(3), 4(5), 5(7), 6(8), 7(10)
    const formula = this.isMajor ? [0, 2, 4, 5, 7, 9, 11] : [0, 2, 3, 5, 7, 8, 10];
    const tonicPitchClassVal = this.tonic.toPitchClass().value;

    const notes: NoteName[] = [];

    for (let degreeIndex = 0; degreeIndex < 7; degreeIndex++) {
      const expectedLetter = baseLetters[(tonicIndex + degreeIndex) % 7]!;
      const expectedTargetPitchClassVal = PitchClass.normalize(
        tonicPitchClassVal + formula[degreeIndex]!
      );

      // Determinar qué alteración necesita expectedLetter para tener expectedTargetPitchClassVal
      const dummyNatural = new NoteName(expectedLetter, Accidental.NATURAL);
      const naturalPitchClassVal = dummyNatural.toPitchClass().value;

      // Desplazamiento necesario en [-2, 2]
      let offset = expectedTargetPitchClassVal - naturalPitchClassVal;
      if (offset > 6) offset -= 12;
      if (offset < -6) offset += 12;

      const accidental = Accidental.fromSemitones(offset);
      notes.push(new NoteName(expectedLetter, accidental));
    }

    this._scaleNotesCache = notes;
    return notes;
  }

  /**
   * Obtiene la nota diatónica correspondiente a un grado de escala (1 a 7).
   */
  public getNoteForDegree(degree: ScaleDegree | number): NoteName {
    const degreeNumber = typeof degree === 'number' ? degree : degree.degree;
    const index = (((degreeNumber - 1) % 7) + 7) % 7;
    const notes = this.getScaleNotes();
    const note = notes[index];
    if (!note) {
      throw new Error(`Índice de grado inválido: ${degreeNumber}`);
    }
    return note;
  }

  /**
   * Comprueba si una clase de tono pertenece a la escala diatónica de la tonalidad.
   */
  public containsPitchClass(pc: PitchClass): boolean {
    return this.getScaleNotes().some((n) => n.toPitchClass().equals(pc));
  }

  /**
   * Obtiene la tonalidad relativa:
   * Mayor -> Menor (misma armadura, tónica a 3 semitones abajo).
   * Menor -> Mayor (misma armadura, tónica a 3 semitones arriba).
   */
  public getRelativeKey(): MusicalKey {
    const scaleNotes = this.getScaleNotes();
    if (this.isMajor) {
      // Grado 6 es la tónica de la relativa menor
      const relativeTonic = scaleNotes[5]!;
      return new MusicalKey(relativeTonic, 'NATURAL_MINOR', this.keySignature);
    } else {
      // Grado 3 es la tónica de la relativa mayor
      const relativeTonic = scaleNotes[2]!;
      return new MusicalKey(relativeTonic, 'MAJOR', this.keySignature);
    }
  }

  public equals(other: MusicalKey): boolean {
    return (
      this.tonic.equals(other.tonic) &&
      this.mode === other.mode &&
      this.keySignature.equals(other.keySignature)
    );
  }

  public toString(): string {
    const modeStr = this.isMajor ? 'Mayor' : 'menor';
    return `${this.tonic.toString()} ${modeStr}`;
  }

  // Catálogo de las 30 Tonalidades Canónicas
  public static readonly C_MAJOR = new MusicalKey(NoteName.C, 'MAJOR', new KeySignature(0));
  public static readonly G_MAJOR = new MusicalKey(NoteName.G, 'MAJOR', new KeySignature(1));
  public static readonly D_MAJOR = new MusicalKey(NoteName.D, 'MAJOR', new KeySignature(2));
  public static readonly A_MAJOR = new MusicalKey(NoteName.A, 'MAJOR', new KeySignature(3));
  public static readonly E_MAJOR = new MusicalKey(NoteName.E, 'MAJOR', new KeySignature(4));
  public static readonly B_MAJOR = new MusicalKey(NoteName.B, 'MAJOR', new KeySignature(5));
  public static readonly FS_MAJOR = new MusicalKey(NoteName.FS, 'MAJOR', new KeySignature(6));
  public static readonly CS_MAJOR = new MusicalKey(NoteName.CS, 'MAJOR', new KeySignature(7));

  public static readonly F_MAJOR = new MusicalKey(NoteName.F, 'MAJOR', new KeySignature(-1));
  public static readonly BB_MAJOR = new MusicalKey(NoteName.BB, 'MAJOR', new KeySignature(-2));
  public static readonly EB_MAJOR = new MusicalKey(NoteName.EB, 'MAJOR', new KeySignature(-3));
  public static readonly AB_MAJOR = new MusicalKey(NoteName.AB, 'MAJOR', new KeySignature(-4));
  public static readonly DB_MAJOR = new MusicalKey(NoteName.DB, 'MAJOR', new KeySignature(-5));
  public static readonly GB_MAJOR = new MusicalKey(NoteName.GB, 'MAJOR', new KeySignature(-6));
  public static readonly CB_MAJOR = new MusicalKey(new NoteName('C', Accidental.FLAT), 'MAJOR', new KeySignature(-7));

  public static readonly A_MINOR = new MusicalKey(NoteName.A, 'NATURAL_MINOR', new KeySignature(0));
  public static readonly E_MINOR = new MusicalKey(NoteName.E, 'NATURAL_MINOR', new KeySignature(1));
  public static readonly B_MINOR = new MusicalKey(NoteName.B, 'NATURAL_MINOR', new KeySignature(2));
  public static readonly FS_MINOR = new MusicalKey(NoteName.FS, 'NATURAL_MINOR', new KeySignature(3));
  public static readonly CS_MINOR = new MusicalKey(NoteName.CS, 'NATURAL_MINOR', new KeySignature(4));
  public static readonly GS_MINOR = new MusicalKey(NoteName.GS, 'NATURAL_MINOR', new KeySignature(5));
  public static readonly DS_MINOR = new MusicalKey(NoteName.DS, 'NATURAL_MINOR', new KeySignature(6));
  public static readonly AS_MINOR = new MusicalKey(NoteName.AS, 'NATURAL_MINOR', new KeySignature(7));

  public static readonly D_MINOR = new MusicalKey(NoteName.D, 'NATURAL_MINOR', new KeySignature(-1));
  public static readonly G_MINOR = new MusicalKey(NoteName.G, 'NATURAL_MINOR', new KeySignature(-2));
  public static readonly C_MINOR = new MusicalKey(NoteName.C, 'NATURAL_MINOR', new KeySignature(-3));
  public static readonly F_MINOR = new MusicalKey(NoteName.F, 'NATURAL_MINOR', new KeySignature(-4));
  public static readonly BB_MINOR = new MusicalKey(NoteName.BB, 'NATURAL_MINOR', new KeySignature(-5));
  public static readonly EB_MINOR = new MusicalKey(NoteName.EB, 'NATURAL_MINOR', new KeySignature(-6));
  public static readonly AB_MINOR = new MusicalKey(NoteName.AB, 'NATURAL_MINOR', new KeySignature(-7));

  public static readonly ALL_CANONICAL_KEYS: MusicalKey[] = [
    MusicalKey.C_MAJOR,
    MusicalKey.G_MAJOR,
    MusicalKey.D_MAJOR,
    MusicalKey.A_MAJOR,
    MusicalKey.E_MAJOR,
    MusicalKey.B_MAJOR,
    MusicalKey.FS_MAJOR,
    MusicalKey.CS_MAJOR,
    MusicalKey.F_MAJOR,
    MusicalKey.BB_MAJOR,
    MusicalKey.EB_MAJOR,
    MusicalKey.AB_MAJOR,
    MusicalKey.DB_MAJOR,
    MusicalKey.GB_MAJOR,
    MusicalKey.CB_MAJOR,
    MusicalKey.A_MINOR,
    MusicalKey.E_MINOR,
    MusicalKey.B_MINOR,
    MusicalKey.FS_MINOR,
    MusicalKey.CS_MINOR,
    MusicalKey.GS_MINOR,
    MusicalKey.DS_MINOR,
    MusicalKey.AS_MINOR,
    MusicalKey.D_MINOR,
    MusicalKey.G_MINOR,
    MusicalKey.C_MINOR,
    MusicalKey.F_MINOR,
    MusicalKey.BB_MINOR,
    MusicalKey.EB_MINOR,
    MusicalKey.AB_MINOR,
  ];

  /**
   * Parsea cadenas como "G", "G Major", "Sol Mayor", "Em", "E minor", "Mi menor", "F#", "Bb".
   */
  public static parse(keyStr: string): MusicalKey {
    const trimmed = keyStr.trim();
    if (!trimmed) {
      throw new Error('Cadena de tonalidad vacía');
    }

    let isMinor = false;
    let cleanNoteStr = trimmed;

    if (
      trimmed.toLowerCase().includes('minor') ||
      trimmed.toLowerCase().includes('menor') ||
      trimmed.endsWith('m')
    ) {
      isMinor = true;
      cleanNoteStr = trimmed
        .replace(/minor/i, '')
        .replace(/menor/i, '')
        .replace(/m$/, '')
        .trim();
    } else if (trimmed.toLowerCase().includes('major') || trimmed.toLowerCase().includes('mayor')) {
      cleanNoteStr = trimmed
        .replace(/major/i, '')
        .replace(/mayor/i, '')
        .trim();
    }

    const tonic = NoteName.parse(cleanNoteStr);
    const targetMode: KeyMode = isMinor ? 'NATURAL_MINOR' : 'MAJOR';

    const match = MusicalKey.ALL_CANONICAL_KEYS.find(
      (k) => k.tonic.equals(tonic) && k.mode === targetMode
    );

    if (match) {
      return match;
    }

    throw new Error(`Tonalidad no reconocida o no estándar: "${keyStr}"`);
  }
}
