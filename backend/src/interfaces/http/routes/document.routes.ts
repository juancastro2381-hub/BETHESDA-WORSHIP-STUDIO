/**
 * @file document.routes.ts
 * @description Endpoints RESTful para la inspección, almacenamiento y persistencia de documentos visuales (PDF e imágenes) (Fase B).
 */

import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { env } from '../../../config/env.ts';
import { DrizzleSongRepository } from '../../../repositories/song-repository.ts';
import { DrizzleSongVersionRepository } from '../../../repositories/version-repository.ts';
import { DrizzleUserRepository } from '../../../repositories/user-repository.ts';
import { LocalFileSystemDocumentStorageProvider } from '../../../domain/documents/document-storage-provider.ts';
import { DocumentService } from '../../../application/document-service.ts';
import { SongService } from '../../../application/song-service.ts';
import { AuthGuard } from '../middlewares/auth-middleware.ts';
import { JwtTokenService } from '../../../application/token-service.ts';

const InspectDocumentBodySchema = z.object({
  filename: z.string().min(1).max(255),
  mimeType: z.string().min(1).max(64),
  dataBase64: z.string().min(1, 'El contenido del documento en base64 no puede estar vacío'),
});

const ImportVisualSongBodySchema = z.object({
  storageKey: z.string().min(1),
  filename: z.string().min(1).max(255),
  mimeType: z.string().min(1).max(64),
  title: z.string().max(255).optional(),
  artist: z.string().max(255).optional(),
});

const StorageKeyParamSchema = z.object({
  storageKey: z.string().min(1),
});

export const documentRoutes: FastifyPluginAsync = async (fastify) => {
  const tokenService = new JwtTokenService(env.JWT_SECRET, env.JWT_ACCESS_EXPIRES_IN);
  const userRepo = new DrizzleUserRepository();
  const authGuard = new AuthGuard(tokenService, userRepo);

  const songRepo = new DrizzleSongRepository();
  const versionRepo = new DrizzleSongVersionRepository();
  const songService = new SongService(songRepo, versionRepo);

  const storageProvider = new LocalFileSystemDocumentStorageProvider();
  const documentService = new DocumentService(storageProvider, songService);

  // 1. POST /api/v1/documents/inspect - Inspeccionar y almacenar documento temporal o permanente
  fastify.post(
    '/inspect',
    {
      preHandler: [authGuard.requirePermission('songs:create')],
    },
    async (request, reply) => {
      const body = InspectDocumentBodySchema.parse(request.body);
      const buffer = Buffer.from(body.dataBase64, 'base64');
      const userId = request.user?.sub;

      const result = await documentService.inspectAndStoreDocument({
        buffer,
        filename: body.filename,
        mimeType: body.mimeType,
        userId,
      });

      return reply.status(201).send({
        data: result,
      });
    }
  );

  // 2. POST /api/v1/documents/import-song - Persistir canción canónica en modo visual
  fastify.post(
    '/import-song',
    {
      preHandler: [authGuard.requirePermission('songs:create')],
    },
    async (request, reply) => {
      const body = ImportVisualSongBodySchema.parse(request.body);
      const userId = request.user?.sub;

      const created = await documentService.importVisualDocumentSong({
        storageKey: body.storageKey,
        filename: body.filename,
        mimeType: body.mimeType,
        title: body.title,
        artist: body.artist,
        userId,
      });

      return reply.status(201).send({
        data: created,
      });
    }
  );

  // 3. GET /api/v1/documents/:storageKey/file - Descargar / Visualizar documento físico seguro
  fastify.get(
    '/:storageKey/file',
    {
      preHandler: [authGuard.requirePermission('songs:read')],
    },
    async (request, reply) => {
      const { storageKey } = StorageKeyParamSchema.parse(request.params);
      const fileData = await documentService.getDocumentFile(storageKey);

      // Determinar Content-Type según extensión o por defecto
      const ext = storageKey.slice(storageKey.lastIndexOf('.')).toLowerCase();
      let contentType = 'application/octet-stream';
      if (ext === '.pdf') contentType = 'application/pdf';
      else if (ext === '.png') contentType = 'image/png';
      else if (ext === '.jpg' || ext === '.jpeg') contentType = 'image/jpeg';
      else if (ext === '.webp') contentType = 'image/webp';
      else if (ext === '.tiff' || ext === '.tif') contentType = 'image/tiff';

      reply.header('Content-Type', contentType);
      reply.header('Content-Length', fileData.fileSizeBytes);
      reply.header('Content-Disposition', `inline; filename="${encodeURIComponent(storageKey)}"`);
      reply.header('Cache-Control', 'private, max-age=86400');
      reply.header('X-Checksum-Sha256', fileData.checksumSha256);
      reply.header('ETag', `"${fileData.checksumSha256}"`);

      return reply.status(200).send(fileData.buffer);
    }
  );
};
