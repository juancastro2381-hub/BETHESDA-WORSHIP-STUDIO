/**
 * @file osmd-adapter.test.ts
 * @description Pruebas unitarias para el adaptador aislado de OpenSheetMusicDisplay (OSMD).
 */

import assert from 'node:assert';
import { describe, it } from 'node:test';
import { InstrumentRegistry } from '../../projection/instrument-profile.ts';
import { ProjectionService } from '../../projection/projection-service.ts';
import { ViewPreference } from '../../projection/view-preference.ts';
import { createCanonicalSongGMajorWithNotes } from '../../projection/fixtures/golden-scenarios.ts';
import { OsmdAdapter } from '../adapters/osmd-adapter.ts';

describe('OSMD Adapter Tests', () => {
  const instruments = new InstrumentRegistry();

  it('6. should convert DerivedMusicalView to OsmdScoreData supporting Grand Staff for Piano', () => {
    const canonicalSong = createCanonicalSongGMajorWithNotes();
    const piano = instruments.getOrThrow('acoustic_piano');

    const pref = new ViewPreference({
      instrumentId: 'acoustic_piano',
      primaryRepresentation: 'GRAND_STAFF',
      secondaryRepresentations: ['CHORDS'],
    });

    const derivedView = ProjectionService.project(canonicalSong, piano, pref).view!;
    const adapter = new OsmdAdapter();

    const result = adapter.render(derivedView);
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.rendererId, 'OSMD');

    const score = result.data;
    assert.strictEqual(score.workTitle, 'Sublime Gracia (Golden G Major)');
    assert.strictEqual(score.partName, 'Piano Acústico');
    assert.strictEqual(score.stavesCount, 2);
    assert.deepStrictEqual(score.clefs, ['TREBLE', 'BASS']);

    // Compás 1 debe contener 2 staves
    const m1 = score.measures[0]!;
    assert.strictEqual(m1.measureNumber, 1);
    assert.strictEqual(m1.staves.length, 2);
    assert.strictEqual(m1.staves[0]!.clef, 'TREBLE');
    assert.strictEqual(m1.staves[1]!.clef, 'BASS');
  });

  it('12. should preserve written pitch for transposing instruments in OSMD (Alto Sax Eb written key and notes)', () => {
    const canonicalSong = createCanonicalSongGMajorWithNotes();
    const altoSax = instruments.getOrThrow('alto_sax');

    const pref = new ViewPreference({
      instrumentId: 'alto_sax',
      primaryRepresentation: 'STANDARD_NOTATION',
    });

    const derivedView = ProjectionService.project(canonicalSong, altoSax, pref).view!;
    const adapter = new OsmdAdapter();

    const result = adapter.render(derivedView);
    assert.strictEqual(result.success, true);

    const score = result.data;
    // Tono de concierto es G
    assert.strictEqual(score.concertKeySignature.tonic, 'G');

    // Tono escrito de saxofón alto es E Mayor (+9 semitonos)
    assert.strictEqual(score.writtenKeySignature.tonic, 'E');
    assert.strictEqual(score.writtenKeySignature.fifths, 4); // 4 sostenidos

    // Primera nota escrita en el compás 1 debe ser E5 (concierto G4)
    const firstEntry = score.measures[0]!.staves[0]!.voices[0]!.entries[0]!;
    assert.strictEqual(firstEntry.step, 'E');
    assert.strictEqual(firstEntry.octave, 5);
    assert.strictEqual(firstEntry.canonicalPitch, 'G4');
    assert.strictEqual(firstEntry.writtenPitch, 'E5');
  });

  it('14. should preserve lyric syllables attached to note entries in OSMD score data', () => {
    const canonicalSong = createCanonicalSongGMajorWithNotes();
    const piano = instruments.getOrThrow('acoustic_piano');

    const pref = new ViewPreference({
      instrumentId: 'acoustic_piano',
      primaryRepresentation: 'STANDARD_NOTATION',
      secondaryRepresentations: ['LYRICS'],
    });

    const derivedView = ProjectionService.project(canonicalSong, piano, pref).view!;
    const adapter = new OsmdAdapter();

    const result = adapter.render(derivedView);
    assert.strictEqual(result.success, true);

    const entries = result.data.measures[0]!.staves[0]!.voices[0]!.entries;
    assert.strictEqual(entries[0]!.lyrics[0], 'Sub');
    assert.strictEqual(entries[1]!.lyrics[0], 'li');
    assert.strictEqual(entries[2]!.lyrics[0], 'me');
  });
});
