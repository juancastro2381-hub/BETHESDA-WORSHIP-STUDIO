/**
 * @file omr.routes.ts
 * @description Endpoints RESTful para Reconocimiento Óptico de Música (OMR), revisión humana,
 * auditoría inmutable y compromiso al catálogo canónico con trazabilidad completa de autenticación (R3.1-05).
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
import type { AuthenticatedUser } from '../../../domain/omr/types.ts';

// ---------------------------------------------------------------------------
// Schemas de Validación de Entrada HTTP
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
  dataBase64: z.string().min(1, 'El contenido del archivo en base64 no puede estar vacío'),
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

const UpdateMeasureBodySchema = z.object({
  measure: z.object({
    measureNumber: z.number().int().positive(),
    timeSignature: z.string().optional(),
    keySignature: z.string().optional(),
    chordsDetected: z.array(z.any()).default([]),
    notesDetected: z.array(z.any()).default([]),
    lyricsDetected: z.array(z.any()).default([]),
    measureConfidence: z.number().min(0).max(1).default(1),
    flags: z.array(z.string()).default([]),
  }),
});

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

  // 1. POST /api/v1/omr/upload - Ingesta OMR y generación de propuesta preliminar
  fastify.post(
    '/upload',
    {
      preHandler: [authGuard.requirePermission('songs:create', true)],
    },
    async (request, reply) => {
      const body = UploadOmrBodySchema.parse(request.body);
      const user = extractAuthenticatedPrincipal(request);
      const buffer = Buffer.from(body.dataBase64, 'base64');

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

  // 4. PATCH /api/v1/omr/proposals/:proposalId/measures/:measureNumber - Edición de compás
  fastify.patch(
    '/proposals/:proposalId/measures/:measureNumber',
    {
      preHandler: [authGuard.requirePermission('songs:update_draft', true)],
    },
    async (request, reply) => {
      const { proposalId, measureNumber } = MeasureParamSchema.parse(request.params);
      const body = UpdateMeasureBodySchema.parse(request.body);
      const user = extractAuthenticatedPrincipal(request);

      if (body.measure.measureNumber !== measureNumber) {
        throw new ValidationError('El número de compás en la URL no coincide con el cuerpo del mensaje.');
      }

      await omrService.updateMeasure(proposalId, body.measure, user);
      return reply.status(200).send({
        data: { message: `Compás ${measureNumber} actualizado exitosamente.` },
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

  // 7. DELETE /api/v1/omr/proposals/:proposalId - Eliminación (restringida si existe auditoría)
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
