/**
 * @file conversion.routes.ts
 * @description Endpoints RESTful para el Centro de Conversión Musical de Bethesda Worship Studio (Fase 2A).
 *
 * Endpoints:
 * - POST /api/v1/conversion/validate: Valida compatibilidad y matriz de formatos viables.
 * - POST /api/v1/conversion/transpile: Transpilación directa e inmediata en memoria.
 * - POST /api/v1/conversion/jobs: Creación y encolado de trabajo persistente.
 * - GET  /api/v1/conversion/jobs: Listado de trabajos de conversión del usuario.
 * - GET  /api/v1/conversion/jobs/:jobId: Consulta de estado y progreso de trabajo.
 * - POST /api/v1/conversion/jobs/:jobId/retry: Reintento de trabajo fallido.
 * - POST /api/v1/conversion/jobs/:jobId/cancel: Cancelación de trabajo.
 * - GET  /api/v1/conversion/jobs/:jobId/download: Descarga de archivo convertido.
 * - POST /api/v1/conversion/jobs/:jobId/commit: Persistencia al catálogo de canciones.
 */

import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { env } from '../../../config/env.ts';
import { DrizzleSongRepository } from '../../../repositories/song-repository.ts';
import { DrizzleSongVersionRepository } from '../../../repositories/version-repository.ts';
import { DrizzleUserRepository } from '../../../repositories/user-repository.ts';
import { SongService } from '../../../application/song-service.ts';
import { ConversionJobService } from '../../../application/conversion-job-service.ts';
import { AuthGuard } from '../middlewares/auth-middleware.ts';
import { JwtTokenService } from '../../../application/token-service.ts';
import { UnauthorizedError, ValidationError } from '../../../domain/errors.ts';
import type { AuthenticatedUser } from '../../../domain/auth-types.ts';
import { MAX_OMR_BASE64_LENGTH } from '../../../domain/omr/types.ts';

// ---------------------------------------------------------------------------
// Schemas Zod de Validación de Entrada HTTP
// ---------------------------------------------------------------------------

const ConversionTargetEnum = z.enum([
  'MUSIC_XML',
  'MIDI',
  'CHORD_PRO',
  'LYRICS_ONLY',
  'ENGRAVED_PDF',
  'TABLATURE',
]);

const ValidateInputSchema = z.object({
  filename: z.string().min(1, 'El nombre de archivo es obligatorio').max(255),
  rawText: z.string().optional(),
  dataBase64: z
    .string()
    .max(MAX_OMR_BASE64_LENGTH, 'El contenido Base64 excede el límite máximo permitido')
    .optional(),
});

const TranspileInputSchema = z.object({
  filename: z.string().min(1, 'El nombre de archivo es obligatorio').max(255),
  targetFormat: ConversionTargetEnum,
  rawText: z.string().optional(),
  dataBase64: z
    .string()
    .max(MAX_OMR_BASE64_LENGTH, 'El contenido Base64 excede el límite máximo permitido')
    .optional(),
  options: z
    .object({
      transposeSemitones: z.number().int().min(-24).max(24).optional(),
      keyOverride: z.string().max(10).optional(),
      bpmOverride: z.number().int().min(20).max(300).optional(),
      timeSignatureOverride: z.string().max(10).optional(),
    })
    .optional(),
});

const CommitInputSchema = z.object({
  title: z.string().min(1).max(255).optional(),
  artist: z.string().max(255).optional(),
});

function extractAuthenticatedUser(request: any): AuthenticatedUser {
  if (!request.user || (!request.user.sub && !request.user.id)) {
    throw new UnauthorizedError('Autenticación requerida para acceder a este recurso.');
  }
  return {
    id: request.user.sub || request.user.id,
    role: request.user.role,
    email: request.user.email,
  };
}

