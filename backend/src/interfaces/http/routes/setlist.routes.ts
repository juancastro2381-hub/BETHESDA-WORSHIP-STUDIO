/**
 * @file setlist.routes.ts
 * @description Rutas HTTP y controladores para la gestión litúrgica de Setlists y Momentos de Servicio (Fase 2C — WS5).
 *
 * Aplica:
 * - Autenticación JWT HS256 y control de acceso RBAC estricto con AuthGuard.
 * - Verificación en tiempo real contra PostgreSQL (verifyDatabaseRole = true) en todas las operaciones mutantes.
 * - Validación exhaustiva de parámetros y payloads mediante esquemas Zod (setlist.schemas.ts).
 * - Registro obligatorio de auditoría para creación (SETLIST_CREATED), activación (SETLIST_ACTIVATED) y eliminación (SETLIST_DELETED).
 * - Delegación de lógica de negocio y máquina de estados litúrgicos a SetlistService (WS4).
 * - Manejo de errores mapeado de forma estructurada a través del errorHandler global.
 */

import type { FastifyPluginAsync } from 'fastify';
import { env } from '../../../config/env.ts';
import {
  CreateSetlistBodySchema,
  CreateSetlistItemBodySchema,
  ListSetlistsQuerySchema,
  ReorderSetlistItemsBodySchema,
  SetlistIdParamSchema,
  SetlistItemIdParamSchema,
  SetlistStatusTransitionBodySchema,
  UpdateSetlistBodySchema,
  UpdateSetlistItemBodySchema,
} from '../schemas/setlist.schemas.ts';
import { SetlistService } from '../../../application/setlist-service.ts';
import { DrizzleSetlistRepository } from '../../../repositories/setlist-repository.ts';
import { DrizzleSongRepository } from '../../../repositories/song-repository.ts';
import { DrizzleUserRepository } from '../../../repositories/user-repository.ts';
import { DrizzleAuditLogRepository } from '../../../repositories/audit-repository.ts';
import { JwtTokenService } from '../../../application/token-service.ts';
import { AuditService } from '../../../application/audit-service.ts';
import { AuthGuard } from '../middlewares/auth-middleware.ts';

