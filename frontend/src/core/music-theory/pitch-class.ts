/**
 * @file pitch-class.ts
 * @description Implementa el sistema canónico de Clases de Tono (Pitch Classes 0–11)
 * con aritmética modular matemática exacta, sin dependencia de strings no controlados.
 */

export class PitchClass {
  public static readonly C = new PitchClass(0);
  public static readonly CS = new PitchClass(1);
  public static readonly DB = new PitchClass(1);
  public static readonly D = new PitchClass(2);
  public static readonly DS = new PitchClass(3);
  public static readonly EB = new PitchClass(3);
  public static readonly E = new PitchClass(4);
  public static readonly F = new PitchClass(5);
  public static readonly FS = new PitchClass(6);
  public static readonly GB = new PitchClass(6);
  public static readonly G = new PitchClass(7);
  public static readonly GS = new PitchClass(8);
  public static readonly AB = new PitchClass(8);
  public static readonly A = new PitchClass(9);
  public static readonly AS = new PitchClass(10);
  public static readonly BB = new PitchClass(10);
  public static readonly B = new PitchClass(11);

  private static readonly INSTANCES: PitchClass[] = Array.from(
    { length: 12 },
    (_, i) => new PitchClass(i)
  );

  /**
   * Valor entero canónico normalizado entre 0 y 11.
   * 0=C, 1=C#/Db, 2=D, 3=D#/Eb, 4=E, 5=F, 6=F#/Gb, 7=G, 8=G#/Ab, 9=A, 10=A#/Bb, 11=B.
   */
  public readonly value: number;

  private constructor(value: number) {
    this.value = PitchClass.normalize(value);
  }

  /**
   * Normalización matemática módulo 12 garantizando resultados en [0, 11]
   * incluso para enteros negativos grandes.
   */
  public static normalize(value: number): number {
    return ((Math.floor(value) % 12) + 12) % 12;
  }

  /**
   * Fábrica segura para obtener una instancia inmutable de PitchClass.
   */
  public static from(value: number): PitchClass {
    const normalized = PitchClass.normalize(value);
    const instance = PitchClass.INSTANCES[normalized];
    if (!instance) {
      throw new Error(`Error inesperado al instanciar PitchClass: ${value}`);
    }
    return instance;
  }

  /**
   * Transpone hacia arriba o hacia abajo sumando semitonos (módulo 12).
   */
  public add(semitones: number): PitchClass {
    return PitchClass.from(this.value + semitones);
  }

  /**
   * Resta semitonos en aritmética modular.
   */
  public subtract(semitones: number): PitchClass {
    return PitchClass.from(this.value - semitones);
  }

  /**
   * Distancia interválica ascendente (0 a 11 semitonos) hacia el objetivo.
   */
  public semitonesTo(target: PitchClass): number {
    return PitchClass.normalize(target.value - this.value);
  }

  /**
   * Distancia más corta (entre -6 y +6 semitonos).
   * Valores positivos indican sentido horario (ascendente), negativos antihorario.
   */
  public shortestDistanceTo(target: PitchClass): number {
    const asc = this.semitonesTo(target);
    return asc > 6 ? asc - 12 : asc;
  }

  public equals(other: PitchClass): boolean {
    return this.value === other.value;
  }

  public toString(): string {
    return `PitchClass(${this.value})`;
  }
}
