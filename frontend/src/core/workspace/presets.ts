/**
 * @file presets.ts
 * @description Presets dorados de referencia y catálogo de canciones para el Workspace (Fase 1G).
 */

import { CanonicalMusicPayload } from '../canonical-model/canonical-music-payload.ts';
import { Timeline } from '../canonical-model/timeline.ts';
import {
  createCanonicalSongGMajorChordsAndLyricsOnly,
  createCanonicalSongGMajorWithNotes,
} from '../projection/fixtures/golden-scenarios.ts';
import { type GoldenScenarioId, type ScenarioPreset } from './types.ts';

/**
 * Fábrica de canción vacía para pruebas de robustez y estados de error.
 */
export function createEmptyCanonicalSong(): CanonicalMusicPayload {
  return new CanonicalMusicPayload({
    title: 'Canción Vacía (Sin contenido musical)',
    timeline: new Timeline({
      totalDurationTicks: 0,
      measureCount: 0,
    }),
    sections: [],
    measures: [],
    instrumentTracks: [],
  });
}

/**
 * Catálogo de canciones canónicas disponibles para el Workspace.
 */
export const WORKSPACE_SONG_CATALOG = [
  {
    id: 'song_g_major_notes',
    title: 'Sublime Gracia (Notación Completa — Sol Mayor)',
    type: 'CANONICAL_FULL_NOTATION',
    factory: createCanonicalSongGMajorWithNotes,
  },
  {
    id: 'song_g_major_chordpro',
    title: 'Sublime Gracia (ChordPro — Solo Cifrado y Letra)',
    type: 'CANONICAL_CHORDPRO_PURE',
    factory: createCanonicalSongGMajorChordsAndLyricsOnly,
  },
  {
    id: 'song_empty',
    title: 'Canción Vacía (Edge Case / Sin compases)',
    type: 'CANONICAL_EMPTY',
    factory: createEmptyCanonicalSong,
  },
] as const;

/**
 * Presets de Escenarios Dorados oficiales (Sección 4).
 */
export const GOLDEN_SCENARIO_PRESETS: Record<GoldenScenarioId, ScenarioPreset> = {
  SCENARIO_A: {
    id: 'SCENARIO_A',
    name: 'Escenario A: Guitarra Acústica',
    subtitle: 'Capo 2 • Tablatura + Cifrado (AlphaTab)',
    description: 'Canción en Sol Mayor. Cejilla en traste 2 produciendo digitación de Fa Mayor. Coordenadas de tablatura precisas. Tono sonante inalterado.',
    instrumentId: 'acoustic_guitar',
    primaryRepresentation: 'TABLATURE',
    secondaryRepresentations: ['CHORDS'],
    capoFret: 2,
    transpositionSemitones: 0,
    chordNotationSystem: 'STANDARD',
    preferredRendererId: 'ALPHATAB',
    canonicalSongFactory: createCanonicalSongGMajorWithNotes,
  },
  SCENARIO_B: {
    id: 'SCENARIO_B',
    name: 'Escenario B: Piano Acústico',
    subtitle: 'Gran Pentagrama + Cifrado (OSMD)',
    description: 'Gran Pentagrama con Claves de Sol y Fa conectadas por llave corchete. Métrica 4/4, cifrado armónico y letra alineada.',
    instrumentId: 'acoustic_piano',
    primaryRepresentation: 'GRAND_STAFF',
    secondaryRepresentations: ['CHORDS'],
    capoFret: 0,
    transpositionSemitones: 0,
    chordNotationSystem: 'STANDARD',
    preferredRendererId: 'OSMD',
    canonicalSongFactory: createCanonicalSongGMajorWithNotes,
  },
  SCENARIO_C: {
    id: 'SCENARIO_C',
    name: 'Escenario C: Saxofón Alto en Eb',
    subtitle: 'Instrumento Transpositor • Notación Escrita (OSMD)',
    description: 'Tono de concierto Sol Mayor proyectado a Mi Mayor escrito (+9 semitonos, 4 sostenidos en la armadura). Pentagrama único en Clave de Sol.',
    instrumentId: 'alto_sax',
    primaryRepresentation: 'STANDARD_NOTATION',
    secondaryRepresentations: ['CHORDS'],
    capoFret: 0,
    transpositionSemitones: 0,
    chordNotationSystem: 'STANDARD',
    preferredRendererId: 'OSMD',
    canonicalSongFactory: createCanonicalSongGMajorWithNotes,
  },
  SCENARIO_D: {
    id: 'SCENARIO_D',
    name: 'Escenario D: Voz Principal',
    subtitle: 'Lead Sheet Puro • Cifrado y Letra (LeadSheetDOM)',
    description: 'Fuente ChordPro sin melodía. Invariante estricto: cero notas melódicas inventadas. Tarjetas de compás semánticas y soporte de cifrado latino.',
    instrumentId: 'lead_vocal',
    primaryRepresentation: 'LYRICS',
    secondaryRepresentations: ['CHORDS'],
    capoFret: 0,
    transpositionSemitones: 0,
    chordNotationSystem: 'STANDARD',
    preferredRendererId: 'LEADSHEET_DOM',
    canonicalSongFactory: createCanonicalSongGMajorChordsAndLyricsOnly,
  },
};
