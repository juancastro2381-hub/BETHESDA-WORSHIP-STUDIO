/**
 * @file omr.routes.ts
 * @description Endpoints RESTful para Reconocimiento Óptico de Música (OMR), revisión humana,
 * auditoría inmutable y compromiso al catálogo canónico con trazabilidad completa de autenticación (R3.1-05, R3.2-04, R3.2-05).
 */

import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { env } from '../../../config/env.ts';
import { DrizzleSongRepository } from '../../../repositories/song-repository.ts';
import { DrizzleOmrProposalRepository } from '../../../repositories/omr-proposal-repository.ts';
import { DrizzleUserRepository } from '../../../repositories/user-repository.ts';
import { StandardOmrProvider } from '../../../domain/omr/omr-provider.ts';
import { OmrService } from '../../../application/omr-service.ts';
import { AuthGuard } from '../middlewares/auth-middleware.ts';
import { JwtTokenService } from '../../../application/token-service.ts';
import { UnauthorizedError, ValidationError } from '../../../domain/errors.ts';
import {
  type AuthenticatedUser,
  MAX_OMR_FILE_SIZE_BYTES,
  MAX_OMR_BASE64_LENGTH,
} from '../../../domain/omr/types.ts';

// ---------------------------------------------------------------------------
// Schemas Estrictos de Validación de Entrada HTTP (R3.2-04 & R3.2-05)
// ---------------------------------------------------------------------------

const ProposalIdParamSchema = z.object({
  proposalId: z.string().uuid('El ID de propuesta OMR debe ser un UUID válido'),
});

const MeasureParamSchema = z.object({
  proposalId: z.string().uuid('El ID de propuesta OMR debe ser un UUID válido'),
  measureNumber: z.coerce.number().int().positive('El número de compás debe ser un entero positivo'),
});

const UploadOmrBodySchema = z.object({
  filename: z.string().min(1, 'El nombre del archivo es obligatorio').max(255),
  mimeType: z.string().min(1, 'El tipo MIME es obligatorio').max(64),
  dataBase64: z
    .string()
    .min(1, 'El contenido del archivo en base64 no puede estar vacío')
    .max(MAX_OMR_BASE64_LENGTH, 'El contenido base64 excede el tamaño máximo permitido para un archivo de 15 MiB'),
});

const ReviewOmrBodySchema = z.object({
  status: z.enum(['APPROVED_FOR_IMPORT', 'REJECTED'], {
    errorMap: () => ({ message: 'El estado debe ser APPROVED_FOR_IMPORT o REJECTED' }),
  }),
  notes: z.string().max(1000).optional(),
});

const CommitOmrBodySchema = z.object({
  overrides: z
    .object({
      title: z.string().min(1).max(255).optional(),
      key: z.string().min(1).max(16).optional(),
      timeSignature: z.string().min(1).max(16).optional(),
      bpm: z.number().int().positive().optional(),
    })
    .optional(),
});

// Schemas musicales específicos para evitar z.any() y pérdida de contenido durante PATCH (R3.2-04)
const NoteDetectedSchema = z.object({
  step: z
    .string()
    .trim()
    .regex(/^[A-Ga-g]$/, 'El paso de nota (step) debe ser una única letra entre A y G')
    .transform((s) => s.toUpperCase()),
  octave: z.number().int().min(0).max(9, 'La octava debe estar entre 0 y 9'),
  duration: z.string().min(1, 'La duración es obligatoria'),
  confidence: z.number().min(0).max(1, 'La confianza debe estar entre 0 y 1'),
  alter: z.number().int().min(-2).max(2).optional(),
  type: z.string().optional(),
  isRest: z.boolean().optional(),
});

const ChordDetectedSchema = z.object({
  chord: z.string().min(1, 'El símbolo de acorde no puede estar vacío'),
  beat: z.number().positive('El tiempo (beat) debe ser un número positivo'),
  confidence: z.number().min(0).max(1, 'La confianza debe estar entre 0 y 1'),
  tickOffset: z.number().int().min(0).optional(),
});

const LyricDetectedSchema = z.object({
  text: z.string().min(1, 'El texto de la sílaba no puede estar vacío'),
  confidence: z.number().min(0).max(1, 'La confianza debe estar entre 0 y 1'),
  beat: z.number().positive().optional(),
  tickOffset: z.number().int().min(0).optional(),
  durationTicks: z.number().int().positive().optional(),
});

const PatchMeasureBodySchema = z.object({
  measure: z.object({
    measureNumber: z.number().int().positive('El número de compás debe ser un entero positivo'),
    timeSignature: z.string().min(1).optional(),
    keySignature: z.string().min(1).optional(),
    // Omitidos no destruyen contenido: NO se usan valores predeterminados (default) que sobreescriban arrays vacíos
    chordsDetected: z.array(ChordDetectedSchema).optional(),
    notesDetected: z.array(NoteDetectedSchema).optional(),
    lyricsDetected: z.array(LyricDetectedSchema).optional(),
    // Confianza omitida no debe inflarse a 1 artificialmente
    measureConfidence: z.number().min(0).max(1).optional(),
    flags: z.array(z.string()).optional(),
  }),
});

