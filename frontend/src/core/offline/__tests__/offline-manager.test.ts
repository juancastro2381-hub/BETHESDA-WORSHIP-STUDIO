/**
 * @file offline-manager.test.ts
 * @description Pruebas de orquestación para BethesdaOfflineManager (WP-04).
 * Valida el ciclo de descarga de canciones, rechazo de payloads inválidos,
 * invariante de solo lectura, audio offline y vigencia de 7 días.
 */

import assert from 'node:assert';
import { describe, it, beforeEach } from 'node:test';
import { BethesdaOfflineManager } from '../offline-manager.ts';
import { BethesdaOfflineStorage } from '../storage/indexeddb-storage.ts';
import { CanonicalMusicPayload } from '../../canonical-model/canonical-music-payload.ts';
import { Timeline } from '../../canonical-model/timeline.ts';
import { TempoMap } from '../../canonical-model/tempo-map.ts';
import { CANONICAL_TPQN } from '../../canonical-model/types.ts';
import {
  OFFLINE_POLICIES,
  OfflineStorageError,
  type OfflineResourceMetadata,
  type OfflineSongPayload,
  type OfflineSetlistPayload,
} from '../types.ts';
import type { BackendSongResponse } from '../../api/api-client.ts';
import type { FrontendSetlistDetail } from '../../api/setlist-types.ts';

