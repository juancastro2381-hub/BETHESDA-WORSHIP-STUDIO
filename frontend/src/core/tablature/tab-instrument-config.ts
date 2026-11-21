/**
 * @file tab-instrument-config.ts
 * @description Definición formal de afinaciones, instrumentos de cuerda y resolución matemática
 * de alturas para el subsistema de tablatura ASCII (Fase 2B.2).
 *
 * Principio: CERO inferencia silenciosa de afinación contradictoria o ambigua.
 */

import { EnharmonicSpelling } from '../music-theory/enharmonic-spelling.ts';
import { NoteName } from '../music-theory/note-name.ts';
import { PitchClass } from '../music-theory/pitch-class.ts';
import { Pitch } from '../music-theory/pitch.ts';

export type TabInstrumentType = 'GUITAR' | 'BASS';

export interface TabTuningPreset {
  readonly id: string;
  readonly name: string;
  readonly instrument: TabInstrumentType;
  readonly stringCount: number;
  /** Cuerdas ordenadas de la primera (más aguda) a la última (más grave) */
  readonly stringPitches: readonly Pitch[];
  /** Etiquetas textuales estándar para las líneas de tablatura (1..N) */
  readonly stringLabels: readonly string[];
}

// ----------------------------------------------------------------------------
// PRESETS DE AFINACIÓN ESTÁNDAR
// ----------------------------------------------------------------------------

export const GUITAR_6_STANDARD: TabTuningPreset = {
  id: 'guitar_6_standard',
  name: 'Guitarra 6 Cuerdas Estándar (E A D G B E)',
  instrument: 'GUITAR',
  stringCount: 6,
  stringPitches: [
    new Pitch(NoteName.E, 4), // Cuerda 1: E4 (MIDI 64)
    new Pitch(NoteName.B, 3), // Cuerda 2: B3 (MIDI 59)
    new Pitch(NoteName.G, 3), // Cuerda 3: G3 (MIDI 55)
    new Pitch(NoteName.D, 3), // Cuerda 4: D3 (MIDI 50)
    new Pitch(NoteName.A, 2), // Cuerda 5: A2 (MIDI 45)
    new Pitch(NoteName.E, 2), // Cuerda 6: E2 (MIDI 40)
  ],
  stringLabels: ['e', 'B', 'G', 'D', 'A', 'E'],
};

export const GUITAR_6_DROP_D: TabTuningPreset = {
  id: 'guitar_6_drop_d',
  name: 'Guitarra 6 Cuerdas Drop D (D A D G B E)',
  instrument: 'GUITAR',
  stringCount: 6,
  stringPitches: [
    new Pitch(NoteName.E, 4), // 1: E4
    new Pitch(NoteName.B, 3), // 2: B3
    new Pitch(NoteName.G, 3), // 3: G3
    new Pitch(NoteName.D, 3), // 4: D3
    new Pitch(NoteName.A, 2), // 5: A2
    new Pitch(NoteName.D, 2), // 6: D2 (MIDI 38)
  ],
  stringLabels: ['e', 'B', 'G', 'D', 'A', 'D'],
};

export const GUITAR_6_DADGAD: TabTuningPreset = {
  id: 'guitar_6_dadgad',
  name: 'Guitarra 6 Cuerdas DADGAD',
  instrument: 'GUITAR',
  stringCount: 6,
  stringPitches: [
    new Pitch(NoteName.D, 4), // 1: D4
    new Pitch(NoteName.A, 3), // 2: A3
    new Pitch(NoteName.G, 3), // 3: G3
    new Pitch(NoteName.D, 3), // 4: D3
    new Pitch(NoteName.A, 2), // 5: A2
    new Pitch(NoteName.D, 2), // 6: D2
  ],
  stringLabels: ['d', 'A', 'G', 'D', 'A', 'D'],
};

export const GUITAR_6_HALF_STEP_DOWN: TabTuningPreset = {
  id: 'guitar_6_half_step_down',
  name: 'Guitarra 6 Cuerdas Eb Standard (Medio tono abajo)',
  instrument: 'GUITAR',
  stringCount: 6,
  stringPitches: [
    new Pitch(NoteName.parse('Eb'), 4), // 1: Eb4 (MIDI 63)
    new Pitch(NoteName.parse('Bb'), 3), // 2: Bb3 (MIDI 58)
    new Pitch(NoteName.parse('Gb'), 3), // 3: Gb3 (MIDI 54)
    new Pitch(NoteName.parse('Db'), 3), // 4: Db3 (MIDI 49)
    new Pitch(NoteName.parse('Ab'), 2), // 5: Ab2 (MIDI 44)
    new Pitch(NoteName.parse('Eb'), 2), // 6: Eb2 (MIDI 39)
  ],
  stringLabels: ['eb', 'Bb', 'Gb', 'Db', 'Ab', 'Eb'],
};

