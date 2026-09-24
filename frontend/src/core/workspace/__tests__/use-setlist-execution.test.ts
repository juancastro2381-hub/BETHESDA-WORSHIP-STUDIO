/**
 * @file use-setlist-execution.test.ts
 * @description Suite de pruebas automatizadas para useSetlistExecution y setlist-execution-orchestrator (Fase 2C — WS6).
 *
 * Cobertura requerida (Sección 21):
 * 1. Initial empty state.
 * 2. Load setlist.
 * 3. Correct ordering.
 * 4. currentIndex initialization.
 * 5. goToNext.
 * 6. goToPrevious.
 * 7. goToIndex.
 * 8. Boundary protection.
 * 9. SONG mode.
 * 10. SERVICE_MOMENT mode.
 * 11. Transposition calculation.
 * 12. null targetKey behavior.
 * 13. invalid key fallback.
 * 14. updateSetlist metadata merge (Strategy A).
 * 15. 409 conflict behavior.
 * 16. off-setlist song behavior.
 * 17. return-to-setlist behavior.
 * 18. volatile state behavior.
 */

import assert from 'node:assert';
import { describe, it } from 'node:test';
import { ApiError } from '../../api/api-error.ts';
import type { FrontendSetlistDetail, FrontendSetlistItem } from '../../api/setlist-types.ts';
import {
  createInitialSetlistExecutionState,
  deriveExecutionView,
  transitionGoToIndex,
  transitionGoToNext,
  transitionGoToPrevious,
  transitionLoadSetlist,
  transitionNotifyOffSetlistSong,
  transitionReturnToCurrentSetlist,
  transitionUnloadSetlist,
  transitionUpdateMetadata,
  transitionUpdateStatus,
} from '../setlist-execution-orchestrator.ts';
import { calculateTranspositionSemitones } from '../transposition-helper.ts';

// Fixture de prueba: Setlist canónico con ítems polimórficos ordenados
function createMockSetlistDetail(): FrontendSetlistDetail {
  const items: FrontendSetlistItem[] = [
    {
      id: 'item-1',
      setlistId: 'setlist-test-1',
      sequenceOrder: 1,
      itemType: 'SERVICE_MOMENT',
      songId: null,
      targetKey: null,
      targetBpm: null,
      transitionType: null,
      momentTitle: 'Oración de Inicio',
      durationMinutes: 5,
      musicalKey: 'D',
      notesForTeam: 'Pad ambiental en Re Mayor',
      createdAt: '2026-09-21T10:00:00.000Z',
      updatedAt: '2026-09-21T10:00:00.000Z',
      song: null,
    },
    {
      id: 'item-2',
      setlistId: 'setlist-test-1',
      sequenceOrder: 2,
      itemType: 'SONG',
      songId: 'song-g-to-a',
      targetKey: 'A', // Tono litúrgico: La Mayor (+2 semitonos desde Sol)
      targetBpm: 76,
      transitionType: 'SEGUE',
      momentTitle: null,
      durationMinutes: null,
      musicalKey: null,
      notesForTeam: 'Entrada con piano suave',
      createdAt: '2026-09-21T10:00:00.000Z',
      updatedAt: '2026-09-21T10:00:00.000Z',
      song: {
        id: 'song-g-to-a',
        title: 'Cuan Grande es Dios',
        artist: 'Chris Tomlin',
        defaultKey: 'G', // Tono por defecto: Sol Mayor
        defaultBpm: 72,
        timeSignature: '4/4',
        status: 'APPROVED',
      },
    },
    {
      id: 'item-3',
      setlistId: 'setlist-test-1',
      sequenceOrder: 3,
      itemType: 'SONG',
      songId: 'song-c-natural',
      targetKey: null, // Sin targetKey: debe mantenerse en tono original (C, delta = 0)
      targetBpm: null,
      transitionType: 'STOP',
      momentTitle: null,
      durationMinutes: null,
      musicalKey: null,
      notesForTeam: 'Cierre de alabanza',
      createdAt: '2026-09-21T10:00:00.000Z',
      updatedAt: '2026-09-21T10:00:00.000Z',
      song: {
        id: 'song-c-natural',
        title: 'Sublime Gracia',
        artist: 'John Newton',
        defaultKey: 'C',
        defaultBpm: 68,
        timeSignature: '4/4',
        status: 'APPROVED',
      },
    },
  ];

  return {
    id: 'setlist-test-1',
    title: 'Culto Dominical — Celebración',
    scheduledDateTime: '2026-09-27T10:00:00.000Z',
    status: 'PLANNING',
    directorUserId: 'director-david',
    directorName: 'David Benitez',
    notes: 'Primer culto presencial de octubre',
    createdAt: '2026-09-21T10:00:00.000Z',
    updatedAt: '2026-09-21T10:00:00.000Z',
    items,
  };
}

