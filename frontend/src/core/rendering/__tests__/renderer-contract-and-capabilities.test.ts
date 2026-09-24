/**
 * @file renderer-contract-and-capabilities.test.ts
 * @description Pruebas de cumplimiento del contrato común de renderizado (IMusicRenderer),
 * modelo de capacidades, selección de renderizador y propagación estructurada de errores.
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
import { RendererRegistry } from '../renderer-registry.ts';

describe('Renderer Contract and Capabilities Tests', () => {
  const instruments = new InstrumentRegistry();

  it('1. should register and retrieve all standard renderers in RendererRegistry', () => {
    const registry = new RendererRegistry();
    const all = registry.getAll();
    assert.strictEqual(all.length, 3);

    const alphaTab = registry.get('ALPHATAB');
    assert.ok(alphaTab);
    assert.strictEqual(alphaTab.id, 'ALPHATAB');

    const osmd = registry.get('OSMD');
    assert.ok(osmd);
    assert.strictEqual(osmd.id, 'OSMD');

    const leadSheet = registry.get('LEADSHEET_DOM');
    assert.ok(leadSheet);
    assert.strictEqual(leadSheet.id, 'LEADSHEET_DOM');
  });

  it('2. should select the best renderer based on requested view representations', () => {
    const registry = new RendererRegistry();

    // TABLATURE -> debe seleccionar AlphaTab
    const rendererForTab = registry.selectBestRenderer(['TABLATURE', 'CHORDS']);
    assert.strictEqual(rendererForTab?.id, 'ALPHATAB');

    // GRAND_STAFF -> debe seleccionar OSMD
    const rendererForGrandStaff = registry.selectBestRenderer(['GRAND_STAFF', 'CHORDS']);
    assert.strictEqual(rendererForGrandStaff?.id, 'OSMD');

    // CHORDS + LYRICS (sin pentagrama) -> debe seleccionar LeadSheetDOM
    const rendererForLeadSheet = registry.selectBestRenderer(['CHORDS', 'LYRICS']);
    assert.strictEqual(rendererForLeadSheet?.id, 'LEADSHEET_DOM');

    // STANDARD_NOTATION -> AlphaTab u OSMD compatibles
    const rendererForNotation = registry.selectBestRenderer(['STANDARD_NOTATION']);
    assert.ok(rendererForNotation?.id === 'ALPHATAB' || rendererForNotation?.id === 'OSMD');
  });

  it('3. should enforce common renderer contract compliance (lifecycle: uninitialized -> ready -> render -> dispose)', () => {
    const adapter = new AlphaTabAdapter();
    assert.strictEqual(adapter.status, 'UNINITIALIZED');

    adapter.initialize({ id: 'test-container' });
    assert.strictEqual(adapter.status, 'READY');

    const canonicalSong = createCanonicalSongGMajorWithNotes();
    const guitar = instruments.getOrThrow('acoustic_guitar');
    const pref = new ViewPreference({
      instrumentId: 'acoustic_guitar',
      primaryRepresentation: 'STANDARD_NOTATION',
    });
    const derivedView = ProjectionService.project(canonicalSong, guitar, pref).view!;

    const output = adapter.render(derivedView);
    assert.strictEqual(output.success, true);
    assert.strictEqual(adapter.status, 'READY');

    adapter.dispose();
    assert.strictEqual(adapter.status, 'DISPOSED');

    // Intentar renderizar después de dispose debe fallar de forma estructurada
    const failedOutput = adapter.render(derivedView);
    assert.strictEqual(failedOutput.success, false);
    assert.strictEqual(failedOutput.diagnostics[0]?.code, 'RENDERER_RUNTIME_ERROR');
  });

  it('8. should cleanly reject unsupported representations according to declared capabilities', () => {
    const canonicalSong = createCanonicalSongGMajorWithNotes();
    const piano = instruments.getOrThrow('acoustic_piano');
    const pref = new ViewPreference({
      instrumentId: 'acoustic_piano',
      primaryRepresentation: 'GRAND_STAFF',
    });
    const derivedView = ProjectionService.project(canonicalSong, piano, pref).view!;

    // AlphaTab declara supportsGrandStaff = false y rechaza GRAND_STAFF
    const alphaTab = new AlphaTabAdapter();
    const output = alphaTab.render(derivedView);

    assert.strictEqual(output.success, false);
    assert.strictEqual(output.diagnostics.length, 1);
    assert.strictEqual(output.diagnostics[0]?.code, 'UNSUPPORTED_RENDERER_CAPABILITY');
    assert.ok(output.diagnostics[0]?.message.includes('GRAND_STAFF'));
  });

  it('9. should propagate structured renderer diagnostics without throwing unhandled exceptions', () => {
    const leadSheet = new LeadSheetDomAdapter();

    // Simular paso de vista inválida (null o vacía)
    // @ts-expect-error probando robustez de error en runtime
    const output = leadSheet.render(null);

    assert.strictEqual(output.success, false);
    assert.strictEqual(output.diagnostics.length, 1);
    assert.strictEqual(output.diagnostics[0]?.code, 'INVALID_DERIVED_VIEW');
  });
});
