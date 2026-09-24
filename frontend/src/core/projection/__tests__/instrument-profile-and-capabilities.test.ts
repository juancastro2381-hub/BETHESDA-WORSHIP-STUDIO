/**
 * @file instrument-profile-and-capabilities.test.ts
 * @description Pruebas de dominio para perfiles de instrumento, matriz de capacidades
 * y validación estricta del invariante "Instrumento ≠ Vista".
 */

import assert from 'node:assert';
import { describe, it } from 'node:test';
import { InstrumentRegistry } from '../instrument-profile.ts';
import { ProjectionService } from '../projection-service.ts';
import { ViewPreference } from '../view-preference.ts';
import { createCanonicalSongGMajorWithNotes } from '../fixtures/golden-scenarios.ts';

describe('InstrumentProfile and Capability Model Tests', () => {
  const registry = new InstrumentRegistry();

  it('should register and retrieve all 11 required instruments plus generic', () => {
    const requiredIds = [
      'acoustic_guitar',
      'electric_guitar',
      'bass',
      'acoustic_piano',
      'keyboard',
      'drums',
      'alto_sax',
      'tenor_sax',
      'trumpet',
      'lead_vocal',
      'backing_vocal',
      'generic',
    ];

    for (const id of requiredIds) {
      const profile = registry.get(id);
      assert.ok(profile, `Instrumento requerido no encontrado: ${id}`);
      assert.strictEqual(profile.id, id);
      assert.ok(profile.supportedRepresentations.size > 0);
    }
  });

  it('should validate Drum/Percussion capabilities correctly', () => {
    const drums = registry.getOrThrow('drums');
    assert.strictEqual(drums.isPercussion, true);
    assert.strictEqual(drums.clef, 'PERCUSSION');
    assert.ok(drums.isRepresentationSupported('PERCUSSION_NOTATION'));
    assert.ok(drums.isRepresentationSupported('SECTION_MARKERS'));
    assert.ok(drums.isRepresentationSupported('LYRICS'));

    // Batería NO soporta tablatura ni pentagrama estándar con notas tonales
    assert.strictEqual(drums.isRepresentationSupported('TABLATURE'), false);
    assert.strictEqual(drums.isRepresentationSupported('GRAND_STAFF'), false);
  });

  it('should preserve the non-negotiable invariant: Instrument ≠ View', () => {
    const guitar = registry.getOrThrow('acoustic_guitar');

    // La guitarra admite múltiples representaciones
    assert.ok(guitar.isRepresentationSupported('STANDARD_NOTATION'));
    assert.ok(guitar.isRepresentationSupported('TABLATURE'));
    assert.ok(guitar.isRepresentationSupported('CHORDS'));
    assert.ok(guitar.isRepresentationSupported('LYRICS'));

    // El músico puede elegir libremente combinaciones admitidas
    const prefTabOnly = new ViewPreference({
      instrumentId: 'acoustic_guitar',
      primaryRepresentation: 'TABLATURE',
    });
    assert.deepStrictEqual(guitar.validateRequestedRepresentations(prefTabOnly.getAllRequestedRepresentations()), {
      valid: true,
      unsupported: [],
    });

    const prefChordsLyrics = new ViewPreference({
      instrumentId: 'acoustic_guitar',
      primaryRepresentation: 'CHORDS',
      secondaryRepresentations: ['LYRICS'],
    });
    assert.deepStrictEqual(guitar.validateRequestedRepresentations(prefChordsLyrics.getAllRequestedRepresentations()), {
      valid: true,
      unsupported: [],
    });

    const prefNotationTab = new ViewPreference({
      instrumentId: 'acoustic_guitar',
      primaryRepresentation: 'STANDARD_NOTATION',
      secondaryRepresentations: ['TABLATURE', 'CHORDS'],
    });
    assert.deepStrictEqual(guitar.validateRequestedRepresentations(prefNotationTab.getAllRequestedRepresentations()), {
      valid: true,
      unsupported: [],
    });
  });

  it('should cleanly reject unsupported view combinations (e.g. Piano + Tablature)', () => {
    const canonicalSong = createCanonicalSongGMajorWithNotes();
    const piano = registry.getOrThrow('acoustic_piano');

    // El pianista pide tablatura (no soportado por piano)
    const invalidPianoPref = new ViewPreference({
      instrumentId: 'acoustic_piano',
      primaryRepresentation: 'TABLATURE',
      secondaryRepresentations: ['CHORDS'],
    });

    const result = ProjectionService.project(canonicalSong, piano, invalidPianoPref);

    assert.strictEqual(result.status, 'UNSUPPORTED_VIEW');
    assert.strictEqual(result.view, undefined);
    assert.strictEqual(result.diagnostics.length, 1);

    const diagnostic = result.diagnostics[0]!;
    assert.strictEqual(diagnostic.severity, 'ERROR');
    assert.strictEqual(diagnostic.code, 'UNSUPPORTED_VIEW_REPRESENTATION');
    assert.ok(
      diagnostic.message.includes('TABLATURE'),
      `El mensaje de diagnóstico debe mencionar TABLATURE: ${diagnostic.message}`
    );
    assert.strictEqual(diagnostic.context?.['instrumentId'], 'acoustic_piano');
  });

  it('should cleanly reject Drums + Grand Staff', () => {
    const canonicalSong = createCanonicalSongGMajorWithNotes();
    const drums = registry.getOrThrow('drums');

    const invalidDrumsPref = new ViewPreference({
      instrumentId: 'drums',
      primaryRepresentation: 'GRAND_STAFF',
    });

    const result = ProjectionService.project(canonicalSong, drums, invalidDrumsPref);
    assert.strictEqual(result.status, 'UNSUPPORTED_VIEW');
    assert.strictEqual(result.diagnostics[0]?.code, 'UNSUPPORTED_VIEW_REPRESENTATION');
  });
});
