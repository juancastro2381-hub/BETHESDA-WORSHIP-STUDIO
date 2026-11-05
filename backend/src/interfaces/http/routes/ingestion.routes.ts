/**
 * @file ingestion.routes.ts
 * @description Endpoints RESTful para la arquitectura de ingesta universal de Bethesda Worship Studio (Fase 1B).
 *
 * Endpoints:
 * - POST /api/v1/ingestion/upload: Ingesta de archivos binarios/texto (MusicXML, MIDI, ChordPro, PDF, Imágenes, Audio).
 * - POST /api/v1/ingestion/written-notes: Ingesta estructurada directa de notas musicales, compases y acordes.
 * - POST /api/v1/ingestion/video-url: Ingesta de URLs de video autorizadas con protección SSRF.
 * - GET /api/v1/ingestion/jobs/:jobId: Consulta de estado de procesamiento en segundo plano.
 */

import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { env } from '../../../config/env.ts';
import { DrizzleSongRepository } from '../../../repositories/song-repository.ts';
import { DrizzleSongVersionRepository } from '../../../repositories/version-repository.ts';
import { DrizzleUserRepository } from '../../../repositories/user-repository.ts';
import { SongService } from '../../../application/song-service.ts';
import { UniversalIngestionService } from '../../../application/universal-ingestion-service.ts';
import { AuthGuard } from '../middlewares/auth-middleware.ts';
import { JwtTokenService } from '../../../application/token-service.ts';
import { UnauthorizedError, ValidationError } from '../../../domain/errors.ts';
import type { AuthenticatedUser } from '../../../domain/auth-types.ts';
import { MAX_OMR_BASE64_LENGTH, MAX_OMR_FILE_SIZE_BYTES } from '../../../domain/omr/types.ts';

// ---------------------------------------------------------------------------
// Schemas Zod de Validación de Entrada HTTP
// ---------------------------------------------------------------------------

const IngestionUploadBodySchema = z.object({
  filename: z.string().min(1, 'El nombre de archivo es obligatorio').max(255),
  mimeType: z.string().min(1, 'El tipo MIME es obligatorio').max(128).optional(),
  sourceType: z
    .enum(['MUSICXML', 'MIDI', 'CHORDPRO', 'PDF_SCORE', 'IMAGE_SCORE', 'AUDIO'])
    .optional(),
  title: z.string().min(1).max(255).optional(),
  artist: z.string().max(255).optional(),
  dataBase64: z
    .string()
    .min(1, 'El contenido en Base64 no puede estar vacío')
    .max(MAX_OMR_BASE64_LENGTH, 'El contenido Base64 excede el límite máximo permitido (15 MiB binario)')
    .optional(),
  rawText: z.string().min(1).optional(),
});

const WrittenNoteSchema = z.object({
  step: z.string().min(1).max(1).regex(/^[A-G]$/i, 'La nota debe ser una letra de A a G'),
  octave: z.number().int().min(0).max(9),
  alter: z.number().int().min(-2).max(2).optional(),
  duration: z.enum(['whole', 'half', 'quarter', 'eighth', '16th', '32nd']),
  isRest: z.boolean().optional(),
  velocity: z.number().int().min(0).max(127).optional(),
});

const WrittenChordSchema = z.object({
  root: z.string().min(1).max(1).regex(/^[A-G]$/i),
  alter: z.number().int().min(-2).max(2).optional(),
  quality: z.string().min(1).max(30),
  bass: z.string().max(10).optional(),
  startTick: z.number().int().min(0),
});

const WrittenLyricSchema = z.object({
  text: z.string().min(1),
  startTick: z.number().int().min(0),
  syllabic: z.enum(['single', 'begin', 'middle', 'end']).optional(),
});

const WrittenMeasureSchema = z.object({
  measureNumber: z.number().int().positive(),
  timeSignature: z
    .object({
      numerator: z.number().int().positive(),
      denominator: z.number().int().positive(),
    })
    .optional(),
  keySignature: z.string().max(16).optional(),
  tempoBpm: z.number().int().positive().optional(),
  notes: z.array(WrittenNoteSchema),
  chords: z.array(WrittenChordSchema).optional(),
  lyrics: z.array(WrittenLyricSchema).optional(),
});

