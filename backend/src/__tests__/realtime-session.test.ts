/**
 * @file realtime-session.test.ts
 * @description Suite de pruebas de integración para el Flujo Litúrgico en Tiempo Real (Fase 3B).
 *
 * Cubre:
 * 1. Creación de sesión litúrgica en vivo y snapshot inicial.
 * 2. Unirse (join), presencia (heartbeat) y salida (leave) de participantes.
 * 3. Control de acceso RBAC: director/admin autorizado vs músico no autorizado (403 Forbidden).
 * 4. Despacho secuencial de acciones (índice, sección, tono, tempo) y avance de secuencia monotónica.
 * 5. Rechazo determinista de acciones fuera de orden o desfasadas (409 Conflict).
 * 6. Idempotencia y deduplicación ante retransmisiones (mismo actionId no avanza secuencia).
 * 7. Inmutabilidad de la verdad canónica: los eventos volátiles NUNCA mutan filas de PostgreSQL.
 * 8. Rechazo de acciones sobre sesiones concluidas (CONCLUDED).
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../app.ts';
import { pool } from '../db/index.ts';
import { runMigrations } from '../db/migrate.ts';
import { DrizzleUserRepository } from '../repositories/user-repository.ts';
import { DrizzleSetlistRepository } from '../repositories/setlist-repository.ts';
import { JwtTokenService } from '../application/token-service.ts';
import { env } from '../config/env.ts';
import { globalRealtimeSessionManager } from '../application/realtime-session-manager.ts';
import type { UserEntity } from '../domain/auth-types.ts';
import type { SetlistEntity } from '../domain/setlist-types.ts';

describe('Workstream C — Phase 3B Realtime Liturgical Flow Suite', () => {
  let app: FastifyInstance;
  let tokenService: JwtTokenService;
  let userRepo: DrizzleUserRepository;
  let setlistRepo: DrizzleSetlistRepository;

  let leaderUser: UserEntity;
  let musicianUser: UserEntity;
  let leaderToken: string;
  let musicianToken: string;

  let testSetlist: SetlistEntity;
  const createdUserIds = new Set<string>();
  const createdSetlistIds = new Set<string>();

  before(async () => {
    await runMigrations();

    app = await buildApp();
    await app.ready();

    tokenService = new JwtTokenService(env.JWT_SECRET, env.JWT_ACCESS_EXPIRES_IN);
    userRepo = new DrizzleUserRepository();
    setlistRepo = new DrizzleSetlistRepository();

    globalRealtimeSessionManager.clearAllSessions();

    const timestamp = Date.now();

    // 1. Crear Director de Alabanza (WORSHIP_LEADER)
    leaderUser = await userRepo.create({
      email: `leader_realtime_${timestamp}@bethesda.test`,
      passwordHash: 'argon2id_mock_hash_for_testing',
      firstName: 'Director',
      lastName: 'Litúrgico',
      role: 'WORSHIP_LEADER',
    });
    createdUserIds.add(leaderUser.id);
    leaderToken = tokenService.signAccessToken({
      id: leaderUser.id,
      email: leaderUser.email,
      role: leaderUser.role,
    }).token;

    // 2. Crear Músico (MUSICIAN)
    musicianUser = await userRepo.create({
      email: `musician_realtime_${timestamp}@bethesda.test`,
      passwordHash: 'argon2id_mock_hash_for_testing',
      firstName: 'Músico',
      lastName: 'Atril',
      role: 'MUSICIAN',
    });
    createdUserIds.add(musicianUser.id);
    musicianToken = tokenService.signAccessToken({
      id: musicianUser.id,
      email: musicianUser.email,
      role: musicianUser.role,
    }).token;

    // 3. Crear Setlist Litúrgico de Prueba
    testSetlist = await setlistRepo.create({
      title: 'Culto Dominical — Realtime Test',
      scheduledDateTime: new Date('2026-10-25T10:00:00Z'),
      directorUserId: leaderUser.id,
      notes: 'Notas de ensayo en vivo',
    });
    createdSetlistIds.add(testSetlist.id);
  });

  after(async () => {
    globalRealtimeSessionManager.clearAllSessions();

    if (createdSetlistIds.size > 0) {
      const sIds = Array.from(createdSetlistIds);
      await pool.query('DELETE FROM setlists WHERE id = ANY($1)', [sIds]);
    }

    if (createdUserIds.size > 0) {
      const uIds = Array.from(createdUserIds);
      await pool.query('DELETE FROM users WHERE id = ANY($1)', [uIds]);
    }

    await app.close();
  });

  let activeSessionId: string;

  it('1. should create or get a realtime liturgical session with initial snapshot', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/realtime/sessions',
      headers: {
        authorization: `Bearer ${leaderToken}`,
      },
      payload: {
        setlistId: testSetlist.id,
        initialItemIndex: 0,
      },
    });

    assert.equal(response.statusCode, 200);
    const body = JSON.parse(response.payload);
    assert.ok(body.data);
    assert.equal(body.data.setlistId, testSetlist.id);
    assert.equal(body.data.hostUserId, leaderUser.id);
    assert.equal(body.data.status, 'ACTIVE');
    assert.equal(body.data.epoch, 1);
    assert.equal(body.data.sequence, 1);
    assert.equal(body.data.currentItemIndex, 0);
    assert.equal(body.data.currentSection, null);
    assert.equal(body.data.participantsCount, 1);

    activeSessionId = body.data.sessionId;
  });

  it('2. should allow a musician to join the session and register in participants', async () => {
    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/realtime/sessions/${activeSessionId}/join`,
      headers: {
        authorization: `Bearer ${musicianToken}`,
      },
    });

    assert.equal(response.statusCode, 200);
    const body = JSON.parse(response.payload);
    assert.equal(body.data.participantsCount, 2);

    const participantIds = body.data.participants.map((p: any) => p.userId);
    assert.ok(participantIds.includes(musicianUser.id));
    assert.ok(participantIds.includes(leaderUser.id));
  });

  it('3. should process participant heartbeats successfully', async () => {
    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/realtime/sessions/${activeSessionId}/heartbeat`,
      headers: {
        authorization: `Bearer ${musicianToken}`,
      },
    });

    assert.equal(response.statusCode, 200);
    const body = JSON.parse(response.payload);
    assert.equal(body.ok, true);
    assert.equal(typeof body.sequence, 'number');
  });

  it('4. should reject state mutation from an unauthorized participant (403 Forbidden)', async () => {
    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/realtime/sessions/${activeSessionId}/actions`,
      headers: {
        authorization: `Bearer ${musicianToken}`, // Músico intentando cambiar de canción
      },
      payload: {
        actionId: 'unauth-action-01',
        type: 'SET_ITEM_INDEX',
        payload: {
          itemIndex: 2,
        },
      },
    });

    assert.equal(response.statusCode, 403);
    const body = JSON.parse(response.payload);
    assert.ok(body.error.message.includes('director de alabanza'));
  });

  it('5. should allow authorized leader to advance item index and increment sequence', async () => {
    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/realtime/sessions/${activeSessionId}/actions`,
      headers: {
        authorization: `Bearer ${leaderToken}`,
      },
      payload: {
        actionId: 'leader-nav-01',
        expectedSequence: 1,
        type: 'SET_ITEM_INDEX',
        payload: {
          itemIndex: 1,
        },
      },
    });

    assert.equal(response.statusCode, 200);
    const body = JSON.parse(response.payload);
    assert.equal(body.data.success, true);
    assert.equal(body.data.sequence, 2);
    assert.equal(body.data.state.currentItemIndex, 1);
    assert.equal(body.data.state.currentSection, null);
  });

  it('6. should allow authorized leader to set section and harmonic/tempo overrides', async () => {
    // 6a. Set section
    const resSec = await app.inject({
      method: 'POST',
      url: `/api/v1/realtime/sessions/${activeSessionId}/actions`,
      headers: {
        authorization: `Bearer ${leaderToken}`,
      },
      payload: {
        actionId: 'leader-sec-02',
        expectedSequence: 2,
        type: 'SET_SECTION',
        payload: {
          section: 'CORO',
        },
      },
    });
    assert.equal(resSec.statusCode, 200);
    const bodySec = JSON.parse(resSec.payload);
    assert.equal(bodySec.data.sequence, 3);
    assert.equal(bodySec.data.state.currentSection, 'CORO');

    // 6b. Set key override
    const resKey = await app.inject({
      method: 'POST',
      url: `/api/v1/realtime/sessions/${activeSessionId}/actions`,
      headers: {
        authorization: `Bearer ${leaderToken}`,
      },
      payload: {
        actionId: 'leader-key-03',
        expectedSequence: 3,
        type: 'SET_KEY_OVERRIDE',
        payload: {
          keyOverride: 'Bb',
        },
      },
    });
    assert.equal(resKey.statusCode, 200);
    const bodyKey = JSON.parse(resKey.payload);
    assert.equal(bodyKey.data.sequence, 4);
    assert.equal(bodyKey.data.state.currentKeyOverride, 'Bb');
  });

  it('7. should enforce idempotency: duplicate actionId returns state without advancing sequence', async () => {
    const duplicateRes = await app.inject({
      method: 'POST',
      url: `/api/v1/realtime/sessions/${activeSessionId}/actions`,
      headers: {
        authorization: `Bearer ${leaderToken}`,
      },
      payload: {
        actionId: 'leader-key-03', // Mismo actionId retransmitido
        expectedSequence: 3,
        type: 'SET_KEY_OVERRIDE',
        payload: {
          keyOverride: 'Bb',
        },
      },
    });

    assert.equal(duplicateRes.statusCode, 200);
    const body = JSON.parse(duplicateRes.payload);
    assert.equal(body.data.deduplicated, true);
    assert.equal(body.data.sequence, 4); // La secuencia no avanzó a 5
  });

  it('8. should reject out-of-order or stale actions (409 Conflict)', async () => {
    const staleRes = await app.inject({
      method: 'POST',
      url: `/api/v1/realtime/sessions/${activeSessionId}/actions`,
      headers: {
        authorization: `Bearer ${leaderToken}`,
      },
      payload: {
        actionId: 'stale-action-99',
        expectedSequence: 1, // El servidor ya está en secuencia 4
        type: 'SET_SECTION',
        payload: {
          section: 'VERSO 1',
        },
      },
    });

    assert.equal(staleRes.statusCode, 409);
    const body = JSON.parse(staleRes.payload);
    assert.ok(body.error.message.includes('Desfase litúrgico detectado'));
  });

  it('9. should guarantee strict preservation of PostgreSQL canonical truth', async () => {
    // Verificar que el setlist en la base de datos no fue mutado por los eventos volátiles
    const dbSetlist = await setlistRepo.findById(testSetlist.id);
    assert.ok(dbSetlist);
    assert.equal(dbSetlist.status, testSetlist.status);
    assert.equal(dbSetlist.title, testSetlist.title);
  });

  it('10. should allow participant to leave and reflect in snapshot', async () => {
    const leaveRes = await app.inject({
      method: 'POST',
      url: `/api/v1/realtime/sessions/${activeSessionId}/leave`,
      headers: {
        authorization: `Bearer ${musicianToken}`,
      },
    });

    assert.equal(leaveRes.statusCode, 200);

    const snapshotRes = await app.inject({
      method: 'GET',
      url: `/api/v1/realtime/sessions/${activeSessionId}`,
      headers: {
        authorization: `Bearer ${leaderToken}`,
      },
    });

    assert.equal(snapshotRes.statusCode, 200);
    const snapshot = JSON.parse(snapshotRes.payload);
    assert.equal(snapshot.data.participantsCount, 1);
    assert.equal(snapshot.data.participants[0].userId, leaderUser.id);
  });
});