// ---------------------------------------------------------------------------
// Helpers de Validación de Archivo y Firmas Mágicas (R3.2-05)
// ---------------------------------------------------------------------------

function validateFileSignatureAndMime(buffer: Buffer, mimeType: string, filename: string): void {
  if (buffer.length === 0) {
    throw new ValidationError('El archivo decodificado está vacío (0 bytes).');
  }
  if (buffer.length > MAX_OMR_FILE_SIZE_BYTES) {
    throw new ValidationError(
      `El archivo excede el tamaño máximo permitido de 15MB (${buffer.length} bytes recibidos).`
    );
  }

  const normalizedMime = mimeType.trim().toLowerCase();

  // PDF: %PDF- (0x25 0x50 0x44 0x46 0x2D)
  if (normalizedMime === 'application/pdf') {
    if (buffer.length < 5 || buffer.subarray(0, 5).toString('ascii') !== '%PDF-') {
      throw new ValidationError('Firma mágica inválida para PDF: el contenido no comienza con %PDF-.');
    }
    return;
  }

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (normalizedMime === 'image/png') {
    const pngHeader = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
    if (buffer.length < 8 || !buffer.subarray(0, 8).equals(pngHeader)) {
      throw new ValidationError('Firma mágica inválida para imagen PNG.');
    }
    return;
  }

  // TIFF: II*\0 (Little endian) or MM\0* (Big endian)
  if (normalizedMime === 'image/tiff') {
    const isLE = buffer.length >= 4 && buffer[0] === 0x49 && buffer[1] === 0x49 && buffer[2] === 0x2a && buffer[3] === 0x00;
    const isBE = buffer.length >= 4 && buffer[0] === 0x4d && buffer[1] === 0x4d && buffer[2] === 0x00 && buffer[3] === 0x2a;
    if (!isLE && !isBE) {
      throw new ValidationError('Firma mágica inválida para imagen TIFF.');
    }
    return;
  }

  // JPEG: FF D8 FF
  if (normalizedMime === 'image/jpeg') {
    if (buffer.length < 3 || buffer[0] !== 0xFF || buffer[1] !== 0xD8 || buffer[2] !== 0xFF) {
      throw new ValidationError('Firma mágica inválida para imagen JPEG.');
    }
    return;
  }

  throw new ValidationError(
    `Tipo MIME "${mimeType}" no soportado. Formatos permitidos: application/pdf, image/png, image/tiff, image/jpeg.`
  );
}

function isValidBase64(str: string): boolean {
  if (str.length === 0 || str.length % 4 !== 0) return false;
  // Validar en bloques de 64KB para evitar desbordamiento de pila (stack overflow) en V8
  const CHUNK_SIZE = 65536;
  const chunkRegex = /^[A-Za-z0-9+/=]+$/;
  for (let i = 0; i < str.length; i += CHUNK_SIZE) {
    const chunk = str.slice(i, i + CHUNK_SIZE);
    if (!chunkRegex.test(chunk)) return false;
  }
  const equalIdx = str.indexOf('=');
  if (equalIdx !== -1) {
    if (equalIdx < str.length - 2) return false;
    for (let i = equalIdx; i < str.length; i++) {
      if (str[i] !== '=') return false;
    }
  }
  return true;
}

// ---------------------------------------------------------------------------
// Helper de Extracción Segura de Identidad Autenticada (R3.1-05)
// ---------------------------------------------------------------------------
function extractAuthenticatedPrincipal(request: any): AuthenticatedUser {
  if (!request.user || !request.user.sub || !request.user.role) {
    throw new UnauthorizedError('Autenticación requerida para acceder al servicio OMR.');
  }
  return {
    id: request.user.sub,
    role: request.user.role,
  };
}

