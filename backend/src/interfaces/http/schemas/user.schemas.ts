/**
 * @file user.schemas.ts
 * @description Esquemas de validación Zod para endpoints de gestión de usuarios y RBAC (Fase 2B).
 */

import { z } from 'zod';
import { UserRoleEnum } from '../../../domain/auth-types.ts';

export const InviteUserBodySchema = z.object({
  email: z.string().email('El correo electrónico no es válido'),
  firstName: z.string().min(1, 'El nombre es obligatorio'),
  lastName: z.string().min(1, 'El apellido es obligatorio'),
  role: z.enum(UserRoleEnum),
});

export const ChangeUserRoleBodySchema = z.object({
  role: z.enum(UserRoleEnum),
});

export const UserIdParamSchema = z.object({
  id: z.string().uuid('El ID de usuario debe ser un UUID válido'),
});

export const ListUsersQuerySchema = z.object({
  limit: z.coerce.number().min(1).max(100).default(20),
  offset: z.coerce.number().min(0).default(0),
  role: z.enum(UserRoleEnum).optional(),
});

export type InviteUserBody = z.infer<typeof InviteUserBodySchema>;
export type ChangeUserRoleBody = z.infer<typeof ChangeUserRoleBodySchema>;
export type UserIdParam = z.infer<typeof UserIdParamSchema>;
export type ListUsersQuery = z.infer<typeof ListUsersQuerySchema>;
