/**
 * @file password-reset-service.ts
 * @description Servicio de aplicación para restablecimiento seguro de contraseña con protección anti-enumeración (Fase 2B).
 */

import type { IUserRepository } from '../repositories/user-repository.ts';
import type { IPasswordResetTokenRepository } from '../repositories/password-reset-repository.ts';
import type { IRefreshTokenRepository } from '../repositories/refresh-token-repository.ts';
import type { IPasswordHasher } from '../domain/crypto/password-hasher.ts';
import type { IAuditService } from './audit-service.ts';
import { generateSecureToken, hashToken } from '../domain/crypto/token-utils.ts';
import { ValidationError } from '../domain/errors.ts';

export class PasswordResetService {
  public constructor(
    private readonly userRepo: IUserRepository,
    private readonly resetRepo: IPasswordResetTokenRepository,
    private readonly refreshTokenRepo: IRefreshTokenRepository,
    private readonly passwordHasher: IPasswordHasher,
    private readonly auditService: IAuditService
  ) {}

  /**
   * Solicita el restablecimiento de clave.
   * COMPORTAMIENTO ANTI-ENUMERACIÓN: Siempre retorna la misma respuesta independientemente de si el correo existe.
   */
  public async requestPasswordReset(
    email: string,
    context?: { ipAddress?: string | null }
  ): Promise<{ message: string; rawTokenForDev?: string }> {
    return this.forgotPassword(email, context);
  }

  public async forgotPassword(
    email: string,
    context?: { ipAddress?: string | null }
  ): Promise<{ message: string; rawTokenForDev?: string }> {
    const normalizedEmail = email?.trim().toLowerCase();
    const genericResponse = {
      message: 'Si el correo electrónico se encuentra registrado en nuestro sistema, se ha enviado un enlace de recuperación.',
    };

    if (!normalizedEmail) {
      return genericResponse;
    }

    const user = await this.userRepo.findByEmail(normalizedEmail);

    if (user && user.accountStatus === 'ACTIVE') {
      // 1. Generar token aleatorio criptográfico (256 bits)
      const rawToken = generateSecureToken(32);
      const tokenHash = hashToken(rawToken);
      const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 minutos

      // 2. Persistir token hasheado
      await this.resetRepo.create({
        userId: user.id,
        tokenHash,
        expiresAt,
        ipAddress: context?.ipAddress,
      });

      await this.auditService.log({
        eventType: 'PASSWORD_RESET_REQUESTED',
        userId: user.id,
        resource: 'auth',
        ipAddress: context?.ipAddress,
        metadata: { email: normalizedEmail, expiresAt },
      });

      // En desarrollo, podemos adjuntar el token para pruebas automatizadas si no hay servicio SMTP
      return {
        ...genericResponse,
        rawTokenForDev: process.env.NODE_ENV !== 'production' ? rawToken : undefined,
      };
    }

    // Si el usuario no existe, registramos un intento no válido en auditoría sin filtrar al cliente
    await this.auditService.log({
      eventType: 'PASSWORD_RESET_REQUESTED',
      resource: 'auth',
      ipAddress: context?.ipAddress,
      metadata: { email: normalizedEmail, status: 'NOT_FOUND_OR_INACTIVE' },
    });

    return genericResponse;
  }

  /**
   * Consume el token de recuperación, valida su vigencia y actualiza la contraseña con Argon2id.
   * Revoca inmediatamente todas las sesiones de refresco activas del usuario.
   */
  public async resetPassword(
    token: string,
    newPassword: string,
    context?: { ipAddress?: string | null }
  ): Promise<{ message: string }> {
    if (!token || typeof token !== 'string') {
      throw new ValidationError('El token de recuperación es requerido.');
    }

    if (!newPassword || newPassword.length < 10) {
      throw new ValidationError('La nueva contraseña debe contener al menos 10 caracteres.');
    }

    const tokenHash = hashToken(token);
    const resetToken = await this.resetRepo.findByTokenHash(tokenHash);

    if (!resetToken || resetToken.isUsed || resetToken.expiresAt < new Date()) {
      throw new ValidationError('El enlace de recuperación es inválido, ya fue utilizado o ha expirado.');
    }

    const user = await this.userRepo.findById(resetToken.userId);
    if (!user) {
      throw new ValidationError('El usuario asociado al token no existe.');
    }

    // Hashear nueva contraseña con Argon2id
    const newHash = await this.passwordHasher.hash(newPassword);

    // Actualizar contraseña e incrementar tokenVersion
    await this.userRepo.updatePassword(user.id, newHash);

    // Marcar token de reset como consumido
    await this.resetRepo.markUsed(resetToken.id);

    // REVOCAR TODAS LAS SESIONES ACTIVAS DEL USUARIO
    await this.refreshTokenRepo.revokeAllForUser(user.id);

    await this.auditService.log({
      eventType: 'PASSWORD_RESET_COMPLETED',
      userId: user.id,
      resource: 'auth',
      ipAddress: context?.ipAddress,
      metadata: { email: user.email },
    });

    return { message: 'Contraseña actualizada con éxito. Puede iniciar sesión con su nueva clave.' };
  }
}
