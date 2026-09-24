/**
 * @file views-and-multi-musician.test.ts
 * @description Pruebas de proyección concurrente para múltiples músicos, inmutabilidad canónica,
 * determinismo de proyección y soporte de notación americana vs latina.
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

describe('Views, Multi-Musician and Immutability Projection Tests', () => {
  const registry = new InstrumentRegistry();

  it('14. should project Piano notation view with Grand Staff (Treble + Bass clefs)', () => {
    const canonicalSong = createCanonicalSongGMajorWithNotes();
    const piano = registry.getOrThrow('acoustic_piano');

    const pref = new ViewPreference({
      instrumentId: 'acoustic_piano',
      primaryRepresentation: 'GRAND_STAFF',
    });

    const result = ProjectionService.project(canonicalSong, piano, pref);
    assert.strictEqual(result.status, 'SUCCESS');
    assert.ok(result.view);

    const m1 = result.view.measures[0]!;
    assert.deepStrictEqual(m1.clefs, ['TREBLE', 'BASS']);
  });

  it('15. should project Piano chords + lyrics without requiring staff rendering', () => {
    const canonicalSong = createCanonicalSongGMajorWithNotes();
    const piano = registry.getOrThrow('acoustic_piano');

    const pref = new ViewPreference({
      instrumentId: 'acoustic_piano',
      primaryRepresentation: 'CHORDS',
      secondaryRepresentations: ['LYRICS'],
    });

    const result = ProjectionService.project(canonicalSong, piano, pref);
    assert.strictEqual(result.status, 'SUCCESS');
    assert.ok(result.view);

    assert.ok(result.view.getAllChords().length > 0);
    assert.ok(result.view.getAllLyrics().length > 0);
  });

  it('18. should project Vocal lyrics + chords without inventing melody notes when canonical has none', () => {
    const canonicalChordProSong = createCanonicalSongGMajorChordsAndLyricsOnly();
    const vocal = registry.getOrThrow('lead_vocal');

    const pref = new ViewPreference({
      instrumentId: 'lead_vocal',
      primaryRepresentation: 'LYRICS',
      secondaryRepresentations: ['CHORDS'],
    });

    const result = ProjectionService.project(canonicalChordProSong, vocal, pref);
    assert.strictEqual(result.status, 'SUCCESS');
    assert.ok(result.view);

    // Debe contener letra y acordes
    assert.strictEqual(result.view.getAllLyrics().length, 5);
    assert.strictEqual(result.view.getAllChords().length, 4);

    // Invariante no negociable: CERO notas inventadas
    assert.strictEqual(result.view.getAllNotes().length, 0);
  });

  it('21. should support multiple simultaneous musician projections from the exact same canonical song', () => {
    const canonicalSong = createCanonicalSongGMajorWithNotes();

    // Músico A: Guitarrista (Capo 2, Tablatura + Cifrado)
    const guitarProfile = registry.getOrThrow('acoustic_guitar');
    const prefA = new ViewPreference({
      instrumentId: 'acoustic_guitar',
      primaryRepresentation: 'TABLATURE',
      secondaryRepresentations: ['CHORDS'],
      capoFret: 2,
    });
    const viewA = ProjectionService.project(canonicalSong, guitarProfile, prefA).view!;

    // Músico B: Pianista (Grand Staff + Cifrado)
    const pianoProfile = registry.getOrThrow('acoustic_piano');
    const prefB = new ViewPreference({
      instrumentId: 'acoustic_piano',
      primaryRepresentation: 'GRAND_STAFF',
      secondaryRepresentations: ['CHORDS'],
    });
    const viewB = ProjectionService.project(canonicalSong, pianoProfile, prefB).view!;

    // Músico C: Saxofón Alto (Notación escrita en Eb)
    const saxProfile = registry.getOrThrow('alto_sax');
    const prefC = new ViewPreference({
      instrumentId: 'alto_sax',
      primaryRepresentation: 'STANDARD_NOTATION',
    });
    const viewC = ProjectionService.project(canonicalSong, saxProfile, prefC).view!;

    // Músico D: Voz Principal (Letra + Cifrado en Español/Latino)
    const vocalProfile = registry.getOrThrow('lead_vocal');
    const prefD = new ViewPreference({
      instrumentId: 'lead_vocal',
      primaryRepresentation: 'LYRICS',
      secondaryRepresentations: ['CHORDS'],
      chordNotationSystem: 'LATIN',
    });
    const viewD = ProjectionService.project(canonicalSong, vocalProfile, prefD).view!;

    // Validar independencia absoluta de cada proyección:
    // Músico A ve acordes de digitación en F
    assert.strictEqual(viewA.getAllChords()[0]!.displayString, 'F');
    assert.ok(viewA.getAllTabPositions().length > 0);

    // Músico B ve dos claves (TREBLE + BASS) y acordes en G
    assert.deepStrictEqual(viewB.measures[0]!.clefs, ['TREBLE', 'BASS']);
    assert.strictEqual(viewB.getAllChords()[0]!.displayString, 'G');

    // Músico C ve clave de armadura escrita de E Mayor (+9 semitonos) y notas transpuestas
    assert.strictEqual(viewC.writtenKey.tonic.toString(), 'E');
    assert.strictEqual(viewC.getAllNotes()[0]!.writtenPitch.toString(), 'E5');

    // Músico D ve acordes en Solfeo Latino: "Sol" en lugar de "G"
    assert.strictEqual(viewD.getAllChords()[0]!.displayString, 'Sol');
    assert.strictEqual(viewD.getAllChords()[1]!.displayString, 'Mim');
  });

  it('22. should guarantee canonical source immutability across projections', () => {
    const canonicalSong = createCanonicalSongGMajorWithNotes();

    // Serializar estado inicial para comparación binaria
    const initialJson = JSON.stringify(canonicalSong);

    // Ejecutar múltiples proyecciones extremas
    const saxProfile = registry.getOrThrow('alto_sax');
    const prefTransposed = new ViewPreference({
      instrumentId: 'alto_sax',
      primaryRepresentation: 'STANDARD_NOTATION',
      transpositionSemitones: 5,
    });
    ProjectionService.project(canonicalSong, saxProfile, prefTransposed);

    const guitarProfile = registry.getOrThrow('acoustic_guitar');
    const prefCapo = new ViewPreference({
      instrumentId: 'acoustic_guitar',
      primaryRepresentation: 'TABLATURE',
      capoFret: 7,
    });
    ProjectionService.project(canonicalSong, guitarProfile, prefCapo);

    // Verificar que el payload canónico no cambió un solo bit
    const afterJson = JSON.stringify(canonicalSong);
    assert.strictEqual(afterJson, initialJson, 'El CanonicalMusicPayload fue mutado durante la proyección');
  });

  it('23. should guarantee deterministic projection (identical inputs produce identical results)', () => {
    const canonicalSong = createCanonicalSongGMajorWithNotes();
    const guitarProfile = registry.getOrThrow('electric_guitar');
    const pref = new ViewPreference({
      instrumentId: 'electric_guitar',
      primaryRepresentation: 'TABLATURE',
      secondaryRepresentations: ['CHORDS', 'STANDARD_NOTATION'],
      capoFret: 3,
    });

    const run1 = ProjectionService.project(canonicalSong, guitarProfile, pref);
    const run2 = ProjectionService.project(canonicalSong, guitarProfile, pref);

    assert.strictEqual(run1.status, 'SUCCESS');
    assert.strictEqual(run2.status, 'SUCCESS');

    // Comprobar determinismo campo a campo
    assert.strictEqual(
      JSON.stringify(run1.view?.getAllNotes()),
      JSON.stringify(run2.view?.getAllNotes())
    );
    assert.strictEqual(
      JSON.stringify(run1.view?.getAllChords()),
      JSON.stringify(run2.view?.getAllChords())
    );
    assert.strictEqual(
      JSON.stringify(run1.view?.getAllTabPositions()),
      JSON.stringify(run2.view?.getAllTabPositions())
    );
  });
});
