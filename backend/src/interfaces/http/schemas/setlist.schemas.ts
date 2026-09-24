/**
 * @file setlist.schemas.ts
 * @description Esquemas de validación Zod y tipos DTO para los endpoints de Setlists y Momentos de Servicio (Fase 2C).
 */

import { z } from 'zod';
import {
  SetlistStatusEnum,
  SetlistItemTypeEnum,
  TransitionTypeEnum,
} from '../../../domain/setlist-types.ts';

// ============================================================================
// ENUMS DE VALIDACIÓN
// ============================================================================

export const SetlistStatusSchema = z.enum(SetlistStatusEnum, {
  errorMap: () => ({
    message: "El estado debe ser uno de: 'PLANNING', 'ACTIVE', 'COMPLETED', 'ARCHIVED'",
  }),
});

export const SetlistItemTypeSchema = z.enum(SetlistItemTypeEnum, {
  errorMap: () => ({
    message: "El tipo de ítem debe ser 'SONG' o 'SERVICE_MOMENT'",
  }),
});

export const TransitionTypeSchema = z.enum(TransitionTypeEnum, {
  errorMap: () => ({
    message: "El tipo de transición debe ser 'SEGUE', 'CROSSFADE', 'STOP' o 'MEDLEY'",
  }),
});

// ============================================================================
// PARÁMETROS DE RUTA
// ============================================================================

export const SetlistIdParamSchema = z.object({
  id: z.string().uuid({ message: 'El parámetro id de setlist debe ser un UUID válido.' }),
});

export const SetlistItemIdParamSchema = z.object({
  id: z.string().uuid({ message: 'El parámetro id de setlist debe ser un UUID válido.' }),
  itemId: z.string().uuid({ message: 'El parámetro itemId debe ser un UUID válido.' }),
});

// ============================================================================
// CONSULTA (QUERY PARAMS)
// ============================================================================

