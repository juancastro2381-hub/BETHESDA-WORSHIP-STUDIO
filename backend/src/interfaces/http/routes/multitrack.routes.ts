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

  /**
   * Helper de autorización a nivel de recurso (Resource-Level Authorization):
   * Enforza la política de compartición y propiedad para sesiones multipistas.
   *
   * Reglas:
   * 1. SUPER_ADMIN y ADMIN: Acceso administrativo total a cualquier sesión del ministerio.
   * 2. Dueño (createdByUserId === user.sub): Acceso total a su propia sesión.
   * 3. Modificaciones (PATCH) y Eliminación (DELETE): Estrictamente restringidas al dueño o a ADMIN/SUPER_ADMIN.
   * 4. Lectura (GET) y Estado Offline:
   *    - Permitido si la sesión es compartida ministerialmente:
   *      a) createdByUserId es null (sesión maestra del sistema).
   *      b) O fue creada por un WORSHIP_LEADER, ADMIN o SUPER_ADMIN (sesión oficial de culto compartida).
   *      c) O el título incluye la etiqueta '[SHARED]' (indicador explícito de compartición con el equipo).
   *    - Denegado (403 Forbidden) si es una sesión privada creada por otro usuario (ej. otro MUSICIAN).
   */
  const assertSessionResourceAccess = async (
    session: any,
    currentUserId: string,
    currentUserRole: string,
    action: 'read' | 'modify' | 'delete' | 'offline'
  ): Promise<void> => {
    // 1. Acceso de administrador total
    if (currentUserRole === 'SUPER_ADMIN' || currentUserRole === 'ADMIN') {
      return;
    }

    // 2. Acceso del creador / dueño de la sesión
    if (session.createdByUserId && session.createdByUserId === currentUserId) {
      return;
    }

    // 3. Mutaciones y borrado: Denegado si no es el dueño ni administrador
    if (action === 'modify' || action === 'delete') {
      throw new ForbiddenError(
        `No tiene autorización para ${action === 'modify' ? 'modificar' : 'eliminar'} una sesión multipista perteneciente a otro usuario.`
      );
    }

    // 4. Lectura y estado offline: Verificar si la sesión califica como compartida
    if (!session.createdByUserId) {
      return; // Sesión de catálogo del sistema (compartida para todo el ministerio)
    }

    // Comprobar si el creador es WORSHIP_LEADER, ADMIN o SUPER_ADMIN
    const creatorUser = await userRepo.findById(session.createdByUserId);
    if (
      creatorUser &&
      (creatorUser.role === 'WORSHIP_LEADER' ||
        creatorUser.role === 'ADMIN' ||
        creatorUser.role === 'SUPER_ADMIN')
    ) {
      return; // Sesión oficial del liderazgo de alabanza disponible para el equipo
    }

    // Si es una sesión privada de otro integrante: Denegado
    // NOTA DE SEGURIDAD: No se infiere autorización a partir del texto del título (ej. '[SHARED]').
    throw new ForbiddenError(
      `No tiene autorización para ${
        action === 'offline' ? 'consultar el estado offline de' : 'acceder a'
      } una sesión multipista privada de otro usuario.`
    );
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

  // 2. GET /api/v1/multitrack/sessions/:sessionId - Obtener sesión y sus stems (con autorización a nivel de recurso)
  fastify.get(
    '/sessions/:sessionId',
    {
      preHandler: [authGuard.requirePermission('songs:read')],
    },
    async (request, reply) => {
      const user = request.user!;
      const freshUser = await assertFreshActiveUser(user.sub, 'songs:read');

      const { sessionId } = SessionIdParamSchema.parse(request.params);
      const session = await multitrackService.getSession(sessionId);

      await assertSessionResourceAccess(session, user.sub, freshUser.role, 'read');

      return reply.status(200).send({
        data: session,
      });
    }
  );

  // 3. GET /api/v1/multitrack/by-song/:songId - Listar sesiones multipista autorizadas de una canción
  fastify.get(
    '/by-song/:songId',
    {
      preHandler: [authGuard.requirePermission('songs:read')],
    },
    async (request, reply) => {
      const user = request.user!;
      const freshUser = await assertFreshActiveUser(user.sub, 'songs:read');

      const { songId } = SongIdParamSchema.parse(request.params);
      const allSessions = await multitrackService.getSessionsBySongId(songId);

      const authorizedSessions: any[] = [];
      for (const s of allSessions) {
        try {
          await assertSessionResourceAccess(s, user.sub, freshUser.role, 'read');
          authorizedSessions.push(s);
        } catch (err) {
          if (err instanceof ForbiddenError || err instanceof UnauthorizedError) {
            // Omitir únicamente denegaciones esperadas de sesiones privadas de otros usuarios
            continue;
          }
          // Propagar errores inesperados de infraestructura o base de datos sin convertirlos en respuestas parciales engañosas
          request.log.error(err, 'Error inesperado durante la verificación de autorización en by-song');
          throw err;
        }
      }

      return reply.status(200).send({
        data: authorizedSessions,
      });
    }
  );

  // 4. PATCH /api/v1/multitrack/sessions/:sessionId/tracks/:trackId - Modificar mezcla de una pista (dueño o admin)
  fastify.patch(
    '/sessions/:sessionId/tracks/:trackId',
    {
      preHandler: [authGuard.requirePermission('songs:update_draft')],
    },
    async (request, reply) => {
      const user = request.user!;
      const freshUser = await assertFreshActiveUser(user.sub, 'songs:update_draft');

      const { sessionId, trackId } = TrackMixParamSchema.parse(request.params);
      const updates = UpdateTrackMixBodySchema.parse(request.body);

      const session = await multitrackService.getSession(sessionId);
      await assertSessionResourceAccess(session, user.sub, freshUser.role, 'modify');

      const updatedTrack = await multitrackService.updateTrackMix(sessionId, trackId, updates);

      return reply.status(200).send({
        data: updatedTrack,
      });
    }
  );

  // 5. DELETE /api/v1/multitrack/sessions/:sessionId - Eliminar sesión multipista (dueño o admin)
  fastify.delete(
    '/sessions/:sessionId',
    {
      preHandler: [authGuard.requirePermission('songs:update_draft')],
    },
    async (request, reply) => {
      const user = request.user!;
      const freshUser = await assertFreshActiveUser(user.sub, 'songs:update_draft');

      const { sessionId } = SessionIdParamSchema.parse(request.params);

      const session = await multitrackService.getSession(sessionId);
      await assertSessionResourceAccess(session, user.sub, freshUser.role, 'delete');

      const deleted = await multitrackService.deleteSession(sessionId);

      if (!deleted) {
        throw new NotFoundError('Sesión multipista', sessionId);
      }

      return reply.status(204).send();
    }
  );

  // 6. GET /api/v1/multitrack/sessions/:sessionId/offline-status - Verificar completitud offline (recurso autorizado)
  fastify.get(
    '/sessions/:sessionId/offline-status',
    {
      preHandler: [authGuard.requirePermission('songs:read')],
    },
    async (request, reply) => {
      const user = request.user!;
      const freshUser = await assertFreshActiveUser(user.sub, 'songs:read');

      const { sessionId } = SessionIdParamSchema.parse(request.params);
      const query = OfflineStatusQuerySchema.parse(request.query);

      const session = await multitrackService.getSession(sessionId);
      await assertSessionResourceAccess(session, user.sub, freshUser.role, 'offline');

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
