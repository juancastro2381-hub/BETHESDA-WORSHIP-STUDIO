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
  // 2. ZERO-FABRICATION READING FORMAT RESOLUTION & CRITICAL FINDING A
  // =========================================================================

  it('2.1 should validate reading formats against real CanonicalMusicPayload content (Zero-Fabrication)', () => {
    const fullSong = GOLDEN_SCENARIO_PRESETS.SCENARIO_A.canonicalSongFactory();
    const leadSheet = createLeadSheetWithoutNotes();
    const guitar = instrumentRegistry.getOrThrow('acoustic_guitar');
    const piano = instrumentRegistry.getOrThrow('acoustic_piano');

    // En obra completa con guitarra, los 4 formatos son válidos y exponen requestedFormat === resolvedFormat
    for (const fmt of ['SCORE', 'CHORD_SHEET', 'LYRICS', 'TAB'] as const) {
      const resolved = resolveReadingFormatForSong(fmt, fullSong, guitar);
      assert.equal(resolved.isAvailable, true);
      assert.equal(resolved.requestedFormat, fmt);
      assert.equal(resolved.resolvedFormat, fmt);
      assert.notEqual(resolved.primary, null);
    }

    // En piano (sin cuerdas/trastes), TAB se rechaza sin fabricar tablatura ni exponer otro formato
    const tabOnPiano = resolveReadingFormatForSong('TAB', fullSong, piano);
    assert.equal(tabOnPiano.isAvailable, false);
    assert.equal(tabOnPiano.requestedFormat, 'TAB');
    assert.equal(tabOnPiano.resolvedFormat, null);
    assert.equal(tabOnPiano.primary, null);
    assert.deepEqual(tabOnPiano.secondary, []);
    assert.ok(tabOnPiano.unavailabilityReason);

    // En Lead Sheet sin notas, SCORE y TAB se rechazan sin inventar notas ni caer en STAFF_NOTATION
    const scoreOnLeadSheet = resolveReadingFormatForSong('SCORE', leadSheet, guitar);
    const tabOnLeadSheet = resolveReadingFormatForSong('TAB', leadSheet, guitar);
    const chordsOnLeadSheet = resolveReadingFormatForSong('CHORD_SHEET', leadSheet, guitar);

    assert.equal(scoreOnLeadSheet.isAvailable, false);
    assert.equal(scoreOnLeadSheet.resolvedFormat, null);
    assert.equal(scoreOnLeadSheet.primary, null);

    assert.equal(tabOnLeadSheet.isAvailable, false);
    assert.equal(tabOnLeadSheet.resolvedFormat, null);
    assert.equal(tabOnLeadSheet.primary, null);

    assert.equal(chordsOnLeadSheet.isAvailable, true);
    assert.equal(chordsOnLeadSheet.resolvedFormat, 'CHORD_SHEET');
    assert.equal(chordsOnLeadSheet.primary, 'CHORDS');
  });

  it('2.2 should NEVER silently substitute definitions[0] when requested format is missing from definitions or unrecognized (Critical Finding A)', () => {
    const fullSong = GOLDEN_SCENARIO_PRESETS.SCENARIO_A.canonicalSongFactory();
    const guitar = instrumentRegistry.getOrThrow('acoustic_guitar');

    // Caso 1: El formato solicitado ('TAB') está ausente de las definiciones suministradas
    const partialDefinitions = [
      {
        id: 'STAFF_NOTATION' as const,
        label: 'Partitura Completa',
        description: 'Pentagrama',
        icon: '🎼',
        primary: 'STANDARD_NOTATION' as const,
        secondary: ['CHORDS' as const, 'LYRICS' as const],
        isAvailable: true,
      },
    ];

    const missingFromDefs = resolveReadingFormatForSong('TAB', fullSong, guitar, partialDefinitions);
    assert.equal(missingFromDefs.requestedFormat, 'TAB');
    assert.equal(missingFromDefs.resolvedFormat, null);
    assert.equal(missingFromDefs.selectorId, null);
    assert.equal(missingFromDefs.primary, null, 'Nunca debe exponer STANDARD_NOTATION cuando se solicitó TAB');
    assert.deepEqual(missingFromDefs.secondary, []);
    assert.equal(missingFromDefs.isAvailable, false);
    assert.ok(
      missingFromDefs.unavailabilityReason?.includes('TAB'),
      'Debe explicar explícitamente por qué el formato solicitado no está disponible'
    );

    // Caso 2: Definiciones vacías
    const emptyDefs = resolveReadingFormatForSong('SCORE', fullSong, guitar, []);
    assert.equal(emptyDefs.requestedFormat, 'SCORE');
    assert.equal(emptyDefs.resolvedFormat, null);
    assert.equal(emptyDefs.selectorId, null);
    assert.equal(emptyDefs.primary, null);
    assert.equal(emptyDefs.isAvailable, false);
    assert.ok(emptyDefs.unavailabilityReason);

    // Caso 3: Formato no reconocido en tiempo de ejecución
    const unknownFormat = resolveReadingFormatForSong(
      'NASHVILLE_NUMBER' as unknown as 'SCORE',
      fullSong,
      guitar
    );
    assert.equal(unknownFormat.resolvedFormat, null);
    assert.equal(unknownFormat.selectorId, null);
    assert.equal(unknownFormat.primary, null);
    assert.equal(unknownFormat.isAvailable, false);
    assert.ok(unknownFormat.unavailabilityReason);
  });

  it('2.3 should not apply incompatible saved user preference when instrument or canonical song lacks support (Section 4.D)', () => {
    const leadSheet = createLeadSheetWithoutNotes();
    const piano = instrumentRegistry.getOrThrow('acoustic_piano');

    const incompatibleUserPref: UserViewPreferenceData = {
      userId: 'musician-2',
      instrumentId: 'acoustic_guitar',
      primaryRepresentation: 'TABLATURE',
      secondaryRepresentations: ['CHORDS'],
      chordNotationSystem: 'STANDARD',
      transpositionSemitones: 0,
      capoFret: 0,
      clefOverride: null,
      preferFlats: false,
    };

    const setlistItemWithChords: FrontendSetlistItem = {
      id: 'item-chords',
      setlistId: 'setlist-1',
      sequenceOrder: 1,
      itemType: 'SONG',
      songId: 'song-lead',
      song: { id: 'song-lead', title: 'Lead Sheet', artist: null, defaultKey: 'C', defaultBpm: 90, timeSignature: '4/4', status: 'APPROVED' },
      targetKey: 'C',
      targetBpm: 90,
      preferredFormat: 'CHORD_SHEET',
      transitionType: 'STOP',
      momentTitle: null,
      durationMinutes: null,
      musicalKey: null,
      notesForTeam: null,
      createdAt: '2026-11-12T00:00:00.000Z',
      updatedAt: '2026-11-12T00:00:00.000Z',
    };

    // En piano + leadSheet sin notas, TABLATURE es incompatible; cae de forma segura a la sugerencia compatible CHORD_SHEET
    const res = resolveEffectiveStandView({
      userPreferences: incompatibleUserPref,
      setlistItem: setlistItemWithChords,
      song: leadSheet,
      instrumentProfile: piano,
      currentPrimary: 'CHORDS',
      currentSecondary: ['LYRICS'],
    });

    assert.notEqual(res.primaryRepresentation, 'TABLATURE');
    assert.equal(res.primaryRepresentation, 'CHORDS');
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
      song: { id: 'song-1', title: 'Cántico', artist: null, defaultKey: 'G', defaultBpm: 120, timeSignature: '4/4', status: 'APPROVED' },
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
      song: { id: 'song-1', title: 'Cántico', artist: null, defaultKey: 'G', defaultBpm: 120, timeSignature: '4/4', status: 'APPROVED' },
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
      song: { id: 'song-lead', title: 'Lead Sheet', artist: null, defaultKey: 'C', defaultBpm: 90, timeSignature: '4/4', status: 'APPROVED' },
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
