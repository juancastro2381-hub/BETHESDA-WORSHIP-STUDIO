/**
 * @file alphatab-adapter.test.ts
 * @description Pruebas unitarias para el adaptador aislado de AlphaTab.
 */

import assert from 'node:assert';
import { describe, it } from 'node:test';
import { InstrumentRegistry } from '../../projection/instrument-profile.ts';
import { ProjectionService } from '../../projection/projection-service.ts';
import { ViewPreference } from '../../projection/view-preference.ts';
import { createCanonicalSongGMajorWithNotes } from '../../projection/fixtures/golden-scenarios.ts';
import { AlphaTabAdapter } from '../adapters/alphatab-adapter.ts';

describe('AlphaTab Adapter Tests', () => {
  const instruments = new InstrumentRegistry();

  it('4 & 5. should convert DerivedMusicalView to AlphaTabScoreData preserving tracks, staves, bars and beats', () => {
    const canonicalSong = createCanonicalSongGMajorWithNotes();
    const guitar = instruments.getOrThrow('electric_guitar');

    const pref = new ViewPreference({
      instrumentId: 'electric_guitar',
      primaryRepresentation: 'TABLATURE',
      secondaryRepresentations: ['STANDARD_NOTATION', 'CHORDS'],
    });

    const derivedView = ProjectionService.project(canonicalSong, guitar, pref).view!;
    const adapter = new AlphaTabAdapter();

    const result = adapter.render(derivedView);
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.rendererId, 'ALPHATAB');

    const score = result.data;
    assert.strictEqual(score.title, 'Sublime Gracia (Golden G Major)');
    assert.strictEqual(score.concertKey, 'G Mayor');
    assert.strictEqual(score.tracks.length, 1);

    const track = score.tracks[0]!;
    assert.strictEqual(track.name, 'Guitarra Eléctrica');
    assert.strictEqual(track.tuning.length, 6);
    assert.strictEqual(track.staves.length, 1);

    const staff = track.staves[0]!;
    assert.strictEqual(staff.isTablature, true);
    assert.strictEqual(staff.isStandardNotation, true);
    assert.strictEqual(staff.bars.length, 2);

    // Compás 1: compás 4/4 con notas G4, B4, E4
    const bar1 = staff.bars[0]!;
    assert.strictEqual(bar1.barNumber, 1);
    assert.strictEqual(bar1.timeSignature, '4/4');
    assert.ok(bar1.voices.length > 0);

    const voice1 = bar1.voices[0]!;
    assert.strictEqual(voice1.beats.length, 3);

    // Primer beat: nota G4 con tablatura (Cuerda 1, Traste 3)
    const beat1 = voice1.beats[0]!;
    assert.strictEqual(beat1.notes.length, 1);
    const note1 = beat1.notes[0]!;
    assert.strictEqual(note1.canonicalPitch, 'G4');
    assert.strictEqual(note1.string, 1);
    assert.strictEqual(note1.fret, 3);
  });

  it('11. should preserve Capo in AlphaTabScoreData (capo offset and relative frets)', () => {
    const canonicalSong = createCanonicalSongGMajorWithNotes();
    const guitar = instruments.getOrThrow('acoustic_guitar');

    const prefWithCapo = new ViewPreference({
      instrumentId: 'acoustic_guitar',
      primaryRepresentation: 'TABLATURE',
      secondaryRepresentations: ['CHORDS'],
      capoFret: 2,
    });

    const derivedView = ProjectionService.project(canonicalSong, guitar, prefWithCapo).view!;
    const adapter = new AlphaTabAdapter();

    const result = adapter.render(derivedView);
    assert.strictEqual(result.success, true);

    const score = result.data;
    assert.strictEqual(score.capo, 2);
    assert.strictEqual(score.tracks[0]!.capo, 2);

    // Con Capo 2, la nota G4 en cuerda 1 (E4 al aire) se pulsa en el traste 1 relativo al capo
    const firstNote = score.tracks[0]!.staves[0]!.bars[0]!.voices[0]!.beats[0]!.notes[0]!;
    assert.strictEqual(firstNote.string, 1);
    assert.strictEqual(firstNote.fret, 1);
  });

  it('13. should preserve chord names in AlphaTab beats (fingering vs sounding names)', () => {
    const canonicalSong = createCanonicalSongGMajorWithNotes();
    const guitar = instruments.getOrThrow('acoustic_guitar');

    const prefWithCapo = new ViewPreference({
      instrumentId: 'acoustic_guitar',
      primaryRepresentation: 'TABLATURE',
      secondaryRepresentations: ['CHORDS'],
      capoFret: 2,
    });

    const derivedView = ProjectionService.project(canonicalSong, guitar, prefWithCapo).view!;
    const adapter = new AlphaTabAdapter();

    const result = adapter.render(derivedView);
    assert.strictEqual(result.success, true);

    const beat1 = result.data.tracks[0]!.staves[0]!.bars[0]!.voices[0]!.beats[0]!;
    assert.ok(beat1.chord);
    // Para Capo 2 con acorde de concierto G:
    assert.strictEqual(beat1.chord.name, 'F'); // Digitación mostrada
    assert.strictEqual(beat1.chord.soundingName, 'G'); // Sonido real
  });
});
