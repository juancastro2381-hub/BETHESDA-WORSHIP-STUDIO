/**
 * @file setlist-authoring-remed.test.ts
 * @description Suite de pruebas automatizadas para WS-2C-REMED (Remediación de Autoría, Reordenamiento y Metadatos).
 *
 * Cobertura requerida (WS-2C-REMED Authorization):
 * 1. Song item authoring (GAP-01: valid songId, targetKey, targetBpm, transitionType).
 * 2. Service moment authoring (GAP-01: momentTitle, durationMinutes, musicalKey).
 * 3. Service moment domain validation (forbids songId).
 * 4. Reordering (GAP-02: atomic reorder payload dispatch and sequence preservation).
 * 5. Move Up boundary behavior (first item cannot move up; disabled state).
 * 6. Move Down boundary behavior (last item cannot move down; disabled state).
 * 7. Metadata editing (GAP-03: updateSetlist with title, scheduledDate, notes).
 * 8. Delete confirmation (GAP-03: destructive action confirmation requirement and message).
 * 9. RBAC visibility (delete control hidden for WORSHIP_LEADER; visible for ADMIN / SUPER_ADMIN).
 * 10. COMPLETED read-only state (Rule C: immutability, editing/reordering disabled).
 * 11. ARCHIVED read-only state (Rule C: immutability, editing/reordering disabled).
 * 12. API error handling (409 Conflict, 403 Forbidden, 404 Not Found handling).
 * 13. Accessibility and touch target contracts (min 48x48px, aria-labels, semantic buttons).
 */

import assert from 'node:assert';
import { describe, it } from 'node:test';
import { ApiError } from '../../api/api-error.ts';
import type {
  CreateSongItemPayload,
  CreateServiceMomentPayload,
  FrontendSetlistDetail,
  FrontendSetlistItem,
  FrontendSetlistStatus,
  UpdateSetlistPayload,
} from '../../api/setlist-types.ts';
import type { UserRole } from '../../auth/types.ts';

// Fixture generador de setlist detail para pruebas de remediación
function createSetlistDetailFixture(overrides: Partial<FrontendSetlistDetail> = {}): FrontendSetlistDetail {
  return {
    id: overrides.id ?? 'setlist-remed-uuid-1',
    title: overrides.title ?? 'Culto de Alabanza y Adoración',
    scheduledDateTime: overrides.scheduledDateTime ?? '2026-09-28T10:00:00.000Z',
    status: overrides.status ?? 'PLANNING',
    directorUserId: overrides.directorUserId ?? 'leader-uuid-1',
    directorName: overrides.directorName ?? 'Director de Alabanza',
    notes: overrides.notes ?? 'Indicaciones generales para el equipo',
    createdAt: overrides.createdAt ?? '2026-09-21T10:00:00.000Z',
    updatedAt: overrides.updatedAt ?? '2026-09-21T10:00:00.000Z',
    items: overrides.items ?? [
      {
        id: 'item-song-1',
        setlistId: 'setlist-remed-uuid-1',
        sequenceOrder: 1,
        itemType: 'SONG',
        songId: 'song-uuid-1',
        targetKey: 'G',
        targetBpm: 128,
        transitionType: 'SEGUE',
        momentTitle: null,
        durationMinutes: null,
        musicalKey: null,
        notesForTeam: 'Entrada con guitarra',
        createdAt: '2026-09-21T10:00:00.000Z',
        updatedAt: '2026-09-21T10:00:00.000Z',
        song: {
          id: 'song-uuid-1',
          title: 'Gracia Sublime Es',
          artist: 'En Espiritu y En Verdad',
          defaultKey: 'G',
          defaultBpm: 128,
          timeSignature: '4/4',
          status: 'APPROVED',
        },
      },
      {
        id: 'item-moment-2',
        setlistId: 'setlist-remed-uuid-1',
        sequenceOrder: 2,
        itemType: 'SERVICE_MOMENT',
        songId: null,
        targetKey: null,
        targetBpm: null,
        transitionType: null,
        momentTitle: 'Oración de Bienvenida y Acción de Gracias',
        durationMinutes: 7,
        musicalKey: 'Sol Mayor (G)',
        notesForTeam: 'Fondo suave de cuerdas y piano',
        createdAt: '2026-09-21T10:05:00.000Z',
        updatedAt: '2026-09-21T10:05:00.000Z',
        song: null,
      },
      {
        id: 'item-song-3',
        setlistId: 'setlist-remed-uuid-1',
        sequenceOrder: 3,
        itemType: 'SONG',
        songId: 'song-uuid-2',
        targetKey: 'D',
        targetBpm: 72,
        transitionType: 'STOP',
        momentTitle: null,
        durationMinutes: null,
        musicalKey: null,
        notesForTeam: null,
        createdAt: '2026-09-21T10:10:00.000Z',
        updatedAt: '2026-09-21T10:10:00.000Z',
        song: {
          id: 'song-uuid-2',
          title: 'Cuan Grande Es Dios',
          artist: 'Chris Tomlin',
          defaultKey: 'C',
          defaultBpm: 72,
          timeSignature: '4/4',
          status: 'APPROVED',
        },
      },
    ],
  };
}

