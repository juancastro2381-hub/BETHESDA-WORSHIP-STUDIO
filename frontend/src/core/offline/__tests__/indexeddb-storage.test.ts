/**
 * @file indexeddb-storage.test.ts
 * @description Pruebas unitarias para el almacenamiento IndexedDB / Fallback en memoria de WP-04.
 * Valida el ciclo CRUD, cálculo de cuota, aislamiento multi-usuario y purga completa.
 */

import assert from 'node:assert';
import { describe, it, beforeEach } from 'node:test';
import { BethesdaOfflineStorage } from '../storage/indexeddb-storage.ts';
import type {
  OfflineResourceMetadata,
  OfflineSongPayload,
  OfflineSetlistPayload,
  OfflineAudioRecord,
} from '../types.ts';
import type { FrontendSetlistDetail } from '../../api/setlist-types.ts';

describe('WP-04 — BethesdaOfflineStorage Suite', () => {
  let storage: BethesdaOfflineStorage;

  beforeEach(async () => {
    storage = new BethesdaOfflineStorage();
    await storage.init();
    await storage.purgeAll();
  });

  it('1. should store, retrieve, and delete resource metadata correctly', async () => {
    const meta: OfflineResourceMetadata = {
      id: 'song_test_01',
      resourceType: 'SONG',
      title: 'Sublime Gracia',
      versionNumber: 1,
      downloadedAt: new Date().toISOString(),
      lastValidatedAt: new Date().toISOString(),
      ownerUserId: 'user_alice',
      byteSize: 1024,
      status: 'AVAILABLE_OFFLINE',
      checksumSha256: 'abcd1234efgh5678',
    };

    await storage.saveMetadata(meta);

    const retrieved = await storage.getMetadata('song_test_01');
    assert.ok(retrieved !== null, 'Metadata should be retrieved');
    assert.strictEqual(retrieved?.id, 'song_test_01');
    assert.strictEqual(retrieved?.title, 'Sublime Gracia');
    assert.strictEqual(retrieved?.status, 'AVAILABLE_OFFLINE');

    const all = await storage.listMetadata();
    assert.strictEqual(all.length, 1);

    await storage.deleteMetadata('song_test_01');
    const afterDelete = await storage.getMetadata('song_test_01');
    assert.strictEqual(afterDelete, null, 'Metadata should be deleted');
  });

  it('2. should store, retrieve, and delete canonical song payloads', async () => {
    const meta: OfflineResourceMetadata = {
      id: 'song_test_02',
      resourceType: 'SONG',
      title: 'Cuan Grande es Dios',
      versionNumber: 1,
      downloadedAt: new Date().toISOString(),
      lastValidatedAt: new Date().toISOString(),
      ownerUserId: 'user_alice',
      byteSize: 2048,
      status: 'AVAILABLE_OFFLINE',
      checksumSha256: 'hash2',
    };

    const songPayload: OfflineSongPayload = {
      id: 'song_test_02',
      metadata: meta,
      defaultKey: 'G',
      defaultBpm: 78,
      timeSignature: '4/4',
      artist: 'Chris Tomlin',
      canonicalPayload: {
        version: '1.0.0',
        title: 'Cuan Grande es Dios',
        timeline: {
          tpqn: 480,
          totalDurationTicks: 3840,
          measureCount: 2,
          tempoMap: { events: [{ tick: 0, bpm: 78 }] },
        },
        sections: [],
        measures: [],
        instrumentTracks: [],
      },
    };

    await storage.saveSongPayload(songPayload);

    const retrieved = await storage.getSongPayload('song_test_02');
    assert.ok(retrieved !== null);
    assert.strictEqual(retrieved?.metadata.title, 'Cuan Grande es Dios');
    assert.strictEqual(retrieved?.canonicalPayload.title, 'Cuan Grande es Dios');

    // Verify metadata was also saved automatically
    const metaRetrieved = await storage.getMetadata('song_test_02');
    assert.ok(metaRetrieved !== null);
    assert.strictEqual(metaRetrieved?.status, 'AVAILABLE_OFFLINE');

    await storage.deleteSongPayload('song_test_02');
    const deletedPayload = await storage.getSongPayload('song_test_02');
    assert.strictEqual(deletedPayload, null);
  });

  it('3. should store, retrieve, and delete setlist packages with dependency tracking', async () => {
    const meta: OfflineResourceMetadata = {
      id: 'setlist_test_01',
      resourceType: 'SETLIST',
      title: 'Culto Dominical - 18 Octubre',
      versionNumber: 1,
      downloadedAt: new Date().toISOString(),
      lastValidatedAt: new Date().toISOString(),
      ownerUserId: 'user_alice',
      byteSize: 512,
      status: 'AVAILABLE_OFFLINE',
      checksumSha256: 'hash_sl',
      associatedSongIds: ['song_test_01'],
    };

    const setlistDetail: FrontendSetlistDetail = {
      id: 'setlist_test_01',
      title: 'Culto Dominical - 18 Octubre',
      scheduledDateTime: '2026-10-18T10:00:00Z',
      directorUserId: 'user_alice',
      status: 'ACTIVE',
      notes: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      items: [
        {
          id: 'item_1',
          setlistId: 'setlist_test_01',
          sequenceOrder: 0,
          itemType: 'SONG',
          songId: 'song_test_01',
          targetKey: 'E',
          targetBpm: 75,
          transitionType: null,
          momentTitle: null,
          durationMinutes: null,
          musicalKey: null,
          notesForTeam: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          song: null,
        },
        {
          id: 'item_2',
          setlistId: 'setlist_test_01',
          sequenceOrder: 1,
          itemType: 'SERVICE_MOMENT',
          songId: null,
          targetKey: null,
          targetBpm: null,
          transitionType: null,
          momentTitle: 'Oración Pastoral',
          durationMinutes: 5,
          musicalKey: 'E',
          notesForTeam: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          song: null,
        },
      ],
    };

    const setlistPayload: OfflineSetlistPayload = {
      id: 'setlist_test_01',
      metadata: meta,
      setlistDetail,
    };

    await storage.saveSetlistPayload(setlistPayload);

    const retrieved = await storage.getSetlistPayload('setlist_test_01');
    assert.ok(retrieved !== null);
    assert.strictEqual(retrieved?.setlistDetail.title, 'Culto Dominical - 18 Octubre');
    assert.strictEqual(retrieved?.metadata.associatedSongIds?.length, 1);

    await storage.deleteSetlistPayload('setlist_test_01');
    const afterDelete = await storage.getSetlistPayload('setlist_test_01');
    assert.strictEqual(afterDelete, null);
  });

  it('4. should store, retrieve, and delete offline audio records', async () => {
    const fakeBlob = new Blob(['RIFF....WAVEfmt '], { type: 'audio/wav' });

    const meta: OfflineResourceMetadata = {
      id: 'audio_test_01',
      resourceType: 'AUDIO',
      title: 'Track Guía - Cuan Grande es Dios',
      versionNumber: 1,
      downloadedAt: new Date().toISOString(),
      lastValidatedAt: new Date().toISOString(),
      ownerUserId: 'user_alice',
      byteSize: fakeBlob.size,
      status: 'AVAILABLE_OFFLINE',
      checksumSha256: 'audiohash',
    };

    const audioRecord: OfflineAudioRecord = {
      id: 'audio_test_01',
      metadata: meta,
      mimeType: 'audio/wav',
      blob: fakeBlob,
    };

    await storage.saveAudioRecord(audioRecord);

    const retrieved = await storage.getAudioRecord('audio_test_01');
    assert.ok(retrieved !== null);
    assert.strictEqual(retrieved?.mimeType, 'audio/wav');
    assert.strictEqual(retrieved?.blob.size, fakeBlob.size);

    await storage.deleteAudioRecord('audio_test_01');
    const afterDelete = await storage.getAudioRecord('audio_test_01');
    assert.strictEqual(afterDelete, null);
  });

  it('5. should calculate storage usage correctly across all records', async () => {
    await storage.saveMetadata({
      id: 'meta_1',
      resourceType: 'SONG',
      title: 'Song 1',
      versionNumber: 1,
      downloadedAt: new Date().toISOString(),
      lastValidatedAt: new Date().toISOString(),
      ownerUserId: 'user_alice',
      byteSize: 1500,
      status: 'AVAILABLE_OFFLINE',
      checksumSha256: 'h1',
    });

    await storage.saveMetadata({
      id: 'meta_2',
      resourceType: 'AUDIO',
      title: 'Audio 2',
      versionNumber: 1,
      downloadedAt: new Date().toISOString(),
      lastValidatedAt: new Date().toISOString(),
      ownerUserId: 'user_alice',
      byteSize: 3500,
      status: 'AVAILABLE_OFFLINE',
      checksumSha256: 'h2',
    });

    const usage = await storage.getStorageUsage();
    assert.strictEqual(usage.usedBytes, 5000);
  });

  it('6. should isolate user data and purge only the specified user records on logout, preserving unowned resources (Finding B)', async () => {
    // User Alice resources
    await storage.saveMetadata({
      id: 'song_alice',
      resourceType: 'SONG',
      title: 'Alice Song',
      versionNumber: 1,
      downloadedAt: new Date().toISOString(),
      lastValidatedAt: new Date().toISOString(),
      ownerUserId: 'user_alice',
      byteSize: 1000,
      status: 'AVAILABLE_OFFLINE',
      checksumSha256: 'ha',
    });

    // User Bob resources (different user on same device)
    await storage.saveMetadata({
      id: 'song_bob',
      resourceType: 'SONG',
      title: 'Bob Song',
      versionNumber: 1,
      downloadedAt: new Date().toISOString(),
      lastValidatedAt: new Date().toISOString(),
      ownerUserId: 'user_bob',
      byteSize: 2000,
      status: 'AVAILABLE_OFFLINE',
      checksumSha256: 'hb',
    });

    // Unowned / public resource (ownerUserId === null)
    await storage.saveMetadata({
      id: 'song_public_shared',
      resourceType: 'SONG',
      title: 'Public Shared Song',
      versionNumber: 1,
      downloadedAt: new Date().toISOString(),
      lastValidatedAt: new Date().toISOString(),
      ownerUserId: null,
      byteSize: 1500,
      status: 'AVAILABLE_OFFLINE',
      checksumSha256: 'hnull',
    });

    // Purge Alice
    const purgeResult = await storage.purgeUserData('user_alice');
    assert.strictEqual(purgeResult.deletedCount, 1, 'Only Alice resource should be deleted');

    // Alice should be gone
    const aliceData = await storage.getMetadata('song_alice');
    assert.strictEqual(aliceData, null, 'Alice data must be deleted');

    // Bob must remain untouched
    const bobData = await storage.getMetadata('song_bob');
    assert.ok(bobData !== null, 'Bob data must remain intact');
    assert.strictEqual(bobData?.title, 'Bob Song');

    // Unowned / public resource must remain untouched (Finding B)
    const publicData = await storage.getMetadata('song_public_shared');
    assert.ok(publicData !== null, 'Public unowned data (ownerUserId: null) must remain intact');
    assert.strictEqual(publicData?.title, 'Public Shared Song');
  });

  it('7. should wipe all stores completely on purgeAll', async () => {
    await storage.saveMetadata({
      id: 'meta_1',
      resourceType: 'SONG',
      title: 'Song 1',
      versionNumber: 1,
      downloadedAt: new Date().toISOString(),
      lastValidatedAt: new Date().toISOString(),
      ownerUserId: 'user_alice',
      byteSize: 1000,
      status: 'AVAILABLE_OFFLINE',
      checksumSha256: 'h1',
    });

    await storage.purgeAll();

    const all = await storage.listMetadata();
    assert.strictEqual(all.length, 0);
  });

  it('8. should unconditionally purge orphaned payloads across all stores on deleteResource even if metadata is absent (Finding B)', async () => {
    const meta: OfflineResourceMetadata = {
      id: 'orphan_song_test',
      resourceType: 'SONG',
      title: 'Orphan Song',
      versionNumber: 1,
      downloadedAt: new Date().toISOString(),
      lastValidatedAt: new Date().toISOString(),
      ownerUserId: 'user_alice',
      byteSize: 1024,
      status: 'AVAILABLE_OFFLINE',
      checksumSha256: 'orphan_hash',
    };

    // Save payload and metadata
    await storage.saveSongPayload({
      id: 'orphan_song_test',
      metadata: meta,
      defaultKey: 'C',
      defaultBpm: 120,
      timeSignature: '4/4',
      canonicalPayload: {
        version: '1.0.0',
        title: 'Orphan Song',
        timeline: { tpqn: 480, totalDurationTicks: 0, measureCount: 0, tempoMap: { events: [] } } as any,
        sections: [],
        measures: [],
        instrumentTracks: [],
      },
    });

    // Delete ONLY metadata to simulate orphaned payload state
    await storage.deleteMetadata('orphan_song_test');
    assert.strictEqual(await storage.getMetadata('orphan_song_test'), null);

    // Call deleteResource: must unconditionally delete payload despite missing metadata
    await storage.deleteResource('orphan_song_test');

    const checkPayload = await storage.getSongPayload('orphan_song_test');
    assert.strictEqual(checkPayload, null, 'Orphaned payload must be deleted');
  });
});
