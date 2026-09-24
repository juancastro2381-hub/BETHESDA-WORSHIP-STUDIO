/**
 * @file token-family-replay.test.ts
 * @description Pruebas automatizadas de rotación de Refresh Tokens, familias y detección de ataques de reuso (Fase 2B).
 */

import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { db } from '../db/index.ts';
import { runMigrations } from '../db/migrate.ts';
import { DrizzleUserRepository } from '../repositories/user-repository.ts';
import { DrizzleRefreshTokenRepository } from '../repositories/refresh-token-repository.ts';
import { DrizzleAuditLogRepository } from '../repositories/audit-repository.ts';
import { Argon2PasswordHasher } from '../domain/crypto/password-hasher.ts';
import { JwtTokenService } from '../application/token-service.ts';
import { AuditService } from '../application/audit-service.ts';
import { AuthService } from '../application/auth-service.ts';
import { UnauthorizedError } from '../domain/errors.ts';

describe('Phase 2B — Refresh Token Family Security & Replay Detection', () => {
  let authService: AuthService;
  let userRepo: DrizzleUserRepository;
  let refreshTokenRepo: DrizzleRefreshTokenRepository;
  let auditRepo: DrizzleAuditLogRepository;
  let testUserEmail: string;
  let testUserPassword: string;

  before(async () => {
    await runMigrations();

    userRepo = new DrizzleUserRepository(db);
    refreshTokenRepo = new DrizzleRefreshTokenRepository(db);
    auditRepo = new DrizzleAuditLogRepository(db);
    const hasher = new Argon2PasswordHasher();
    const tokenService = new JwtTokenService();
    const auditService = new AuditService(auditRepo);

    authService = new AuthService(userRepo, refreshTokenRepo, hasher, tokenService, auditService);

    testUserEmail = `replay_test_${Date.now()}@bethesda.org`;
    testUserPassword = 'TestPassword2026!';
    const passwordHash = await hasher.hash(testUserPassword);

    await userRepo.create({
      email: testUserEmail,
      passwordHash,
      firstName: 'Test',
      lastName: 'Replay',
      role: 'MUSICIAN',
      accountStatus: 'ACTIVE',
      emailVerified: true,
    });
  });

  it('1. should login and issue access token and initial refresh token with a family_id', async () => {
    const loginResult = await authService.login(testUserEmail, testUserPassword);

    assert.ok(loginResult.accessToken);
    assert.ok(loginResult.rawRefreshToken);
    assert.equal(loginResult.user.email, testUserEmail);
  });

  it('2. should successfully rotate refresh token upon refresh call and preserve same family_id', async () => {
    const { rawRefreshToken: tokenV1 } = await authService.login(testUserEmail, testUserPassword);

    const refreshResult1 = await authService.refresh(tokenV1);

    assert.ok(refreshResult1.accessToken);
    assert.ok(refreshResult1.rawRefreshToken);
    assert.notEqual(refreshResult1.rawRefreshToken, tokenV1, 'El nuevo token de refresco debe ser diferente al previo');

    // Comprobar que tokenV2 puede seguir renovando la sesión
    const refreshResult2 = await authService.refresh(refreshResult1.rawRefreshToken);
    assert.ok(refreshResult2.accessToken);
    assert.ok(refreshResult2.rawRefreshToken);
    assert.notEqual(refreshResult2.rawRefreshToken, refreshResult1.rawRefreshToken);
  });

  it('3. should DETECT REPLAY ATTACK and REVOKE ENTIRE FAMILY if an old revoked token is reused', async () => {
    // 1. Iniciar sesión: obtenemos tokenV1
    const { rawRefreshToken: tokenV1 } = await authService.login(testUserEmail, testUserPassword);

    // 2. Cliente legítimo rota tokenV1 -> obtiene tokenV2 (tokenV1 queda revocado)
    const { rawRefreshToken: tokenV2 } = await authService.refresh(tokenV1);

    // 3. Atacante intenta reutilizar el tokenV1 ya consumido
    await assert.rejects(
      async () => await authService.refresh(tokenV1),
      (err: any) => err instanceof UnauthorizedError && err.message.includes('token reutilizado'),
      'Debe rechazar con UnauthorizedError al detectar token reutilizado'
    );

    // 4. VERIFICACIÓN DE REVOCACIÓN DE FAMILIA COMPLETA:
    // Ahora el tokenV2 (del usuario legítimo) también DEBE estar revocado para proteger la cuenta
    await assert.rejects(
      async () => await authService.refresh(tokenV2),
      (err: any) => err instanceof UnauthorizedError,
      'Toda la familia debe estar invalidada impidiendo nuevos accesos'
    );
  });
});