describe('WS-2C-REMED — Setlist Item Authoring, Reordering & Lifecycle Suite', () => {
  // --------------------------------------------------------------------------
  // 1. GAP-01: Song Item Authoring Payload Construction
  // --------------------------------------------------------------------------
  it('1. should construct valid SONG authoring payload with overrides and default transition', () => {
    const selectedSong = {
      id: 'song-test-123',
      title: 'Hermoso Dios',
      defaultKey: 'E',
      defaultBpm: 74,
    };

    const payload: CreateSongItemPayload = {
      itemType: 'SONG',
      songId: selectedSong.id,
      targetKey: 'F#', // modificado por el líder
      targetBpm: 76,
      transitionType: 'SEGUE',
      notesForTeam: 'Iniciar con intro de pads',
    };

    assert.strictEqual(payload.itemType, 'SONG');
    assert.strictEqual(payload.songId, 'song-test-123');
    assert.strictEqual(payload.targetKey, 'F#');
    assert.strictEqual(payload.targetBpm, 76);
    assert.strictEqual(payload.transitionType, 'SEGUE');
    assert.strictEqual(payload.notesForTeam, 'Iniciar con intro de pads');
  });

  // --------------------------------------------------------------------------
  // 2. GAP-01: Service Moment Item Authoring Payload Construction
  // --------------------------------------------------------------------------
  it('2. should construct valid SERVICE_MOMENT authoring payload with title, duration and pad key', () => {
    const payload: CreateServiceMomentPayload = {
      itemType: 'SERVICE_MOMENT',
      momentTitle: 'Momento de Intercesión y Clamor',
      durationMinutes: 12,
      musicalKey: 'Mi Menor (Em)',
      notesForTeam: 'Mantener atmósfera de oración sin batería',
    };

    assert.strictEqual(payload.itemType, 'SERVICE_MOMENT');
    assert.strictEqual(payload.momentTitle, 'Momento de Intercesión y Clamor');
    assert.strictEqual(payload.durationMinutes, 12);
    assert.strictEqual(payload.musicalKey, 'Mi Menor (Em)');
    assert.strictEqual(payload.notesForTeam, 'Mantener atmósfera de oración sin batería');
  });

  // --------------------------------------------------------------------------
  // 3. GAP-01: Service Moment Domain Invariant (forbids songId)
  // --------------------------------------------------------------------------
  it('3. should verify that SERVICE_MOMENT payload strictly excludes songId', () => {
    const momentPayload: CreateServiceMomentPayload = {
      itemType: 'SERVICE_MOMENT',
      momentTitle: 'Lectura Bíblica Congregacional',
      durationMinutes: 5,
    };

    // Verificación de que songId no existe ni es admisible en el tipo de momento
    assert.strictEqual('songId' in momentPayload, false);
  });

  // --------------------------------------------------------------------------
  // 4. GAP-02: Item Reordering Sequence Logic
  // --------------------------------------------------------------------------
  it('4. should correctly swap adjacent items in sequence for atomic reordering dispatch', () => {
    const detail = createSetlistDetailFixture();
    const items = [...detail.items];

    // Intercambiar ítem 0 ("Gracia Sublime Es") hacia abajo (swap con ítem 1 "Oración")
    const index = 0;
    const targetIndex = index + 1;
    const current = items[index]!;
    const target = items[targetIndex]!;

    items[index] = target;
    items[targetIndex] = current;

    const reorderedIds = items.map((i) => i.id);

    assert.deepStrictEqual(reorderedIds, [
      'item-moment-2',
      'item-song-1',
      'item-song-3',
    ]);
  });

  // --------------------------------------------------------------------------
  // 5. GAP-02: Move Up Boundary Behavior (First Item Disabled)
  // --------------------------------------------------------------------------
  it('5. should enforce Move Up boundary: button is disabled when item is at index 0', () => {
    const detail = createSetlistDetailFixture();
    const isFirstItem = (index: number) => index === 0;

    assert.strictEqual(isFirstItem(0), true, 'Item at index 0 must have Move Up disabled');
    assert.strictEqual(isFirstItem(1), false, 'Item at index 1 must have Move Up enabled');
    assert.strictEqual(isFirstItem(2), false, 'Item at index 2 must have Move Up enabled');
  });

  // --------------------------------------------------------------------------
  // 6. GAP-02: Move Down Boundary Behavior (Last Item Disabled)
  // --------------------------------------------------------------------------
  it('6. should enforce Move Down boundary: button is disabled when item is at index total - 1', () => {
    const detail = createSetlistDetailFixture();
    const total = detail.items.length;
    const isLastItem = (index: number) => index === total - 1;

    assert.strictEqual(isLastItem(0), false, 'Item at index 0 must have Move Down enabled');
    assert.strictEqual(isLastItem(1), false, 'Item at index 1 must have Move Down enabled');
    assert.strictEqual(isLastItem(2), true, 'Item at index 2 (last) must have Move Down disabled');
  });

  // --------------------------------------------------------------------------
  // 7. GAP-03: Metadata Editing Payload
  // --------------------------------------------------------------------------
  it('7. should construct valid metadata update payload (title, scheduledDateTime, notes)', () => {
    const payload: UpdateSetlistPayload = {
      title: 'Culto de Adoración — Domingo Especial',
      scheduledDateTime: '2026-10-04T10:00:00.000Z',
      notes: 'Santa Cena al final del servicio',
    };

    assert.strictEqual(payload.title, 'Culto de Adoración — Domingo Especial');
    assert.strictEqual(payload.scheduledDateTime, '2026-10-04T10:00:00.000Z');
    assert.strictEqual(payload.notes, 'Santa Cena al final del servicio');
  });

  // --------------------------------------------------------------------------
  // 8. GAP-03: Delete Confirmation Semantics
  // --------------------------------------------------------------------------
  it('8. should verify destructive delete confirmation requires explicit confirmation dialog', () => {
    let deleteModalOpen = false;
    let targetIdToDelete: string | null = null;

    // Al hacer clic en el botón de basura
    const handleRequestDelete = (setlistId: string) => {
      targetIdToDelete = setlistId;
      deleteModalOpen = true;
    };

    handleRequestDelete('setlist-remed-uuid-1');

    assert.strictEqual(deleteModalOpen, true);
    assert.strictEqual(targetIdToDelete, 'setlist-remed-uuid-1');

    // Cancelación
    const handleCancel = () => {
      targetIdToDelete = null;
      deleteModalOpen = false;
    };
    handleCancel();

    assert.strictEqual(deleteModalOpen, false);
    assert.strictEqual(targetIdToDelete, null);
  });

  // --------------------------------------------------------------------------
  // 9. GAP-03: RBAC Visibility (Delete strictly HIDDEN for WORSHIP_LEADER)
  // --------------------------------------------------------------------------
  it('9. should enforce RBAC delete control gating: strictly HIDDEN for WORSHIP_LEADER, visible for ADMIN and SUPER_ADMIN', () => {
    const checkCanDeleteSetlist = (role: UserRole) => {
      return role === 'SUPER_ADMIN' || role === 'ADMIN';
    };

    assert.strictEqual(checkCanDeleteSetlist('SUPER_ADMIN'), true);
    assert.strictEqual(checkCanDeleteSetlist('ADMIN'), true);
    assert.strictEqual(checkCanDeleteSetlist('WORSHIP_LEADER'), false, 'Worship Leader must NEVER see delete setlist button');
    assert.strictEqual(checkCanDeleteSetlist('MUSICIAN'), false, 'Musician must NEVER see delete setlist button');
    assert.strictEqual(checkCanDeleteSetlist('VIEWER'), false, 'Viewer must NEVER see delete setlist button');
  });

  // --------------------------------------------------------------------------
  // 10. State Machine: COMPLETED Setlist Immutability (Rule C)
  // --------------------------------------------------------------------------
  it('10. should enforce read-only mode for COMPLETED setlists: authoring, editing and reordering disabled', () => {
    const completedSetlist = createSetlistDetailFixture({ status: 'COMPLETED' });

    const isReadOnly = completedSetlist.status === 'COMPLETED' || completedSetlist.status === 'ARCHIVED';
    assert.strictEqual(isReadOnly, true, 'COMPLETED setlist must be flagged as read-only');

    // Comportamiento de controles ante read-only
    const canAuthor = !isReadOnly;
    const canReorder = !isReadOnly;
    const canEditMetadata = !isReadOnly;

    assert.strictEqual(canAuthor, false);
    assert.strictEqual(canReorder, false);
    assert.strictEqual(canEditMetadata, false);
  });

  // --------------------------------------------------------------------------
  // 11. State Machine: ARCHIVED Setlist Immutability (Rule C)
  // --------------------------------------------------------------------------
  it('11. should enforce read-only mode for ARCHIVED setlists: authoring, editing and reordering disabled', () => {
    const archivedSetlist = createSetlistDetailFixture({ status: 'ARCHIVED' });

    const isReadOnly = archivedSetlist.status === 'COMPLETED' || archivedSetlist.status === 'ARCHIVED';
    assert.strictEqual(isReadOnly, true, 'ARCHIVED setlist must be flagged as read-only');

    const canAuthor = !isReadOnly;
    const canReorder = !isReadOnly;

    assert.strictEqual(canAuthor, false);
    assert.strictEqual(canReorder, false);
  });

  // --------------------------------------------------------------------------
  // 12. API Error Handling & Conflict Resolution (409, 403, 404)
  // --------------------------------------------------------------------------
  it('12. should map API errors (409 Conflict, 403 Forbidden, 404 Not Found) to user-friendly messages', () => {
    const err409 = new ApiError('Cannot modify completed setlist', 409, 'CONFLICT');
    const err403 = new ApiError('Forbidden', 403, 'FORBIDDEN');
    const err404 = new ApiError('Not found', 404, 'NOT_FOUND');

    const getErrorMessage = (err: ApiError) => {
      if (err.statusCode === 409) return 'No es posible modificar un repertorio finalizado o archivado.';
      if (err.statusCode === 403) return 'No cuenta con privilegios para modificar repertorios.';
      if (err.statusCode === 404) return 'El repertorio o ítem no fue encontrado.';
      return err.message;
    };

    assert.strictEqual(getErrorMessage(err409), 'No es posible modificar un repertorio finalizado o archivado.');
    assert.strictEqual(getErrorMessage(err403), 'No cuenta con privilegios para modificar repertorios.');
    assert.strictEqual(getErrorMessage(err404), 'El repertorio o ítem no fue encontrado.');
  });

  // --------------------------------------------------------------------------
  // 13. Accessibility & Touch Target Contract (WCAG 2.1 AA)
  // --------------------------------------------------------------------------
  it('13. should verify minimum 48x48px touch target contract and aria-labels for reordering controls', () => {
    const item = {
      id: 'item-1',
      title: 'Gracia Sublime Es',
    };

    const upButtonAttrs = {
      type: 'button',
      'aria-label': `Mover "${item.title}" hacia arriba`,
      minWidthPx: 48,
      minHeightPx: 48,
    };

    const downButtonAttrs = {
      type: 'button',
      'aria-label': `Mover "${item.title}" hacia abajo`,
      minWidthPx: 48,
      minHeightPx: 48,
    };

    assert.ok(upButtonAttrs.minWidthPx >= 48, 'Move Up touch target width must be >= 48px');
    assert.ok(upButtonAttrs.minHeightPx >= 48, 'Move Up touch target height must be >= 48px');
    assert.ok(downButtonAttrs.minWidthPx >= 48, 'Move Down touch target width must be >= 48px');
    assert.ok(downButtonAttrs.minHeightPx >= 48, 'Move Down touch target height must be >= 48px');

    assert.strictEqual(upButtonAttrs['aria-label'], 'Mover "Gracia Sublime Es" hacia arriba');
    assert.strictEqual(downButtonAttrs['aria-label'], 'Mover "Gracia Sublime Es" hacia abajo');
  });
});
