/**
 * @file accidental.ts
 * @description Modela las alteraciones musicales (sostenidos, bemoles, becuadros y dobles alteraciones)
 * con cálculo exacto de desplazamientos cromáticos en semitonos.
 */

export type AccidentalType =
  | 'DOUBLE_FLAT'
  | 'FLAT'
  | 'NATURAL'
  | 'SHARP'
  | 'DOUBLE_SHARP';

export type StandardAccidentalSymbol = 'bb' | 'b' | '' | '#' | '##';
export type UnicodeAccidentalSymbol = '𝄫' | '♭' | '♮' | '♯' | '𝄪';

export interface AccidentalProperties {
  readonly type: AccidentalType;
  readonly semitoneOffset: number;
  readonly standardSymbol: StandardAccidentalSymbol;
  readonly unicodeSymbol: UnicodeAccidentalSymbol;
}

const ACCIDENTAL_DATA: Record<AccidentalType, AccidentalProperties> = {
  DOUBLE_FLAT: {
    type: 'DOUBLE_FLAT',
    semitoneOffset: -2,
    standardSymbol: 'bb',
    unicodeSymbol: '𝄫',
  },
  FLAT: {
    type: 'FLAT',
    semitoneOffset: -1,
    standardSymbol: 'b',
    unicodeSymbol: '♭',
  },
  NATURAL: {
    type: 'NATURAL',
    semitoneOffset: 0,
    standardSymbol: '',
    unicodeSymbol: '♮',
  },
  SHARP: {
    type: 'SHARP',
    semitoneOffset: 1,
    standardSymbol: '#',
    unicodeSymbol: '♯',
  },
  DOUBLE_SHARP: {
    type: 'DOUBLE_SHARP',
    semitoneOffset: 2,
    standardSymbol: '##',
    unicodeSymbol: '𝄪',
  },
};

export class Accidental {
  public static readonly DOUBLE_FLAT = new Accidental('DOUBLE_FLAT');
  public static readonly FLAT = new Accidental('FLAT');
  public static readonly NATURAL = new Accidental('NATURAL');
  public static readonly SHARP = new Accidental('SHARP');
  public static readonly DOUBLE_SHARP = new Accidental('DOUBLE_SHARP');

  public readonly type: AccidentalType;

  private constructor(type: AccidentalType) {
    this.type = type;
  }

  public get semitoneOffset(): number {
    return ACCIDENTAL_DATA[this.type].semitoneOffset;
  }

  public get standardSymbol(): StandardAccidentalSymbol {
    return ACCIDENTAL_DATA[this.type].standardSymbol;
  }

  public get unicodeSymbol(): UnicodeAccidentalSymbol {
    return ACCIDENTAL_DATA[this.type].unicodeSymbol;
  }

  public static fromSemitones(offset: number): Accidental {
    switch (offset) {
      case -2:
        return Accidental.DOUBLE_FLAT;
      case -1:
        return Accidental.FLAT;
      case 0:
        return Accidental.NATURAL;
      case 1:
        return Accidental.SHARP;
      case 2:
        return Accidental.DOUBLE_SHARP;
      default:
        throw new Error(`Desplazamiento de alteración no soportado: ${offset} semitonos`);
    }
  }

  public static parse(symbol: string): Accidental {
    const trimmed = symbol.trim();
    if (trimmed === '' || trimmed === '♮' || trimmed.toLowerCase() === 'natural') {
      return Accidental.NATURAL;
    }
    if (trimmed === '#' || trimmed === '♯' || trimmed.toLowerCase() === 'sharp') {
      return Accidental.SHARP;
    }
    if (trimmed === '##' || trimmed === '𝄪' || trimmed === 'x') {
      return Accidental.DOUBLE_SHARP;
    }
    if (trimmed === 'b' || trimmed === '♭' || trimmed.toLowerCase() === 'flat') {
      return Accidental.FLAT;
    }
    if (trimmed === 'bb' || trimmed === '𝄫') {
      return Accidental.DOUBLE_FLAT;
    }
    throw new Error(`Símbolo de alteración musical no reconocido: "${symbol}"`);
  }

  public equals(other: Accidental): boolean {
    return this.type === other.type;
  }

  public toString(useUnicode = false): string {
    return useUnicode ? this.unicodeSymbol : this.standardSymbol;
  }
}
