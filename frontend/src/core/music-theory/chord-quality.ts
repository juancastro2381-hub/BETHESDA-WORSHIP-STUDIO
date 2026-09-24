/**
 * @file chord-quality.ts
 * @description Modela la cualidad armónica de un acorde (mayor, menor, 7ma, suspendido, etc.)
 * y sus intervalos fundamentales en semitonos.
 */

export type ChordQualityType =
  | 'MAJOR'
  | 'MINOR'
  | 'DOMINANT_7'
  | 'MAJOR_7'
  | 'MINOR_7'
  | 'DIMINISHED'
  | 'DIMINISHED_7'
  | 'HALF_DIMINISHED_7'
  | 'AUGMENTED'
  | 'AUGMENTED_7'
  | 'SUSPENDED_2'
  | 'SUSPENDED_4'
  | 'MAJOR_6'
  | 'MINOR_6'
  | 'POWER_5';

export interface ChordQualityDefinition {
  readonly type: ChordQualityType;
  readonly nameSpanish: string;
  readonly standardSymbol: string;
  readonly semitoneOffsets: readonly number[];
}

export const CHORD_QUALITIES: Record<ChordQualityType, ChordQualityDefinition> = {
  MAJOR: {
    type: 'MAJOR',
    nameSpanish: 'Mayor',
    standardSymbol: '',
    semitoneOffsets: [0, 4, 7],
  },
  MINOR: {
    type: 'MINOR',
    nameSpanish: 'Menor',
    standardSymbol: 'm',
    semitoneOffsets: [0, 3, 7],
  },
  DOMINANT_7: {
    type: 'DOMINANT_7',
    nameSpanish: 'Séptima Dominante',
    standardSymbol: '7',
    semitoneOffsets: [0, 4, 7, 10],
  },
  MAJOR_7: {
    type: 'MAJOR_7',
    nameSpanish: 'Séptima Mayor',
    standardSymbol: 'maj7',
    semitoneOffsets: [0, 4, 7, 11],
  },
  MINOR_7: {
    type: 'MINOR_7',
    nameSpanish: 'Séptima Menor',
    standardSymbol: 'm7',
    semitoneOffsets: [0, 3, 7, 10],
  },
  DIMINISHED: {
    type: 'DIMINISHED',
    nameSpanish: 'Disminuido',
    standardSymbol: 'dim',
    semitoneOffsets: [0, 3, 6],
  },
  DIMINISHED_7: {
    type: 'DIMINISHED_7',
    nameSpanish: 'Séptima Disminuida',
    standardSymbol: 'dim7',
    semitoneOffsets: [0, 3, 6, 9],
  },
  HALF_DIMINISHED_7: {
    type: 'HALF_DIMINISHED_7',
    nameSpanish: 'Semidisminuido (m7b5)',
    standardSymbol: 'm7b5',
    semitoneOffsets: [0, 3, 6, 10],
  },
  AUGMENTED: {
    type: 'AUGMENTED',
    nameSpanish: 'Aumentado',
    standardSymbol: 'aug',
    semitoneOffsets: [0, 4, 8],
  },
  AUGMENTED_7: {
    type: 'AUGMENTED_7',
    nameSpanish: 'Séptima Aumentada',
    standardSymbol: 'aug7',
    semitoneOffsets: [0, 4, 8, 10],
  },
  SUSPENDED_2: {
    type: 'SUSPENDED_2',
    nameSpanish: 'Suspendido 2',
    standardSymbol: 'sus2',
    semitoneOffsets: [0, 2, 7],
  },
  SUSPENDED_4: {
    type: 'SUSPENDED_4',
    nameSpanish: 'Suspendido 4',
    standardSymbol: 'sus4',
    semitoneOffsets: [0, 5, 7],
  },
  MAJOR_6: {
    type: 'MAJOR_6',
    nameSpanish: 'Sexta Mayor',
    standardSymbol: '6',
    semitoneOffsets: [0, 4, 7, 9],
  },
  MINOR_6: {
    type: 'MINOR_6',
    nameSpanish: 'Sexta Menor',
    standardSymbol: 'm6',
    semitoneOffsets: [0, 3, 7, 9],
  },
  POWER_5: {
    type: 'POWER_5',
    nameSpanish: 'Acorde de Quinta (Power Chord)',
    standardSymbol: '5',
    semitoneOffsets: [0, 7],
  },
};