export const GUITAR_7_STANDARD: TabTuningPreset = {
  id: 'guitar_7_standard',
  name: 'Guitarra 7 Cuerdas Estándar (B E A D G B E)',
  instrument: 'GUITAR',
  stringCount: 7,
  stringPitches: [
    new Pitch(NoteName.E, 4), // 1: E4
    new Pitch(NoteName.B, 3), // 2: B3
    new Pitch(NoteName.G, 3), // 3: G3
    new Pitch(NoteName.D, 3), // 4: D3
    new Pitch(NoteName.A, 2), // 5: A2
    new Pitch(NoteName.E, 2), // 6: E2
    new Pitch(NoteName.B, 1), // 7: B1 (MIDI 35)
  ],
  stringLabels: ['e', 'B', 'G', 'D', 'A', 'E', 'B'],
};

export const BASS_4_STANDARD: TabTuningPreset = {
  id: 'bass_4_standard',
  name: 'Bajo 4 Cuerdas Estándar (E A D G)',
  instrument: 'BASS',
  stringCount: 4,
  stringPitches: [
    new Pitch(NoteName.G, 2), // 1: G2 (MIDI 43)
    new Pitch(NoteName.D, 2), // 2: D2 (MIDI 38)
    new Pitch(NoteName.A, 1), // 3: A1 (MIDI 33)
    new Pitch(NoteName.E, 1), // 4: E1 (MIDI 28)
  ],
  stringLabels: ['G', 'D', 'A', 'E'],
};

export const BASS_4_DROP_D: TabTuningPreset = {
  id: 'bass_4_drop_d',
  name: 'Bajo 4 Cuerdas Drop D (D A D G)',
  instrument: 'BASS',
  stringCount: 4,
  stringPitches: [
    new Pitch(NoteName.G, 2), // 1: G2
    new Pitch(NoteName.D, 2), // 2: D2
    new Pitch(NoteName.A, 1), // 3: A1
    new Pitch(NoteName.D, 1), // 4: D1 (MIDI 26)
  ],
  stringLabels: ['G', 'D', 'A', 'D'],
};

export const BASS_5_STANDARD: TabTuningPreset = {
  id: 'bass_5_standard',
  name: 'Bajo 5 Cuerdas Estándar (B E A D G)',
  instrument: 'BASS',
  stringCount: 5,
  stringPitches: [
    new Pitch(NoteName.G, 2), // 1: G2
    new Pitch(NoteName.D, 2), // 2: D2
    new Pitch(NoteName.A, 1), // 3: A1
    new Pitch(NoteName.E, 1), // 4: E1
    new Pitch(NoteName.B, 0), // 5: B0 (MIDI 23)
  ],
  stringLabels: ['G', 'D', 'A', 'E', 'B'],
};

export const ALL_TAB_PRESETS: readonly TabTuningPreset[] = [
  GUITAR_6_STANDARD,
  GUITAR_6_DROP_D,
  GUITAR_6_DADGAD,
  GUITAR_6_HALF_STEP_DOWN,
  GUITAR_7_STANDARD,
  BASS_4_STANDARD,
  BASS_4_DROP_D,
  BASS_5_STANDARD,
];

// ----------------------------------------------------------------------------
// RESOLUCIÓN MATEMÁTICA Y VALIDACIÓN
// ----------------------------------------------------------------------------

export class TabInstrumentConfig {
  /**
   * Resuelve matemáticamente la altura exacta de una nota pulsada en una cuerda y traste dados.
   */
  public static calculateFretPitch(openStringPitch: Pitch, fret: number): Pitch {
    if (!Number.isInteger(fret) || fret < 0 || fret > 30) {
      throw new Error(`Traste fuera de rango físico razonable (0..30): ${fret}`);
    }
    const resultingMidi = openStringPitch.midiNumber + fret;
    const octave = Math.floor(resultingMidi / 12) - 1;
    const pcValue = ((resultingMidi % 12) + 12) % 12;
    const noteName = EnharmonicSpelling.spellGeneric(PitchClass.from(pcValue), true);
    return new Pitch(noteName, octave);
  }