export const ListSetlistsQuerySchema = z.object({
  status: SetlistStatusSchema.optional(),
  upcoming: z
    .preprocess((val) => {
      if (typeof val === 'string') {
        return val.toLowerCase() === 'true';
      }
      return val;
    }, z.boolean())
    .optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

// ============================================================================
// CREACIÓN Y ACTUALIZACIÓN DE SETLIST
// ============================================================================

export const CreateSetlistBodySchema = z.object({
  title: z
    .string()
    .min(1, 'El título del setlist es obligatorio.')
    .max(255, 'El título no puede exceder 255 caracteres.'),
  scheduledDateTime: z
    .string()
    .datetime({ message: 'La fecha programada debe tener un formato ISO 8601 válido.' })
    .optional()
    .nullable(),
  directorUserId: z
    .string()
    .uuid({ message: 'El directorUserId debe ser un UUID válido.' })
    .optional()
    .nullable(),
  notes: z
    .string()
    .max(2000, 'Las notas no pueden exceder 2000 caracteres.')
    .optional()
    .nullable(),
});

export const UpdateSetlistBodySchema = z.object({
  title: z
    .string()
    .min(1, 'El título no puede estar vacío.')
    .max(255, 'El título no puede exceder 255 caracteres.')
    .optional(),
  scheduledDateTime: z
    .string()
    .datetime({ message: 'La fecha programada debe tener un formato ISO 8601 válido.' })
    .optional()
    .nullable(),
  directorUserId: z
    .string()
    .uuid({ message: 'El directorUserId debe ser un UUID válido.' })
    .optional()
    .nullable(),
  notes: z
    .string()
    .max(2000, 'Las notas no pueden exceder 2000 caracteres.')
    .optional()
    .nullable(),
});

export const SetlistStatusTransitionBodySchema = z.object({
  status: SetlistStatusSchema,
});

// ============================================================================
// CREACIÓN POLIMÓRFICA DE ELEMENTOS (SETLIST ITEMS)
// ============================================================================

/**
 * Payload específico para un ítem de tipo SONG.
 * Requiere songId como identidad semántica y permite sobreescrituras litúrgicas.
 */
export const CreateSongItemPayloadSchema = z.object({
  itemType: z.literal('SONG'),
  songId: z.string().uuid({ message: 'El songId es obligatorio y debe ser un UUID válido.' }),
  targetKey: z
    .string()
    .min(1, 'El targetKey no puede estar vacío.')
    .max(16, 'El targetKey no puede exceder 16 caracteres.')
    .optional()
    .nullable(),
  targetBpm: z
    .number()
    .int('El BPM debe ser un número entero.')
    .min(20, 'El BPM mínimo permitido es 20.')
    .max(300, 'El BPM máximo permitido es 300.')
    .optional()
    .nullable(),
  transitionType: TransitionTypeSchema.default('STOP'),
  notesForTeam: z
    .string()
    .max(2000, 'Las notas para el equipo no pueden exceder 2000 caracteres.')
    .optional()
    .nullable(),
  sequenceOrder: z.number().int().min(1).optional(),
});

/**
 * Payload específico para un ítem de tipo SERVICE_MOMENT.
 * Requiere momentTitle y prohíbe songId.
 */
export const CreateServiceMomentItemPayloadSchema = z.object({
  itemType: z.literal('SERVICE_MOMENT'),
  songId: z
    .never({
      message: 'Un momento litúrgico no puede referenciar una canción (songId no permitido).',
    })
    .optional(),
  momentTitle: z
    .string()
    .min(1, 'El título del momento litúrgico es obligatorio.')
    .max(255, 'El título no puede exceder 255 caracteres.'),
  durationMinutes: z
    .number()
    .int('La duración en minutos debe ser un número entero.')
    .min(1, 'La duración mínima es 1 minuto.')
    .max(180, 'La duración máxima permitida es 180 minutos.')
    .optional()
    .nullable(),
  musicalKey: z
    .string()
    .min(1, 'La clave musical no puede estar vacía.')
    .max(16, 'La clave musical no puede exceder 16 caracteres.')
    .optional()
    .nullable(),
  notesForTeam: z
    .string()
    .max(2000, 'Las notas para el equipo no pueden exceder 2000 caracteres.')
    .optional()
    .nullable(),
  sequenceOrder: z.number().int().min(1).optional(),
});

/**
 * Unión discriminada para creación de ítems: previene mezclas inválidas entre canción y momento.
 */
export const CreateSetlistItemBodySchema = z.discriminatedUnion('itemType', [
  CreateSongItemPayloadSchema,
  CreateServiceMomentItemPayloadSchema,
]);

// ============================================================================
// ACTUALIZACIÓN DE ELEMENTOS (SETLIST ITEMS)
// ============================================================================

export const UpdateSetlistItemBodySchema = z
  .object({
    targetKey: z.string().min(1).max(16).optional().nullable(),
    targetBpm: z.number().int().min(20).max(300).optional().nullable(),
    transitionType: TransitionTypeSchema.optional(),
    momentTitle: z.string().min(1).max(255).optional().nullable(),
    durationMinutes: z.number().int().min(1).max(180).optional().nullable(),
    musicalKey: z.string().min(1).max(16).optional().nullable(),
    notesForTeam: z.string().max(2000).optional().nullable(),
  })
  .refine(
    (data) => Object.keys(data).length > 0,
    { message: 'Debe suministrar al menos un campo para actualizar.' }
  );

// ============================================================================
// REORDENAMIENTO ATÓMICO TRANSACCIONAL
// ============================================================================

export const ReorderSetlistItemsBodySchema = z.object({
  itemIds: z
    .array(
      z.string().uuid({ message: 'Cada elemento en itemIds debe ser un UUID válido.' })
    )
    .min(1, 'La lista de reordenamiento debe contener al menos un elemento.')
    .refine((items) => new Set(items).size === items.length, {
      message: 'La lista de itemIds no puede contener identificadores duplicados.',
    }),
});

// ============================================================================
// TIPOS INFERIDOS DE SCHEMAS
// ============================================================================

export type SetlistIdParam = z.infer<typeof SetlistIdParamSchema>;
export type SetlistItemIdParam = z.infer<typeof SetlistItemIdParamSchema>;
export type ListSetlistsQuery = z.infer<typeof ListSetlistsQuerySchema>;
export type CreateSetlistBody = z.infer<typeof CreateSetlistBodySchema>;
export type UpdateSetlistBody = z.infer<typeof UpdateSetlistBodySchema>;
export type SetlistStatusTransitionBody = z.infer<typeof SetlistStatusTransitionBodySchema>;
export type CreateSongItemPayload = z.infer<typeof CreateSongItemPayloadSchema>;
export type CreateServiceMomentItemPayload = z.infer<typeof CreateServiceMomentItemPayloadSchema>;
export type CreateSetlistItemBody = z.infer<typeof CreateSetlistItemBodySchema>;
export type UpdateSetlistItemBody = z.infer<typeof UpdateSetlistItemBodySchema>;
export type ReorderSetlistItemsBody = z.infer<typeof ReorderSetlistItemsBodySchema>;
