/**
 * @file instrument-profile.ts
 * @description Formalización de perfiles de instrumento y capacidades de proyección (Fase 1D).
 * Invariante arquitectónico: El Instrumento declara qué representaciones son válidas;
 * el músico elige cuál de las representaciones soportadas desea visualizar.
 * NO contiene componentes ni dependencias de UI.
 */

import { type ClefType, type InstrumentFamily } from '../canonical-model/types.ts';
import { NoteName } from '../music-theory/note-name.ts';
import { Pitch } from '../music-theory/pitch.ts';
import { TransposingInstrumentEngine } from '../music-theory/transposition.ts';
import { type TuningDefinition, type ViewRepresentation } from './types.ts';

/**
 * Afinaciones estándar de fábrica para instrumentos de cuerda con tablatura.
 */
export const STANDARD_GUITAR_TUNING: TuningDefinition = {
  id: 'standard_guitar_6',
  name: 'Guitarra Estándar (E A D G B E)',
  // Cuerdas de la 1ª (más aguda) a la 6ª (más grave):
  stringPitches: [
    new Pitch(NoteName.E, 4), // 1: E4 (MIDI 64)
    new Pitch(NoteName.B, 3), // 2: B3 (MIDI 59)
    new Pitch(NoteName.G, 3), // 3: G3 (MIDI 55)
    new Pitch(NoteName.D, 3), // 4: D3 (MIDI 50)
    new Pitch(NoteName.A, 2), // 5: A2 (MIDI 45)
    new Pitch(NoteName.E, 2), // 6: E2 (MIDI 40)
  ],
};

export const STANDARD_BASS_TUNING: TuningDefinition = {
  id: 'standard_bass_4',
  name: 'Bajo Estándar 4 Cuerdas (E A D G)',
  // Cuerdas de la 1ª (más aguda) a la 4ª (más grave):
  stringPitches: [
    new Pitch(NoteName.G, 2), // 1: G2 (MIDI 43)
    new Pitch(NoteName.D, 2), // 2: D2 (MIDI 38)
    new Pitch(NoteName.A, 1), // 3: A1 (MIDI 33)
    new Pitch(NoteName.E, 1), // 4: E1 (MIDI 28)
  ],
};

export interface InstrumentProfileInit {
  id: string;
  name: string;
  family: InstrumentFamily;
  transpositionOffsetSemitones?: number;
  clef?: ClefType;
  staffCount?: number;
  supportedRepresentations: ViewRepresentation[];
  defaultRepresentations: ViewRepresentation[];
  tuning?: TuningDefinition;
  isPercussion?: boolean;
}

export class InstrumentProfile {
  public readonly id: string;
  public readonly name: string;
  public readonly family: InstrumentFamily;
  public readonly transpositionOffsetSemitones: number;
  public readonly clef: ClefType;
  public readonly staffCount: number;
  public readonly supportedRepresentations: ReadonlySet<ViewRepresentation>;
  public readonly defaultRepresentations: readonly ViewRepresentation[];
  public readonly tuning?: TuningDefinition;
  public readonly isPercussion: boolean;

  public constructor(init: InstrumentProfileInit) {
    if (!init.id || typeof init.id !== 'string') {
      throw new Error(`ID de perfil de instrumento inválido: ${init.id}`);
    }
    if (!init.name || typeof init.name !== 'string') {
      throw new Error(`Nombre de perfil requerido en instrumento ${init.id}`);
    }
    if (!init.supportedRepresentations || init.supportedRepresentations.length === 0) {
      throw new Error(`El instrumento ${init.id} debe declarar al menos una representación soportada.`);
    }

    this.id = init.id;
    this.name = init.name.trim();
    this.family = init.family;
    this.transpositionOffsetSemitones = init.transpositionOffsetSemitones ?? TransposingInstrumentEngine.CONCERT_OFFSET;
    this.clef = init.clef ?? (init.family === 'BASS' ? 'BASS' : 'TREBLE');
    this.staffCount = init.staffCount ?? (init.family === 'KEYS' ? 2 : 1);
    this.supportedRepresentations = new Set(init.supportedRepresentations);
    this.defaultRepresentations = Object.freeze([...init.defaultRepresentations]);
    if (init.tuning) this.tuning = init.tuning;
    this.isPercussion = init.isPercussion ?? init.family === 'DRUMS';
  }