const WrittenNotesBodySchema = z.object({
  title: z.string().min(1, 'El título es obligatorio').max(255),
  artist: z.string().max(255).optional(),
  timeSignature: z
    .object({
      numerator: z.number().int().positive(),
      denominator: z.number().int().positive(),
    })
    .optional(),
  keySignature: z.string().max(16).optional(),
  tempoBpm: z.number().int().positive().optional(),
  measures: z.array(WrittenMeasureSchema).min(1, 'Se requiere al menos un compás'),
});

const VideoUrlBodySchema = z.object({
  videoUrl: z.string().url('Debe ser una URL válida').max(512),
  title: z.string().min(1).max(255).optional(),
  artist: z.string().max(255).optional(),
});

const JobIdParamSchema = z.object({
  jobId: z.string().uuid('El ID de tarea debe ser un UUID válido'),
});

const SourceIdParamSchema = z.object({
  sourceId: z.string().uuid('El ID de fuente debe ser un UUID válido'),
});

function extractAuthenticatedPrincipal(request: any): AuthenticatedUser {
  if (!request.user || !request.user.sub) {
    throw new UnauthorizedError('Autenticación requerida.');
  }
  return {
    id: request.user.sub,
    role: request.user.role,
    email: request.user.email,
  };
}

// Función de validación en bloques para Base64 seguro
function isValidBase64(str: string): boolean {
  if (str.length === 0 || str.length % 4 !== 0) return false;
  const CHUNK_SIZE = 65536;
  const len = str.length;
  const chunkRegex = /^[A-Za-z0-9+/]+$/;

  for (let i = 0; i < len - 4; i += CHUNK_SIZE) {
    const end = Math.min(i + CHUNK_SIZE, len - 4);
    const slice = str.substring(i, end);
    if (!chunkRegex.test(slice)) return false;
  }

  const lastFour = str.substring(len - 4);
  return /^[A-Za-z0-9+/]{4}$|^[A-Za-z0-9+/]{3}=$|^[A-Za-z0-9+/]{2}==$/.test(lastFour);
}

