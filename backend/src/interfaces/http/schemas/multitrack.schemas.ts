/**
 * @file multitrack.schemas.ts
 * @description Esquemas Zod para la validación de solicitudes HTTP en el módulo de multipistas (Fase 3C / R1-A).
 */

import { z } from 'zod';

const MULTITRACK_TRACK_TYPES = [
  'CLICK',
  'CUES',
  'DRUMS',
  'BASS',
  'GUITAR',
  'KEYS',
  'VOCALS',
  'OTHER',
] as const;

export const MultitrackTrackSchema = z.object({
  name: z.string().min(1, 'El nombre de la pista es requerido').max(255),
  trackType: z.enum(MULTITRACK_TRACK_TYPES),
  audioAssetId: z.string().uuid('El ID de AudioAsset debe ser un UUID válido'),
  volume: z.number().min(0.0).max(1.0).optional().default(0.8),
  pan: z.number().min(-1.0).max(1.0).optional().default(0.0),
  isMuted: z.boolean().optional().default(false),
  isSolo: z.boolean().optional().default(false),
  offsetMs: z.number().int().min(-5000).max(5000).optional().default(0),
  sortOrder: z.number().int().positive().optional(),
});

export const CreateMultitrackSessionBodySchema = z.object({
  songId: z.string().uuid('El ID de la canción debe ser un UUID válido'),
  title: z.string().min(1, 'El título de la sesión es requerido').max(255),
  durationSeconds: z.number().int().nonnegative().optional().default(0),
  bpm: z.number().int().min(20).max(300).optional().default(120),
  tracks: z.array(MultitrackTrackSchema).min(1, 'Una sesión multipista requiere al menos una pista (stem)'),
});

export const UpdateTrackMixBodySchema = z
  .object({
    volume: z.number().min(0.0).max(1.0).optional(),
    pan: z.number().min(-1.0).max(1.0).optional(),
    isMuted: z.boolean().optional(),
    isSolo: z.boolean().optional(),
  })
  .refine(
    (data) =>
      data.volume !== undefined ||
      data.pan !== undefined ||
      data.isMuted !== undefined ||
      data.isSolo !== undefined,
    {
      message: 'Debe especificar al menos un parámetro de mezcla a actualizar.',
    }
  );

export const SessionIdParamSchema = z.object({
  sessionId: z.string().uuid('El ID de la sesión debe ser un UUID válido'),
});

export const SongIdParamSchema = z.object({
  songId: z.string().uuid('El ID de la canción debe ser un UUID válido'),
});

export const TrackMixParamSchema = z.object({
  sessionId: z.string().uuid('El ID de la sesión debe ser un UUID válido'),
  trackId: z.string().uuid('El ID de la pista debe ser un UUID válido'),
});

export const OfflineStatusQuerySchema = z.object({
  availableAssets: z.string().optional(),
});
