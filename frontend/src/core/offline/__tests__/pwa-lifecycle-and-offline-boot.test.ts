/**
 * @file pwa-lifecycle-and-offline-boot.test.ts
 * @description Suite de validación para Fase 2D — WS-2D-01:
 * Hardening de PWA (`sw.js` v2), protocolo determinista `PRECACHE_ASSETS`,
 * ciclo de vida controlado de actualizaciones con protección de escenario en vivo,
 * persistencia segura de `OfflineSessionIdentity`, arranque en frío sin conexión (Offline Cold Boot),
 * aislamiento en dispositivos compartidos, cierre de sesión sin conexión y reconciliación con el servidor.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import {
  SW_SHELL_CACHE_NAME_V1,
  SW_SHELL_CACHE_NAME_V2,
  resolveEligiblePrecacheAssetUrl,
  executePrecacheAssetsProtocol,
  cleanupLegacyServiceWorkerCaches,
  discoverApplicationShellAssets,
  ServiceWorkerLifecycleManager,
} from '../sw-lifecycle-manager.ts';
import {
  OFFLINE_SESSION_IDENTITY_KEY,
  OFFLINE_IDENTITY_GRACE_PERIOD_MS,
  OFFLINE_CLOCK_SKEW_TOLERANCE_MS,
  saveOfflineSessionIdentity,
  loadValidOfflineSessionIdentity,
  validateOfflineSessionIdentityPayload,
  clearOfflineSessionIdentity,
  OfflineAuthLifecycleController,
  type StorageLike,
} from '../offline-session-identity.ts';
import { BethesdaOfflineStorage } from '../storage/indexeddb-storage.ts';
import { BethesdaOfflineManager } from '../offline-manager.ts';
import { OFFLINE_POLICIES, OfflineStorageError } from '../types.ts';
import { tokenManager } from '../../auth/token-manager.ts';
import type { AuthUser } from '../../auth/types.ts';

class MockMemoryStorage implements StorageLike {
  private readonly map = new Map<string, string>();

  public getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }

  public setItem(key: string, value: string): void {
    this.map.set(key, String(value));
  }

  public removeItem(key: string): void {
    this.map.delete(key);
  }

  public clear(): void {
    this.map.clear();
  }
}

describe('Phase 2D — WS-2D-01: PWA Hardening, Offline Cold-Boot & Secure Session Continuity Suite', () => {
  let mockStorage: MockMemoryStorage;

  beforeEach(() => {
    mockStorage = new MockMemoryStorage();
    tokenManager.clearToken();
    ServiceWorkerLifecycleManager.getInstance().dispose();
  });

  // =========================================================================
  // 1. SW.JS CACHE UPGRADE TO V2 AND OLD CACHE CLEANUP
  // =========================================================================
  it('1. should upgrade sw.js cache to bethesda-worship-studio-shell-v2, include Bravura font, and purge v1 cache on activate', async () => {
    const swPath = path.resolve(process.cwd(), 'public', 'sw.js');
    assert.ok(fs.existsSync(swPath), 'public/sw.js must exist');
    const swContent = fs.readFileSync(swPath, 'utf-8');

    assert.ok(
      swContent.includes("const CACHE_NAME = 'bethesda-worship-studio-shell-v2';"),
      'sw.js must declare CACHE_NAME as bethesda-worship-studio-shell-v2'
    );
    assert.ok(
      swContent.includes("'/fonts/Bravura.woff2'"),
      'sw.js must include /fonts/Bravura.woff2 in STATIC_SHELL_ASSETS'
    );
    assert.ok(
      swContent.includes("data.type === 'PRECACHE_ASSETS'"),
      'sw.js must handle PRECACHE_ASSETS messages'
    );
    assert.ok(
      swContent.includes("data.type === 'SKIP_WAITING'"),
      'sw.js must handle SKIP_WAITING messages'
    );

    const bravuraFontPath = path.resolve(process.cwd(), 'public', 'fonts', 'Bravura.woff2');
    assert.ok(fs.existsSync(bravuraFontPath), 'public/fonts/Bravura.woff2 must exist for offline notation rendering');

    // Verify deterministic cleanup of v1 cache while retaining v2
    const activeCaches = new Set<string>([
      SW_SHELL_CACHE_NAME_V1,
      'legacy-temp-cache-v0',
      SW_SHELL_CACHE_NAME_V2,
    ]);

    const cleanupResult = await cleanupLegacyServiceWorkerCaches(
      {
        keys: async () => Array.from(activeCaches),
        delete: async (cacheName: string) => activeCaches.delete(cacheName),
      },
      SW_SHELL_CACHE_NAME_V2
    );

    assert.deepStrictEqual(cleanupResult.deletedCaches, [
      SW_SHELL_CACHE_NAME_V1,
      'legacy-temp-cache-v0',
    ]);
    assert.strictEqual(cleanupResult.retainedCache, SW_SHELL_CACHE_NAME_V2);
    assert.strictEqual(activeCaches.has(SW_SHELL_CACHE_NAME_V1), false);
    assert.strictEqual(activeCaches.has(SW_SHELL_CACHE_NAME_V2), true);
  });

  // =========================================================================
  // 2. PRECACHE_ASSETS ACCEPTS VALID HTTP/HTTPS GET ASSETS
  // =========================================================================
  it('2. should accept valid http: and https: GET assets in PRECACHE_ASSETS (bundles, CSS, Bravura font, UI fonts)', async () => {
    const baseOrigin = 'https://worship.bethesda.org';
    const candidateUrls = [
      '/',
      '/index.html',
      '/assets/index-B9x81a.js',
      '/assets/index-C77d1f.css',
      '/fonts/Bravura.woff2',
      'https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap',
      'https://fonts.gstatic.com/s/inter/v18/UcCO3FwrK3iLTeHuS_nVMrMxCp50SjIw2boKoduKmMEVuLyfAZ9hiA.woff2',
    ];

    const writtenEntries: Array<{ cacheName: string; url: string }> = [];

    const result = await executePrecacheAssetsProtocol(candidateUrls, {
      baseOrigin,
      fetchFn: async (url: string) => ({
        status: 200,
        type: url.startsWith(baseOrigin) ? 'basic' : 'cors',
      }),
      putInCacheFn: async (cacheName: string, url: string) => {
        writtenEntries.push({ cacheName, url });
        return true;
      },
    });

    assert.strictEqual(result.cacheName, SW_SHELL_CACHE_NAME_V2);
    assert.strictEqual(result.rejected.length, 0);
    assert.strictEqual(result.cached.length, candidateUrls.length);
    assert.strictEqual(writtenEntries.length, candidateUrls.length);
    assert.ok(result.cached.includes('https://worship.bethesda.org/fonts/Bravura.woff2'));
    assert.ok(result.cached.includes('https://worship.bethesda.org/assets/index-B9x81a.js'));
  });

  // =========================================================================
  // 3. PRECACHE_ASSETS REJECTS /api/ ENDPOINTS
  // =========================================================================
  it('3. should strictly reject /api/ endpoints and credentialed query parameters in PRECACHE_ASSETS', async () => {
    const baseOrigin = 'https://worship.bethesda.org';
    const forbiddenUrls = [
      '/api/v1/auth/me',
      '/api/v1/auth/refresh',
      '/api/v1/songs',
      '/api/v1/setlists/active',
      'https://worship.bethesda.org/api/v1/users',
      'https://worship.bethesda.org/invitation?token=SECRET_INVITE_TOKEN_123',
      'https://worship.bethesda.org/reset?password=PlaintextPassword',
    ];

    let fetchCallCount = 0;
    let cacheWriteCount = 0;

    const result = await executePrecacheAssetsProtocol(forbiddenUrls, {
      baseOrigin,
      fetchFn: async () => {
        fetchCallCount++;
        return { status: 200, type: 'basic' };
      },
      putInCacheFn: async () => {
        cacheWriteCount++;
        return true;
      },
    });

    assert.strictEqual(result.cached.length, 0, 'Zero /api/ or token-bearing URLs may be cached');
    assert.strictEqual(fetchCallCount, 0, 'Forbidden URLs must be rejected before network fetch');
    assert.strictEqual(cacheWriteCount, 0, 'Zero cache writes may occur for /api/ endpoints');
    assert.strictEqual(result.rejected.length, forbiddenUrls.length);
    // Ensure query parameters were stripped from rejected diagnostics
    assert.ok(!result.rejected.some((r) => r.includes('SECRET_INVITE_TOKEN_123')));
  });

  // =========================================================================
  // 4. PRECACHE_ASSETS REJECTS UNSUPPORTED SCHEMES
  // =========================================================================
  it('4. should reject unsupported schemes (chrome-extension:, file:, data:, blob:, about:) in PRECACHE_ASSETS', async () => {
    const baseOrigin = 'https://worship.bethesda.org';
    const invalidSchemeUrls = [
      'chrome-extension://abcdefghijklmnop/inject.js',
      'moz-extension://123456/content.js',
      'file:///C:/Users/musician/score.xml',
      'data:application/javascript;base64,Y29uc29sZS5sb2coMSk=',
      'blob:https://worship.bethesda.org/550e8400-e29b-41d4-a716-446655440000',
      'about:blank',
      'javascript:alert(1)',
      'https://untrusted-third-party.example.com/malicious.js',
    ];

    for (const raw of invalidSchemeUrls) {
      assert.strictEqual(
        resolveEligiblePrecacheAssetUrl(raw, baseOrigin),
        null,
        `URL ${raw} must be rejected by resolveEligiblePrecacheAssetUrl`
      );
    }

    const result = await executePrecacheAssetsProtocol(invalidSchemeUrls, {
      baseOrigin,
      fetchFn: async () => ({ status: 200, type: 'basic' }),
      putInCacheFn: async () => true,
    });

    assert.strictEqual(result.cached.length, 0);
    assert.strictEqual(result.rejected.length, invalidSchemeUrls.length);
  });

  // =========================================================================
  // 5. PRECACHE_ASSETS HANDLES NON-200 OR FAILED RESPONSES SAFELY
  // =========================================================================
  it('5. should handle non-200 responses, opaque responses, network failures, and cache write errors safely without crashing', async () => {
    const baseOrigin = 'https://worship.bethesda.org';
    const mixedUrls = [
      '/assets/valid-bundle.js',
      '/assets/missing-404.js',
      '/assets/server-error-500.css',
      '/assets/opaque-asset.woff2',
      '/assets/network-timeout.js',
      '/assets/quota-exceeded.js',
    ];

    const result = await executePrecacheAssetsProtocol(mixedUrls, {
      baseOrigin,
      fetchFn: async (url: string) => {
        if (url.endsWith('missing-404.js')) return { status: 404, type: 'basic' };
        if (url.endsWith('server-error-500.css')) return { status: 500, type: 'basic' };
        if (url.endsWith('opaque-asset.woff2')) return { status: 0, type: 'opaque' };
        if (url.endsWith('network-timeout.js')) throw new Error('Network timeout');
        return { status: 200, type: 'basic' };
      },
      putInCacheFn: async (_cacheName: string, url: string) => {
        if (url.endsWith('quota-exceeded.js')) return false;
        return true;
      },
    });

    assert.deepStrictEqual(result.cached, ['https://worship.bethesda.org/assets/valid-bundle.js']);
    assert.strictEqual(result.rejected.length, 5);
  });

  // =========================================================================
  // 6. SERVICE WORKER UPDATE DEFERRAL WHILE ACTIVE SETLIST OR MUSIC STAND MODE IS ACTIVE
  // =========================================================================
  it('6. should defer Service Worker update activation while an ACTIVE setlist or isMusicStandMode is active', () => {
    const manager = new ServiceWorkerLifecycleManager();
    const sentMessages: unknown[] = [];
    const mockWaitingWorker = {
      postMessage: (msg: unknown) => {
        sentMessages.push(msg);
      },
    };

    // Case A: Musician has an ACTIVE setlist loaded on stage
    manager.setStageProtectionState({ isSetlistActive: true, isMusicStandMode: false });
    const snapActiveSetlist = manager.onWaitingWorkerDetected(mockWaitingWorker);

    assert.strictEqual(snapActiveSetlist.isStageProtected, true);
    assert.strictEqual(snapActiveSetlist.hasWaitingWorker, true);
    assert.strictEqual(snapActiveSetlist.isUpdateDeferred, true);
    assert.strictEqual(snapActiveSetlist.isUpdateReadyToApply, false);
    assert.strictEqual(
      manager.requestSafeUpdateActivation(),
      false,
      'Must refuse SKIP_WAITING activation while setlist is ACTIVE'
    );
    assert.strictEqual(sentMessages.length, 0, 'Zero SKIP_WAITING messages may be sent during ACTIVE setlist');

    // Case B: Setlist is not ACTIVE, but musician is in Music Stand Mode (isMusicStandMode === true)
    const snapMusicStand = manager.setStageProtectionState({
      isSetlistActive: false,
      isMusicStandMode: true,
    });

    assert.strictEqual(snapMusicStand.isStageProtected, true);
    assert.strictEqual(snapMusicStand.isUpdateDeferred, true);
    assert.strictEqual(snapMusicStand.isUpdateReadyToApply, false);
    assert.strictEqual(
      manager.requestSafeUpdateActivation(),
      false,
      'Must refuse SKIP_WAITING activation while isMusicStandMode is true'
    );
    assert.strictEqual(sentMessages.length, 0);
  });

  // =========================================================================
  // 7. SAFE SERVICE WORKER UPDATE WHEN NEITHER ACTIVE SETLIST NOR STAND MODE IS ACTIVE
  // =========================================================================
  it('7. should allow safe Service Worker update handshake when neither ACTIVE setlist nor isMusicStandMode is active, and clean up listeners', () => {
    const manager = new ServiceWorkerLifecycleManager();
    const sentMessages: unknown[] = [];
    const mockWaitingWorker = {
      postMessage: (msg: unknown) => {
        sentMessages.push(msg);
      },
    };

    // Start protected during live service
    manager.setStageProtectionState({ isSetlistActive: true, isMusicStandMode: true });
    manager.onWaitingWorkerDetected(mockWaitingWorker);
    assert.strictEqual(manager.getSnapshot().isUpdateReadyToApply, false);

    // Musician finishes worship service and exits Music Stand Mode
    const snapAfterService = manager.setStageProtectionState({
      isSetlistActive: false,
      isMusicStandMode: false,
    });

    assert.strictEqual(snapAfterService.isStageProtected, false);
    assert.strictEqual(snapAfterService.isUpdateDeferred, false);
    assert.strictEqual(snapAfterService.isUpdateReadyToApply, true);

    // User triggers safe update once
    const activated = manager.requestSafeUpdateActivation();
    assert.strictEqual(activated, true);
    assert.strictEqual(sentMessages.length, 1);
    assert.deepStrictEqual(sentMessages[0], { type: 'SKIP_WAITING' });

    // Prevent competing/duplicate SKIP_WAITING calls while already applying
    assert.strictEqual(manager.requestSafeUpdateActivation(), false);
    assert.strictEqual(sentMessages.length, 1);

    // Confirm controller change completes update cleanly
    const snapCompleted = manager.markUpdateApplied();
    assert.strictEqual(snapCompleted.hasWaitingWorker, false);
    assert.strictEqual(snapCompleted.isUpdateReadyToApply, false);
    assert.strictEqual(snapCompleted.isApplyingUpdate, false);

    // Verify discoverApplicationShellAssets and dispose cleanup
    const discovered = discoverApplicationShellAssets(
      {
        querySelectorAll: () => [
          { getAttribute: (attr: string) => (attr === 'src' ? '/assets/main-bundle.js' : null) },
          { getAttribute: (attr: string) => (attr === 'href' ? '/assets/main-style.css' : null) },
        ],
      },
      'https://worship.bethesda.org'
    );
    assert.ok(discovered.includes('https://worship.bethesda.org/fonts/Bravura.woff2'));
    assert.ok(discovered.includes('https://worship.bethesda.org/assets/main-bundle.js'));

    manager.dispose();
  });

  // =========================================================================
  // 8. OFFLINE SESSION IDENTITY CREATION AFTER VALID SERVER AUTHENTICATION
  // =========================================================================
  it('8. should persist OfflineSessionIdentity with only non-sensitive metadata after valid server authentication', () => {
    const validUser: AuthUser = {
      id: 'user-musician-01',
      email: 'saxofon@bethesda.org',
      firstName: 'Daniel',
      lastName: 'Castro',
      role: 'MUSICIAN',
      accountStatus: 'ACTIVE',
      mustChangePassword: false,
    };

    const nowIso = '2026-11-12T15:00:00.000Z';
    const saved = saveOfflineSessionIdentity(validUser, {
      nowIso,
      storage: mockStorage,
    });

    assert.ok(saved !== null);
    assert.deepStrictEqual(Object.keys(saved).sort(), [
      'email',
      'fullName',
      'lastAuthenticatedAt',
      'role',
      'userId',
    ]);
    assert.strictEqual(saved.userId, 'user-musician-01');
    assert.strictEqual(saved.email, 'saxofon@bethesda.org');
    assert.strictEqual(saved.fullName, 'Daniel Castro');
    assert.strictEqual(saved.role, 'MUSICIAN');
    assert.strictEqual(saved.lastAuthenticatedAt, nowIso);

    // Must refuse persistence if mustChangePassword is true or account is not ACTIVE
    const mustChangeUser: AuthUser = {
      ...validUser,
      mustChangePassword: true,
      accountStatus: 'MUST_CHANGE_PASSWORD',
    };
    const refused = saveOfflineSessionIdentity(mustChangeUser, {
      nowIso,
      storage: mockStorage,
    });
    assert.strictEqual(refused, null);
    assert.strictEqual(mockStorage.getItem(OFFLINE_SESSION_IDENTITY_KEY), null);
  });

  // =========================================================================
  // 9. REJECTION OF CREDENTIALS OR TOKENS IN OFFLINE SESSION IDENTITY
  // =========================================================================
  it('9. should strictly reject any attempt to store or restore tokens, passwords, cookies, or secrets in OfflineSessionIdentity', () => {
    const nowIso = new Date().toISOString();
    const baseIdentity = {
      userId: 'user-01',
      email: 'musico@bethesda.org',
      fullName: 'Juan Perez',
      role: 'MUSICIAN',
      lastAuthenticatedAt: nowIso,
    };

    const forbiddenPayloads = [
      { ...baseIdentity, accessToken: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.a.b' },
      { ...baseIdentity, refreshToken: 'refresh-secret-123' },
      { ...baseIdentity, password: 'secretPassword!' },
      { ...baseIdentity, sessionCookie: 'sid=12345' },
      { ...baseIdentity, authSecret: 'top-secret' },
      { ...baseIdentity, fullName: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxIn0.sig' },
      { ...baseIdentity, extraUnexpectedField: 'unexpected' },
    ];

    for (const payload of forbiddenPayloads) {
      const check = validateOfflineSessionIdentityPayload(payload);
      assert.strictEqual(
        check.valid,
        false,
        `Payload with keys [${Object.keys(payload).join(', ')}] must be rejected`
      );

      mockStorage.setItem(OFFLINE_SESSION_IDENTITY_KEY, JSON.stringify(payload));
      const loaded = loadValidOfflineSessionIdentity({ storage: mockStorage });
      assert.strictEqual(loaded, null, 'Corrupted/credentialed identity must fail closed on load');
      assert.strictEqual(
        mockStorage.getItem(OFFLINE_SESSION_IDENTITY_KEY),
        null,
        'Rejected identity must be purged from storage immediately'
      );
    }
  });

  // =========================================================================
  // 10. SUCCESSFUL OFFLINE COLD BOOT / F5 RESTORATION WITHIN 7-DAY GRACE PERIOD
  // =========================================================================
  it('10. should restore offline cold boot / F5 reload within 7-day grace period in strict read-only mode without extending lastAuthenticatedAt', async () => {
    const initialAuthMs = Date.parse('2026-11-10T10:00:00.000Z');
    const initialAuthIso = new Date(initialAuthMs).toISOString();
    // 3 days later (within 7-day grace period)
    const coldBootMs = initialAuthMs + 3 * 24 * 60 * 60 * 1000;

    const adminUser: AuthUser = {
      id: 'user-admin-01',
      email: 'director@bethesda.org',
      firstName: 'Carlos',
      lastName: 'Rivera',
      role: 'SUPER_ADMIN',
      accountStatus: 'ACTIVE',
      mustChangePassword: false,
    };

    saveOfflineSessionIdentity(adminUser, {
      nowIso: initialAuthIso,
      storage: mockStorage,
    });

    let readOnlyGuardState = false;
    const controller = new OfflineAuthLifecycleController({
      isOnlineFn: () => false, // Genuinely offline during Cold Boot / F5
      refreshSessionFn: async () => {
        throw new Error('Failed to fetch: net::ERR_INTERNET_DISCONNECTED');
      },
      serverLogoutFn: async () => {},
      purgeUserSessionDataFn: async () => ({ success: true, purgedCount: 0 }),
      setOfflineReadOnlyGuardFn: (active) => {
        readOnlyGuardState = active;
      },
      storage: mockStorage,
      nowFn: () => coldBootMs,
    });

    const state = await controller.initializeSession({ nowMs: coldBootMs });

    assert.strictEqual(state.authStatus, 'AUTHENTICATED');
    assert.strictEqual(state.isOfflineSession, true);
    assert.strictEqual(state.isReadOnlyOffline, true);
    assert.strictEqual(readOnlyGuardState, true);
    assert.strictEqual(
      state.canManageUsers,
      false,
      'Safeguard A & B: Even SUPER_ADMIN must have canManageUsers === false while in offline read-only session'
    );
    assert.strictEqual(tokenManager.getToken(), null, 'Zero access tokens may exist in offline cold boot');
    assert.strictEqual(state.user?.id, 'user-admin-01');
    assert.strictEqual(state.user?.email, 'director@bethesda.org');
    assert.strictEqual(
      state.offlineIdentity?.lastAuthenticatedAt,
      initialAuthIso,
      'Safeguard D: lastAuthenticatedAt must NEVER be extended on offline cold boot'
    );

    // Verify server mutations are strictly blocked
    assert.throws(
      () => controller.assertOnlineServerMutationAllowed(),
      (err: unknown) => err instanceof OfflineStorageError && err.code === 'UNAUTHORIZED_SESSION'
    );
  });

  // =========================================================================
  // 11. REJECTION OF EXPIRED OFFLINE SESSION IDENTITY BEYOND 7 DAYS
  // =========================================================================
  it('11. should reject expired OfflineSessionIdentity beyond 7 days and reject future timestamps beyond clock-skew tolerance', async () => {
    const authTimeMs = Date.parse('2026-11-01T12:00:00.000Z');
    const authTimeIso = new Date(authTimeMs).toISOString();

    const musician: AuthUser = {
      id: 'user-expired-01',
      email: 'piano@bethesda.org',
      firstName: 'Ana',
      lastName: 'Gomez',
      role: 'MUSICIAN',
      accountStatus: 'ACTIVE',
    };

    saveOfflineSessionIdentity(musician, {
      nowIso: authTimeIso,
      storage: mockStorage,
    });

    // Exactly 7 days later (>= OFFLINE_IDENTITY_GRACE_PERIOD_MS) -> Expired!
    const expiredNowMs = authTimeMs + OFFLINE_IDENTITY_GRACE_PERIOD_MS;
    const loadedExpired = loadValidOfflineSessionIdentity({
      nowMs: expiredNowMs,
      storage: mockStorage,
    });
    assert.strictEqual(loadedExpired, null, 'Identity at or beyond 7 days must be rejected');
    assert.strictEqual(
      mockStorage.getItem(OFFLINE_SESSION_IDENTITY_KEY),
      null,
      'Expired identity must be removed from storage'
    );

    // Re-save and test clock tampering (> 5 minutes in the future)
    saveOfflineSessionIdentity(musician, {
      nowIso: authTimeIso,
      storage: mockStorage,
    });
    const tamperedPastClockMs = authTimeMs - (OFFLINE_CLOCK_SKEW_TOLERANCE_MS + 10_000);
    const loadedSkewed = loadValidOfflineSessionIdentity({
      nowMs: tamperedPastClockMs,
      storage: mockStorage,
    });
    assert.strictEqual(loadedSkewed, null, 'Clock-skewed identity (> 5 min in future) must be rejected');
  });

  // =========================================================================
  // 12. REJECTION OF CORRUPTED OR MALFORMED OFFLINE SESSION IDENTITY
  // =========================================================================
  it('12. should fail closed on corrupted JSON, malformed fields, invalid roles, or pending cleanup tombstone', () => {
    const malformedCases = [
      '{not-valid-json',
      'null',
      '[]',
      JSON.stringify({ userId: '', email: 'a@b.com', fullName: 'A', role: 'MUSICIAN', lastAuthenticatedAt: new Date().toISOString() }),
      JSON.stringify({ userId: 'u1', email: 'not-an-email', fullName: 'A', role: 'MUSICIAN', lastAuthenticatedAt: new Date().toISOString() }),
      JSON.stringify({ userId: 'u1', email: 'a@b.com', fullName: 'A', role: 'HACKER_ROLE', lastAuthenticatedAt: new Date().toISOString() }),
      JSON.stringify({ userId: 'u1', email: 'a@b.com', fullName: 'A', role: 'MUSICIAN', lastAuthenticatedAt: 'invalid-date' }),
    ];

    for (const raw of malformedCases) {
      mockStorage.setItem(OFFLINE_SESSION_IDENTITY_KEY, raw);
      const res = loadValidOfflineSessionIdentity({ storage: mockStorage });
      assert.strictEqual(res, null, `Malformed identity ${raw} must fail closed`);
      assert.strictEqual(mockStorage.getItem(OFFLINE_SESSION_IDENTITY_KEY), null);
    }

    // Also verify that if a cleanup tombstone exists, valid identity is rejected and cleared
    const validUser: AuthUser = {
      id: 'user-tombstone',
      email: 'tombstone@bethesda.org',
      firstName: 'Luis',
      lastName: 'Mora',
      role: 'MUSICIAN',
      accountStatus: 'ACTIVE',
    };
    saveOfflineSessionIdentity(validUser, { storage: mockStorage });
    mockStorage.setItem(OFFLINE_POLICIES.CLEANUP_TOMBSTONE_KEY, 'user-tombstone');

    const blockedByTombstone = loadValidOfflineSessionIdentity({ storage: mockStorage });
    assert.strictEqual(
      blockedByTombstone,
      null,
      'Pending cleanup tombstone must block offline session restoration (Fail Closed)'
    );
  });

  // =========================================================================
  // 13. SHARED-DEVICE ISOLATION: USER B NEVER INHERITS USER A'S IDENTITY OR DATA
  // =========================================================================
  it('13. should isolate shared devices: logging in as User B purges User A offline data and replaces OfflineSessionIdentity', async () => {
    const idbStorage = new BethesdaOfflineStorage();
    await idbStorage.init();
    await idbStorage.purgeAll();
    const manager = new BethesdaOfflineManager(idbStorage);

    // User A stores private offline song and identity
    await idbStorage.saveSongPayload({
      id: 'song-private-user-a',
      metadata: {
        id: 'song-private-user-a',
        resourceType: 'SONG',
        title: 'User A Private Worship Song',
        versionNumber: 1,
        ownerUserId: 'user-alice',
        status: 'AVAILABLE_OFFLINE',
        downloadedAt: new Date().toISOString(),
        lastValidatedAt: new Date().toISOString(),
        byteSize: 1024,
        checksumSha256: 'sha256-alice',
      },
      canonicalPayload: {
        version: '1.0.0',
        title: 'User A Private Worship Song',
        timeline: { tpqn: 480, totalDurationTicks: 0, measureCount: 0, tempoMap: { events: [] } } as any,
        sections: [],
        measures: [],
        instrumentTracks: [],
      },
      defaultKey: 'C',
      defaultBpm: 120,
      timeSignature: '4/4',
    });

    const userAlice: AuthUser = {
      id: 'user-alice',
      email: 'alice@bethesda.org',
      firstName: 'Alice',
      lastName: 'Smith',
      role: 'WORSHIP_LEADER',
      accountStatus: 'ACTIVE',
    };

    const userBob: AuthUser = {
      id: 'user-bob',
      email: 'bob@bethesda.org',
      firstName: 'Bob',
      lastName: 'Jones',
      role: 'MUSICIAN',
      accountStatus: 'ACTIVE',
    };

    const purgedUsers: string[] = [];
    const controller = new OfflineAuthLifecycleController({
      isOnlineFn: () => true,
      refreshSessionFn: async () => ({ accessToken: 'bob-jwt-token', user: userBob }),
      serverLogoutFn: async () => {},
      purgeUserSessionDataFn: async (uid) => {
        if (uid) purgedUsers.push(uid);
        return await manager.purgeSessionData(uid);
      },
      storage: mockStorage,
    });

    // 1. Alice authenticates first
    await controller.activateServerAuthenticatedSession(userAlice, 'alice-jwt-token');
    assert.strictEqual(controller.getState().user?.id, 'user-alice');

    // 2. Bob logs in on the same shared device without Alice having explicitly logged out
    await controller.activateServerAuthenticatedSession(userBob, 'bob-jwt-token');

    assert.deepStrictEqual(purgedUsers, ['user-alice'], 'Alice private data must be purged when Bob logs in');
    assert.strictEqual(
      await idbStorage.getSongPayload('song-private-user-a'),
      null,
      'User A private song payload must be completely removed from IndexedDB'
    );
    assert.strictEqual(controller.getState().user?.id, 'user-bob');
    assert.strictEqual(controller.getState().offlineIdentity?.userId, 'user-bob');
    assert.strictEqual(controller.getState().offlineIdentity?.email, 'bob@bethesda.org');
  });

  // =========================================================================
  // 14. OFFLINE LOGOUT CLEARS IDENTITY, PURGES DATA, AND PREVENTS STALE RESTORATION
  // =========================================================================
  it('14. should execute offline logout locally, purge private data, distinguish localCleared from serverRevoked, and block stale in-flight refresh', async () => {
    const idbStorage = new BethesdaOfflineStorage();
    await idbStorage.init();
    await idbStorage.purgeAll();
    const manager = new BethesdaOfflineManager(idbStorage);

    const userAlice: AuthUser = {
      id: 'user-alice-offline-logout',
      email: 'alice@bethesda.org',
      firstName: 'Alice',
      lastName: 'Worship',
      role: 'MUSICIAN',
      accountStatus: 'ACTIVE',
    };

    saveOfflineSessionIdentity(userAlice, { storage: mockStorage });
    await idbStorage.saveMetadata({
      id: 'setlist-alice-01',
      resourceType: 'SETLIST',
      title: 'Culto Dominical Alice',
      versionNumber: 1,
      ownerUserId: userAlice.id,
      status: 'AVAILABLE_OFFLINE',
      downloadedAt: new Date().toISOString(),
      lastValidatedAt: new Date().toISOString(),
      byteSize: 512,
      checksumSha256: 'sha-setlist-alice',
    });

    let isNetworkOnline = false;
    const refreshResolvers: Array<(val: { accessToken: string; user: AuthUser }) => void> = [];

    const controller = new OfflineAuthLifecycleController({
      isOnlineFn: () => isNetworkOnline,
      refreshSessionFn: () =>
        new Promise((resolve) => {
          refreshResolvers.push(resolve);
        }),
      serverLogoutFn: async () => {
        throw new Error('Offline: cannot reach /auth/logout');
      },
      purgeUserSessionDataFn: async (uid) => await manager.purgeSessionData(uid),
      storage: mockStorage,
    });

    // Boot offline into Alice's read-only session
    const bootState = await controller.initializeSession();
    assert.strictEqual(bootState.isOfflineSession, true);
    assert.strictEqual(bootState.user?.id, userAlice.id);

    // Start an in-flight reconnect refresh, then immediately call offline logout before it resolves
    isNetworkOnline = true;
    const inFlightReconnect = controller.reconcileOnReconnect();
    isNetworkOnline = false;

    const logoutResult = await controller.logout();

    // Resolve the stale in-flight refresh AFTER logout occurred
    for (const resolveFn of refreshResolvers) {
      resolveFn({ accessToken: 'stale-token', user: userAlice });
    }
    await inFlightReconnect;

    // Verify offline logout succeeded locally and clearly reported serverRevoked: false
    assert.strictEqual(logoutResult.localCleared, true);
    assert.strictEqual(logoutResult.serverRevoked, false);
    assert.strictEqual(logoutResult.purgedOfflineItemsCount, 1);

    // Verify stale in-flight refresh did NOT restore Alice's session
    const finalState = controller.getState();
    assert.strictEqual(finalState.authStatus, 'UNAUTHENTICATED');
    assert.strictEqual(finalState.user, null);
    assert.strictEqual(finalState.offlineIdentity, null);
    assert.strictEqual(mockStorage.getItem(OFFLINE_SESSION_IDENTITY_KEY), null);
    assert.strictEqual(await idbStorage.getMetadata('setlist-alice-01'), null);
  });

  // =========================================================================
  // 15. ONLINE RECONNECTION REVALIDATES AGAINST SERVER AND REVOKES ON 401/403
  // =========================================================================
  it('15. should revalidate on online reconnection, never silently promote without server validation, and immediately purge on 401/403 revocation', async () => {
    const idbStorage = new BethesdaOfflineStorage();
    await idbStorage.init();
    await idbStorage.purgeAll();
    const manager = new BethesdaOfflineManager(idbStorage);

    const userMusician: AuthUser = {
      id: 'user-reconnect-01',
      email: 'violin@bethesda.org',
      firstName: 'Elena',
      lastName: 'Vargas',
      role: 'ADMIN',
      accountStatus: 'ACTIVE',
    };

    const initialAuthIso = '2026-11-11T08:00:00.000Z';
    saveOfflineSessionIdentity(userMusician, {
      nowIso: initialAuthIso,
      storage: mockStorage,
    });

    await idbStorage.saveMetadata({
      id: 'song-elena-01',
      resourceType: 'SONG',
      title: 'Sublime Gracia',
      versionNumber: 1,
      ownerUserId: userMusician.id,
      status: 'AVAILABLE_OFFLINE',
      downloadedAt: initialAuthIso,
      lastValidatedAt: initialAuthIso,
      byteSize: 2048,
      checksumSha256: 'sha-elena',
    });

    let onlineState = false;
    let refreshMode: 'TRANSIENT_NETWORK_ERROR' | 'SUCCESS' | 'REVOKED_401' = 'TRANSIENT_NETWORK_ERROR';

    const controller = new OfflineAuthLifecycleController({
      isOnlineFn: () => onlineState,
      refreshSessionFn: async () => {
        if (refreshMode === 'TRANSIENT_NETWORK_ERROR') {
          throw new Error('Network error: ECONNRESET');
        }
        if (refreshMode === 'REVOKED_401') {
          const err = new Error('Sesión expirada o revocada (HTTP 401)') as Error & { statusCode: number };
          err.statusCode = 401;
          throw err;
        }
        return {
          accessToken: 'fresh-server-jwt-token',
          user: userMusician,
        };
      },
      serverLogoutFn: async () => {},
      purgeUserSessionDataFn: async (uid) => await manager.purgeSessionData(uid),
      storage: mockStorage,
      nowFn: () => Date.parse('2026-11-12T10:00:00.000Z'),
    });

    // Step 1: Cold boot offline
    const step1 = await controller.initializeSession();
    assert.strictEqual(step1.isOfflineSession, true);
    assert.strictEqual(step1.isReadOnlyOffline, true);
    assert.strictEqual(step1.canManageUsers, false);

    // Step 2: Browser reports online, but server is still unreachable (transient network error)
    // Must NOT silently promote offline identity into an online session!
    onlineState = true;
    refreshMode = 'TRANSIENT_NETWORK_ERROR';
    const step2 = await controller.reconcileOnReconnect();
    assert.strictEqual(
      step2.isOfflineSession,
      true,
      'Must NOT promote offline identity to online session when server validation fails due to network glitch'
    );
    assert.strictEqual(step2.isReadOnlyOffline, true);
    assert.strictEqual(step2.canManageUsers, false);
    assert.strictEqual(tokenManager.getToken(), null);

    // Step 3: Server responds with valid session -> promotes to online authenticated session & updates lastAuthenticatedAt
    refreshMode = 'SUCCESS';
    const reconnectTimeMs = Date.parse('2026-11-12T12:30:00.000Z');
    const step3 = await controller.reconcileOnReconnect({ nowMs: reconnectTimeMs });
    assert.strictEqual(step3.authStatus, 'AUTHENTICATED');
    assert.strictEqual(step3.isOfflineSession, false);
    assert.strictEqual(step3.isReadOnlyOffline, false);
    assert.strictEqual(step3.canManageUsers, true);
    assert.strictEqual(tokenManager.getToken(), 'fresh-server-jwt-token');
    assert.strictEqual(
      step3.offlineIdentity?.lastAuthenticatedAt,
      new Date(reconnectTimeMs).toISOString(),
      'Successful server revalidation must update lastAuthenticatedAt'
    );

    // Step 4: Later reconnection returns HTTP 401 (session revoked or account disabled on server)
    // Must immediately invalidate offline identity and purge private session data!
    refreshMode = 'REVOKED_401';
    const step4 = await controller.reconcileOnReconnect();
    assert.strictEqual(step4.authStatus, 'UNAUTHENTICATED');
    assert.strictEqual(step4.user, null);
    assert.strictEqual(step4.isOfflineSession, false);
    assert.strictEqual(step4.canManageUsers, false);
    assert.strictEqual(tokenManager.getToken(), null);
    assert.strictEqual(mockStorage.getItem(OFFLINE_SESSION_IDENTITY_KEY), null);
    assert.strictEqual(
      await idbStorage.getMetadata('song-elena-01'),
      null,
      'Private offline data must be purged immediately upon server 401/403 revocation'
    );
  });
});
