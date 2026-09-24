/**
 * @file setlist-api.test.ts
 * @description Suite completa de pruebas de integración HTTP para los endpoints de Setlists y Momentos de Servicio (Fase 2C — WS5).
 *
 * Cobertura:
 * 1. Autenticación y formato de encabezado Authorization (HTTP 401).
 * 2. Matriz RBAC completa para los 5 roles (HTTP 403 vs 200/201).
 * 3. Verificación autoritativa de roles en tiempo real contra PostgreSQL (verifyDatabaseRole = true).
 * 4. Validación exhaustiva de esquemas Zod y polimorfismo SONG vs SERVICE_MOMENT (HTTP 400).
 * 5. Mapeo de errores de dominio (HTTP 404 NOT_FOUND, 409 CONFLICT).
 * 6. Protección contra Insecure Direct Object Reference (IDOR).
 * 7. Invariante canónica absoluta (cero mutaciones en la tabla songs).
 * 8. Registro de auditoría mandatorio (SETLIST_CREATED, SETLIST_ACTIVATED, SETLIST_DELETED).
 * 9. Limpieza y preservación estricta de la integridad de base de datos.
 */

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../app.ts';
import { pool } from '../db/index.ts';
import { runMigrations } from '../db/migrate.ts';
import { DrizzleUserRepository } from '../repositories/user-repository.ts';
import { JwtTokenService } from '../application/token-service.ts';
import { env } from '../config/env.ts';
import type { UserEntity } from '../domain/auth-types.ts';

