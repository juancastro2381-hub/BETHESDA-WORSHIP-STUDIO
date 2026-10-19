/**
 * @file api-routes.test.ts
 * @description Pruebas de integración de la API HTTP con Fastify y RBAC estricto (/api/v1/songs).
 */

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../app.ts';
import { pool } from '../db/index.ts';
import { runMigrations } from '../db/migrate.ts';
import { createReferenceSongFixture } from '../../../frontend/src/core/canonical-model/fixtures/reference-song.ts';
import { CanonicalSerializer } from '../domain/canonical-serializer.ts';
import { DrizzleUserRepository } from '../repositories/user-repository.ts';
import { JwtTokenService } from '../application/token-service.ts';
import { env } from '../config/env.ts';
import type { UserEntity } from '../domain/auth-types.ts';

describe('Phase 2A / Post-Doc Remediation — Song Catalog RBAC & Fastify HTTP API (/api/v1/songs)', () => {
  let app: FastifyInstance;
  let userRepo: DrizzleUserRepository;
  let tokenService: JwtTokenService;

  let leaderUser: UserEntity;
  let musicianUser: UserEntity;
  let viewerUser: UserEntity;

  let leaderToken: string;
  let musicianToken: string;
  let viewerToken: string;
  let expiredToken: string;

  const createdUserIds: string[] = [];
  const createdSongIds: string[] = [];

  before(async () => {
    await runMigrations();
    userRepo = new DrizzleUserRepository();
    tokenService = new JwtTokenService(env.JWT_SECRET, env.JWT_ACCESS_EXPIRES_IN);

    app = await buildApp();
    await app.ready();

    const timestamp = Date.now();

    // Crear líder de alabanza (songs:read, songs:create, songs:update_draft)
    leaderUser = await userRepo.create({
      email: `song-leader-${timestamp}@bethesda.test`,
      passwordHash: 'dummy_hash',
      firstName: 'Líder',
      lastName: 'Alabanza',
      role: 'WORSHIP_LEADER',
      accountStatus: 'ACTIVE',
      emailVerified: true,
    });
    createdUserIds.push(leaderUser.id);
    leaderToken = tokenService.signAccessToken({
      sub: leaderUser.id,
      email: leaderUser.email,
      role: leaderUser.role,
    }).token;

    // Crear músico (songs:read, songs:update_draft; NO songs:create)
    musicianUser = await userRepo.create({
      email: `song-musician-${timestamp}@bethesda.test`,
      passwordHash: 'dummy_hash',
      firstName: 'Músico',
      lastName: 'Instrumentista',
      role: 'MUSICIAN',
      accountStatus: 'ACTIVE',
      emailVerified: true,
    });
    createdUserIds.push(musicianUser.id);
    musicianToken = tokenService.signAccessToken({
      sub: musicianUser.id,
      email: musicianUser.email,
      role: musicianUser.role,
    }).token;

    // Crear viewer (solo songs:read)
    viewerUser = await userRepo.create({
      email: `song-viewer-${timestamp}@bethesda.test`,
      passwordHash: 'dummy_hash',
      firstName: 'Lector',
      lastName: 'Espectador',
      role: 'VIEWER',
      accountStatus: 'ACTIVE',
      emailVerified: true,
    });
    createdUserIds.push(viewerUser.id);
    viewerToken = tokenService.signAccessToken({
      sub: viewerUser.id,
      email: viewerUser.email,
      role: viewerUser.role,
    }).token;

    // Crear token expirado (-10s)
    const expiredTokenService = new JwtTokenService({ secret: env.JWT_SECRET, expirationSeconds: -10 });
    expiredToken = expiredTokenService.signAccessToken({
      sub: leaderUser.id,
      email: leaderUser.email,
      role: leaderUser.role,
    }).token;
  });

  after(async () => {
    if (app) {
      await app.close();
    }
    if (createdSongIds.length > 0) {
      await pool.query('DELETE FROM songs WHERE id = ANY($1)', [createdSongIds]);
    }
    if (createdUserIds.length > 0) {
      await pool.query('DELETE FROM users WHERE id = ANY($1)', [createdUserIds]);
    }
    await pool.end();
  });

  it('1. GET /api/v1/health should remain public and return ok with connected database', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/health',
    });

    assert.strictEqual(response.statusCode, 200);
    const body = JSON.parse(response.payload);
    assert.strictEqual(body.status, 'ok');
    assert.strictEqual(body.database, 'connected');
    assert.ok(body.timestamp);
  });

  it('2. Anonymous requests to protected song endpoints must be rejected with 401 Unauthorized', async () => {
    // 2a. Listado anónimo
    const listRes = await app.inject({
      method: 'GET',
      url: '/api/v1/songs',
    });
    assert.strictEqual(listRes.statusCode, 401);

    // 2b. Creación anónima
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v1/songs',
      payload: { title: 'Test Anónimo' },
    });
    assert.strictEqual(createRes.statusCode, 401);

    // 2c. Importación anónima
    const importRes = await app.inject({
      method: 'POST',
      url: '/api/v1/songs/import',
      payload: { source: 'Title: Anónimo\nC G Am F' },
    });
    assert.strictEqual(importRes.statusCode, 401);

    // 2d. Lectura por ID anónima
    const getRes = await app.inject({
      method: 'GET',
      url: '/api/v1/songs/00000000-0000-0000-0000-000000000001',
    });
    assert.strictEqual(getRes.statusCode, 401);

    // 2e. Creación de versiones anónima
    const versionRes = await app.inject({
      method: 'POST',
      url: '/api/v1/songs/00000000-0000-0000-0000-000000000001/versions',
      payload: { name: 'V2' },
    });
    assert.strictEqual(versionRes.statusCode, 401);
  });

  it('3. Malformed, forged or expired tokens must NOT bypass song protection (401 Unauthorized)', async () => {
    // 3a. Token expirado
    const expiredRes = await app.inject({
      method: 'GET',
      url: '/api/v1/songs',
      headers: { authorization: `Bearer ${expiredToken}` },
    });
    assert.strictEqual(expiredRes.statusCode, 401);

    // 3b. Token con firma corrupta / falsificada
    const forgedToken = `${leaderToken.slice(0, -5)}XXXXX`;
    const forgedRes = await app.inject({
      method: 'GET',
      url: '/api/v1/songs',
      headers: { authorization: `Bearer ${forgedToken}` },
    });
    assert.strictEqual(forgedRes.statusCode, 401);

    // 3c. Formato de encabezado no válido
    const invalidHeaderRes = await app.inject({
      method: 'GET',
      url: '/api/v1/songs',
      headers: { authorization: `Basic ${leaderToken}` },
    });
    assert.strictEqual(invalidHeaderRes.statusCode, 401);
  });

  it('4. Authenticated users with insufficient permissions must be rejected with 403 Forbidden', async () => {
    const canonicalSong = createReferenceSongFixture();
    const canonicalJSON = CanonicalSerializer.serialize(canonicalSong);

    // 4a. VIEWER intentando crear canción (carece de songs:create)
    const viewerCreateRes = await app.inject({
      method: 'POST',
      url: '/api/v1/songs',
      headers: { authorization: `Bearer ${viewerToken}` },
      payload: {
        title: 'Canción no autorizada',
        defaultKey: 'C',
        sourceFormat: 'INTERNAL',
        canonicalPayload: canonicalJSON,
      },
    });
    assert.strictEqual(viewerCreateRes.statusCode, 403);
    const viewerBody = JSON.parse(viewerCreateRes.payload);
    assert.match(viewerBody.error.message, /songs:create/);

    // 4b. VIEWER intentando importar canción directamente (carece de songs:create)
    const viewerImportRes = await app.inject({
      method: 'POST',
      url: '/api/v1/songs/import',
      headers: { authorization: `Bearer ${viewerToken}` },
      payload: {
        source: 'Title: Canción Prohibida\nC G Am F',
      },
    });
    assert.strictEqual(viewerImportRes.statusCode, 403);

    // 4c. MUSICIAN intentando crear canción nueva (MUSICIAN solo tiene songs:update_draft, no songs:create)
    const musicianCreateRes = await app.inject({
      method: 'POST',
      url: '/api/v1/songs',
      headers: { authorization: `Bearer ${musicianToken}` },
      payload: {
        title: 'Canción de Músico no autorizada',
        defaultKey: 'G',
        sourceFormat: 'INTERNAL',
        canonicalPayload: canonicalJSON,
      },
    });
    assert.strictEqual(musicianCreateRes.statusCode, 403);
    assert.match(JSON.parse(musicianCreateRes.payload).error.message, /songs:create/);
  });

  it('5. Authorized users can perform permitted operations (POST /songs, GET /songs, GET /songs/:id)', async () => {
    const canonicalSong = createReferenceSongFixture();
    const canonicalJSON = CanonicalSerializer.serialize(canonicalSong);

    // 5a. WORSHIP_LEADER crea canción exitosamente (songs:create)
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v1/songs',
      headers: { authorization: `Bearer ${leaderToken}` },
      payload: {
        title: 'Himno de Gloria API Test',
        artist: 'Compositor API',
        defaultKey: 'D Major',
        defaultBpm: 128,
        timeSignature: '4/4',
        status: 'DRAFT',
        sourceFormat: 'INTERNAL',
        canonicalPayload: canonicalJSON,
      },
    });

    assert.strictEqual(createRes.statusCode, 201);
    const created = JSON.parse(createRes.payload).data;
    assert.ok(created.song.id);
    createdSongIds.push(created.song.id);
    assert.strictEqual(created.song.title, 'Himno de Gloria API Test');
    assert.strictEqual(created.version.versionNumber, 1);

    // 5b. VIEWER puede listar canciones (songs:read)
    const listRes = await app.inject({
      method: 'GET',
      url: '/api/v1/songs?limit=5&offset=0',
      headers: { authorization: `Bearer ${viewerToken}` },
    });

    assert.strictEqual(listRes.statusCode, 200);
    const listBody = JSON.parse(listRes.payload);
    assert.ok(Array.isArray(listBody.data));
    assert.ok(listBody.pagination);

    // 5c. MUSICIAN puede consultar canción por ID (songs:read)
    const getRes = await app.inject({
      method: 'GET',
      url: `/api/v1/songs/${created.song.id}`,
      headers: { authorization: `Bearer ${musicianToken}` },
    });

    assert.strictEqual(getRes.statusCode, 200);
    const getBody = JSON.parse(getRes.payload);
    assert.strictEqual(getBody.data.song.id, created.song.id);
    assert.strictEqual(getBody.data.version.id, created.version.id);
  });

  it('6. Version management and import endpoints enforce RBAC scrutiny (songs:update_draft and songs:create)', async () => {
    const canonicalSong = createReferenceSongFixture();
    const canonicalJSON = CanonicalSerializer.serialize(canonicalSong);

    // Crear canción base
    const baseRes = await app.inject({
      method: 'POST',
      url: '/api/v1/songs',
      headers: { authorization: `Bearer ${leaderToken}` },
      payload: {
        title: 'Canción para Pruebas de Versiones',
        defaultKey: 'A',
        sourceFormat: 'INTERNAL',
        canonicalPayload: canonicalJSON,
      },
    });
    const songId = JSON.parse(baseRes.payload).data.song.id;
    createdSongIds.push(songId);

    // 6a. VIEWER intenta crear versión -> 403 Forbidden (carece de songs:update_draft)
    const viewerVersionRes = await app.inject({
      method: 'POST',
      url: `/api/v1/songs/${songId}/versions`,
      headers: { authorization: `Bearer ${viewerToken}` },
      payload: {
        name: 'Versión Prohibida',
        sourceFormat: 'INTERNAL',
        canonicalPayload: canonicalJSON,
      },
    });
    assert.strictEqual(viewerVersionRes.statusCode, 403);

    // 6b. MUSICIAN crea versión exitosamente (posee songs:update_draft)
    const musicianVersionRes = await app.inject({
      method: 'POST',
      url: `/api/v1/songs/${songId}/versions`,
      headers: { authorization: `Bearer ${musicianToken}` },
      payload: {
        name: 'Arreglo de Guitarra Eléctrica',
        description: 'Creado por músico autorizado',
        sourceFormat: 'INTERNAL',
        canonicalPayload: canonicalJSON,
        setAsCurrent: false,
      },
    });
    assert.strictEqual(musicianVersionRes.statusCode, 201);
    const v2Body = JSON.parse(musicianVersionRes.payload);
    assert.strictEqual(v2Body.data.versionNumber, 2);

    // 6c. VIEWER consulta historial de versiones -> 200 OK (songs:read)
    const listVersionsRes = await app.inject({
      method: 'GET',
      url: `/api/v1/songs/${songId}/versions`,
      headers: { authorization: `Bearer ${viewerToken}` },
    });
    assert.strictEqual(listVersionsRes.statusCode, 200);
    const versionsBody = JSON.parse(listVersionsRes.payload);
    assert.strictEqual(versionsBody.data.length, 2);

    // 6d. Importación por parte de WORSHIP_LEADER -> 201 Created (songs:create)
    const chordProSource = '{title: Alaba a Dios}\n{key: G}\n[G]Alaba a Dios en su [C]santuario';
    const importRes = await app.inject({
      method: 'POST',
      url: '/api/v1/songs/import',
      headers: { authorization: `Bearer ${leaderToken}` },
      payload: {
        source: chordProSource,
        filename: 'alaba_a_dios.cho',
      },
    });
    assert.strictEqual(importRes.statusCode, 201);
    const importData = JSON.parse(importRes.payload).data;
    assert.ok(importData.song.id);
    createdSongIds.push(importData.song.id);
    assert.strictEqual(importData.song.title, 'Alaba a Dios');
  });

  it('7. should reject invalid payloads with structured 400 VALIDATION_ERROR when authorized', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/songs',
      headers: { authorization: `Bearer ${leaderToken}` },
      payload: {
        title: '', // Inválido
        defaultKey: 'C',
        sourceFormat: 'INTERNAL',
        canonicalPayload: {},
      },
    });

    assert.strictEqual(response.statusCode, 400);
    const body = JSON.parse(response.payload);
    assert.strictEqual(body.error.code, 'VALIDATION_ERROR');
    assert.ok(body.error.details);
  });

  it('8. should return 404 NOT_FOUND when requesting non-existent song with authorized token', async () => {
    const randomUuid = '99999999-9999-9999-9999-999999999999';
    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/songs/${randomUuid}`,
      headers: { authorization: `Bearer ${viewerToken}` },
    });

    assert.strictEqual(response.statusCode, 404);
    const body = JSON.parse(response.payload);
    assert.strictEqual(body.error.code, 'NOT_FOUND');
  });

  it('9. should return 422 INVALID_MUSIC_PAYLOAD when canonical payload is malformed with authorized token', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/songs',
      headers: { authorization: `Bearer ${leaderToken}` },
      payload: {
        title: 'Canción con Payload Roto',
        defaultKey: 'C',
        sourceFormat: 'INTERNAL',
        canonicalPayload: {
          title: 'Payload Roto',
        },
      },
    });

    assert.strictEqual(response.statusCode, 422);
    const body = JSON.parse(response.payload);
    assert.strictEqual(body.error.code, 'INVALID_MUSIC_PAYLOAD');
  });

  it('10. should reject suspended, locked, or deactivated accounts on sensitive mutations and preserve persistent state immutability', async () => {
    const timestamp = Date.now();
    // Crear usuario suspendido con rol WORSHIP_LEADER
    const suspendedUser = await userRepo.create({
      email: `suspended-leader-${timestamp}@bethesda.test`,
      passwordHash: 'dummy_hash',
      firstName: 'Suspendido',
      lastName: 'Usuario',
      role: 'WORSHIP_LEADER',
      accountStatus: 'SUSPENDED',
      emailVerified: true,
    });
    createdUserIds.push(suspendedUser.id);
    const suspendedToken = tokenService.signAccessToken({
      sub: suspendedUser.id,
      email: suspendedUser.email,
      role: suspendedUser.role,
    }).token;

    const canonicalSong = createReferenceSongFixture();
    const canonicalJSON = CanonicalSerializer.serialize(canonicalSong);

    // 10a. Intentar POST /api/v1/songs con cuenta suspendida -> 403 Forbidden
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v1/songs',
      headers: { authorization: `Bearer ${suspendedToken}` },
      payload: {
        title: 'Canción Intento Suspendido',
        defaultKey: 'E',
        sourceFormat: 'INTERNAL',
        canonicalPayload: canonicalJSON,
      },
    });
    assert.strictEqual(createRes.statusCode, 403);
    const createBody = JSON.parse(createRes.payload);
    assert.match(createBody.error.message, /SUSPENDED/);

    // Invariante de persistencia: verificar que NO se insertó la canción en la BD
    const songDbCheck = await pool.query('SELECT COUNT(*) FROM songs WHERE title = $1', [
      'Canción Intento Suspendido',
    ]);
    assert.strictEqual(Number(songDbCheck.rows[0].count), 0);

    // 10b. Intentar POST /api/v1/songs/import con cuenta suspendida -> 403 Forbidden
    const importRes = await app.inject({
      method: 'POST',
      url: '/api/v1/songs/import',
      headers: { authorization: `Bearer ${suspendedToken}` },
      payload: {
        source: '{title: Import Intento Suspendido}\n[C]Prueba',
        filename: 'suspendido.cho',
      },
    });
    assert.strictEqual(importRes.statusCode, 403);
    const importDbCheck = await pool.query('SELECT COUNT(*) FROM songs WHERE title = $1', [
      'Import Intento Suspendido',
    ]);
    assert.strictEqual(Number(importDbCheck.rows[0].count), 0);

    // 10c. Usuario bloqueado por seguridad (lockoutUntil en el futuro)
    const lockedUser = await userRepo.create({
      email: `locked-leader-${timestamp}@bethesda.test`,
      passwordHash: 'dummy_hash',
      firstName: 'Bloqueado',
      lastName: 'Usuario',
      role: 'WORSHIP_LEADER',
      accountStatus: 'ACTIVE',
      emailVerified: true,
    });
    createdUserIds.push(lockedUser.id);
    await userRepo.update(lockedUser.id, {
      lockoutUntil: new Date(Date.now() + 3600000), // Bloqueado 1 hora
    });
    const lockedToken = tokenService.signAccessToken({
      sub: lockedUser.id,
      email: lockedUser.email,
      role: lockedUser.role,
    }).token;

    const lockedCreateRes = await app.inject({
      method: 'POST',
      url: '/api/v1/songs',
      headers: { authorization: `Bearer ${lockedToken}` },
      payload: {
        title: 'Canción Intento Bloqueado',
        defaultKey: 'D',
        sourceFormat: 'INTERNAL',
        canonicalPayload: canonicalJSON,
      },
    });
    assert.strictEqual(lockedCreateRes.statusCode, 403);
    assert.match(JSON.parse(lockedCreateRes.payload).error.message, /bloqueada por seguridad/);
  });

  it('11. should enforce real-time DB role validation when token role differs from database role', async () => {
    const timestamp = Date.now();
    // Crear usuario inicialmente WORSHIP_LEADER
    const demotedUser = await userRepo.create({
      email: `demoted-${timestamp}@bethesda.test`,
      passwordHash: 'dummy_hash',
      firstName: 'Degradado',
      lastName: 'Usuario',
      role: 'WORSHIP_LEADER',
      accountStatus: 'ACTIVE',
      emailVerified: true,
    });
    createdUserIds.push(demotedUser.id);

    // Se firma el token mientras era WORSHIP_LEADER
    const staledLeaderToken = tokenService.signAccessToken({
      sub: demotedUser.id,
      email: demotedUser.email,
      role: 'WORSHIP_LEADER',
    }).token;

    // Se degrada en la base de datos a VIEWER
    await userRepo.updateRole(demotedUser.id, 'VIEWER');

    const canonicalSong = createReferenceSongFixture();
    const canonicalJSON = CanonicalSerializer.serialize(canonicalSong);

    // Intentar crear canción con token antiguo que dice WORSHIP_LEADER
    const staleAttemptRes = await app.inject({
      method: 'POST',
      url: '/api/v1/songs',
      headers: { authorization: `Bearer ${staledLeaderToken}` },
      payload: {
        title: 'Canción Intento Degradado',
        defaultKey: 'A',
        sourceFormat: 'INTERNAL',
        canonicalPayload: canonicalJSON,
      },
    });

    // Debe ser rechazado porque verifyDatabaseRole verifica el rol real en PostgreSQL
    assert.strictEqual(staleAttemptRes.statusCode, 403);
    const staleBody = JSON.parse(staleAttemptRes.payload);
    assert.match(staleBody.error.message, /VIEWER/);

    // Verificar que la BD no fue modificada
    const checkDb = await pool.query('SELECT COUNT(*) FROM songs WHERE title = $1', [
      'Canción Intento Degradado',
    ]);
    assert.strictEqual(Number(checkDb.rows[0].count), 0);
  });
});
