/**
 * @file auth-service.ts
 * @description Servicio de aplicación de Autenticación, Sesiones y Rotación de Tokens con Detección de Reuso (Fase 2B).
 */

import crypto from 'node:crypto';
import type { IUserRepository } from '../repositories/user-repository.ts';
import type { IRefreshTokenRepository } from '../repositories/refresh-token-repository.ts';
import type { IPasswordHasher } from '../domain/crypto/password-hasher.ts';
import type { ITokenService } from './token-service.ts';
import type { IAuditService } from './audit-service.ts';
import { generateSecureToken, hashToken } from '../domain/crypto/token-utils.ts';
import type { UserEntity, UserRole } from '../domain/auth-types.ts';
import {
  InvalidCredentialsError,
  AccountLockedError,
  TokenExpiredError,
  TokenInvalidError,
  UnauthorizedError,
  ValidationError,
} from '../domain/errors.ts';

export interface LoginResult {
  accessToken: string;
  rawRefreshToken: string;
  refreshToken: string;
  expiresIn: number;
  user: {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
    role: UserRole;
    mustChangePassword: boolean;
  };
}

export interface RefreshResult {
  accessToken: string;
  rawRefreshToken: string;
  refreshToken: string;
  expiresIn: number;
  user: {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
    role: UserRole;
    mustChangePassword: boolean;
  };
}

export class AuthService {
  public constructor(
    private readonly userRepo: IUserRepository,
    private readonly refreshTokenRepo: IRefreshTokenRepository,
    private readonly passwordHasher: IPasswordHasher,
    private readonly tokenService: ITokenService,
    private readonly auditService: IAuditService
  ) {}

