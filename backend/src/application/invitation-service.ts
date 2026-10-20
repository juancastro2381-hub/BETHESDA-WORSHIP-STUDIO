/**
 * @file invitation-service.ts
 * @description Servicio de aplicación para el ciclo de vida de invitaciones de usuarios y onboarding seguro (Fase 2B).
 *
 * Flujo Mandatorio:
 * ADMIN INVITA -> Token de Invitación Generado -> Entrega al Correo Registrado -> Usuario Acepta e Ingresa Clave
 * -> Token Consumido -> email_verified = true -> Cuenta ACTIVE.
 */

import type { IUserRepository } from '../repositories/user-repository.ts';
import type { IUserInvitationRepository } from '../repositories/user-invitation-repository.ts';
import type { IPasswordHasher } from '../domain/crypto/password-hasher.ts';
import type { IAuditService } from './audit-service.ts';
import { generateSecureToken, hashToken } from '../domain/crypto/token-utils.ts';
import type { UserEntity, UserRole } from '../domain/auth-types.ts';
import { ConflictError, ValidationError, NotFoundError } from '../domain/errors.ts';

export interface InviteUserInput {
  email: string;
  firstName: string;
  lastName: string;
  role: UserRole;
  invitedByUserId: string;
}

export interface InviteUserResult {
  user: UserEntity;
  rawInvitationToken: string;
  expiresAt: Date;
  deliveryStatus: 'SENT' | 'UNCONFIGURED_MOCK';
  deliveryMessage: string;
}

export class UserInvitationService {
  public constructor(
    private readonly userRepo: IUserRepository,
    private readonly invitationRepo: IUserInvitationRepository,
    private readonly passwordHasher: IPasswordHasher,
    private readonly auditService: IAuditService
  ) {}

  /**
   * Genera una invitación administrativa segura.
   * Crea el usuario en estado PENDING_INVITATION sin asignar contraseña permanente de administrador.
   */
  public async inviteUser(input: InviteUserInput): Promise<InviteUserResult> {
    const normalizedEmail = input.email.trim().toLowerCase();

    // 1. Comprobar si ya existe un usuario activo con este correo
    const existingUser = await this.userRepo.findByEmail(normalizedEmail);
    if (existingUser && existingUser.accountStatus === 'ACTIVE') {
      throw new ConflictError(`Ya existe un usuario activo registrado con el correo '${normalizedEmail}'.`);
    }

    // 2. Invalidar invitaciones previas pendientes para evitar tokens duplicados concurrentes
    await this.invitationRepo.revokePendingByEmail(normalizedEmail);

    // 3. Generar token criptográfico único (256 bits)
    const rawInvitationToken = generateSecureToken(32);
    const tokenHash = hashToken(rawInvitationToken);
    const expiresAt = new Date(Date.now() + 72 * 60 * 60 * 1000); // 72 horas

    let user: UserEntity;

    if (existingUser) {
      // Re-invitar usuario pendiente
      user = existingUser;
      await this.userRepo.updateRole(user.id, input.role);
    } else {
      // Hash de marcador de posición no utilizable para login directo
      const placeholderHash = await this.passwordHasher.hash(generateSecureToken(32));

      user = await this.userRepo.create({
        email: normalizedEmail,
        passwordHash: placeholderHash,
        firstName: input.firstName,
        lastName: input.lastName,
        role: input.role,
        accountStatus: 'PENDING_INVITATION',
        emailVerified: false,
      });
    }

    // 4. Persistir token hasheado en user_invitations
    await this.invitationRepo.create({
      email: normalizedEmail,
      tokenHash,
      role: input.role,
      invitedByUserId: input.invitedByUserId,
      expiresAt,
    });

    await this.auditService.log({
      eventType: 'USER_INVITED',
      userId: input.invitedByUserId,
      resource: 'users',
      metadata: {
        invitedUserId: user.id,
        invitedEmail: normalizedEmail,
        role: input.role,
        expiresAt,
      },
    });

    return {
      user,
      rawInvitationToken,
      expiresAt,
      deliveryStatus: 'UNCONFIGURED_MOCK',
      deliveryMessage: 'Servicio SMTP no configurado en este entorno. Enlace administrativo generado para entrega manual segura.',
    };
  }

  /**
   * Reenvía una invitación a un usuario en estado PENDING_INVITATION, invalidando el token anterior.
   */
  public async resendInvitation(userId: string, requestedByUserId: string): Promise<InviteUserResult> {
    const user = await this.userRepo.findById(userId);
    if (!user) {
      throw new NotFoundError(`Usuario con ID ${userId} no encontrado.`);
    }

    if (user.accountStatus !== 'PENDING_INVITATION') {
      throw new ValidationError(
        `Solo se pueden reenviar invitaciones para usuarios en estado PENDING_INVITATION. Estado actual: ${user.accountStatus}`
      );
    }

    // 1. Invalidar tokens previos no consumidos
    await this.invitationRepo.revokePendingByEmail(user.email);

    // 2. Generar nuevo token criptográfico
    const rawInvitationToken = generateSecureToken(32);
    const tokenHash = hashToken(rawInvitationToken);
    const expiresAt = new Date(Date.now() + 72 * 60 * 60 * 1000); // 72 horas

    // 3. Persistir nuevo registro de invitación
    await this.invitationRepo.create({
      email: user.email,
      tokenHash,
      role: user.role,
      invitedByUserId: requestedByUserId,
      expiresAt,
    });

    await this.auditService.log({
      eventType: 'INVITATION_RESENT',
      userId: requestedByUserId,
      resource: 'users',
      metadata: {
        targetUserId: user.id,
        email: user.email,
        role: user.role,
        expiresAt,
      },
    });

    return {
      user,
      rawInvitationToken,
      expiresAt,
      deliveryStatus: 'UNCONFIGURED_MOCK',
      deliveryMessage: 'Servicio SMTP no configurado en este entorno. Enlace administrativo generado para entrega manual segura.',
    };
  }

  /**
   * El usuario invitado consume el token y establece su propia contraseña de forma autónoma.
   * La entrega y uso del token prueba el control del correo: marca email_verified = true y status = ACTIVE.
   */
  public async acceptInvitation(token: string, newPassword: string): Promise<UserEntity> {
    if (!token || typeof token !== 'string') {
      throw new ValidationError('El token de invitación es requerido.');
    }

    if (!newPassword || newPassword.length < 10) {
      throw new ValidationError('La contraseña debe contener al menos 10 caracteres.');
    }

    const tokenHash = hashToken(token);
    const invitation = await this.invitationRepo.findByTokenHash(tokenHash);

    if (!invitation || invitation.isAccepted || invitation.expiresAt < new Date()) {
      throw new ValidationError('El token de invitación es inválido, ya fue utilizado o ha expirado.');
    }

    const user = await this.userRepo.findByEmail(invitation.email);
    if (!user) {
      throw new NotFoundError('Usuario asociado a la invitación no encontrado.');
    }

    // Hashear la contraseña elegida por el usuario con Argon2id
    const passwordHash = await this.passwordHasher.hash(newPassword);

    // Actualizar usuario: ACTIVE y email_verified = true
    const updatedUser = await this.userRepo.updatePassword(user.id, passwordHash);

    // Marcar invitación como consumida
    await this.invitationRepo.markAccepted(invitation.id);

    await this.auditService.log({
      eventType: 'INVITATION_COMPLETED',
      userId: updatedUser.id,
      resource: 'users',
      metadata: {
        email: updatedUser.email,
        role: updatedUser.role,
      },
    });

    return updatedUser;
  }
}