describe('Phase 2C — Workstream 5 (WS5): Fastify HTTP API Integration & RBAC Guards (/api/v1/setlists)', () => {
  let app: FastifyInstance;
  let tokenService: JwtTokenService;
  let userRepo: DrizzleUserRepository;

  // Usuarios de prueba creados para la suite
  let adminUser: UserEntity;
  let leaderUser: UserEntity;
  let musicianUser: UserEntity;
  let viewerUser: UserEntity;
  let suspendedUser: UserEntity;
  let lockedUser: UserEntity;
  let downgradedUser: UserEntity;

  // Tokens JWT
  let adminToken: string;
  let leaderToken: string;
  let musicianToken: string;
  let viewerToken: string;
  let suspendedToken: string;
  let lockedToken: string;
  let downgradedToken: string;

  // Canción de prueba existente en el catálogo
  let canonicalSongId: string;

  // Conjunto de IDs de setlists creados en la suite para limpieza
  const createdSetlistIds = new Set<string>();
  const createdUserIds = new Set<string>();

  before(async () => {
    await runMigrations();
    app = await buildApp();
    await app.ready();

    tokenService = new JwtTokenService(env.JWT_SECRET, env.JWT_ACCESS_EXPIRES_IN);
    userRepo = new DrizzleUserRepository();

    // 1. Obtener una canción canónica existente
    const songRes = await pool.query('SELECT id, default_key, default_bpm FROM songs LIMIT 1');
    assert.ok(songRes.rows.length > 0, 'Debe existir al menos una canción canónica en la BD.');
    canonicalSongId = songRes.rows[0].id;

    // 2. Crear usuarios de prueba con roles explícitos
    const timestamp = Date.now();

    adminUser = await userRepo.create({
      email: `test-api-admin-${timestamp}@bethesda.co`,
      passwordHash: 'dummy_hash',
      firstName: 'Admin',
      lastName: 'Prueba',
      role: 'ADMIN',
      accountStatus: 'ACTIVE',
    });
    createdUserIds.add(adminUser.id);
    adminToken = tokenService.signAccessToken({
      sub: adminUser.id,
      email: adminUser.email,
      role: adminUser.role,
    }).token;

    leaderUser = await userRepo.create({
      email: `test-api-leader-${timestamp}@bethesda.co`,
      passwordHash: 'dummy_hash',
      firstName: 'Líder',
      lastName: 'Alabanza',
      role: 'WORSHIP_LEADER',
      accountStatus: 'ACTIVE',
    });
    createdUserIds.add(leaderUser.id);
    leaderToken = tokenService.signAccessToken({
      sub: leaderUser.id,
      email: leaderUser.email,
      role: leaderUser.role,
    }).token;

    musicianUser = await userRepo.create({
      email: `test-api-musician-${timestamp}@bethesda.co`,
      passwordHash: 'dummy_hash',
      firstName: 'Músico',
      lastName: 'Prueba',
      role: 'MUSICIAN',
      accountStatus: 'ACTIVE',
    });
    createdUserIds.add(musicianUser.id);
    musicianToken = tokenService.signAccessToken({
      sub: musicianUser.id,
      email: musicianUser.email,
      role: musicianUser.role,
    }).token;

    viewerUser = await userRepo.create({
      email: `test-api-viewer-${timestamp}@bethesda.co`,
      passwordHash: 'dummy_hash',
      firstName: 'Visualizador',
      lastName: 'Prueba',
      role: 'VIEWER',
      accountStatus: 'ACTIVE',
    });
    createdUserIds.add(viewerUser.id);
    viewerToken = tokenService.signAccessToken({
      sub: viewerUser.id,
      email: viewerUser.email,
      role: viewerUser.role,
    }).token;

    suspendedUser = await userRepo.create({
      email: `test-api-suspended-${timestamp}@bethesda.co`,
      passwordHash: 'dummy_hash',
      firstName: 'Suspendido',
      lastName: 'Prueba',
      role: 'WORSHIP_LEADER',
      accountStatus: 'SUSPENDED',
    });
    createdUserIds.add(suspendedUser.id);
    suspendedToken = tokenService.signAccessToken({
      sub: suspendedUser.id,
      email: suspendedUser.email,
      role: 'WORSHIP_LEADER',
    }).token;

    lockedUser = await userRepo.create({
      email: `test-api-locked-${timestamp}@bethesda.co`,
      passwordHash: 'dummy_hash',
      firstName: 'Bloqueado',
      lastName: 'Prueba',
      role: 'WORSHIP_LEADER',
      accountStatus: 'ACTIVE',
    });
    createdUserIds.add(lockedUser.id);
    await pool.query('UPDATE users SET lockout_until = NOW() + INTERVAL \'1 hour\' WHERE id = $1', [lockedUser.id]);
    lockedToken = tokenService.signAccessToken({
      sub: lockedUser.id,
      email: lockedUser.email,
      role: 'WORSHIP_LEADER',
    }).token;

    downgradedUser = await userRepo.create({
      email: `test-api-downgraded-${timestamp}@bethesda.co`,
      passwordHash: 'dummy_hash',
      firstName: 'Degradado',
      lastName: 'Prueba',
      role: 'ADMIN',
      accountStatus: 'ACTIVE',
    });
    createdUserIds.add(downgradedUser.id);
    downgradedToken = tokenService.signAccessToken({
      sub: downgradedUser.id,
      email: downgradedUser.email,
      role: 'ADMIN',
    }).token;
    // Degradar en base de datos después de la emisión del JWT
    await pool.query('UPDATE users SET role = \'MUSICIAN\' WHERE id = $1', [downgradedUser.id]);
  });

  after(async () => {
    // 1. Limpiar setlists de prueba
    if (createdSetlistIds.size > 0) {
      const ids = Array.from(createdSetlistIds);
      await pool.query('DELETE FROM setlists WHERE id = ANY($1)', [ids]);
    }
    // Limpieza general de seguridad contra cualquier setlist con título de test
    await pool.query("DELETE FROM setlists WHERE title LIKE 'Test API%' OR title LIKE 'Culto %'");

    // 2. Limpiar usuarios de prueba
    if (createdUserIds.size > 0) {
      const uIds = Array.from(createdUserIds);
      await pool.query('DELETE FROM users WHERE id = ANY($1)', [uIds]);
    }

    await app.close();
    await pool.end();
  });

  // ==========================================================================
  // SUITE 1: AUTENTICACIÓN Y ENCABEZADOS (HTTP 401)
  // ==========================================================================
  describe('1. Authentication & Bearer Header Enforcement (HTTP 401)', () => {
    it('1.1 should reject request without Authorization header with 401 UNAUTHORIZED', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/setlists',
      });

      assert.strictEqual(res.statusCode, 401);
      const json = JSON.parse(res.payload);
      assert.strictEqual(json.error.code, 'UNAUTHORIZED');
    });

    it('1.2 should reject request with invalid Bearer token with 401 UNAUTHORIZED', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/setlists',
        headers: {
          authorization: 'Bearer invalid.corrupted.jwt.token',
        },
      });

      assert.strictEqual(res.statusCode, 401);
      const json = JSON.parse(res.payload);
      assert.strictEqual(json.error.code, 'TOKEN_INVALID');
    });

    it('1.3 should reject malformed Authorization header (not starting with Bearer) with 401', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/setlists',
        headers: {
          authorization: 'Basic dXNlcjpwYXNz',
        },
      });

      assert.strictEqual(res.statusCode, 401);
      const json = JSON.parse(res.payload);
      assert.strictEqual(json.error.code, 'UNAUTHORIZED');
    });
  });

  // ==========================================================================
  // SUITE 2: MATRIZ RBAC Y CONTROL DE ACCESO (HTTP 403 vs 200/201)
  // ==========================================================================
  describe('2. RBAC Permissions Matrix & Role Isolation (HTTP 403 vs 200/201)', () => {
    let testSetlistId: string;

    before(async () => {
      // Crear un setlist base usando token de WORSHIP_LEADER
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/setlists',
        headers: { authorization: `Bearer ${leaderToken}` },
        payload: {
          title: 'Test API Setlist Base RBAC',
          scheduledDateTime: new Date().toISOString(),
          notes: 'Notas de prueba RBAC',
        },
      });
      assert.strictEqual(res.statusCode, 201);
      const json = JSON.parse(res.payload);
      testSetlistId = json.data.id;
      createdSetlistIds.add(testSetlistId);
    });

    it('2.1 VIEWER and MUSICIAN can list setlists (GET /api/v1/setlists) with 200 OK', async () => {
      const resViewer = await app.inject({
        method: 'GET',
        url: '/api/v1/setlists',
        headers: { authorization: `Bearer ${viewerToken}` },
      });
      assert.strictEqual(resViewer.statusCode, 200);
      const jsonViewer = JSON.parse(resViewer.payload);
      assert.ok(Array.isArray(jsonViewer.data));

      const resMusician = await app.inject({
        method: 'GET',
        url: '/api/v1/setlists',
        headers: { authorization: `Bearer ${musicianToken}` },
      });
      assert.strictEqual(resMusician.statusCode, 200);
      const jsonMusician = JSON.parse(resMusician.payload);
      assert.ok(Array.isArray(jsonMusician.data));
    });

    it('2.2 VIEWER cannot create setlist (POST /api/v1/setlists) with 403 FORBIDDEN', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/setlists',
        headers: { authorization: `Bearer ${viewerToken}` },
        payload: { title: 'Test API Viewer Create Attempt' },
      });

      assert.strictEqual(res.statusCode, 403);
      const json = JSON.parse(res.payload);
      assert.strictEqual(json.error.code, 'FORBIDDEN');
    });

    it('2.3 MUSICIAN cannot create setlist (POST /api/v1/setlists) with 403 FORBIDDEN', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/setlists',
        headers: { authorization: `Bearer ${musicianToken}` },
        payload: { title: 'Test API Musician Create Attempt' },
      });

      assert.strictEqual(res.statusCode, 403);
      const json = JSON.parse(res.payload);
      assert.strictEqual(json.error.code, 'FORBIDDEN');
    });

    it('2.4 MUSICIAN cannot add items (POST /api/v1/setlists/:id/items) with 403 FORBIDDEN', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/setlists/${testSetlistId}/items`,
        headers: { authorization: `Bearer ${musicianToken}` },
        payload: {
          itemType: 'SERVICE_MOMENT',
          momentTitle: 'Oración por Músico',
        },
      });

      assert.strictEqual(res.statusCode, 403);
      const json = JSON.parse(res.payload);
      assert.strictEqual(json.error.code, 'FORBIDDEN');
    });

    it('2.5 MUSICIAN cannot reorder items (PUT /api/v1/setlists/:id/reorder) with 403 FORBIDDEN', async () => {
      const res = await app.inject({
        method: 'PUT',
        url: `/api/v1/setlists/${testSetlistId}/reorder`,
        headers: { authorization: `Bearer ${musicianToken}` },
        payload: { itemIds: ['00000000-0000-0000-0000-000000000001'] },
      });

      assert.strictEqual(res.statusCode, 403);
      const json = JSON.parse(res.payload);
      assert.strictEqual(json.error.code, 'FORBIDDEN');
    });

    it('2.6 MUSICIAN cannot change status (POST /api/v1/setlists/:id/status) with 403 FORBIDDEN', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/setlists/${testSetlistId}/status`,
        headers: { authorization: `Bearer ${musicianToken}` },
        payload: { status: 'ACTIVE' },
      });

      assert.strictEqual(res.statusCode, 403);
      const json = JSON.parse(res.payload);
      assert.strictEqual(json.error.code, 'FORBIDDEN');
    });

    it('2.7 WORSHIP_LEADER cannot delete setlist (DELETE /api/v1/setlists/:id) with 403 FORBIDDEN', async () => {
      const res = await app.inject({
        method: 'DELETE',
        url: `/api/v1/setlists/${testSetlistId}`,
        headers: { authorization: `Bearer ${leaderToken}` },
      });

      assert.strictEqual(res.statusCode, 403);
      const json = JSON.parse(res.payload);
      assert.strictEqual(json.error.code, 'FORBIDDEN');
    });

    it('2.8 ADMIN can delete setlist (DELETE /api/v1/setlists/:id) with 200 OK', async () => {
      // Crear un setlist efímero para ser eliminado por ADMIN
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/v1/setlists',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: { title: 'Test API Setlist Para Borrado Por Admin' },
      });
      assert.strictEqual(createRes.statusCode, 201);
      const toDeleteId = JSON.parse(createRes.payload).data.id;

      const deleteRes = await app.inject({
        method: 'DELETE',
        url: `/api/v1/setlists/${toDeleteId}`,
        headers: { authorization: `Bearer ${adminToken}` },
      });

      assert.strictEqual(deleteRes.statusCode, 200);
      const json = JSON.parse(deleteRes.payload);
      assert.strictEqual(json.success, true);
    });
  });

  // ==========================================================================
  // SUITE 3: VERIFICACIÓN AUTORITATIVA EN BASE DE DATOS (verifyDatabaseRole = true)
  // ==========================================================================
  describe('3. Real-Time Authoritative Database Verification (verifyDatabaseRole = true)', () => {
    it('3.1 should reject mutation if user is SUSPENDED in DB despite valid JWT claims (403 FORBIDDEN)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/setlists',
        headers: { authorization: `Bearer ${suspendedToken}` },
        payload: { title: 'Test API Intento Cuenta Suspendida' },
      });

      assert.strictEqual(res.statusCode, 403);
      const json = JSON.parse(res.payload);
      assert.strictEqual(json.error.code, 'FORBIDDEN');
      assert.match(json.error.message, /estado 'SUSPENDED'/);
    });

    it('3.2 should reject mutation if user is temporarily locked out in DB (403 FORBIDDEN)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/setlists',
        headers: { authorization: `Bearer ${lockedToken}` },
        payload: { title: 'Test API Intento Cuenta Bloqueada' },
      });

      assert.strictEqual(res.statusCode, 403);
      const json = JSON.parse(res.payload);
      assert.strictEqual(json.error.code, 'FORBIDDEN');
      assert.match(json.error.message, /bloqueada por seguridad/);
    });

    it('3.3 should reject mutation if user role was downgraded in DB after JWT issuance (403 FORBIDDEN)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/setlists',
        headers: { authorization: `Bearer ${downgradedToken}` },
        payload: { title: 'Test API Intento Rol Degradado' },
      });

      assert.strictEqual(res.statusCode, 403);
      const json = JSON.parse(res.payload);
      assert.strictEqual(json.error.code, 'FORBIDDEN');
      assert.match(json.error.message, /rol actual en base de datos \(MUSICIAN\) no autoriza/);
    });
  });

  // ==========================================================================
  // SUITE 4: VALIDACIÓN DE ESQUEMAS ZOD Y POLIMORFISMO (HTTP 400)
  // ==========================================================================
  describe('4. Zod Schema Validation & Polymorphic Payload Enforcement (HTTP 400)', () => {
    let testSetlistId: string;

    before(async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/setlists',
        headers: { authorization: `Bearer ${leaderToken}` },
        payload: { title: 'Test API Setlist Para Pruebas de Esquema' },
      });
      testSetlistId = JSON.parse(res.payload).data.id;
      createdSetlistIds.add(testSetlistId);
    });

    it('4.1 should reject creation with empty title with 400 VALIDATION_ERROR', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/setlists',
        headers: { authorization: `Bearer ${leaderToken}` },
        payload: { title: '' },
      });

      assert.strictEqual(res.statusCode, 400);
      const json = JSON.parse(res.payload);
      assert.strictEqual(json.error.code, 'VALIDATION_ERROR');
    });

    it('4.2 should reject invalid UUID in route parameter :id with 400 VALIDATION_ERROR', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/setlists/not-a-valid-uuid',
        headers: { authorization: `Bearer ${leaderToken}` },
      });

      assert.strictEqual(res.statusCode, 400);
      const json = JSON.parse(res.payload);
      assert.strictEqual(json.error.code, 'VALIDATION_ERROR');
    });

    it('4.3 should reject invalid UUID in route parameter :itemId with 400 VALIDATION_ERROR', async () => {
      const res = await app.inject({
        method: 'DELETE',
        url: `/api/v1/setlists/${testSetlistId}/items/not-a-valid-uuid`,
        headers: { authorization: `Bearer ${leaderToken}` },
      });

      assert.strictEqual(res.statusCode, 400);
      const json = JSON.parse(res.payload);
      assert.strictEqual(json.error.code, 'VALIDATION_ERROR');
    });

    it('4.4 should reject invalid status transition body with 400 VALIDATION_ERROR', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/setlists/${testSetlistId}/status`,
        headers: { authorization: `Bearer ${leaderToken}` },
        payload: { status: 'INVALID_STATUS' },
      });

      assert.strictEqual(res.statusCode, 400);
      const json = JSON.parse(res.payload);
      assert.strictEqual(json.error.code, 'VALIDATION_ERROR');
    });

    it('4.5 should reject SONG item without songId with 400 VALIDATION_ERROR', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/setlists/${testSetlistId}/items`,
        headers: { authorization: `Bearer ${leaderToken}` },
        payload: {
          itemType: 'SONG',
          // songId omitido
        },
      });

      assert.strictEqual(res.statusCode, 400);
      const json = JSON.parse(res.payload);
      assert.strictEqual(json.error.code, 'VALIDATION_ERROR');
    });

    it('4.6 should reject SERVICE_MOMENT item with songId (discriminated union failure) with 400', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/setlists/${testSetlistId}/items`,
        headers: { authorization: `Bearer ${leaderToken}` },
        payload: {
          itemType: 'SERVICE_MOMENT',
          momentTitle: 'Oración',
          songId: canonicalSongId, // Prohibido en SERVICE_MOMENT
        },
      });

      assert.strictEqual(res.statusCode, 400);
      const json = JSON.parse(res.payload);
      assert.strictEqual(json.error.code, 'VALIDATION_ERROR');
    });

    it('4.7 should reject BPM out of range (< 20 or > 300) with 400 VALIDATION_ERROR', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/setlists/${testSetlistId}/items`,
        headers: { authorization: `Bearer ${leaderToken}` },
        payload: {
          itemType: 'SONG',
          songId: canonicalSongId,
          targetBpm: 500, // Máximo es 300
        },
      });

      assert.strictEqual(res.statusCode, 400);
      const json = JSON.parse(res.payload);
      assert.strictEqual(json.error.code, 'VALIDATION_ERROR');
    });

    it('4.8 should reject reordering with empty array or duplicate IDs with 400 VALIDATION_ERROR', async () => {
      const resEmpty = await app.inject({
        method: 'PUT',
        url: `/api/v1/setlists/${testSetlistId}/reorder`,
        headers: { authorization: `Bearer ${leaderToken}` },
        payload: { itemIds: [] },
      });
      assert.strictEqual(resEmpty.statusCode, 400);

      const dupId = '00000000-0000-0000-0000-000000000001';
      const resDup = await app.inject({
        method: 'PUT',
        url: `/api/v1/setlists/${testSetlistId}/reorder`,
        headers: { authorization: `Bearer ${leaderToken}` },
        payload: { itemIds: [dupId, dupId] },
      });
      assert.strictEqual(resDup.statusCode, 400);
    });
  });

  // ==========================================================================
  // SUITE 5: ERRORES DE DOMINIO (HTTP 404 Y 409)
  // ==========================================================================
  describe('5. Domain Errors Mapping: Not Found (404) & State/Concurrency Conflicts (409)', () => {
    it('5.1 should return 404 NOT_FOUND for non-existent setlist ID', async () => {
      const nonExistentId = '99999999-9999-9999-9999-999999999999';
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/setlists/${nonExistentId}`,
        headers: { authorization: `Bearer ${leaderToken}` },
      });

      assert.strictEqual(res.statusCode, 404);
      const json = JSON.parse(res.payload);
      assert.strictEqual(json.error.code, 'NOT_FOUND');
    });

    it('5.2 should return 404 NOT_FOUND when adding SONG item with non-existent songId', async () => {
      const setlistRes = await app.inject({
        method: 'POST',
        url: '/api/v1/setlists',
        headers: { authorization: `Bearer ${leaderToken}` },
        payload: { title: 'Test API Setlist Para Cancion Inexistente' },
      });
      const sId = JSON.parse(setlistRes.payload).data.id;
      createdSetlistIds.add(sId);

      const nonExistentSongId = '88888888-8888-8888-8888-888888888888';
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/setlists/${sId}/items`,
        headers: { authorization: `Bearer ${leaderToken}` },
        payload: {
          itemType: 'SONG',
          songId: nonExistentSongId,
        },
      });

      assert.strictEqual(res.statusCode, 404);
      const json = JSON.parse(res.payload);
      assert.strictEqual(json.error.code, 'NOT_FOUND');
    });

    it('5.3 should return 409 CONFLICT on illegal status transition (COMPLETED -> PLANNING)', async () => {
      // Crear setlist, pasar a ACTIVE y luego a COMPLETED
      const sRes = await app.inject({
        method: 'POST',
        url: '/api/v1/setlists',
        headers: { authorization: `Bearer ${leaderToken}` },
        payload: { title: 'Test API Setlist Ciclo Completo Transicion Ilegal' },
      });
      const sId = JSON.parse(sRes.payload).data.id;
      createdSetlistIds.add(sId);

      await app.inject({
        method: 'POST',
        url: `/api/v1/setlists/${sId}/status`,
        headers: { authorization: `Bearer ${leaderToken}` },
        payload: { status: 'ACTIVE' },
      });

      await app.inject({
        method: 'POST',
        url: `/api/v1/setlists/${sId}/status`,
        headers: { authorization: `Bearer ${leaderToken}` },
        payload: { status: 'COMPLETED' },
      });

      // Intento de regresar a PLANNING
      const illegalRes = await app.inject({
        method: 'POST',
        url: `/api/v1/setlists/${sId}/status`,
        headers: { authorization: `Bearer ${leaderToken}` },
        payload: { status: 'PLANNING' },
      });

      assert.strictEqual(illegalRes.statusCode, 409);
      const json = JSON.parse(illegalRes.payload);
      assert.strictEqual(json.error.code, 'CONFLICT');
      assert.match(json.error.message, /Transición de estado litúrgico no permitida/);
    });

    it('5.4 should return 409 CONFLICT when activating a setlist when another is already ACTIVE (Rule A)', async () => {
      // Setlist 1: activar
      const s1Res = await app.inject({
        method: 'POST',
        url: '/api/v1/setlists',
        headers: { authorization: `Bearer ${leaderToken}` },
        payload: { title: 'Test API Culto Activo 1' },
      });
      const s1Id = JSON.parse(s1Res.payload).data.id;
      createdSetlistIds.add(s1Id);

      const act1 = await app.inject({
        method: 'POST',
        url: `/api/v1/setlists/${s1Id}/status`,
        headers: { authorization: `Bearer ${leaderToken}` },
        payload: { status: 'ACTIVE' },
      });
      assert.strictEqual(act1.statusCode, 200);

      // Setlist 2: intentar activar mientras Setlist 1 sigue activo
      const s2Res = await app.inject({
        method: 'POST',
        url: '/api/v1/setlists',
        headers: { authorization: `Bearer ${leaderToken}` },
        payload: { title: 'Test API Culto Competidor 2' },
      });
      const s2Id = JSON.parse(s2Res.payload).data.id;
      createdSetlistIds.add(s2Id);

      const act2 = await app.inject({
        method: 'POST',
        url: `/api/v1/setlists/${s2Id}/status`,
        headers: { authorization: `Bearer ${leaderToken}` },
        payload: { status: 'ACTIVE' },
      });

      assert.strictEqual(act2.statusCode, 409);
      const json = JSON.parse(act2.payload);
      assert.strictEqual(json.error.code, 'CONFLICT');
      assert.match(json.error.message, /Ya existe un setlist en estado ACTIVE/);

      // Liberar Setlist 1 completándolo
      await app.inject({
        method: 'POST',
        url: `/api/v1/setlists/${s1Id}/status`,
        headers: { authorization: `Bearer ${leaderToken}` },
        payload: { status: 'COMPLETED' },
      });
    });

    it('5.5 should return 409 CONFLICT when attempting to mutate items in COMPLETED or ARCHIVED setlist (Rule C)', async () => {
      const sRes = await app.inject({
        method: 'POST',
        url: '/api/v1/setlists',
        headers: { authorization: `Bearer ${leaderToken}` },
        payload: { title: 'Test API Setlist Concluido Inmutable' },
      });
      const sId = JSON.parse(sRes.payload).data.id;
      createdSetlistIds.add(sId);

      // Pasar a ARCHIVED
      await app.inject({
        method: 'POST',
        url: `/api/v1/setlists/${sId}/status`,
        headers: { authorization: `Bearer ${leaderToken}` },
        payload: { status: 'ARCHIVED' },
      });

      // Intento de agregar ítem
      const itemRes = await app.inject({
        method: 'POST',
        url: `/api/v1/setlists/${sId}/items`,
        headers: { authorization: `Bearer ${leaderToken}` },
        payload: {
          itemType: 'SERVICE_MOMENT',
          momentTitle: 'Momento en Histórico',
        },
      });

      assert.strictEqual(itemRes.statusCode, 409);
      const json = JSON.parse(itemRes.payload);
      assert.strictEqual(json.error.code, 'CONFLICT');
      assert.match(json.error.message, /No se pueden agregar elementos a un setlist en estado ARCHIVED/);
    });
  });

  // ==========================================================================
  // SUITE 6: PROTECCIÓN IDOR (INSECURE DIRECT OBJECT REFERENCE)
  // ==========================================================================
  describe('6. Insecure Direct Object Reference (IDOR) Protection', () => {
    it('6.1 should return 404 when updating an item using a setlist ID it does NOT belong to', async () => {
      // Setlist A
      const resA = await app.inject({
        method: 'POST',
        url: '/api/v1/setlists',
        headers: { authorization: `Bearer ${leaderToken}` },
        payload: { title: 'Test API Setlist IDOR A' },
      });
      const setlistAId = JSON.parse(resA.payload).data.id;
      createdSetlistIds.add(setlistAId);

      // Agregar ítem a Setlist A
      const itemRes = await app.inject({
        method: 'POST',
        url: `/api/v1/setlists/${setlistAId}/items`,
        headers: { authorization: `Bearer ${leaderToken}` },
        payload: {
          itemType: 'SERVICE_MOMENT',
          momentTitle: 'Momento A',
        },
      });
      const itemAId = JSON.parse(itemRes.payload).data.id;

      // Setlist B
      const resB = await app.inject({
        method: 'POST',
        url: '/api/v1/setlists',
        headers: { authorization: `Bearer ${leaderToken}` },
        payload: { title: 'Test API Setlist IDOR B' },
      });
      const setlistBId = JSON.parse(resB.payload).data.id;
      createdSetlistIds.add(setlistBId);

      // Intentar actualizar itemAId a través de la ruta de Setlist B
      const idorRes = await app.inject({
        method: 'PUT',
        url: `/api/v1/setlists/${setlistBId}/items/${itemAId}`,
        headers: { authorization: `Bearer ${leaderToken}` },
        payload: {
          momentTitle: 'Intento IDOR Modificar Momento A desde B',
        },
      });

      assert.strictEqual(idorRes.statusCode, 404);
      const json = JSON.parse(idorRes.payload);
      assert.strictEqual(json.error.code, 'NOT_FOUND');
    });

    it('6.2 should return 404 when deleting an item using a setlist ID it does NOT belong to', async () => {
      // Setlist A
      const resA = await app.inject({
        method: 'POST',
        url: '/api/v1/setlists',
        headers: { authorization: `Bearer ${leaderToken}` },
        payload: { title: 'Test API Setlist IDOR Delete A' },
      });
      const setlistAId = JSON.parse(resA.payload).data.id;
      createdSetlistIds.add(setlistAId);

      const itemRes = await app.inject({
        method: 'POST',
        url: `/api/v1/setlists/${setlistAId}/items`,
        headers: { authorization: `Bearer ${leaderToken}` },
        payload: {
          itemType: 'SERVICE_MOMENT',
          momentTitle: 'Momento Para Borrado IDOR',
        },
      });
      const itemAId = JSON.parse(itemRes.payload).data.id;

      // Setlist B
      const resB = await app.inject({
        method: 'POST',
        url: '/api/v1/setlists',
        headers: { authorization: `Bearer ${leaderToken}` },
        payload: { title: 'Test API Setlist IDOR Delete B' },
      });
      const setlistBId = JSON.parse(resB.payload).data.id;
      createdSetlistIds.add(setlistBId);

      // Intentar borrar itemAId a través de la ruta de Setlist B
      const idorRes = await app.inject({
        method: 'DELETE',
        url: `/api/v1/setlists/${setlistBId}/items/${itemAId}`,
        headers: { authorization: `Bearer ${leaderToken}` },
      });

      assert.strictEqual(idorRes.statusCode, 404);
      const json = JSON.parse(idorRes.payload);
      assert.strictEqual(json.error.code, 'NOT_FOUND');
    });
  });

  // ==========================================================================
  // SUITE 7: INVARIANTE CANÓNICA ABSOLUTA
  // ==========================================================================
  describe('7. Canonical Song Immutability Invariant', () => {
    it('7.1 should NOT mutate canonical song in songs table when adding liturgical key/bpm override in setlist item', async () => {
      // 1. Consultar estado original de la canción
      const originalQuery = await pool.query('SELECT default_key, default_bpm FROM songs WHERE id = $1', [canonicalSongId]);
      const originalKey = originalQuery.rows[0].default_key;
      const originalBpm = originalQuery.rows[0].default_bpm;

      // 2. Crear setlist y agregar ítem con sobreescrituras litúrgicas contrastantes
      const sRes = await app.inject({
        method: 'POST',
        url: '/api/v1/setlists',
        headers: { authorization: `Bearer ${leaderToken}` },
        payload: { title: 'Test API Culto Con Sobreescritura Liturgica' },
      });
      const sId = JSON.parse(sRes.payload).data.id;
      createdSetlistIds.add(sId);

      const liturgicalKey = 'Ab Major';
      const liturgicalBpm = 175;

      const itemRes = await app.inject({
        method: 'POST',
        url: `/api/v1/setlists/${sId}/items`,
        headers: { authorization: `Bearer ${leaderToken}` },
        payload: {
          itemType: 'SONG',
          songId: canonicalSongId,
          targetKey: liturgicalKey,
          targetBpm: liturgicalBpm,
          transitionType: 'CROSSFADE',
          notesForTeam: 'Notas específicas del director',
        },
      });
      assert.strictEqual(itemRes.statusCode, 201);

      // 3. Verificar que el ítem del setlist guardó la sobreescritura
      const itemJson = JSON.parse(itemRes.payload).data;
      assert.strictEqual(itemJson.targetKey, liturgicalKey);
      assert.strictEqual(itemJson.targetBpm, liturgicalBpm);

      // 4. Verificar que la tabla songs permanece 100% inalterada
      const postQuery = await pool.query('SELECT default_key, default_bpm FROM songs WHERE id = $1', [canonicalSongId]);
      assert.strictEqual(postQuery.rows[0].default_key, originalKey);
      assert.strictEqual(postQuery.rows[0].default_bpm, originalBpm);
    });
  });

  // ==========================================================================
  // SUITE 8: AUDITORÍA MANDATORIA (SETLIST_CREATED, SETLIST_ACTIVATED, SETLIST_DELETED)
  // ==========================================================================
  describe('8. Mandatory Security Audit Events (SETLIST_CREATED, SETLIST_ACTIVATED, SETLIST_DELETED)', () => {
    it('8.1 should register SETLIST_CREATED audit log event upon setlist creation', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/setlists',
        headers: { authorization: `Bearer ${leaderToken}` },
        payload: { title: 'Test API Culto Auditoria Creacion' },
      });
      assert.strictEqual(res.statusCode, 201);
      const sId = JSON.parse(res.payload).data.id;
      createdSetlistIds.add(sId);

      const auditRes = await pool.query(
        "SELECT event_type, user_id, resource, metadata FROM audit_logs WHERE event_type = 'SETLIST_CREATED' AND resource = $1",
        [`setlist:${sId}`]
      );

      assert.strictEqual(auditRes.rows.length, 1);
      assert.strictEqual(auditRes.rows[0].user_id, leaderUser.id);
      assert.strictEqual(auditRes.rows[0].metadata.title, 'Test API Culto Auditoria Creacion');
    });

    it('8.2 should register SETLIST_ACTIVATED audit log event upon status transition to ACTIVE', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/setlists',
        headers: { authorization: `Bearer ${leaderToken}` },
        payload: { title: 'Test API Culto Auditoria Activacion' },
      });
      const sId = JSON.parse(res.payload).data.id;
      createdSetlistIds.add(sId);

      const actRes = await app.inject({
        method: 'POST',
        url: `/api/v1/setlists/${sId}/status`,
        headers: { authorization: `Bearer ${leaderToken}` },
        payload: { status: 'ACTIVE' },
      });
      assert.strictEqual(actRes.statusCode, 200);

      const auditRes = await pool.query(
        "SELECT event_type, user_id, resource, metadata FROM audit_logs WHERE event_type = 'SETLIST_ACTIVATED' AND resource = $1",
        [`setlist:${sId}`]
      );

      assert.strictEqual(auditRes.rows.length, 1);
      assert.strictEqual(auditRes.rows[0].user_id, leaderUser.id);
      assert.strictEqual(auditRes.rows[0].metadata.newStatus, 'ACTIVE');

      // Completar para no dejar activo
      await app.inject({
        method: 'POST',
        url: `/api/v1/setlists/${sId}/status`,
        headers: { authorization: `Bearer ${leaderToken}` },
        payload: { status: 'COMPLETED' },
      });
    });

    it('8.3 should register SETLIST_DELETED audit log event upon deletion by ADMIN', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/setlists',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: { title: 'Test API Culto Auditoria Borrado' },
      });
      const sId = JSON.parse(res.payload).data.id;

      const delRes = await app.inject({
        method: 'DELETE',
        url: `/api/v1/setlists/${sId}`,
        headers: { authorization: `Bearer ${adminToken}` },
      });
      assert.strictEqual(delRes.statusCode, 200);

      const auditRes = await pool.query(
        "SELECT event_type, user_id, resource, metadata FROM audit_logs WHERE event_type = 'SETLIST_DELETED' AND resource = $1",
        [`setlist:${sId}`]
      );

      assert.strictEqual(auditRes.rows.length, 1);
      assert.strictEqual(auditRes.rows[0].user_id, adminUser.id);
      assert.strictEqual(auditRes.rows[0].metadata.title, 'Test API Culto Auditoria Borrado');
    });
  });

  // ==========================================================================
  // SUITE 9: REORDENAMIENTO ATÓMICO TRANSACCIONAL (HTTP 200)
  // ==========================================================================
  describe('9. Atomic Transactional Reordering (PUT /api/v1/setlists/:id/reorder)', () => {
    it('9.1 should reorder items atomically in single SQL transaction', async () => {
      const sRes = await app.inject({
        method: 'POST',
        url: '/api/v1/setlists',
        headers: { authorization: `Bearer ${leaderToken}` },
        payload: { title: 'Test API Culto Reordenamiento Atomico' },
      });
      const sId = JSON.parse(sRes.payload).data.id;
      createdSetlistIds.add(sId);

      // Agregar 3 ítems
      const item1 = await app.inject({
        method: 'POST',
        url: `/api/v1/setlists/${sId}/items`,
        headers: { authorization: `Bearer ${leaderToken}` },
        payload: { itemType: 'SERVICE_MOMENT', momentTitle: 'Bienvenida' },
      });
      const id1 = JSON.parse(item1.payload).data.id;

      const item2 = await app.inject({
        method: 'POST',
        url: `/api/v1/setlists/${sId}/items`,
        headers: { authorization: `Bearer ${leaderToken}` },
        payload: { itemType: 'SONG', songId: canonicalSongId },
      });
      const id2 = JSON.parse(item2.payload).data.id;

      const item3 = await app.inject({
        method: 'POST',
        url: `/api/v1/setlists/${sId}/items`,
        headers: { authorization: `Bearer ${leaderToken}` },
        payload: { itemType: 'SERVICE_MOMENT', momentTitle: 'Ofrendas' },
      });
      const id3 = JSON.parse(item3.payload).data.id;

      // Invertir orden: [id3, id2, id1]
      const reorderRes = await app.inject({
        method: 'PUT',
        url: `/api/v1/setlists/${sId}/reorder`,
        headers: { authorization: `Bearer ${leaderToken}` },
        payload: { itemIds: [id3, id2, id1] },
      });

      assert.strictEqual(reorderRes.statusCode, 200);
      const reordered = JSON.parse(reorderRes.payload).data;
      assert.strictEqual(reordered[0].id, id3);
      assert.strictEqual(reordered[0].sequenceOrder, 1);
      assert.strictEqual(reordered[1].id, id2);
      assert.strictEqual(reordered[1].sequenceOrder, 2);
      assert.strictEqual(reordered[2].id, id1);
      assert.strictEqual(reordered[2].sequenceOrder, 3);
    });
  });
});
