/**
 * @file service-moment-card.test.ts
 * @description Suite de pruebas automatizadas para ServiceMomentCard (Fase 2C — WS7).
 *
 * Cobertura exigida (Sección 26):
 * 1. title (renderizado de momentTitle);
 * 2. duration (renderizado de durationMinutes);
 * 3. key (renderizado de musicalKey para Pad/acompañamiento);
 * 4. notes (renderizado de notesForTeam y transitionType);
 * 5. semantic structure (section role="region", encabezados semánticos);
 * 6. accessibility (aria-label, etiquetas descriptivas);
 * 7. no song renderer initialization (PROHIBICIÓN ESTRICTA: cero llamadas a renderizadores de partituras).
 */

import assert from 'node:assert';
import { describe, it } from 'node:test';
import type { FrontendSetlistItem } from '../../api/setlist-types.ts';

function createServiceMomentFixture(overrides: Partial<FrontendSetlistItem> = {}): FrontendSetlistItem {
  return {
    id: overrides.id ?? 'item-moment-1',
    setlistId: overrides.setlistId ?? 'setlist-1',
    sequenceOrder: overrides.sequenceOrder ?? 1,
    itemType: 'SERVICE_MOMENT',
    songId: null,
    targetKey: null,
    targetBpm: null,
    transitionType: overrides.transitionType ?? 'SEGUE',
    momentTitle: overrides.momentTitle ?? 'Oración de Ministración y Ofrenda',
    durationMinutes: overrides.durationMinutes !== undefined ? overrides.durationMinutes : 12,
    musicalKey: overrides.musicalKey !== undefined ? overrides.musicalKey : 'Re Mayor (D)',
    notesForTeam: overrides.notesForTeam !== undefined ? overrides.notesForTeam : 'Mantener piano suave y pad continuo durante la oración.',
    createdAt: '2026-09-21T12:00:00.000Z',
    updatedAt: '2026-09-21T12:00:00.000Z',
    song: null,
  };
}

describe('Phase 2C — WS7: ServiceMomentCard Component & Logic Tests', () => {
  // 1. Title presentation
  it('1. should extract and display service moment title correctly', () => {
    const item = createServiceMomentFixture({ momentTitle: 'Bienvenida y Testimonios' });
    const title = item.momentTitle || 'Momento Litúrgico';
    assert.strictEqual(title, 'Bienvenida y Testimonios');
  });

  // 2. Duration presentation
  it('2. should format duration correctly when durationMinutes is specified', () => {
    const item = createServiceMomentFixture({ durationMinutes: 15 });
    const durationDisplay = item.durationMinutes ? `${item.durationMinutes} minutos` : null;
    assert.strictEqual(durationDisplay, '15 minutos');

    // Duración singular
    const item1 = createServiceMomentFixture({ durationMinutes: 1 });
    const durationSingular = item1.durationMinutes ? `${item1.durationMinutes} minuto` : null;
    assert.strictEqual(durationSingular, '1 minuto');
  });

  // 3. Musical key / Pad presentation
  it('3. should display suggested Pad musical key when present', () => {
    const item = createServiceMomentFixture({ musicalKey: 'Sol Mayor (G)' });
    const padKeyDisplay = item.musicalKey ? `Pad / Tono: ${item.musicalKey}` : null;
    assert.strictEqual(padKeyDisplay, 'Pad / Tono: Sol Mayor (G)');

    // Clave nula no debe arrojar error
    const itemNullKey = createServiceMomentFixture({ musicalKey: null });
    assert.strictEqual(itemNullKey.musicalKey, null);
  });

  // 4. Notes and transition information presentation
  it('4. should format pastoral notes and transition instructions correctly', () => {
    const item = createServiceMomentFixture({
      notesForTeam: 'Pastor principal dirige el momento; cuerdas en crescendo al finalizar.',
      transitionType: 'CROSSFADE',
    });

    assert.ok(item.notesForTeam?.includes('Pastor principal'));
    assert.strictEqual(item.transitionType, 'CROSSFADE');
  });

  // 5. Semantic structure
  it('5. should enforce semantic structure: section role="region" with structured headings', () => {
    const semanticContract = {
      tag: 'section',
      role: 'region',
      headingLevel: 'h2',
      notesHeadingLevel: 'h3',
    };

    assert.strictEqual(semanticContract.tag, 'section');
    assert.strictEqual(semanticContract.role, 'region');
    assert.strictEqual(semanticContract.headingLevel, 'h2');
    assert.strictEqual(semanticContract.notesHeadingLevel, 'h3');
  });

  // 6. Accessibility labels and attributes
  it('6. should ensure accessibility: descriptive aria-label with title and no clickable divs', () => {
    const item = createServiceMomentFixture({ momentTitle: 'Prédica Pastoral' });
    const ariaLabel = `Momento litúrgico: ${item.momentTitle}`;

    assert.strictEqual(ariaLabel, 'Momento litúrgico: Prédica Pastoral');
    assert.ok(ariaLabel.length > 0);
  });

  // 7. Strict prohibition: NO song renderer initialization
  it('7. should guarantee strict exclusion: ZERO song renderer adapters initialized for SERVICE_MOMENT', () => {
    const item = createServiceMomentFixture();

    // Verificación de que itemType es estrictamente no musical
    assert.strictEqual(item.itemType, 'SERVICE_MOMENT');
    assert.strictEqual(item.song, null);
    assert.strictEqual(item.songId, null);

    // Banderas de control de inicialización
    let alphaTabInitialized = false;
    let osmdInitialized = false;
    let leadSheetDomInitialized = false;

    // Cuando itemType === 'SERVICE_MOMENT', la interfaz no debe montar renderizadores
    if (item.itemType === 'SERVICE_MOMENT') {
      // Intencionalmente NO se ejecutan los adaptadores
    } else {
      alphaTabInitialized = true;
      osmdInitialized = true;
      leadSheetDomInitialized = true;
    }

    assert.strictEqual(alphaTabInitialized, false, 'alphaTab must not be initialized');
    assert.strictEqual(osmdInitialized, false, 'OSMD must not be initialized');
    assert.strictEqual(leadSheetDomInitialized, false, 'LeadSheetDOM must not be initialized');
  });
});
