/**
 * @file song.routes.ts
 * @description Definición de endpoints RESTful para la gestión y persistencia de canciones y versiones (Fase 2A).
 */

import type { FastifyPluginAsync } from 'fastify';
import { env } from '../../../config/env.ts';
import {
  CompletionProposalParamSchema,
  CompletionRequestBodySchema,
  CreateSongBodySchema,
  CreateVersionBodySchema,
  FormatCapabilitiesQuerySchema,
  ImportSourceBodySchema,
  ListSongsQuerySchema,
  ReviewCompletionProposalBodySchema,
  SongIdParamSchema,
  VersionIdParamSchema,
} from '../schemas/song.schemas.ts';
import { SongService } from '../../../application/song-service.ts';
import { IngestionPersistenceService } from '../../../application/ingestion-persistence-service.ts';
import { MusicalContentCompletionService } from '../../../application/musical-content-completion-service.ts';
import { DrizzleSongRepository } from '../../../repositories/song-repository.ts';
import { DrizzleSongVersionRepository } from '../../../repositories/version-repository.ts';
import { DrizzleUserRepository } from '../../../repositories/user-repository.ts';
import { JwtTokenService } from '../../../application/token-service.ts';
import { AuthGuard } from '../middlewares/auth-middleware.ts';
import { NotFoundError } from '../../../domain/errors.ts';