export const conversionRoutes: FastifyPluginAsync = async (fastify) => {
  const tokenService = new JwtTokenService(env.JWT_SECRET, env.JWT_ACCESS_EXPIRES_IN);
  const userRepo = new DrizzleUserRepository();
  const authGuard = new AuthGuard(tokenService, userRepo);

  const songRepo = new DrizzleSongRepository();
  const versionRepo = new DrizzleSongVersionRepository();
  const songService = new SongService(songRepo, versionRepo);
  const conversionService = new ConversionJobService(songService);

  // 1. POST /api/v1/conversion/validate
  fastify.post('/validate', async (request, reply) => {
    const parsed = ValidateInputSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.errors.map((e) => e.message).join('; '));
    }

    const result = await conversionService.validateSource(parsed.data);
    return reply.status(200).send({
      data: result,
      error: null,
      meta: { timestamp: new Date().toISOString() },
    });
  });

  // 2. POST /api/v1/conversion/transpile
  fastify.post('/transpile', async (request, reply) => {
    const parsed = TranspileInputSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.errors.map((e) => e.message).join('; '));
    }

    const result = await conversionService.transpileDirect(parsed.data);
    return reply.status(200).send({
      data: result,
      error: null,
      meta: { timestamp: new Date().toISOString() },
    });
  });

  // 3. POST /api/v1/conversion/jobs (Exige autenticación)
  fastify.post('/jobs', async (request, reply) => {
    await authGuard.authenticate(request, reply);
    const user = extractAuthenticatedUser(request);

    const parsed = TranspileInputSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.errors.map((e) => e.message).join('; '));
    }

    const job = await conversionService.createJob(user, parsed.data);
    return reply.status(201).send({
      data: job,
      error: null,
      meta: { timestamp: new Date().toISOString() },
    });
  });

  // 4. GET /api/v1/conversion/jobs
  fastify.get('/jobs', async (request, reply) => {
    await authGuard.authenticate(request, reply);
    const user = extractAuthenticatedUser(request);

    const jobs = await conversionService.listUserJobs(user);
    return reply.status(200).send({
      data: jobs,
      error: null,
      meta: { timestamp: new Date().toISOString(), total: jobs.length },
    });
  });

  // 5. GET /api/v1/conversion/jobs/:jobId
  fastify.get('/jobs/:jobId', async (request, reply) => {
    await authGuard.authenticate(request, reply);
    const user = extractAuthenticatedUser(request);

    const { jobId } = request.params as { jobId: string };
    const job = await conversionService.getJob(jobId, user);
    return reply.status(200).send({
      data: job,
      error: null,
      meta: { timestamp: new Date().toISOString() },
    });
  });

  // 6. POST /api/v1/conversion/jobs/:jobId/retry
  fastify.post('/jobs/:jobId/retry', async (request, reply) => {
    await authGuard.authenticate(request, reply);
    const user = extractAuthenticatedUser(request);

    const { jobId } = request.params as { jobId: string };
    const retriedJob = await conversionService.retryJob(jobId, user);
    return reply.status(200).send({
      data: retriedJob,
      error: null,
      meta: { timestamp: new Date().toISOString() },
    });
  });

  // 7. POST /api/v1/conversion/jobs/:jobId/cancel
  fastify.post('/jobs/:jobId/cancel', async (request, reply) => {
    await authGuard.authenticate(request, reply);
    const user = extractAuthenticatedUser(request);

    const { jobId } = request.params as { jobId: string };
    const cancelledJob = await conversionService.cancelJob(jobId, user);
    return reply.status(200).send({
      data: cancelledJob,
      error: null,
      meta: { timestamp: new Date().toISOString() },
    });
  });

  // 8. GET /api/v1/conversion/jobs/:jobId/download
  fastify.get('/jobs/:jobId/download', async (request, reply) => {
    await authGuard.authenticate(request, reply);
    const user = extractAuthenticatedUser(request);

    const { jobId } = request.params as { jobId: string };
    const job = await conversionService.getJob(jobId, user);

    const details = job.errorDetails as any;
    if (!details || !details.data) {
      throw new ValidationError('El trabajo de conversión aún no cuenta con un archivo generado para descargar.');
    }

    const filename = job.outputRef || 'conversion.txt';
    const mimeType = details.mimeType || 'text/plain';

    reply.header('Content-Disposition', `attachment; filename="${filename}"`);
    reply.header('Content-Type', mimeType);

    if (details.isBinary) {
      const buffer = Buffer.from(details.data, 'base64');
      return reply.status(200).send(buffer);
    } else {
      return reply.status(200).send(details.data);
    }
  });

  // 9. POST /api/v1/conversion/jobs/:jobId/commit
  fastify.post('/jobs/:jobId/commit', async (request, reply) => {
    await authGuard.authenticate(request, reply);
    const user = extractAuthenticatedUser(request);
    if (!user) {
      throw new UnauthorizedError('Se requiere iniciar sesión para guardar en el catálogo.');
    }

    const { jobId } = request.params as { jobId: string };
    const parsed = CommitInputSchema.safeParse(request.body ?? {});
    const overrides = parsed.success ? parsed.data : undefined;

    const createdSong = await conversionService.commitJobToCatalog(jobId, user, overrides);
    return reply.status(201).send({
      data: createdSong,
      error: null,
      meta: { timestamp: new Date().toISOString() },
    });
  });
};

