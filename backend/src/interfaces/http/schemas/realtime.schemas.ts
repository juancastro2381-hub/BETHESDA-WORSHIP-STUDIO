/**
 * @file realtime.schemas.ts
 * @description Esquemas de validación Zod para las rutas HTTP y eventos de tiempo real (Fase 3B).
 */

import { z } from 'zod';

export const CreateRealtimeSessionBodySchema = z.object({
  setlistId: z.string().uuid({ message: 'El setlistId debe ser un UUID válido.' }),
  initialItemIndex: z.number().int().min(0).optional().default(0),
});

export type CreateRealtimeSessionBody = z.infer<typeof CreateRealtimeSessionBodySchema>;

export const RealtimeSessionParamSchema = z.object({
  sessionId: z.string().uuid({ message: 'El sessionId debe ser un UUID válido.' }),
});

export type RealtimeSessionParam = z.infer<typeof RealtimeSessionParamSchema>;

export const RealtimeActionBodySchema = z.object({
  actionId: z.string().min(1).max(64),
  expectedSequence: z.number().int().nonnegative().optional(),
  type: z.enum([
    'SET_ITEM_INDEX',
    'SET_SECTION',
    'SET_KEY_OVERRIDE',
    'SET_BPM_OVERRIDE',
    'SET_STATUS',
  ]),
  payload: z.object({
    itemIndex: z.number().int().min(0).optional(),
    section: z.string().max(64).nullable().optional(),
    keyOverride: z.string().max(16).nullable().optional(),
    bpmOverride: z.number().int().min(30).max(300).nullable().optional(),
    status: z.enum(['ACTIVE', 'PAUSED', 'CONCLUDED']).optional(),
  }),
});

export type RealtimeActionBody = z.infer<typeof RealtimeActionBodySchema>;

export const RealtimeStreamQuerySchema = z.object({
  token: z.string().optional(),
});

export type RealtimeStreamQuery = z.infer<typeof RealtimeStreamQuerySchema>;
