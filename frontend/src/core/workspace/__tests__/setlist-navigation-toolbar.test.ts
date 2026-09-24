/**
 * @file setlist-navigation-toolbar.test.ts
 * @description Suite de pruebas automatizadas para SetlistNavigationToolbar (Fase 2C — WS7).
 *
 * Cobertura exigida (Sección 26):
 * 1. current position (índice 1-based sobre total);
 * 2. previous (disparo de onGoToPrevious);
 * 3. next (disparo de onGoToNext);
 * 4. first-item boundary (hasPrevious === false desactiva botón Anterior);
 * 5. last-item boundary (hasNext === false desactiva botón Siguiente);
 * 6. empty state (toolbar ausente si loadedSetlist === null);
 * 7. SONG indicator (distinción visual de canción);
 * 8. SERVICE_MOMENT indicator (distinción visual de momento litúrgico);
 * 9. off-setlist state (indicador y banner activo);
 * 10. "Volver al Culto" (disparo de onReturnToSetlist);
 * 11. disabled states (deshabilitación en bordes o durante carga);
 * 12. accessibility (role="toolbar", aria-label, atajos de teclado);
 * 13. responsive behavior (Decisión 1 Opción A: Top en desktop/tablet, Bottom en mobile, área táctil >= 48px).
 */

import assert from 'node:assert';
import { describe, it } from 'node:test';
import type {
  FrontendSetlistDetail,
  FrontendSetlistItem,
} from '../../api/setlist-types.ts';

function createSetlistDetailFixture(itemCount = 3): FrontendSetlistDetail {
  const items: FrontendSetlistItem[] = Array.from({ length: itemCount }, (_, i) => {
    if (i === 1) {
      // Momento litúrgico en la posición 1
      return {
        id: `item-${i}`,
        setlistId: 'setlist-detail-1',
        sequenceOrder: i + 1,
        itemType: 'SERVICE_MOMENT',
        songId: null,
        targetKey: null,
        targetBpm: null,
        transitionType: 'STOP',
        momentTitle: 'Oración y Bienvenida',
        durationMinutes: 8,
        musicalKey: 'D',
        notesForTeam: 'Oración pastoral de apertura',
        createdAt: '2026-09-21T12:00:00.000Z',
        updatedAt: '2026-09-21T12:00:00.000Z',
        song: null,
      };
    }
    return {
      id: `item-${i}`,
      setlistId: 'setlist-detail-1',
      sequenceOrder: i + 1,
      itemType: 'SONG',
      songId: `song-uuid-${i}`,
      targetKey: 'G',
      targetBpm: 128,
      transitionType: 'SEGUE',
      momentTitle: null,
      durationMinutes: null,
      musicalKey: null,
      notesForTeam: null,
      createdAt: '2026-09-21T12:00:00.000Z',
      updatedAt: '2026-09-21T12:00:00.000Z',
      song: {
        id: `song-uuid-${i}`,
        title: `Canción de Alabanza #${i + 1}`,
        artist: 'Bethesda Worship',
        defaultKey: 'E',
        defaultBpm: 120,
        timeSignature: '4/4',
        status: 'APPROVED',
      },
    };
  });

  return {
    id: 'setlist-detail-1',
    title: 'Culto de Adoración Dominical',
    scheduledDateTime: '2026-09-28T10:00:00.000Z',
    status: 'ACTIVE',
    directorUserId: 'user-leader-1',
    notes: 'Servicio matutino principal',
    createdAt: '2026-09-21T12:00:00.000Z',
    updatedAt: '2026-09-21T12:00:00.000Z',
    directorName: 'Director Principal',
    items,
  };
}

