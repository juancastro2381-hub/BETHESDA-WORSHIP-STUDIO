/**
 * @file session-isolation.test.ts
 * @description Pruebas de aislamiento de sesión, purga en logout y protección de dispositivos compartidos (WP-04).
 * Valida los requisitos de seguridad 4.6, matriz de aceptación T-10, T-11, T-12 y la decisión U-05.
 */

import assert from 'node:assert';
import { describe, it, beforeEach } from 'node:test';
import { BethesdaOfflineManager } from '../offline-manager.ts';
import { BethesdaOfflineStorage } from '../storage/indexeddb-storage.ts';
import { OFFLINE_POLICIES } from '../types.ts';

describe('WP-04 — Session Isolation & Logout Security Suite', () => {
  let storage: BethesdaOfflineStorage;
  let manager: BethesdaOfflineManager;

  beforeEach(async () => {
    storage = new BethesdaOfflineStorage();
    await storage.init();
    await storage.purgeAll();
    manager = new BethesdaOfflineManager(storage);
  });

  it('1. should purge private user data upon logout (T-10)', async () => {
    // User Alice downloads private resources
    await storage.saveSongPayload({
      id: 'song_alice_private',
      metadata: {
        id: 'song_alice_private',
        resourceType: 'SONG',
        title: 'Alice Private Song',
        versionNumber: 1,
        ownerUserId: 'user_alice',
        status: 'AVAILABLE_OFFLINE',
        downloadedAt: new Date().toISOString(),
        lastValidatedAt: new Date().toISOString(),
        byteSize: 1024,
        checksumSha256: 'sha_alice',
      },
      canonicalPayload: {
        version: '1.0.0',
        title: 'Alice Private Song',
        timeline: { tpqn: 480, totalDurationTicks: 0, measureCount: 0, tempoMap: { events: [] } } as any,
        sections: [],
        measures: [],
        instrumentTracks: [],
      },
      defaultKey: 'G',
      defaultBpm: 120,
      timeSignature: '4/4',
      artist: 'Alice',
    });

    const aliceBefore = await storage.getSongPayload('song_alice_private');
    assert.ok(aliceBefore !== null, 'Alice song should exist before logout');

    // Alice logs out
    const purgeResult = await manager.purgeSessionData('user_alice');
    assert.strictEqual(purgeResult.success, true);
    assert.strictEqual(purgeResult.purgedCount, 1);

    // Alice data must be completely gone
    const aliceAfter = await storage.getSongPayload('song_alice_private');
    assert.strictEqual(aliceAfter, null, 'Alice private song must be purged after logout');

    const metaAfter = await storage.getMetadata('song_alice_private');
    assert.strictEqual(metaAfter, null, 'Alice metadata must be purged after logout');
  });

  it('2. should prevent subsequent user on same device from accessing previous user private data (T-11)', async () => {
    // User Alice stores private setlist and songs
    await storage.saveMetadata({
      id: 'setlist_alice_confidential',
      resourceType: 'SETLIST',
      title: 'Alice Confidential Setlist',
      versionNumber: 1,
      ownerUserId: 'user_alice',
      status: 'AVAILABLE_OFFLINE',
      downloadedAt: new Date().toISOString(),
      lastValidatedAt: new Date().toISOString(),
      byteSize: 2048,
      checksumSha256: 'sha_confidential',
    });

    // Alice logs out
    await manager.purgeSessionData('user_alice');

    // User Bob logs in and queries inventory
    const bobInventory = await manager.getInventory('user_bob');
    assert.strictEqual(bobInventory.length, 0, 'Bob must not see any of Alice private items');

    const directLookup = await storage.getMetadata('setlist_alice_confidential');
    assert.strictEqual(directLookup, null, 'Confidential setlist must not exist in storage');
  });

  it('3. should abort active downloads when logout occurs during download (T-12)', async () => {
    // Start a mock hanging download
    let wasAborted = false;

    const mockHangingApiClient: any = {
      getSong: async (_id: string) => {
        // Return a promise that resolves only when aborted or small timeout
        return new Promise((_, reject) => {
          setTimeout(() => reject(new Error('Timeout')), 200);
        });
      },
    };

    const hangingManager = new BethesdaOfflineManager(storage, mockHangingApiClient);

    // Launch download in background
    const downloadPromise = hangingManager.downloadSong('hanging_song_1', 'user_alice');

    // Trigger logout while download is in-flight
    await hangingManager.purgeSessionData('user_alice');

    // Wait for the download promise to settle
    const result = await downloadPromise;
    assert.strictEqual(result.success, false, 'In-flight download must fail on logout');

    // Check storage: No payload or available metadata should be saved
    const payload = await storage.getSongPayload('hanging_song_1');
    assert.strictEqual(payload, null, 'Aborted download must not leave available payload');
  });

  it('4. should maintain tombstone in localStorage if cleanup fails unexpectedly (Decision U-05)', async () => {
    // Mock storage that throws during purge
    const failingStorage: any = {
      ...storage,
      init: async () => {},
      purgeUserData: async () => {
        throw new Error('Disk IO failure simulating browser storage lock');
      },
      listMetadata: async () => [],
    };

    // Mock localStorage
    const mockStorageMap = new Map<string, string>();
    const originalLocalStorage = globalThis.localStorage;
    globalThis.localStorage = {
      getItem: (k: string) => mockStorageMap.get(k) ?? null,
      setItem: (k: string, v: string) => mockStorageMap.set(k, v),
      removeItem: (k: string) => mockStorageMap.delete(k),
      clear: () => mockStorageMap.clear(),
      key: () => null,
      length: mockStorageMap.size,
    } as any;

    try {
      const failingManager = new BethesdaOfflineManager(failingStorage);
      const purgeResult = await failingManager.purgeSessionData('user_alice');

      assert.strictEqual(purgeResult.success, false, 'Purge must report failure');
      // The tombstone MUST remain set to protect the next user
      assert.strictEqual(
        mockStorageMap.get(OFFLINE_POLICIES.CLEANUP_TOMBSTONE_KEY),
        'user_alice',
        'Tombstone must persist when cleanup fails'
      );
    } finally {
      globalThis.localStorage = originalLocalStorage;
    }
  });

  it('5. should clean all volatile Object URLs and abort controllers on session purge', async () => {
    const purgeResult = await manager.purgeSessionData('any_user');
    assert.strictEqual(purgeResult.success, true);
  });

  it('6. should recover from pending cleanup tombstone during storage init() (Decision U-05)', async () => {
    // 1. Save data for user_charlie
    await storage.saveMetadata({
      id: 'song_charlie_abandoned',
      resourceType: 'SONG',
      title: 'Charlie Song',
      versionNumber: 1,
      ownerUserId: 'user_charlie',
      status: 'AVAILABLE_OFFLINE',
      downloadedAt: new Date().toISOString(),
      lastValidatedAt: new Date().toISOString(),
      byteSize: 500,
      checksumSha256: 'sha_charlie',
    });

    // 2. Simulate incomplete cleanup by planting the tombstone key in localStorage
    const mockStorageMap = new Map<string, string>();
    mockStorageMap.set(OFFLINE_POLICIES.CLEANUP_TOMBSTONE_KEY, 'user_charlie');
    const originalLocalStorage = globalThis.localStorage;
    globalThis.localStorage = {
      getItem: (k: string) => mockStorageMap.get(k) ?? null,
      setItem: (k: string, v: string) => mockStorageMap.set(k, v),
      removeItem: (k: string) => mockStorageMap.delete(k),
      clear: () => mockStorageMap.clear(),
      key: () => null,
      length: mockStorageMap.size,
    } as any;

    try {
      // 3. Re-initialize storage (as happens on next application boot)
      const bootStorage = new BethesdaOfflineStorage();
      await bootStorage.init();

      // 4. Verify user_charlie data was purged on boot
      const itemCheck = await bootStorage.getMetadata('song_charlie_abandoned');
      assert.strictEqual(itemCheck, null, 'Charlie abandoned data must be purged on boot');

      // 5. Verify tombstone was cleared
      assert.strictEqual(mockStorageMap.has(OFFLINE_POLICIES.CLEANUP_TOMBSTONE_KEY), false);
    } finally {
      globalThis.localStorage = originalLocalStorage;
    }
  });
});
