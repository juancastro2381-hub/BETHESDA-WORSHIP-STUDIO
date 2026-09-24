/**
 * @file auth.schemas.ts
 * @description Esquemas de validación Zod para endpoints de autenticación y sesiones (Fase 2B).
 */

import { z } from 'zod';

export const LoginBodySchema = z.object({
  email: z.string().email('El correo electrónico no es válido'),
  password: z.string().min(1, 'La contraseña es obligatoria'),
});

export const AcceptInviteBodySchema = z.object({
  token: z.string().min(32, 'El token de invitación es inválido'),
  password: z
    .string()
    .min(10, 'La contraseña debe tener al menos 10 caracteres')
    .regex(/[A-Z]/, 'Debe contener al menos una mayúscula')
    .regex(/[a-z]/, 'Debe contener al menos una minúscula')
    .regex(/[0-9]/, 'Debe contener al menos un número')
    .regex(/[^A-Za-z0-9]/, 'Debe contener al menos un carácter especial'),
});

export const ForgotPasswordBodySchema = z.object({
  email: z.string().email('El correo electrónico no es válido'),
});

export const ResetPasswordBodySchema = z.object({
  token: z.string().min(32, 'El token de recuperación es inválido'),
  newPassword: z
    .string()
    .min(10, 'La nueva contraseña debe tener al menos 10 caracteres')
    .regex(/[A-Z]/, 'Debe contener al menos una mayúscula')
    .regex(/[a-z]/, 'Debe contener al menos una minúscula')
    .regex(/[0-9]/, 'Debe contener al menos un número')
    .regex(/[^A-Za-z0-9]/, 'Debe contener al menos un carácter especial'),
});

export const ChangeInitialPasswordBodySchema = z.object({
  currentPassword: z.string().min(1, 'La contraseña actual es requerida'),
  newPassword: z
    .string()
    .min(10, 'La nueva contraseña debe tener al menos 10 caracteres')
    .regex(/[A-Z]/, 'Debe contener al menos una mayúscula')
    .regex(/[a-z]/, 'Debe contener al menos una minúscula')
    .regex(/[0-9]/, 'Debe contener al menos un número')
    .regex(/[^A-Za-z0-9]/, 'Debe contener al menos un carácter especial'),
});

export type LoginBody = z.infer<typeof LoginBodySchema>;
export type AcceptInviteBody = z.infer<typeof AcceptInviteBodySchema>;
export type ForgotPasswordBody = z.infer<typeof ForgotPasswordBodySchema>;
export type ResetPasswordBody = z.infer<typeof ResetPasswordBodySchema>;
export type ChangeInitialPasswordBody = z.infer<typeof ChangeInitialPasswordBodySchema>;
