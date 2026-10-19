/**
 * @file song.routes.ts
 * @description Definición de endpoints RESTful para la gestión y persistencia de canciones y versiones (Fase 2A).
 */

import type { FastifyPluginAsync } from 'fastify';
import { env } from '../../../config/env.ts';
import {
  CreateSongBodySchema,
  CreateVersionBodySchema,
  ImportSourceBodySchema,
  ListSongsQuerySchema,
  SongIdParamSchema,
  VersionIdParamSchema,
} from '../schemas/song.schemas.ts';
import { SongService } from '../../../application/song-service.ts';
import { IngestionPersistenceService } from '../../../application/ingestion-persistence-service.ts';
import { DrizzleSongRepository } from '../../../repositories/song-repository.ts';
import { DrizzleSongVersionRepository } from '../../../repositories/version-repository.ts';
import { DrizzleUserRepository } from '../../../repositories/user-repository.ts';
import { JwtTokenService } from '../../../application/token-service.ts';
import { AuthGuard } from '../middlewares/auth-middleware.ts';

export const songRoutes: FastifyPluginAsync = async (fastify) => {
  const songRepo = new DrizzleSongRepository();
  const versionRepo = new DrizzleSongVersionRepository();
  const songService = new SongService(songRepo, versionRepo);
  const ingestionService = new IngestionPersistenceService(songService);

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
      return reply.status(200).send({
        data: version,
      });
    }
  );
};
