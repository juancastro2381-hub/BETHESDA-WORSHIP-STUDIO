/**
 * @file realtime.routes.ts
 * @description Rutas HTTP y stream SSE para el Flujo Litúrgico en Tiempo Real (Fase 3B).
 *
 * Proporciona:
 * - Creación y recuperación de sesiones de atril en vivo.
 * - Conexión Server-Sent Events (SSE) con difusión en tiempo real.
 * - Despacho de comandos litúrgicos con orden secuencial estricto, idempotencia y RBAC.
 * - Heartbeat y sincronización completa ante reconexión.
 */

import type { FastifyPluginAsync } from 'fastify';
import { env } from '../../../config/env.ts';
import {
  CreateRealtimeSessionBodySchema,
  RealtimeActionBodySchema,
  RealtimeSessionParamSchema,
  RealtimeStreamQuerySchema,
} from '../schemas/realtime.schemas.ts';
import { globalRealtimeSessionManager } from '../../../application/realtime-session-manager.ts';
import { DrizzleSetlistRepository } from '../../../repositories/setlist-repository.ts';
import { DrizzleUserRepository } from '../../../repositories/user-repository.ts';
import { JwtTokenService } from '../../../application/token-service.ts';
import { AuthGuard } from '../middlewares/auth-middleware.ts';
import { NotFoundError, ForbiddenError, UnauthorizedError } from '../../../domain/errors.ts';
import { globalStreamTicketService } from '../../../application/stream-ticket-service.ts';

