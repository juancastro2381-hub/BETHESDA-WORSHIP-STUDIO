/**
 * @file rbac-permission-guards.test.ts
 * @description Suite de pruebas para el sistema RBAC, verificación de permisos y guardas en tiempo real contra BD (Fase 2B).
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { runMigrations } from '../db/migrate.ts';
import { pool } from '../db/index.ts';
import { DrizzleUserRepository } from '../repositories/user-repository.ts';
import { JwtTokenService } from '../application/token-service.ts';
import { AuthGuard } from '../interfaces/http/middlewares/auth-middleware.ts';
import { ROLE_PERMISSIONS, type UserRole } from '../domain/auth-types.ts';
import { ForbiddenError, UnauthorizedError } from '../domain/errors.ts';

describe('Phase 2B — RBAC System & Authoritative Real-Time Database Guards', () => {
  const jwtSecret = 'super-secret-key-that-is-at-least-32-chars-long!';
  const tokenService = new JwtTokenService(jwtSecret, '15m');
  const userRepo = new DrizzleUserRepository();
  const authGuard = new AuthGuard(tokenService, userRepo);

  before(async () => {
    await runMigrations();
  });

  after(async () => {
    await pool.end();
  });

  it('1. should enforce strict explicit role permissions with zero implicit inheritance', () => {
    const roles: UserRole[] = ['SUPER_ADMIN', 'ADMIN', 'WORSHIP_LEADER', 'MUSICIAN', 'VIEWER'];

    for (const role of roles) {
      const perms = ROLE_PERMISSIONS[role];
      assert.ok(Array.isArray(perms), `El rol ${role} debe tener una lista explícita de permisos.`);
      assert.ok(perms.length > 0, `El rol ${role} no puede tener permisos vacíos.`);
    }

    // VIEWER solo debe tener permisos de lectura (canciones y setlists)
    assert.deepStrictEqual(ROLE_PERMISSIONS.VIEWER, ['songs:read', 'setlists:list', 'setlists:read']);

    // MUSICIAN no debe tener permisos de administración ni aprobación de canciones
    assert.strictEqual(ROLE_PERMISSIONS.MUSICIAN.includes('users:invite'), false);
    assert.strictEqual(ROLE_PERMISSIONS.MUSICIAN.includes('songs:approve'), false);
    assert.strictEqual(ROLE_PERMISSIONS.MUSICIAN.includes('songs:delete'), false);

    // WORSHIP_LEADER puede crear canciones pero no administrar roles
    assert.strictEqual(ROLE_PERMISSIONS.WORSHIP_LEADER.includes('songs:create'), true);
    assert.strictEqual(ROLE_PERMISSIONS.WORSHIP_LEADER.includes('users:change_role'), false);

    // ADMIN puede invitar y aprobar canciones, pero no eliminar canciones (reservado a SUPER_ADMIN)
    assert.strictEqual(ROLE_PERMISSIONS.ADMIN.includes('users:invite'), true);
    assert.strictEqual(ROLE_PERMISSIONS.ADMIN.includes('songs:approve'), true);
    assert.strictEqual(ROLE_PERMISSIONS.ADMIN.includes('songs:delete'), false);

    // SUPER_ADMIN tiene permisos completos
    assert.strictEqual(ROLE_PERMISSIONS.SUPER_ADMIN.includes('songs:delete'), true);
  });

  it('2. should reject VIEWER attempting to invite users (403 Forbidden)', async () => {
    const { token } = tokenService.signAccessToken({
      sub: '00000000-0000-0000-0000-000000000001',
      email: 'viewer@bethesda.co',
      role: 'VIEWER',
    });

    const mockReq: any = {
      headers: { authorization: `Bearer ${token}` },
    };
    const mockReply: any = {};

    const guard = authGuard.requirePermission('users:invite', false);

    await assert.rejects(
      async () => {
        await guard(mockReq, mockReply);
      },
      (err: any) => {
        assert.ok(err instanceof ForbiddenError);
        assert.strictEqual(err.statusCode, 403);
        return true;
      }
    );
  });

  it('3. should reject MUSICIAN attempting to change user roles (403 Forbidden)', async () => {
    const { token } = tokenService.signAccessToken({
      sub: '00000000-0000-0000-0000-000000000002',
      email: 'guitarrista@bethesda.co',
      role: 'MUSICIAN',
    });

    const mockReq: any = {
      headers: { authorization: `Bearer ${token}` },
    };
    const mockReply: any = {};

    const guard = authGuard.requirePermission('users:change_role', false);

    await assert.rejects(
      async () => {
        await guard(mockReq, mockReply);
      },
      (err: any) => {
        assert.ok(err instanceof ForbiddenError);
        assert.strictEqual(err.statusCode, 403);
        return true;
      }
    );
  });

  it('4. should require valid Bearer token and reject missing token (401 Unauthorized)', async () => {
    const mockReq: any = {
      headers: {},
    };
    const mockReply: any = {};

    const guard = authGuard.requirePermission('songs:read', false);

    await assert.rejects(
      async () => {
        await guard(mockReq, mockReply);
      },
      (err: any) => {
        assert.ok(err instanceof UnauthorizedError);
        assert.strictEqual(err.statusCode, 401);
        return true;
      }
    );
  });

  it('5. should execute REAL-TIME DB check for sensitive operations: reject if user is DISABLED in DB despite valid JWT claim', async () => {
    const uniqueEmail = `disabled-${Date.now()}@bethesda.co`;
    const createdUser = await userRepo.create({
      email: uniqueEmail,
      passwordHash: 'dummy_hash',
      firstName: 'Usuario',
      lastName: 'Inhabilitado',
      role: 'ADMIN',
      accountStatus: 'ACTIVE',
    });

    // Crear token cuando era ADMIN y ACTIVE
    const { token } = tokenService.signAccessToken({
      sub: createdUser.id,
      email: createdUser.email,
      role: 'ADMIN',
    });

    // Inhabilitar usuario en la base de datos
    await userRepo.update(createdUser.id, { accountStatus: 'SUSPENDED' });

    const mockReq: any = {
      headers: { authorization: `Bearer ${token}` },
    };
    const mockReply: any = {};

    // Requiere verificación en BD (verifyDatabaseRole = true)
    const guard = authGuard.requirePermission('users:invite', true);

    await assert.rejects(
      async () => {
        await guard(mockReq, mockReply);
      },
      (err: any) => {
        assert.ok(err instanceof ForbiddenError);
        assert.match(err.message, /estado 'SUSPENDED'/);
        return true;
      }
    );
  });

  it('6. should execute REAL-TIME DB check for sensitive operations: reject if user role was downgraded in DB', async () => {
    const uniqueEmail = `downgraded-${Date.now()}@bethesda.co`;
    const createdUser = await userRepo.create({
      email: uniqueEmail,
      passwordHash: 'dummy_hash',
      firstName: 'Usuario',
      lastName: 'Degradado',
      role: 'ADMIN',
      accountStatus: 'ACTIVE',
    });

    // Token con claim ADMIN
    const { token } = tokenService.signAccessToken({
      sub: createdUser.id,
      email: createdUser.email,
      role: 'ADMIN',
    });

    // Degradar a MUSICIAN en la base de datos
    await userRepo.update(createdUser.id, { role: 'MUSICIAN' });

    const mockReq: any = {
      headers: { authorization: `Bearer ${token}` },
    };
    const mockReply: any = {};

    // Requiere permiso 'users:invite' verificado contra BD
    const guard = authGuard.requirePermission('users:invite', true);

    await assert.rejects(
      async () => {
        await guard(mockReq, mockReply);
      },
      (err: any) => {
        assert.ok(err instanceof ForbiddenError);
        assert.match(err.message, /El rol actual en base de datos \(MUSICIAN\)/);
        return true;
      }
    );
  });
});
