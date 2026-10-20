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
      status: query.status,
      search: query.search,
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

    const operator = await userRepo.findById(inviterId);
    if (!operator) {
      throw new NotFoundError('Operador no encontrado.');
    }

    // Regla de escalación: Solo SUPER_ADMIN puede invitar a otro SUPER_ADMIN
    if (operator.role !== 'SUPER_ADMIN' && body.role === 'SUPER_ADMIN') {
      throw new ForbiddenError('Solo un Super Administrador puede invitar a usuarios con el rol SUPER_ADMIN.');
    }

    const result = await invitationService.inviteUser({
      email: body.email,
      firstName: body.firstName,
      lastName: body.lastName,
      role: body.role,
      invitedByUserId: inviterId,
    });

    return reply.status(201).send({
      success: true,
      data: {
        invitationId: result.user.id,
        userId: result.user.id,
        email: result.user.email,
        role: result.user.role,
        expiresAt: result.expiresAt,
        invitationToken: result.rawInvitationToken,
        deliveryStatus: result.deliveryStatus,
        deliveryMessage: result.deliveryMessage,
      },
    });
  });

  // 3. POST /api/v1/users/:id/resend-invite - Reenviar invitación (Requiere users:invite)
  fastify.post('/:id/resend-invite', { preHandler: authGuard.requirePermission('users:invite', true) }, async (request, reply) => {
    const params = UserIdParamSchema.parse(request.params);
    const inviterId = request.user!.sub;

    const operator = await userRepo.findById(inviterId);
    if (!operator) {
      throw new NotFoundError('Operador no encontrado.');
    }

    const targetUser = await userRepo.findById(params.id);
    if (!targetUser) {
      throw new NotFoundError(`Usuario con ID ${params.id} no encontrado.`);
    }

    if (operator.role !== 'SUPER_ADMIN' && targetUser.role === 'SUPER_ADMIN') {
      throw new ForbiddenError('Los administradores no tienen autorización para gestionar invitaciones de Super Administradores.');
    }

    const result = await invitationService.resendInvitation(params.id, inviterId);

    return reply.status(200).send({
      success: true,
      data: {
        userId: result.user.id,
        email: result.user.email,
        role: result.user.role,
        expiresAt: result.expiresAt,
        invitationToken: result.rawInvitationToken,
        deliveryStatus: result.deliveryStatus,
        deliveryMessage: result.deliveryMessage,
      },
    });
  });

  // 4. PATCH /api/v1/users/:id/role - Modificar rol de usuario (Requiere users:change_role verificado contra BD)
  fastify.patch('/:id/role', { preHandler: authGuard.requirePermission('users:change_role', true) }, async (request, reply) => {
    const params = UserIdParamSchema.parse(request.params);
    const body = ChangeUserRoleBodySchema.parse(request.body);
    const context = getContext(request);
    const operatorId = request.user!.sub;

    const targetUser = await userRepo.findById(params.id);
    if (!targetUser) {
      throw new NotFoundError(`Usuario con ID ${params.id} no encontrado.`);
    }

    // Un usuario no puede alterar su propio rol directamente para prevenir escalación o despojo involuntario
    if (params.id === operatorId) {
      throw new ForbiddenError('No puede modificar su propio rol.');
    }

    const operator = await userRepo.findById(operatorId);
    if (!operator) {
      throw new NotFoundError('Operador no encontrado.');
    }

    // Un ADMIN no puede ascender a SUPER_ADMIN ni modificar a un SUPER_ADMIN
    if (operator.role !== 'SUPER_ADMIN') {
      if (body.role === 'SUPER_ADMIN') {
        throw new ForbiddenError('Solo un Super Administrador puede asignar el rol SUPER_ADMIN.');
      }
      if (targetUser.role === 'SUPER_ADMIN') {
        throw new ForbiddenError('Los administradores no tienen autorización para modificar el rol de un Super Administrador.');
      }
    }

    // Protección del último Super Administrador activo de la congregación
    if (targetUser.role === 'SUPER_ADMIN' && body.role !== 'SUPER_ADMIN') {
      const activeSuperAdmins = await userRepo.countActiveSuperAdmins();
      if (activeSuperAdmins <= 1) {
        throw new ForbiddenError(
          'Operación denegada: no es posible revocar el rol al único Super Administrador activo del sistema.'
        );
      }
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

  // 5. POST /api/v1/users/:id/disable - Deshabilitar/Suspender usuario (Requiere users:disable)
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

    const operator = await userRepo.findById(operatorId);
    if (!operator) {
      throw new NotFoundError('Operador no encontrado.');
    }

    if (operator.role !== 'SUPER_ADMIN' && targetUser.role === 'SUPER_ADMIN') {
      throw new ForbiddenError('Los administradores no tienen autorización para deshabilitar a un Super Administrador.');
    }

    // Protección del último Super Administrador activo
    if (targetUser.role === 'SUPER_ADMIN') {
      const activeSuperAdmins = await userRepo.countActiveSuperAdmins();
      if (activeSuperAdmins <= 1) {
        throw new ForbiddenError(
          'Operación denegada: no es posible deshabilitar al único Super Administrador activo del sistema.'
        );
      }
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

  // 6. POST /api/v1/users/:id/enable - Reactivar usuario suspendido (Requiere users:disable)
  fastify.post('/:id/enable', { preHandler: authGuard.requirePermission('users:disable', true) }, async (request, reply) => {
    const params = UserIdParamSchema.parse(request.params);
    const context = getContext(request);
    const operatorId = request.user!.sub;

    const targetUser = await userRepo.findById(params.id);
    if (!targetUser) {
      throw new NotFoundError(`Usuario con ID ${params.id} no encontrado.`);
    }

    const operator = await userRepo.findById(operatorId);
    if (!operator) {
      throw new NotFoundError('Operador no encontrado.');
    }

    if (operator.role !== 'SUPER_ADMIN' && targetUser.role === 'SUPER_ADMIN') {
      throw new ForbiddenError('Los administradores no tienen autorización para modificar el estado de un Super Administrador.');
    }

    const updatedUser = await userRepo.update(params.id, {
      accountStatus: 'ACTIVE',
      failedLoginAttempts: 0,
      lockoutUntil: null,
      tokenVersion: targetUser.tokenVersion + 1,
    });

    await auditService.log({
      eventType: 'USER_ENABLED',
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
      message: `Usuario ${updatedUser.email} reactivado exitosamente.`,
    });
  });
};
