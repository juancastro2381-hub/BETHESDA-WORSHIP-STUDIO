/**
 * @file golden-renderer-scenarios.test.ts
 * @description Pruebas de los Escenarios Dorados de Contrato de Renderizado (Sección 11).
 *
 * Invariante arquitectónico dorado:
 * Renderer output ≠ Canonical Music
 * Renderer output = Visual representation of DerivedMusicalView
 */

import assert from 'node:assert';
import { describe, it } from 'node:test';
import { InstrumentRegistry } from '../../projection/instrument-profile.ts';
import { ProjectionService } from '../../projection/projection-service.ts';
import { ViewPreference } from '../../projection/view-preference.ts';
import {
  createCanonicalSongGMajorChordsAndLyricsOnly,
  createCanonicalSongGMajorWithNotes,
} from '../../projection/fixtures/golden-scenarios.ts';
import { AlphaTabAdapter } from '../adapters/alphatab-adapter.ts';
import { LeadSheetDomAdapter } from '../adapters/leadsheet-dom-adapter.ts';
import { OsmdAdapter } from '../adapters/osmd-adapter.ts';

describe('Golden Renderer Contract Scenarios Tests (A through D)', () => {
  const instruments = new InstrumentRegistry();

  it('Scenario A: Guitar + Capo 2 (CHORDS + TABLATURE) -> Renderer receives derived representation, canonical model unchanged', () => {
    const canonicalSong = createCanonicalSongGMajorWithNotes();
    const initialCanonicalJson = JSON.stringify(canonicalSong);

    const guitar = instruments.getOrThrow('acoustic_guitar');
    const prefA = new ViewPreference({
      instrumentId: 'acoustic_guitar',
      primaryRepresentation: 'TABLATURE',
      secondaryRepresentations: ['CHORDS'],
      capoFret: 2,
    });

    const derivedView = ProjectionService.project(canonicalSong, guitar, prefA).view!;
    assert.ok(derivedView);

    // Verificaciones en DerivedMusicalView
    assert.strictEqual(derivedView.concertKey.tonic.toString(), 'G'); // Sonando en G
    assert.strictEqual(derivedView.getAllChords()[0]!.fingeringChord.toString('STANDARD'), 'F'); // Digitación en F
    assert.ok(derivedView.getAllTabPositions().length > 0);

    // Paso por el adaptador AlphaTab
    const adapter = new AlphaTabAdapter();
    const output = adapter.render(derivedView);

    assert.strictEqual(output.success, true);
    assert.strictEqual(output.data.capo, 2);

    const firstBeat = output.data.tracks[0]!.staves[0]!.bars[0]!.voices[0]!.beats[0]!;
    assert.strictEqual(firstBeat.notes[0]!.string, 1);
    assert.strictEqual(firstBeat.notes[0]!.fret, 1); // Traste 1 relativo al capo
    assert.strictEqual(firstBeat.chord?.name, 'F'); // Cifrado de digitación en F
    assert.strictEqual(firstBeat.chord?.soundingName, 'G'); // Cifrado real sonante en G

    // Invariante: el modelo canónico permanece inalterado
    assert.strictEqual(JSON.stringify(canonicalSong), initialCanonicalJson);
  });

  it('Scenario B: Piano (GRAND_STAFF + CHORDS) -> Renderer receives grand-staff projection and chord data', () => {
    const canonicalSong = createCanonicalSongGMajorWithNotes();
    const piano = instruments.getOrThrow('acoustic_piano');

    const prefB = new ViewPreference({
      instrumentId: 'acoustic_piano',
      primaryRepresentation: 'GRAND_STAFF',
      secondaryRepresentations: ['CHORDS'],
    });

    const derivedView = ProjectionService.project(canonicalSong, piano, prefB).view!;
    assert.ok(derivedView);

    const adapter = new OsmdAdapter();
    const output = adapter.render(derivedView);

    assert.strictEqual(output.success, true);
    assert.strictEqual(output.data.stavesCount, 2);
    assert.deepStrictEqual(output.data.clefs, ['TREBLE', 'BASS']);

    const measure1 = output.data.measures[0]!;
    assert.strictEqual(measure1.staves.length, 2);
    assert.strictEqual(measure1.staves[0]!.clef, 'TREBLE');
    assert.strictEqual(measure1.staves[1]!.clef, 'BASS');
  });

  it('Scenario C: Alto Sax (STANDARD_NOTATION) -> Renderer receives written Eb-instrument pitch, canonical pitch unchanged', () => {
    const canonicalSong = createCanonicalSongGMajorWithNotes();
    const altoSax = instruments.getOrThrow('alto_sax');

    const prefC = new ViewPreference({
      instrumentId: 'alto_sax',
      primaryRepresentation: 'STANDARD_NOTATION',
    });

    const derivedView = ProjectionService.project(canonicalSong, altoSax, prefC).view!;
    assert.ok(derivedView);

    const adapter = new OsmdAdapter();
    const output = adapter.render(derivedView);

    assert.strictEqual(output.success, true);
    // Tono de concierto: G
    assert.strictEqual(output.data.concertKeySignature.tonic, 'G');
    // Tono escrito: E (+9 semitonos)
    assert.strictEqual(output.data.writtenKeySignature.tonic, 'E');

    // Nota escrita proyectada: E5
    const firstNoteEntry = output.data.measures[0]!.staves[0]!.voices[0]!.entries[0]!;
    assert.strictEqual(firstNoteEntry.writtenPitch, 'E5');
    assert.strictEqual(firstNoteEntry.canonicalPitch, 'G4');
  });

  it('Scenario D: Lead Vocal (LYRICS + CHORDS from ChordPro) -> Renderer receives zero melody notes', () => {
    const canonicalChordProSong = createCanonicalSongGMajorChordsAndLyricsOnly();
    const vocal = instruments.getOrThrow('lead_vocal');

    const prefD = new ViewPreference({
      instrumentId: 'lead_vocal',
      primaryRepresentation: 'LYRICS',
      secondaryRepresentations: ['CHORDS'],
    });

    const derivedView = ProjectionService.project(canonicalChordProSong, vocal, prefD).view!;
    assert.ok(derivedView);

    const adapter = new LeadSheetDomAdapter();
    const output = adapter.render(derivedView);

    assert.strictEqual(output.success, true);
    // Invariante de oro: CERO notas melódicas en el renderizador
    assert.strictEqual(output.data.totalMelodyNotes, 0);
    assert.strictEqual(output.data.sections.length, 1);
    assert.ok(output.data.sections[0]!.measures[0]!.tokens.length > 0);
  });
});