  /**
   * Consulta si una representación específica es soportada por este instrumento.
   */
  public isRepresentationSupported(rep: ViewRepresentation): boolean {
    return this.supportedRepresentations.has(rep);
  }

  /**
   * Valida un conjunto de representaciones solicitadas por el músico.
   * Retorna si todas son válidas y la lista de aquellas incompatibles/no soportadas.
   */
  public validateRequestedRepresentations(requested: readonly ViewRepresentation[]): {
    valid: boolean;
    unsupported: ViewRepresentation[];
  } {
    const unsupported = requested.filter((rep) => !this.isRepresentationSupported(rep));
    return {
      valid: unsupported.length === 0,
      unsupported,
    };
  }
}

/**
 * Registro y catálogo de perfiles de instrumento del sistema.
 */
export class InstrumentRegistry {
  private readonly profiles = new Map<string, InstrumentProfile>();

  public constructor() {
    this.registerDefaults();
  }

  public register(profile: InstrumentProfile): void {
    this.profiles.set(profile.id, profile);
  }

  public get(id: string): InstrumentProfile | undefined {
    return this.profiles.get(id);
  }

  public getOrThrow(id: string): InstrumentProfile {
    const profile = this.profiles.get(id);
    if (!profile) {
      throw new Error(`Perfil de instrumento no registrado: "${id}"`);
    }
    return profile;
  }

  public getAll(): InstrumentProfile[] {
    return Array.from(this.profiles.values());
  }