  /**
   * Resuelve la altura acústica exacta de un armónico natural según el nodo físico del traste.
   * Modelado acústico riguroso (Fase 2B.2 - Defecto C):
   * - Traste 12: 2.° armónico (+12 semitonos / 1 octava arriba)
   * - Trastes 7 y 19: 3.er armónico (+19 semitonos / octava + quinta justa)
   * - Trastes 5 y 24: 4.° armónico (+24 semitonos / 2 octavas arriba)
   * - Trastes 4, 9 y 16: 5.° armónico (+28 semitonos / 2 octavas + tercera mayor)
   * Trastes no nodales o no admitidos retornan isSupported = false y pitch = null (CERO invención).
   */
  public static calculateHarmonicPitch(
    openStringPitch: Pitch,
    fret: number
  ): {
    pitch: Pitch | null;
    semitoneOffset: number | null;
    harmonicOrder: number | null;
    isSupported: boolean;
    reason?: string;
  } {
    if (!Number.isInteger(fret) || fret < 0 || fret > 30) {
      return {
        pitch: null,
        semitoneOffset: null,
        harmonicOrder: null,
        isSupported: false,
        reason: `Traste armónico ${fret} fuera de rango admisible (0..30).`,
      };
    }

    let semitoneOffset: number;
    let harmonicOrder: number;

    if (fret === 12) {
      semitoneOffset = 12;
      harmonicOrder = 2;
    } else if (fret === 7 || fret === 19) {
      semitoneOffset = 19;
      harmonicOrder = 3;
    } else if (fret === 5 || fret === 24) {
      semitoneOffset = 24;
      harmonicOrder = 4;
    } else if (fret === 4 || fret === 9 || fret === 16) {
      semitoneOffset = 28;
      harmonicOrder = 5;
    } else {
      return {
        pitch: null,
        semitoneOffset: null,
        harmonicOrder: null,
        isSupported: false,
        reason: `Traste armónico ${fret} no corresponde a un nodo armónico natural estándar (soportados: 4, 5, 7, 9, 12, 16, 19, 24). CERO fabricación: se prohíbe inventar altura.`,
      };
    }

    const pitch = this.calculateFretPitch(openStringPitch, semitoneOffset);
    return {
      pitch,
      semitoneOffset,
      harmonicOrder,
      isSupported: true,
    };
  }

  /**
   * Valida si una coordenada de cuerda y traste es admisible en el instrumento.
   */
  public static validateFretAndString(
    stringNumber: number,
    fret: number,
    totalStrings: number
  ): { valid: boolean; reason?: string } {
    if (!Number.isInteger(stringNumber) || stringNumber < 1 || stringNumber > totalStrings) {
      return {
        valid: false,
        reason: `Número de cuerda ${stringNumber} fuera de rango (1..${totalStrings}).`,
      };
    }
    if (!Number.isInteger(fret) || fret < 0 || fret > 30) {
      return {
        valid: false,
        reason: `Traste ${fret} fuera de rango físico admitido (0..30).`,
      };
    }
    return { valid: true };
  }

