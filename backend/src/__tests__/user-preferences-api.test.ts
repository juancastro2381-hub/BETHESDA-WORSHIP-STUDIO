/**
 * @file user-preferences-api.test.ts
 * @description Suite completa de pruebas de integración HTTP para los endpoints de Preferencias de Vista de Usuario (Fase 3A — WP-02).
 *
 * Cobertura de Verificación:
 * 1. Autenticación y encabezados Bearer obligatorios (HTTP 401).
 * 2. Valores por defecto de fábrica en memoria según rol canónico (DEC-02, DEC-03, DEC-04, DEC-05).
 * 3. Aislamiento estricto de identidad y protección anti-IDOR (request.user.sub).
 * 4. Persistencia y actualización atómica vía PUT /api/v1/users/me/preferences.
 * 5. Reconciliación del contrato nullable de clefOverride (fijar y resetear a null).
 * 6. Validación exhaustiva de esquemas Zod y compatibilidad instrumento-representación (HTTP 400).
 * 7. Protección de usuarios suspendidos o dados de baja en base de datos.
 */

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../app.ts';
import { pool } from '../db/index.ts';
import { runMigrations } from '../db/migrate.ts';
import { DrizzleUserRepository } from '../repositories/user-repository.ts';
import { DrizzleUserPreferencesRepository } from '../repositories/user-preferences-repository.ts';
import { JwtTokenService } from '../application/token-service.ts';
import { env } from '../config/env.ts';
import type { UserEntity } from '../domain/auth-types.ts';