  /**
   * Autenticación principal de usuarios con mitigación de ataques de fuerza bruta y bloqueo temporal.
   */
  public async login(
    email: string,
    password: string,
    context?: { ipAddress?: string | null; userAgent?: string | null }
  ): Promise<LoginResult> {
    const normalizedEmail = email?.trim().toLowerCase();
    if (!normalizedEmail || !password) {
      throw new InvalidCredentialsError();
    }

    const user = await this.userRepo.findByEmail(normalizedEmail);

    // Comportamiento anti-enumeración: Si no existe el usuario, calcular hash ficticio para mitigar timing attacks
    if (!user) {
      await this.passwordHasher.verify(password, '$argon2id$v=19$m=65536,t=3,p=4$dummy_salt$dummy_hash');
      await this.auditService.log({
        eventType: 'LOGIN_FAILURE',
        resource: 'auth',
        ipAddress: context?.ipAddress,
        userAgent: context?.userAgent,
        metadata: { email: normalizedEmail, reason: 'USER_NOT_FOUND' },
      });
      throw new InvalidCredentialsError();
    }

    // Comprobar estado de cuenta
    if (user.accountStatus === 'SUSPENDED' || user.accountStatus === 'PENDING_INVITATION') {
      throw new InvalidCredentialsError('La cuenta no se encuentra activa para iniciar sesión.');
    }

    // Comprobar bloqueo temporal por intentos fallidos
    if (user.accountStatus === 'LOCKED' && user.lockoutUntil) {
      if (new Date() < user.lockoutUntil) {
        await this.auditService.log({
          eventType: 'LOGIN_FAILURE',
          userId: user.id,
          resource: 'auth',
          ipAddress: context?.ipAddress,
          userAgent: context?.userAgent,
          metadata: { email: normalizedEmail, reason: 'ACCOUNT_LOCKED', lockoutUntil: user.lockoutUntil },
        });
        throw new AccountLockedError(`Cuenta bloqueada temporalmente hasta: ${user.lockoutUntil.toISOString()}`);
      } else {
        // Bloqueo expirado: restaurar a ACTIVE
        await this.userRepo.updateStatus(user.id, 'ACTIVE');
      }
    }

    // Verificar contraseña con Argon2id
    const isPasswordValid = await this.passwordHasher.verify(password, user.passwordHash);

    if (!isPasswordValid) {
      const lockResult = await this.userRepo.recordFailedLogin(user.id);
      await this.auditService.log({
        eventType: lockResult.isLocked ? 'ACCOUNT_LOCKED' : 'LOGIN_FAILURE',
        userId: user.id,
        resource: 'auth',
        ipAddress: context?.ipAddress,
        userAgent: context?.userAgent,
        metadata: {
          email: normalizedEmail,
          failedAttempts: lockResult.failedAttempts,
          locked: lockResult.isLocked,
        },
      });

      if (lockResult.isLocked) {
        throw new AccountLockedError('Cuenta bloqueada por exceso de intentos fallidos (5 intentos).');
      }

      throw new InvalidCredentialsError();
    }

    // Login exitoso: resetear contadores y registrar timestamp
    await this.userRepo.recordSuccessfulLogin(user.id);

    // 1. Generar Access Token (HS256, 15 min, en memoria)
    const { token: accessToken, expiresIn } = this.tokenService.signAccessToken({
      id: user.id,
      email: user.email,
      role: user.role,
    });

    // 2. Generar Refresh Token criptográfico opaco
    const rawRefreshToken = generateSecureToken(32);
    const tokenHash = hashToken(rawRefreshToken);
    const familyId = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 días

    await this.refreshTokenRepo.create({
      userId: user.id,
      tokenHash,
      familyId,
      expiresAt,
      userAgent: context?.userAgent,
      ipAddress: context?.ipAddress,
    });

    await this.auditService.log({
      eventType: 'LOGIN_SUCCESS',
      userId: user.id,
      resource: 'auth',
      ipAddress: context?.ipAddress,
      userAgent: context?.userAgent,
      metadata: { email: user.email, role: user.role, familyId },
    });

    return {
      accessToken,
      rawRefreshToken,
      refreshToken: rawRefreshToken,
      expiresIn,
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
        mustChangePassword: user.accountStatus === 'MUST_CHANGE_PASSWORD',
      },
    };
  }

  /**
   * Renovación segura de sesión con rotación unívoca y detección de ataques de reutilización (Token Replay).
   */
  public async refresh(
    rawRefreshToken: string,
    context?: { ipAddress?: string | null; userAgent?: string | null }
  ): Promise<RefreshResult> {
    if (!rawRefreshToken || typeof rawRefreshToken !== 'string') {
      throw new TokenInvalidError('Token de refresco ausente.');
    }

    const tokenHash = hashToken(rawRefreshToken);
    const storedToken = await this.refreshTokenRepo.findByTokenHash(tokenHash);

    if (!storedToken) {
      throw new TokenInvalidError('Token de refresco desconocido.');
    }

    // DETECCIÓN DE ROBO O REUTILIZACIÓN (TOKEN REPLAY)
    if (storedToken.isRevoked) {
      // Un token previamente revocado está intentando ser consumido nuevamente -> Reuso fraudulento
      await this.refreshTokenRepo.revokeFamily(storedToken.familyId);
      await this.auditService.log({
        eventType: 'SUSPICIOUS_TOKEN_REUSE',
        userId: storedToken.userId,
        resource: 'auth',
        ipAddress: context?.ipAddress,
        userAgent: context?.userAgent,
        metadata: { familyId: storedToken.familyId, revokedTokenId: storedToken.id },
      });

      throw new UnauthorizedError('Detección de seguridad: token reutilizado. La sesión ha sido revocada completamente.');
    }

    // Comprobar expiración
    if (storedToken.expiresAt < new Date()) {
      await this.refreshTokenRepo.revokeToken(storedToken.id);
      throw new TokenExpiredError('El token de refresco ha expirado. Inicie sesión nuevamente.');
    }

    // Verificar usuario en base de datos en tiempo real
    const user = await this.userRepo.findById(storedToken.userId);
    if (!user || user.accountStatus === 'LOCKED' || user.accountStatus === 'SUSPENDED') {
      await this.refreshTokenRepo.revokeToken(storedToken.id);
      throw new UnauthorizedError('La cuenta de usuario no se encuentra activa para renovar sesión.');
    }

    // Rotar token: Marcar actual como revocado y emitir nuevo token en la MISMA familia
    await this.refreshTokenRepo.revokeToken(storedToken.id);

    const newRawRefreshToken = generateSecureToken(32);
    const newTokenHash = hashToken(newRawRefreshToken);
    const newExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    await this.refreshTokenRepo.create({
      userId: user.id,
      tokenHash: newTokenHash,
      familyId: storedToken.familyId,
      expiresAt: newExpiresAt,
      userAgent: context?.userAgent,
      ipAddress: context?.ipAddress,
    });

    // Emitir nuevo Access Token HS256
    const { token: newAccessToken, expiresIn } = this.tokenService.signAccessToken({
      id: user.id,
      email: user.email,
      role: user.role,
    });

    return {
      accessToken: newAccessToken,
      rawRefreshToken: newRawRefreshToken,
      refreshToken: newRawRefreshToken,
      expiresIn,
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
        mustChangePassword: user.accountStatus === 'MUST_CHANGE_PASSWORD',
      },
    };
  }

  /**
   * Cierre voluntario de sesión invalidando el refresh token en base de datos.
   */
  public async logout(
    rawRefreshToken?: string | null,
    userId?: string | null,
    context?: { ipAddress?: string | null; userAgent?: string | null }
  ): Promise<void> {
    if (rawRefreshToken) {
      const tokenHash = hashToken(rawRefreshToken);
      const storedToken = await this.refreshTokenRepo.findByTokenHash(tokenHash);
      if (storedToken) {
        await this.refreshTokenRepo.revokeToken(storedToken.id);
      }
    }

    await this.auditService.log({
      eventType: 'LOGOUT',
      userId: userId ?? null,
      resource: 'auth',
      ipAddress: context?.ipAddress,
      userAgent: context?.userAgent,
      metadata: { clean: true },
    });
  }

  /**
   * Cambio obligatorio de contraseña para cuentas en estado MUST_CHANGE_PASSWORD (ej. bootstrap inicial).
   * Requiere la contraseña actual para prevenir CSRF y cambios no autorizados.
   */
  public async changeInitialPassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
    context?: { ipAddress?: string | null; userAgent?: string | null }
  ): Promise<UserEntity> {
    if (!newPassword || newPassword.length < 10) {
      throw new ValidationError('La nueva contraseña debe contener al menos 10 caracteres.');
    }

    const user = await this.userRepo.findById(userId);
    if (!user) throw new UnauthorizedError('Usuario no encontrado.');

    // Verificar la contraseña actual antes de permitir el cambio
    const isCurrentPasswordValid = await this.passwordHasher.verify(currentPassword, user.passwordHash);
    if (!isCurrentPasswordValid) {
      throw new InvalidCredentialsError('La contraseña actual es incorrecta.');
    }

    const newHash = await this.passwordHasher.hash(newPassword);
    const updated = await this.userRepo.updatePassword(user.id, newHash);

    // Asegurar revocación de sesiones previas
    await this.refreshTokenRepo.revokeAllForUser(user.id);

    await this.auditService.log({
      eventType: 'PASSWORD_CHANGED',
      userId: user.id,
      resource: 'auth',
      ipAddress: context?.ipAddress,
      userAgent: context?.userAgent,
      metadata: { reason: 'INITIAL_PASSWORD_CHANGE_COMPLETED' },
    });

    return updated;
  }
}
