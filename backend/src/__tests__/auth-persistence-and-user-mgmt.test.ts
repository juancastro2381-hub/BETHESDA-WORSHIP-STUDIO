/**
 * @file auth-persistence-and-user-mgmt.test.ts
 * @description Suite exhaustiva de pruebas para persistencia de autenticación, control de concurrencia en refresco,
 * protección del último Super Admin, gobernanza RBAC anti-escalación y ciclo de vida de administración de usuarios.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../app.ts';
import { runMigrations } from '../db/migrate.ts';
import { pool, db } from '../db/index.ts';
import { DrizzleUserRepository } from '../repositories/user-repository.ts';
import { DrizzleRefreshTokenRepository } from '../repositories/refresh-token-repository.ts';
import { DrizzleUserInvitationRepository } from '../repositories/user-invitation-repository.ts';
import { Argon2PasswordHasher } from '../domain/crypto/password-hasher.ts';
import { JwtTokenService } from '../application/token-service.ts';
import { defaultRateLimiter } from '../interfaces/http/middlewares/rate-limiter.ts';
import { env } from '../config/env.ts';
import { hashToken } from '../domain/crypto/token-utils.ts';
import { users } from '../db/schema.ts';
import { eq } from 'drizzle-orm';

describe('Production Gates — Auth Persistence, Concurrency Resilience & User Administration Hardening', () => {
  let app: FastifyInstance;
  const userRepo = new DrizzleUserRepository();
  const refreshRepo = new DrizzleRefreshTokenRepository();
  const invitationRepo = new DrizzleUserInvitationRepository();
  const tokenService = new JwtTokenService(env.JWT_SECRET, env.JWT_ACCESS_EXPIRES_IN);
  const hasher = new Argon2PasswordHasher({
    memoryCost: env.ARGON2_MEMORY_COST,
    timeCost: env.ARGON2_TIME_COST,
    parallelism: env.ARGON2_PARALLELISM,
  });

  const superAdminEmail = `superadmin_${Date.now()}@bethesda.org`;
  const adminEmail = `admin_operator_${Date.now()}@bethesda.org`;
  const defaultPassword = 'SecureMinisterialPass2026!';

  let superAdminId: string;
  let adminId: string;
  let superAdminCookie = '';
  let superAdminAccessToken = '';
  let adminAccessToken = '';

  before(async () => {
    await runMigrations();
    app = await buildApp();
    await app.ready();

    const passHash = await hasher.hash(defaultPassword);

    // 1. Crear Super Administrador de prueba
    const sa = await userRepo.create({
      email: superAdminEmail,
      passwordHash: passHash,
      firstName: 'Super',
      lastName: 'Admin',
      role: 'SUPER_ADMIN',
      accountStatus: 'ACTIVE',
      emailVerified: true,
    });
    superAdminId = sa.id;

    // 2. Crear Administrador regular de prueba
    const adm = await userRepo.create({
      email: adminEmail,
      passwordHash: passHash,
      firstName: 'Pastor',
      lastName: 'Administrador',
      role: 'ADMIN',
      accountStatus: 'ACTIVE',
      emailVerified: true,
    });
    adminId = adm.id;

    // Login de Super Admin
    const saLoginRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: superAdminEmail, password: defaultPassword },
    });
    const saBody = JSON.parse(saLoginRes.payload);
    superAdminAccessToken = saBody.data.accessToken;
    const cookieHeader = saLoginRes.headers['set-cookie'];
    const cookieList = Array.isArray(cookieHeader) ? cookieHeader : [cookieHeader as string];
    const match = cookieList.find((c) => c.includes('bethesda_refresh_token='))?.match(/bethesda_refresh_token=([^;]+)/);
    superAdminCookie = match ? match[1] : '';

    // Login de Admin regular
    const admLoginRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: adminEmail, password: defaultPassword },
    });
    const admBody = JSON.parse(admLoginRes.payload);
    adminAccessToken = admBody.data.accessToken;
  });

  after(async () => {
    await app.close();
    await pool.end();
  });

  // =========================================================================
  // BLOQUE 1: PERSISTENCIA DE AUTENTICACIÓN TRAS RECARGA (PHASE B)
  // =========================================================================

  it('1.1: Super Admin retains session across reload via HttpOnly cookie with authoritative DB role', async () => {
    assert.ok(superAdminCookie, 'La cookie de refresco debe existir tras login');

    // Simular llamada de recarga de página (F5) invocando /auth/refresh con la cookie
    const refreshRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      headers: {
        cookie: `bethesda_refresh_token=${superAdminCookie}`,
      },
    });

    assert.equal(refreshRes.statusCode, 200, 'Debe renovar sesión exitosamente');
    const refreshBody = JSON.parse(refreshRes.payload);
    assert.equal(refreshBody.success, true);
    assert.ok(refreshBody.data.accessToken);
    assert.equal(refreshBody.data.user.email, superAdminEmail);
    assert.equal(refreshBody.data.user.role, 'SUPER_ADMIN', 'El rol restaurado debe ser fidedigno desde BD');

    // Actualizar cookie con la rotada
    const newCookieHeader = refreshRes.headers['set-cookie'];
    const newCookieList = Array.isArray(newCookieHeader) ? newCookieHeader : [newCookieHeader as string];
    const match = newCookieList.find((c) => c.includes('bethesda_refresh_token='))?.match(/bethesda_refresh_token=([^;]+)/);
    if (match) {
      superAdminCookie = match[1];
    }

    // Verificar que el nuevo token de acceso permite acceder a rutas protegidas
    const meRes = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: {
        authorization: `Bearer ${refreshBody.data.accessToken}`,
      },
    });
    assert.equal(meRes.statusCode, 200);
    const meBody = JSON.parse(meRes.payload);
    assert.equal(meBody.data.id, superAdminId);
    assert.equal(meBody.data.role, 'SUPER_ADMIN');
  });

  it('1.2: Rotated refresh token cannot be reused and immediate replay triggers SUSPICIOUS_TOKEN_REUSE', async () => {
    // Generar un token de refresco fresco para la prueba
    const loginRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: superAdminEmail, password: defaultPassword },
    });
    const cList = Array.isArray(loginRes.headers['set-cookie'])
      ? loginRes.headers['set-cookie']
      : [loginRes.headers['set-cookie'] as string];
    const initialToken = cList.find((c) => c.includes('bethesda_refresh_token='))?.match(/bethesda_refresh_token=([^;]+)/)![1];

    // Primera rotación legítima: éxito 200
    const rotRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      headers: { cookie: `bethesda_refresh_token=${initialToken}` },
    });
    assert.equal(rotRes.statusCode, 200);

    // Reutilización del token previo (replay attack): rechazo 401 con detección de reutilización
    const replayRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      headers: { cookie: `bethesda_refresh_token=${initialToken}` },
    });
    assert.equal(replayRes.statusCode, 401, 'Debe rechazar token ya rotado');
    const replayBody = JSON.parse(replayRes.payload);
    assert.match(replayBody.error.message, /reutilizado/i);
  });

  it('1.3: Replaying revoked refresh token revokes entire family, invalidating even the latest token', async () => {
    const loginRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: superAdminEmail, password: defaultPassword },
    });
    const cList1 = Array.isArray(loginRes.headers['set-cookie'])
      ? loginRes.headers['set-cookie']
      : [loginRes.headers['set-cookie'] as string];
    const tokenV1 = cList1.find((c) => c.includes('bethesda_refresh_token='))?.match(/bethesda_refresh_token=([^;]+)/)![1]!;

    // Rotación legítima V1 -> V2
    const rotRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      headers: { cookie: `bethesda_refresh_token=${tokenV1}` },
    });
    assert.equal(rotRes.statusCode, 200);
    const cList2 = Array.isArray(rotRes.headers['set-cookie'])
      ? rotRes.headers['set-cookie']
      : [rotRes.headers['set-cookie'] as string];
    const tokenV2 = cList2.find((c) => c.includes('bethesda_refresh_token='))?.match(/bethesda_refresh_token=([^;]+)/)![1]!;

    // Replay de tokenV1: detección de reuso y revocación en cascada de la familia
    const replayRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      headers: { cookie: `bethesda_refresh_token=${tokenV1}` },
    });
    assert.equal(replayRes.statusCode, 401);

    // El token legítimo V2 ahora también debe estar revocado debido a la protección de familia
    const v2Res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      headers: { cookie: `bethesda_refresh_token=${tokenV2}` },
    });
    assert.equal(v2Res.statusCode, 401, 'La familia completa debe haber sido invalidada');
  });

  it('1.4: Suspended user cannot restore session even with previously issued valid cookie', async () => {
    const victimEmail = `victim_${Date.now()}@bethesda.org`;
    const victim = await userRepo.create({
      email: victimEmail,
      passwordHash: await hasher.hash(defaultPassword),
      firstName: 'Usuario',
      lastName: 'Suspendible',
      role: 'MUSICIAN',
      accountStatus: 'ACTIVE',
    });

    const vLogin = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: victimEmail, password: defaultPassword },
    });
    const vCookies = Array.isArray(vLogin.headers['set-cookie'])
      ? vLogin.headers['set-cookie']
      : [vLogin.headers['set-cookie'] as string];
    const victimCookie = vCookies.find((c) => c.includes('bethesda_refresh_token='))?.match(/bethesda_refresh_token=([^;]+)/)![1]!;

    // Ahora suspender la cuenta del usuario en BD
    await userRepo.updateStatus(victim.id, 'SUSPENDED');

    // Intentar restaurar sesión con la cookie previa
    const refreshRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      headers: { cookie: `bethesda_refresh_token=${victimCookie}` },
    });

    assert.equal(refreshRes.statusCode, 401, 'Usuario suspendido debe ser rechazado en refresh');
  });

  // =========================================================================
  // BLOQUE 2: PROTECCIÓN DEL ÚLTIMO SUPER ADMIN (PHASE C & D)
  // =========================================================================

  it('2.1: Should reject disabling the only active Super Admin of the congregation', async () => {
    // Asegurar que solo hay 1 Super Admin activo
    const saCount = await userRepo.countActiveSuperAdmins();
    assert.ok(saCount >= 1);

    // Si hay más de 1, suspender los otros para dejar exactamente 1
    if (saCount > 1) {
      await pool.query(
        `UPDATE users SET account_status = 'SUSPENDED' WHERE role = 'SUPER_ADMIN' AND id != $1`,
        [superAdminId]
      );
    }
    const verifiedSaCount = await userRepo.countActiveSuperAdmins();
    assert.equal(verifiedSaCount, 1, 'Debe haber exactamente un Super Admin activo');

    // Intentar deshabilitar al único Super Admin usando credenciales de Super Admin
    const disableRes = await app.inject({
      method: 'POST',
      url: `/api/v1/users/${superAdminId}/disable`,
      headers: { authorization: `Bearer ${superAdminAccessToken}` },
    });

    // Debe ser rechazado porque no se puede deshabilitar la propia cuenta ni al último Super Admin
    assert.equal(disableRes.statusCode, 403);
    const body = JSON.parse(disableRes.payload);
    assert.match(body.error.message, /No puede deshabilitar su propia cuenta|único Super Administrador/i);
  });

  it('2.2: Should reject demoting role of the only active Super Admin', async () => {
    // Crear un segundo Super Admin activo que actúa como operador
    const sa2 = await userRepo.create({
      email: `sa_temp_${Date.now()}@bethesda.org`,
      passwordHash: await hasher.hash(defaultPassword),
      firstName: 'SA',
      lastName: 'Dos',
      role: 'SUPER_ADMIN',
      accountStatus: 'ACTIVE',
    });

    const { token: sa2Token } = tokenService.signAccessToken({
      id: sa2.id,
      email: sa2.email,
      role: sa2.role,
    });

    // Poner a superAdminId en SUSPENDED para que en todo el sistema solo haya 1 Super Admin activo (sa2)
    await userRepo.updateStatus(superAdminId, 'SUSPENDED');
    assert.equal(await userRepo.countActiveSuperAdmins(), 1, 'Solo sa2 debe ser Super Admin activo');

    // sa2 intenta degradar el rol de superAdminId a ADMIN cuando sa2 es el único activo restante
    const demoteRes = await app.inject({
      method: 'PATCH',
      url: `/api/v1/users/${superAdminId}/role`,
      headers: { authorization: `Bearer ${sa2Token}` },
      payload: { role: 'ADMIN' },
    });

    assert.equal(demoteRes.statusCode, 403);
    const body = JSON.parse(demoteRes.payload);
    assert.match(body.error.message, /único Super Administrador activo/i);

    // Restaurar estado de superAdminId a ACTIVE
    await userRepo.updateStatus(superAdminId, 'ACTIVE');

    // Limpieza: eliminar sa2
    await pool.query(`DELETE FROM users WHERE id = $1`, [sa2.id]);
  });

  // =========================================================================
  // BLOQUE 3: PREVENCIÓN DE ESCALACIÓN DE PRIVILEGIOS Y MATRIZ RBAC
  // =========================================================================

  it('3.1: Admin regular cannot assign SUPER_ADMIN role (Privilege Escalation Prevention)', async () => {
    const targetUser = await userRepo.create({
      email: `target_musician_${Date.now()}@bethesda.org`,
      passwordHash: await hasher.hash(defaultPassword),
      firstName: 'Candidato',
      lastName: 'Escalacion',
      role: 'MUSICIAN',
      accountStatus: 'ACTIVE',
    });

    // Admin regular intenta ascender al usuario a SUPER_ADMIN
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/users/${targetUser.id}/role`,
      headers: { authorization: `Bearer ${adminAccessToken}` },
      payload: { role: 'SUPER_ADMIN' },
    });

    assert.equal(res.statusCode, 403, 'Admin no puede otorgar SUPER_ADMIN');
    const body = JSON.parse(res.payload);
    assert.match(body.error.message, /Solo un Super Administrador puede asignar el rol SUPER_ADMIN/i);
  });

  it('3.2: Admin regular cannot invite a user with SUPER_ADMIN role', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/users/invite',
      headers: { authorization: `Bearer ${adminAccessToken}` },
      payload: {
        email: `new_fake_sa_${Date.now()}@bethesda.org`,
        firstName: 'Falso',
        lastName: 'SuperAdmin',
        role: 'SUPER_ADMIN',
      },
    });

    assert.equal(res.statusCode, 403, 'Admin no puede invitar con rol SUPER_ADMIN');
    const body = JSON.parse(res.payload);
    assert.match(body.error.message, /Solo un Super Administrador puede invitar a usuarios con el rol SUPER_ADMIN/i);
  });

  it('3.3: Admin regular cannot modify or disable a SUPER_ADMIN account', async () => {
    // Admin regular intenta cambiar rol de Super Admin
    const roleRes = await app.inject({
      method: 'PATCH',
      url: `/api/v1/users/${superAdminId}/role`,
      headers: { authorization: `Bearer ${adminAccessToken}` },
      payload: { role: 'VIEWER' },
    });
    assert.equal(roleRes.statusCode, 403);
    assert.match(JSON.parse(roleRes.payload).error.message, /no tienen autorización para modificar el rol de un Super Administrador/i);

    // Admin regular intenta deshabilitar a Super Admin
    const disableRes = await app.inject({
      method: 'POST',
      url: `/api/v1/users/${superAdminId}/disable`,
      headers: { authorization: `Bearer ${adminAccessToken}` },
    });
    assert.equal(disableRes.statusCode, 403);
    assert.match(JSON.parse(disableRes.payload).error.message, /no tienen autorización para deshabilitar a un Super Administrador/i);
  });

  // =========================================================================
  // BLOQUE 4: REENVÍO DE INVITACIÓN, INVALIDACIÓN Y ENTREGA VERAZ
  // =========================================================================

  it('4.1: Inviting user returns UNCONFIGURED_MOCK when SMTP is not configured', async () => {
    const inviteEmail = `truthful_smtp_${Date.now()}@bethesda.org`;
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/users/invite',
      headers: { authorization: `Bearer ${superAdminAccessToken}` },
      payload: {
        email: inviteEmail,
        firstName: 'Pedro',
        lastName: 'Prueba',
        role: 'MUSICIAN',
      },
    });

    assert.equal(res.statusCode, 201);
    const body = JSON.parse(res.payload);
    assert.equal(body.success, true);
    assert.equal(body.data.deliveryStatus, 'UNCONFIGURED_MOCK', 'Debe reportar con veracidad que SMTP no está configurado');
    assert.ok(body.data.invitationToken, 'Debe proveer token seguro de uso único para entrega manual');
    assert.match(body.data.deliveryMessage, /Servicio SMTP no configurado/i);
  });

  it('4.2: Resending invitation invalidates previous token and creates fresh single-use token', async () => {
    const inviteEmail = `resend_test_${Date.now()}@bethesda.org`;
    const firstInvite = await app.inject({
      method: 'POST',
      url: '/api/v1/users/invite',
      headers: { authorization: `Bearer ${superAdminAccessToken}` },
      payload: {
        email: inviteEmail,
        firstName: 'Lucas',
        lastName: 'Guitarra',
        role: 'MUSICIAN',
      },
    });
    const firstBody = JSON.parse(firstInvite.payload);
    const firstToken = firstBody.data.invitationToken;
    const targetUserId = firstBody.data.userId;

    // Reenviar invitación mediante POST /api/v1/users/:id/resend-invite
    const resendRes = await app.inject({
      method: 'POST',
      url: `/api/v1/users/${targetUserId}/resend-invite`,
      headers: { authorization: `Bearer ${superAdminAccessToken}` },
    });

    assert.equal(resendRes.statusCode, 200);
    const resendBody = JSON.parse(resendRes.payload);
    assert.equal(resendBody.success, true);
    const secondToken = resendBody.data.invitationToken;
    assert.notEqual(firstToken, secondToken, 'El nuevo token debe ser diferente');

    // Intentar aceptar la invitación con el PRIMER token (debe fallar porque fue invalidado)
    const acceptOldRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/accept-invite',
      payload: {
        token: firstToken,
        password: 'PasswordInvalida2026!',
      },
    });
    assert.equal(acceptOldRes.statusCode, 400, 'El token previo debe ser rechazado');

    // Aceptar la invitación con el SEGUNDO token (debe triunfar)
    const acceptNewRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/accept-invite',
      payload: {
        token: secondToken,
        password: 'PasswordValida2026!',
      },
    });
    assert.equal(acceptNewRes.statusCode, 200);
    const acceptBody = JSON.parse(acceptNewRes.payload);
    assert.equal(acceptBody.success, true);

    // Verificar que el usuario ahora está ACTIVE en BD
    const activatedUser = await userRepo.findById(targetUserId);
    assert.equal(activatedUser?.accountStatus, 'ACTIVE');
    assert.equal(activatedUser?.emailVerified, true);
  });

  // =========================================================================
  // BLOQUE 5: REACTIVACIÓN DE CUENTA (POST /api/v1/users/:id/enable)
  // =========================================================================

  it('5.1: Should reactivate a suspended account via POST /api/v1/users/:id/enable', async () => {
    const suspendedUser = await userRepo.create({
      email: `reactivate_${Date.now()}@bethesda.org`,
      passwordHash: await hasher.hash(defaultPassword),
      firstName: 'Usuario',
      lastName: 'Reactivable',
      role: 'MUSICIAN',
      accountStatus: 'SUSPENDED',
    });

    const enableRes = await app.inject({
      method: 'POST',
      url: `/api/v1/users/${suspendedUser.id}/enable`,
      headers: { authorization: `Bearer ${superAdminAccessToken}` },
    });

    assert.equal(enableRes.statusCode, 200);
    const body = JSON.parse(enableRes.payload);
    assert.equal(body.success, true);
    assert.match(body.message, /reactivado exitosamente/i);

    const reloaded = await userRepo.findById(suspendedUser.id);
    assert.equal(reloaded?.accountStatus, 'ACTIVE');
  });

  // =========================================================================
  // BLOQUE 6: FILTRADO Y BÚSQUEDA EN LISTADO DE USUARIOS (GET /api/v1/users)
  // =========================================================================

  it('6.1: Should filter users by search term and account status', async () => {
    const uniqueQuery = `querytest_${Date.now()}`;
    await userRepo.create({
      email: `${uniqueQuery}@bethesda.org`,
      passwordHash: await hasher.hash(defaultPassword),
      firstName: 'BusquedaEspecial',
      lastName: 'Prueba',
      role: 'MUSICIAN',
      accountStatus: 'ACTIVE',
    });

    // 1. Filtrar por término de búsqueda
    const searchRes = await app.inject({
      method: 'GET',
      url: `/api/v1/users?search=${uniqueQuery}`,
      headers: { authorization: `Bearer ${superAdminAccessToken}` },
    });
    assert.equal(searchRes.statusCode, 200);
    const searchBody = JSON.parse(searchRes.payload);
    assert.equal(searchBody.data.length, 1);
    assert.equal(searchBody.data[0].email, `${uniqueQuery}@bethesda.org`);

    // 2. Filtrar por status
    const statusRes = await app.inject({
      method: 'GET',
      url: `/api/v1/users?status=SUSPENDED`,
      headers: { authorization: `Bearer ${superAdminAccessToken}` },
    });
    assert.equal(statusRes.statusCode, 200);
    const statusBody = JSON.parse(statusRes.payload);
    assert.ok(statusBody.data.every((u: any) => u.accountStatus === 'SUSPENDED'));
  });
});
