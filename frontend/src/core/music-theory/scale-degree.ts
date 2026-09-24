/**
 * @file scale-degree.ts
 * @description Modela los grados de la escala diatónica (1 al 7),
 * nombres funcionales tradicionales y números romanos asociados.
 */

export type ScaleDegreeNumber = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export type ScaleDegreeName =
  | 'TONIC'
  | 'SUPERTONIC'
  | 'MEDIANT'
  | 'SUBDOMINANT'
  | 'DOMINANT'
  | 'SUBMEDIANT'
  | 'LEADING_TONE';

export class ScaleDegree {
  public static readonly TONIC = new ScaleDegree(1, 'TONIC', 'I', 'i');
  public static readonly SUPERTONIC = new ScaleDegree(2, 'SUPERTONIC', 'II', 'ii');
  public static readonly MEDIANT = new ScaleDegree(3, 'MEDIANT', 'III', 'iii');
  public static readonly SUBDOMINANT = new ScaleDegree(4, 'SUBDOMINANT', 'IV', 'iv');
  public static readonly DOMINANT = new ScaleDegree(5, 'DOMINANT', 'V', 'v');
  public static readonly SUBMEDIANT = new ScaleDegree(6, 'SUBMEDIANT', 'VI', 'vi');
  public static readonly LEADING_TONE = new ScaleDegree(7, 'LEADING_TONE', 'VII', 'vii');

  private static readonly DEGREES: ScaleDegree[] = [
    ScaleDegree.TONIC,
    ScaleDegree.SUPERTONIC,
    ScaleDegree.MEDIANT,
    ScaleDegree.SUBDOMINANT,
    ScaleDegree.DOMINANT,
    ScaleDegree.SUBMEDIANT,
    ScaleDegree.LEADING_TONE,
  ];

  public readonly degree: ScaleDegreeNumber;
  public readonly functionalName: ScaleDegreeName;
  public readonly romanMajor: string;
  public readonly romanMinor: string;

  private constructor(
    degree: ScaleDegreeNumber,
    functionalName: ScaleDegreeName,
    romanMajor: string,
    romanMinor: string
  ) {
    this.degree = degree;
    this.functionalName = functionalName;
    this.romanMajor = romanMajor;
    this.romanMinor = romanMinor;
  }

  public static fromNumber(degree: number): ScaleDegree {
    const norm = (((degree - 1) % 7) + 7) % 7; // 0 a 6
    const instance = ScaleDegree.DEGREES[norm];
    if (!instance) {
      throw new Error(`Grado de escala inválido: ${degree}`);
    }
    return instance;
  }

  public toRoman(isMinor = false): string {
    return isMinor ? this.romanMinor : this.romanMajor;
  }

  public toString(): string {
    return `Degree(${this.degree}, ${this.functionalName})`;
  }
}
