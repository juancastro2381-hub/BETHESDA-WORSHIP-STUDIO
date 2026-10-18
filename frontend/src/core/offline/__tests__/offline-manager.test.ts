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

    // Test B: When online -> successfully revalidates with server and updates lastValidatedAt
    manager.isOnline = () => true;
    const revalidated = await manager.getAuthorizedSongPayload('song_expiry_1');
    assert.ok(revalidated !== null);
    assert.strictEqual(manager.isAuthorizationExpired(revalidated.metadata), false);

    // Test C: When server returns 401/403 -> revokes and purges local copy
    mockApiClient.getSong = async () => {
      const err: any = new Error('Forbidden');
      err.statusCode = 403;
      throw err;
    };
    // Make it expired again
    await storage.saveMetadata({
      ...revalidated.metadata,
      lastValidatedAt: expiredDate,
    });

    await assert.rejects(
      async () => {
        await manager.getAuthorizedSongPayload('song_expiry_1');
      },
      (err: any) => err instanceof OfflineStorageError && err.code === 'UNAUTHORIZED_SESSION'
    );
    const purgedCheck = await storage.getSongPayload('song_expiry_1');
    assert.strictEqual(purgedCheck, null, 'Song must be purged after 403 response');
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
});
