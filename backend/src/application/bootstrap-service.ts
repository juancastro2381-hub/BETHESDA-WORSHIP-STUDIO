/**
 * @file bootstrap-service.ts
 * @description Inicialización segura del Super Administrador inicial (Bootstrap) para Bethesda Worship Studio (Fase 2B).
 *
 * Requisitos mandatorios:
 * - Credenciales de arranque estrictamente temporales desde variables de entorno.
 * - Estado forzoso: MUST_CHANGE_PASSWORD.
 * - Cero credenciales de bootstrap en Git, logs o registros de auditoría.
 */

import { env } from '../config/env.ts';
import type { IUserRepository } from '../repositories/user-repository.ts';
import type { IPasswordHasher } from '../domain/crypto/password-hasher.ts';
import type { IAuditService } from './audit-service.ts';

export async function bootstrapSuperAdmin(
  userRepo: IUserRepository,
  passwordHasher: IPasswordHasher,
  auditService: IAuditService
): Promise<void> {
  const email = env.INITIAL_SUPERADMIN_EMAIL?.trim().toLowerCase();
  const rawPassword = env.INITIAL_SUPERADMIN_PASSWORD;

  if (!email || !rawPassword) {
    return;
  }

  // Comprobar si ya existe algún SUPER_ADMIN en la base de datos
  const existingUsers = await userRepo.list({ role: 'SUPER_ADMIN', limit: 1 });
  if (existingUsers.total > 0 || existingUsers.items.length > 0) {
    return;
  }

  // Comprobar si el correo ya existe
  const existingUser = await userRepo.findByEmail(email);
  if (existingUser) {
    return;
  }

  // Hashear contraseña con Argon2id
  const passwordHash = await passwordHasher.hash(rawPassword);

  const createdUser = await userRepo.create({
    email,
    passwordHash,
    firstName: 'Super',
    lastName: 'Admin',
    role: 'SUPER_ADMIN',
    accountStatus: 'MUST_CHANGE_PASSWORD',
    emailVerified: true,
  });

  await auditService.log({
    eventType: 'USER_CREATED',
    userId: createdUser.id,
    resource: 'system:bootstrap',
    metadata: {
      email,
      role: 'SUPER_ADMIN',
      status: 'MUST_CHANGE_PASSWORD',
    },
  });

  console.log(`\n👑 Super Administrador inicial inicializado: ${email} (Debe cambiar la clave en el primer inicio de sesión)\n`);
}
