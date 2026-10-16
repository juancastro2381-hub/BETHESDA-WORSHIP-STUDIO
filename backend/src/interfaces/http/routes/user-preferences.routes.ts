/**
 * @file user-preferences.routes.ts
 * @description Rutas HTTP para la consulta y persistencia de preferencias de vista de usuario (Fase 3A — WP-02).
 *
 * Expone:
 * - GET /api/v1/users/me/preferences
 * - PUT /api/v1/users/me/preferences
 *
 * Invariantes de Seguridad y Negocio:
 * - Autenticación JWT HS256 obligatoria mediante authGuard.requireAuth.
 * - Identidad derivada estrictamente de request.user.sub (eliminación total de IDOR).
 * - Valores por defecto de fábrica en memoria según rol (DEC-03, DEC-04, DEC-05, DEC-02).
 * - Validación exhaustiva de esquemas y compatibilidad instrumento-representación mediante Zod.
 */

import type { FastifyPluginAsync } from 'fastify';
import { env } from '../../../config/env.ts';
import {
  UpdateUserPreferencesBodySchema,
  getRoleFactoryDefault,
} from '../schemas/user-preferences.schemas.ts';
import { DrizzleUserRepository } from '../../../repositories/user-repository.ts';
import { DrizzleUserPreferencesRepository } from '../../../repositories/user-preferences-repository.ts';
import { JwtTokenService } from '../../../application/token-service.ts';
import { AuthGuard } from '../middlewares/auth-middleware.ts';
import { UnauthorizedError } from '../../../domain/errors.ts';

export const userPreferencesRoutes: FastifyPluginAsync = async (fastify) => {
  const userRepo = new DrizzleUserRepository();
  const preferencesRepo = new DrizzleUserPreferencesRepository();
  const tokenService = new JwtTokenService(env.JWT_SECRET, env.JWT_ACCESS_EXPIRES_IN);
  const authGuard = new AuthGuard(tokenService, userRepo);

  // 1. GET /api/v1/users/me/preferences
  fastify.get('/', { preHandler: authGuard.requireAuth }, async (request, reply) => {
    const userId = request.user!.sub;

    const user = await userRepo.findById(userId);
    if (!user || user.accountStatus !== 'ACTIVE') {
      throw new UnauthorizedError('Usuario no encontrado o inactivo en base de datos.');
    }

    const stored = await preferencesRepo.findByUserId(userId);
    if (stored) {
      return reply.status(200).send({
        success: true,
        data: {
          id: stored.id,
          userId: stored.userId,
          instrumentId: stored.instrumentId,
          primaryRepresentation: stored.primaryRepresentation,
          secondaryRepresentations: stored.secondaryRepresentations,
          chordNotationSystem: stored.chordNotationSystem,
          transpositionSemitones: stored.transpositionSemitones,
          capoFret: stored.capoFret,
          clefOverride: stored.clefOverride,
          preferFlats: stored.preferFlats,
          isDefault: false,
          createdAt: stored.createdAt.toISOString(),
          updatedAt: stored.updatedAt.toISOString(),
        },
      });
    }

    // Si no existen preferencias persistidas, calcular las de fábrica según rol (DEC-02..DEC-05)
    const defaults = getRoleFactoryDefault(user.role);
    return reply.status(200).send({
      success: true,
      data: {
        userId: user.id,
        instrumentId: defaults.instrumentId,
        primaryRepresentation: defaults.primaryRepresentation,
        secondaryRepresentations: defaults.secondaryRepresentations,
        chordNotationSystem: defaults.chordNotationSystem,
        transpositionSemitones: defaults.transpositionSemitones,
        capoFret: defaults.capoFret,
        clefOverride: defaults.clefOverride,
        preferFlats: defaults.preferFlats,
        isDefault: true,
      },
    });
  });

  // 2. PUT /api/v1/users/me/preferences
  fastify.put('/', { preHandler: authGuard.requireAuth }, async (request, reply) => {
    const userId = request.user!.sub;

    const user = await userRepo.findById(userId);
    if (!user || user.accountStatus !== 'ACTIVE') {
      throw new UnauthorizedError('Usuario no encontrado o inactivo en base de datos.');
    }

    const body = UpdateUserPreferencesBodySchema.parse(request.body);

    const updated = await preferencesRepo.upsert(userId, {
      instrumentId: body.instrumentId,
      primaryRepresentation: body.primaryRepresentation,
      secondaryRepresentations: body.secondaryRepresentations,
      chordNotationSystem: body.chordNotationSystem,
      transpositionSemitones: body.transpositionSemitones,
      capoFret: body.capoFret,
      clefOverride: body.clefOverride !== undefined ? body.clefOverride : null,
      preferFlats: body.preferFlats,
    });

    return reply.status(200).send({
      success: true,
      data: {
        id: updated.id,
        userId: updated.userId,
        instrumentId: updated.instrumentId,
        primaryRepresentation: updated.primaryRepresentation,
        secondaryRepresentations: updated.secondaryRepresentations,
        chordNotationSystem: updated.chordNotationSystem,
        transpositionSemitones: updated.transpositionSemitones,
        capoFret: updated.capoFret,
        clefOverride: updated.clefOverride,
        preferFlats: updated.preferFlats,
        isDefault: false,
        createdAt: updated.createdAt.toISOString(),
        updatedAt: updated.updatedAt.toISOString(),
      },
    });
  });
};
