/**
 * @file time-signature.ts
 * @description Modela la métrica musical (TimeSignature), cálculo determinista
 * de duración de compás en ticks (480 TPQN) y soporte para métricas variables y compuestas.
 */

import { CANONICAL_TPQN } from './types.ts';

export interface TimeSignatureJSON {
  numerator: number;
  denominator: number;
}

export class TimeSignature {
  public static readonly FOUR_FOUR = new TimeSignature(4, 4);
  public static readonly THREE_FOUR = new TimeSignature(3, 4);
  public static readonly TWO_FOUR = new TimeSignature(2, 4);
  public static readonly SIX_EIGHT = new TimeSignature(6, 8);
  public static readonly NINE_EIGHT = new TimeSignature(9, 8);
  public static readonly TWELVE_EIGHT = new TimeSignature(12, 8);
  public static readonly FIVE_FOUR = new TimeSignature(5, 4);
  public static readonly SEVEN_EIGHT = new TimeSignature(7, 8);

  public readonly numerator: number;
  public readonly denominator: number;

  public constructor(numerator: number, denominator: number) {
    if (!Number.isInteger(numerator) || numerator <= 0) {
      throw new Error(`Numerador de compás inválido: ${numerator}. Debe ser un entero positivo.`);
    }

    // El denominador debe ser potencia de 2 (1, 2, 4, 8, 16, 32, 64)
    const validDenominators = [1, 2, 4, 8, 16, 32, 64];
    if (!validDenominators.includes(denominator)) {
      throw new Error(
        `Denominador de compás inválido: ${denominator}. Debe ser potencia de 2 (ej. 2, 4, 8, 16).`
      );
    }

    this.numerator = numerator;
    this.denominator = denominator;
  }

  /**
   * Calcula la duración total del compás en ticks canónicos (480 TPQN).
   * Fórmula: (numerador * (480 * 4)) / denominador
   *
   * Ejemplos:
   *  - 4/4: (4 * 1920) / 4 = 1920 ticks
   *  - 3/4: (3 * 1920) / 4 = 1440 ticks
   *  - 6/8: (6 * 1920) / 8 = 1440 ticks
   *  - 2/4: (2 * 1920) / 4 = 960 ticks
   *  - 7/8: (7 * 1920) / 8 = 1680 ticks
   */
  public calculateMeasureDurationTicks(): number {
    const wholeNoteTicks = CANONICAL_TPQN * 4; // 1920
    const ticks = (this.numerator * wholeNoteTicks) / this.denominator;
    if (!Number.isInteger(ticks)) {
      throw new Error(
        `La métrica ${this.numerator}/${this.denominator} no produce un número entero de ticks a ${CANONICAL_TPQN} TPQN.`
      );
    }
    return ticks;
  }

  /**
   * Indica si es una métrica compuesta (denominador 8 y numerador múltiplo de 3: 6/8, 9/8, 12/8).
   */
  public get isCompound(): boolean {
    return this.denominator === 8 && this.numerator % 3 === 0 && this.numerator >= 6;
  }

  /**
   * Duración en ticks del pulso principal (beat).
   * En compases simples de negra (ej. 4/4, 3/4): 480 ticks.
   * En compases compuestos de corchea (ej. 6/8, 9/8): pulso de negra con puntillo = 720 ticks.
   */
  public get beatDurationTicks(): number {
    if (this.isCompound) {
      return CANONICAL_TPQN + CANONICAL_TPQN / 2; // 720 ticks (negra con puntillo)
    }
    return (CANONICAL_TPQN * 4) / this.denominator;
  }

  /**
   * Número de pulsos primarios por compás.
   * Ej: 4/4 -> 4 pulsos. 6/8 -> 2 pulsos (de negra con puntillo).
   */
  public get primaryBeatsPerMeasure(): number {
    if (this.isCompound) {
      return this.numerator / 3;
    }
    return this.numerator;
  }

  public equals(other: TimeSignature): boolean {
    return this.numerator === other.numerator && this.denominator === other.denominator;
  }

  public toString(): string {
    return `${this.numerator}/${this.denominator}`;
  }

  public toJSON(): TimeSignatureJSON {
    return {
      numerator: this.numerator,
      denominator: this.denominator,
    };
  }

  public static fromJSON(json: TimeSignatureJSON): TimeSignature {
    return new TimeSignature(json.numerator, json.denominator);
  }

  public static parse(text: string): TimeSignature {
    const parts = text.trim().split('/');
    if (parts.length !== 2) {
      throw new Error(`Formato de métrica inválido: "${text}". Formato esperado: "4/4", "6/8".`);
    }
    const num = parseInt(parts[0] ?? '', 10);
    const den = parseInt(parts[1] ?? '', 10);
    return new TimeSignature(num, den);
  }
}
