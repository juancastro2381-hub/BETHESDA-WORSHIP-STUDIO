/**
 * @file user-preferences-api-client.test.ts
 * @description Pruebas unitarias para los métodos de preferencias de usuario en BethesdaApiClient (Fase 3A — WP-02/WP-03).
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { BethesdaApiClient } from '../api-client.ts';
import { tokenManager } from '../../auth/token-manager.ts';
import type { UserViewPreferenceData, UpdateUserViewPreferencePayload } from '../preference-types.ts';

describe('BethesdaApiClient — User View Preferences API Suite (Fase 3A)', () => {
  let client: BethesdaApiClient;

  beforeEach(() => {
    client = new BethesdaApiClient({ baseUrl: 'http://localhost:3001/api/v1' });
    tokenManager.clearToken();
  });

  it('1. should fetch user preferences via GET /users/me/preferences with Bearer token', async () => {
    tokenManager.setToken('fake-jwt-token-musician', 900);

    const mockPrefData: UserViewPreferenceData = {
      userId: 'usr-123',
      instrumentId: 'acoustic_guitar',
      primaryRepresentation: 'STANDARD_NOTATION',
      secondaryRepresentations: ['CHORDS'],
      chordNotationSystem: 'STANDARD',
      transpositionSemitones: 0,
      capoFret: 2,
      clefOverride: null,
      preferFlats: false,
      isDefault: false,
    };

    // Interceptar fetch global
    const originalFetch = globalThis.fetch;
    let interceptedUrl = '';
    let interceptedMethod = '';
    let interceptedAuth = '';

    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      interceptedUrl = String(input);
      interceptedMethod = init?.method ?? 'GET';
      interceptedAuth = new Headers(init?.headers).get('Authorization') ?? '';

      return new Response(
        JSON.stringify({
          success: true,
          data: mockPrefData,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    };

    try {
      const result = await client.getUserPreferences();
      assert.equal(interceptedUrl, 'http://localhost:3001/api/v1/users/me/preferences');
      assert.equal(interceptedMethod, 'GET');
      assert.equal(interceptedAuth, 'Bearer fake-jwt-token-musician');
      assert.equal(result.instrumentId, 'acoustic_guitar');
      assert.equal(result.primaryRepresentation, 'STANDARD_NOTATION');
      assert.equal(result.capoFret, 2);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('2. should persist updated preferences via PUT /users/me/preferences with JSON payload', async () => {
    tokenManager.setToken('fake-jwt-token-musician', 900);

    const payload: UpdateUserViewPreferencePayload = {
      instrumentId: 'electric_guitar',
      primaryRepresentation: 'TABLATURE',
      secondaryRepresentations: ['CHORDS'],
      chordNotationSystem: 'LATIN',
      transpositionSemitones: -2,
      capoFret: 0,
      clefOverride: null,
      preferFlats: false,
    };

    const originalFetch = globalThis.fetch;
    let interceptedUrl = '';
    let interceptedMethod = '';
    let interceptedBody = '';

    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      interceptedUrl = String(input);
      interceptedMethod = init?.method ?? 'GET';
      interceptedBody = String(init?.body ?? '');

      return new Response(
        JSON.stringify({
          success: true,
          data: {
            id: 'pref-999',
            userId: 'usr-123',
            ...payload,
            isDefault: false,
            createdAt: '2026-10-16T12:00:00.000Z',
            updatedAt: '2026-10-16T12:00:00.000Z',
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    };

    try {
      const result = await client.updateUserPreferences(payload);
      assert.equal(interceptedUrl, 'http://localhost:3001/api/v1/users/me/preferences');
      assert.equal(interceptedMethod, 'PUT');
      const parsedBody = JSON.parse(interceptedBody);
      assert.equal(parsedBody.instrumentId, 'electric_guitar');
      assert.equal(parsedBody.primaryRepresentation, 'TABLATURE');
      assert.equal(parsedBody.chordNotationSystem, 'LATIN');
      assert.equal(result.primaryRepresentation, 'TABLATURE');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('3. should map 401 Unauthorized response to ApiError', async () => {
    tokenManager.clearToken();

    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (): Promise<Response> => {
      return new Response(
        JSON.stringify({
          error: {
            statusCode: 401,
            code: 'UNAUTHORIZED',
            message: 'Token de acceso no proporcionado.',
          },
        }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      );
    };

    try {
      await assert.rejects(
        async () => {
          await client.getUserPreferences();
        },
        (err: any) => {
          assert.equal(err.statusCode, 401);
          assert.match(err.message, /Token de acceso/);
          return true;
        }
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