describe('WP-04 — BethesdaOfflineManager Orchestration Suite', () => {
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

  const defaultCanonicalJson = createValidCanonicalJSON('Default Mock');

  beforeEach(async () => {
    storage = new BethesdaOfflineStorage();
    await storage.init();
    await storage.purgeAll();
  });

  it('1. should enforce read-only invariant when offline', () => {
    manager = new BethesdaOfflineManager(storage);
    // Mock isOnline to return false
    manager.isOnline = () => false;

    assert.throws(
      () => {
        manager.assertCanMutateServer();
      },
      (err: any) => {
        return err instanceof OfflineStorageError && err.code === 'UNAUTHORIZED_SESSION';
      },
      'Should throw OfflineStorageError with UNAUTHORIZED_SESSION when offline'
    );
  });

  it('2. should download, validate, and store a canonical song successfully', async () => {
    const validJson = createValidCanonicalJSON('Sublime Gracia');

    const fakeBackendResponse: BackendSongResponse = {
      song: {
        id: 'song_offline_100',
        title: 'Sublime Gracia',
        artist: 'John Newton',
        ccliNumber: null,
        defaultKey: 'G',
        defaultBpm: 72,
        timeSignature: '3/4',
        status: 'APPROVED',
        currentVersionId: 'ver_1',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      version: {
        id: 'ver_1',
        songId: 'song_offline_100',
        versionNumber: 1,
        name: 'Arreglo Principal',
        description: null,
        sourceFormat: 'INTERNAL',
        canonicalPayload: validJson,
        totalMeasures: 0,
        totalNotes: 0,
        totalChords: 0,
        isCurrent: true,
        createdAt: new Date().toISOString(),
      },
    };

    const mockApiClient: any = {
      getSong: async (id: string) => {
        if (id === 'song_offline_100') return fakeBackendResponse;
        throw new Error('Song not found');
      },
    };

    manager = new BethesdaOfflineManager(storage, mockApiClient);

    const result = await manager.downloadSong('song_offline_100', 'user_leader');
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.status, 'AVAILABLE_OFFLINE');

    const saved = await storage.getSongPayload('song_offline_100');
    assert.ok(saved !== null);
    assert.strictEqual(saved?.metadata.status, 'AVAILABLE_OFFLINE');
    assert.strictEqual(saved?.metadata.title, 'Sublime Gracia');
    assert.ok(saved?.metadata.checksumSha256.length > 0, 'SHA-256 checksum must be computed');
  });

  it('3. should reject corrupted/invalid canonical song and mark status as FAILED', async () => {
    const corruptedJson: any = {
      version: '1.0.0',
      title: '', // Invalid empty title
      timeline: null, // Corrupted timeline
      measures: [],
    };

    const fakeBackendResponse: BackendSongResponse = {
      song: {
        id: 'song_corrupted_99',
        title: 'Canción Inválida',
        artist: null,
        ccliNumber: null,
        defaultKey: 'C',
        defaultBpm: 120,
        timeSignature: '4/4',
        status: 'APPROVED',
        currentVersionId: 'ver_bad',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      version: {
        id: 'ver_bad',
        songId: 'song_corrupted_99',
        versionNumber: 1,
        name: 'Arreglo Roto',
        description: null,
        sourceFormat: 'INTERNAL',
        canonicalPayload: corruptedJson,
        totalMeasures: 0,
        totalNotes: 0,
        totalChords: 0,
        isCurrent: true,
        createdAt: new Date().toISOString(),
      },
    };

    const mockApiClient: any = {
      getSong: async () => fakeBackendResponse,
    };

    manager = new BethesdaOfflineManager(storage, mockApiClient);

    const result = await manager.downloadSong('song_corrupted_99', 'user_leader');
    assert.strictEqual(result.success, false);
    assert.strictEqual(result.status, 'FAILED');

    // Canonical payload must NOT be saved in storage
    const savedPayload = await storage.getSongPayload('song_corrupted_99');
    assert.strictEqual(savedPayload, null, 'Corrupted payload must not be saved');

    // Metadata should record failure
    const meta = await storage.getMetadata('song_corrupted_99');
    assert.ok(meta !== null);
    assert.strictEqual(meta?.status, 'FAILED');
    assert.ok(meta?.errorMessage && meta.errorMessage.length > 0);
  });

  it('4. should enforce 7-day grace period expiration policy based on lastValidatedAt (Decision U-01)', () => {
    manager = new BethesdaOfflineManager(storage);

    // Downloaded 10 days ago, but revalidated with server yesterday -> NOT expired
    const revalidatedMeta: any = {
      downloadedAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(),
      lastValidatedAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(),
    };
    assert.strictEqual(manager.isAuthorizationExpired(revalidatedMeta), false);

    // Last validated 8 days ago -> EXPIRED
    const expiredMeta: any = {
      downloadedAt: new Date(Date.now() - 12 * 24 * 60 * 60 * 1000).toISOString(),
      lastValidatedAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString(),
    };
    assert.strictEqual(manager.isAuthorizationExpired(expiredMeta), true);

    // Clock skew / tampering: lastValidatedAt > 5 minutes in future -> EXPIRED by safety guard
    const clockTamperedMeta: any = {
      downloadedAt: new Date().toISOString(),
      lastValidatedAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    };
    assert.strictEqual(manager.isAuthorizationExpired(clockTamperedMeta), true);
  });

  it('5. should block getAuthorizedSongPayload when expired and offline, but revalidate when online', async () => {
    const validJson = createValidCanonicalJSON('Song Expiry Test');
    const expiredDate = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();

    await storage.saveSongPayload({
      id: 'song_expiry_1',
      metadata: {
        id: 'song_expiry_1',
        resourceType: 'SONG',
        title: 'Song Expiry Test',
        versionNumber: 1,
        ownerUserId: 'user_test',
        status: 'AVAILABLE_OFFLINE',
        downloadedAt: expiredDate,
        lastValidatedAt: expiredDate,
        byteSize: 500,
        checksumSha256: 'sha_exp',
      },
      canonicalPayload: validJson,
      defaultKey: 'C',
      defaultBpm: 120,
      timeSignature: '4/4',
    });

    const mockApiClient: any = {
      getSong: async (id: string) => ({
        song: { id, title: 'Song Expiry Test', defaultKey: 'C', defaultBpm: 120, timeSignature: '4/4' },
        version: { versionNumber: 2, canonicalPayload: validJson },
      }),
    };

    manager = new BethesdaOfflineManager(storage, mockApiClient);

    // Test A: When offline -> must throw UNAUTHORIZED_SESSION
    manager.isOnline = () => false;
    await assert.rejects(
      async () => {
        await manager.getAuthorizedSongPayload('song_expiry_1');
      },
      (err: any) => err instanceof OfflineStorageError && err.code === 'UNAUTHORIZED_SESSION'
    );

    // Test B: When online -> successfully revalidates with server and updates lastValidatedAt in persisted representation (Finding A)
    manager.isOnline = () => true;
    const revalidated = await manager.getAuthorizedSongPayload('song_expiry_1');
    assert.ok(revalidated !== null);
    assert.strictEqual(manager.isAuthorizationExpired(revalidated.metadata), false);

    // Assert directly against persisted storage read-back (both stores)
    const persistedPayload = await storage.getSongPayload('song_expiry_1');
    assert.ok(persistedPayload !== null, 'Persisted payload must exist');
    assert.notStrictEqual(persistedPayload.metadata.lastValidatedAt, expiredDate, 'Persisted payload lastValidatedAt must be updated');
    assert.strictEqual(manager.isAuthorizationExpired(persistedPayload.metadata), false, 'Persisted payload must be within valid grace period');

    const persistedMeta = await storage.getMetadata('song_expiry_1');
    assert.ok(persistedMeta !== null, 'Persisted metadata must exist');
    assert.notStrictEqual(persistedMeta.lastValidatedAt, expiredDate);
    assert.strictEqual(manager.isAuthorizationExpired(persistedMeta), false);

    // Test C: Subsequent offline read succeeds within the renewed seven-day grace period
    manager.isOnline = () => false;
    const offlineRenewedRead = await manager.getAuthorizedSongPayload('song_expiry_1');
    assert.ok(offlineRenewedRead !== null, 'Subsequent offline read must succeed within renewed grace period');
    assert.strictEqual(offlineRenewedRead.id, 'song_expiry_1');

    // Test D: After the renewed grace period expires, offline read is rejected
    const expiredRenewedDate = new Date(Date.now() - 9 * 24 * 60 * 60 * 1000).toISOString();
    await storage.saveSongPayload({
      ...offlineRenewedRead,
      metadata: {
        ...offlineRenewedRead.metadata,
        lastValidatedAt: expiredRenewedDate,
      },
    });

    manager.isOnline = () => false;
    await assert.rejects(
      async () => {
        await manager.getAuthorizedSongPayload('song_expiry_1');
      },
      (err: any) => err instanceof OfflineStorageError && err.code === 'UNAUTHORIZED_SESSION'
    );

    // Test E: When server returns 401/403 -> revokes and purges local copy from all stores
    manager.isOnline = () => true;
    mockApiClient.getSong = async () => {
      const err: any = new Error('Forbidden');
      err.statusCode = 403;
      throw err;
    };

    await assert.rejects(
      async () => {
        await manager.getAuthorizedSongPayload('song_expiry_1');
      },
      (err: any) => err instanceof OfflineStorageError && err.code === 'UNAUTHORIZED_SESSION'
    );
    const purgedPayloadCheck = await storage.getSongPayload('song_expiry_1');
    assert.strictEqual(purgedPayloadCheck, null, 'Song payload must be purged after 403 response');
    const purgedMetaCheck = await storage.getMetadata('song_expiry_1');
    assert.strictEqual(purgedMetaCheck, null, 'Song metadata must be purged after 403 response');

    // Test F: Transient server failure does not refresh authorization timestamp or extend grace period
    const transientDate = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
    await storage.saveSongPayload({
      id: 'song_transient_1',
      metadata: {
        id: 'song_transient_1',
        resourceType: 'SONG',
        title: 'Transient Song',
        versionNumber: 1,
        ownerUserId: 'user_test',
        status: 'AVAILABLE_OFFLINE',
        downloadedAt: transientDate,
        lastValidatedAt: transientDate,
        byteSize: 500,
        checksumSha256: 'sha_transient',
      },
      canonicalPayload: validJson,
      defaultKey: 'D',
      defaultBpm: 100,
      timeSignature: '4/4',
    });

    mockApiClient.getSong = async () => {
      const err: any = new Error('Internal Server Error');
      err.statusCode = 500;
      throw err;
    };

    manager.isOnline = () => true;
    await assert.rejects(
      async () => {
        await manager.getAuthorizedSongPayload('song_transient_1');
      },
      (err: any) => err instanceof OfflineStorageError && err.code === 'UNAUTHORIZED_SESSION'
    );

    const untouchedTransient = await storage.getSongPayload('song_transient_1');
    assert.ok(untouchedTransient !== null, 'Local copy must remain saved for future re-auth');
    assert.strictEqual(untouchedTransient.metadata.lastValidatedAt, transientDate, 'Transient error must NOT extend authorization timestamp');
  });

  it('6. should enforce 50MB single-track audio size quota (Decision U-03)', async () => {
    manager = new BethesdaOfflineManager(storage);

    // Mock global fetch returning a 51MB blob
    const largeBlob = new Blob([new Uint8Array(51 * 1024 * 1024)]);
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () =>
      ({
        ok: true,
        headers: new Headers({
          'content-length': String(51 * 1024 * 1024),
          'content-type': 'audio/mpeg',
        }),
        blob: async () => largeBlob,
      } as any);

    try {
      const result = await manager.downloadAudio(
        'audio_large_1',
        'https://server.example.com/audio/huge.mp3',
        'Guía Excesiva',
        'user_leader'
      );

      assert.strictEqual(result.success, false);
      assert.strictEqual(result.status, 'FAILED');
      assert.ok(result.error?.includes('50MB') || result.error?.includes('supera'));
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('7. should reject non-audio MIME types (HTML error pages) and empty audio responses', async () => {
    manager = new BethesdaOfflineManager(storage);
    const originalFetch = globalThis.fetch;

    try {
      // Subtest A: HTML error page returned instead of audio
      globalThis.fetch = async () =>
        ({
          ok: true,
          headers: new Headers({
            'content-type': 'text/html; charset=utf-8',
          }),
          blob: async () => new Blob(['<html><body>404 Not Found</body></html>'], { type: 'text/html' }),
        } as any);

      const htmlResult = await manager.downloadAudio(
        'audio_html_err',
        'https://server.example.com/audio/not-found.mp3',
        'Audio Roto',
        'user_leader'
      );
      assert.strictEqual(htmlResult.success, false);
      assert.ok(htmlResult.error?.includes('no es un formato de audio válido'));

      // Subtest B: Empty 0-byte blob
      globalThis.fetch = async () =>
        ({
          ok: true,
          headers: new Headers({
            'content-type': 'audio/mpeg',
          }),
          blob: async () => new Blob([], { type: 'audio/mpeg' }),
        } as any);

      const emptyResult = await manager.downloadAudio(
        'audio_empty',
        'https://server.example.com/audio/empty.mp3',
        'Audio Vacío',
        'user_leader'
      );
      assert.strictEqual(emptyResult.success, false);
      assert.ok(emptyResult.error?.includes('está vacío'));
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('8. should enforce 85% storage quota limit before allowing downloads', async () => {
    manager = new BethesdaOfflineManager(storage);

    // Mock storage usage to simulate 86% quota consumed
    storage.getStorageUsage = async () => ({
      usedBytes: 86 * 1024 * 1024,
      quotaBytes: 100 * 1024 * 1024,
      percentage: 86,
    });

    await assert.rejects(
      async () => {
        await manager.assertStorageQuotaAvailable(1024);
      },
      (err: any) => err instanceof OfflineStorageError && err.code === 'STORAGE_QUOTA_EXCEEDED'
    );
  });

  it('9. should delete local resource without affecting server data', async () => {
    manager = new BethesdaOfflineManager(storage);

    await storage.saveMetadata({
      id: 'local_song_delete',
      resourceType: 'SONG',
      title: 'Local Copy',
      versionNumber: 1,
      downloadedAt: new Date().toISOString(),
      lastValidatedAt: new Date().toISOString(),
      ownerUserId: 'user_alice',
      byteSize: 1024,
      status: 'AVAILABLE_OFFLINE',
      checksumSha256: 'hash_del',
    });

    await manager.deleteLocalResource('local_song_delete');

    const check = await storage.getMetadata('local_song_delete');
    assert.strictEqual(check, null, 'Local resource should be deleted');
  });

  it('10. should not falsely revoke local songs beyond first 100 server results (Finding C)', async () => {
    // Generate 150 items across 2 pages
    const page1Items = Array.from({ length: 100 }, (_, i) => ({
      id: `song_catalog_${i}`,
      title: `Song Catalog ${i}`,
      artist: 'Artist',
      ccliNumber: null,
      defaultKey: 'C',
      defaultBpm: 120,
      timeSignature: '4/4',
      status: 'APPROVED',
      currentVersionId: `v_${i}`,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }));

    const page2Items = Array.from({ length: 50 }, (_, i) => ({
      id: `song_catalog_${100 + i}`,
      title: `Song Catalog ${100 + i}`,
      artist: 'Artist',
      ccliNumber: null,
      defaultKey: 'C',
      defaultBpm: 120,
      timeSignature: '4/4',
      status: 'APPROVED',
      currentVersionId: `v_${100 + i}`,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }));

    // Local song is at index 120 (on page 2)
    const localSongId = 'song_catalog_120';
    await storage.saveMetadata({
      id: localSongId,
      resourceType: 'SONG',
      title: 'Song Catalog 120',
      versionNumber: 1,
      ownerUserId: 'user_test',
      status: 'AVAILABLE_OFFLINE',
      downloadedAt: new Date().toISOString(),
      lastValidatedAt: new Date().toISOString(),
      byteSize: 1024,
      checksumSha256: 'hash_120',
    });

    const mockPaginatedApiClient: any = {
      listSongs: async (params?: { limit?: number; offset?: number }) => {
        const offset = params?.offset ?? 0;
        if (offset === 0) {
          return { items: page1Items, total: 150 };
        }
        return { items: page2Items, total: 150 };
      },
      getSong: async (id: string) => ({
        song: { id, title: `Song ${id}` },
        version: { versionNumber: 1, canonicalPayload: defaultCanonicalJson },
      }),
    };

    manager = new BethesdaOfflineManager(storage, mockPaginatedApiClient);
    manager.isOnline = () => true;

    const result = await manager.checkForUpdates();
    assert.strictEqual(result.revokedCount, 0, 'Song on page 2 must NOT be marked revoked');

    const meta = await storage.getMetadata(localSongId);
    assert.ok(meta !== null);
    assert.strictEqual(meta?.status, 'AVAILABLE_OFFLINE');
  });

  it('11. should detect actual newer server versions and mark status UPDATE_AVAILABLE (Finding C)', async () => {
    const songId = 'song_version_test';
    await storage.saveMetadata({
      id: songId,
      resourceType: 'SONG',
      title: 'Version Test Song',
      versionNumber: 1, // local is version 1
      ownerUserId: 'user_test',
      status: 'AVAILABLE_OFFLINE',
      downloadedAt: new Date().toISOString(),
      lastValidatedAt: new Date().toISOString(),
      byteSize: 1024,
      checksumSha256: 'hash_ver',
    });

    const mockVersionApiClient: any = {
      listSongs: async () => ({
        items: [{ id: songId, title: 'Version Test Song' }],
        total: 1,
      }),
      getSong: async (id: string) => ({
        song: { id, title: 'Version Test Song' },
        version: { versionNumber: 2, canonicalPayload: defaultCanonicalJson }, // server is version 2!
      }),
    };

    manager = new BethesdaOfflineManager(storage, mockVersionApiClient);
    manager.isOnline = () => true;

    const result = await manager.checkForUpdates();
    assert.strictEqual(result.updatedCount, 1, 'Should detect 1 updated song');
    assert.strictEqual(result.revokedCount, 0);

    const meta = await storage.getMetadata(songId);
    assert.strictEqual(meta?.status, 'UPDATE_AVAILABLE');
  });

  it('12. should mark status FAILED and increment revokedCount when server confirms genuine removal (404/401/403) (Finding C)', async () => {
    const removedSongId = 'song_genuinely_removed';
    await storage.saveMetadata({
      id: removedSongId,
      resourceType: 'SONG',
      title: 'Removed Song',
      versionNumber: 1,
      ownerUserId: 'user_test',
      status: 'AVAILABLE_OFFLINE',
      downloadedAt: new Date().toISOString(),
      lastValidatedAt: new Date().toISOString(),
      byteSize: 1024,
      checksumSha256: 'hash_rem',
    });

    const mockRemovedApiClient: any = {
      listSongs: async () => ({
        items: [], // Catalog is empty
        total: 0,
      }),
      getSong: async (id: string) => {
        const err: any = new Error(`Error al obtener canción '${id}': HTTP 404`);
        err.statusCode = 404;
        throw err;
      },
    };

    manager = new BethesdaOfflineManager(storage, mockRemovedApiClient);
    manager.isOnline = () => true;

    const result = await manager.checkForUpdates();
    assert.strictEqual(result.revokedCount, 1, 'Removed song must be counted as revoked');

    const meta = await storage.getMetadata(removedSongId);
    assert.strictEqual(meta?.status, 'FAILED');
    assert.ok(meta?.errorMessage?.includes('Autorización revocada o recurso retirado'));
  });

  it('13. should not revoke local resources or extend authorization when catalog response fails or is incomplete (Finding C)', async () => {
    const songId = 'song_net_err';
    const originalDate = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
    await storage.saveMetadata({
      id: songId,
      resourceType: 'SONG',
      title: 'Preserved Song',
      versionNumber: 1,
      ownerUserId: 'user_test',
      status: 'AVAILABLE_OFFLINE',
      downloadedAt: originalDate,
      lastValidatedAt: originalDate,
      byteSize: 1024,
      checksumSha256: 'hash_net',
    });

    const mockFailingApiClient: any = {
      listSongs: async () => {
        throw new Error('Network failure or incomplete catalog');
      },
    };

    manager = new BethesdaOfflineManager(storage, mockFailingApiClient);
    manager.isOnline = () => true;

    const result = await manager.checkForUpdates();
    assert.strictEqual(result.revokedCount, 0, 'No songs should be marked revoked on catalog network error');
    assert.strictEqual(result.updatedCount, 0);

    const meta = await storage.getMetadata(songId);
    assert.strictEqual(meta?.status, 'AVAILABLE_OFFLINE', 'Status must remain AVAILABLE_OFFLINE');
    assert.strictEqual(meta?.lastValidatedAt, originalDate, 'Authorization timestamp must NOT be modified');
  });

  it('14. should purge cached payload and block getAuthorizedSongPayload when server revokes via 401/403 in checkForUpdates (even with fresh 7-day timestamp)', async () => {
    const revokedSongId = 'song_revoked_401';
    const freshTimestamp = new Date(Date.now() - 3600 * 1000).toISOString(); // 1 hour old, well within 7 days

    const meta: OfflineResourceMetadata = {
      id: revokedSongId,
      resourceType: 'SONG',
      title: 'Revoked Song 401',
      versionNumber: 1,
      ownerUserId: 'user_alice',
      status: 'AVAILABLE_OFFLINE',
      downloadedAt: freshTimestamp,
      lastValidatedAt: freshTimestamp,
      byteSize: 1024,
      checksumSha256: 'hash_rev_401',
    };

    const payload: OfflineSongPayload = {
      id: revokedSongId,
      canonicalPayload: defaultCanonicalJson,
      metadata: meta,
      defaultKey: 'C',
      defaultBpm: 120,
      timeSignature: '4/4',
    };

    await storage.saveSongPayload(payload);

    // Also create a dependent setlist
    const setlistId = 'setlist_dep_1';
    const mockDetail: FrontendSetlistDetail = {
      id: setlistId,
      title: 'Sunday Service',
      scheduledDateTime: '2026-10-20T10:00:00Z',
      directorUserId: 'user_alice',
      status: 'ACTIVE',
      notes: null,
      createdAt: freshTimestamp,
      updatedAt: freshTimestamp,
      items: [
        {
          id: 'item_1',
          setlistId,
          sequenceOrder: 0,
          itemType: 'SONG',
          songId: revokedSongId,
          targetKey: 'C',
          musicalKey: 'C',
          targetBpm: 120,
          transitionType: null,
          momentTitle: null,
          durationMinutes: null,
          notesForTeam: null,
          createdAt: freshTimestamp,
          updatedAt: freshTimestamp,
          song: null,
        },
      ],
    };

    await storage.saveSetlistPayload({
      id: setlistId,
      setlistDetail: mockDetail,
      metadata: {
        id: setlistId,
        resourceType: 'SETLIST',
        title: 'Sunday Service',
        versionNumber: 1,
        ownerUserId: 'user_alice',
        status: 'AVAILABLE_OFFLINE',
        downloadedAt: freshTimestamp,
        lastValidatedAt: freshTimestamp,
        byteSize: 500,
        checksumSha256: 'hash_sl_1',
        associatedSongIds: [revokedSongId],
        missingSongIds: [],
      },
    });

    const mockRevokeApiClient: any = {
      listSongs: async () => ({
        items: [{ id: revokedSongId, title: 'Revoked Song 401' }],
        total: 1,
      }),
      getSong: async () => {
        const err: any = new Error('HTTP 403 Forbidden');
        err.statusCode = 403;
        throw err;
      },
    };

    manager = new BethesdaOfflineManager(storage, mockRevokeApiClient);
    manager.isOnline = () => true;

    // Verify before checkForUpdates: song payload exists in storage
    const beforePayload = await storage.getSongPayload(revokedSongId);
    assert.ok(beforePayload !== null, 'Song payload must exist before check');

    // Run checkForUpdates()
    const result = await manager.checkForUpdates();
    assert.strictEqual(result.revokedCount, 1, 'Should report 1 revoked resource');

    // Invariant: local payload in song_payloads MUST be purged
    const afterPayload = await storage.getSongPayload(revokedSongId);
    assert.strictEqual(afterPayload, null, 'Cached payload must be deleted from song_payloads store');

    // Invariant: metadata is marked FAILED
    const afterMeta = await storage.getMetadata(revokedSongId);
    assert.strictEqual(afterMeta?.status, 'FAILED');
    assert.ok(afterMeta?.errorMessage?.includes('Autorización revocada'));

    // Invariant: read-path getAuthorizedSongPayload rejects with UNAUTHORIZED_SESSION even though timestamp is fresh
    await assert.rejects(
      async () => {
        await manager.getAuthorizedSongPayload(revokedSongId);
      },
      (err: any) => err instanceof OfflineStorageError && err.code === 'UNAUTHORIZED_SESSION'
    );

    // Invariant: dependent setlist reflects missingSongIds
    const updatedSetlist = await storage.getSetlistPayload(setlistId);
    assert.ok(updatedSetlist?.metadata.missingSongIds?.includes(revokedSongId), 'Dependent setlist must flag revoked song as missing');
  });

  it('15. should purge cached payload and block getAuthorizedSongPayload when server confirms 404 removal of song absent from catalog', async () => {
    const absentSongId = 'song_removed_404';
    const freshTimestamp = new Date(Date.now() - 7200 * 1000).toISOString(); // 2 hours old

    const meta: OfflineResourceMetadata = {
      id: absentSongId,
      resourceType: 'SONG',
      title: 'Removed Song 404',
      versionNumber: 1,
      ownerUserId: 'user_alice',
      status: 'AVAILABLE_OFFLINE',
      downloadedAt: freshTimestamp,
      lastValidatedAt: freshTimestamp,
      byteSize: 1024,
      checksumSha256: 'hash_rem_404',
    };

    await storage.saveSongPayload({
      id: absentSongId,
      canonicalPayload: defaultCanonicalJson,
      metadata: meta,
      defaultKey: 'C',
      defaultBpm: 120,
      timeSignature: '4/4',
    });

    const mock404ApiClient: any = {
      listSongs: async () => ({
        items: [], // absent from complete catalog
        total: 0,
      }),
      getSong: async (id: string) => {
        const err: any = new Error(`HTTP 404 Not Found: ${id}`);
        err.statusCode = 404;
        throw err;
      },
    };

    manager = new BethesdaOfflineManager(storage, mock404ApiClient);
    manager.isOnline = () => true;

    const result = await manager.checkForUpdates();
    assert.strictEqual(result.revokedCount, 1);

    // Payload deleted
    assert.strictEqual(await storage.getSongPayload(absentSongId), null);

    // Read path rejects even with fresh timestamp
    await assert.rejects(
      async () => {
        await manager.getAuthorizedSongPayload(absentSongId);
      },
      (err: any) => err instanceof OfflineStorageError && err.code === 'UNAUTHORIZED_SESSION'
    );
  });

  it('16. should block getAuthorizedSongPayload if payload or metadata status is FAILED even if 7-day timestamp is fresh and client is offline', async () => {
    manager = new BethesdaOfflineManager(storage);
    manager.isOnline = () => false; // offline!

    const failedSongId = 'song_explicit_failed';
    const freshTimestamp = new Date(Date.now() - 3600 * 1000).toISOString(); // 1 hour old

    const meta: OfflineResourceMetadata = {
      id: failedSongId,
      resourceType: 'SONG',
      title: 'Failed Song Fresh Time',
      versionNumber: 1,
      ownerUserId: 'user_alice',
      status: 'FAILED',
      errorMessage: 'Revocación explícita por política de seguridad',
      downloadedAt: freshTimestamp,
      lastValidatedAt: freshTimestamp,
      byteSize: 1024,
      checksumSha256: 'hash_failed_fresh',
    };

    await storage.saveSongPayload({
      id: failedSongId,
      canonicalPayload: defaultCanonicalJson,
      metadata: meta,
      defaultKey: 'C',
      defaultBpm: 120,
      timeSignature: '4/4',
    });

    // Invariant: getAuthorizedSongPayload must NOT return the payload merely because timestamp is within 7 days!
    await assert.rejects(
      async () => {
        await manager.getAuthorizedSongPayload(failedSongId);
      },
      (err: any) => err instanceof OfflineStorageError && err.code === 'UNAUTHORIZED_SESSION'
    );
  });

  it('17. cross-user isolation: revoking Alice song does not affect Bob song or unowned (ownerUserId === null) resources', async () => {
    const aliceSongId = 'song_alice_revoked';
    const bobSongId = 'song_bob_valid';
    const unownedSongId = 'song_unowned_valid';
    const freshTimestamp = new Date().toISOString();

    await storage.saveSongPayload({
      id: aliceSongId,
      canonicalPayload: defaultCanonicalJson,
      defaultKey: 'C',
      defaultBpm: 120,
      timeSignature: '4/4',
      metadata: {
        id: aliceSongId,
        resourceType: 'SONG',
        title: 'Alice Song',
        versionNumber: 1,
        ownerUserId: 'user_alice',
        status: 'AVAILABLE_OFFLINE',
        downloadedAt: freshTimestamp,
        lastValidatedAt: freshTimestamp,
        byteSize: 1024,
        checksumSha256: 'hash_alice',
      },
    });

    await storage.saveSongPayload({
      id: bobSongId,
      canonicalPayload: defaultCanonicalJson,
      defaultKey: 'D',
      defaultBpm: 110,
      timeSignature: '4/4',
      metadata: {
        id: bobSongId,
        resourceType: 'SONG',
        title: 'Bob Song',
        versionNumber: 1,
        ownerUserId: 'user_bob',
        status: 'AVAILABLE_OFFLINE',
        downloadedAt: freshTimestamp,
        lastValidatedAt: freshTimestamp,
        byteSize: 1024,
        checksumSha256: 'hash_bob',
      },
    });

    await storage.saveSongPayload({
      id: unownedSongId,
      canonicalPayload: defaultCanonicalJson,
      defaultKey: 'E',
      defaultBpm: 100,
      timeSignature: '4/4',
      metadata: {
        id: unownedSongId,
        resourceType: 'SONG',
        title: 'Unowned Song',
        versionNumber: 1,
        ownerUserId: null,
        status: 'AVAILABLE_OFFLINE',
        downloadedAt: freshTimestamp,
        lastValidatedAt: freshTimestamp,
        byteSize: 1024,
        checksumSha256: 'hash_unowned',
      },
    });

    const mockIsolationApiClient: any = {
      listSongs: async () => ({
        items: [
          { id: aliceSongId, title: 'Alice Song' },
          { id: bobSongId, title: 'Bob Song' },
          { id: unownedSongId, title: 'Unowned Song' },
        ],
        total: 3,
      }),
      getSong: async (id: string) => {
        if (id === aliceSongId) {
          const err: any = new Error('HTTP 403 Forbidden for Alice');
          err.statusCode = 403;
          throw err;
        }
        return {
          song: { id, title: `Title ${id}` },
          version: { versionNumber: 1, canonicalPayload: defaultCanonicalJson },
        };
      },
    };

    manager = new BethesdaOfflineManager(storage, mockIsolationApiClient);
    manager.isOnline = () => true;

    const result = await manager.checkForUpdates();
    assert.strictEqual(result.revokedCount, 1, 'Only Alice song should be revoked');

    // Alice song is purged & FAILED
    assert.strictEqual(await storage.getSongPayload(aliceSongId), null);
    const aliceMeta = await storage.getMetadata(aliceSongId);
    assert.strictEqual(aliceMeta?.status, 'FAILED');

    // Bob song is completely intact and accessible
    const bobPayload = await storage.getSongPayload(bobSongId);
    assert.ok(bobPayload !== null, 'Bob song payload must NOT be deleted');
    const bobAuthorized = await manager.getAuthorizedSongPayload(bobSongId);
    assert.strictEqual(bobAuthorized?.id, bobSongId);
    const bobMeta = await storage.getMetadata(bobSongId);
    assert.strictEqual(bobMeta?.status, 'AVAILABLE_OFFLINE');
    assert.strictEqual(bobMeta?.ownerUserId, 'user_bob');

    // Unowned song is completely intact and accessible
    const unownedPayload = await storage.getSongPayload(unownedSongId);
    assert.ok(unownedPayload !== null, 'Unowned song payload must NOT be deleted');
    const unownedAuthorized = await manager.getAuthorizedSongPayload(unownedSongId);
    assert.strictEqual(unownedAuthorized?.id, unownedSongId);
    const unownedMeta = await storage.getMetadata(unownedSongId);
    assert.strictEqual(unownedMeta?.status, 'AVAILABLE_OFFLINE');
    assert.strictEqual(unownedMeta?.ownerUserId, null);
  });

  // ==========================================================================
  // R1-P1: INTEGRIDAD DE AUDIO OFFLINE Y CHECKSUM BINARIO REAL
  // ==========================================================================

  it('26. should compute exact SHA-256 over real binary bytes and detect modifications', async () => {
    const { computeBinarySha256 } = await import('../offline-manager.ts');

    const bytes1 = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
    const bytes2 = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
    const bytesModified = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 9]); // 1 bit/byte diferente

    const hash1 = await computeBinarySha256(bytes1);
    const hash2 = await computeBinarySha256(bytes2);
    const hashModified = await computeBinarySha256(bytesModified);

    assert.strictEqual(hash1, hash2, 'Identical bytes must produce identical SHA-256');
    assert.notStrictEqual(hash1, hashModified, 'Modified bytes must produce different SHA-256');
    assert.strictEqual(hash1.length, 64, 'SHA-256 hex must be 64 characters');
  });

  it('27. should download audio, verify expected binary checksum, and store verified record', async () => {
    const { computeBinarySha256 } = await import('../offline-manager.ts');

    const audioBytes = new Uint8Array([82, 73, 70, 70, 0, 0, 0, 0, 87, 65, 86, 69]); // RIFF....WAVE
    const expectedChecksum = await computeBinarySha256(audioBytes);

    // Mock global fetch for this test
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => {
      return new Response(new Blob([audioBytes], { type: 'audio/wav' }), {
        status: 200,
        headers: { 'Content-Type': 'audio/wav' },
      });
    };

    try {
      manager = new BethesdaOfflineManager(storage);
      manager.isOnline = () => true;

      const result = await manager.downloadAudio(
        'audio_verified_01',
        'https://api.bethesda.test/audio/audio_verified_01/download',
        'Pista de Batería',
        'user_david',
        expectedChecksum
      );

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.resourceId, 'audio_verified_01');

      // Verificar que el registro se guardó con el checksum correcto
      const record = await storage.getAudioRecord('audio_verified_01');
      assert.ok(record !== null, 'Audio record must exist in IndexedDB');
      assert.strictEqual(record?.metadata.checksumSha256, expectedChecksum);
      assert.strictEqual(record?.metadata.status, 'AVAILABLE_OFFLINE');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('28. should reject corrupted audio bytes when checksum does not match expected server hash', async () => {
    const realBytes = new Uint8Array([82, 73, 70, 70, 1, 2, 3, 4]);
    const corruptedBytes = new Uint8Array([82, 73, 70, 70, 9, 9, 9, 9]); // Bytes alterados en tránsito

    const { computeBinarySha256 } = await import('../offline-manager.ts');
    const trustedServerChecksum = await computeBinarySha256(realBytes);

    // Mock global fetch retornando bytes corruptos
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => {
      return new Response(new Blob([corruptedBytes], { type: 'audio/wav' }), {
        status: 200,
        headers: { 'Content-Type': 'audio/wav' },
      });
    };

    try {
      manager = new BethesdaOfflineManager(storage);
      manager.isOnline = () => true;

      const result = await manager.downloadAudio(
        'audio_corrupted_01',
        'https://api.bethesda.test/audio/audio_corrupted_01/download',
        'Pista Corrupta',
        'user_david',
        trustedServerChecksum // Esperaba hash de realBytes, pero recibe corruptedBytes
      );

      assert.strictEqual(result.success, false, 'Download must fail on checksum mismatch');
      assert.strictEqual(result.status, 'FAILED');
      assert.ok(result.error?.includes('Fallo de integridad criptográfica'));

      // Verificar que el registro fue marcado como FAILED en metadatos y no quedó AVAILABLE_OFFLINE
      const meta = await storage.getMetadata('audio_corrupted_01');
      assert.ok(meta !== null);
      assert.strictEqual(meta?.status, 'FAILED');
      assert.ok(meta?.errorMessage?.includes('Fallo de integridad criptográfica'));
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

