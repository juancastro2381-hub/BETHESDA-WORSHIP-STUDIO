/**
 * @file user-invitation-lifecycle.test.ts
 * @description Pruebas del ciclo de vida de invitaciones de usuario y verificación inherente de correo (Fase 2B).
 */

import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { db } from '../db/index.ts';
import { runMigrations } from '../db/migrate.ts';
import { DrizzleUserRepository } from '../repositories/user-repository.ts';
import { DrizzleUserInvitationRepository } from '../repositories/user-invitation-repository.ts';
import { DrizzleAuditLogRepository } from '../repositories/audit-repository.ts';
import { Argon2PasswordHasher } from '../domain/crypto/password-hasher.ts';
import { AuditService } from '../application/audit-service.ts';
import { UserInvitationService } from '../application/invitation-service.ts';
import { ValidationError, ConflictError, NotFoundError } from '../domain/errors.ts';
import { generateSecureToken, hashToken } from '../domain/crypto/token-utils.ts';
import { users } from '../db/schema.ts';
import { eq } from 'drizzle-orm';

describe('Phase 2B — User Invitation Lifecycle & Inherent Email Verification', () => {
  let invitationService: UserInvitationService;
  let userRepo: DrizzleUserRepository;
  let invitationRepo: DrizzleUserInvitationRepository;
  let adminUserId: string;

  before(async () => {
    await runMigrations();

    userRepo = new DrizzleUserRepository(db);
    invitationRepo = new DrizzleUserInvitationRepository(db);
    const hasher = new Argon2PasswordHasher();
    const auditService = new AuditService(new DrizzleAuditLogRepository(db));

    invitationService = new UserInvitationService(userRepo, invitationRepo, hasher, auditService);

    // Crear admin emisor
    const admin = await userRepo.create({
      email: `admin_inviter_${Date.now()}@bethesda.org`,
      passwordHash: await hasher.hash('AdminPassword123!'),
      firstName: 'Pastor',
      lastName: 'Director',
      role: 'ADMIN',
      accountStatus: 'ACTIVE',
      emailVerified: true,
    });
    adminUserId = admin.id;
  });

  it('1. should create an invitation, issue a 256-bit token and put user in PENDING_INVITATION status', async () => {
    const inviteEmail = `nuevo_musico_${Date.now()}@bethesda.org`;
    const result = await invitationService.inviteUser({
      email: inviteEmail,
      firstName: 'Pedro',
      lastName: 'Gomez',
      role: 'MUSICIAN',
      invitedByUserId: adminUserId,
    });

    assert.ok(result.rawInvitationToken, 'Debe emitir el token de invitación en texto plano');
    assert.equal(result.rawInvitationToken.length, 64, 'Token de 32 bytes debe tener 64 caracteres hex');
    assert.equal(result.user.accountStatus, 'PENDING_INVITATION');
    assert.equal(result.user.emailVerified, false);
    assert.equal(result.user.role, 'MUSICIAN');
  });

  it('2. should accept invitation, establish user password, set email_verified = true and accountStatus = ACTIVE', async () => {
    const inviteEmail = `vocalista_${Date.now()}@bethesda.org`;
    const { rawInvitationToken } = await invitationService.inviteUser({
      email: inviteEmail,
      firstName: 'Maria',
      lastName: 'Lopez',
      role: 'MUSICIAN',
      invitedByUserId: adminUserId,
    });

    // El usuario consume el token y fija su propia contraseña
    const user = await invitationService.acceptInvitation(rawInvitationToken, 'MiNuevaContrasenaSegura2026!');

    assert.equal(user.accountStatus, 'ACTIVE', 'La cuenta debe pasar a ACTIVE');
    assert.equal(user.emailVerified, true, 'El correo queda automáticamente verificado sin flujos redundantes');
    assert.equal(user.email, inviteEmail);
  });

  it('3. should reject re-using an already consumed invitation token (single-use invariant)', async () => {
    const inviteEmail = `baterista_${Date.now()}@bethesda.org`;
    const { rawInvitationToken } = await invitationService.inviteUser({
      email: inviteEmail,
      firstName: 'Carlos',
      lastName: 'Ruiz',
      role: 'MUSICIAN',
      invitedByUserId: adminUserId,
    });

    // Primer consumo: Exitoso
    await invitationService.acceptInvitation(rawInvitationToken, 'ClaveBateria2026!');

    // Segundo consumo: Rechazado
    await assert.rejects(
      async () => await invitationService.acceptInvitation(rawInvitationToken, 'OtraClave12345!'),
      (err: any) => err instanceof ValidationError && err.message.includes('ya fue utilizado'),
      'Debe rechazar token de invitación ya consumido'
    );
  });

  it('4. should reject weak passwords during invitation acceptance', async () => {
    const inviteEmail = `tecladista_${Date.now()}@bethesda.org`;
    const { rawInvitationToken } = await invitationService.inviteUser({
      email: inviteEmail,
      firstName: 'Sofia',
      lastName: 'Castro',
      role: 'MUSICIAN',
      invitedByUserId: adminUserId,
    });

    await assert.rejects(
      async () => await invitationService.acceptInvitation(rawInvitationToken, 'corta'),
      (err: any) => err instanceof ValidationError && err.message.includes('al menos 10 caracteres'),
      'Debe exigir al menos 10 caracteres'
    );
  });

  it('5. should reject inviting an already active user', async () => {
    const activeEmail = `activo_${Date.now()}@bethesda.org`;
    const { rawInvitationToken } = await invitationService.inviteUser({
      email: activeEmail,
      firstName: 'David',
      lastName: 'Perez',
      role: 'MUSICIAN',
      invitedByUserId: adminUserId,
    });

    await invitationService.acceptInvitation(rawInvitationToken, 'ClaveDavidSegura2026!');

    // Intentar invitarlo de nuevo
    await assert.rejects(
      async () =>
        await invitationService.inviteUser({
          email: activeEmail,
          firstName: 'David',
          lastName: 'Perez',
          role: 'MUSICIAN',
          invitedByUserId: adminUserId,
        }),
      (err: any) => err instanceof ConflictError,
      'Debe rechazar invitar a un usuario activo con ConflictError'
    );
  });

  it('6. should ensure exactly ONE request succeeds under concurrent acceptance attempts (Atomic Claim Invariant)', async () => {
    const inviteEmail = `concurrente_${Date.now()}@bethesda.org`;
    const { rawInvitationToken } = await invitationService.inviteUser({
      email: inviteEmail,
      firstName: 'Mateo',
      lastName: 'Concurrencia',
      role: 'MUSICIAN',
      invitedByUserId: adminUserId,
    });

    // Disparar dos peticiones concurrentes para aceptar la misma invitación
    const promise1 = invitationService.acceptInvitation(rawInvitationToken, 'ClaveConcurrente1_2026!');
    const promise2 = invitationService.acceptInvitation(rawInvitationToken, 'ClaveConcurrente2_2026!');

    const results = await Promise.allSettled([promise1, promise2]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');

    assert.equal(fulfilled.length, 1, 'Exactamente una petición debe tener éxito');
    assert.equal(rejected.length, 1, 'Exactamente una petición debe ser rechazada');

    const rejectionReason = (rejected[0] as PromiseRejectedResult).reason;
    assert.ok(rejectionReason instanceof ValidationError, 'El rechazo debe ser un ValidationError');
    assert.match(rejectionReason.message, /inválido, ya fue utilizado o ha expirado/i);

    // Verificar que el usuario en base de datos quedó ACTIVE y emailVerified = true
    const activatedUser = await userRepo.findByEmail(inviteEmail);
    assert.ok(activatedUser);
    assert.equal(activatedUser.accountStatus, 'ACTIVE');
    assert.equal(activatedUser.emailVerified, true);
  });

  it('7. should rollback invitation consumption if error occurs during user update (ACID Rollback Invariant)', async () => {
    const inviteEmail = `rollback_${Date.now()}@bethesda.org`;
    const { rawInvitationToken, user } = await invitationService.inviteUser({
      email: inviteEmail,
      firstName: 'Lucas',
      lastName: 'Rollback',
      role: 'MUSICIAN',
      invitedByUserId: adminUserId,
    });

    const tokenHash = hashToken(rawInvitationToken);

    // Simular inconsistencia eliminando el usuario antes de la aceptación
    await db.delete(users).where(eq(users.id, user.id));

    // Intentar aceptar la invitación: fallará porque el usuario no existe en la transacción
    await assert.rejects(
      async () => await invitationService.acceptInvitation(rawInvitationToken, 'ClaveValida2026!'),
      (err: any) => err instanceof NotFoundError,
      'Debe arrojar NotFoundError'
    );

    // Invariante ACID: La transacción debió hacer rollback, por lo que isAccepted debe seguir siendo FALSE
    const invitationInDb = await invitationRepo.findByTokenHash(tokenHash);
    assert.ok(invitationInDb, 'El registro de invitación debe persistir');
    assert.equal(invitationInDb.isAccepted, false, 'La invitación NO debe quedar como consumida tras el rollback');
  });

  it('8. should categorically reject expired invitation tokens (Expiration Enforcement)', async () => {
    const expiredEmail = `expirado_${Date.now()}@bethesda.org`;
    const rawToken = generateSecureToken(32);
    const tokenHash = hashToken(rawToken);

    // Crear usuario pendiente
    const pendingUser = await userRepo.create({
      email: expiredEmail,
      passwordHash: 'dummy_hash',
      firstName: 'Tomas',
      lastName: 'Expirado',
      role: 'MUSICIAN',
      accountStatus: 'PENDING_INVITATION',
      emailVerified: false,
    });

    // Crear invitación ya expirada (hace 2 horas)
    await invitationRepo.create({
      email: expiredEmail,
      tokenHash,
      role: 'MUSICIAN',
      invitedByUserId: adminUserId,
      expiresAt: new Date(Date.now() - 2 * 60 * 60 * 1000), // Expirada
    });

    // Intentar aceptar el token expirado
    await assert.rejects(
      async () => await invitationService.acceptInvitation(rawToken, 'ClaveValida2026!'),
      (err: any) => err instanceof ValidationError && err.message.includes('ha expirado'),
      'Debe rechazar token expirado con ValidationError'
    );

    // Verificar que en BD no se consumió y el usuario sigue PENDING_INVITATION
    const inv = await invitationRepo.findByTokenHash(tokenHash);
    assert.ok(inv);
    assert.equal(inv.isAccepted, false);

    const userInDb = await userRepo.findById(pendingUser.id);
    assert.equal(userInDb?.accountStatus, 'PENDING_INVITATION');
  });
});
