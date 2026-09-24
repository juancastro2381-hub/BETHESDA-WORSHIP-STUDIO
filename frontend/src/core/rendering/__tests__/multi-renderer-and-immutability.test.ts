/**
 * @file multi-renderer-and-immutability.test.ts
 * @description Pruebas de inmutabilidad del modelo canónico ante renderizado,
 * independencia simultánea entre múltiples renderizadores y determinismo de conversión.
 */

import assert from 'node:assert';
import { describe, it } from 'node:test';
import { InstrumentRegistry } from '../../projection/instrument-profile.ts';
import { ProjectionService } from '../../projection/projection-service.ts';
import { ViewPreference } from '../../projection/view-preference.ts';
import { createCanonicalSongGMajorWithNotes } from '../../projection/fixtures/golden-scenarios.ts';
import { AlphaTabAdapter } from '../adapters/alphatab-adapter.ts';
import { LeadSheetDomAdapter } from '../adapters/leadsheet-dom-adapter.ts';
import { OsmdAdapter } from '../adapters/osmd-adapter.ts';

describe('Multi-Renderer Independence and Immutability Tests', () => {
  const instruments = new InstrumentRegistry();

  it('10. should guarantee canonical model immutability during and after rendering operations', () => {
    const canonicalSong = createCanonicalSongGMajorWithNotes();
    const initialJson = JSON.stringify(canonicalSong);

    const guitar = instruments.getOrThrow('acoustic_guitar');
    const pref = new ViewPreference({
      instrumentId: 'acoustic_guitar',
      primaryRepresentation: 'TABLATURE',
      secondaryRepresentations: ['CHORDS', 'STANDARD_NOTATION'],
      capoFret: 3,
      transpositionSemitones: 2,
    });

    const derivedView = ProjectionService.project(canonicalSong, guitar, pref).view!;

    // Renderizar con AlphaTab
    const alphaTab = new AlphaTabAdapter();
    alphaTab.render(derivedView);

    // Renderizar con LeadSheetDOM
    const leadSheetPref = new ViewPreference({
      instrumentId: 'acoustic_guitar',
      primaryRepresentation: 'CHORDS',
      secondaryRepresentations: ['LYRICS'],
    });
    const leadSheetView = ProjectionService.project(canonicalSong, guitar, leadSheetPref).view!;
    const leadSheet = new LeadSheetDomAdapter();
    leadSheet.render(leadSheetView);

    // Comparación binaria estricta de inmutabilidad
    const finalJson = JSON.stringify(canonicalSong);
    assert.strictEqual(
      finalJson,
      initialJson,
      'El CanonicalMusicPayload fue mutado durante la ejecución de los renderizadores'
    );
  });

  it('16. should support multi-renderer independence simultaneously without state leakage', () => {
    const canonicalSong = createCanonicalSongGMajorWithNotes();

    const guitar = instruments.getOrThrow('acoustic_guitar');
    const piano = instruments.getOrThrow('acoustic_piano');
    const vocal = instruments.getOrThrow('lead_vocal');

    // 1. Vista Guitarra
    const viewGuitar = ProjectionService.project(
      canonicalSong,
      guitar,
      new ViewPreference({
        instrumentId: 'acoustic_guitar',
        primaryRepresentation: 'TABLATURE',
        secondaryRepresentations: ['CHORDS'],
        capoFret: 2,
      })
    ).view!;

    // 2. Vista Piano
    const viewPiano = ProjectionService.project(
      canonicalSong,
      piano,
      new ViewPreference({
        instrumentId: 'acoustic_piano',
        primaryRepresentation: 'GRAND_STAFF',
      })
    ).view!;

    // 3. Vista Vocal
    const viewVocal = ProjectionService.project(
      canonicalSong,
      vocal,
      new ViewPreference({
        instrumentId: 'lead_vocal',
        primaryRepresentation: 'LYRICS',
        secondaryRepresentations: ['CHORDS'],
      })
    ).view!;

    const alphaTab = new AlphaTabAdapter();
    const osmd = new OsmdAdapter();
    const leadSheet = new LeadSheetDomAdapter();

    // Renderizar simultáneamente
    const outAlphaTab = alphaTab.render(viewGuitar);
    const outOsmd = osmd.render(viewPiano);
    const outLeadSheet = leadSheet.render(viewVocal);

    assert.strictEqual(outAlphaTab.success, true);
    assert.strictEqual(outOsmd.success, true);
    assert.strictEqual(outLeadSheet.success, true);

    // Verificar que cada motor contiene sus datos especializados sin colisión
    assert.strictEqual(outAlphaTab.data.tracks[0]!.capo, 2);
    assert.strictEqual(outOsmd.data.stavesCount, 2);
    assert.strictEqual(outLeadSheet.data.sections.length, 1);
  });

  it('17. should guarantee deterministic conversion across repeated runs', () => {
    const canonicalSong = createCanonicalSongGMajorWithNotes();
    const guitar = instruments.getOrThrow('acoustic_guitar');
    const pref = new ViewPreference({
      instrumentId: 'acoustic_guitar',
      primaryRepresentation: 'TABLATURE',
      secondaryRepresentations: ['CHORDS'],
      capoFret: 4,
    });
    const view = ProjectionService.project(canonicalSong, guitar, pref).view!;

    const adapter = new AlphaTabAdapter();
    const run1 = adapter.render(view);
    const run2 = adapter.render(view);

    assert.strictEqual(run1.success, true);
    assert.strictEqual(run2.success, true);
    assert.strictEqual(
      JSON.stringify(run1.data),
      JSON.stringify(run2.data),
      'El renderizado de AlphaTab no es determinista'
    );
  });
});
