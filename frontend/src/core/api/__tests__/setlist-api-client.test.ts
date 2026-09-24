/**
 * @file setlist-api-client.test.ts
 * @description Suite de pruebas exhaustiva para los métodos de Setlists de BethesdaApiClient (Fase 2C — WS6).
 *
 * Cobertura requerida:
 * 1. 10 Endpoints HTTP canónicos (listSetlists, createSetlist, getSetlist, updateSetlist, deleteSetlist,
 *    updateSetlistStatus, addSetlistItem [SONG y SERVICE_MOMENT], updateSetlistItem, deleteSetlistItem, reorderSetlist).
 * 2. Serialización y deserialización fiel de DTOs y uniones discriminadas.
 * 3. Lanzamiento y tipado de ApiError estructurado (400, 401, 403, 404, 409, 500).
 * 4. Integración de fetchWithAuth() con renovación silenciosa ante 401 y reintento exitoso.
 */

import assert from 'node:assert';
import { describe, it, beforeEach, afterEach } from 'node:test';
import { BethesdaApiClient } from '../api-client.ts';
import { ApiError } from '../api-error.ts';
import { tokenManager } from '../../auth/token-manager.ts';
import type {
  CreateServiceMomentPayload,
  CreateSongItemPayload,
  CreateSetlistPayload,
  UpdateSetlistItemPayload,
  UpdateSetlistPayload,
} from '../setlist-types.ts';

