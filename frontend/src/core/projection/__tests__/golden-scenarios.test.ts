/**
 * @file golden-scenarios.test.ts
 * @description Pruebas de validación de los 4 Escenarios de Referencia (Golden Projection Scenarios A, B, C, D)
 * estipulados formalmente en la Sección 16 de la especificación de Fase 1D.
 */

import assert from 'node:assert';
import { describe, it } from 'node:test';
import { InstrumentRegistry } from '../instrument-profile.ts';
import { ProjectionService } from '../projection-service.ts';
import { ViewPreference } from '../view-preference.ts';
import {
  createCanonicalSongGMajorChordsAndLyricsOnly,
  createCanonicalSongGMajorWithNotes,
} from '../fixtures/golden-scenarios.ts';

describe('Phase 1D Golden Projection Scenarios Tests (A through D)', () => {
  const registry = new InstrumentRegistry();

  it('Scenario A: Guitar with Capo 2, Chord + Tablature -> Fingering appropriate for capo 2, concert key remains G Major', () => {
    const song = createCanonicalSongGMajorWithNotes();
    const guitar = registry.getOrThrow('acoustic_guitar');

    const prefA = new ViewPreference({
      instrumentId: 'acoustic_guitar',
      primaryRepresentation: 'CHORDS',
      secondaryRepresentations: ['TABLATURE'],
      capoFret: 2,
    });

    const result = ProjectionService.project(song, guitar, prefA);
    assert.strictEqual(result.status, 'SUCCESS');
    assert.ok(result.view);

    // 1. Tono sonante de concierto inalterado en G Mayor
    assert.strictEqual(result.view.concertKey.tonic.toString(), 'G');
    assert.strictEqual(result.view.concertKey.mode, 'MAJOR');

    // 2. Acorde de digitación adecuado para Capo 2 (F en lugar de G)
    const chords = result.view.getAllChords();
    assert.strictEqual(chords[0]!.displayString, 'F');
    assert.strictEqual(chords[0]!.soundingDisplayString, 'G');

    // 3. Tablatura calculada relativa a la cejilla
    const tabs = result.view.getAllTabPositions();
    assert.ok(tabs.length > 0);
    // En la primera nota G4 con Capo 2 en cuerda 1: traste 1 relativo al capo (67 - (64 + 2) = 1)
    assert.strictEqual(tabs[0]!.fret, 1);
    assert.strictEqual(tabs[0]!.stringNumber, 1);
  });

  it('Scenario B: Piano with Grand Staff + Chords -> Concert pitch remains G Major, grand staff clefs', () => {
    const song = createCanonicalSongGMajorWithNotes();
    const piano = registry.getOrThrow('acoustic_piano');

    const prefB = new ViewPreference({
      instrumentId: 'acoustic_piano',
      primaryRepresentation: 'GRAND_STAFF',
      secondaryRepresentations: ['CHORDS'],
    });

    const result = ProjectionService.project(song, piano, prefB);
    assert.strictEqual(result.status, 'SUCCESS');
    assert.ok(result.view);

    // 1. Tono de concierto inalterado en G Mayor
    assert.strictEqual(result.view.concertKey.tonic.toString(), 'G');

    // 2. Claves de Gran Pentagrama: TREBLE y BASS
    const measure1 = result.view.measures[0]!;
    assert.deepStrictEqual(measure1.clefs, ['TREBLE', 'BASS']);

    // 3. Acordes en clave de concierto
    assert.strictEqual(result.view.getAllChords()[0]!.displayString, 'G');
    assert.strictEqual(result.view.getAllChords()[1]!.displayString, 'Em');
  });

  it('Scenario C: Alto Saxophone with Written Notation -> Correct Eb transposition (+9 semitones)', () => {
    const song = createCanonicalSongGMajorWithNotes();
    const altoSax = registry.getOrThrow('alto_sax');

    const prefC = new ViewPreference({
      instrumentId: 'alto_sax',
      primaryRepresentation: 'STANDARD_NOTATION',
    });

    const result = ProjectionService.project(song, altoSax, prefC);
    assert.strictEqual(result.status, 'SUCCESS');
    assert.ok(result.view);

    // 1. Tono de concierto es G Mayor, pero el tono escrito es E Mayor (+9 semitonos)
    assert.strictEqual(result.view.concertKey.tonic.toString(), 'G');
    assert.strictEqual(result.view.writtenKey.tonic.toString(), 'E');
    assert.strictEqual(result.view.writtenKey.keySignature.accidentalCount, 4); // 4 sostenidos: F#, C#, G#, D#

    // 2. Primera nota canónica G4 transpuesta a E5
    const firstNote = result.view.getAllNotes()[0]!;
    assert.strictEqual(firstNote.canonicalPitch.toString(), 'G4');
    assert.strictEqual(firstNote.writtenPitch.toString(), 'E5');

    // 3. Segunda nota canónica B4 transpuesta a G#5
    const secondNote = result.view.getAllNotes()[1]!;
    assert.strictEqual(secondNote.canonicalPitch.toString(), 'B4');
    assert.strictEqual(secondNote.writtenPitch.toString(), 'G#5');
  });

  it('Scenario D: Lead Vocal with Lyrics + Chords -> No artificial melody notes generated', () => {
    const songLeadSheet = createCanonicalSongGMajorChordsAndLyricsOnly();
    const vocal = registry.getOrThrow('lead_vocal');

    const prefD = new ViewPreference({
      instrumentId: 'lead_vocal',
      primaryRepresentation: 'LYRICS',
      secondaryRepresentations: ['CHORDS'],
    });

    const result = ProjectionService.project(songLeadSheet, vocal, prefD);
    assert.strictEqual(result.status, 'SUCCESS');
    assert.ok(result.view);

    // 1. Tono de concierto permanece G Mayor
    assert.strictEqual(result.view.concertKey.tonic.toString(), 'G');

    // 2. Letra y acordes proyectados con éxito
    assert.strictEqual(result.view.getAllLyrics().length, 5);
    assert.strictEqual(result.view.getAllChords().length, 4);

    // 3. Invariante crítico: CERO notas artificiales de melodía inventadas
    assert.strictEqual(result.view.getAllNotes().length, 0);
  });
});