export const ingestionRoutes: FastifyPluginAsync = async (fastify) => {
  const tokenService = new JwtTokenService(env.JWT_SECRET);
  const userRepo = new DrizzleUserRepository();
  const authGuard = new AuthGuard(tokenService, userRepo);

  const songRepo = new DrizzleSongRepository();
  const versionRepo = new DrizzleSongVersionRepository();
  const songService = new SongService(songRepo, versionRepo);
  const ingestionService = new UniversalIngestionService(songService);

  /**
   * POST /api/v1/ingestion/upload
   * Ingesta de archivos binarios o textuales.
   */
  fastify.post(
    '/upload',
    {
      preHandler: [authGuard.requireAuth],
    },
    async (request, reply) => {
      const user = extractAuthenticatedPrincipal(request);

      const parseResult = IngestionUploadBodySchema.safeParse(request.body);
      if (!parseResult.success) {
        throw new ValidationError('Datos de entrada inválidos para la ingesta de archivo', parseResult.error.errors);
      }

      const body = parseResult.data;
      let buffer: Buffer | undefined;

      if (body.dataBase64) {
        if (!isValidBase64(body.dataBase64)) {
          throw new ValidationError('El contenido suministrado en dataBase64 no es una cadena Base64 válida.');
        }
        buffer = Buffer.from(body.dataBase64, 'base64');
        if (buffer.length > MAX_OMR_FILE_SIZE_BYTES) {
          throw new ValidationError(
            `El archivo binario decodificado (${(buffer.length / (1024 * 1024)).toFixed(2)} MB) excede el límite máximo de 15 MiB.`
          );
        }
      }

      if (!buffer && !body.rawText) {
        throw new ValidationError('Debe proporcionar dataBase64 o rawText para procesar la ingesta.');
      }

      const output = await ingestionService.ingest(
        {
          filename: body.filename,
          mimeType: body.mimeType,
          sourceType: body.sourceType,
          title: body.title,
          artist: body.artist,
          buffer,
          rawText: body.rawText,
        },
        user
      );

      return reply.code(201).send(output);
    }
  );

  /**
   * POST /api/v1/ingestion/written-notes
   * Ingesta de notas musicales manuales estructuradas.
   */
  fastify.post(
    '/written-notes',
    {
      preHandler: [authGuard.requireAuth],
    },
    async (request, reply) => {
      const user = extractAuthenticatedPrincipal(request);

      const parseResult = WrittenNotesBodySchema.safeParse(request.body);
      if (!parseResult.success) {
        throw new ValidationError('Datos de notas escritas inválidos', parseResult.error.errors);
      }

      const output = await ingestionService.ingest(
        {
          sourceType: 'WRITTEN_NOTES',
          writtenNotes: parseResult.data,
          title: parseResult.data.title,
          artist: parseResult.data.artist,
        },
        user
      );

      return reply.code(201).send(output);
    }
  );

  /**
   * POST /api/v1/ingestion/video-url
   * Ingesta de URL de video autorizada con protección SSRF.
   */
  fastify.post(
    '/video-url',
    {
      preHandler: [authGuard.requireAuth],
    },
    async (request, reply) => {
      const user = extractAuthenticatedPrincipal(request);

      const parseResult = VideoUrlBodySchema.safeParse(request.body);
      if (!parseResult.success) {
        throw new ValidationError('Datos de URL de video inválidos', parseResult.error.errors);
      }

      const output = await ingestionService.ingest(
        {
          sourceType: 'VIDEO_URL',
          videoUrl: parseResult.data.videoUrl,
          title: parseResult.data.title,
          artist: parseResult.data.artist,
        },
        user
      );

      return reply.code(201).send(output);
    }
  );

  /**
   * GET /api/v1/ingestion/jobs/:jobId
   * Consulta de estado de una tarea de ingesta.
   */
  fastify.get(
    '/jobs/:jobId',
    {
      preHandler: [authGuard.requireAuth],
    },
    async (request, reply) => {
      const user = extractAuthenticatedPrincipal(request);

      const paramResult = JobIdParamSchema.safeParse(request.params);
      if (!paramResult.success) {
        throw new ValidationError('ID de tarea inválido', paramResult.error.errors);
      }

      const job = await ingestionService.getJobStatus(paramResult.data.jobId, user);
      return reply.send({
        id: job.id,
        jobType: job.jobType,
        status: job.status,
        progress: job.progress,
        outputRef: job.outputRef,
        errorCode: job.errorCode,
        errorDetails: job.errorDetails,
        createdAt: job.createdAt,
        startedAt: job.startedAt,
        completedAt: job.completedAt,
      });
    }
  );

  /**
   * GET /api/v1/ingestion/sources/:sourceId
   * Consulta los metadatos de una fuente preservada verificando autorización multi-inquilino.
   */
  fastify.get(
    '/sources/:sourceId',
    {
      preHandler: [authGuard.requireAuth],
    },
    async (request, reply) => {
      const user = extractAuthenticatedPrincipal(request);
      const paramResult = SourceIdParamSchema.safeParse(request.params);
      if (!paramResult.success) {
        throw new ValidationError('ID de fuente inválido', paramResult.error.errors);
      }

      const source = await ingestionService.getSource(paramResult.data.sourceId, user);
      return reply.send({
        id: source.id,
        songId: source.songId,
        versionId: source.versionId,
        userId: source.userId,
        sourceType: source.sourceType,
        filename: source.filename,
        storagePath: source.storagePath,
        mimeType: source.mimeType,
        fileSizeBytes: source.fileSizeBytes,
        checksumSha256: source.checksumSha256,
        jobId: source.jobId,
        importerName: source.importerName,
        importerVersion: source.importerVersion,
        importedAt: source.importedAt,
      });
    }
  );

  /**
   * GET /api/v1/ingestion/sources/:sourceId/file
   * Descarga el flujo binario original de una fuente preservada verificando autorización multi-inquilino.
   */
  fastify.get(
    '/sources/:sourceId/file',
    {
      preHandler: [authGuard.requireAuth],
    },
    async (request, reply) => {
      const user = extractAuthenticatedPrincipal(request);
      const paramResult = SourceIdParamSchema.safeParse(request.params);
      if (!paramResult.success) {
        throw new ValidationError('ID de fuente inválido', paramResult.error.errors);
      }

      const { source, buffer } = await ingestionService.getSourceFile(paramResult.data.sourceId, user);
      const filename = source.filename || 'source.bin';
      const mimeType = source.mimeType || 'application/octet-stream';

      return reply
        .header('Content-Type', mimeType)
        .header('Content-Disposition', `attachment; filename="${filename.replace(/"/g, '')}"`)
        .header('X-Checksum-SHA256', source.checksumSha256 || '')
        .header('Content-Length', buffer.length)
        .send(buffer);
    }
  );
};