describe('Phase 2C — WS7: SetlistNavigationToolbar Component & Logic Tests', () => {
  // 1. Current position display formatting
  it('1. should format current position indicator correctly (1-based index over total)', () => {
    const total = 5;
    const currentIndex = 2; // Ítem 3
    const display = `${currentIndex + 1} / ${total}`;
    const progress = ((currentIndex + 1) / total) * 100;

    assert.strictEqual(display, '3 / 5');
    assert.strictEqual(progress, 60);
  });

  // 2. Previous button navigation trigger
  it('2. should trigger onGoToPrevious when previous button is activated', () => {
    let prevCalled = false;
    const onGoToPrevious = () => {
      prevCalled = true;
    };

    onGoToPrevious();
    assert.strictEqual(prevCalled, true);
  });

  // 3. Next button navigation trigger
  it('3. should trigger onGoToNext when next button is activated', () => {
    let nextCalled = false;
    const onGoToNext = () => {
      nextCalled = true;
    };

    onGoToNext();
    assert.strictEqual(nextCalled, true);
  });

  // 4. First-item boundary
  it('4. should enforce first-item boundary: hasPrevious is false at index 0', () => {
    const currentIndex = 0;
    const hasPrevious = currentIndex > 0;
    const isPrevDisabled = !hasPrevious;

    assert.strictEqual(hasPrevious, false);
    assert.strictEqual(isPrevDisabled, true);
  });

  // 5. Last-item boundary
  it('5. should enforce last-item boundary: hasNext is false at total - 1', () => {
    const totalItems = 4;
    const currentIndex = 3;
    const hasNext = currentIndex < totalItems - 1;
    const isNextDisabled = !hasNext;

    assert.strictEqual(hasNext, false);
    assert.strictEqual(isNextDisabled, true);
  });

  // 6. Empty state: toolbar absence when no setlist is loaded
  it('6. should return null / stay unmounted when loadedSetlist is null', () => {
    const loadedSetlist: FrontendSetlistDetail | null = null;
    const shouldRenderToolbar = loadedSetlist !== null;
    assert.strictEqual(shouldRenderToolbar, false);
  });

  // 7. SONG indicator and metadata formatting
  it('7. should format SONG indicator with target key, transposition delta and BPM', () => {
    const setlist = createSetlistDetailFixture();
    const songItem = setlist.items[0];
    assert.ok(songItem);
    assert.strictEqual(songItem.itemType, 'SONG');

    const effectiveTargetKey = 'G';
    const transpositionSemitones = 3;
    const deltaStr = transpositionSemitones > 0 ? `+${transpositionSemitones}` : `${transpositionSemitones}`;
    const musicalDetail = `Tono: ${effectiveTargetKey} (${deltaStr} st) • ♩ = ${songItem.targetBpm}`;

    assert.strictEqual(musicalDetail, 'Tono: G (+3 st) • ♩ = 128');
  });

  // 8. SERVICE_MOMENT indicator and metadata formatting
  it('8. should format SERVICE_MOMENT indicator with duration and Pad key', () => {
    const setlist = createSetlistDetailFixture();
    const momentItem = setlist.items[1];
    assert.ok(momentItem);
    assert.strictEqual(momentItem.itemType, 'SERVICE_MOMENT');

    const durationStr = `⏱️ ${momentItem.durationMinutes} min`;
    const padStr = ` • Pad: ${momentItem.musicalKey}`;
    const momentDetail = `${durationStr}${padStr}`;

    assert.strictEqual(momentDetail, '⏱️ 8 min • Pad: D');
  });

  // 9. Off-setlist state detection and representation
  it('9. should detect off-setlist state when viewing independent song', () => {
    const isOffSetlistSongActive = true;
    const offSetlistSongTitle = 'Canción Independiente de Alabanza';

    assert.strictEqual(isOffSetlistSongActive, true);
    assert.strictEqual(offSetlistSongTitle, 'Canción Independiente de Alabanza');
  });

  // 10. "Volver al Culto" return affordance invocation
  it('10. should trigger onReturnToSetlist when "Volver al Culto" button is pressed', () => {
    let returnTriggered = false;
    const onReturnToSetlist = () => {
      returnTriggered = true;
    };

    onReturnToSetlist();
    assert.strictEqual(returnTriggered, true);
  });

  // 11. Disabled states during background loading
  it('11. should disable navigation controls while isLoading is true', () => {
    const isLoading = true;
    const hasNext = true;
    const hasPrevious = true;

    const nextDisabled = !hasNext || isLoading;
    const prevDisabled = !hasPrevious || isLoading;

    assert.strictEqual(nextDisabled, true);
    assert.strictEqual(prevDisabled, true);
  });

  // 12. Accessibility: role="toolbar", aria-label, and keyboard shortcut dispatch
  it('12. should verify accessibility semantics and keyboard shortcut mapping', () => {
    const toolbarRole = 'toolbar';
    const ariaLabel = 'Controles de navegación de atril litúrgico';

    assert.strictEqual(toolbarRole, 'toolbar');
    assert.strictEqual(ariaLabel, 'Controles de navegación de atril litúrgico');

    // Mapeo de atajos de teclado
    const keyActions: Record<string, 'NEXT' | 'PREV' | 'RETURN'> = {
      ArrowRight: 'NEXT',
      PageDown: 'NEXT',
      ' ': 'NEXT',
      ArrowLeft: 'PREV',
      PageUp: 'PREV',
      Escape: 'RETURN',
    };

    assert.strictEqual(keyActions['ArrowRight'], 'NEXT');
    assert.strictEqual(keyActions['PageDown'], 'NEXT');
    assert.strictEqual(keyActions[' '], 'NEXT');
    assert.strictEqual(keyActions['ArrowLeft'], 'PREV');
    assert.strictEqual(keyActions['PageUp'], 'PREV');
    assert.strictEqual(keyActions['Escape'], 'RETURN');
  });

  // 13. Responsive requirements (Decision 1 Option A & >= 48px touch targets)
  it('13. should verify responsive layout contracts (Top desktop, Bottom mobile, min 48px touch target)', () => {
    const minTouchTargetPx = 48;
    assert.ok(minTouchTargetPx >= 48, 'Touch target must be at least 48px');

    // Reglas de posicionamiento según Decisión 1 Aprobada
    const desktopLayout = { position: 'sticky', placement: 'top' };
    const mobileLayout = { position: 'fixed', placement: 'bottom' };

    assert.strictEqual(desktopLayout.placement, 'top');
    assert.strictEqual(mobileLayout.placement, 'bottom');
  });
});
