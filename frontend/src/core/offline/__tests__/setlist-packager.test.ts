/**
 * @file setlist-packager.test.ts
 * @description Pruebas de empaquetado de repertorios litúrgicos y dependencias offline (WP-04).
 * Valida la detección de canciones faltantes, setlists completos vs incompletos,
 * y tratamiento de momentos de servicio litúrgico.
 */

import assert from 'node:assert';
import { describe, it, beforeEach } from 'node:test';
import { BethesdaOfflineManager } from '../offline-manager.ts';
import { BethesdaOfflineStorage } from '../storage/indexeddb-storage.ts';
import { CanonicalMusicPayload } from '../../canonical-model/canonical-music-payload.ts';
import { Timeline } from '../../canonical-model/timeline.ts';
import { TempoMap } from '../../canonical-model/tempo-map.ts';
import { CANONICAL_TPQN } from '../../canonical-model/types.ts';
import type { FrontendSetlistDetail } from '../../api/setlist-types.ts';
import type { BackendSongResponse } from '../../api/api-client.ts';

describe('WP-04 — Setlist Packager & Dependency Tests', () => {
  let storage: BethesdaOfflineStorage;
  let manager: BethesdaOfflineManager;

  const createValidCanonicalJSON = (title: string) => {
    const timeline = new Timeline({
      tpqn: CANONICAL_TPQN,
      totalDurationTicks: 0,
      measureCount: 0,
      tempoMap: new TempoMap([]),
    });
    return new CanonicalMusicPayload({
      title,
      timeline,
      measures: [],
      sections: [],
      instrumentTracks: [],
    }).toJSON();
  };

  const createMockSongResponse = (id: string, title: string): BackendSongResponse => ({
    song: {
      id,
      title,
      artist: 'Worship Leader',
      ccliNumber: null,
      defaultKey: 'D',
      defaultBpm: 75,
      timeSignature: '4/4',
      status: 'APPROVED',
      currentVersionId: `ver_${id}`,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    version: {
      id: `ver_${id}`,
      songId: id,
      versionNumber: 1,
      name: 'Versión Canónica',
      description: null,
      sourceFormat: 'INTERNAL',
      canonicalPayload: createValidCanonicalJSON(title),
      totalMeasures: 0,
      totalNotes: 0,
      totalChords: 0,
      isCurrent: true,
      createdAt: new Date().toISOString(),
    },
  });

  beforeEach(async () => {
    storage = new BethesdaOfflineStorage();
    await storage.init();
    await storage.purgeAll();
  });

  it('1. should package a setlist as fully complete when all dependency songs are downloaded', async () => {
    const mockSetlist: FrontendSetlistDetail = {
      id: 'setlist_sunday_01',
      title: 'Culto de Adoración Dominical',
      scheduledDateTime: '2026-10-18T10:00:00Z',
      status: 'ACTIVE',
      directorUserId: 'director_user_1',
      directorName: 'David Salmista',
      notes: 'Culto matutino',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      items: [
        {
          id: 'item_1',
          setlistId: 'setlist_sunday_01',
          sequenceOrder: 1,
          itemType: 'SONG',
          songId: 'song_pack_1',
          targetKey: 'D',
          targetBpm: 75,
          transitionType: 'SEGUE',
          momentTitle: null,
          durationMinutes: null,
          musicalKey: null,
          notesForTeam: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          song: {
            id: 'song_pack_1',
            title: 'Dios Incomparable',
            artist: 'Generación 12',
            defaultKey: 'D',
            defaultBpm: 75,
            timeSignature: '4/4',
            status: 'APPROVED',
          },
        },
        {
          id: 'item_2',
          setlistId: 'setlist_sunday_01',
          sequenceOrder: 2,
          itemType: 'SERVICE_MOMENT',
          songId: null,
          targetKey: null,
          targetBpm: null,
          transitionType: 'STOP',
          momentTitle: 'Oración de Bienvenida',
          durationMinutes: 5,
          musicalKey: 'D',
          notesForTeam: 'Pad en D suave',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          song: null,
        },
      ],
    };

    const mockApiClient: any = {
      getSetlist: async (id: string) => {
        if (id === 'setlist_sunday_01') return mockSetlist;
        throw new Error('Setlist not found');
      },
      getSong: async (id: string) => {
        if (id === 'song_pack_1') return createMockSongResponse('song_pack_1', 'Dios Incomparable');
        throw new Error('Song not found');
      },
    };

    manager = new BethesdaOfflineManager(storage, mockApiClient);

    const result = await manager.downloadSetlist('setlist_sunday_01', 'director_user_1', {
      includeSongs: true,
      includeAudio: false,
    });

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.status, 'AVAILABLE_OFFLINE');

    const savedSetlist = await storage.getSetlistPayload('setlist_sunday_01');
    assert.ok(savedSetlist !== null);
    assert.strictEqual(savedSetlist?.metadata.title, 'Culto de Adoración Dominical');
    assert.strictEqual(savedSetlist?.metadata.missingSongIds, undefined, 'No songs should be missing');
    assert.deepStrictEqual(savedSetlist?.metadata.associatedSongIds, ['song_pack_1']);

    // Check that song was also downloaded
    const savedSong = await storage.getSongPayload('song_pack_1');
    assert.ok(savedSong !== null);
    assert.strictEqual(savedSong?.metadata.status, 'AVAILABLE_OFFLINE');
  });

  it('2. should identify incomplete setlist package when a dependency song cannot be downloaded', async () => {
    const mockSetlist: FrontendSetlistDetail = {
      id: 'setlist_incomplete_02',
      title: 'Vigilia de Alabanza',
      scheduledDateTime: '2026-10-24T20:00:00Z',
      status: 'PLANNING',
      directorUserId: 'director_user_1',
      notes: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      items: [
        {
          id: 'item_10',
          setlistId: 'setlist_incomplete_02',
          sequenceOrder: 1,
          itemType: 'SONG',
          songId: 'song_missing_404',
          targetKey: 'C',
          targetBpm: 120,
          transitionType: null,
          momentTitle: null,
          durationMinutes: null,
          musicalKey: null,
          notesForTeam: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          song: null,
        },
      ],
    };

    const mockApiClient: any = {
      getSetlist: async () => mockSetlist,
      getSong: async () => {
        throw new Error('Server 404: Canción eliminada o no accesible');
      },
    };

    manager = new BethesdaOfflineManager(storage, mockApiClient);

    const result = await manager.downloadSetlist('setlist_incomplete_02', 'director_user_1', {
      includeSongs: true,
      includeAudio: false,
    });

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.status, 'AVAILABLE_OFFLINE');

    const saved = await storage.getSetlistPayload('setlist_incomplete_02');
    assert.ok(saved !== null);
    // Crucial requirement: Must identify missing song dependency
    assert.ok(saved?.metadata.missingSongIds !== undefined);
    assert.strictEqual(saved?.metadata.missingSongIds?.length, 1);
    assert.strictEqual(saved?.metadata.missingSongIds?.[0], 'song_missing_404');
  });

  it('3. should handle setlist composed solely of SERVICE_MOMENT items without missing song errors', async () => {
    const liturgicalMomentsOnlySetlist: FrontendSetlistDetail = {
      id: 'setlist_moments_only',
      title: 'Devocional de Oración',
      scheduledDateTime: '2026-10-20T06:00:00Z',
      status: 'PLANNING',
      directorUserId: 'pastor_user',
      notes: 'Solo oración y lectura bíblica',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      items: [
        {
          id: 'item_m1',
          setlistId: 'setlist_moments_only',
          sequenceOrder: 1,
          itemType: 'SERVICE_MOMENT',
          songId: null,
          targetKey: null,
          targetBpm: null,
          transitionType: 'STOP',
          momentTitle: 'Lectura de Salmo 91',
          durationMinutes: 10,
          musicalKey: 'A',
          notesForTeam: 'Pad en A menor',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          song: null,
        },
      ],
    };

    const mockApiClient: any = {
      getSetlist: async () => liturgicalMomentsOnlySetlist,
    };

    manager = new BethesdaOfflineManager(storage, mockApiClient);

    const result = await manager.downloadSetlist('setlist_moments_only', 'pastor_user');
    assert.strictEqual(result.success, true);

    const saved = await storage.getSetlistPayload('setlist_moments_only');
    assert.ok(saved !== null);
    assert.strictEqual(saved?.metadata.associatedSongIds?.length, 0);
    assert.strictEqual(saved?.metadata.missingSongIds, undefined);
  });
});
