/**
 * @file auth.routes.ts
 * @description Rutas HTTP de autenticación, refresco de sesiones, restablecimiento de contraseña e invitaciones (Fase 2B).
 */

import type { FastifyPluginAsync } from 'fastify';
import { env } from '../../../config/env.ts';
import {
  LoginBodySchema,
  AcceptInviteBodySchema,
  ForgotPasswordBodySchema,
  ResetPasswordBodySchema,
  ChangeInitialPasswordBodySchema,
} from '../schemas/auth.schemas.ts';
import { AuthService } from '../../../application/auth-service.ts';
import { UserInvitationService } from '../../../application/invitation-service.ts';
import { PasswordResetService } from '../../../application/password-reset-service.ts';
import { DrizzleUserRepository } from '../../../repositories/user-repository.ts';
import { DrizzleRefreshTokenRepository } from '../../../repositories/refresh-token-repository.ts';
import { DrizzlePasswordResetTokenRepository } from '../../../repositories/password-reset-repository.ts';
import { DrizzleUserInvitationRepository } from '../../../repositories/user-invitation-repository.ts';
import { DrizzleAuditLogRepository } from '../../../repositories/audit-repository.ts';
import { Argon2PasswordHasher } from '../../../domain/crypto/password-hasher.ts';
import { JwtTokenService } from '../../../application/token-service.ts';
import { AuditService } from '../../../application/audit-service.ts';
import { defaultRateLimiter } from '../middlewares/rate-limiter.ts';
import { AuthGuard } from '../middlewares/auth-middleware.ts';
import { UnauthorizedError } from '../../../domain/errors.ts';

