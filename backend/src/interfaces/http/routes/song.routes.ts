/**
 * @file song.routes.ts
 * @description Definición de endpoints RESTful para la gestión y persistencia de canciones y versiones (Fase 2A).
 */

import type { FastifyPluginAsync } from 'fastify';
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

export const songRoutes: FastifyPluginAsync = async (fastify) => {
  const songRepo = new DrizzleSongRepository();
  const versionRepo = new DrizzleSongVersionRepository();
  const songService = new SongService(songRepo, versionRepo);
  const ingestionService = new IngestionPersistenceService(songService);

  // 1. GET /api/v1/songs - Listar catálogo de canciones
  fastify.get('/', async (request, reply) => {
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
  });

  // 2. POST /api/v1/songs - Crear canción con versión canónica inicial
  fastify.post('/', async (request, reply) => {
    const body = CreateSongBodySchema.parse(request.body);
    const created = await songService.createSong(body as any);
    return reply.status(201).send({
      data: created,
    });
  });

  // 3. POST /api/v1/songs/import - Importar directamente desde fuente real (MusicXML / ChordPro)
  fastify.post('/import', async (request, reply) => {
    const body = ImportSourceBodySchema.parse(request.body);
    const result = await ingestionService.importAndPersist(body);
    return reply.status(201).send({
      data: result,
    });
  });

  // 4. GET /api/v1/songs/:songId - Obtener canción y versión actual
  fastify.get('/:songId', async (request, reply) => {
    const params = SongIdParamSchema.parse(request.params);
    const songWithVersion = await songService.getSong(params.songId);
    return reply.status(200).send({
      data: songWithVersion,
    });
  });

  // 5. POST /api/v1/songs/:songId/versions - Crear una nueva versión para una canción
  fastify.post('/:songId/versions', async (request, reply) => {
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
  });

  // 6. GET /api/v1/songs/:songId/versions - Listar historial de versiones de una canción
  fastify.get('/:songId/versions', async (request, reply) => {
    const params = SongIdParamSchema.parse(request.params);
    const versions = await songService.listVersions(params.songId);
    return reply.status(200).send({
      data: versions,
    });
  });

  // 7. GET /api/v1/songs/:songId/versions/:versionId - Obtener una versión específica
  fastify.get('/:songId/versions/:versionId', async (request, reply) => {
    const params = VersionIdParamSchema.parse(request.params);
    const version = await songService.getVersion(params.versionId);
    return reply.status(200).send({
      data: version,
    });
  });
};