export const setlistRoutes: FastifyPluginAsync = async (fastify) => {
  // Inicialización de repositorios y servicios de dominio
  const setlistRepo = new DrizzleSetlistRepository();
  const songRepo = new DrizzleSongRepository();
  const userRepo = new DrizzleUserRepository();
  const auditRepo = new DrizzleAuditLogRepository();

  const tokenService = new JwtTokenService(env.JWT_SECRET, env.JWT_ACCESS_EXPIRES_IN);
  const auditService = new AuditService(auditRepo);
  const setlistService = new SetlistService(setlistRepo, songRepo);
  const authGuard = new AuthGuard(tokenService, userRepo);

  const getContext = (request: any) => ({
    ipAddress: request.ip || request.socket?.remoteAddress || '127.0.0.1',
    userAgent: (request.headers['user-agent'] as string) || undefined,
  });

  // ==========================================================================
  // 1. GET /api/v1/setlists - Listar setlists con filtros y paginación
  // ==========================================================================
  fastify.get(
    '/',
    { preHandler: authGuard.requirePermission('setlists:list', false) },
    async (request, reply) => {
      const query = ListSetlistsQuerySchema.parse(request.query);
      const result = await setlistService.listSetlists(query);

      return reply.status(200).send({
        data: result.items,
        pagination: {
          total: result.total,
          limit: query.limit,
          offset: query.offset,
        },
      });
    }
  );

  // ==========================================================================
  // 2. POST /api/v1/setlists - Crear nuevo setlist en estado PLANNING
  // ==========================================================================
  fastify.post(
    '/',
    { preHandler: authGuard.requirePermission('setlists:create', true) },
    async (request, reply) => {
      const body = CreateSetlistBodySchema.parse(request.body);
      const context = getContext(request);
      const operatorId = request.user!.sub;

      const created = await setlistService.createSetlist(body);

      await auditService.log({
        eventType: 'SETLIST_CREATED',
        userId: operatorId,
        resource: `setlist:${created.id}`,
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
        metadata: {
          setlistId: created.id,
          title: created.title,
          status: created.status,
          scheduledDateTime: created.scheduledDateTime,
          directorUserId: created.directorUserId,
        },
      });

      return reply.status(201).send({
        data: created,
      });
    }
  );

  // ==========================================================================
  // 3. GET /api/v1/setlists/:id - Obtener setlist con sus ítems ordenados
  // ==========================================================================
  fastify.get(
    '/:id',
    { preHandler: authGuard.requirePermission('setlists:read', false) },
    async (request, reply) => {
      const params = SetlistIdParamSchema.parse(request.params);
      const setlist = await setlistService.getSetlist(params.id);

      return reply.status(200).send({
        data: setlist,
      });
    }
  );

  // ==========================================================================
  // 4. PUT /api/v1/setlists/:id - Actualizar metadatos de un setlist
  // ==========================================================================
  fastify.put(
    '/:id',
    { preHandler: authGuard.requirePermission('setlists:update', true) },
    async (request, reply) => {
      const params = SetlistIdParamSchema.parse(request.params);
      const body = UpdateSetlistBodySchema.parse(request.body);

      const updated = await setlistService.updateSetlist(params.id, body);

      return reply.status(200).send({
        data: updated,
      });
    }
  );

  // ==========================================================================
  // 5. DELETE /api/v1/setlists/:id - Eliminar setlist en cascada (ADMIN+)
  // ==========================================================================
  fastify.delete(
    '/:id',
    { preHandler: authGuard.requirePermission('setlists:delete', true) },
    async (request, reply) => {
      const params = SetlistIdParamSchema.parse(request.params);
      const context = getContext(request);
      const operatorId = request.user!.sub;

      const existing = await setlistService.getSetlist(params.id);
      await setlistService.deleteSetlist(params.id);

      await auditService.log({
        eventType: 'SETLIST_DELETED',
        userId: operatorId,
        resource: `setlist:${params.id}`,
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
        metadata: {
          setlistId: params.id,
          title: existing.title,
        },
      });

      return reply.status(200).send({
        success: true,
        message: 'Setlist eliminado exitosamente.',
      });
    }
  );

  // ==========================================================================
  // 6. POST /api/v1/setlists/:id/status - Transición de estado litúrgico
  // ==========================================================================
  fastify.post(
    '/:id/status',
    { preHandler: authGuard.requirePermission('setlists:activate', true) },
    async (request, reply) => {
      const params = SetlistIdParamSchema.parse(request.params);
      const body = SetlistStatusTransitionBodySchema.parse(request.body);
      const context = getContext(request);
      const operatorId = request.user!.sub;

      const updated = await setlistService.transitionStatus(params.id, body.status);

      if (updated.status === 'ACTIVE') {
        await auditService.log({
          eventType: 'SETLIST_ACTIVATED',
          userId: operatorId,
          resource: `setlist:${params.id}`,
          ipAddress: context.ipAddress,
          userAgent: context.userAgent,
          metadata: {
            setlistId: params.id,
            title: updated.title,
            newStatus: updated.status,
          },
        });
      }

      return reply.status(200).send({
        data: updated,
      });
    }
  );

  // ==========================================================================
  // 7. POST /api/v1/setlists/:id/items - Agregar ítem (Canción o Momento)
  // ==========================================================================
  fastify.post(
    '/:id/items',
    { preHandler: authGuard.requirePermission('setlists:update', true) },
    async (request, reply) => {
      const params = SetlistIdParamSchema.parse(request.params);
      const body = CreateSetlistItemBodySchema.parse(request.body);

      const createdItem = await setlistService.addItem(params.id, body as any);

      return reply.status(201).send({
        data: createdItem,
      });
    }
  );

  // ==========================================================================
  // 8. PUT /api/v1/setlists/:id/items/:itemId - Modificar ítem de setlist
  // ==========================================================================
  fastify.put(
    '/:id/items/:itemId',
    { preHandler: authGuard.requirePermission('setlists:update', true) },
    async (request, reply) => {
      const params = SetlistItemIdParamSchema.parse(request.params);
      const body = UpdateSetlistItemBodySchema.parse(request.body);

      const updatedItem = await setlistService.updateItem(params.id, params.itemId, body as any);

      return reply.status(200).send({
        data: updatedItem,
      });
    }
  );

  // ==========================================================================
  // 9. DELETE /api/v1/setlists/:id/items/:itemId - Eliminar ítem de setlist
  // ==========================================================================
  fastify.delete(
    '/:id/items/:itemId',
    { preHandler: authGuard.requirePermission('setlists:update', true) },
    async (request, reply) => {
      const params = SetlistItemIdParamSchema.parse(request.params);

      await setlistService.removeItem(params.id, params.itemId);

      return reply.status(200).send({
        success: true,
        message: 'Elemento eliminado del setlist exitosamente.',
      });
    }
  );

  // ==========================================================================
  // 10. PUT /api/v1/setlists/:id/reorder - Reordenamiento atómico transaccional
  // ==========================================================================
  fastify.put(
    '/:id/reorder',
    { preHandler: authGuard.requirePermission('setlists:reorder', true) },
    async (request, reply) => {
      const params = SetlistIdParamSchema.parse(request.params);
      const body = ReorderSetlistItemsBodySchema.parse(request.body);

      const reorderedItems = await setlistService.reorderItems(params.id, body.itemIds);

      return reply.status(200).send({
        data: reorderedItems,
      });
    }
  );
};