export const authRoutes: FastifyPluginAsync = async (fastify) => {
  // Inicializar componentes del grafo de dependencias
  const userRepo = new DrizzleUserRepository();
  const refreshTokenRepo = new DrizzleRefreshTokenRepository();
  const resetTokenRepo = new DrizzlePasswordResetTokenRepository();
  const invitationRepo = new DrizzleUserInvitationRepository();
  const auditRepo = new DrizzleAuditLogRepository();

  const hasher = new Argon2PasswordHasher({
    memoryCost: env.ARGON2_MEMORY_COST,
    timeCost: env.ARGON2_TIME_COST,
    parallelism: env.ARGON2_PARALLELISM,
  });

  const tokenService = new JwtTokenService(env.JWT_SECRET, env.JWT_ACCESS_EXPIRES_IN);
  const auditService = new AuditService(auditRepo);

  const authService = new AuthService(
    userRepo,
    refreshTokenRepo,
    hasher,
    tokenService,
    auditService
  );

  const invitationService = new UserInvitationService(
    userRepo,
    invitationRepo,
    hasher,
    auditService
  );

  const passwordResetService = new PasswordResetService(
    userRepo,
    resetTokenRepo,
    refreshTokenRepo,
    hasher,
    auditService
  );

  const authGuard = new AuthGuard(tokenService, userRepo);

  const cookieOptions = {
    path: '/api/v1/auth',
    httpOnly: true,
    secure: env.NODE_ENV === 'production',
    sameSite: 'strict' as const,
    maxAge: env.REFRESH_TOKEN_EXPIRES_IN_DAYS * 24 * 60 * 60,
  };

  // Helper para contexto de auditoría/red
  const getContext = (request: any) => ({
    ipAddress: request.ip || request.socket.remoteAddress || '127.0.0.1',
    userAgent: request.headers['user-agent'] as string | undefined,
  });

  // 1. POST /api/v1/auth/login
  fastify.post('/login', { preHandler: defaultRateLimiter.preHandler() }, async (request, reply) => {
    const body = LoginBodySchema.parse(request.body);
    const context = getContext(request);

    try {
      const result = await authService.login(body.email, body.password, context);
      defaultRateLimiter.resetAccountFailures(body.email);

      // Inyectar cookie HttpOnly (el token de refresco jamás viaja en el cuerpo JSON)
      reply.setCookie('bethesda_refresh_token', result.refreshToken, cookieOptions);

      return reply.status(200).send({
        success: true,
        data: {
          accessToken: result.accessToken,
          expiresIn: result.expiresIn,
          user: result.user,
        },
      });
    } catch (err) {
      defaultRateLimiter.recordAccountFailedAttempt(body.email);
      throw err;
    }
  });

  // 2. POST /api/v1/auth/refresh
  fastify.post('/refresh', async (request, reply) => {
    const rawRefreshToken = request.cookies.bethesda_refresh_token;
    const context = getContext(request);

    if (!rawRefreshToken) {
      throw new UnauthorizedError('Cookie de refresco ausente o inválida.');
    }

    try {
      const result = await authService.refresh(rawRefreshToken, context);

      // Rotar la cookie con el nuevo token de refresco
      reply.setCookie('bethesda_refresh_token', result.refreshToken, cookieOptions);

      return reply.status(200).send({
        success: true,
        data: {
          accessToken: result.accessToken,
          expiresIn: result.expiresIn,
          user: result.user,
        },
      });
    } catch (err: any) {
      // Si se detecta reuso fraudulento u otro error, limpiar la cookie inmediatamente
      reply.clearCookie('bethesda_refresh_token', { path: '/api/v1/auth' });
      throw err;
    }
  });

  // 3. POST /api/v1/auth/logout
  fastify.post('/logout', async (request, reply) => {
    const rawRefreshToken = request.cookies.bethesda_refresh_token;
    const userId = request.user?.sub ?? null;
    const context = getContext(request);

    if (rawRefreshToken) {
      try {
        await authService.logout(rawRefreshToken, userId, context);
      } catch {
        // Silenciar error en logout para no bloquear la limpieza del cliente
      }
    }

    reply.clearCookie('bethesda_refresh_token', { path: '/api/v1/auth' });
    return reply.status(200).send({
      success: true,
      message: 'Sesión finalizada exitosamente.',
    });
  });

  // 4. POST /api/v1/auth/accept-invite
  fastify.post('/accept-invite', async (request, reply) => {
    const body = AcceptInviteBodySchema.parse(request.body);

    await invitationService.acceptInvitation(body.token, body.password);

    return reply.status(200).send({
      success: true,
      message: 'Invitación aceptada y cuenta activada exitosamente.',
    });
  });

  // 5. POST /api/v1/auth/forgot-password (Respuesta Anti-Enumeración)
  fastify.post(
    '/forgot-password',
    { preHandler: defaultRateLimiter.preHandler() },
    async (request, reply) => {
      const body = ForgotPasswordBodySchema.parse(request.body);
      const context = getContext(request);

      await passwordResetService.requestPasswordReset(body.email, context);

      // Siempre 200 OK con mensaje neutro para evitar enumeración de cuentas
      return reply.status(200).send({
        success: true,
        message: 'Si la cuenta existe, se ha enviado un enlace de recuperación.',
      });
    }
  );

  // 6. POST /api/v1/auth/reset-password
  fastify.post('/reset-password', async (request, reply) => {
    const body = ResetPasswordBodySchema.parse(request.body);
    const context = getContext(request);

    await passwordResetService.resetPassword(body.token, body.newPassword, context);

    // Limpiar cualquier cookie de sesión activa
    reply.clearCookie('bethesda_refresh_token', { path: '/api/v1/auth' });

    return reply.status(200).send({
      success: true,
      message: 'Contraseña restablecida exitosamente. Todas las sesiones previas han sido revocadas.',
    });
  });

  // 7. POST /api/v1/auth/change-initial-password (Para cuentas en MUST_CHANGE_PASSWORD)
  fastify.post('/change-initial-password', { preHandler: authGuard.requireAuth }, async (request, reply) => {
    const body = ChangeInitialPasswordBodySchema.parse(request.body);
    const context = getContext(request);
    const userId = request.user!.sub;

    await authService.changeInitialPassword(userId, body.currentPassword, body.newPassword, context);

    return reply.status(200).send({
      success: true,
      message: 'Contraseña inicial actualizada con éxito. Su cuenta ahora está completamente activa.',
    });
  });

  // 8. GET /api/v1/auth/me (Perfil del usuario autenticado)
  fastify.get('/me', { preHandler: authGuard.requireAuth }, async (request, reply) => {
    const userId = request.user!.sub;
    const user = await userRepo.findById(userId);

    if (!user) {
      throw new UnauthorizedError('Usuario no encontrado.');
    }

    return reply.status(200).send({
      success: true,
      data: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
        accountStatus: user.accountStatus,
        emailVerified: user.emailVerified,
      },
    });
  });
};