export const songRoutes: FastifyPluginAsync = async (fastify) => {
  const songRepo = new DrizzleSongRepository();
  const versionRepo = new DrizzleSongVersionRepository();
  const songService = new SongService(songRepo, versionRepo);
  const ingestionService = new IngestionPersistenceService(songService);
  const completionService = new MusicalContentCompletionService(songRepo, versionRepo);

  const userRepo = new DrizzleUserRepository();
  const tokenService = new JwtTokenService(env.JWT_SECRET, env.JWT_ACCESS_EXPIRES_IN);
  const authGuard = new AuthGuard(tokenService, userRepo);

  // 1. GET /api/v1/songs - Listar catálogo de canciones (Requiere songs:read verificado contra BD)
  fastify.get(
    '/',
    { preHandler: [authGuard.requirePermission('songs:read', true)] },
    async (request, reply) => {
      const query = ListSongsQuerySchema.parse(request.query);
      const result = await songService.listSongs(query);
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

  // 2. POST /api/v1/songs - Crear canción con versión canónica inicial (Requiere songs:create verificado contra BD)
  fastify.post(
    '/',
    { preHandler: [authGuard.requirePermission('songs:create', true)] },
    async (request, reply) => {
      const body = CreateSongBodySchema.parse(request.body);
      const created = await songService.createSong(body as any);
      return reply.status(201).send({
        data: created,
      });
    }
  );

  // 3. POST /api/v1/songs/import - Importar directamente desde fuente real (Requiere songs:create verificado contra BD)
  fastify.post(
    '/import',
    { preHandler: [authGuard.requirePermission('songs:create', true)] },
    async (request, reply) => {
      const body = ImportSourceBodySchema.parse(request.body);
      const result = await ingestionService.importAndPersist(body);
      return reply.status(201).send({
        data: result,
      });
    }
  );

  // 4. GET /api/v1/songs/:songId - Obtener canción y versión actual (Requiere songs:read verificado contra BD)
  fastify.get(
    '/:songId',
    { preHandler: [authGuard.requirePermission('songs:read', true)] },
    async (request, reply) => {
      const params = SongIdParamSchema.parse(request.params);
      const songWithVersion = await songService.getSong(params.songId);
      return reply.status(200).send({
        data: songWithVersion,
      });
    }
  );

  // 5. POST /api/v1/songs/:songId/versions - Crear una nueva versión (Requiere songs:update_draft verificado contra BD)
  fastify.post(
    '/:songId/versions',
    { preHandler: [authGuard.requirePermission('songs:update_draft', true)] },
    async (request, reply) => {
      const params = SongIdParamSchema.parse(request.params);
      const body = CreateVersionBodySchema.parse(request.body);
      const createdVersion = await songService.createVersion({
        songId: params.songId,
        name: body.name,
        description: body.description,
        sourceFormat: body.sourceFormat,
        canonicalPayload: body.canonicalPayload as any,
        setAsCurrent: body.setAsCurrent,
        sourceRecord: body.sourceRecord,
      });
      return reply.status(201).send({
        data: createdVersion,
      });
    }
  );

  // 6. GET /api/v1/songs/:songId/versions - Listar historial de versiones (Requiere songs:read verificado contra BD)
  fastify.get(
    '/:songId/versions',
    { preHandler: [authGuard.requirePermission('songs:read', true)] },
    async (request, reply) => {
      const params = SongIdParamSchema.parse(request.params);
      const versions = await songService.listVersions(params.songId);
      return reply.status(200).send({
        data: versions,
      });
    }
  );

  // 7. GET /api/v1/songs/:songId/versions/:versionId - Obtener una versión específica (Requiere songs:read verificado contra BD)
  fastify.get(
    '/:songId/versions/:versionId',
    { preHandler: [authGuard.requirePermission('songs:read', true)] },
    async (request, reply) => {
      const params = VersionIdParamSchema.parse(request.params);
      const version = await songService.getVersion(params.versionId);
      if (version.songId !== params.songId) {
        throw new NotFoundError('La versión solicitada no pertenece a esta canción.');
      }
      return reply.status(200).send({
        data: version,
      });
    }
  );

  // 8. PUT /api/v1/songs/:songId/versions/:versionId/activate - Establecer una versión como versión actual de la canción
  fastify.put(
    '/:songId/versions/:versionId/activate',
    { preHandler: [authGuard.requirePermission('songs:update_draft', true)] },
    async (request, reply) => {
      const params = VersionIdParamSchema.parse(request.params);
      await songService.setCurrentVersion(params.songId, params.versionId);
      const updatedSong = await songService.getSong(params.songId);
      return reply.status(200).send({
        data: updatedSong,
      });
    }
  );

  // 9. GET /api/v1/songs/:songId/format-capabilities - Evaluador autoritativo de disponibilidad de los 4 formatos del atril
  fastify.get(
    '/:songId/format-capabilities',
    { preHandler: [authGuard.requirePermission('songs:read', true)] },
    async (request, reply) => {
      const params = SongIdParamSchema.parse(request.params);
      const query = FormatCapabilitiesQuerySchema.parse(request.query);
      const result = await completionService.getSongFormatCapabilities(params.songId, query);
      return reply.status(200).send({
        data: result,
      });
    }
  );

  // 10. POST /api/v1/songs/:songId/completion/validate-preview - Validar y previsualizar completitud de contenido sin mutar versión canónica
  fastify.post(
    '/:songId/completion/validate-preview',
    { preHandler: [authGuard.requirePermission('songs:read', true)] },
    async (request, reply) => {
      const params = SongIdParamSchema.parse(request.params);
      const body = CompletionRequestBodySchema.parse(request.body);
      const user = request.user!;
      const preview = await completionService.validatePreview(params.songId, body as any, {
        id: user.sub,
        role: user.role,
        email: user.email,
      });
      return reply.status(200).send({
        data: preview,
      });
    }
  );

  // 11. GET /api/v1/songs/:songId/completion/proposals - Listar propuestas de completitud musical pendientes o históricas
  fastify.get(
    '/:songId/completion/proposals',
    { preHandler: [authGuard.requirePermission('songs:read', true)] },
    async (request, reply) => {
      const params = SongIdParamSchema.parse(request.params);
      const proposals = await completionService.listCompletionProposalsForSong(params.songId);
      return reply.status(200).send({
        data: proposals,
      });
    }
  );

  // 12. POST /api/v1/songs/:songId/completion/proposals - Preservar fuente original y crear borrador de completitud (Requiere songs:update_draft)
  fastify.post(
    '/:songId/completion/proposals',
    { preHandler: [authGuard.requirePermission('songs:update_draft', true)] },
    async (request, reply) => {
      const params = SongIdParamSchema.parse(request.params);
      const body = CompletionRequestBodySchema.parse(request.body);
      const user = request.user!;
      const proposal = await completionService.createCompletionProposal(params.songId, body as any, {
        id: user.sub,
        role: user.role,
        email: user.email,
      });
      return reply.status(201).send({
        data: proposal,
      });
    }
  );

  // 13. POST /api/v1/songs/:songId/completion/proposals/:proposalId/review - Aprobar y publicar versión v(N+1) o rechazar propuesta (WORSHIP_LEADER/ADMIN/SUPER_ADMIN)
  fastify.post(
    '/:songId/completion/proposals/:proposalId/review',
    { preHandler: [authGuard.requirePermission('songs:update_draft', true)] },
    async (request, reply) => {
      const params = CompletionProposalParamSchema.parse(request.params);
      const body = ReviewCompletionProposalBodySchema.parse(request.body);
      const user = request.user!;
      const reviewed = await completionService.reviewProposal(
        params.songId,
        params.proposalId,
        body.decision,
        {
          id: user.sub,
          role: user.role,
          email: user.email,
        },
        {
          notes: body.notes,
          versionName: body.versionName,
          setAsCurrent: body.setAsCurrent,
        }
      );
      return reply.status(200).send({
        data: reviewed,
      });
    }
  );
};
