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
import { OFFLINE_POLICIES, OfflineStorageError } from '../types.ts';
import type { BackendSongResponse } from '../../api/api-client.ts';

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
});