export const omrRoutes: FastifyPluginAsync = async (fastify) => {
  const tokenService = new JwtTokenService(env.JWT_SECRET, env.JWT_ACCESS_EXPIRES_IN);
  const userRepo = new DrizzleUserRepository();
  const authGuard = new AuthGuard(tokenService, userRepo);

  const songRepo = new DrizzleSongRepository();
  const omrRepo = new DrizzleOmrProposalRepository();
  const provider = new StandardOmrProvider({ enableTestFixture: env.NODE_ENV === 'test' });
  const omrService = new OmrService(provider, songRepo, omrRepo);

  // 1. POST /api/v1/omr/upload - Ingesta OMR y generación de propuesta preliminar (R3.2-05)
  fastify.post(
    '/upload',
    {
      preHandler: [authGuard.requirePermission('songs:create', true)],
    },
    async (request, reply) => {
      const body = UploadOmrBodySchema.parse(request.body);
      const user = extractAuthenticatedPrincipal(request);

      // Validar formato Base64 estricto (R3.2-05)
      const cleanBase64 = body.dataBase64.replace(/\s+/g, '');
      if (!isValidBase64(cleanBase64)) {
        throw new ValidationError('El payload Base64 contiene caracteres inválidos o relleno (padding) incorrecto.');
      }

      // Decodificar y validar firma mágica binaria
      const buffer = Buffer.from(cleanBase64, 'base64');
      validateFileSignatureAndMime(buffer, body.mimeType, body.filename);

      const proposal = await omrService.processUpload(
        {
          buffer,
          filename: body.filename,
          mimeType: body.mimeType,
          fileSizeBytes: buffer.length,
        },
        user
      );

      return reply.status(201).send({
        data: proposal,
      });
    }
  );

  // 2. GET /api/v1/omr/proposals/:proposalId - Obtener propuesta autoritativa desde PostgreSQL
  fastify.get(
    '/proposals/:proposalId',
    {
      preHandler: [authGuard.requirePermission('songs:read', true)],
    },
    async (request, reply) => {
      const { proposalId } = ProposalIdParamSchema.parse(request.params);
      const user = extractAuthenticatedPrincipal(request);

      const proposal = await omrService.getProposal(proposalId, user);
      return reply.status(200).send({
        data: proposal,
      });
    }
  );

  // 3. POST /api/v1/omr/proposals/:proposalId/review - Revisión humana obligatoria (Aprobar / Rechazar)
  fastify.post(
    '/proposals/:proposalId/review',
    {
      preHandler: [authGuard.requirePermission('songs:update_draft', true)],
    },
    async (request, reply) => {
      const { proposalId } = ProposalIdParamSchema.parse(request.params);
      const body = ReviewOmrBodySchema.parse(request.body);
      const user = extractAuthenticatedPrincipal(request);

      const reviewed = await omrService.reviewProposal(
        proposalId,
        body.status,
        user,
        body.notes
      );

      return reply.status(200).send({
        data: reviewed,
      });
    }
  );

  // 4. PATCH /api/v1/omr/proposals/:proposalId/measures/:measureNumber - Edición de compás (Semántica PATCH segura R3.2-04)
  fastify.patch(
    '/proposals/:proposalId/measures/:measureNumber',
    {
      preHandler: [authGuard.requirePermission('songs:update_draft', true)],
    },
    async (request, reply) => {
      const { proposalId, measureNumber } = MeasureParamSchema.parse(request.params);
      const body = PatchMeasureBodySchema.parse(request.body);
      const user = extractAuthenticatedPrincipal(request);

      if (body.measure.measureNumber !== measureNumber) {
        throw new ValidationError('El número de compás en la URL no coincide con el cuerpo del mensaje.');
      }

      const updatedMeasure = await omrService.updateMeasure(proposalId, body.measure, user);
      return reply.status(200).send({
        data: {
          message: `Compás ${measureNumber} actualizado exitosamente.`,
          measure: updatedMeasure,
        },
      });
    }
  );

  // 5. POST /api/v1/omr/proposals/:proposalId/commit - Compromiso atómico al catálogo canónico
  fastify.post(
    '/proposals/:proposalId/commit',
    {
      preHandler: [authGuard.requirePermission('songs:create', true)],
    },
    async (request, reply) => {
      const { proposalId } = ProposalIdParamSchema.parse(request.params);
      const body = CommitOmrBodySchema.parse(request.body ?? {});
      const user = extractAuthenticatedPrincipal(request);

      const result = await omrService.commitToCanonicalSong(
        proposalId,
        user,
        body.overrides
      );

      return reply.status(201).send({
        data: result,
      });
    }
  );

  // 6. GET /api/v1/omr/proposals/:proposalId/audit - Consulta del historial inmutable de auditoría
  fastify.get(
    '/proposals/:proposalId/audit',
    {
      preHandler: [authGuard.requirePermission('audit:read', true)],
    },
    async (request, reply) => {
      const { proposalId } = ProposalIdParamSchema.parse(request.params);
      const user = extractAuthenticatedPrincipal(request);

      const history = await omrService.getAuditHistory(proposalId, user);
      return reply.status(200).send({
        data: history,
      });
    }
  );

  // 7. DELETE /api/v1/omr/proposals/:proposalId - Eliminación de propuesta sin auditoría
  fastify.delete(
    '/proposals/:proposalId',
    {
      preHandler: [authGuard.requirePermission('songs:delete', true)],
    },
    async (request, reply) => {
      const { proposalId } = ProposalIdParamSchema.parse(request.params);
      const user = extractAuthenticatedPrincipal(request);

      await omrService.deleteProposal(proposalId, user);
      return reply.status(204).send();
    }
  );
};