  private registerDefaults(): void {
    // 1. Acoustic Guitar
    this.register(
      new InstrumentProfile({
        id: 'acoustic_guitar',
        name: 'Guitarra Acústica',
        family: 'GUITAR',
        transpositionOffsetSemitones: TransposingInstrumentEngine.CONCERT_OFFSET,
        clef: 'TREBLE',
        staffCount: 1,
        supportedRepresentations: [
          'STANDARD_NOTATION',
          'TABLATURE',
          'CHORDS',
          'LYRICS',
          'SECTION_MARKERS',
        ],
        defaultRepresentations: ['CHORDS', 'LYRICS'],
        tuning: STANDARD_GUITAR_TUNING,
      })
    );

    // 2. Electric Guitar
    this.register(
      new InstrumentProfile({
        id: 'electric_guitar',
        name: 'Guitarra Eléctrica',
        family: 'GUITAR',
        transpositionOffsetSemitones: TransposingInstrumentEngine.CONCERT_OFFSET,
        clef: 'TREBLE',
        staffCount: 1,
        supportedRepresentations: [
          'STANDARD_NOTATION',
          'TABLATURE',
          'CHORDS',
          'LYRICS',
          'SECTION_MARKERS',
        ],
        defaultRepresentations: ['TABLATURE', 'CHORDS'],
        tuning: STANDARD_GUITAR_TUNING,
      })
    );

    // 3. Bass Guitar
    this.register(
      new InstrumentProfile({
        id: 'bass',
        name: 'Bajo Eléctrico',
        family: 'BASS',
        transpositionOffsetSemitones: TransposingInstrumentEngine.CONCERT_OFFSET,
        clef: 'BASS',
        staffCount: 1,
        supportedRepresentations: [
          'STANDARD_NOTATION',
          'TABLATURE',
          'CHORDS',
          'LYRICS',
          'SECTION_MARKERS',
        ],
        defaultRepresentations: ['STANDARD_NOTATION', 'TABLATURE', 'CHORDS'],
        tuning: STANDARD_BASS_TUNING,
      })
    );

    // 4. Acoustic Piano
    this.register(
      new InstrumentProfile({
        id: 'acoustic_piano',
        name: 'Piano Acústico',
        family: 'KEYS',
        transpositionOffsetSemitones: TransposingInstrumentEngine.CONCERT_OFFSET,
        clef: 'TREBLE',
        staffCount: 2,
        supportedRepresentations: [
          'GRAND_STAFF',
          'STANDARD_NOTATION',
          'CHORDS',
          'LYRICS',
          'SECTION_MARKERS',
        ],
        defaultRepresentations: ['GRAND_STAFF', 'CHORDS'],
      })
    );

    // 5. Keyboard / Synth
    this.register(
      new InstrumentProfile({
        id: 'keyboard',
        name: 'Teclado / Sintetizador',
        family: 'KEYS',
        transpositionOffsetSemitones: TransposingInstrumentEngine.CONCERT_OFFSET,
        clef: 'TREBLE',
        staffCount: 2,
        supportedRepresentations: [
          'GRAND_STAFF',
          'STANDARD_NOTATION',
          'CHORDS',
          'LYRICS',
          'SECTION_MARKERS',
        ],
        defaultRepresentations: ['GRAND_STAFF', 'CHORDS'],
      })
    );

    // 6. Drums
    this.register(
      new InstrumentProfile({
        id: 'drums',
        name: 'Batería / Percusión',
        family: 'DRUMS',
        transpositionOffsetSemitones: TransposingInstrumentEngine.CONCERT_OFFSET,
        clef: 'PERCUSSION',
        staffCount: 1,
        supportedRepresentations: [
          'PERCUSSION_NOTATION',
          'LYRICS',
          'SECTION_MARKERS',
        ],
        defaultRepresentations: ['PERCUSSION_NOTATION', 'SECTION_MARKERS'],
        isPercussion: true,
      })
    );

    // 7. Alto Saxophone (Eb Instrument, +9 semitones)
    this.register(
      new InstrumentProfile({
        id: 'alto_sax',
        name: 'Saxofón Alto (Eb)',
        family: 'WOODWINDS',
        transpositionOffsetSemitones: TransposingInstrumentEngine.EB_OFFSET,
        clef: 'TREBLE',
        staffCount: 1,
        supportedRepresentations: [
          'STANDARD_NOTATION',
          'CHORDS',
          'SECTION_MARKERS',
        ],
        defaultRepresentations: ['STANDARD_NOTATION'],
      })
    );

    // 8. Tenor Saxophone (Bb Instrument, +2 semitones)
    this.register(
      new InstrumentProfile({
        id: 'tenor_sax',
        name: 'Saxofón Tenor (Bb)',
        family: 'WOODWINDS',
        transpositionOffsetSemitones: TransposingInstrumentEngine.BB_OFFSET,
        clef: 'TREBLE',
        staffCount: 1,
        supportedRepresentations: [
          'STANDARD_NOTATION',
          'CHORDS',
          'SECTION_MARKERS',
        ],
        defaultRepresentations: ['STANDARD_NOTATION'],
      })
    );

    // 9. Trumpet (Bb Instrument, +2 semitones)
    this.register(
      new InstrumentProfile({
        id: 'trumpet',
        name: 'Trompeta en Bb',
        family: 'BRASS',
        transpositionOffsetSemitones: TransposingInstrumentEngine.BB_OFFSET,
        clef: 'TREBLE',
        staffCount: 1,
        supportedRepresentations: [
          'STANDARD_NOTATION',
          'CHORDS',
          'SECTION_MARKERS',
        ],
        defaultRepresentations: ['STANDARD_NOTATION'],
      })
    );

    // 10. Lead Vocal
    this.register(
      new InstrumentProfile({
        id: 'lead_vocal',
        name: 'Voz Principal',
        family: 'VOCALS',
        transpositionOffsetSemitones: TransposingInstrumentEngine.CONCERT_OFFSET,
        clef: 'TREBLE',
        staffCount: 1,
        supportedRepresentations: [
          'STANDARD_NOTATION',
          'LYRICS',
          'CHORDS',
          'SECTION_MARKERS',
        ],
        defaultRepresentations: ['LYRICS', 'CHORDS'],
      })
    );

    // 11. Backing Vocal
    this.register(
      new InstrumentProfile({
        id: 'backing_vocal',
        name: 'Voz Coros / Armonía',
        family: 'VOCALS',
        transpositionOffsetSemitones: TransposingInstrumentEngine.CONCERT_OFFSET,
        clef: 'TREBLE',
        staffCount: 1,
        supportedRepresentations: [
          'STANDARD_NOTATION',
          'LYRICS',
          'CHORDS',
          'SECTION_MARKERS',
        ],
        defaultRepresentations: ['LYRICS', 'CHORDS'],
      })
    );

    // 12. Generic Instrument
    this.register(
      new InstrumentProfile({
        id: 'generic',
        name: 'Instrumento General',
        family: 'OTHER',
        transpositionOffsetSemitones: TransposingInstrumentEngine.CONCERT_OFFSET,
        clef: 'TREBLE',
        staffCount: 1,
        supportedRepresentations: [
          'STANDARD_NOTATION',
          'CHORDS',
          'LYRICS',
          'SECTION_MARKERS',
        ],
        defaultRepresentations: ['STANDARD_NOTATION', 'CHORDS'],
      })
    );
  }
}