describe('BethesdaApiClient — Setlist Management API Suite (WS6)', () => {
  const originalFetch = globalThis.fetch;
  let client: BethesdaApiClient;

  beforeEach(() => {
    tokenManager.clearToken();
    client = new BethesdaApiClient({ baseUrl: 'http://localhost:3001/api/v1' });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    tokenManager.clearToken();
  });

  // ==========================================================================
  // 1. GET /api/v1/setlists
  // ==========================================================================
  it('1. should list setlists with query filters and unwrap pagination envelope correctly', async () => {
    let capturedUrl = '';
    let capturedHeaders: HeadersInit | undefined;

    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(input);
      capturedHeaders = init?.headers;

      const mockResponse = {
        data: [
          {
            id: 'setlist-1',
            title: 'Culto Matutino',
            scheduledDateTime: '2026-09-27T08:00:00.000Z',
            status: 'ACTIVE',
            directorUserId: 'director-1',
            directorName: 'Pastor David',
            totalItems: 5,
            totalSongs: 4,
            createdAt: '2026-09-21T10:00:00.000Z',
            updatedAt: '2026-09-21T10:00:00.000Z',
          },
        ],
        pagination: {
          total: 1,
          limit: 10,
          offset: 0,
        },
      };

      return new Response(JSON.stringify(mockResponse), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    };

    tokenManager.setToken('test-token-123', 900);

    const result = await client.listSetlists({
      status: 'ACTIVE',
      upcoming: true,
      limit: 10,
      offset: 0,
    });

    assert.ok(capturedUrl.includes('/api/v1/setlists'));
    assert.ok(capturedUrl.includes('status=ACTIVE'));
    assert.ok(capturedUrl.includes('upcoming=true'));
    assert.ok(capturedUrl.includes('limit=10'));
    assert.ok(capturedUrl.includes('offset=0'));

    const headers = new Headers(capturedHeaders);
    assert.strictEqual(headers.get('Authorization'), 'Bearer test-token-123');

    assert.strictEqual(result.items.length, 1);
    assert.strictEqual(result.items[0]!.title, 'Culto Matutino');
    assert.strictEqual(result.items[0]!.status, 'ACTIVE');
    assert.strictEqual(result.total, 1);
    assert.strictEqual(result.limit, 10);
    assert.strictEqual(result.offset, 0);
  });

  // ==========================================================================
  // 2. POST /api/v1/setlists
  // ==========================================================================
  it('2. should create a new setlist and return FrontendSetlistEntity', async () => {
    let capturedMethod = '';
    let capturedBody = '';

    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedMethod = init?.method ?? 'GET';
      capturedBody = String(init?.body ?? '');

      const mockResponse = {
        data: {
          id: 'new-setlist-1',
          title: 'Culto de Jóvenes',
          scheduledDateTime: '2026-10-03T18:00:00.000Z',
          status: 'PLANNING',
          directorUserId: 'user-789',
          notes: 'Enfoque en adoración congregacional',
          createdAt: '2026-09-21T12:00:00.000Z',
          updatedAt: '2026-09-21T12:00:00.000Z',
        },
      };

      return new Response(JSON.stringify(mockResponse), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      });
    };

    const payload: CreateSetlistPayload = {
      title: 'Culto de Jóvenes',
      scheduledDateTime: '2026-10-03T18:00:00.000Z',
      directorUserId: 'user-789',
      notes: 'Enfoque en adoración congregacional',
    };

    const result = await client.createSetlist(payload);

    assert.strictEqual(capturedMethod, 'POST');
    const parsedBody = JSON.parse(capturedBody);
    assert.strictEqual(parsedBody.title, 'Culto de Jóvenes');
    assert.strictEqual(result.id, 'new-setlist-1');
    assert.strictEqual(result.status, 'PLANNING');
    assert.strictEqual(result.directorUserId, 'user-789');
  });

  // ==========================================================================
  // 3. GET /api/v1/setlists/:id
  // ==========================================================================
  it('3. should get setlist detail with ordered items', async () => {
    let capturedUrl = '';

    globalThis.fetch = async (input: RequestInfo | URL) => {
      capturedUrl = String(input);

      const mockResponse = {
        data: {
          id: 'setlist-xyz',
          title: 'Culto Central',
          scheduledDateTime: '2026-09-27T10:00:00.000Z',
          status: 'ACTIVE',
          directorUserId: 'dir-1',
          directorName: 'Líder Alabanza',
          notes: 'Transmisión en vivo',
          createdAt: '2026-09-21T10:00:00.000Z',
          updatedAt: '2026-09-21T10:00:00.000Z',
          items: [
            {
              id: 'item-1',
              setlistId: 'setlist-xyz',
              sequenceOrder: 1,
              itemType: 'SERVICE_MOMENT',
              songId: null,
              targetKey: null,
              targetBpm: null,
              transitionType: null,
              momentTitle: 'Bienvenida y Oración',
              durationMinutes: 5,
              musicalKey: 'D',
              notesForTeam: 'Pad en Re Mayor',
              createdAt: '2026-09-21T10:00:00.000Z',
              updatedAt: '2026-09-21T10:00:00.000Z',
              song: null,
            },
            {
              id: 'item-2',
              setlistId: 'setlist-xyz',
              sequenceOrder: 2,
              itemType: 'SONG',
              songId: 'song-abc',
              targetKey: 'E',
              targetBpm: 72,
              transitionType: 'SEGUE',
              momentTitle: null,
              durationMinutes: null,
              musicalKey: null,
              notesForTeam: 'Entrada con guitarras',
              createdAt: '2026-09-21T10:00:00.000Z',
              updatedAt: '2026-09-21T10:00:00.000Z',
              song: {
                id: 'song-abc',
                title: 'Tu Fidelidad',
                artist: 'Marcos Witt',
                defaultKey: 'C',
                defaultBpm: 70,
                timeSignature: '4/4',
                status: 'APPROVED',
              },
            },
          ],
        },
      };

      return new Response(JSON.stringify(mockResponse), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    };

    const detail = await client.getSetlist('setlist-xyz');

    assert.ok(capturedUrl.endsWith('/setlists/setlist-xyz'));
    assert.strictEqual(detail.id, 'setlist-xyz');
    assert.strictEqual(detail.directorName, 'Líder Alabanza');
    assert.strictEqual(detail.items.length, 2);
    assert.strictEqual(detail.items[0]!.itemType, 'SERVICE_MOMENT');
    assert.strictEqual(detail.items[1]!.itemType, 'SONG');
    assert.strictEqual(detail.items[1]!.song?.title, 'Tu Fidelidad');
  });

  // ==========================================================================
  // 4. PUT /api/v1/setlists/:id
  // ==========================================================================
  it('4. should update setlist metadata and return FrontendSetlistEntity', async () => {
    let capturedMethod = '';
    let capturedBody = '';

    globalThis.fetch = async (_input: RequestInfo | URL, init?: RequestInit) => {
      capturedMethod = init?.method ?? 'GET';
      capturedBody = String(init?.body ?? '');

      const mockResponse = {
        data: {
          id: 'setlist-123',
          title: 'Culto Dominical — Editado',
          scheduledDateTime: '2026-09-27T11:00:00.000Z',
          status: 'PLANNING',
          directorUserId: 'dir-2',
          notes: 'Horario actualizado',
          createdAt: '2026-09-21T10:00:00.000Z',
          updatedAt: '2026-09-21T11:30:00.000Z',
        },
      };

      return new Response(JSON.stringify(mockResponse), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    };

    const payload: UpdateSetlistPayload = {
      title: 'Culto Dominical — Editado',
      scheduledDateTime: '2026-09-27T11:00:00.000Z',
      notes: 'Horario actualizado',
    };

    const updated = await client.updateSetlist('setlist-123', payload);

    assert.strictEqual(capturedMethod, 'PUT');
    const parsed = JSON.parse(capturedBody);
    assert.strictEqual(parsed.title, 'Culto Dominical — Editado');
    assert.strictEqual(updated.title, 'Culto Dominical — Editado');
    assert.strictEqual(updated.updatedAt, '2026-09-21T11:30:00.000Z');
  });

  // ==========================================================================
  // 5. DELETE /api/v1/setlists/:id
  // ==========================================================================
  it('5. should delete a setlist', async () => {
    let capturedMethod = '';

    globalThis.fetch = async (_input: RequestInfo | URL, init?: RequestInit) => {
      capturedMethod = init?.method ?? 'GET';
      return new Response(
        JSON.stringify({ success: true, message: 'Setlist eliminado exitosamente.' }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    };

    const result = await client.deleteSetlist('setlist-delete-me');
    assert.strictEqual(capturedMethod, 'DELETE');
    assert.strictEqual(result.success, true);
  });

  // ==========================================================================
  // 6. POST /api/v1/setlists/:id/status
  // ==========================================================================
  it('6. should transition liturgical setlist status', async () => {
    let capturedMethod = '';
    let capturedBody = '';

    globalThis.fetch = async (_input: RequestInfo | URL, init?: RequestInit) => {
      capturedMethod = init?.method ?? 'GET';
      capturedBody = String(init?.body ?? '');

      const mockResponse = {
        data: {
          id: 'setlist-act',
          title: 'Culto Solemne',
          scheduledDateTime: '2026-09-27T10:00:00.000Z',
          status: 'ACTIVE',
          directorUserId: null,
          notes: null,
          createdAt: '2026-09-21T10:00:00.000Z',
          updatedAt: '2026-09-21T10:30:00.000Z',
        },
      };

      return new Response(JSON.stringify(mockResponse), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    };

    const updated = await client.updateSetlistStatus('setlist-act', 'ACTIVE');

    assert.strictEqual(capturedMethod, 'POST');
    const parsed = JSON.parse(capturedBody);
    assert.strictEqual(parsed.status, 'ACTIVE');
    assert.strictEqual(updated.status, 'ACTIVE');
  });

  // ==========================================================================
  // 7. POST /api/v1/setlists/:id/items (Discriminated Unions)
  // ==========================================================================
  it('7.1 should add a SONG item to a setlist', async () => {
    let capturedBody = '';

    globalThis.fetch = async (_input: RequestInfo | URL, init?: RequestInit) => {
      capturedBody = String(init?.body ?? '');

      const mockResponse = {
        data: {
          id: 'item-song-1',
          setlistId: 'setlist-1',
          sequenceOrder: 1,
          itemType: 'SONG',
          songId: 'song-123',
          targetKey: 'G',
          targetBpm: 120,
          transitionType: 'CROSSFADE',
          momentTitle: null,
          durationMinutes: null,
          musicalKey: null,
          notesForTeam: 'Directo al coro',
          createdAt: '2026-09-21T10:00:00.000Z',
          updatedAt: '2026-09-21T10:00:00.000Z',
          song: {
            id: 'song-123',
            title: 'Rey de Reyes',
            artist: 'Marco Barrientos',
            defaultKey: 'E',
            defaultBpm: 115,
            timeSignature: '4/4',
            status: 'APPROVED',
          },
        },
      };

      return new Response(JSON.stringify(mockResponse), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      });
    };

    const payload: CreateSongItemPayload = {
      itemType: 'SONG',
      songId: 'song-123',
      targetKey: 'G',
      targetBpm: 120,
      transitionType: 'CROSSFADE',
      notesForTeam: 'Directo al coro',
    };

    const item = await client.addSetlistItem('setlist-1', payload);

    const parsed = JSON.parse(capturedBody);
    assert.strictEqual(parsed.itemType, 'SONG');
    assert.strictEqual(parsed.songId, 'song-123');
    assert.strictEqual(item.itemType, 'SONG');
    assert.strictEqual(item.song?.title, 'Rey de Reyes');
  });

  it('7.2 should add a SERVICE_MOMENT item to a setlist', async () => {
    let capturedBody = '';

    globalThis.fetch = async (_input: RequestInfo | URL, init?: RequestInit) => {
      capturedBody = String(init?.body ?? '');

      const mockResponse = {
        data: {
          id: 'item-moment-1',
          setlistId: 'setlist-1',
          sequenceOrder: 2,
          itemType: 'SERVICE_MOMENT',
          songId: null,
          targetKey: null,
          targetBpm: null,
          transitionType: null,
          momentTitle: 'Tiempo de Diezmos y Ofrendas',
          durationMinutes: 10,
          musicalKey: 'C',
          notesForTeam: 'Música instrumental suave',
          createdAt: '2026-09-21T10:00:00.000Z',
          updatedAt: '2026-09-21T10:00:00.000Z',
          song: null,
        },
      };

      return new Response(JSON.stringify(mockResponse), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      });
    };

    const payload: CreateServiceMomentPayload = {
      itemType: 'SERVICE_MOMENT',
      momentTitle: 'Tiempo de Diezmos y Ofrendas',
      durationMinutes: 10,
      musicalKey: 'C',
      notesForTeam: 'Música instrumental suave',
    };

    const item = await client.addSetlistItem('setlist-1', payload);

    const parsed = JSON.parse(capturedBody);
    assert.strictEqual(parsed.itemType, 'SERVICE_MOMENT');
    assert.strictEqual(parsed.momentTitle, 'Tiempo de Diezmos y Ofrendas');
    assert.strictEqual(parsed.songId, undefined);
    assert.strictEqual(item.itemType, 'SERVICE_MOMENT');
    assert.strictEqual(item.song, null);
  });

  // ==========================================================================
  // 8. PUT /api/v1/setlists/:id/items/:itemId
  // ==========================================================================
  it('8. should update setlist item', async () => {
    let capturedUrl = '';

    globalThis.fetch = async (input: RequestInfo | URL) => {
      capturedUrl = String(input);

      const mockResponse = {
        data: {
          id: 'item-update-1',
          setlistId: 'setlist-1',
          sequenceOrder: 1,
          itemType: 'SONG',
          songId: 'song-1',
          targetKey: 'F',
          targetBpm: 80,
          transitionType: 'STOP',
          momentTitle: null,
          durationMinutes: null,
          musicalKey: null,
          notesForTeam: 'Final en seco',
          createdAt: '2026-09-21T10:00:00.000Z',
          updatedAt: '2026-09-21T10:45:00.000Z',
          song: null,
        },
      };

      return new Response(JSON.stringify(mockResponse), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    };

    const payload: UpdateSetlistItemPayload = {
      targetKey: 'F',
      transitionType: 'STOP',
      notesForTeam: 'Final en seco',
    };

    const result = await client.updateSetlistItem('setlist-1', 'item-update-1', payload);

    assert.ok(capturedUrl.endsWith('/setlists/setlist-1/items/item-update-1'));
    assert.strictEqual(result.targetKey, 'F');
  });

  // ==========================================================================
  // 9. DELETE /api/v1/setlists/:id/items/:itemId
  // ==========================================================================
  it('9. should delete a setlist item', async () => {
    let capturedMethod = '';

    globalThis.fetch = async (_input: RequestInfo | URL, init?: RequestInit) => {
      capturedMethod = init?.method ?? 'GET';
      return new Response(
        JSON.stringify({ success: true, message: 'Elemento eliminado del setlist exitosamente.' }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    };

    const res = await client.deleteSetlistItem('setlist-1', 'item-del');
    assert.strictEqual(capturedMethod, 'DELETE');
    assert.strictEqual(res.success, true);
  });

  // ==========================================================================
  // 10. PUT /api/v1/setlists/:id/reorder
  // ==========================================================================
  it('10. should reorder setlist items atomically', async () => {
    let capturedBody = '';

    globalThis.fetch = async (_input: RequestInfo | URL, init?: RequestInit) => {
      capturedBody = String(init?.body ?? '');

      const mockResponse = {
        data: [
          { id: 'item-2', sequenceOrder: 1, itemType: 'SONG', song: null },
          { id: 'item-1', sequenceOrder: 2, itemType: 'SERVICE_MOMENT', song: null },
        ],
      };

      return new Response(JSON.stringify(mockResponse), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    };

    const reordered = await client.reorderSetlist('setlist-1', ['item-2', 'item-1']);

    const parsed = JSON.parse(capturedBody);
    assert.deepStrictEqual(parsed.itemIds, ['item-2', 'item-1']);
    assert.strictEqual(reordered.length, 2);
    assert.strictEqual(reordered[0]!.id, 'item-2');
    assert.strictEqual(reordered[1]!.id, 'item-1');
  });

  // ==========================================================================
  // 11. Structured ApiError Handling (400, 403, 404, 409, 500)
  // ==========================================================================
  it('11.1 should propagate 400 VALIDATION_ERROR as ApiError with details', async () => {
    globalThis.fetch = async () => {
      return new Response(
        JSON.stringify({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Los datos enviados en la solicitud no cumplen con el esquema requerido.',
            statusCode: 400,
            details: [{ field: 'title', message: 'El título no puede exceder 255 caracteres.' }],
          },
        }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    };

    await assert.rejects(
      async () => {
        await client.createSetlist({ title: '' });
      },
      (err: unknown) => {
        assert.ok(err instanceof ApiError);
        assert.strictEqual(err.statusCode, 400);
        assert.strictEqual(err.code, 'VALIDATION_ERROR');
        assert.ok(Array.isArray(err.details));
        return true;
      }
    );
  });

  it('11.2 should propagate 403 FORBIDDEN as ApiError', async () => {
    globalThis.fetch = async () => {
      return new Response(
        JSON.stringify({
          error: {
            code: 'FORBIDDEN',
            message: 'Acceso denegado. No posee permisos suficientes para esta operación.',
            statusCode: 403,
            details: null,
          },
        }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      );
    };

    await assert.rejects(
      async () => {
        await client.updateSetlistStatus('setlist-1', 'ACTIVE');
      },
      (err: unknown) => {
        assert.ok(err instanceof ApiError);
        assert.strictEqual(err.statusCode, 403);
        assert.strictEqual(err.code, 'FORBIDDEN');
        return true;
      }
    );
  });

  it('11.3 should propagate 404 NOT_FOUND as ApiError', async () => {
    globalThis.fetch = async () => {
      return new Response(
        JSON.stringify({
          error: {
            code: 'NOT_FOUND',
            message: "El recurso 'Setlist' con identificador 'non-existent' no fue encontrado.",
            statusCode: 404,
            details: { resource: 'Setlist', identifier: 'non-existent' },
          },
        }),
        { status: 404, headers: { 'Content-Type': 'application/json' } }
      );
    };

    await assert.rejects(
      async () => {
        await client.getSetlist('non-existent');
      },
      (err: unknown) => {
        assert.ok(err instanceof ApiError);
        assert.strictEqual(err.statusCode, 404);
        assert.strictEqual(err.code, 'NOT_FOUND');
        return true;
      }
    );
  });

  it('11.4 should propagate 409 CONFLICT (Rule A: already active setlist) as ApiError', async () => {
    globalThis.fetch = async () => {
      return new Response(
        JSON.stringify({
          error: {
            code: 'CONFLICT',
            message:
              "Ya existe un setlist en estado ACTIVE ('Culto Principal'). Debe finalizar o cambiar su estado antes de activar un nuevo culto.",
            statusCode: 409,
            details: null,
          },
        }),
        { status: 409, headers: { 'Content-Type': 'application/json' } }
      );
    };

    await assert.rejects(
      async () => {
        await client.updateSetlistStatus('setlist-other', 'ACTIVE');
      },
      (err: unknown) => {
        assert.ok(err instanceof ApiError);
        assert.strictEqual(err.statusCode, 409);
        assert.strictEqual(err.code, 'CONFLICT');
        assert.ok(err.message.includes('Ya existe un setlist en estado ACTIVE'));
        return true;
      }
    );
  });

  it('11.5 should propagate 500 INTERNAL_ERROR as ApiError', async () => {
    globalThis.fetch = async () => {
      return new Response(
        JSON.stringify({
          error: {
            code: 'INTERNAL_ERROR',
            message: 'Ocurrió un error interno en el servidor.',
            statusCode: 500,
            details: null,
          },
        }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    };

    await assert.rejects(
      async () => {
        await client.listSetlists();
      },
      (err: unknown) => {
        assert.ok(err instanceof ApiError);
        assert.strictEqual(err.statusCode, 500);
        assert.strictEqual(err.code, 'INTERNAL_ERROR');
        return true;
      }
    );
  });

  // ==========================================================================
  // 12. 401 Silent Refresh and Request Retry Integration
  // ==========================================================================
  it('12. should automatically refresh token on 401 and retry the original setlist request', async () => {
    let callCount = 0;
    let refreshCalled = false;

    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      callCount++;

      // Primera llamada al setlist retorna 401
      if (url.includes('/setlists/retry-test') && callCount === 1) {
        return new Response(
          JSON.stringify({
            error: { code: 'TOKEN_EXPIRED', message: 'Token expirado', statusCode: 401 },
          }),
          { status: 401, headers: { 'Content-Type': 'application/json' } }
        );
      }

      // Llamada de refresco silencioso
      if (url.includes('/auth/refresh')) {
        refreshCalled = true;
        return new Response(
          JSON.stringify({
            data: {
              accessToken: 'new-refreshed-token-999',
              expiresIn: 900,
              user: {
                id: 'u1',
                email: 'test@bethesda.com',
                role: 'WORSHIP_LEADER',
                firstName: 'Juan',
                lastName: 'Castro',
                accountStatus: 'ACTIVE',
                emailVerified: true,
              },
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }

      // Segunda llamada (reintento con nuevo token)
      if (url.includes('/setlists/retry-test') && callCount === 3) {
        const headers = new Headers(init?.headers);
        assert.strictEqual(headers.get('Authorization'), 'Bearer new-refreshed-token-999');

        return new Response(
          JSON.stringify({
            data: {
              id: 'retry-test',
              title: 'Culto Recuperado',
              scheduledDateTime: null,
              status: 'PLANNING',
              directorUserId: null,
              notes: null,
              createdAt: '2026-09-21T10:00:00.000Z',
              updatedAt: '2026-09-21T10:00:00.000Z',
              items: [],
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }

      return new Response('Not Found', { status: 404 });
    };

    tokenManager.setToken('old-expired-token', 900);

    const result = await client.getSetlist('retry-test');

    assert.strictEqual(refreshCalled, true);
    assert.strictEqual(tokenManager.getToken(), 'new-refreshed-token-999');
    assert.strictEqual(result.title, 'Culto Recuperado');
  });
});
