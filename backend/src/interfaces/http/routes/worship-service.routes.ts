/**
 * @file worship-service.routes.ts
 * @description Rutas HTTP para Cultos y Servicios Litúrgicos (Fase 2C).
 *
 * RBAC:
 * - services:list / services:read  → todos los roles autenticados.
 * - services:create / services:update → SUPER_ADMIN, ADMIN, WORSHIP_LEADER.
 * - services:delete → SUPER_ADMIN, ADMIN.
 * Operaciones mutantes verifican el rol contra PostgreSQL (verifyDatabaseRole = true).
 */

import type { FastifyPluginAsync } from 'fastify';
import { env } from '../../../config/env.ts';
import {
  CreateWorshipServiceBodySchema,
  ListWorshipServicesQuerySchema,
  UpdateWorshipServiceBodySchema,
  WorshipServiceIdParamSchema,
} from '../schemas/worship-service.schemas.ts';
import { WorshipServiceService } from '../../../application/worship-service-service.ts';
import { DrizzleWorshipServiceRepository } from '../../../repositories/worship-service-repository.ts';
import { DrizzleSetlistRepository } from '../../../repositories/setlist-repository.ts';
import { DrizzleUserRepository } from '../../../repositories/user-repository.ts';
import { DrizzleAuditLogRepository } from '../../../repositories/audit-repository.ts';
import { JwtTokenService } from '../../../application/token-service.ts';
import { AuditService } from '../../../application/audit-service.ts';
import { AuthGuard } from '../middlewares/auth-middleware.ts';

export const worshipServiceRoutes: FastifyPluginAsync = async (fastify) => {
  const serviceRepo = new DrizzleWorshipServiceRepository();
  const setlistRepo = new DrizzleSetlistRepository();
  const userRepo = new DrizzleUserRepository();
  const auditService = new AuditService(new DrizzleAuditLogRepository());
  const tokenService = new JwtTokenService(env.JWT_SECRET, env.JWT_ACCESS_EXPIRES_IN);
  const authGuard = new AuthGuard(tokenService, userRepo);
  const worshipService = new WorshipServiceService(serviceRepo, setlistRepo);

  const getContext = (request: any) => ({
    ipAddress: request.ip || request.socket?.remoteAddress || '127.0.0.1',
    userAgent: (request.headers['user-agent'] as string) || undefined,
  });

  // GET /api/v1/worship-services
  fastify.get(
    '/',
    { preHandler: authGuard.requirePermission('services:list', false) },
    async (request, reply) => {
      const query = ListWorshipServicesQuerySchema.parse(request.query);
      const result = await worshipService.listServices(query);
      return reply.status(200).send({
        data: result.items,
        pagination: { total: result.total, limit: query.limit, offset: query.offset },
      });
    }
  );

  // POST /api/v1/worship-services
  fastify.post(
    '/',
    { preHandler: authGuard.requirePermission('services:create', true) },
    async (request, reply) => {
      const body = CreateWorshipServiceBodySchema.parse(request.body);
      const context = getContext(request);
      const created = await worshipService.createService(body);

      await auditService.log({
        eventType: 'WORSHIP_SERVICE_CREATED',
        userId: request.user!.sub,
        resource: `worship_service:${created.id}`,
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
        metadata: {
          worshipServiceId: created.id,
          name: created.name,
          serviceType: created.serviceType,
          scheduledAt: created.scheduledAt,
          setlistId: created.setlistId,
        },
      });

      return reply.status(201).send({ data: created });
    }
  );

  // GET /api/v1/worship-services/:id
  fastify.get(
    '/:id',
    { preHandler: authGuard.requirePermission('services:read', false) },
    async (request, reply) => {
      const params = WorshipServiceIdParamSchema.parse(request.params);
      const service = await worshipService.getService(params.id);
      return reply.status(200).send({ data: service });
    }
  );

  // PUT /api/v1/worship-services/:id
  fastify.put(
    '/:id',
    { preHandler: authGuard.requirePermission('services:update', true) },
    async (request, reply) => {
      const params = WorshipServiceIdParamSchema.parse(request.params);
      const body = UpdateWorshipServiceBodySchema.parse(request.body);
      const updated = await worshipService.updateService(params.id, body);
      return reply.status(200).send({ data: updated });
    }
  );

  // DELETE /api/v1/worship-services/:id
  fastify.delete(
    '/:id',
    { preHandler: authGuard.requirePermission('services:delete', true) },
    async (request, reply) => {
      const params = WorshipServiceIdParamSchema.parse(request.params);
      const context = getContext(request);
      const existing = await worshipService.getService(params.id);
      await worshipService.deleteService(params.id);

      await auditService.log({
        eventType: 'WORSHIP_SERVICE_DELETED',
        userId: request.user!.sub,
        resource: `worship_service:${params.id}`,
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
        metadata: { worshipServiceId: params.id, name: existing.name },
      });

      return reply.status(200).send({ success: true, message: 'Servicio litúrgico eliminado exitosamente.' });
    }
  );
};