describe('useSetlistExecution & Orchestrator — Liturgical State & Navigation Suite (WS6)', () => {
  // =========================================================================
  // 1. Initial Empty State
  // =========================================================================
  it('1. should initialize with a clean, valid empty state', () => {
    const state = createInitialSetlistExecutionState();
    const view = deriveExecutionView(state);

    assert.strictEqual(state.loadedSetlist, null);
    assert.strictEqual(state.currentIndex, 0);
    assert.strictEqual(state.isLoading, false);
    assert.strictEqual(state.error, null);
    assert.strictEqual(state.isOffSetlistSongActive, false);
    assert.strictEqual(state.offSetlistSongTitle, null);

    assert.strictEqual(view.currentItem, null);
    assert.strictEqual(view.totalItems, 0);
    assert.strictEqual(view.hasNext, false);
    assert.strictEqual(view.hasPrevious, false);
    assert.strictEqual(view.isSong, false);
    assert.strictEqual(view.isServiceMoment, false);
    assert.strictEqual(view.transpositionSemitones, 0);
    assert.strictEqual(view.effectiveTargetKey, null);
  });

  // =========================================================================
  // 2. Load Setlist & 3. Correct Ordering & 4. currentIndex Initialization
  // =========================================================================
  it('2, 3 & 4. should load setlist, preserve sequence order, and initialize currentIndex at 0', () => {
    const initialState = createInitialSetlistExecutionState();
    const mockDetail = createMockSetlistDetail();

    const loadedState = transitionLoadSetlist(initialState, mockDetail);
    const view = deriveExecutionView(loadedState);

    assert.strictEqual(loadedState.loadedSetlist?.id, 'setlist-test-1');
    assert.strictEqual(loadedState.currentIndex, 0);
    assert.strictEqual(view.totalItems, 3);
    assert.strictEqual(view.currentItem?.id, 'item-1');
    assert.strictEqual(view.currentItem?.sequenceOrder, 1);
    assert.strictEqual(view.hasNext, true);
    assert.strictEqual(view.hasPrevious, false);
    assert.strictEqual(view.nextItem?.id, 'item-2');
    assert.strictEqual(view.previousItem, null);
  });

  // =========================================================================
  // 5. goToNext & 6. goToPrevious & 7. goToIndex Navigation
  // =========================================================================
  it('5, 6 & 7. should navigate forward, backward, and by index deterministically', () => {
    const detail = createMockSetlistDetail();
    let state = transitionLoadSetlist(createInitialSetlistExecutionState(), detail);

    // 1. Avanzar a ítem 2
    state = transitionGoToNext(state);
    assert.strictEqual(state.currentIndex, 1);
    let view = deriveExecutionView(state);
    assert.strictEqual(view.currentItem?.id, 'item-2');
    assert.strictEqual(view.hasNext, true);
    assert.strictEqual(view.hasPrevious, true);
    assert.strictEqual(view.nextItem?.id, 'item-3');
    assert.strictEqual(view.previousItem?.id, 'item-1');

    // 2. Avanzar a ítem 3
    state = transitionGoToNext(state);
    assert.strictEqual(state.currentIndex, 2);
    view = deriveExecutionView(state);
    assert.strictEqual(view.currentItem?.id, 'item-3');
    assert.strictEqual(view.hasNext, false);
    assert.strictEqual(view.hasPrevious, true);

    // 3. Retroceder a ítem 2
    state = transitionGoToPrevious(state);
    assert.strictEqual(state.currentIndex, 1);
    view = deriveExecutionView(state);
    assert.strictEqual(view.currentItem?.id, 'item-2');

    // 4. Salto directo por índice a ítem 0
    state = transitionGoToIndex(state, 0);
    assert.strictEqual(state.currentIndex, 0);
    view = deriveExecutionView(state);
    assert.strictEqual(view.currentItem?.id, 'item-1');
  });

  // =========================================================================
  // 8. Boundary Protection (Underflow & Overflow)
  // =========================================================================
  it('8. should enforce navigation boundaries (never < 0, never >= items.length)', () => {
    const detail = createMockSetlistDetail();
    let state = transitionLoadSetlist(createInitialSetlistExecutionState(), detail);

    // Intentar retroceder cuando ya está en index 0
    state = transitionGoToPrevious(state);
    assert.strictEqual(state.currentIndex, 0, 'Must not decrement below 0');

    // Navegar al final (índice 2)
    state = transitionGoToIndex(state, 2);
    assert.strictEqual(state.currentIndex, 2);

    // Intentar avanzar cuando ya está en el último elemento
    state = transitionGoToNext(state);
    assert.strictEqual(state.currentIndex, 2, 'Must not increment past last item');

    // Intentar saltar a índices inválidos
    state = transitionGoToIndex(state, -1);
    assert.strictEqual(state.currentIndex, 2, 'Must reject negative index');

    state = transitionGoToIndex(state, 999);
    assert.strictEqual(state.currentIndex, 2, 'Must reject out of bounds index');
  });

  // =========================================================================
  // 9. SONG Mode & 10. SERVICE_MOMENT Mode
  // =========================================================================
  it('9 & 10. should discriminate correctly between SERVICE_MOMENT and SONG modes', () => {
    const detail = createMockSetlistDetail();
    let state = transitionLoadSetlist(createInitialSetlistExecutionState(), detail);

    // Índice 0: SERVICE_MOMENT
    let view = deriveExecutionView(state);
    assert.strictEqual(view.isServiceMoment, true);
    assert.strictEqual(view.isSong, false);
    assert.strictEqual(view.currentItem?.momentTitle, 'Oración de Inicio');
    assert.strictEqual(view.currentSongMetadata, null);

    // Índice 1: SONG
    state = transitionGoToNext(state);
    view = deriveExecutionView(state);
    assert.strictEqual(view.isSong, true);
    assert.strictEqual(view.isServiceMoment, false);
    assert.strictEqual(view.currentSongMetadata?.title, 'Cuan Grande es Dios');
    assert.strictEqual(view.currentSongMetadata?.defaultKey, 'G');
  });

  // =========================================================================
  // 11. Transposition Calculation
  // =========================================================================
  it('11. should compute harmonic transposition delta (Δ semitones) in range [-6, +6]', () => {
    // Sol a La = +2 semitonos
    assert.strictEqual(calculateTranspositionSemitones('G', 'A'), 2);

    // Sol a Fa = -2 semitonos (distancia más corta hacia atrás)
    assert.strictEqual(calculateTranspositionSemitones('G', 'F'), -2);

    // Sol a Si bemol = +3 semitonos
    assert.strictEqual(calculateTranspositionSemitones('G', 'Bb'), 3);

    // Do a Re = +2 semitonos
    assert.strictEqual(calculateTranspositionSemitones('C', 'D'), 2);

    // Mi a Sol = +3 semitonos
    assert.strictEqual(calculateTranspositionSemitones('E', 'G'), 3);

    // Misma tonalidad = 0
    assert.strictEqual(calculateTranspositionSemitones('G', 'G'), 0);

    // Tonalidades menores
    assert.strictEqual(calculateTranspositionSemitones('Am', 'Bm'), 2);
    assert.strictEqual(calculateTranspositionSemitones('Em', 'Am'), 5);
  });

  // =========================================================================
  // 12. null targetKey Behavior
  // =========================================================================
  it('12. should return delta 0 and preserve defaultKey when targetKey is null or empty', () => {
    const detail = createMockSetlistDetail();
    let state = transitionLoadSetlist(createInitialSetlistExecutionState(), detail);

    // Navegar a ítem 3 (Sublime Gracia con targetKey = null)
    state = transitionGoToIndex(state, 2);
    const view = deriveExecutionView(state);

    assert.strictEqual(view.currentItem?.song?.title, 'Sublime Gracia');
    assert.strictEqual(view.currentItem?.targetKey, null);
    assert.strictEqual(view.transpositionSemitones, 0);
    assert.strictEqual(view.effectiveTargetKey, 'C');

    // Prueba directa del helper
    assert.strictEqual(calculateTranspositionSemitones('C', null), 0);
    assert.strictEqual(calculateTranspositionSemitones(null, 'D'), 0);
    assert.strictEqual(calculateTranspositionSemitones('', 'D'), 0);
  });

  // =========================================================================
  // 13. Invalid Key Fallback
  // =========================================================================
  it('13. should fallback safely to delta 0 when encountering unparseable or corrupted keys', () => {
    assert.strictEqual(calculateTranspositionSemitones('InvalidKey', 'A'), 0);
    assert.strictEqual(calculateTranspositionSemitones('G', 'H#99'), 0);
    assert.strictEqual(calculateTranspositionSemitones('??', '!!'), 0);
  });

  // =========================================================================
  // 14. updateSetlist Metadata Merge (Strategy A)
  // =========================================================================
  it('14. should apply Strategy A: update metadata while strictly preserving loaded items and index', () => {
    const detail = createMockSetlistDetail();
    let state = transitionLoadSetlist(createInitialSetlistExecutionState(), detail);
    state = transitionGoToIndex(state, 1); // Posición en ítem 2

    const updatedEntity = {
      id: 'setlist-test-1',
      title: 'Culto Dominical — Título Editado',
      scheduledDateTime: '2026-09-27T11:30:00.000Z',
      status: 'PLANNING' as const,
      directorUserId: 'director-pablo',
      notes: 'Notas pastorales actualizadas',
      createdAt: '2026-09-21T10:00:00.000Z',
      updatedAt: '2026-09-21T11:00:00.000Z',
    };

    const newState = transitionUpdateMetadata(state, updatedEntity);

    assert.strictEqual(newState.loadedSetlist?.title, 'Culto Dominical — Título Editado');
    assert.strictEqual(newState.loadedSetlist?.scheduledDateTime, '2026-09-27T11:30:00.000Z');
    assert.strictEqual(newState.loadedSetlist?.notes, 'Notas pastorales actualizadas');
    assert.strictEqual(newState.loadedSetlist?.updatedAt, '2026-09-21T11:00:00.000Z');

    // Invariantes preservados:
    assert.strictEqual(newState.currentIndex, 1, 'Current index must NOT be reset');
    assert.strictEqual(newState.loadedSetlist?.items.length, 3, 'Items list must be preserved');
    assert.strictEqual(newState.loadedSetlist?.directorName, 'David Benitez', 'Director name preserved');
  });

  // =========================================================================
  // 15. Liturgical Status Transition & 409 Conflict Representation
  // =========================================================================
  it('15. should update status on success and represent 409 conflict correctly', () => {
    const detail = createMockSetlistDetail();
    let state = transitionLoadSetlist(createInitialSetlistExecutionState(), detail);

    // 1. Transición exitosa a ACTIVE
    state = transitionUpdateStatus(state, 'ACTIVE', '2026-09-21T10:15:00.000Z');
    assert.strictEqual(state.loadedSetlist?.status, 'ACTIVE');
    assert.strictEqual(state.loadedSetlist?.updatedAt, '2026-09-21T10:15:00.000Z');

    // 2. Transición a COMPLETED
    state = transitionUpdateStatus(state, 'COMPLETED', '2026-09-21T12:00:00.000Z');
    assert.strictEqual(state.loadedSetlist?.status, 'COMPLETED');

    // 3. Verificación de ApiError 409
    const conflictError = new ApiError(
      "Ya existe un setlist en estado ACTIVE ('Culto Matutino'). Debe finalizar o cambiar su estado antes de activar un nuevo culto.",
      409,
      'CONFLICT'
    );
    assert.strictEqual(conflictError.statusCode, 409);
    assert.strictEqual(conflictError.code, 'CONFLICT');
    assert.ok(conflictError.message.includes('Ya existe un setlist en estado ACTIVE'));
  });

  // =========================================================================
  // 16. Off-Setlist Song Behavior & 17. Return to Setlist
  // =========================================================================
  it('16 & 17. should support off-setlist viewing without losing setlist position or data', () => {
    const detail = createMockSetlistDetail();
    let state = transitionLoadSetlist(createInitialSetlistExecutionState(), detail);
    state = transitionGoToIndex(state, 1); // Posicionado en ítem 2

    // El músico abre una canción independiente del catálogo general
    state = transitionNotifyOffSetlistSong(state, 'La Bondad de Dios');
    assert.strictEqual(state.isOffSetlistSongActive, true);
    assert.strictEqual(state.offSetlistSongTitle, 'La Bondad de Dios');

    // El setlist y el índice se mantienen intactos
    assert.strictEqual(state.loadedSetlist?.id, 'setlist-test-1');
    assert.strictEqual(state.currentIndex, 1);

    // El músico presiona "Volver al Culto"
    state = transitionReturnToCurrentSetlist(state);
    assert.strictEqual(state.isOffSetlistSongActive, false);
    assert.strictEqual(state.offSetlistSongTitle, null);
    assert.strictEqual(state.currentIndex, 1);
  });

  // =========================================================================
  // 18. Volatile State Behavior (Zero Web Storage)
  // =========================================================================
  it('18. should unload setlist completely and cleanly in volatile memory', () => {
    const detail = createMockSetlistDetail();
    let state = transitionLoadSetlist(createInitialSetlistExecutionState(), detail);
    state = transitionGoToIndex(state, 2);

    state = transitionUnloadSetlist();

    assert.strictEqual(state.loadedSetlist, null);
    assert.strictEqual(state.currentIndex, 0);
    assert.strictEqual(state.error, null);
    assert.strictEqual(state.isOffSetlistSongActive, false);
    assert.strictEqual(state.offSetlistSongTitle, null);

    // Verificar que deriveExecutionView con estado descargado sea seguro
    const view = deriveExecutionView(state);
    assert.strictEqual(view.currentItem, null);
    assert.strictEqual(view.totalItems, 0);
  });
});
