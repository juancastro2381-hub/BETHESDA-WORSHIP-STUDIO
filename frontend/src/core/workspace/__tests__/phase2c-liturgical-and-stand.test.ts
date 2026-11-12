/**
 * @file phase2c-liturgical-and-stand.test.ts
 * @description Suite de pruebas de unidad e integración para Fase 2C:
 * Gestión Litúrgica de Setlists, Cultos y Eventos, Configuración Musical por Entrada,
 * Precedencia de Preferencias Individuales y Modo Atril (Music Stand Experience).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { InstrumentRegistry } from '../../projection/instrument-profile.ts';
import { GOLDEN_SCENARIO_PRESETS } from '../presets.ts';
import { CanonicalMusicPayload } from '../../canonical-model/canonical-music-payload.ts';
import { Measure } from '../../canonical-model/measure.ts';
import {
  DEFAULT_STAND_ZOOM,
  MAX_STAND_ZOOM,
  MIN_STAND_ZOOM,
  clampStandZoom,
  createInitialMusicStandDisplayState,
  detectStandOrientation,
  filterWorshipServices,
  readingFormatToSelectorId,
  resolveEffectiveStandView,
  resolveReadingFormatForSong,
  selectorIdToReadingFormat,
  zoomInStand,
  zoomOutStand,
} from '../music-stand-controller.ts';
import { BethesdaApiClient } from '../../api/api-client.ts';
import {
  READING_FORMAT_LABELS,
  WORSHIP_SERVICE_STATUS_LABELS,
  type FrontendSetlistItem,
  type FrontendWorshipService,
} from '../../api/setlist-types.ts';
import type { UserViewPreferenceData } from '../../api/preference-types.ts';

describe('Phase 2C — Liturgical Setlist Management, Worship Services & Music Stand Suite', () => {
  const instrumentRegistry = new InstrumentRegistry();

  function createLeadSheetWithoutNotes(): CanonicalMusicPayload {
    const base = GOLDEN_SCENARIO_PRESETS.SCENARIO_A.canonicalSongFactory();
    const measures = base.measures.map(
      (m) =>
        new Measure({
          number: m.number,
          timeSignature: m.timeSignature,
          keySignature: m.keySignature,
          startTick: m.startTick,
          durationTicks: m.durationTicks,
          voices: [],
          chords: [...m.chords],
          lyrics: [...m.lyrics],
        })
    );
    return new CanonicalMusicPayload({
      title: 'Cántico Lead Sheet Sin Notas',
      timeline: base.timeline,
      measures,
      sections: [...base.sections],
    });
  }

  // =========================================================================
  // 1. CONTROLES DE MODO ATRIL (ZOOM, ORIENTACIÓN, ESTADO INICIAL)
  // =========================================================================

  it('1.1 should initialize Music Stand display state and enforce zoom bounds (80% - 160%)', () => {
    const init = createInitialMusicStandDisplayState();
    assert.equal(init.isMusicStandMode, false);
    assert.equal(init.isHighContrast, false);
    assert.equal(init.zoomPercent, DEFAULT_STAND_ZOOM);

    assert.equal(zoomInStand(100), 110);
    assert.equal(zoomOutStand(100), 90);
    assert.equal(clampStandZoom(50), MIN_STAND_ZOOM);
    assert.equal(clampStandZoom(220), MAX_STAND_ZOOM);
    assert.equal(clampStandZoom(Number.NaN), DEFAULT_STAND_ZOOM);
    assert.equal(zoomInStand(MAX_STAND_ZOOM), MAX_STAND_ZOOM);
    assert.equal(zoomOutStand(MIN_STAND_ZOOM), MIN_STAND_ZOOM);
  });

  it('1.2 should detect LANDSCAPE vs PORTRAIT stand orientation deterministically', () => {
    assert.equal(detectStandOrientation(1024, 768), 'LANDSCAPE');
    assert.equal(detectStandOrientation(1000, 1000), 'LANDSCAPE');
    assert.equal(detectStandOrientation(768, 1024), 'PORTRAIT');
  });

  it('1.3 should map reading format identifiers bidirectionally and provide human-readable labels', () => {
    assert.equal(readingFormatToSelectorId('SCORE'), 'STAFF_NOTATION');
    assert.equal(readingFormatToSelectorId('CHORD_SHEET'), 'CHORD_CHART');
    assert.equal(readingFormatToSelectorId('LYRICS'), 'LYRICS_ONLY');
    assert.equal(readingFormatToSelectorId('TAB'), 'TABLATURE');

    assert.equal(selectorIdToReadingFormat('STAFF_NOTATION'), 'SCORE');
    assert.equal(selectorIdToReadingFormat('CHORD_CHART'), 'CHORD_SHEET');
    assert.equal(selectorIdToReadingFormat('LYRICS_ONLY'), 'LYRICS');
    assert.equal(selectorIdToReadingFormat('TABLATURE'), 'TAB');

    assert.equal(READING_FORMAT_LABELS.SCORE, 'Partitura');
    assert.equal(READING_FORMAT_LABELS.CHORD_SHEET, 'Cifrado / Acordes');
    assert.equal(READING_FORMAT_LABELS.LYRICS, 'Letra');
    assert.equal(READING_FORMAT_LABELS.TAB, 'Tablatura');
  });

  // =========================================================================
  // 2. ZERO-FABRICATION READING FORMAT RESOLUTION (SECCIÓN 4.3 & 4.5)
  // =========================================================================

  it('2.1 should validate reading formats against real CanonicalMusicPayload content (Zero-Fabrication)', () => {
    const fullSong = GOLDEN_SCENARIO_PRESETS.SCENARIO_A.canonicalSongFactory();
    const leadSheet = createLeadSheetWithoutNotes();
    const guitar = instrumentRegistry.getOrThrow('acoustic_guitar');
    const piano = instrumentRegistry.getOrThrow('acoustic_piano');

    // En obra completa con guitarra, los 4 formatos son válidos
    assert.equal(resolveReadingFormatForSong('SCORE', fullSong, guitar).isAvailable, true);
    assert.equal(resolveReadingFormatForSong('CHORD_SHEET', fullSong, guitar).isAvailable, true);
    assert.equal(resolveReadingFormatForSong('LYRICS', fullSong, guitar).isAvailable, true);
    assert.equal(resolveReadingFormatForSong('TAB', fullSong, guitar).isAvailable, true);

    // En piano (sin cuerdas/trastes), TAB se rechaza sin fabricar tablatura
    const tabOnPiano = resolveReadingFormatForSong('TAB', fullSong, piano);
    assert.equal(tabOnPiano.isAvailable, false);
    assert.ok(tabOnPiano.unavailabilityReason);

    // En Lead Sheet sin notas, SCORE y TAB se rechazan sin inventar notas
    const scoreOnLeadSheet = resolveReadingFormatForSong('SCORE', leadSheet, guitar);
    const tabOnLeadSheet = resolveReadingFormatForSong('TAB', leadSheet, guitar);
    const chordsOnLeadSheet = resolveReadingFormatForSong('CHORD_SHEET', leadSheet, guitar);

    assert.equal(scoreOnLeadSheet.isAvailable, false);
    assert.equal(tabOnLeadSheet.isAvailable, false);
    assert.equal(chordsOnLeadSheet.isAvailable, true);
  });

  // =========================================================================
  // 3. PRECEDENCIA DE PREFERENCIAS INDIVIDUALES VS SUGERENCIAS DE SETLIST (4.4)
  // =========================================================================

  it('3.1 should prioritize individual musician preferences over setlist entry suggestion without mutating shared setlist', () => {
    const fullSong = GOLDEN_SCENARIO_PRESETS.SCENARIO_A.canonicalSongFactory();
    const guitar = instrumentRegistry.getOrThrow('acoustic_guitar');

    const sharedSetlistItem: FrontendSetlistItem = {
      id: 'item-1',
      setlistId: 'setlist-1',
      sequenceOrder: 1,
      itemType: 'SONG',
      songId: 'song-1',
      song: { id: 'song-1', title: 'Cántico', artist: null, defaultKey: 'G', defaultBpm: 120 },
      targetKey: 'A',
      targetBpm: 124,
      preferredInstrument: 'Guitarra Acústica',
      preferredTuning: 'EADGBE',
      preferredFormat: 'SCORE',
      transitionType: 'SEGUE',
      momentTitle: null,
      durationMinutes: null,
      musicalKey: null,
      notesForTeam: 'Capo en 2',
      createdAt: '2026-11-12T00:00:00.000Z',
      updatedAt: '2026-11-12T00:00:00.000Z',
    };

    const itemSnapshot = JSON.stringify(sharedSetlistItem);

    const musicianPref: UserViewPreferenceData = {
      userId: 'musician-1',
      instrumentId: 'acoustic_guitar',
      primaryRepresentation: 'TABLATURE',
      secondaryRepresentations: ['CHORDS'],
      chordNotationSystem: 'STANDARD',
      transpositionSemitones: 0,
      capoFret: 2,
      clefOverride: null,
      preferFlats: false,
    };

    const resolution = resolveEffectiveStandView({
      userPreferences: musicianPref,
      setlistItem: sharedSetlistItem,
      song: fullSong,
      instrumentProfile: guitar,
      currentPrimary: 'STANDARD_NOTATION',
      currentSecondary: [],
    });

    assert.equal(resolution.source, 'USER_PREFERENCE');
    assert.equal(resolution.primaryRepresentation, 'TABLATURE');
    assert.deepEqual(resolution.secondaryRepresentations, ['CHORDS']);
    assert.equal(resolution.suggestedFormat, 'SCORE');
    assert.equal(JSON.stringify(sharedSetlistItem), itemSnapshot, 'El ítem compartido del setlist no debe mutar');
  });

  it('3.2 should apply setlist entry suggested format when musician has no saved personal preference and format is valid', () => {
    const fullSong = GOLDEN_SCENARIO_PRESETS.SCENARIO_A.canonicalSongFactory();
    const guitar = instrumentRegistry.getOrThrow('acoustic_guitar');

    const setlistItemWithTab: FrontendSetlistItem = {
      id: 'item-2',
      setlistId: 'setlist-1',
      sequenceOrder: 2,
      itemType: 'SONG',
      songId: 'song-1',
      song: { id: 'song-1', title: 'Cántico', artist: null, defaultKey: 'G', defaultBpm: 120 },
      targetKey: 'G',
      targetBpm: 120,
      preferredInstrument: 'Guitarra Eléctrica',
      preferredTuning: 'Drop D',
      preferredFormat: 'TAB',
      transitionType: 'STOP',
      momentTitle: null,
      durationMinutes: null,
      musicalKey: null,
      notesForTeam: null,
      createdAt: '2026-11-12T00:00:00.000Z',
      updatedAt: '2026-11-12T00:00:00.000Z',
    };

    const resolution = resolveEffectiveStandView({
      userPreferences: null,
      setlistItem: setlistItemWithTab,
      song: fullSong,
      instrumentProfile: guitar,
      currentPrimary: 'STANDARD_NOTATION',
      currentSecondary: [],
    });

    assert.equal(resolution.source, 'SETLIST_SUGGESTION');
    assert.equal(resolution.primaryRepresentation, 'TABLATURE');
    assert.equal(resolution.suggestedFormatAvailable, true);
  });

  it('3.3 should fallback safely to instrument default if setlist suggestion is incompatible with canonical song (Zero-Fabrication)', () => {
    const leadSheet = createLeadSheetWithoutNotes();
    const guitar = instrumentRegistry.getOrThrow('acoustic_guitar');

    const setlistItemSuggestingTab: FrontendSetlistItem = {
      id: 'item-3',
      setlistId: 'setlist-1',
      sequenceOrder: 3,
      itemType: 'SONG',
      songId: 'song-lead',
      song: { id: 'song-lead', title: 'Lead Sheet', artist: null, defaultKey: 'C', defaultBpm: 90 },
      targetKey: 'C',
      targetBpm: 90,
      preferredFormat: 'TAB', // Incompatible porque leadSheet no tiene notas melódicas
      transitionType: 'STOP',
      momentTitle: null,
      durationMinutes: null,
      musicalKey: null,
      notesForTeam: null,
      createdAt: '2026-11-12T00:00:00.000Z',
      updatedAt: '2026-11-12T00:00:00.000Z',
    };

    const resolution = resolveEffectiveStandView({
      userPreferences: null,
      setlistItem: setlistItemSuggestingTab,
      song: leadSheet,
      instrumentProfile: guitar,
      currentPrimary: 'CHORDS',
      currentSecondary: ['LYRICS'],
    });

    assert.equal(resolution.source, 'INSTRUMENT_DEFAULT');
    assert.equal(resolution.primaryRepresentation, 'CHORDS');
    assert.equal(resolution.suggestedFormatAvailable, false);
  });

  // =========================================================================
  // 4. FILTRADO DE CULTOS Y EVENTOS LITÚRGICOS (SECCIÓN 4.1)
  // =========================================================================

  it('4.1 should filter worship services across UPCOMING, DRAFT, COMPLETED, ALL and free-text category', () => {
    const nowMs = Date.parse('2026-11-15T10:00:00.000Z');
    const services: FrontendWorshipService[] = [
      {
        id: 'svc-1',
        name: 'Culto Dominical Central',
        description: 'Servicio de adoración',
        serviceType: 'Culto Dominical',
        scheduledAt: '2026-11-16T15:00:00.000Z',
        worshipLeaderId: 'u-1',
        notes: 'Santa Cena',
        status: 'UPCOMING',
        setlistId: 'sl-1',
        createdAt: '2026-11-10T00:00:00.000Z',
        updatedAt: '2026-11-10T00:00:00.000Z',
      },
      {
        id: 'svc-2',
        name: 'Ensayo General de Alabanza',
        description: null,
        serviceType: 'Ensayo',
        scheduledAt: '2026-11-14T23:00:00.000Z',
        worshipLeaderId: 'u-1',
        notes: null,
        status: 'COMPLETED',
        setlistId: 'sl-1',
        createdAt: '2026-11-10T00:00:00.000Z',
        updatedAt: '2026-11-10T00:00:00.000Z',
      },
      {
        id: 'svc-3',
        name: 'Vigilia de Fin de Mes',
        description: null,
        serviceType: 'Vigilia Especial',
        scheduledAt: '2026-11-30T01:00:00.000Z',
        worshipLeaderId: 'u-1',
        notes: null,
        status: 'DRAFT',
        setlistId: null,
        createdAt: '2026-11-10T00:00:00.000Z',
        updatedAt: '2026-11-10T00:00:00.000Z',
      },
    ];

    assert.equal(filterWorshipServices(services, 'UPCOMING', '', nowMs).length, 2); // svc-1 (UPCOMING) + svc-3 (futuro)
    assert.equal(filterWorshipServices(services, 'DRAFT', '', nowMs).length, 1);
    assert.equal(filterWorshipServices(services, 'COMPLETED', '', nowMs).length, 1);
    assert.equal(filterWorshipServices(services, 'ALL', '', nowMs).length, 3);
    assert.equal(filterWorshipServices(services, 'ALL', 'vigilia', nowMs).length, 1);
    assert.equal(WORSHIP_SERVICE_STATUS_LABELS.UPCOMING, 'Próximo');
    assert.equal(WORSHIP_SERVICE_STATUS_LABELS.DRAFT, 'Borrador');
  });

  // =========================================================================
  // 5. CONTRATO DE CLIENTE API (DUPLICACIÓN DE SETLIST Y CULTOS/SERVICIOS)
  // =========================================================================

  it('5.1 should expose duplicateSetlist and worship service CRUD methods on BethesdaApiClient and execute requests properly', async () => {
    const capturedRequests: Array<{ url: string; method: string; body?: string }> = [];
    const mockFetch: typeof fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      capturedRequests.push({
        url,
        method: init?.method ?? 'GET',
        ...(typeof init?.body === 'string' ? { body: init.body } : {}),
      });

      if (url.endsWith('/duplicate')) {
        return new Response(
          JSON.stringify({
            status: 'success',
            data: {
              id: 'sl-dup-1',
              title: 'Culto Dominical (Copia)',
              scheduledDateTime: null,
              status: 'PLANNING',
              isTemplate: false,
              directorUserId: 'u-1',
              notes: null,
              items: [],
              createdAt: '2026-11-12T00:00:00.000Z',
              updatedAt: '2026-11-12T00:00:00.000Z',
            },
          }),
          { status: 201, headers: { 'Content-Type': 'application/json' } }
        );
      }

      return new Response(
        JSON.stringify({
          status: 'success',
          data: {
            id: 'svc-new-1',
            name: 'Vigilia de Adoración',
            description: null,
            serviceType: 'Vigilia',
            scheduledAt: '2026-11-20T00:00:00.000Z',
            worshipLeaderId: 'u-1',
            notes: null,
            status: 'UPCOMING',
            setlistId: 'sl-dup-1',
            createdAt: '2026-11-12T00:00:00.000Z',
            updatedAt: '2026-11-12T00:00:00.000Z',
          },
        }),
        { status: 201, headers: { 'Content-Type': 'application/json' } }
      );
    };

    const originalFetch = globalThis.fetch;
    globalThis.fetch = mockFetch;
    try {
      const client = new BethesdaApiClient({ baseUrl: 'http://localhost:4000/api/v1' });

      const duplicated = await client.duplicateSetlist('sl-orig-1', {
        newTitle: 'Culto Dominical (Copia)',
        isTemplate: false,
      });
      assert.equal(duplicated.id, 'sl-dup-1');
      assert.equal(duplicated.title, 'Culto Dominical (Copia)');

      const createdService = await client.createWorshipService({
        name: 'Vigilia de Adoración',
        serviceType: 'Vigilia',
        scheduledAt: '2026-11-20T00:00:00.000Z',
        setlistId: 'sl-dup-1',
      });
      assert.equal(createdService.id, 'svc-new-1');
      assert.equal(createdService.serviceType, 'Vigilia');
      assert.equal(capturedRequests.length, 2);
      assert.ok(capturedRequests[0]!.url.endsWith('/setlists/sl-orig-1/duplicate'));
      assert.ok(capturedRequests[1]!.url.endsWith('/worship-services'));
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
