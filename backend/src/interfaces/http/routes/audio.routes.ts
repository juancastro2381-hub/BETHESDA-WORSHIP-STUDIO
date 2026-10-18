/**
 * @file audio.routes.ts
 * @description Endpoints RESTful para la gestión, streaming y descarga de activos de audio (Workstream A).
 */

import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { env } from '../../../config/env.ts';
import { DrizzleAudioRepository } from '../../../repositories/audio-repository.ts';
import { DrizzleSongRepository } from '../../../repositories/song-repository.ts';
import { LocalFileSystemAudioStorageProvider } from '../../../domain/audio/storage-provider.ts';
import { AudioService } from '../../../application/audio-service.ts';
import { AuthGuard } from '../middlewares/auth-middleware.ts';
import { JwtTokenService } from '../../../application/token-service.ts';
import { DrizzleUserRepository } from '../../../repositories/user-repository.ts';

const UploadAudioBodySchema = z.object({
  title: z.string().min(1).max(255),
  filename: z.string().min(1).max(255),
  mimeType: z.string().min(1).max(64),
  dataBase64: z.string().min(1, 'El contenido de audio en base64 no puede estar vacío'),
  durationSeconds: z.number().int().positive().optional(),
});

const SongIdParamSchema = z.object({
  songId: z.string().uuid(),
});

const AudioIdParamSchema = z.object({
  id: z.string().uuid(),
});

export const audioRoutes: FastifyPluginAsync = async (fastify) => {
  const tokenService = new JwtTokenService(env.JWT_SECRET, env.JWT_ACCESS_EXPIRES_IN);
  const userRepo = new DrizzleUserRepository();
  const authGuard = new AuthGuard(tokenService, userRepo);

  const audioRepo = new DrizzleAudioRepository();
  const songRepo = new DrizzleSongRepository();
  const storageProvider = new LocalFileSystemAudioStorageProvider(
    env.AUDIO_STORAGE_PATH,
    env.MAX_AUDIO_FILE_SIZE_BYTES
  );
  const audioService = new AudioService(audioRepo, storageProvider, songRepo, env.MAX_AUDIO_FILE_SIZE_BYTES);

  // 1. POST /api/v1/songs/:songId/audio - Subir activo de audio (Líderes y Administradores)
  fastify.post(
    '/songs/:songId/audio',
    {
      preHandler: [authGuard.requirePermission('songs:create')],
    },
    async (request, reply) => {
      const { songId } = SongIdParamSchema.parse(request.params);
      const body = UploadAudioBodySchema.parse(request.body);

      const buffer = Buffer.from(body.dataBase64, 'base64');
      const userId = request.user?.sub;

      const created = await audioService.uploadAudio({
        songId,
        title: body.title,
        filename: body.filename,
        mimeType: body.mimeType,
        buffer,
        durationSeconds: body.durationSeconds,
        uploadedByUserId: userId,
      });

      return reply.status(201).send({
        data: created,
      });
    }
  );

  // 2. GET /api/v1/songs/:songId/audio - Listar audios de una canción (Autenticado)
  fastify.get(
    '/songs/:songId/audio',
    {
      preHandler: [authGuard.requirePermission('songs:read')],
    },
    async (request, reply) => {
      const { songId } = SongIdParamSchema.parse(request.params);
      const audios = await audioService.getAudiosBySongId(songId);

      return reply.status(200).send({
        data: audios,
      });
    }
  );

  // 3. GET /api/v1/audio/:id/download - Descargar audio completo
  fastify.get(
    '/audio/:id/download',
    {
      preHandler: [authGuard.requirePermission('songs:read')],
    },
    async (request, reply) => {
      const { id } = AudioIdParamSchema.parse(request.params);
      const file = await audioService.downloadAudio(id);

      reply.header('Content-Type', file.mimeType);
      reply.header('Content-Length', file.fileSizeBytes);
      reply.header('Content-Disposition', `attachment; filename="${encodeURIComponent(file.filename)}"`);
      reply.header('Cache-Control', 'private, no-cache');

      return reply.status(200).send(file.buffer);
    }
  );

  // 4. GET /api/v1/audio/:id/stream - Streaming con soporte Range (HTTP 206 / 200)
  fastify.get(
    '/audio/:id/stream',
    {
      preHandler: [authGuard.requirePermission('songs:read')],
    },
    async (request, reply) => {
      const { id } = AudioIdParamSchema.parse(request.params);
      const rangeHeader = request.headers.range;

      const streamResult = await audioService.streamAudio(id, rangeHeader);

      for (const [headerName, headerVal] of Object.entries(streamResult.headers)) {
        reply.header(headerName, headerVal);
      }

      return reply.status(streamResult.statusCode).send(streamResult.stream);
    }
  );

  // 5. DELETE /api/v1/audio/:id - Eliminar activo de audio físico y en BD
  fastify.delete(
    '/audio/:id',
    {
      preHandler: [authGuard.requirePermission('songs:update_draft')],
    },
    async (request, reply) => {
      const { id } = AudioIdParamSchema.parse(request.params);
      const deleted = await audioService.deleteAudio(id);

      if (!deleted) {
        return reply.status(404).send({
          statusCode: 404,
          error: 'Not Found',
          message: `Activo de audio con ID ${id} no encontrado.`,
        });
      }

      return reply.status(204).send();
    }
  );
};