describe('Phase 3A — WP-02: User Preferences REST API & Zod Validation Suite (/api/v1/users/me/preferences)', () => {
  let app: FastifyInstance;
  let tokenService: JwtTokenService;
  let userRepo: DrizzleUserRepository;
  let preferencesRepo: DrizzleUserPreferencesRepository;

  // Usuarios de prueba
  let musicianUserA: UserEntity;
  let musicianUserB: UserEntity;
  let leaderUser: UserEntity;
  let adminUser: UserEntity;
  let superAdminUser: UserEntity;
  let viewerUser: UserEntity;
  let suspendedUser: UserEntity;

  // Tokens JWT
  let tokenA: string;
  let tokenB: string;
  let leaderToken: string;
  let adminToken: string;
  let superAdminToken: string;
  let viewerToken: string;
  let suspendedToken: string;

  const createdUserIds = new Set<string>();

  before(async () => {
    await runMigrations();
    app = await buildApp();
    await app.ready();

    tokenService = new JwtTokenService(env.JWT_SECRET, env.JWT_ACCESS_EXPIRES_IN);
    userRepo = new DrizzleUserRepository();
    preferencesRepo = new DrizzleUserPreferencesRepository();

    const timestamp = Date.now();

    // 1. Musician A
    musicianUserA = await userRepo.create({
      email: `pref-musician-a-${timestamp}@bethesda.co`,
      passwordHash: 'dummy_hash',
      firstName: 'Musico',
      lastName: 'Alfa',
      role: 'MUSICIAN',
      accountStatus: 'ACTIVE',
    });
    createdUserIds.add(musicianUserA.id);
    tokenA = tokenService.signAccessToken({
      sub: musicianUserA.id,
      email: musicianUserA.email,
      role: musicianUserA.role,
    }).token;

    // 2. Musician B (para pruebas de IDOR / aislamiento)
    musicianUserB = await userRepo.create({
      email: `pref-musician-b-${timestamp}@bethesda.co`,
      passwordHash: 'dummy_hash',
      firstName: 'Musico',
      lastName: 'Beta',
      role: 'MUSICIAN',
      accountStatus: 'ACTIVE',
    });
    createdUserIds.add(musicianUserB.id);
    tokenB = tokenService.signAccessToken({
      sub: musicianUserB.id,
      email: musicianUserB.email,
      role: musicianUserB.role,
    }).token;

    // 3. Worship Leader
    leaderUser = await userRepo.create({
      email: `pref-leader-${timestamp}@bethesda.co`,
      passwordHash: 'dummy_hash',
      firstName: 'Lider',
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

    // 4. Admin
    adminUser = await userRepo.create({
      email: `pref-admin-${timestamp}@bethesda.co`,
      passwordHash: 'dummy_hash',
      firstName: 'Admin',
      lastName: 'Bethesda',
      role: 'ADMIN',
      accountStatus: 'ACTIVE',
    });
    createdUserIds.add(adminUser.id);
    adminToken = tokenService.signAccessToken({
      sub: adminUser.id,
      email: adminUser.email,
      role: adminUser.role,
    }).token;

    // 5. Super Admin
    superAdminUser = await userRepo.create({
      email: `pref-super-${timestamp}@bethesda.co`,
      passwordHash: 'dummy_hash',
      firstName: 'Super',
      lastName: 'Admin',
      role: 'SUPER_ADMIN',
      accountStatus: 'ACTIVE',
    });
    createdUserIds.add(superAdminUser.id);
    superAdminToken = tokenService.signAccessToken({
      sub: superAdminUser.id,
      email: superAdminUser.email,
      role: superAdminUser.role,
    }).token;

    // 6. Viewer
    viewerUser = await userRepo.create({
      email: `pref-viewer-${timestamp}@bethesda.co`,
      passwordHash: 'dummy_hash',
      firstName: 'Audiencia',
      lastName: 'Observador',
      role: 'VIEWER',
      accountStatus: 'ACTIVE',
    });
    createdUserIds.add(viewerUser.id);
    viewerToken = tokenService.signAccessToken({
      sub: viewerUser.id,
      email: viewerUser.email,
      role: viewerUser.role,
    }).token;

    // 7. Suspended User
    suspendedUser = await userRepo.create({
      email: `pref-suspended-${timestamp}@bethesda.co`,
      passwordHash: 'dummy_hash',
      firstName: 'Suspendido',
      lastName: 'Test',
      role: 'MUSICIAN',
      accountStatus: 'SUSPENDED',
    });
    createdUserIds.add(suspendedUser.id);
    suspendedToken = tokenService.signAccessToken({
      sub: suspendedUser.id,
      email: suspendedUser.email,
      role: suspendedUser.role,
    }).token;
  });

  after(async () => {
    // Limpieza de usuarios (la cascada en PostgreSQL limpia user_view_preferences automáticamente)
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
    it('1.1 should reject GET /api/v1/users/me/preferences without token with 401 UNAUTHORIZED', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/users/me/preferences',
      });

      assert.strictEqual(res.statusCode, 401);
      const json = JSON.parse(res.payload);
      assert.strictEqual(json.error.code, 'UNAUTHORIZED');
    });

    it('1.2 should reject PUT /api/v1/users/me/preferences without token with 401 UNAUTHORIZED', async () => {
      const res = await app.inject({
        method: 'PUT',
        url: '/api/v1/users/me/preferences',
        payload: {
          instrumentId: 'acoustic_guitar',
          primaryRepresentation: 'CHORDS',
        },
      });

      assert.strictEqual(res.statusCode, 401);
      const json = JSON.parse(res.payload);
      assert.strictEqual(json.error.code, 'UNAUTHORIZED');
    });

    it('1.3 should reject request with malformed Bearer header with 401 UNAUTHORIZED', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/users/me/preferences',
        headers: {
          authorization: 'TokenNotBearer xyz123',
        },
      });

      assert.strictEqual(res.statusCode, 401);
    });

    it('1.4 should reject request from SUSPENDED user with 401 UNAUTHORIZED', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/users/me/preferences',
        headers: {
          authorization: `Bearer ${suspendedToken}`,
        },
      });

      assert.strictEqual(res.statusCode, 401);
    });
  });

  // ==========================================================================
  // SUITE 2: VALORES DE FÁBRICA SEGÚN ROL (DEC-02, DEC-03, DEC-04, DEC-05)
  // ==========================================================================
  describe('2. Role-Based Factory Defaults (DEC-02, DEC-03, DEC-04, DEC-05)', () => {
    it('2.1 MUSICIAN should receive acoustic_guitar, CHORDS, [LYRICS] with isDefault: true (DEC-02)', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/users/me/preferences',
        headers: {
          authorization: `Bearer ${tokenA}`,
        },
      });

      assert.strictEqual(res.statusCode, 200);
      const json = JSON.parse(res.payload);
      assert.strictEqual(json.success, true);
      assert.strictEqual(json.data.userId, musicianUserA.id);
      assert.strictEqual(json.data.instrumentId, 'acoustic_guitar');
      assert.strictEqual(json.data.primaryRepresentation, 'CHORDS');
      assert.deepStrictEqual(json.data.secondaryRepresentations, ['LYRICS']);
      assert.strictEqual(json.data.chordNotationSystem, 'STANDARD');
      assert.strictEqual(json.data.transpositionSemitones, 0);
      assert.strictEqual(json.data.capoFret, 0);
      assert.strictEqual(json.data.clefOverride, null);
      assert.strictEqual(json.data.preferFlats, false);
      assert.strictEqual(json.data.isDefault, true);
    });

    it('2.2 WORSHIP_LEADER should receive acoustic_guitar, CHORDS, [LYRICS] with isDefault: true (DEC-04 Option A)', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/users/me/preferences',
        headers: {
          authorization: `Bearer ${leaderToken}`,
        },
      });

      assert.strictEqual(res.statusCode, 200);
      const json = JSON.parse(res.payload);
      assert.strictEqual(json.success, true);
      assert.strictEqual(json.data.userId, leaderUser.id);
      assert.strictEqual(json.data.instrumentId, 'acoustic_guitar');
      assert.strictEqual(json.data.primaryRepresentation, 'CHORDS');
      assert.deepStrictEqual(json.data.secondaryRepresentations, ['LYRICS']);
      assert.strictEqual(json.data.isDefault, true);
    });

    it('2.3 ADMIN should receive acoustic_guitar, CHORDS, [LYRICS] with isDefault: true (DEC-03 Option A)', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/users/me/preferences',
        headers: {
          authorization: `Bearer ${adminToken}`,
        },
      });

      assert.strictEqual(res.statusCode, 200);
      const json = JSON.parse(res.payload);
      assert.strictEqual(json.success, true);
      assert.strictEqual(json.data.userId, adminUser.id);
      assert.strictEqual(json.data.instrumentId, 'acoustic_guitar');
      assert.strictEqual(json.data.primaryRepresentation, 'CHORDS');
      assert.deepStrictEqual(json.data.secondaryRepresentations, ['LYRICS']);
      assert.strictEqual(json.data.isDefault, true);
    });

    it('2.4 SUPER_ADMIN should receive acoustic_guitar, CHORDS, [LYRICS] with isDefault: true (DEC-03 Option A)', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/users/me/preferences',
        headers: {
          authorization: `Bearer ${superAdminToken}`,
        },
      });

      assert.strictEqual(res.statusCode, 200);
      const json = JSON.parse(res.payload);
      assert.strictEqual(json.success, true);
      assert.strictEqual(json.data.userId, superAdminUser.id);
      assert.strictEqual(json.data.instrumentId, 'acoustic_guitar');
      assert.strictEqual(json.data.primaryRepresentation, 'CHORDS');
      assert.deepStrictEqual(json.data.secondaryRepresentations, ['LYRICS']);
      assert.strictEqual(json.data.isDefault, true);
    });

    it('2.5 VIEWER should receive lead_vocal, LYRICS, [CHORDS] with isDefault: true (DEC-05 Option A)', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/users/me/preferences',
        headers: {
          authorization: `Bearer ${viewerToken}`,
        },
      });

      assert.strictEqual(res.statusCode, 200);
      const json = JSON.parse(res.payload);
      assert.strictEqual(json.success, true);
      assert.strictEqual(json.data.userId, viewerUser.id);
      assert.strictEqual(json.data.instrumentId, 'lead_vocal');
      assert.strictEqual(json.data.primaryRepresentation, 'LYRICS');
      assert.deepStrictEqual(json.data.secondaryRepresentations, ['CHORDS']);
      assert.strictEqual(json.data.isDefault, true);
    });
  });

  // ==========================================================================
  // SUITE 3: MUTACIÓN ATÓMICA VÍA PUT Y PERSISTENCIA REAL (POSTGRESQL)
  // ==========================================================================
  describe('3. Mutation & Atomic Persistence via PUT /api/v1/users/me/preferences', () => {
    it('3.1 should save preferences for Musician A and return isDefault: false', async () => {
      const putRes = await app.inject({
        method: 'PUT',
        url: '/api/v1/users/me/preferences',
        headers: {
          authorization: `Bearer ${tokenA}`,
        },
        payload: {
          instrumentId: 'alto_sax',
          primaryRepresentation: 'STANDARD_NOTATION',
          secondaryRepresentations: ['CHORDS'],
          chordNotationSystem: 'LATIN',
          transpositionSemitones: 2,
          capoFret: 0,
          clefOverride: 'TREBLE',
          preferFlats: true,
        },
      });

      assert.strictEqual(putRes.statusCode, 200);
      const putJson = JSON.parse(putRes.payload);
      assert.strictEqual(putJson.success, true);
      assert.strictEqual(putJson.data.userId, musicianUserA.id);
      assert.strictEqual(putJson.data.instrumentId, 'alto_sax');
      assert.strictEqual(putJson.data.primaryRepresentation, 'STANDARD_NOTATION');
      assert.deepStrictEqual(putJson.data.secondaryRepresentations, ['CHORDS']);
      assert.strictEqual(putJson.data.chordNotationSystem, 'LATIN');
      assert.strictEqual(putJson.data.transpositionSemitones, 2);
      assert.strictEqual(putJson.data.capoFret, 0);
      assert.strictEqual(putJson.data.clefOverride, 'TREBLE');
      assert.strictEqual(putJson.data.preferFlats, true);
      assert.strictEqual(putJson.data.isDefault, false);
      assert.ok(putJson.data.id);
      assert.ok(putJson.data.createdAt);
      assert.ok(putJson.data.updatedAt);

      // Verificar que GET subsecuente recupera exactamente los datos guardados
      const getRes = await app.inject({
        method: 'GET',
        url: '/api/v1/users/me/preferences',
        headers: {
          authorization: `Bearer ${tokenA}`,
        },
      });

      assert.strictEqual(getRes.statusCode, 200);
      const getJson = JSON.parse(getRes.payload);
      assert.strictEqual(getJson.data.instrumentId, 'alto_sax');
      assert.strictEqual(getJson.data.clefOverride, 'TREBLE');
      assert.strictEqual(getJson.data.isDefault, false);
    });

    it('3.2 should allow resetting clefOverride to null explicitly', async () => {
      const resetRes = await app.inject({
        method: 'PUT',
        url: '/api/v1/users/me/preferences',
        headers: {
          authorization: `Bearer ${tokenA}`,
        },
        payload: {
          instrumentId: 'alto_sax',
          primaryRepresentation: 'STANDARD_NOTATION',
          secondaryRepresentations: [],
          clefOverride: null,
        },
      });

      assert.strictEqual(resetRes.statusCode, 200);
      const resetJson = JSON.parse(resetRes.payload);
      assert.strictEqual(resetJson.data.clefOverride, null);

      // Verificar persistencia de null en la base de datos
      const verified = await preferencesRepo.findByUserId(musicianUserA.id);
      assert.ok(verified);
      assert.strictEqual(verified.clefOverride, null);
    });
  });

  // ==========================================================================
  // SUITE 4: PROTECCIÓN ANTI-IDOR Y AISLAMIENTO ENTRE USUARIOS
  // ==========================================================================
  describe('4. Anti-IDOR and Cross-User Isolation Enforcement', () => {
    it('4.1 User B must retain factory defaults after User A saves custom preferences', async () => {
      const getBRes = await app.inject({
        method: 'GET',
        url: '/api/v1/users/me/preferences',
        headers: {
          authorization: `Bearer ${tokenB}`,
        },
      });

      assert.strictEqual(getBRes.statusCode, 200);
      const jsonB = JSON.parse(getBRes.payload);
      // User B aún no ha guardado preferencias: recibe default de MUSICIAN
      assert.strictEqual(jsonB.data.userId, musicianUserB.id);
      assert.strictEqual(jsonB.data.instrumentId, 'acoustic_guitar');
      assert.strictEqual(jsonB.data.isDefault, true);
    });

    it('4.2 User A cannot overwrite User B preferences even by injecting userId in payload or params', async () => {
      // User B guarda su propio instrumento
      await app.inject({
        method: 'PUT',
        url: '/api/v1/users/me/preferences',
        headers: {
          authorization: `Bearer ${tokenB}`,
        },
        payload: {
          instrumentId: 'electric_guitar',
          primaryRepresentation: 'TABLATURE',
          secondaryRepresentations: ['CHORDS'],
        },
      });

      // User A intenta inyectar el userId de User B en el payload
      const maliciousRes = await app.inject({
        method: 'PUT',
        url: '/api/v1/users/me/preferences',
        headers: {
          authorization: `Bearer ${tokenA}`,
        },
        payload: {
          userId: musicianUserB.id, // Intento de spoofing
          instrumentId: 'keyboard',
          primaryRepresentation: 'GRAND_STAFF',
        },
      });

      assert.strictEqual(maliciousRes.statusCode, 200);
      const maliciousJson = JSON.parse(maliciousRes.payload);
      // El servidor ignora el campo userId del cliente y asigna estrictamente el sub del token de A
      assert.strictEqual(maliciousJson.data.userId, musicianUserA.id);
      assert.strictEqual(maliciousJson.data.instrumentId, 'keyboard');

      // Las preferencias de User B DEBEN permanecer intactas (electric_guitar)
      const verifyB = await preferencesRepo.findByUserId(musicianUserB.id);
      assert.ok(verifyB);
      assert.strictEqual(verifyB.userId, musicianUserB.id);
      assert.strictEqual(verifyB.instrumentId, 'electric_guitar');
      assert.strictEqual(verifyB.primaryRepresentation, 'TABLATURE');
    });
  });

  // ==========================================================================
  // SUITE 5: VALIDACIÓN DE ESQUEMAS ZOD Y COMPATIBILIDAD INSTRUMENTO-VISTA (HTTP 400)
  // ==========================================================================
  describe('5. Zod Validation & Instrument-View Compatibility (HTTP 400)', () => {
    it('5.1 should reject missing instrumentId with 400 VALIDATION_ERROR', async () => {
      const res = await app.inject({
        method: 'PUT',
        url: '/api/v1/users/me/preferences',
        headers: {
          authorization: `Bearer ${tokenA}`,
        },
        payload: {
          primaryRepresentation: 'CHORDS',
        },
      });

      assert.strictEqual(res.statusCode, 400);
      const json = JSON.parse(res.payload);
      assert.strictEqual(json.error.code, 'VALIDATION_ERROR');
    });

    it('5.2 should reject empty string instrumentId with 400 VALIDATION_ERROR', async () => {
      const res = await app.inject({
        method: 'PUT',
        url: '/api/v1/users/me/preferences',
        headers: {
          authorization: `Bearer ${tokenA}`,
        },
        payload: {
          instrumentId: '   ',
          primaryRepresentation: 'CHORDS',
        },
      });

      assert.strictEqual(res.statusCode, 400);
      const json = JSON.parse(res.payload);
      assert.strictEqual(json.error.code, 'VALIDATION_ERROR');
    });

    it('5.3 should reject unregistered instrumentId with 400 VALIDATION_ERROR', async () => {
      const res = await app.inject({
        method: 'PUT',
        url: '/api/v1/users/me/preferences',
        headers: {
          authorization: `Bearer ${tokenA}`,
        },
        payload: {
          instrumentId: 'instrumento_inexistente_123',
          primaryRepresentation: 'CHORDS',
        },
      });

      assert.strictEqual(res.statusCode, 400);
      const json = JSON.parse(res.payload);
      assert.strictEqual(json.error.code, 'VALIDATION_ERROR');
    });

    it('5.4 should reject incompatible primary representation (drums + TABLATURE) with 400', async () => {
      const res = await app.inject({
        method: 'PUT',
        url: '/api/v1/users/me/preferences',
        headers: {
          authorization: `Bearer ${tokenA}`,
        },
        payload: {
          instrumentId: 'drums',
          primaryRepresentation: 'TABLATURE',
        },
      });

      assert.strictEqual(res.statusCode, 400);
      const json = JSON.parse(res.payload);
      assert.strictEqual(json.error.code, 'VALIDATION_ERROR');
      assert.ok(
        json.error.details.some((d: any) =>
          d.message.includes('no es compatible con el instrumento seleccionado')
        )
      );
    });

    it('5.5 should reject incompatible primary representation (lead_vocal + GRAND_STAFF) with 400', async () => {
      const res = await app.inject({
        method: 'PUT',
        url: '/api/v1/users/me/preferences',
        headers: {
          authorization: `Bearer ${tokenA}`,
        },
        payload: {
          instrumentId: 'lead_vocal',
          primaryRepresentation: 'GRAND_STAFF',
        },
      });

      assert.strictEqual(res.statusCode, 400);
    });

    it('5.6 should reject incompatible secondary representation (alto_sax + [TABLATURE]) with 400', async () => {
      const res = await app.inject({
        method: 'PUT',
        url: '/api/v1/users/me/preferences',
        headers: {
          authorization: `Bearer ${tokenA}`,
        },
        payload: {
          instrumentId: 'alto_sax',
          primaryRepresentation: 'STANDARD_NOTATION',
          secondaryRepresentations: ['TABLATURE'], // Incompatible con saxofón
        },
      });

      assert.strictEqual(res.statusCode, 400);
      const json = JSON.parse(res.payload);
      assert.strictEqual(json.error.code, 'VALIDATION_ERROR');
      assert.ok(
        json.error.details.some((d: any) =>
          d.message.includes('representaciones secundarias no son compatibles')
        )
      );
    });

    it('5.7 should reject transpositionSemitones out of range (< -12 o > 12) with 400', async () => {
      const res = await app.inject({
        method: 'PUT',
        url: '/api/v1/users/me/preferences',
        headers: {
          authorization: `Bearer ${tokenA}`,
        },
        payload: {
          instrumentId: 'acoustic_guitar',
          primaryRepresentation: 'CHORDS',
          transpositionSemitones: 13,
        },
      });

      assert.strictEqual(res.statusCode, 400);
    });

    it('5.8 should reject capoFret out of range (< 0 o > 12) with 400', async () => {
      const res = await app.inject({
        method: 'PUT',
        url: '/api/v1/users/me/preferences',
        headers: {
          authorization: `Bearer ${tokenA}`,
        },
        payload: {
          instrumentId: 'acoustic_guitar',
          primaryRepresentation: 'CHORDS',
          capoFret: -1,
        },
      });

      assert.strictEqual(res.statusCode, 400);
    });

    it('5.9 should reject unrecognized clefOverride string with 400', async () => {
      const res = await app.inject({
        method: 'PUT',
        url: '/api/v1/users/me/preferences',
        headers: {
          authorization: `Bearer ${tokenA}`,
        },
        payload: {
          instrumentId: 'acoustic_guitar',
          primaryRepresentation: 'CHORDS',
          clefOverride: 'INVALID_CLEF_TYPE',
        },
      });

      assert.strictEqual(res.statusCode, 400);
    });
  });
});