export const realtimeRoutes: FastifyPluginAsync = async (fastify) => {
  const setlistRepo = new DrizzleSetlistRepository();
  const userRepo = new DrizzleUserRepository();
  const tokenService = new JwtTokenService(env.JWT_SECRET, env.JWT_ACCESS_EXPIRES_IN);
  const authGuard = new AuthGuard(tokenService, userRepo);

  /**
   * Valida en tiempo real la frescura de la autorización contra PostgreSQL (R1-A).
   * Impide que usuarios suspendidos, dados de baja o con rol revocado utilicen tokens vigentes.
   */
  async function assertFreshActiveUser(userId: string) {
    const dbUser = await userRepo.findById(userId);
    if (!dbUser) {
      throw new UnauthorizedError('Usuario no encontrado o dado de baja en la base de datos.');
    }
    if (dbUser.accountStatus !== 'ACTIVE') {
      throw new ForbiddenError(
        `Su cuenta se encuentra en estado '${dbUser.accountStatus}'. Operación litúrgica denegada.`
      );
    }
    if (dbUser.lockoutUntil && dbUser.lockoutUntil.getTime() > Date.now()) {
      throw new ForbiddenError('La cuenta se encuentra temporalmente bloqueada por seguridad.');
    }
    return dbUser;
  }

  // ==========================================================================
  // 1. POST /api/v1/realtime/sessions - Crear o recuperar sesión en vivo
  // ==========================================================================
  fastify.post(
    '/sessions',
    { preHandler: authGuard.requirePermission('setlists:read', false) },
    async (request, reply) => {
      const body = CreateRealtimeSessionBodySchema.parse(request.body);
      const user = request.user!;

      // 1. Validación de frescura en base de datos autoritativa (R1-A)
      const dbUser = await assertFreshActiveUser(user.sub);

      // 2. Validar que el setlist exista en Postgres
      const setlist = await setlistRepo.findById(body.setlistId);
      if (!setlist) {
        throw new NotFoundError('Setlist', body.setlistId);
      }

      // 3. Validar autorización de anfitrión litúrgico usando el rol AUTORITATIVO de PostgreSQL (R1-A):
      // Si el usuario fue degradado en DB (ej. a MUSICIAN o VIEWER), se rechaza de inmediato.
      const isLeaderOrAdmin =
        dbUser.role === 'ADMIN' ||
        dbUser.role === 'SUPER_ADMIN' ||
        dbUser.role === 'WORSHIP_LEADER';
      const isDesignatedDirector = setlist.directorUserId === dbUser.id;

      if (!isLeaderOrAdmin && !isDesignatedDirector) {
        throw new ForbiddenError(
          'No posee privilegios suficientes para iniciar o dirigir una sesión litúrgica en vivo (requiere ser director de alabanza o administrador).'
        );
      }

      const hostUser = {
        id: dbUser.id,
        name: dbUser.email.split('@')[0],
        role: dbUser.role,
      };

      const session = globalRealtimeSessionManager.createOrGetSession(
        setlist.id,
        setlist.title,
        hostUser,
        body.initialItemIndex
      );

      return reply.status(200).send({
        data: session.toSnapshot(),
      });
    }
  );

  // ==========================================================================
  // 2. GET /api/v1/realtime/sessions/by-setlist/:setlistId - Buscar sesión activa
  // ==========================================================================
  fastify.get(
    '/sessions/by-setlist/:setlistId',
    { preHandler: authGuard.requirePermission('setlists:read', false) },
    async (request, reply) => {
      const { setlistId } = request.params as { setlistId: string };
      await assertFreshActiveUser(request.user!.sub);

      const setlist = await setlistRepo.findById(setlistId);
      if (!setlist) {
        throw new NotFoundError('Setlist', setlistId);
      }

      const session = globalRealtimeSessionManager.getSessionBySetlistId(setlistId);
      if (!session) {
        throw new NotFoundError('Sesión en vivo para setlist', setlistId);
      }

      return reply.status(200).send({
        data: session.toSnapshot(),
      });
    }
  );

  // ==========================================================================
  // 3. GET /api/v1/realtime/sessions/:sessionId - Snapshot de estado
  // ==========================================================================
  fastify.get(
    '/sessions/:sessionId',
    { preHandler: authGuard.requirePermission('setlists:read', false) },
    async (request, reply) => {
      const { sessionId } = RealtimeSessionParamSchema.parse(request.params);
      await assertFreshActiveUser(request.user!.sub);

      const session = globalRealtimeSessionManager.getSession(sessionId);

      // Validar acceso y existencia del setlist subyacente
      const setlist = await setlistRepo.findById(session.setlistId);
      if (!setlist) {
        throw new NotFoundError('Setlist de la sesión', session.setlistId);
      }

      return reply.status(200).send({
        data: session.toSnapshot(),
      });
    }
  );

  // ==========================================================================
  // 4. POST /api/v1/realtime/sessions/:sessionId/join - Unirse como participante
  // ==========================================================================
  fastify.post(
    '/sessions/:sessionId/join',
    { preHandler: authGuard.requirePermission('setlists:read', false) },
    async (request, reply) => {
      const { sessionId } = RealtimeSessionParamSchema.parse(request.params);
      const user = request.user!;
      const dbUser = await assertFreshActiveUser(user.sub);

      const session = globalRealtimeSessionManager.getSession(sessionId);
      const setlist = await setlistRepo.findById(session.setlistId);
      if (!setlist) {
        throw new NotFoundError('Setlist de la sesión', session.setlistId);
      }

      const snapshot = globalRealtimeSessionManager.joinSession(sessionId, {
        id: dbUser.id,
        name: dbUser.email.split('@')[0],
        role: dbUser.role,
      });

      return reply.status(200).send({
        data: snapshot,
      });
    }
  );

  // ==========================================================================
  // 5. POST /api/v1/realtime/sessions/:sessionId/leave - Salir de la sesión
  // ==========================================================================
  fastify.post(
    '/sessions/:sessionId/leave',
    { preHandler: authGuard.requirePermission('setlists:read', false) },
    async (request, reply) => {
      const { sessionId } = RealtimeSessionParamSchema.parse(request.params);
      const user = request.user!;

      globalRealtimeSessionManager.leaveSession(sessionId, user.sub);

      return reply.status(200).send({
        ok: true,
      });
    }
  );

  // ==========================================================================
  // 6. POST /api/v1/realtime/sessions/:sessionId/heartbeat - Heartbeat de presencia
  // ==========================================================================
  fastify.post(
    '/sessions/:sessionId/heartbeat',
    { preHandler: authGuard.requirePermission('setlists:read', false) },
    async (request, reply) => {
      const { sessionId } = RealtimeSessionParamSchema.parse(request.params);
      const user = request.user!;
      await assertFreshActiveUser(user.sub);

      const result = globalRealtimeSessionManager.heartbeat(sessionId, user.sub);

      return reply.status(200).send(result);
    }
  );

  // ==========================================================================
  // 7. POST /api/v1/realtime/sessions/:sessionId/actions - Despachar comando litúrgico
  // ==========================================================================
  fastify.post(
    '/sessions/:sessionId/actions',
    { preHandler: authGuard.requirePermission('setlists:read', false) },
    async (request, reply) => {
      const { sessionId } = RealtimeSessionParamSchema.parse(request.params);
      const action = RealtimeActionBodySchema.parse(request.body);
      const user = request.user!;

      // Validación autoritativa en Postgres: rol y estado fresco (R1-A)
      const dbUser = await assertFreshActiveUser(user.sub);

      const session = globalRealtimeSessionManager.getSession(sessionId);
      const setlist = await setlistRepo.findById(session.setlistId);
      if (!setlist) {
        throw new NotFoundError('Setlist de la sesión', session.setlistId);
      }

      // Despachar acción utilizando el rol autoritativo en base de datos
      const result = globalRealtimeSessionManager.dispatchAction(
        sessionId,
        { id: dbUser.id, role: dbUser.role },
        action
      );

      return reply.status(200).send({
        data: result,
      });
    }
  );

  // ==========================================================================
  // 8. POST /api/v1/realtime/sessions/:sessionId/ticket - Emitir ticket SSE seguro
  // ==========================================================================
  fastify.post(
    '/sessions/:sessionId/ticket',
    { preHandler: authGuard.requirePermission('setlists:read', false) },
    async (request, reply) => {
      const { sessionId } = RealtimeSessionParamSchema.parse(request.params);
      const user = request.user!;

      // 1. Validar frescura del usuario en base de datos (R1-A)
      const dbUser = await assertFreshActiveUser(user.sub);

      // 2. Validar que la sesión exista
      const session = globalRealtimeSessionManager.getSession(sessionId);

      // 3. Validar que el setlist exista y sea accesible
      const setlist = await setlistRepo.findById(session.setlistId);
      if (!setlist) {
        throw new NotFoundError('Setlist de la sesión', session.setlistId);
      }

      const ticket = globalStreamTicketService.issueTicket({
        userId: dbUser.id,
        role: dbUser.role,
        resourceId: session.sessionId,
        purpose: 'SSE_STREAM',
      });

      return reply.status(200).send({
        data: {
          ticket,
          expiresInSeconds: 60,
        },
      });
    }
  );

  // ==========================================================================
  // 9. GET /api/v1/realtime/sessions/:sessionId/stream - Canal SSE en vivo
  // ==========================================================================
  fastify.get(
    '/sessions/:sessionId/stream',
    async (request, reply) => {
      const { sessionId } = RealtimeSessionParamSchema.parse(request.params);
      const query = RealtimeStreamQuerySchema.parse(request.query);

      let authenticatedUserId: string | null = null;
      let authenticatedRole: string | null = null;

      // 1. Probar autenticación por ticket seguro de un solo uso (SSE estándar navegador)
      if (query.ticket) {
        const ticketData = globalStreamTicketService.consumeTicket({
          ticket: query.ticket,
          resourceId: sessionId,
          purpose: 'SSE_STREAM',
        });
        authenticatedUserId = ticketData.userId;
        authenticatedRole = ticketData.role;
      } else {
        // 2. Probar encabezado Authorization Bearer estándar (clientes que admiten headers)
        await authGuard.authenticate(request, reply);
        if (request.user) {
          authenticatedUserId = request.user.sub;
          authenticatedRole = request.user.role;
        }
      }

      if (!authenticatedUserId || !authenticatedRole) {
        throw new UnauthorizedError(
          'Autenticación requerida para acceder al flujo SSE. Provea un ticket de transmisión o encabezado Bearer.'
        );
      }

      // Validar frescura y vigencia autoritativa del usuario en PostgreSQL (R1-A)
      await assertFreshActiveUser(authenticatedUserId);

      const session = globalRealtimeSessionManager.getSession(sessionId);
      const setlist = await setlistRepo.findById(session.setlistId);
      if (!setlist) {
        throw new NotFoundError('Setlist de la sesión', session.setlistId);
      }

      // Configurar encabezados HTTP estándar para Server-Sent Events
      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no', // Evitar buffering en NGINX
      });

      // 1. Enviar snapshot inicial inmediato para sincronización completa
      const snapshot = session.toSnapshot();
      reply.raw.write(`event: snapshot\ndata: ${JSON.stringify(snapshot)}\n\n`);

      if (request.headers['x-test-close'] === 'true') {
        reply.raw.end();
        return;
      }

      // 2. Suscribir socket al difusor de eventos de la sesión
      const unsubscribe = globalRealtimeSessionManager.subscribe(session.sessionId, (event) => {
        reply.raw.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
      });

      // 3. Heartbeat periódico para mantener conexión HTTP activa
      const keepAliveTimer = setInterval(() => {
        try {
          reply.raw.write(': ping\n\n');
        } catch {
          clearInterval(keepAliveTimer);
          unsubscribe();
        }
      }, 15000);

      // 4. Limpieza ante desconexión del cliente
      request.raw.on('close', () => {
        clearInterval(keepAliveTimer);
        unsubscribe();
      });

      // Evitar que Fastify intente cerrar el reply
      return reply;
    }
  );
};
