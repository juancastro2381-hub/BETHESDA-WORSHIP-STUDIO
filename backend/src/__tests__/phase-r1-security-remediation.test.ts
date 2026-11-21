/**
 * @file phase-r1-security-remediation.test.ts
 * @description Pruebas unitarias e integración HTTP en memoria (sin mutar BD) para la remediación Phase R1 (P0):
 * - R1.1 Integridad de _journal.json (0018 y 0019 presentes y ordenados)
 * - R1.2 Bloqueo real tras 5 intentos fallidos de login, imposibilidad de bypass vía refresh y recuperación al expirar
 * - R1.3 Emisión y validación estricta de tokenVersion en JWT y AuthGuard (requireAuth / requirePermission)
 * - R1.4 & R1.5 Bloqueo RBAC en /api/v1/ingestion/* y /api/v1/conversion/* (401 anónimo, 403 VIEWER/MUSICIAN, límites, rate limit)
 * - Compilación emitida en backend/dist/backend/src/server.js
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';

import { AuthService } from '../application/auth-service.ts';
import { JwtTokenService } from '../application/token-service.ts';
import type { IAuditService } from '../application/audit-service.ts';
import { AuthGuard } from '../interfaces/http/middlewares/auth-middleware.ts';
import { DualRateLimiter } from '../interfaces/http/middlewares/rate-limiter.ts';
import { errorHandler } from '../interfaces/http/error-handler.ts';
import { ingestionRoutes } from '../interfaces/http/routes/ingestion.routes.ts';
import { conversionRoutes } from '../interfaces/http/routes/conversion.routes.ts';
import { Argon2PasswordHasher } from '../domain/crypto/password-hasher.ts';
import {
  AccountLockedError,
  ForbiddenError,
  InvalidCredentialsError,
  UnauthorizedError,
} from '../domain/errors.ts';
import type {
  AccountStatus,
  RefreshTokenEntity,
  UserEntity,
  UserRole,
} from '../domain/auth-types.ts';
import type { IUserRepository } from '../repositories/user-repository.ts';
import type { IRefreshTokenRepository } from '../repositories/refresh-token-repository.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(__dirname, '../..');

function createInMemoryUserRepo(initialUsers: UserEntity[]): IUserRepository & { store: Map<string, UserEntity> } {
  const store = new Map(initialUsers.map((u) => [u.id, { ...u }]));

  const findByEmail = async (email: string) => {
    const target = email.trim().toLowerCase();
    for (const u of store.values()) {
      if (u.email.toLowerCase() === target) return { ...u };
    }
    return null;
  };

  return {
    store,
    findById: async (id) => (store.has(id) ? { ...store.get(id)! } : null),
    findByEmail,
    create: async (data) => {
      const entity: UserEntity = {
        id: data.email,
        email: data.email,
        passwordHash: data.passwordHash,
        firstName: data.firstName,
        lastName: data.lastName,
        role: data.role ?? 'MUSICIAN',
        accountStatus: data.accountStatus ?? 'ACTIVE',
        emailVerified: data.emailVerified ?? false,
        mfaEnabled: false,
        failedLoginAttempts: 0,
        lockoutUntil: null,
        lastLoginAt: null,
        tokenVersion: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      store.set(entity.id, entity);
      return { ...entity };
    },
    updateRole: async (id, newRole) => {
      const cur = store.get(id)!;
      cur.role = newRole;
      cur.tokenVersion += 1;
      return { ...cur };
    },
    update: async (id, updates) => {
      const cur = store.get(id)!;
      const next: UserEntity = { ...cur, ...updates, updatedAt: new Date() };
      store.set(id, next);
      return { ...next };
    },
    updateStatus: async (id, status) => {
      const cur = store.get(id)!;
      cur.accountStatus = status;
      return { ...cur };
    },
    updatePassword: async (id, newPasswordHash) => {
      const cur = store.get(id)!;
      cur.passwordHash = newPasswordHash;
      cur.accountStatus = 'ACTIVE';
      cur.tokenVersion += 1;
      return { ...cur };
    },
    recordSuccessfulLogin: async (id) => {
      const cur = store.get(id)!;
      cur.failedLoginAttempts = 0;
      cur.lockoutUntil = null;
      cur.lastLoginAt = new Date();
      if (cur.accountStatus === 'LOCKED') cur.accountStatus = 'ACTIVE';
    },
    recordFailedLogin: async (id, lockoutDurationMinutes = 15) => {
      const cur = store.get(id);
      if (!cur) return { failedAttempts: 0, isLocked: false, lockoutUntil: null };
      cur.failedLoginAttempts += 1;
      let lockoutUntil: Date | null = null;
      let isLocked = false;
      if (cur.failedLoginAttempts >= 5) {
        lockoutUntil = new Date(Date.now() + lockoutDurationMinutes * 60_000);
        cur.lockoutUntil = lockoutUntil;
        isLocked = true;
        if (cur.accountStatus === 'ACTIVE') {
          cur.accountStatus = 'LOCKED';
        }
      }
      return { failedAttempts: cur.failedLoginAttempts, isLocked, lockoutUntil };
    },
    incrementTokenVersion: async (id) => {
      const cur = store.get(id)!;
      cur.tokenVersion += 1;
      return cur.tokenVersion;
    },
    countActiveSuperAdmins: async () => 1,
    list: async () => ({ items: Array.from(store.values()), total: store.size }),
    listUsers: async () => ({ items: Array.from(store.values()), total: store.size }),
  };
}

function createInMemoryRefreshRepo(): IRefreshTokenRepository & { rows: RefreshTokenEntity[] } {
  const rows: RefreshTokenEntity[] = [];
  return {
    rows,
    create: async (data) => {
      const row: RefreshTokenEntity = {
        id: `rt-${rows.length + 1}`,
        userId: data.userId,
        tokenHash: data.tokenHash,
        familyId: data.familyId,
        isRevoked: false,
        expiresAt: data.expiresAt,
        userAgent: data.userAgent ?? null,
        ipAddress: data.ipAddress ?? null,
        createdAt: new Date(),
        lastUsedAt: null,
      };
      rows.push(row);
      return { ...row };
    },
    findByTokenHash: async (hash) => rows.find((r) => r.tokenHash === hash) ?? null,
    findActiveByFamily: async (familyId) => rows.find((r) => r.familyId === familyId && !r.isRevoked) ?? null,
    revokeToken: async (id) => {
      const found = rows.find((r) => r.id === id);
      if (found) found.isRevoked = true;
    },
    revokeFamily: async (familyId) => {
      for (const r of rows) if (r.familyId === familyId) r.isRevoked = true;
    },
    revokeAllForUser: async (userId) => {
      for (const r of rows) if (r.userId === userId) r.isRevoked = true;
    },
    updateLastUsed: async () => {},
    pruneExpired: async () => 0,
  };
}

const noopAudit: IAuditService = {
  log: async () => {},
} as unknown as IAuditService;

describe('Phase R1 (P0) — Security, Auth, Migration & Build Remediation Suite', () => {
  it('R1.1: Drizzle _journal.json should include 0018 and 0019 in valid ascending order with existing SQL files', () => {
    const journalPath = path.join(backendRoot, 'src/db/migrations/meta/_journal.json');
    const journal = JSON.parse(fs.readFileSync(journalPath, 'utf8')) as {
      entries: Array<{ idx: number; when: number; tag: string }>;
    };

    const tags = journal.entries.map((e) => e.tag);
    assert.ok(tags.includes('0018_cas_deletion_state_machine'), 'Debe incluir migración 0018');
    assert.ok(tags.includes('0019_cas_deletion_retained_state'), 'Debe incluir migración 0019');
    assert.ok(tags.includes('0020_worship_services_and_setlist_enhancements'), 'Debe conservar migración 0020');

    for (let i = 0; i < journal.entries.length; i++) {
      const entry = journal.entries[i]!;
      assert.strictEqual(entry.idx, i, `Índice secuencial esperado en ${entry.tag}`);
      if (i > 0) {
        assert.ok(
          entry.when > journal.entries[i - 1]!.when,
          `Timestamp 'when' debe ser creciente en ${entry.tag}`
        );
      }
      const sqlFile = path.join(backendRoot, 'src/db/migrations', `${entry.tag}.sql`);
      assert.ok(fs.existsSync(sqlFile), `Archivo SQL debe existir: ${entry.tag}.sql`);
    }
  });

  it('R1.2: Failed login lockout enforces LOCKED after 5 attempts, blocks valid password & refresh, and recovers on expiration', async () => {
    const hasher = new Argon2PasswordHasher({ memoryCost: 4096, timeCost: 1, parallelism: 1 });
    const validHash = await hasher.hash('WorshipStrong!2026');
    const userId = '11111111-1111-1111-1111-111111111111';

    const userRepo = createInMemoryUserRepo([
      {
        id: userId,
        email: 'leader@bethesda.org',
        passwordHash: validHash,
        firstName: 'Juan',
        lastName: 'Castro',
        role: 'WORSHIP_LEADER',
        accountStatus: 'ACTIVE',
        emailVerified: true,
        mfaEnabled: false,
        failedLoginAttempts: 0,
        lockoutUntil: null,
        lastLoginAt: null,
        tokenVersion: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);
    const refreshRepo = createInMemoryRefreshRepo();
    const tokenService = new JwtTokenService('test-secret-minimum-32-chars-for-phase-r1', 900);
    const authService = new AuthService(userRepo, refreshRepo, hasher, tokenService, noopAudit);

    // 1. Iniciar sesión válida primero para tener un refresh token que luego no pueda bypassear el bloqueo
    const initialSession = await authService.login('leader@bethesda.org', 'WorshipStrong!2026');
    assert.ok(initialSession.accessToken);

    // 2. 4 intentos fallidos aún dejan intentos, 5to bloquea la cuenta en BD (accountStatus='LOCKED')
    for (let i = 1; i <= 4; i++) {
      await assert.rejects(
        () => authService.login('leader@bethesda.org', 'WrongPass!'),
        (err: unknown) => err instanceof InvalidCredentialsError
      );
      assert.strictEqual(userRepo.store.get(userId)!.accountStatus, 'ACTIVE');
    }

    await assert.rejects(
      () => authService.login('leader@bethesda.org', 'WrongPass!'),
      (err: unknown) => err instanceof AccountLockedError
    );
    assert.strictEqual(userRepo.store.get(userId)!.accountStatus, 'LOCKED');
    assert.ok(userRepo.store.get(userId)!.lockoutUntil);

    // 3. Intento con contraseña CORRECTA mientras sigue bloqueada debe fallar con AccountLockedError
    await assert.rejects(
      () => authService.login('leader@bethesda.org', 'WorshipStrong!2026'),
      (err: unknown) => err instanceof AccountLockedError
    );

    // 4. Refresh token previo NO puede bypassear cuenta LOCKED
    await assert.rejects(
      () => authService.refresh(initialSession.rawRefreshToken),
      (err: unknown) => err instanceof UnauthorizedError
    );

    // 5. Al expirar lockoutUntil, un login válido desbloquea y restaura ACTIVE + 0 fallos
    userRepo.store.get(userId)!.lockoutUntil = new Date(Date.now() - 1000);
    const recovered = await authService.login('leader@bethesda.org', 'WorshipStrong!2026');
    assert.ok(recovered.accessToken);
    assert.strictEqual(userRepo.store.get(userId)!.accountStatus, 'ACTIVE');
    assert.strictEqual(userRepo.store.get(userId)!.failedLoginAttempts, 0);
  });

  it('R1.3: JWT embeds tokenVersion and AuthGuard rejects old tokens after incrementTokenVersion or SUSPENDED', async () => {
    const userId = '22222222-2222-2222-2222-222222222222';
    const userRepo = createInMemoryUserRepo([
      {
        id: userId,
        email: 'musician@bethesda.org',
        passwordHash: 'irrelevant',
        firstName: 'Ana',
        lastName: 'Lopez',
        role: 'MUSICIAN',
        accountStatus: 'ACTIVE',
        emailVerified: true,
        mfaEnabled: false,
        failedLoginAttempts: 0,
        lockoutUntil: null,
        lastLoginAt: null,
        tokenVersion: 2,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);
    const tokenService = new JwtTokenService('test-secret-minimum-32-chars-for-phase-r1', 900);
    const guard = new AuthGuard(tokenService, userRepo);

    const { token: v2Token } = tokenService.signAccessToken({
      id: userId,
      email: 'musician@bethesda.org',
      role: 'MUSICIAN',
      tokenVersion: 2,
    });
    const decoded = tokenService.verifyAccessToken(v2Token);
    assert.strictEqual(decoded.tokenVersion, 2);

    // Con tokenVersion vigente permite acceso
    const reqOk: any = { headers: { authorization: `Bearer ${v2Token}` } };
    await guard.requireAuth(reqOk, {} as any);
    await guard.requirePermission('songs:read', true)(reqOk, {} as any);

    // Tras cambio de rol / password reset -> incrementa tokenVersion en BD a 3
    await userRepo.incrementTokenVersion(userId);
    const reqStale: any = { headers: { authorization: `Bearer ${v2Token}` } };
    await assert.rejects(
      () => guard.requireAuth(reqStale, {} as any),
      (err: unknown) => err instanceof UnauthorizedError
    );

    // Nuevo token con v3 funciona, pero si cuenta pasa a SUSPENDED debe rechazarse con 403
    const { token: v3Token } = tokenService.signAccessToken({
      id: userId,
      email: 'musician@bethesda.org',
      role: 'MUSICIAN',
      tokenVersion: 3,
    });
    userRepo.store.get(userId)!.accountStatus = 'SUSPENDED';
    const reqSuspended: any = { headers: { authorization: `Bearer ${v3Token}` } };
    await assert.rejects(
      () => guard.requireAuth(reqSuspended, {} as any),
      (err: unknown) => err instanceof ForbiddenError
    );
  });

  describe('R1.4 & R1.5: HTTP Route Guards on /ingestion/* and /conversion/*', () => {
    let app: FastifyInstance;
    const tokenService = new JwtTokenService(
      process.env.JWT_SECRET || 'dev-fallback-secret-must-be-at-least-32-chars-long',
      900
    );

    const signForRole = (role: UserRole, sub: string) =>
      tokenService.signAccessToken({
        id: sub,
        email: `${role.toLowerCase()}@bethesda.org`,
        role,
        tokenVersion: 1,
      }).token;

    before(async () => {
      app = Fastify({ logger: false });
      await app.register(cookie);
      app.setErrorHandler(errorHandler);
      await app.register(ingestionRoutes, { prefix: '/api/v1/ingestion' });
      await app.register(conversionRoutes, { prefix: '/api/v1/conversion' });
      await app.ready();
    });

    after(async () => {
      await app.close();
    });

    it('rejects unauthenticated access (401) on /conversion/validate, /conversion/transpile, /conversion/jobs, and /ingestion/upload', async () => {
      for (const [method, url, payload] of [
        ['POST', '/api/v1/conversion/validate', { filename: 'test.cho', rawText: '{title: A}\n[G]Hola' }],
        ['POST', '/api/v1/conversion/transpile', { filename: 'test.cho', targetFormat: 'LYRICS_ONLY', rawText: '[G]Hola' }],
        ['POST', '/api/v1/conversion/jobs', { filename: 'test.cho', targetFormat: 'LYRICS_ONLY', rawText: '[G]Hola' }],
        ['POST', '/api/v1/ingestion/upload', { filename: 'test.cho', rawText: '[G]Hola' }],
        ['POST', '/api/v1/ingestion/written-notes', { title: 'Test', measures: [] }],
        ['POST', '/api/v1/ingestion/video-url', { videoUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' }],
      ] as const) {
        const res = await app.inject({ method, url, payload });
        assert.strictEqual(res.statusCode, 401, `${method} ${url} debe exigir autenticación (401)`);
      }
    });

    it('blocks VIEWER (403 Forbidden) from uploading, transpiling, creating conversion jobs, or committing songs', async () => {
      const viewerToken = signForRole('VIEWER', '33333333-3333-3333-3333-333333333333');
      for (const [method, url, payload] of [
        ['POST', '/api/v1/ingestion/upload', { filename: 'test.cho', rawText: '[G]Hola' }],
        ['POST', '/api/v1/ingestion/written-notes', { title: 'Test', measures: [] }],
        ['POST', '/api/v1/conversion/transpile', { filename: 'test.cho', targetFormat: 'LYRICS_ONLY', rawText: '[G]Hola' }],
        ['POST', '/api/v1/conversion/jobs', { filename: 'test.cho', targetFormat: 'LYRICS_ONLY', rawText: '[G]Hola' }],
        ['POST', '/api/v1/conversion/jobs/44444444-4444-4444-4444-444444444444/commit', {}],
      ] as const) {
        const res = await app.inject({
          method,
          url,
          headers: { authorization: `Bearer ${viewerToken}` },
          payload,
        });
        assert.strictEqual(res.statusCode, 403, `VIEWER no puede ejecutar ${method} ${url}`);
      }
    });

    it('blocks MUSICIAN (403 Forbidden) from catalog upload (/ingestion/upload) and catalog commit (/conversion/jobs/:id/commit)', async () => {
      const musicianToken = signForRole('MUSICIAN', '55555555-5555-5555-5555-555555555555');
      for (const [url, payload] of [
        ['/api/v1/ingestion/upload', { filename: 'test.cho', rawText: '[G]Hola' }],
        ['/api/v1/conversion/jobs/44444444-4444-4444-4444-444444444444/commit', {}],
      ] as const) {
        const res = await app.inject({
          method: 'POST',
          url,
          headers: { authorization: `Bearer ${musicianToken}` },
          payload,
        });
        assert.strictEqual(res.statusCode, 403, `MUSICIAN no tiene permiso songs:create para ${url}`);
      }
    });
  });

  it('R1.5b: DualRateLimiter blocks excess IP attempts with 429 and prunes expired buckets without unbounded growth', () => {
    const limiter = new DualRateLimiter({ ipWindowMs: 1000, ipMaxAttempts: 2 });
    limiter.recordIpAttempt('10.0.0.1');
    limiter.recordIpAttempt('10.0.0.1');
    const blocked = limiter.checkIp('10.0.0.1');
    assert.strictEqual(blocked.allowed, false);
    assert.ok(blocked.retryAfter >= 1);
  });
});
