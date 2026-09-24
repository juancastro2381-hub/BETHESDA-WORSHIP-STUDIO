/**
 * @file setlist-domain-and-schemas.test.ts
 * @description Suite de pruebas para el dominio de Setlists, permisos RBAC y esquemas de validación Zod (Fase 2C - WS2).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  ROLE_PERMISSIONS,
  type Permission,
  type UserRole,
} from '../domain/auth-types.ts';
import {
  CreateSetlistBodySchema,
  UpdateSetlistBodySchema,
  SetlistStatusTransitionBodySchema,
  CreateSetlistItemBodySchema,
  UpdateSetlistItemBodySchema,
  ReorderSetlistItemsBodySchema,
  ListSetlistsQuerySchema,
  SetlistIdParamSchema,
  SetlistItemIdParamSchema,
} from '../interfaces/http/schemas/setlist.schemas.ts';

describe('Phase 2C — WS2: Setlist Domain, RBAC Permissions & Zod Schemas', () => {
  // ==========================================================================
  // 1. VERIFICACIÓN DE PERMISOS RBAC Y MATRIZ DE AUTORIZACIÓN
  // ==========================================================================
  describe('1. RBAC Domain Permissions and Role Mapping', () => {
    const requiredPermissions: Permission[] = [
      'setlists:list',
      'setlists:read',
      'setlists:create',
      'setlists:update',
      'setlists:reorder',
      'setlists:activate',
      'setlists:delete',
    ];

    it('1.1 should define all 7 required Phase 2C Setlist permissions', () => {
      // Verificamos que los permisos existan en SUPER_ADMIN
      for (const perm of requiredPermissions) {
        assert.ok(
          ROLE_PERMISSIONS.SUPER_ADMIN.includes(perm),
          `SUPER_ADMIN debe contener el permiso ${perm}`
        );
      }
    });

    it('1.2 should grant full setlist permissions to ADMIN', () => {
      for (const perm of requiredPermissions) {
        assert.ok(
          ROLE_PERMISSIONS.ADMIN.includes(perm),
          `ADMIN debe contener el permiso ${perm}`
        );
      }
    });

    it('1.3 should grant workflow permissions to WORSHIP_LEADER but strictly deny setlists:delete', () => {
      assert.ok(ROLE_PERMISSIONS.WORSHIP_LEADER.includes('setlists:list'));
      assert.ok(ROLE_PERMISSIONS.WORSHIP_LEADER.includes('setlists:read'));
      assert.ok(ROLE_PERMISSIONS.WORSHIP_LEADER.includes('setlists:create'));
      assert.ok(ROLE_PERMISSIONS.WORSHIP_LEADER.includes('setlists:update'));
      assert.ok(ROLE_PERMISSIONS.WORSHIP_LEADER.includes('setlists:reorder'));
      assert.ok(ROLE_PERMISSIONS.WORSHIP_LEADER.includes('setlists:activate'));

      // WORSHIP_LEADER NO debe poder eliminar setlists (reservado para ADMIN/SUPER_ADMIN)
      assert.strictEqual(
        ROLE_PERMISSIONS.WORSHIP_LEADER.includes('setlists:delete'),
        false,
        'WORSHIP_LEADER no debe poseer setlists:delete'
      );
    });

    it('1.4 should grant only read permissions to MUSICIAN and reject all mutations', () => {
      assert.ok(ROLE_PERMISSIONS.MUSICIAN.includes('setlists:list'));
      assert.ok(ROLE_PERMISSIONS.MUSICIAN.includes('setlists:read'));

      // Sin permisos de mutación
      assert.strictEqual(ROLE_PERMISSIONS.MUSICIAN.includes('setlists:create'), false);
      assert.strictEqual(ROLE_PERMISSIONS.MUSICIAN.includes('setlists:update'), false);
      assert.strictEqual(ROLE_PERMISSIONS.MUSICIAN.includes('setlists:reorder'), false);
      assert.strictEqual(ROLE_PERMISSIONS.MUSICIAN.includes('setlists:activate'), false);
      assert.strictEqual(ROLE_PERMISSIONS.MUSICIAN.includes('setlists:delete'), false);
    });

    it('1.5 should grant only read permissions to VIEWER and reject all mutations', () => {
      assert.ok(ROLE_PERMISSIONS.VIEWER.includes('setlists:list'));
      assert.ok(ROLE_PERMISSIONS.VIEWER.includes('setlists:read'));

      // Sin permisos de mutación
      assert.strictEqual(ROLE_PERMISSIONS.VIEWER.includes('setlists:create'), false);
      assert.strictEqual(ROLE_PERMISSIONS.VIEWER.includes('setlists:update'), false);
      assert.strictEqual(ROLE_PERMISSIONS.VIEWER.includes('setlists:reorder'), false);
      assert.strictEqual(ROLE_PERMISSIONS.VIEWER.includes('setlists:activate'), false);
      assert.strictEqual(ROLE_PERMISSIONS.VIEWER.includes('setlists:delete'), false);
    });
  });

  // ==========================================================================
  // 2. ESQUEMAS ZOD DE SETLIST: CREACIÓN Y ACTUALIZACIÓN
  // ==========================================================================
  describe('2. Setlist Creation and Update Schemas', () => {
    it('2.1 should validate a valid complete setlist creation payload', () => {
      const validPayload = {
        title: 'Culto Dominical - 27 Septiembre',
        scheduledDateTime: '2026-09-27T10:00:00.000Z',
        directorUserId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
        notes: 'Culto especial con santa cena.',
      };

      const result = CreateSetlistBodySchema.safeParse(validPayload);
      assert.ok(result.success);
      if (result.success) {
        assert.strictEqual(result.data.title, validPayload.title);
        assert.strictEqual(result.data.scheduledDateTime, validPayload.scheduledDateTime);
      }
    });

    it('2.2 should validate a minimal setlist creation payload (only title)', () => {
      const minimalPayload = {
        title: 'Vigilia Juvenil',
      };

      const result = CreateSetlistBodySchema.safeParse(minimalPayload);
      assert.ok(result.success);
      if (result.success) {
        assert.strictEqual(result.data.title, 'Vigilia Juvenil');
        assert.strictEqual(result.data.scheduledDateTime, undefined);
      }
    });

    it('2.3 should reject setlist creation with empty title or title > 255 chars', () => {
      const emptyTitle = { title: '' };
      const longTitle = { title: 'a'.repeat(256) };

      assert.strictEqual(CreateSetlistBodySchema.safeParse(emptyTitle).success, false);
      assert.strictEqual(CreateSetlistBodySchema.safeParse(longTitle).success, false);
    });

    it('2.4 should reject invalid date format in scheduledDateTime', () => {
      const invalidDate = {
        title: 'Culto',
        scheduledDateTime: '2026-13-45 25:00',
      };

      const result = CreateSetlistBodySchema.safeParse(invalidDate);
      assert.strictEqual(result.success, false);
    });

    it('2.5 should reject non-UUID directorUserId', () => {
      const invalidDirector = {
        title: 'Culto',
        directorUserId: 'not-a-valid-uuid',
      };

      const result = CreateSetlistBodySchema.safeParse(invalidDirector);
      assert.strictEqual(result.success, false);
    });

    it('2.6 should validate and accept valid setlist update payloads', () => {
      const updatePayload = {
        title: 'Nuevo Título',
        notes: 'Notas actualizadas',
      };

      const result = UpdateSetlistBodySchema.safeParse(updatePayload);
      assert.ok(result.success);
    });

    it('2.7 should reject setlist update with empty title if provided', () => {
      const emptyTitleUpdate = { title: '' };
      assert.strictEqual(UpdateSetlistBodySchema.safeParse(emptyTitleUpdate).success, false);
    });
  });

  // ==========================================================================
  // 3. TRANSICIÓN DE ESTADOS DE SETLIST
  // ==========================================================================
  describe('3. Setlist Status Transition Schema', () => {
    it('3.1 should accept valid status transitions', () => {
      const validStatuses = ['PLANNING', 'ACTIVE', 'COMPLETED', 'ARCHIVED'];

      for (const status of validStatuses) {
        const result = SetlistStatusTransitionBodySchema.safeParse({ status });
        assert.ok(result.success, `Debe aceptar status = ${status}`);
      }
    });

    it('3.2 should reject invalid or unexpected status values', () => {
      const invalidStatuses = ['DRAFT', 'PENDING', 'DELETED', '', 123, null];

      for (const status of invalidStatuses) {
        const result = SetlistStatusTransitionBodySchema.safeParse({ status });
        assert.strictEqual(result.success, false, `Debe rechazar status = ${status}`);
      }
    });
  });

  // ==========================================================================
  // 4. CREACIÓN POLIMÓRFICA DE ELEMENTOS (SETLIST ITEMS)
  // ==========================================================================
  describe('4. Polymorphic Setlist Item Creation Schema', () => {
    it('4.1 should validate a complete SONG item payload', () => {
      const songPayload = {
        itemType: 'SONG',
        songId: 'b1eebc99-9c0b-4ef8-bb6d-6bb9bd380a22',
        targetKey: 'D',
        targetBpm: 76,
        transitionType: 'CROSSFADE',
        notesForTeam: 'Entra solo piano y voz',
        sequenceOrder: 1,
      };

      const result = CreateSetlistItemBodySchema.safeParse(songPayload);
      assert.ok(result.success);
      if (result.success) {
        assert.strictEqual(result.data.itemType, 'SONG');
        assert.strictEqual(result.data.targetKey, 'D');
        assert.strictEqual(result.data.targetBpm, 76);
      }
    });

    it('4.2 should validate a minimal SONG item payload with default transition STOP', () => {
      const minimalSong = {
        itemType: 'SONG',
        songId: 'b1eebc99-9c0b-4ef8-bb6d-6bb9bd380a22',
      };

      const result = CreateSetlistItemBodySchema.safeParse(minimalSong);
      assert.ok(result.success);
      if (result.success && result.data.itemType === 'SONG') {
        assert.strictEqual(result.data.transitionType, 'STOP');
      }
    });

    it('4.3 should reject SONG item missing songId or with invalid songId', () => {
      const missingSongId = {
        itemType: 'SONG',
        targetKey: 'G',
      };
      const invalidSongId = {
        itemType: 'SONG',
        songId: 'invalid-uuid-123',
      };

      assert.strictEqual(CreateSetlistItemBodySchema.safeParse(missingSongId).success, false);
      assert.strictEqual(CreateSetlistItemBodySchema.safeParse(invalidSongId).success, false);
    });

    it('4.4 should reject SONG item with out-of-range targetBpm (< 20 or > 300)', () => {
      const lowBpm = {
        itemType: 'SONG',
        songId: 'b1eebc99-9c0b-4ef8-bb6d-6bb9bd380a22',
        targetBpm: 15,
      };
      const highBpm = {
        itemType: 'SONG',
        songId: 'b1eebc99-9c0b-4ef8-bb6d-6bb9bd380a22',
        targetBpm: 350,
      };

      assert.strictEqual(CreateSetlistItemBodySchema.safeParse(lowBpm).success, false);
      assert.strictEqual(CreateSetlistItemBodySchema.safeParse(highBpm).success, false);
    });

    it('4.5 should reject SONG item with invalid transitionType', () => {
      const invalidTransition = {
        itemType: 'SONG',
        songId: 'b1eebc99-9c0b-4ef8-bb6d-6bb9bd380a22',
        transitionType: 'FADE_OUT',
      };

      assert.strictEqual(CreateSetlistItemBodySchema.safeParse(invalidTransition).success, false);
    });

    it('4.6 should validate a complete SERVICE_MOMENT item payload', () => {
      const momentPayload = {
        itemType: 'SERVICE_MOMENT',
        momentTitle: 'Bienvenida y Oración Inicial',
        durationMinutes: 5,
        musicalKey: 'Am',
        notesForTeam: 'Pad atmosférico suave en Am',
        sequenceOrder: 2,
      };

      const result = CreateSetlistItemBodySchema.safeParse(momentPayload);
      assert.ok(result.success);
      if (result.success && result.data.itemType === 'SERVICE_MOMENT') {
        assert.strictEqual(result.data.momentTitle, 'Bienvenida y Oración Inicial');
        assert.strictEqual(result.data.durationMinutes, 5);
        assert.strictEqual(result.data.musicalKey, 'Am');
      }
    });

    it('4.7 should reject SERVICE_MOMENT item with missing or empty momentTitle', () => {
      const missingTitle = {
        itemType: 'SERVICE_MOMENT',
        durationMinutes: 5,
      };
      const emptyTitle = {
        itemType: 'SERVICE_MOMENT',
        momentTitle: '',
      };

      assert.strictEqual(CreateSetlistItemBodySchema.safeParse(missingTitle).success, false);
      assert.strictEqual(CreateSetlistItemBodySchema.safeParse(emptyTitle).success, false);
    });

    it('4.8 should reject SERVICE_MOMENT item with invalid durationMinutes (<= 0 or > 180)', () => {
      const zeroDuration = {
        itemType: 'SERVICE_MOMENT',
        momentTitle: 'Oración',
        durationMinutes: 0,
      };
      const excessiveDuration = {
        itemType: 'SERVICE_MOMENT',
        momentTitle: 'Oración',
        durationMinutes: 200,
      };

      assert.strictEqual(CreateSetlistItemBodySchema.safeParse(zeroDuration).success, false);
      assert.strictEqual(CreateSetlistItemBodySchema.safeParse(excessiveDuration).success, false);
    });

    it('4.9 should reject item payload with unknown or missing itemType discriminator', () => {
      const missingType = {
        title: 'Algo',
      };
      const unknownType = {
        itemType: 'VIDEO_CLIP',
        title: 'Video',
      };

      assert.strictEqual(CreateSetlistItemBodySchema.safeParse(missingType).success, false);
      assert.strictEqual(CreateSetlistItemBodySchema.safeParse(unknownType).success, false);
    });
  });

  // ==========================================================================
  // 5. ACTUALIZACIÓN DE ELEMENTOS (SETLIST ITEMS)
  // ==========================================================================
  describe('5. Setlist Item Update Schema', () => {
    it('5.1 should accept valid partial updates for items', () => {
      const songUpdate = { targetKey: 'E', targetBpm: 80 };
      const momentUpdate = { momentTitle: 'Palabra Pastoral', durationMinutes: 35 };

      assert.ok(UpdateSetlistItemBodySchema.safeParse(songUpdate).success);
      assert.ok(UpdateSetlistItemBodySchema.safeParse(momentUpdate).success);
    });

    it('5.2 should reject empty update payload with no fields', () => {
      const emptyUpdate = {};
      const result = UpdateSetlistItemBodySchema.safeParse(emptyUpdate);
      assert.strictEqual(result.success, false);
    });
  });

  // ==========================================================================
  // 6. REORDENAMIENTO ATÓMICO (REORDER PAYLOAD)
  // ==========================================================================
  describe('6. Reorder Setlist Items Schema', () => {
    it('6.1 should accept a valid array of distinct UUIDs', () => {
      const validReorder = {
        itemIds: [
          'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
          'b1eebc99-9c0b-4ef8-bb6d-6bb9bd380a22',
          'c2eebc99-9c0b-4ef8-bb6d-6bb9bd380a33',
        ],
      };

      const result = ReorderSetlistItemsBodySchema.safeParse(validReorder);
      assert.ok(result.success);
      if (result.success) {
        assert.strictEqual(result.data.itemIds.length, 3);
      }
    });

    it('6.2 should reject empty itemIds array', () => {
      const emptyReorder = { itemIds: [] };
      const result = ReorderSetlistItemsBodySchema.safeParse(emptyReorder);
      assert.strictEqual(result.success, false);
    });

    it('6.3 should reject itemIds containing duplicate UUIDs', () => {
      const duplicateReorder = {
        itemIds: [
          'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
          'b1eebc99-9c0b-4ef8-bb6d-6bb9bd380a22',
          'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', // Duplicado
        ],
      };

      const result = ReorderSetlistItemsBodySchema.safeParse(duplicateReorder);
      assert.strictEqual(result.success, false);
    });

    it('6.4 should reject itemIds containing invalid UUID strings', () => {
      const invalidUuidReorder = {
        itemIds: [
          'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
          'not-a-valid-uuid',
        ],
      };

      const result = ReorderSetlistItemsBodySchema.safeParse(invalidUuidReorder);
      assert.strictEqual(result.success, false);
    });
  });

  // ==========================================================================
  // 7. PARÁMETROS DE CONSULTA Y RUTA
  // ==========================================================================
  describe('7. Query and Param Schemas', () => {
    it('7.1 should parse and coerce query params with valid defaults', () => {
      const query = {
        status: 'ACTIVE',
        upcoming: 'true',
        limit: '10',
        offset: '5',
      };

      const result = ListSetlistsQuerySchema.safeParse(query);
      assert.ok(result.success);
      if (result.success) {
        assert.strictEqual(result.data.status, 'ACTIVE');
        assert.strictEqual(result.data.upcoming, true);
        assert.strictEqual(result.data.limit, 10);
        assert.strictEqual(result.data.offset, 5);
      }
    });

    it('7.2 should validate valid UUID path params', () => {
      const validParam = { id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11' };
      const validItemParam = {
        id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
        itemId: 'b1eebc99-9c0b-4ef8-bb6d-6bb9bd380a22',
      };

      assert.ok(SetlistIdParamSchema.safeParse(validParam).success);
      assert.ok(SetlistItemIdParamSchema.safeParse(validItemParam).success);
    });

    it('7.3 should reject invalid UUID in path params', () => {
      const invalidParam = { id: '12345' };
      assert.strictEqual(SetlistIdParamSchema.safeParse(invalidParam).success, false);
    });
  });
});
