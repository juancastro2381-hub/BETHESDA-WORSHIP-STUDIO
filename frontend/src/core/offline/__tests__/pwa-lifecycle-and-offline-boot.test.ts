/**
 * @file pwa-lifecycle-and-offline-boot.test.ts
 * @description Suite de validación y regresión de seguridad para Fase 2D — WS-2D-01:
 * - Hardening de PWA (`sw.js` v2) y aislamiento de propiedad de caché (`bethesda-worship-studio-shell-*`, Finding A)
 * - Protocolo determinista `PRECACHE_ASSETS` y validación endurecida de parámetros URL (`URLSearchParams` + decodificación porcentual)
 * - Ciclo de vida controlado de actualizaciones con protección de escenario en vivo
 * - Persistencia segura de `OfflineSessionIdentity` y arranque en frío sin conexión (Offline Cold Boot)
 * - Transición atómica a modo offline con invalidación inmediata del token en memoria (Finding B)
 * - Compuerta centralizada fail-closed de mutaciones al servidor (`POST`, `PUT`, `PATCH`, `DELETE`, Finding C)
 * - Aislamiento en dispositivos compartidos, cierre de sesión sin conexión y reconciliación con el servidor.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import {
  BETHESDA_SW_CACHE_PREFIX,
  SW_SHELL_CACHE_NAME_V1,
  SW_SHELL_CACHE_NAME_V2,
  isOwnedObsoleteShellCache,
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
  OfflineAuthLifecycleController,
  setOfflineReadOnlyMutationGuard,
  isOfflineReadOnlyMutationGuardActive,
  setSimulatedOnlineStateForTests,
  type StorageLike,
} from '../offline-session-identity.ts';
import { BethesdaOfflineStorage } from '../storage/indexeddb-storage.ts';
import { BethesdaOfflineManager } from '../offline-manager.ts';
import { OFFLINE_POLICIES, OfflineStorageError } from '../types.ts';
import { tokenManager } from '../../auth/token-manager.ts';
import type { AuthUser } from '../../auth/types.ts';
import { BethesdaApiClient } from '../../api/api-client.ts';
import { RealtimeClient } from '../../realtime/realtime-client.ts';

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

describe('Phase 2D — WS-2D-01: PWA Hardening, Offline Cold-Boot & Security Remediation Suite', () => {
  let mockStorage: MockMemoryStorage;

  beforeEach(() => {
    mockStorage = new MockMemoryStorage();
    tokenManager.clearToken();
    setOfflineReadOnlyMutationGuard(false);
    setSimulatedOnlineStateForTests(null);
    ServiceWorkerLifecycleManager.getInstance().dispose();
  });

  afterEach(() => {
    tokenManager.clearToken();
    setOfflineReadOnlyMutationGuard(false);
    setSimulatedOnlineStateForTests(null);
  });

  // =========================================================================
  // 1. SW.JS CACHE UPGRADE TO V2 AND CACHE OWNERSHIP ISOLATION (FINDING A)
  // =========================================================================
  it('1. should upgrade sw.js cache to bethesda-worship-studio-shell-v2, delete owned v1 cache, and preserve foreign/module caches on same origin (Finding A)', async () => {
    const swPath = path.resolve(process.cwd(), 'public', 'sw.js');
    assert.ok(fs.existsSync(swPath), 'public/sw.js must exist');
    const swContent = fs.readFileSync(swPath, 'utf-8');

    assert.ok(
      swContent.includes("const BETHESDA_CACHE_PREFIX = 'bethesda-worship-studio-shell-';"),
      'sw.js must declare explicit BETHESDA_CACHE_PREFIX'
    );
    assert.ok(
      swContent.includes("const CACHE_NAME = 'bethesda-worship-studio-shell-v2';"),
      'sw.js must declare CACHE_NAME as bethesda-worship-studio-shell-v2'
    );
    assert.ok(
      swContent.includes('function isOwnedObsoleteShellCache'),
      'sw.js must declare isOwnedObsoleteShellCache ownership check'
    );
    assert.ok(
      swContent.includes("'/fonts/Bravura.woff2'"),
      'sw.js must include /fonts/Bravura.woff2 in STATIC_SHELL_ASSETS'
    );

    const bravuraFontPath = path.resolve(process.cwd(), 'public', 'fonts', 'Bravura.woff2');
    assert.ok(fs.existsSync(bravuraFontPath), 'public/fonts/Bravura.woff2 must exist');

    // Ownership predicate checks
    assert.strictEqual(isOwnedObsoleteShellCache(SW_SHELL_CACHE_NAME_V1), true);
    assert.strictEqual(isOwnedObsoleteShellCache('bethesda-worship-studio-shell-v0-alpha'), true);
    assert.strictEqual(isOwnedObsoleteShellCache(SW_SHELL_CACHE_NAME_V2), false);
    assert.strictEqual(isOwnedObsoleteShellCache('other-app-cache-v1'), false);
    assert.strictEqual(isOwnedObsoleteShellCache('workbox-precache-v2'), false);
    assert.strictEqual(isOwnedObsoleteShellCache('bethesda-audio-worklet-cache-v1'), false);

    // Simulate origin CacheStorage with owned legacy caches, current v2 cache, foreign app caches, and another module's cache
    const activeCaches = new Set<string>([
      SW_SHELL_CACHE_NAME_V1,
      'bethesda-worship-studio-shell-v0',
      SW_SHELL_CACHE_NAME_V2,
      'unrelated-church-portal-cache-v1',
      'bethesda-other-module-media-v1',
    ]);

    const firstActivation = await cleanupLegacyServiceWorkerCaches(
      {
        keys: async () => Array.from(activeCaches),
        delete: async (cacheName: string) => activeCaches.delete(cacheName),
      },
      SW_SHELL_CACHE_NAME_V2
    );

    assert.deepStrictEqual(firstActivation.deletedCaches, [
      SW_SHELL_CACHE_NAME_V1,
      'bethesda-worship-studio-shell-v0',
    ]);
    assert.deepStrictEqual(firstActivation.retainedCaches, [
      SW_SHELL_CACHE_NAME_V2,
      'unrelated-church-portal-cache-v1',
      'bethesda-other-module-media-v1',
    ]);
    assert.strictEqual(firstActivation.failedDeletes.length, 0);
    assert.strictEqual(activeCaches.has(SW_SHELL_CACHE_NAME_V1), false, 'Owned v1 cache must be deleted');
    assert.strictEqual(activeCaches.has(SW_SHELL_CACHE_NAME_V2), true, 'Current v2 cache must be retained');
    assert.strictEqual(
      activeCaches.has('unrelated-church-portal-cache-v1'),
      true,
      'Foreign application cache on same origin must be retained'
    );
    assert.strictEqual(
      activeCaches.has('bethesda-other-module-media-v1'),
      true,
      'Other module cache without shell prefix must be retained'
    );

    // Repeated activation must be idempotent
    const secondActivation = await cleanupLegacyServiceWorkerCaches(
      {
        keys: async () => Array.from(activeCaches),
        delete: async (cacheName: string) => activeCaches.delete(cacheName),
      },
      SW_SHELL_CACHE_NAME_V2
    );
    assert.strictEqual(secondActivation.deletedCaches.length, 0, 'Repeated activation must delete 0 caches');
    assert.deepStrictEqual(secondActivation.retainedCaches, [
      SW_SHELL_CACHE_NAME_V2,
      'unrelated-church-portal-cache-v1',
      'bethesda-other-module-media-v1',
    ]);
  });

  // =========================================================================
  // 2. PARTIAL CACHE CLEANUP FAILURE RESILIENCE (FINDING A)
  // =========================================================================
  it('2. should handle partial cache deletion failures safely without deleting foreign caches or crashing activation (Finding A)', async () => {
    const activeCaches = new Set<string>([
      `${BETHESDA_SW_CACHE_PREFIX}locked-v0`,
      SW_SHELL_CACHE_NAME_V1,
      SW_SHELL_CACHE_NAME_V2,
      'foreign-analytics-cache-v3',
    ]);

    const result = await cleanupLegacyServiceWorkerCaches(
      {
        keys: async () => Array.from(activeCaches),
        delete: async (cacheName: string) => {
          if (cacheName === `${BETHESDA_SW_CACHE_PREFIX}locked-v0`) {
            throw new Error('Simulated storage lock error on v0 cache');
          }
          return activeCaches.delete(cacheName);
        },
      },
      SW_SHELL_CACHE_NAME_V2
    );

    assert.deepStrictEqual(result.deletedCaches, [SW_SHELL_CACHE_NAME_V1]);
    assert.deepStrictEqual(result.failedDeletes, [`${BETHESDA_SW_CACHE_PREFIX}locked-v0`]);
    assert.deepStrictEqual(result.retainedCaches, [
      SW_SHELL_CACHE_NAME_V2,
      'foreign-analytics-cache-v3',
    ]);
    assert.strictEqual(activeCaches.has('foreign-analytics-cache-v3'), true);
    assert.strictEqual(activeCaches.has(SW_SHELL_CACHE_NAME_V2), true);
  });

  // =========================================================================
  // 3. PRECACHE_ASSETS ACCEPTS VALID HTTP/HTTPS GET ASSETS & SAFE QUERY PARAMS
  // =========================================================================
  it('3. should accept valid http: and https: GET assets and safe non-sensitive query parameters in PRECACHE_ASSETS', async () => {
    const baseOrigin = 'https://worship.bethesda.org';
    const candidateUrls = [
      '/',
      '/index.html',
      '/assets/index-B9x81a.js?v=2.0.1&hash=b9x81a',
      '/assets/index-C77d1f.css?build=20261112',
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
    assert.ok(result.cached.includes('https://worship.bethesda.org/assets/index-B9x81a.js?v=2.0.1&hash=b9x81a'));
  });

  // =========================================================================
  // 4. PRECACHE_ASSETS HARDENED URL PARAMETER VALIDATION (SECTION 5)
  // =========================================================================
  it('4. should reject /api/ endpoints and percent-encoded, mixed-case, or alternate credential query parameters (Section 5)', async () => {
    const baseOrigin = 'https://worship.bethesda.org';
    const forbiddenUrls = [
      '/api/v1/auth/me',
      '/api/v1/songs',
      'https://worship.bethesda.org/api/v1/users',
      // Plain and mixed-case sensitive parameter names
      'https://worship.bethesda.org/invitation?token=SECRET_INVITE_TOKEN_123',
      'https://worship.bethesda.org/reset?password=PlaintextPassword',
      'https://worship.bethesda.org/asset.js?Authorization=Bearer%20SECRET_JWT',
      'https://worship.bethesda.org/asset.js?AuThOrIzAtIoN=xyz',
      'https://worship.bethesda.org/asset.js?api_key=SECRET_API_KEY_1',
      'https://worship.bethesda.org/asset.js?apikey=SECRET_API_KEY_2',
      'https://worship.bethesda.org/asset.js?API-KEY=SECRET_API_KEY_3',
      'https://worship.bethesda.org/asset.js?secret=MY_SECRET',
      'https://worship.bethesda.org/asset.js?credential=MY_CRED',
      'https://worship.bethesda.org/asset.js?jwt=MY_JWT',
      'https://worship.bethesda.org/asset.js?bearer=MY_BEARER',
      // Percent-encoded parameter names:
      // %61%63%63%65%73%73%5F%74%6F%6B%65%6E === access_token
      'https://worship.bethesda.org/asset.js?%61%63%63%65%73%73%5F%74%6F%6B%65%6E=ENCODED_ACCESS_SECRET',
      // Double-encoded %2561ccess_token
      'https://worship.bethesda.org/asset.js?%2561ccess_token=DOUBLE_ENCODED_ACCESS_SECRET',
      // %72%65%66%72%65%73%68%5F%74%6F%6B%65%6E === refresh_token
      'https://worship.bethesda.org/asset.js?%72%65%66%72%65%73%68%5F%74%6F%6B%65%6E=ENCODED_REFRESH_SECRET',
      // %73%65%73%73%69%6F%6E === session
      'https://worship.bethesda.org/asset.js?%73%65%73%73%69%6F%6E=ENCODED_SESSION_SECRET',
      'https://worship.bethesda.org/asset.js?session_id=SESSION_12345',
    ];

    for (const raw of forbiddenUrls) {
      assert.strictEqual(
        resolveEligiblePrecacheAssetUrl(raw, baseOrigin),
        null,
        `URL ${raw.split('?')[0]} with sensitive param must be rejected`
      );
    }

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

    assert.strictEqual(result.cached.length, 0, 'Zero forbidden URLs may be cached');
    assert.strictEqual(fetchCallCount, 0, 'Forbidden URLs must be rejected before network fetch');
    assert.strictEqual(cacheWriteCount, 0, 'Zero cache writes may occur');
    assert.strictEqual(result.rejected.length, forbiddenUrls.length);

    // Ensure no sensitive query values appear in rejected diagnostic output
    for (const entry of result.rejected) {
      assert.ok(!entry.includes('SECRET'), 'Rejected entries must never expose query parameter values');
      assert.ok(!entry.includes('?'), 'Query strings must be stripped from rejected entries');
    }
  });

  // =========================================================================
  // 5. PRECACHE_ASSETS REJECTS UNSUPPORTED SCHEMES
  // =========================================================================
  it('5. should reject unsupported schemes (chrome-extension:, file:, data:, blob:, about:) in PRECACHE_ASSETS', async () => {
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
  // 6. PRECACHE_ASSETS HANDLES NON-200 OR FAILED RESPONSES SAFELY
  // =========================================================================
  it('6. should handle non-200 responses, opaque responses, network failures, and cache write errors safely without crashing', async () => {
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
  // 7. SERVICE WORKER UPDATE DEFERRAL WHILE ACTIVE SETLIST OR MUSIC STAND MODE IS ACTIVE
  // =========================================================================
  it('7. should defer Service Worker update activation while an ACTIVE setlist or isMusicStandMode is active', () => {
    const manager = new ServiceWorkerLifecycleManager();
    const sentMessages: unknown[] = [];
    const mockWaitingWorker = {
      postMessage: (msg: unknown) => {
        sentMessages.push(msg);
      },
    };

    manager.setStageProtectionState({ isSetlistActive: true, isMusicStandMode: false });
    const snapActiveSetlist = manager.onWaitingWorkerDetected(mockWaitingWorker);

    assert.strictEqual(snapActiveSetlist.isStageProtected, true);
    assert.strictEqual(snapActiveSetlist.hasWaitingWorker, true);
    assert.strictEqual(snapActiveSetlist.isUpdateDeferred, true);
    assert.strictEqual(snapActiveSetlist.isUpdateReadyToApply, false);
    assert.strictEqual(manager.requestSafeUpdateActivation(), false);
    assert.strictEqual(sentMessages.length, 0);

    const snapMusicStand = manager.setStageProtectionState({
      isSetlistActive: false,
      isMusicStandMode: true,
    });

    assert.strictEqual(snapMusicStand.isStageProtected, true);
    assert.strictEqual(snapMusicStand.isUpdateDeferred, true);
    assert.strictEqual(snapMusicStand.isUpdateReadyToApply, false);
    assert.strictEqual(manager.requestSafeUpdateActivation(), false);
    assert.strictEqual(sentMessages.length, 0);
  });

  // =========================================================================
  // 8. SAFE SERVICE WORKER UPDATE WHEN NEITHER ACTIVE SETLIST NOR STAND MODE IS ACTIVE
  // =========================================================================
  it('8. should allow safe Service Worker update handshake when neither ACTIVE setlist nor isMusicStandMode is active, and clean up listeners', () => {
    const manager = new ServiceWorkerLifecycleManager();
    const sentMessages: unknown[] = [];
    const mockWaitingWorker = {
      postMessage: (msg: unknown) => {
        sentMessages.push(msg);
      },
    };

    manager.setStageProtectionState({ isSetlistActive: true, isMusicStandMode: true });
    manager.onWaitingWorkerDetected(mockWaitingWorker);
    assert.strictEqual(manager.getSnapshot().isUpdateReadyToApply, false);

    const snapAfterService = manager.setStageProtectionState({
      isSetlistActive: false,
      isMusicStandMode: false,
    });

    assert.strictEqual(snapAfterService.isStageProtected, false);
    assert.strictEqual(snapAfterService.isUpdateDeferred, false);
    assert.strictEqual(snapAfterService.isUpdateReadyToApply, true);

    const activated = manager.requestSafeUpdateActivation();
    assert.strictEqual(activated, true);
    assert.strictEqual(sentMessages.length, 1);
    assert.deepStrictEqual(sentMessages[0], { type: 'SKIP_WAITING' });

    assert.strictEqual(manager.requestSafeUpdateActivation(), false);
    assert.strictEqual(sentMessages.length, 1);

    const snapCompleted = manager.markUpdateApplied();
    assert.strictEqual(snapCompleted.hasWaitingWorker, false);
    assert.strictEqual(snapCompleted.isUpdateReadyToApply, false);
    assert.strictEqual(snapCompleted.isApplyingUpdate, false);

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
  // 9. OFFLINE SESSION IDENTITY CREATION AFTER VALID SERVER AUTHENTICATION
  // =========================================================================
  it('9. should persist OfflineSessionIdentity with only non-sensitive metadata after valid server authentication', () => {
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
  // 10. REJECTION OF CREDENTIALS OR TOKENS IN OFFLINE SESSION IDENTITY
  // =========================================================================
  it('10. should strictly reject any attempt to store or restore tokens, passwords, cookies, or secrets in OfflineSessionIdentity', () => {
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
      assert.strictEqual(check.valid, false);

      mockStorage.setItem(OFFLINE_SESSION_IDENTITY_KEY, JSON.stringify(payload));
      const loaded = loadValidOfflineSessionIdentity({ storage: mockStorage });
      assert.strictEqual(loaded, null);
      assert.strictEqual(mockStorage.getItem(OFFLINE_SESSION_IDENTITY_KEY), null);
    }
  });

  // =========================================================================
  // 11. SUCCESSFUL OFFLINE COLD BOOT / F5 RESTORATION WITHIN 7-DAY GRACE PERIOD
  // =========================================================================
  it('11. should restore offline cold boot / F5 reload within 7-day grace period in strict read-only mode without extending lastAuthenticatedAt', async () => {
    const initialAuthMs = Date.parse('2026-11-10T10:00:00.000Z');
    const initialAuthIso = new Date(initialAuthMs).toISOString();
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
      isOnlineFn: () => false,
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
    assert.strictEqual(isOfflineReadOnlyMutationGuardActive(), true);
    assert.strictEqual(state.canManageUsers, false);
    assert.strictEqual(tokenManager.getToken(), null);
    assert.strictEqual(state.user?.id, 'user-admin-01');
    assert.strictEqual(state.offlineIdentity?.lastAuthenticatedAt, initialAuthIso);

    assert.throws(
      () => controller.assertOnlineServerMutationAllowed(),
      (err: unknown) => err instanceof OfflineStorageError && err.code === 'UNAUTHORIZED_SESSION'
    );
  });

  // =========================================================================
  // 12. ATOMIC OFFLINE TRANSITION & IMMEDIATE TOKEN INVALIDATION (FINDING B)
  // =========================================================================
  it('12. should atomically clear in-memory access token, cancel silent refresh, activate read-only guard first, and block stale in-flight refresh on offline transition (Finding B)', async () => {
    const authMs = Date.parse('2026-11-12T08:00:00.000Z');
    const authIso = new Date(authMs).toISOString();
    const offlineEventMs = authMs + 2 * 60 * 60 * 1000; // 2 hours later

    const leaderUser: AuthUser = {
      id: 'user-leader-atomic',
      email: 'lider@bethesda.org',
      firstName: 'Mateo',
      lastName: 'Silva',
      role: 'ADMIN',
      accountStatus: 'ACTIVE',
    };

    let online = true;
    const callOrder: string[] = [];
    const pendingRefreshResolvers: Array<(val: { accessToken: string; expiresIn: number; user: AuthUser }) => void> = [];

    const controller = new OfflineAuthLifecycleController({
      isOnlineFn: () => online,
      refreshSessionFn: () =>
        new Promise((resolve) => {
          pendingRefreshResolvers.push(resolve);
        }),
      serverLogoutFn: async () => {},
      purgeUserSessionDataFn: async () => ({ success: true, purgedCount: 0 }),
      setOfflineReadOnlyGuardFn: (active) => {
        if (active) {
          callOrder.push(`guard_activated:token_present=${tokenManager.getToken() !== null}`);
        }
      },
      storage: mockStorage,
      nowFn: () => authMs,
    });

    // 1. Authenticate online: token is in memory and silent refresh is scheduled
    await controller.activateServerAuthenticatedSession(leaderUser, 'online-access-jwt-token', {
      nowMs: authMs,
      expiresInSeconds: 900,
    });
    tokenManager.scheduleSilentRefresh(async () => {});

    assert.strictEqual(tokenManager.getToken(), 'online-access-jwt-token');
    assert.strictEqual(controller.getState().isOfflineSession, false);
    assert.strictEqual(controller.getState().canManageUsers, true);

    // 2. Start an asynchronous refresh right before connection drops
    const staleRefreshPromise = controller.reconcileOnReconnect({ nowMs: offlineEventMs });
    callOrder.length = 0;

    // 3. Browser transitions to offline
    online = false;
    const offlineState = controller.transitionToOfflineMode({ nowMs: offlineEventMs });

    // Verify read-only guard was activated first and in-memory token was immediately cleared
    assert.ok(callOrder.length > 0 && callOrder[0]?.startsWith('guard_activated:'));
    assert.strictEqual(tokenManager.getToken(), null, 'In-memory access token MUST be cleared immediately on offline');
    assert.strictEqual(isOfflineReadOnlyMutationGuardActive(), true, 'Server mutation guard MUST be active');
    assert.strictEqual(offlineState.isOfflineSession, true);
    assert.strictEqual(offlineState.isReadOnlyOffline, true);
    assert.strictEqual(offlineState.canManageUsers, false);
    assert.strictEqual(
      offlineState.offlineIdentity?.lastAuthenticatedAt,
      authIso,
      '7-day grace period timestamp must NEVER be extended on offline transition'
    );
    assert.strictEqual(
      offlineState.lastLogoutResult,
      null,
      'Must never claim server-side logout occurred merely because browser went offline'
    );

    // 4. Stale in-flight refresh resolves AFTER offline transition -> must be ignored and must NOT restore token
    for (const resolveFn of pendingRefreshResolvers) {
      resolveFn({
        accessToken: 'stale-late-jwt-token',
        expiresIn: 900,
        user: leaderUser,
      });
    }
    await staleRefreshPromise;

    assert.strictEqual(tokenManager.getToken(), null, 'Stale refresh must NOT re-populate tokenManager');
    assert.strictEqual(controller.getState().isOfflineSession, true);
    assert.strictEqual(controller.getState().isReadOnlyOffline, true);
    assert.strictEqual(controller.getState().canManageUsers, false);
  });

  // =========================================================================
  // 13. REJECTION OF EXPIRED OFFLINE SESSION IDENTITY BEYOND 7 DAYS
  // =========================================================================
  it('13. should reject expired OfflineSessionIdentity beyond 7 days and reject future timestamps beyond clock-skew tolerance', async () => {
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

    const expiredNowMs = authTimeMs + OFFLINE_IDENTITY_GRACE_PERIOD_MS;
    const loadedExpired = loadValidOfflineSessionIdentity({
      nowMs: expiredNowMs,
      storage: mockStorage,
    });
    assert.strictEqual(loadedExpired, null);
    assert.strictEqual(mockStorage.getItem(OFFLINE_SESSION_IDENTITY_KEY), null);

    saveOfflineSessionIdentity(musician, {
      nowIso: authTimeIso,
      storage: mockStorage,
    });
    const tamperedPastClockMs = authTimeMs - (OFFLINE_CLOCK_SKEW_TOLERANCE_MS + 10_000);
    const loadedSkewed = loadValidOfflineSessionIdentity({
      nowMs: tamperedPastClockMs,
      storage: mockStorage,
    });
    assert.strictEqual(loadedSkewed, null);
  });

  // =========================================================================
  // 14. REJECTION OF CORRUPTED OR MALFORMED OFFLINE SESSION IDENTITY
  // =========================================================================
  it('14. should fail closed on corrupted JSON, malformed fields, invalid roles, or pending cleanup tombstone', () => {
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
      assert.strictEqual(res, null);
      assert.strictEqual(mockStorage.getItem(OFFLINE_SESSION_IDENTITY_KEY), null);
    }

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
    assert.strictEqual(blockedByTombstone, null);
  });

  // =========================================================================
  // 15. SHARED-DEVICE ISOLATION: USER B NEVER INHERITS USER A'S IDENTITY OR DATA
  // =========================================================================
  it('15. should isolate shared devices: logging in as User B purges User A offline data and replaces OfflineSessionIdentity', async () => {
    const idbStorage = new BethesdaOfflineStorage();
    await idbStorage.init();
    await idbStorage.purgeAll();
    const manager = new BethesdaOfflineManager(idbStorage);

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

    await controller.activateServerAuthenticatedSession(userAlice, 'alice-jwt-token');
    assert.strictEqual(controller.getState().user?.id, 'user-alice');

    await controller.activateServerAuthenticatedSession(userBob, 'bob-jwt-token');

    assert.deepStrictEqual(purgedUsers, ['user-alice']);
    assert.strictEqual(await idbStorage.getSongPayload('song-private-user-a'), null);
    assert.strictEqual(controller.getState().user?.id, 'user-bob');
    assert.strictEqual(controller.getState().offlineIdentity?.userId, 'user-bob');
  });

  // =========================================================================
  // 16. OFFLINE LOGOUT CLEARS IDENTITY, PURGES DATA, AND PREVENTS STALE RESTORATION
  // =========================================================================
  it('16. should execute offline logout locally, purge private data, distinguish localCleared from serverRevoked, and block stale in-flight refresh', async () => {
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

    const bootState = await controller.initializeSession();
    assert.strictEqual(bootState.isOfflineSession, true);
    assert.strictEqual(bootState.user?.id, userAlice.id);

    isNetworkOnline = true;
    const inFlightReconnect = controller.reconcileOnReconnect();
    isNetworkOnline = false;

    const logoutResult = await controller.logout();

    for (const resolveFn of refreshResolvers) {
      resolveFn({ accessToken: 'stale-token', user: userAlice });
    }
    await inFlightReconnect;

    assert.strictEqual(logoutResult.localCleared, true);
    assert.strictEqual(logoutResult.serverRevoked, false);
    assert.strictEqual(logoutResult.purgedOfflineItemsCount, 1);

    const finalState = controller.getState();
    assert.strictEqual(finalState.authStatus, 'UNAUTHENTICATED');
    assert.strictEqual(finalState.user, null);
    assert.strictEqual(finalState.offlineIdentity, null);
    assert.strictEqual(mockStorage.getItem(OFFLINE_SESSION_IDENTITY_KEY), null);
    assert.strictEqual(await idbStorage.getMetadata('setlist-alice-01'), null);
  });

  // =========================================================================
  // 17. ONLINE RECONNECTION KEEPS READ-ONLY WHILE PENDING & REVOKES ON 401/403
  // =========================================================================
  it('17. should keep read-only mode while server validation is pending on reconnect, promote only after server confirmation, and purge on 401/403 (Finding B & Safeguard C)', async () => {
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
    let guardDuringPendingRefresh = false;

    const controller = new OfflineAuthLifecycleController({
      isOnlineFn: () => onlineState,
      refreshSessionFn: async () => {
        // Inspect mutation guard while server validation is in flight
        guardDuringPendingRefresh = isOfflineReadOnlyMutationGuardActive() && tokenManager.getToken() === null;
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
          expiresIn: 900,
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

    // Step 2: Reconnect attempt with transient network failure -> stays read-only
    onlineState = true;
    refreshMode = 'TRANSIENT_NETWORK_ERROR';
    const step2 = await controller.reconcileOnReconnect();
    assert.strictEqual(guardDuringPendingRefresh, true, 'Session must remain read-only while server validation is pending');
    assert.strictEqual(step2.isOfflineSession, true);
    assert.strictEqual(step2.isReadOnlyOffline, true);
    assert.strictEqual(isOfflineReadOnlyMutationGuardActive(), true);
    assert.strictEqual(tokenManager.getToken(), null);

    // Step 3: Reconnect succeeds -> promotes to online authenticated mode
    guardDuringPendingRefresh = false;
    refreshMode = 'SUCCESS';
    const reconnectTimeMs = Date.parse('2026-11-12T12:30:00.000Z');
    const step3 = await controller.reconcileOnReconnect({ nowMs: reconnectTimeMs });
    assert.strictEqual(guardDuringPendingRefresh, true, 'Must stay read-only until server response arrives');
    assert.strictEqual(step3.authStatus, 'AUTHENTICATED');
    assert.strictEqual(step3.isOfflineSession, false);
    assert.strictEqual(step3.isReadOnlyOffline, false);
    assert.strictEqual(isOfflineReadOnlyMutationGuardActive(), false);
    assert.strictEqual(step3.canManageUsers, true);
    assert.strictEqual(tokenManager.getToken(), 'fresh-server-jwt-token');

    // Step 4: Server returns 401 -> immediately invalidates identity and purges private data
    refreshMode = 'REVOKED_401';
    const step4 = await controller.reconcileOnReconnect();
    assert.strictEqual(step4.authStatus, 'UNAUTHENTICATED');
    assert.strictEqual(step4.user, null);
    assert.strictEqual(tokenManager.getToken(), null);
    assert.strictEqual(mockStorage.getItem(OFFLINE_SESSION_IDENTITY_KEY), null);
    assert.strictEqual(await idbStorage.getMetadata('song-elena-01'), null);
  });

  // =========================================================================
  // 18. CENTRALIZED API MUTATION GATE BLOCKS ALL POST/PUT/PATCH/DELETE (FINDING C)
  // =========================================================================
  it('18. should block all POST, PUT, PATCH, and DELETE calls at the centralized BethesdaApiClient & RealtimeClient gate while offline or in read-only session, without queuing (Finding C)', async () => {
    const originalFetch = globalThis.fetch;
    let networkCallsCount = 0;

    globalThis.fetch = (async () => {
      networkCallsCount++;
      return new Response(JSON.stringify({ success: true, data: {} }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;

    try {
      const apiClient = new BethesdaApiClient({ baseUrl: 'http://localhost:3001/api/v1' });
      const realtimeClient = new RealtimeClient('http://localhost:3001');

      // Activate offline read-only mutation guard (simulating offline session or disconnected client)
      setSimulatedOnlineStateForTests(false);
      setOfflineReadOnlyMutationGuard(true);

      const blockedOperations: Array<() => Promise<unknown>> = [
        // Direct fetchWithAuth POST/PUT/PATCH/DELETE calls
        () => apiClient.fetchWithAuth('/songs', { method: 'POST', body: '{}' }),
        () => apiClient.fetchWithAuth('/setlists/1', { method: 'PUT', body: '{}' }),
        () => apiClient.fetchWithAuth('/users/1/role', { method: 'PATCH', body: '{}' }),
        () => apiClient.fetchWithAuth('/setlists/1', { method: 'DELETE' }),
        // Song & canonical music mutations
        () =>
          apiClient.createSong({
            title: 'Test Song',
            defaultKey: 'C',
            defaultBpm: 120,
            timeSignature: '4/4',
            sourceFormat: 'CHORD_PRO',
            canonicalPayload: {} as any,
          }),
        () => apiClient.importAndPersist('{title: Test}', 'test.cho'),
        // Setlist creation, editing, item authoring, reordering, duplication, status activation, deletion
        () => apiClient.createSetlist({ title: 'Culto Dominical' }),
        () => apiClient.updateSetlist('setlist-1', { title: 'Updated' }),
        () => apiClient.deleteSetlist('setlist-1'),
        () => apiClient.updateSetlistStatus('setlist-1', 'ACTIVE'),
        () => apiClient.addSetlistItem('setlist-1', { itemType: 'SONG', songId: 'song-1' }),
        () => apiClient.updateSetlistItem('setlist-1', 'item-1', { notesForTeam: 'Capo 2' }),
        () => apiClient.deleteSetlistItem('setlist-1', 'item-1'),
        () => apiClient.reorderSetlist('setlist-1', ['item-2', 'item-1']),
        () => apiClient.duplicateSetlist('setlist-1', { newTitle: 'Copy' }),
        // Worship service mutations
        () =>
          apiClient.createWorshipService({
            name: 'Servicio Especial',
            serviceType: 'SUNDAY_SERVICE',
            scheduledAt: '2026-11-15T10:00:00.000Z',
          }),
        () => apiClient.updateWorshipService('ws-1', { name: 'Updated WS' }),
        () => apiClient.deleteWorshipService('ws-1'),
        // User preferences mutation
        () =>
          apiClient.updateUserPreferences({
            instrumentId: 'guitar',
            primaryRepresentation: 'CHORDS',
            secondaryRepresentations: [],
            chordNotationSystem: 'STANDARD',
            transpositionSemitones: 0,
            capoFret: 0,
            clefOverride: null,
            preferFlats: false,
          }),
        // Administrative & user management mutations
        () =>
          apiClient.inviteUser({
            email: 'nuevo@bethesda.org',
            firstName: 'Nuevo',
            lastName: 'Integrante',
            role: 'MUSICIAN',
          }),
        () => apiClient.resendInvitation('user-1'),
        () => apiClient.changeUserRole('user-1', 'WORSHIP_LEADER'),
        () => apiClient.disableUser('user-1'),
        () => apiClient.enableUser('user-1'),
        () => apiClient.changeInitialPassword('OldPass1!', 'NewPass2!'),
        // Realtime mutations
        () => realtimeClient.createOrGetSession('setlist-1', 'token'),
        () =>
          realtimeClient.dispatchAction('session-1', 'token', {
            type: 'SET_ITEM_INDEX',
            itemIndex: 1,
          } as any),
      ];

      for (const op of blockedOperations) {
        await assert.rejects(
          async () => {
            await op();
          },
          (err: unknown) => err instanceof OfflineStorageError && err.code === 'UNAUTHORIZED_SESSION'
        );
      }

      assert.strictEqual(
        networkCallsCount,
        0,
        'Zero network requests may be sent for blocked mutations, and zero mutations are queued'
      );

      // Verify GET requests remain available through fetchWithAuth according to current policy
      const getResponse = await apiClient.fetchWithAuth('/songs', { method: 'GET' });
      assert.strictEqual(getResponse.status, 200);
      assert.strictEqual(networkCallsCount, 1, 'GET requests must remain allowed through the gate');

      // Verify that when online and read-only guard is released, online mutations proceed normally without any queued replay
      setSimulatedOnlineStateForTests(true);
      setOfflineReadOnlyMutationGuard(false);
      assert.strictEqual(networkCallsCount, 1, 'No queued mutations may replay when transitioning back online');

      const onlinePostRes = await apiClient.fetchWithAuth('/setlists', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'Online Setlist' }),
      });
      assert.strictEqual(onlinePostRes.status, 200);
      assert.strictEqual(networkCallsCount, 2, 'Explicit online mutation succeeds normally');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
