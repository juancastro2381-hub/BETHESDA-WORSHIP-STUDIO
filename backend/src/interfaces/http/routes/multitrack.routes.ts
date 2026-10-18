/**
 * @file multitrack.routes.ts
 * @description Endpoints RESTful para la gestión, mezcla y verificación offline de sesiones multipista (Fase 3C / R1-A).
 */

import type { FastifyPluginAsync } from 'fastify';
import { env } from '../../../config/env.ts';
import { DrizzleMultitrackRepository } from '../../../repositories/multitrack-repository.ts';
import { DrizzleAudioRepository } from '../../../repositories/audio-repository.ts';
import { DrizzleSongRepository } from '../../../repositories/song-repository.ts';
import { DrizzleUserRepository } from '../../../repositories/user-repository.ts';
import { MultitrackService } from '../../../application/multitrack-service.ts';
import { AuthGuard } from '../middlewares/auth-middleware.ts';
import { JwtTokenService } from '../../../application/token-service.ts';
import { ForbiddenError, UnauthorizedError, NotFoundError } from '../../../domain/errors.ts';
import { ROLE_PERMISSIONS, type Permission, type UserRole } from '../../../domain/auth-types.ts';
import {
  CreateMultitrackSessionBodySchema,
  UpdateTrackMixBodySchema,
  SessionIdParamSchema,
  SongIdParamSchema,
  TrackMixParamSchema,
  OfflineStatusQuerySchema,
} from '../schemas/multitrack.schemas.ts';

export const multitrackRoutes: FastifyPluginAsync = async (fastify) => {
  const tokenService = new JwtTokenService(env.JWT_SECRET, env.JWT_ACCESS_EXPIRES_IN);
  const userRepo = new DrizzleUserRepository();
  const authGuard = new AuthGuard(tokenService, userRepo);

  const audioRepo = new DrizzleAudioRepository();
  const songRepo = new DrizzleSongRepository();
  const multitrackRepo = new DrizzleMultitrackRepository();
  const multitrackService = new MultitrackService(audioRepo, songRepo, multitrackRepo);

  /**
   * Helper de seguridad R1-A: Valida que el usuario autenticado siga activo en la base de datos
   * y mantenga los permisos requeridos vigentes (previene el uso de tokens JWT obsoletos tras revocación).
   */
  const assertFreshActiveUser = async (userId: string, requiredPermission?: Permission) => {
    const freshUser = await userRepo.findById(userId);
    if (!freshUser) {
      throw new UnauthorizedError('Usuario no encontrado o sesión revocada.');
    }
    if (freshUser.accountStatus !== 'ACTIVE') {
      throw new ForbiddenError(
        `Su cuenta se encuentra en estado '${freshUser.accountStatus}'. Operación denegada.`
      );
    }
    if (freshUser.lockoutUntil && freshUser.lockoutUntil.getTime() > Date.now()) {
      throw new ForbiddenError('La cuenta se encuentra temporalmente bloqueada por seguridad.');
    }
    if (requiredPermission) {
      const activePermissions = ROLE_PERMISSIONS[freshUser.role as UserRole] || [];
      if (!activePermissions.includes(requiredPermission)) {
        throw new ForbiddenError(
          `Permisos insuficientes: el rol actual '${freshUser.role}' no dispone del permiso requerido '${requiredPermission}'.`
        );
      }
    }
    return freshUser;
  };

  // 1. POST /api/v1/multitrack/sessions - Crear sesión multipista con stems vinculados
  fastify.post(
    '/sessions',
    {
      preHandler: [authGuard.requirePermission('songs:update_draft')],
    },
    async (request, reply) => {
      const user = request.user!;
      await assertFreshActiveUser(user.sub, 'songs:update_draft');

      const body = CreateMultitrackSessionBodySchema.parse(request.body);

      const session = await multitrackService.createSession(
        {
          songId: body.songId,
          title: body.title,
          durationSeconds: body.durationSeconds ?? 0,
          bpm: body.bpm ?? 120,
          tracks: body.tracks,
        },
        user.sub
      );

      return reply.status(201).send({
        data: session,
      });
    }
  );

  // 2. GET /api/v1/multitrack/sessions/:sessionId - Obtener sesión y sus stems
  fastify.get(
    '/sessions/:sessionId',
    {
      preHandler: [authGuard.requirePermission('songs:read')],
    },
    async (request, reply) => {
      const user = request.user!;
      await assertFreshActiveUser(user.sub, 'songs:read');

      const { sessionId } = SessionIdParamSchema.parse(request.params);
      const session = await multitrackService.getSession(sessionId);

      return reply.status(200).send({
        data: session,
      });
    }
  );

  // 3. GET /api/v1/multitrack/by-song/:songId - Listar sesiones multipista de una canción
  fastify.get(
    '/by-song/:songId',
    {
      preHandler: [authGuard.requirePermission('songs:read')],
    },
    async (request, reply) => {
      const user = request.user!;
      await assertFreshActiveUser(user.sub, 'songs:read');

      const { songId } = SongIdParamSchema.parse(request.params);
      const sessions = await multitrackService.getSessionsBySongId(songId);

      return reply.status(200).send({
        data: sessions,
      });
    }
  );

  // 4. PATCH /api/v1/multitrack/sessions/:sessionId/tracks/:trackId - Modificar mezcla de una pista
  fastify.patch(
    '/sessions/:sessionId/tracks/:trackId',
    {
      preHandler: [authGuard.requirePermission('songs:update_draft')],
    },
    async (request, reply) => {
      const user = request.user!;
      await assertFreshActiveUser(user.sub, 'songs:update_draft');

      const { sessionId, trackId } = TrackMixParamSchema.parse(request.params);
      const updates = UpdateTrackMixBodySchema.parse(request.body);

      const updatedTrack = await multitrackService.updateTrackMix(sessionId, trackId, updates);

      return reply.status(200).send({
        data: updatedTrack,
      });
    }
  );

  // 5. DELETE /api/v1/multitrack/sessions/:sessionId - Eliminar sesión multipista
  fastify.delete(
    '/sessions/:sessionId',
    {
      preHandler: [authGuard.requirePermission('songs:update_draft')],
    },
    async (request, reply) => {
      const user = request.user!;
      await assertFreshActiveUser(user.sub, 'songs:update_draft');

      const { sessionId } = SessionIdParamSchema.parse(request.params);
      const deleted = await multitrackService.deleteSession(sessionId);

      if (!deleted) {
        throw new NotFoundError('Sesión multipista', sessionId);
      }

      return reply.status(204).send();
    }
  );

  // 6. GET /api/v1/multitrack/sessions/:sessionId/offline-status - Verificar completitud offline
  fastify.get(
    '/sessions/:sessionId/offline-status',
    {
      preHandler: [authGuard.requirePermission('songs:read')],
    },
    async (request, reply) => {
      const user = request.user!;
      await assertFreshActiveUser(user.sub, 'songs:read');

      const { sessionId } = SessionIdParamSchema.parse(request.params);
      const query = OfflineStatusQuerySchema.parse(request.query);

      const availableAssets = query.availableAssets
        ? query.availableAssets.split(',').map((id) => id.trim()).filter(Boolean)
        : [];

      const status = await multitrackService.checkOfflineCompleteness(sessionId, availableAssets);

      return reply.status(200).send({
        data: status,
      });
    }
  );
};
