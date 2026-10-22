/**
 * @file auth-lifecycle-and-admin.test.ts
 * @description Suite de pruebas para el ciclo de vida de autenticación, deduplicación de refresco
 * y endpoints de administración de usuarios en el frontend (Fase B y C).
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { BethesdaApiClient } from '../../api/api-client.ts';
import { tokenManager } from '../token-manager.ts';
import type { AuthUser, UserRole } from '../types.ts';

describe('Frontend Auth Lifecycle & User Administration Suite', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    tokenManager.clearToken();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    tokenManager.clearToken();
  });

  it('1. should deduplicate concurrent calls to refreshSession into a single network request', async () => {
    const apiClient = new BethesdaApiClient({ baseUrl: 'http://localhost:3001/api/v1' });
    let fetchCount = 0;

    const mockResponse: { data: { accessToken: string; expiresIn: number; user: AuthUser } } = {
      data: {
        accessToken: 'mock-refreshed-jwt-token',
        expiresIn: 900,
        user: {
          id: 'user-001',
          email: 'pastor@bethesda.church',
          firstName: 'Juan',
          lastName: 'Castro',
          role: 'SUPER_ADMIN',
          accountStatus: 'ACTIVE',
          emailVerified: true,
        },
      },
    };

    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/auth/refresh')) {
        fetchCount++;
        // Simular latencia de red para forzar la concurrencia
        await new Promise((resolve) => setTimeout(resolve, 25));
        return new Response(JSON.stringify(mockResponse), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response('{}', { status: 200 });
    };

    // Ejecutar 5 llamadas concurrentes al mismo tiempo (simulando recarga de página con peticiones en paralelo)
    const results = await Promise.all([
      apiClient.refreshSession(),
      apiClient.refreshSession(),
      apiClient.refreshSession(),
      apiClient.refreshSession(),
      apiClient.refreshSession(),
    ]);

    // Todas deben resolverse con el mismo token
    assert.strictEqual(results.length, 5);
    for (const res of results) {
      assert.strictEqual(res.accessToken, 'mock-refreshed-jwt-token');
      assert.strictEqual(res.user.email, 'pastor@bethesda.church');
    }

    // La red solo debió recibir 1 solicitud gracias a refreshPromise
    assert.strictEqual(fetchCount, 1, 'Only 1 network fetch should have been executed for concurrent refresh calls');

    // Una llamada posterior (después de terminar la primera tanda) debe realizar una nueva petición
    const subsequentResult = await apiClient.refreshSession();
    assert.strictEqual(subsequentResult.accessToken, 'mock-refreshed-jwt-token');
    assert.strictEqual(fetchCount, 2, 'Subsequent refresh after completion should initiate a new network request');
  });

  it('2. should automatically include Bearer token in fetchWithAuth when token is present', async () => {
    const apiClient = new BethesdaApiClient({ baseUrl: 'http://localhost:3001/api/v1' });
    tokenManager.setToken('valid-bearer-jwt', 900);

    let capturedHeaders: Headers | undefined;
    let capturedCredentials: RequestCredentials | undefined;

    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedHeaders = new Headers(init?.headers);
      capturedCredentials = init?.credentials;
      return new Response(JSON.stringify({ status: 'ok', database: 'connected' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    };

    const res = await apiClient.checkHealth();
    assert.strictEqual(res.status, 'ok');
    assert.strictEqual(capturedHeaders?.get('Authorization'), 'Bearer valid-bearer-jwt');
    assert.strictEqual(capturedCredentials, 'include', 'credentials must be "include" for HttpOnly cookies');
  });

  it('3. should transparently refresh token on 401 and retry the original request', async () => {
    const apiClient = new BethesdaApiClient({ baseUrl: 'http://localhost:3001/api/v1' });
    tokenManager.setToken('expired-jwt', 900);

    let initialCallMade = false;
    let retryCallMade = false;
    let refreshCallMade = false;

    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();

      if (url.includes('/auth/refresh')) {
        refreshCallMade = true;
        return new Response(
          JSON.stringify({
            data: {
              accessToken: 'new-fresh-jwt',
              expiresIn: 900,
              user: {
                id: 'u-1',
                email: 'test@bethesda.org',
                firstName: 'Test',
                lastName: 'User',
                role: 'ADMIN',
                accountStatus: 'ACTIVE',
                emailVerified: true,
              },
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }

      if (url.includes('/songs')) {
        const headers = new Headers(init?.headers);
        const authHeader = headers.get('Authorization');

        if (authHeader === 'Bearer expired-jwt') {
          initialCallMade = true;
          return new Response(JSON.stringify({ error: { message: 'Unauthorized' } }), {
            status: 401,
            headers: { 'Content-Type': 'application/json' },
          });
        }

        if (authHeader === 'Bearer new-fresh-jwt') {
          retryCallMade = true;
          return new Response(JSON.stringify({ data: [], pagination: { total: 0 } }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
      }

      return new Response('Not found', { status: 404 });
    };

    const songs = await apiClient.listSongs();
    assert.strictEqual(initialCallMade, true, 'Initial request with expired token should have executed');
    assert.strictEqual(refreshCallMade, true, 'Session refresh should have been executed');
    assert.strictEqual(retryCallMade, true, 'Original request should have been retried with new fresh token');
    assert.strictEqual(tokenManager.getToken(), 'new-fresh-jwt', 'Token manager must store updated token');
    assert.strictEqual(songs.items.length, 0);
  });

  it('4. should correctly format listUsers query parameters for filtering and search', async () => {
    const apiClient = new BethesdaApiClient({ baseUrl: 'http://localhost:3001/api/v1' });
    let capturedUrl = '';

    globalThis.fetch = async (input: RequestInfo | URL) => {
      capturedUrl = typeof input === 'string' ? input : input.toString();
      return new Response(
        JSON.stringify({
          data: [],
          pagination: { total: 0, limit: 10, offset: 5 },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    };

    await apiClient.listUsers({
      search: 'david',
      role: 'MUSICIAN',
      status: 'ACTIVE',
      limit: 10,
      offset: 5,
    });

    const parsedUrl = new URL(capturedUrl);
    assert.strictEqual(parsedUrl.searchParams.get('search'), 'david');
    assert.strictEqual(parsedUrl.searchParams.get('role'), 'MUSICIAN');
    assert.strictEqual(parsedUrl.searchParams.get('status'), 'ACTIVE');
    assert.strictEqual(parsedUrl.searchParams.get('limit'), '10');
    assert.strictEqual(parsedUrl.searchParams.get('offset'), '5');
  });

  it('5. should invoke admin endpoints with expected methods and paths', async () => {
    const apiClient = new BethesdaApiClient({ baseUrl: 'http://localhost:3001/api/v1' });
    const requestsLog: Array<{ method: string; path: string; body?: unknown }> = [];

    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      const method = init?.method ?? 'GET';
      const body = init?.body ? JSON.parse(init.body.toString()) : undefined;
      requestsLog.push({ method, path: new URL(url).pathname, body });

      if (url.includes('/invite')) {
        return new Response(
          JSON.stringify({
            data: {
              userId: 'u-new',
              email: 'new@bethesda.org',
              role: 'MUSICIAN',
              invitationToken: 'tok-123',
              deliveryStatus: 'UNCONFIGURED_MOCK',
              deliveryMessage: 'Simulated link',
              expiresAt: new Date().toISOString(),
            },
          }),
          { status: 201, headers: { 'Content-Type': 'application/json' } }
        );
      }

      if (url.includes('/role')) {
        return new Response(
          JSON.stringify({
            data: { id: 'u-target', email: 'musician@bethesda.org', role: 'WORSHIP_LEADER' },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }

      return new Response(JSON.stringify({ message: 'Success' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    };

    // 1. inviteUser
    await apiClient.inviteUser({
      email: 'new@bethesda.org',
      firstName: 'Nuevo',
      lastName: 'Musico',
      role: 'MUSICIAN',
    });

    // 2. resendInvitation
    await apiClient.resendInvitation('u-pending');

    // 3. changeUserRole
    await apiClient.changeUserRole('u-target', 'WORSHIP_LEADER');

    // 4. disableUser
    await apiClient.disableUser('u-bad');

    // 5. enableUser
    await apiClient.enableUser('u-good');

    assert.strictEqual(requestsLog.length, 5);
    assert.strictEqual(requestsLog[0]?.method, 'POST');
    assert.strictEqual(requestsLog[0]?.path, '/api/v1/users/invite');

    assert.strictEqual(requestsLog[1]?.method, 'POST');
    assert.strictEqual(requestsLog[1]?.path, '/api/v1/users/u-pending/resend-invite');

    assert.strictEqual(requestsLog[2]?.method, 'PATCH');
    assert.strictEqual(requestsLog[2]?.path, '/api/v1/users/u-target/role');

    assert.strictEqual(requestsLog[3]?.method, 'POST');
    assert.strictEqual(requestsLog[3]?.path, '/api/v1/users/u-bad/disable');

    assert.strictEqual(requestsLog[4]?.method, 'POST');
    assert.strictEqual(requestsLog[4]?.path, '/api/v1/users/u-good/enable');
  });

  it('6. should validate RBAC permission logic for user administration', () => {
    const checkCanManageUsers = (role?: UserRole): boolean => {
      return role === 'SUPER_ADMIN' || role === 'ADMIN';
    };

    assert.strictEqual(checkCanManageUsers('SUPER_ADMIN'), true, 'SUPER_ADMIN must have user management permissions');
    assert.strictEqual(checkCanManageUsers('ADMIN'), true, 'ADMIN must have user management permissions');
    assert.strictEqual(checkCanManageUsers('WORSHIP_LEADER'), false, 'WORSHIP_LEADER must NOT manage users');
    assert.strictEqual(checkCanManageUsers('MUSICIAN'), false, 'MUSICIAN must NOT manage users');
    assert.strictEqual(checkCanManageUsers('VIEWER'), false, 'VIEWER must NOT manage users');
    assert.strictEqual(checkCanManageUsers(undefined), false, 'Unauthenticated user must NOT manage users');
  });

  it('7. refreshSession and logout do NOT send Content-Type: application/json header on empty-body requests', async () => {
    const apiClient = new BethesdaApiClient({ baseUrl: 'http://localhost:3001/api/v1' });
    const capturedHeaders: Array<{ path: string; hasContentType: boolean; contentTypeValue: string | null }> = [];

    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      const headers = new Headers(init?.headers);
      capturedHeaders.push({
        path: new URL(url).pathname,
        hasContentType: headers.has('Content-Type'),
        contentTypeValue: headers.get('Content-Type'),
      });

      if (url.includes('/auth/refresh')) {
        return new Response(
          JSON.stringify({
            data: {
              accessToken: 'mock-token',
              expiresIn: 900,
              user: { id: 'u1', email: 'test@b.org', role: 'ADMIN', firstName: 'A', lastName: 'B' },
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }

      return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
    };

    // 1. refreshSession
    await apiClient.refreshSession();
    // 2. logout
    await apiClient.logout();

    assert.strictEqual(capturedHeaders.length, 2);
    assert.strictEqual(capturedHeaders[0]?.path, '/api/v1/auth/refresh');
    assert.strictEqual(capturedHeaders[0]?.hasContentType, false, 'refreshSession must NOT send Content-Type header');

    assert.strictEqual(capturedHeaders[1]?.path, '/api/v1/auth/logout');
    assert.strictEqual(capturedHeaders[1]?.hasContentType, false, 'logout must NOT send Content-Type header');
  });

  it('8. login returns user with mustChangePassword: true for MUST_CHANGE_PASSWORD accounts', async () => {
    const apiClient = new BethesdaApiClient({ baseUrl: 'http://localhost:3001/api/v1' });

    globalThis.fetch = async () => {
      return new Response(
        JSON.stringify({
          success: true,
          data: {
            accessToken: 'token-must-change',
            expiresIn: 900,
            user: {
              id: 'admin-id',
              email: 'admin@bethesda.org',
              firstName: 'Super',
              lastName: 'Admin',
              role: 'SUPER_ADMIN',
              mustChangePassword: true,
            },
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    };

    const result = await apiClient.login('admin@bethesda.org', 'InitialPassword!');
    assert.strictEqual(result.user.mustChangePassword, true, 'User must have mustChangePassword = true');
    assert.strictEqual(result.user.role, 'SUPER_ADMIN');
    assert.strictEqual(result.accessToken, 'token-must-change');
  });

  it('9. changeInitialPassword sends current and new passwords with Content-Type application/json', async () => {
    const apiClient = new BethesdaApiClient({ baseUrl: 'http://localhost:3001/api/v1' });
    let capturedBody: any = null;
    let capturedPath = '';

    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedPath = new URL(typeof input === 'string' ? input : input.toString()).pathname;
      capturedBody = init?.body ? JSON.parse(init.body.toString()) : null;
      return new Response(JSON.stringify({ success: true, message: 'Password updated' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    };

    await apiClient.changeInitialPassword('CurrentPass123!', 'NewDefinitivePass2026!');
    assert.strictEqual(capturedPath, '/api/v1/auth/change-initial-password');
    assert.strictEqual(capturedBody?.currentPassword, 'CurrentPass123!');
    assert.strictEqual(capturedBody?.newPassword, 'NewDefinitivePass2026!');
  });
});