  /**
   * Resuelve el preset o afinación personalizada según la cantidad de cuerdas y etiquetas encontradas.
   */
  public static resolveTuning(
    stringCount: number,
    explicitLabels?: readonly string[],
    explicitInstrument?: TabInstrumentType,
    customTuningPitches?: Pitch[]
  ): {
    tuning: readonly Pitch[];
    labels: readonly string[];
    instrument: TabInstrumentType;
    name: string;
    isCustom: boolean;
    uncertaintyWarning?: string;
  } {
    // 1. Si se proporcionan alturas explícitas personalizadas
    if (customTuningPitches && customTuningPitches.length === stringCount) {
      const labels = explicitLabels ?? customTuningPitches.map((p) => p.noteName.toString());
      return {
        tuning: customTuningPitches,
        labels,
        instrument: explicitInstrument ?? (stringCount <= 5 ? 'BASS' : 'GUITAR'),
        name: `Custom (${labels.join(' ')})`,
        isCustom: true,
      };
    }

    // 2. Si se suministran etiquetas textuales en el archivo de tablatura (ej. ['e', 'B', 'G', 'D', 'A', 'E'])
    if (explicitLabels && explicitLabels.length === stringCount) {
      const normalizedLabels = explicitLabels.map((l) => l.trim().toUpperCase());

      // Intentar coincidir con preset exacto
      for (const preset of ALL_TAB_PRESETS) {
        if (preset.stringCount === stringCount) {
          const presetLabelsNorm = preset.stringLabels.map((l) => l.toUpperCase());
          if (presetLabelsNorm.every((l, i) => l === normalizedLabels[i])) {
            return {
              tuning: preset.stringPitches,
              labels: preset.stringLabels,
              instrument: preset.instrument,
              name: preset.name,
              isCustom: false,
            };
          }
        }
      }

      // Si no coincide con un preset, intentar resolver analíticamente las notas al aire
      try {
        const resolvedPitches = this.inferPitchesFromLabels(explicitLabels, stringCount, explicitInstrument);
        return {
          tuning: resolvedPitches,
          labels: explicitLabels,
          instrument: explicitInstrument ?? (stringCount <= 5 ? 'BASS' : 'GUITAR'),
          name: `Afinación detectada (${explicitLabels.join(' ')})`,
          isCustom: true,
        };
      } catch (err) {
        // Afinación ambigua o contradictoria
        throw new Error(
          `Afinación ambigua o no reconocible: [${explicitLabels.join(', ')}]. ${(err as Error).message}`
        );
      }
    }

    // 3. Fallback a presets estándar según cantidad de líneas y tipo de instrumento
    if (stringCount === 4) {
      return {
        tuning: BASS_4_STANDARD.stringPitches,
        labels: BASS_4_STANDARD.stringLabels,
        instrument: 'BASS',
        name: BASS_4_STANDARD.name,
        isCustom: false,
      };
    }

    if (stringCount === 5) {
      return {
        tuning: BASS_5_STANDARD.stringPitches,
        labels: BASS_5_STANDARD.stringLabels,
        instrument: 'BASS',
        name: BASS_5_STANDARD.name,
        isCustom: false,
      };
    }

    if (stringCount === 6) {
      return {
        tuning: GUITAR_6_STANDARD.stringPitches,
        labels: GUITAR_6_STANDARD.stringLabels,
        instrument: 'GUITAR',
        name: GUITAR_6_STANDARD.name,
        isCustom: false,
      };
    }

    if (stringCount === 7) {
      return {
        tuning: GUITAR_7_STANDARD.stringPitches,
        labels: GUITAR_7_STANDARD.stringLabels,
        instrument: 'GUITAR',
        name: GUITAR_7_STANDARD.name,
        isCustom: false,
      };
    }

    throw new Error(
      `Número de cuerdas no estándar (${stringCount}) sin definición explícita de afinación. Bethesda exige afinación explícita para configuraciones personalizadas.`
    );
  }

  /**
   * Infiere octavas acústicas de cuerdas al aire a partir de sus nombres de nota (1..N).
   */
  private static inferPitchesFromLabels(
    labels: readonly string[],
    stringCount: number,
    instrumentHint?: TabInstrumentType
  ): Pitch[] {
    const isBass = instrumentHint === 'BASS' || (stringCount <= 5 && instrumentHint !== 'GUITAR');
    const pitches: Pitch[] = [];

    // Octavas base de referencia:
    // Para guitarra de 6 cuerdas: E4, B3, G3, D3, A2, E2
    // Para bajo de 4 cuerdas: G2, D2, A1, E1
    let currentOctave = isBass ? 2 : 4;
    let previousMidi = 127;

    for (let i = 0; i < labels.length; i++) {
      const raw = labels[i]!.trim();
      // Si la etiqueta ya incluye octava (ej. "E4", "B3"):
      if (/^[A-Ga-g][b#]?-?\d+$/.test(raw)) {
        const p = Pitch.parse(raw);
        pitches.push(p);
        previousMidi = p.midiNumber;
        currentOctave = p.octave;
        continue;
      }

      // De lo contrario parsear solo nombre de nota (ej. "e", "E", "Bb")
      const noteName = NoteName.parse(raw);
      let p = new Pitch(noteName, currentOctave);

      // En un instrumento de cuerda, las cuerdas van de aguda (1) a grave (N).
      // Cada cuerda sucesiva debe ser de tono inferior a la anterior.
      while (p.midiNumber >= previousMidi && currentOctave > -1) {
        currentOctave--;
        p = new Pitch(noteName, currentOctave);
      }

      pitches.push(p);
      previousMidi = p.midiNumber;
    }

    return pitches;
  }
}
