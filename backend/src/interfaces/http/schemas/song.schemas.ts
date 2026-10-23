/**
 * @file song.schemas.ts
 * @description Esquemas Zod y definiciones DTO para los endpoints de la API HTTP (Fase 2A).
 */

import { z } from 'zod';

export const SongReviewStatusSchema = z.enum(['DRAFT', 'APPROVED', 'ARCHIVED']);
export const SongSourceFormatSchema = z.enum(['MUSIC_XML', 'CHORD_PRO', 'INTERNAL', 'PDF', 'IMAGE']);

export const ListSongsQuerySchema = z.object({
  search: z.string().optional(),
  status: SongReviewStatusSchema.optional(),
  limit: z.coerce.number().min(1).max(100).default(20),
  offset: z.coerce.number().min(0).default(0),
});

export const SongIdParamSchema = z.object({
  songId: z.string().uuid({ message: 'El parámetro songId debe ser un UUID válido.' }),
});

export const VersionIdParamSchema = z.object({
  songId: z.string().uuid({ message: 'El parámetro songId debe ser un UUID válido.' }),
  versionId: z.string().uuid({ message: 'El parámetro versionId debe ser un UUID válido.' }),
});

export const CreateSongBodySchema = z.object({
  title: z.string().min(1, 'El título de la canción es obligatorio.').max(255),
  artist: z.string().max(255).optional().nullable(),
  ccliNumber: z.string().max(64).optional().nullable(),
  defaultKey: z.string().min(1).max(16),
  defaultBpm: z.number().int().min(20).max(300).default(120),
  timeSignature: z.string().min(3).max(16).default('4/4'),
  status: SongReviewStatusSchema.default('DRAFT'),
  versionName: z.string().max(255).optional(),
  versionDescription: z.string().optional(),
  sourceFormat: SongSourceFormatSchema,
  canonicalPayload: z.record(z.unknown()), // Se valida exhaustivamente con CanonicalDeserializer en servidor
  sourceRecord: z
    .object({
      filename: z.string().optional(),
      rawContent: z.string().optional(),
      importerName: z.string(),
      importerVersion: z.string(),
    })
    .optional(),
  metadata: z
    .object({
      tags: z.array(z.string()).optional(),
      themes: z.array(z.string()).optional(),
      copyright: z.string().optional(),
      notes: z.string().optional(),
    })
    .optional(),
});

export const CreateVersionBodySchema = z.object({
  name: z.string().min(1).max(255).default('Nueva Versión'),
  description: z.string().optional(),
  sourceFormat: SongSourceFormatSchema,
  canonicalPayload: z.record(z.unknown()),
  setAsCurrent: z.boolean().default(true),
  sourceRecord: z
    .object({
      filename: z.string().optional(),
      rawContent: z.string().optional(),
      importerName: z.string(),
      importerVersion: z.string(),
    })
    .optional(),
});

export const ImportSourceBodySchema = z.object({
  source: z.string().min(1, 'El contenido fuente musical es obligatorio.'),
  filename: z.string().optional(),
  artist: z.string().optional(),
  versionName: z.string().optional(),
  tags: z.array(z.string()).optional(),
});
