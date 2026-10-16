/**
 * @file user.routes.ts
 * @description Rutas HTTP para la gestión de usuarios, roles e invitaciones con RBAC estricto (Fase 2B).
 */

import type { FastifyPluginAsync } from 'fastify';
import { env } from '../../../config/env.ts';
import {
  InviteUserBodySchema,
  ChangeUserRoleBodySchema,
  UserIdParamSchema,
  ListUsersQuerySchema,
} from '../schemas/user.schemas.ts';
import { UserInvitationService } from '../../../application/invitation-service.ts';
import { DrizzleUserRepository } from '../../../repositories/user-repository.ts';
import { DrizzleUserInvitationRepository } from '../../../repositories/user-invitation-repository.ts';
import { DrizzleRefreshTokenRepository } from '../../../repositories/refresh-token-repository.ts';
import { DrizzleAuditLogRepository } from '../../../repositories/audit-repository.ts';
import { Argon2PasswordHasher } from '../../../domain/crypto/password-hasher.ts';
import { JwtTokenService } from '../../../application/token-service.ts';
import { AuditService } from '../../../application/audit-service.ts';
import { AuthGuard } from '../middlewares/auth-middleware.ts';
import { NotFoundError, ForbiddenError } from '../../../domain/errors.ts';
import { userPreferencesRoutes } from './user-preferences.routes.ts';

export const userRoutes: FastifyPluginAsync = async (fastify) => {
  // 0. Sub-plugin: Preferencias del Usuario Autenticado (/api/v1/users/me/preferences — WP-02)
  await fastify.register(userPreferencesRoutes, { prefix: '/me/preferences' });

  const userRepo = new DrizzleUserRepository();
  const invitationRepo = new DrizzleUserInvitationRepository();
  const refreshTokenRepo = new DrizzleRefreshTokenRepository();
  const auditRepo = new DrizzleAuditLogRepository();

  const hasher = new Argon2PasswordHasher({
    memoryCost: env.ARGON2_MEMORY_COST,
    timeCost: env.ARGON2_TIME_COST,
    parallelism: env.ARGON2_PARALLELISM,
  });

  const tokenService = new JwtTokenService(env.JWT_SECRET, env.JWT_ACCESS_EXPIRES_IN);
  const auditService = new AuditService(auditRepo);

  const invitationService = new UserInvitationService(
    userRepo,
    invitationRepo,
    hasher,
    auditService
  );

  const authGuard = new AuthGuard(tokenService, userRepo);

  const getContext = (request: any) => ({
    ipAddress: request.ip || request.socket.remoteAddress || '127.0.0.1',
    userAgent: request.headers['user-agent'] as string | undefined,
  });

  // 1. GET /api/v1/users - Listar usuarios (Requiere permiso users:list verificado contra BD)
  fastify.get('/', { preHandler: authGuard.requirePermission('users:list', true) }, async (request, reply) => {
    const query = ListUsersQuerySchema.parse(request.query);
    const result = await userRepo.listUsers({
      limit: query.limit,
      offset: query.offset,
      role: query.role,
    });

    return reply.status(200).send({
      success: true,
      data: result.items.map((u) => ({
        id: u.id,
        email: u.email,
        firstName: u.firstName,
        lastName: u.lastName,
        role: u.role,
        accountStatus: u.accountStatus,
        emailVerified: u.emailVerified,
        createdAt: u.createdAt,
      })),
      pagination: {
        total: result.total,
        limit: query.limit,
        offset: query.offset,
      },
    });
  });

  // 2. POST /api/v1/users/invite - Invitar a un nuevo usuario (Requiere users:invite verificado contra BD)
  fastify.post('/invite', { preHandler: authGuard.requirePermission('users:invite', true) }, async (request, reply) => {
    const body = InviteUserBodySchema.parse(request.body);
    const context = getContext(request);
    const inviterId = request.user!.sub;

    const result = await invitationService.inviteUser(
      {
        email: body.email,
        firstName: body.firstName,
        lastName: body.lastName,
        role: body.role,
        invitedByUserId: inviterId,
      }
    );

    return reply.status(201).send({
      success: true,
      data: {
        invitationId: result.user.id,
        userId: result.user.id,
        email: result.user.email,
        role: result.user.role,
        expiresAt: result.expiresAt,
        invitationToken: result.rawInvitationToken,
      },
    });
  });

  // 3. PATCH /api/v1/users/:id/role - Modificar rol de usuario (Requiere users:change_role verificado contra BD)
  fastify.patch('/:id/role', { preHandler: authGuard.requirePermission('users:change_role', true) }, async (request, reply) => {
    const params = UserIdParamSchema.parse(request.params);
    const body = ChangeUserRoleBodySchema.parse(request.body);
    const context = getContext(request);
    const operatorId = request.user!.sub;

    const targetUser = await userRepo.findById(params.id);
    if (!targetUser) {
      throw new NotFoundError(`Usuario con ID ${params.id} no encontrado.`);
    }

    // Un usuario no puede alterar su propio rol directamente para prevenir escalación
    if (params.id === operatorId) {
      throw new ForbiddenError('No puede modificar su propio rol.');
    }

    const previousRole = targetUser.role;
    const updatedUser = await userRepo.update(params.id, {
      role: body.role,
      tokenVersion: targetUser.tokenVersion + 1, // Invalida tokens previos
    });

    // Revocar sesiones activas del usuario para forzar re-login con nuevo rol
    await refreshTokenRepo.revokeAllForUser(params.id);

    await auditService.log({
      eventType: 'ROLE_CHANGED',
      userId: operatorId,
      resource: `user:${params.id}`,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      metadata: {
        targetUserId: params.id,
        previousRole,
        newRole: body.role,
      },
    });

    return reply.status(200).send({
      success: true,
      data: {
        id: updatedUser.id,
        email: updatedUser.email,
        role: updatedUser.role,
      },
    });
  });

  // 4. POST /api/v1/users/:id/disable - Deshabilitar usuario (Requiere users:disable verificado contra BD)
  fastify.post('/:id/disable', { preHandler: authGuard.requirePermission('users:disable', true) }, async (request, reply) => {
    const params = UserIdParamSchema.parse(request.params);
    const context = getContext(request);
    const operatorId = request.user!.sub;

    const targetUser = await userRepo.findById(params.id);
    if (!targetUser) {
      throw new NotFoundError(`Usuario con ID ${params.id} no encontrado.`);
    }

    if (params.id === operatorId) {
      throw new ForbiddenError('No puede deshabilitar su propia cuenta.');
    }

    const updatedUser = await userRepo.update(params.id, {
      accountStatus: 'SUSPENDED',
      tokenVersion: targetUser.tokenVersion + 1,
    });

    await refreshTokenRepo.revokeAllForUser(params.id);

    await auditService.log({
      eventType: 'USER_DISABLED',
      userId: operatorId,
      resource: `user:${params.id}`,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      metadata: {
        targetUserId: params.id,
        previousStatus: targetUser.accountStatus,
      },
    });

    return reply.status(200).send({
      success: true,
      message: `Usuario ${updatedUser.email} deshabilitado exitosamente.`,
    });
  });
};
