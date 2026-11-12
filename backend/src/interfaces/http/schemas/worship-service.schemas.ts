/**
 * @file worship-service.schemas.ts
 * @description Esquemas Zod para los endpoints de Cultos y Servicios Litúrgicos (Fase 2C).
 */

import { z } from 'zod';
import { WorshipServiceStatusEnum } from '../../../domain/worship-service-types.ts';

export const WorshipServiceStatusSchema = z.enum(WorshipServiceStatusEnum, {
  errorMap: () => ({
    message: "El estado debe ser uno de: 'DRAFT', 'UPCOMING', 'ACTIVE', 'COMPLETED', 'ARCHIVED'",
  }),
});

export const WorshipServiceIdParamSchema = z.object({
  id: z.string().uuid({ message: 'El parámetro id del servicio debe ser un UUID válido.' }),
});

export const ListWorshipServicesQuerySchema = z.object({
  status: WorshipServiceStatusSchema.optional(),
  serviceType: z.string().trim().min(1).max(64).optional(),
  timeframe: z.enum(['upcoming', 'completed', 'all']).optional(),
  worshipLeaderId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

const isoDateTime = z
  .string()
  .datetime({ offset: true, message: 'La fecha programada debe tener un formato ISO 8601 válido.' });

/**
 * serviceType es texto libre (no enum codificado): cada congregación define sus categorías
 * ("Culto Dominical", "Reunión de Jóvenes", "Vigilia", etc.).
 */
export const CreateWorshipServiceBodySchema = z.object({
  name: z.string().trim().min(1, 'El nombre del servicio es obligatorio.').max(255),
  description: z.string().max(2000).optional().nullable(),
  serviceType: z.string().trim().min(1).max(64).optional(),
  scheduledAt: isoDateTime,
  worshipLeaderId: z.string().uuid({ message: 'El worshipLeaderId debe ser un UUID válido.' }).optional().nullable(),
  notes: z.string().max(4000).optional().nullable(),
  status: WorshipServiceStatusSchema.optional(),
  setlistId: z.string().uuid({ message: 'El setlistId debe ser un UUID válido.' }).optional().nullable(),
});

export const UpdateWorshipServiceBodySchema = z
  .object({
    name: z.string().trim().min(1, 'El nombre no puede estar vacío.').max(255).optional(),
    description: z.string().max(2000).optional().nullable(),
    serviceType: z.string().trim().min(1).max(64).optional(),
    scheduledAt: isoDateTime.optional(),
    worshipLeaderId: z.string().uuid().optional().nullable(),
    notes: z.string().max(4000).optional().nullable(),
    status: WorshipServiceStatusSchema.optional(),
    setlistId: z.string().uuid().optional().nullable(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'Debe suministrar al menos un campo para actualizar.',
  });

export type ListWorshipServicesQuery = z.infer<typeof ListWorshipServicesQuerySchema>;
export type CreateWorshipServiceBody = z.infer<typeof CreateWorshipServiceBodySchema>;
export type UpdateWorshipServiceBody = z.infer<typeof UpdateWorshipServiceBodySchema>;

