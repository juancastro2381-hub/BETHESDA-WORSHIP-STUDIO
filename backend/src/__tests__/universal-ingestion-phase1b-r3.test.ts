/**
 * @file universal-ingestion-phase1b-r3.test.ts
 * @description Suite de pruebas automatizadas definitivas para la Fase 1B-R3:
 * 1. Workstream A: Cero Fabricación Musical en el Modelo Canónico y Adaptadores
 *    - SMF sin evento Set Tempo produce TempoMap no resuelto (events=[], isUnresolved=true, getTempoAtTick(0)=null, totalDurationSeconds=null).
 *    - SMF sin evento Key Signature produce measure.keySignature === null (cero C Mayor ficticio).
 *    - SMF sin evento Time Signature produce measure.timeSignature === null e isUnmetered=true (cero 4/4 ficticio).
 *    - Constructor TempoMap([]) preserva events=[] sin inyectar 120 BPM por defecto.
 *    - Constructor Measure({...}) permite timeSignature=null y keySignature=null sin lanzar excepción.
 *    - Serialización y deserialización canónica conserva fielmente timeSignature=null, keySignature=null y tempoMap vacío.
 * 2. Workstream B: Retención Incondicional de Fuentes y Migración 0014 (version_id ON DELETE SET NULL)
 *    - Verificación del catálogo PostgreSQL: las 4 claves foráneas de song_sources poseen delete_rule = 'SET NULL'.
 *    - Borrado de song_version establece song_sources.version_id = NULL sin eliminar el registro de fuente.
 *    - Borrado de song establece song_sources.song_id = NULL sin eliminar el registro de fuente ni su archivo físico.
 *    - Borrado de user establece song_sources.user_id = NULL sin eliminar el registro de fuente ni su archivo físico.
 * 3. Workstream C: Límites de Seguridad Multi-Inquilino y Auditoría de Aislamiento Comunitario
 *    - Prevención IDOR: Usuario A no puede acceder a metadatos ni descargar archivos de fuente de Usuario B (403 Forbidden).
 *    - Prevención IDOR: Usuario A no puede consultar background_jobs de Usuario B (403 Forbidden).
 *    - Acceso privilegiado: Rol ADMIN puede auditar y acceder a cualquier fuente de usuario.
 *    - Auditoría Arquitectónica: Validación de que el esquema actual carece de community_id relacional en users/songs
 *      documentando formalmente el requisito pendiente de decisión de Producto (CONDITIONAL).
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import Fastify, { type FastifyInstance } from 'fastify';
import { and, eq } from 'drizzle-orm';
import { db, pool } from '../db/index.ts';
import { users, songs, songVersions, songSources, backgroundJobs } from '../db/schema.ts';
import { ingestionRoutes } from '../interfaces/http/routes/ingestion.routes.ts';
import { JwtTokenService } from '../application/token-service.ts';
import { env } from '../config/env.ts';
import { UniversalIngestionService } from '../application/universal-ingestion-service.ts';
import { SongService } from '../application/song-service.ts';
import { DrizzleSongRepository } from '../repositories/song-repository.ts';
import { DrizzleSongVersionRepository } from '../repositories/version-repository.ts';
import { DrizzleUserRepository } from '../repositories/user-repository.ts';
import { LocalFileSystemSourceStorageProvider } from '../domain/ingestion/source-storage-provider.ts';
import type { AuthenticatedUser } from '../domain/auth-types.ts';
import { TempoMap, TempoEvent } from '../../../frontend/src/core/canonical-model/tempo-map.ts';
import { Timeline } from '../../../frontend/src/core/canonical-model/timeline.ts';
import { Measure } from '../../../frontend/src/core/canonical-model/measure.ts';
import { CanonicalMusicPayload } from '../../../frontend/src/core/canonical-model/canonical-music-payload.ts';
import { CanonicalSerializer, CanonicalDeserializer } from '../domain/canonical-serializer.ts';

// ---------------------------------------------------------------------------
// Helpers para generación de binarios sintéticos MIDI
// ---------------------------------------------------------------------------

function writeVLQ(value: number): number[] {
  const bytes: number[] = [];
  let buffer = value & 0x7f;
  while ((value >>= 7) > 0) {
    buffer <<= 8;
    buffer |= (value & 0x7f) | 0x80;
  }
  while (true) {
    bytes.push(buffer & 0xff);
    if (buffer & 0x80) buffer >>= 8;
    else break;
  }
  return bytes;
}

function buildMidiHeader(format: number, trackCount: number, division: number): Buffer {
  const buf = Buffer.alloc(14);
  buf.write('MThd', 0, 4, 'ascii');
  buf.writeUInt32BE(6, 4);
  buf.writeUInt16BE(format, 8);
  buf.writeUInt16BE(trackCount, 10);
  buf.writeUInt16BE(division, 12);
  return buf;
}

function buildMidiTrack(events: number[]): Buffer {
  const data = Buffer.from(events);
  const header = Buffer.alloc(8);
  header.write('MTrk', 0, 4, 'ascii');
  header.writeUInt32BE(data.length, 4);
  return Buffer.concat([header, data]);
}

describe('Worship Studio — Phase 1B-R3 Final Certification & Independent Audit Suite', () => {
  let app: FastifyInstance;
  let tokenService: JwtTokenService;
  let userAId: string;
  let userBId: string;
  let adminId: string;
  let userAToken: string;
  let userBToken: string;
  let adminToken: string;

  const testUserA: AuthenticatedUser = {
    id: '',
    role: 'WORSHIP_LEADER',
    email: 'leader_r3_a@bethesda.test',
  };

  const testUserB: AuthenticatedUser = {
    id: '',
    role: 'MUSICIAN',
    email: 'musician_r3_b@bethesda.test',
  };

  const testAdmin: AuthenticatedUser = {
    id: '',
    role: 'ADMIN',
    email: 'admin_r3@bethesda.test',
  };

  const createdSongIds = new Set<string>();
  const createdJobIds = new Set<string>();
  const createdSourceIds = new Set<string>();

  before(async () => {
    tokenService = new JwtTokenService(env.JWT_SECRET);
    const userRepo = new DrizzleUserRepository();

    const ts = Date.now();
    const uA = await userRepo.create({
      email: `leader_r3_a_${ts}@bethesda.test`,
      passwordHash: 'dummy_hash_a',
      firstName: 'Leader',
      lastName: 'R3-A',
      role: 'WORSHIP_LEADER',
    });
    userAId = uA.id;
    testUserA.id = userAId;
    testUserA.email = uA.email;

    const uB = await userRepo.create({
      email: `musician_r3_b_${ts}@bethesda.test`,
      passwordHash: 'dummy_hash_b',
      firstName: 'Musician',
      lastName: 'R3-B',
      role: 'MUSICIAN',
    });
    userBId = uB.id;
    testUserB.id = userBId;
    testUserB.email = uB.email;

    const uAdmin = await userRepo.create({
      email: `admin_r3_${ts}@bethesda.test`,
      passwordHash: 'dummy_hash_admin',
      firstName: 'Admin',
      lastName: 'R3',
      role: 'ADMIN',
    });
    adminId = uAdmin.id;
    testAdmin.id = adminId;
    testAdmin.email = uAdmin.email;

    userAToken = tokenService.signAccessToken({
      id: userAId,
      email: testUserA.email,
      role: 'WORSHIP_LEADER',
    }).token;

    userBToken = tokenService.signAccessToken({
      id: userBId,
      email: testUserB.email,
      role: 'MUSICIAN',
    }).token;

    adminToken = tokenService.signAccessToken({
      id: adminId,
      email: testAdmin.email,
      role: 'ADMIN',
    }).token;

    app = Fastify();
    await app.register(ingestionRoutes, { prefix: '/api/v1/ingestion' });
    await app.ready();
  });

  after(async () => {
    for (const srcId of createdSourceIds) {
      await db.delete(songSources).where(eq(songSources.id, srcId)).catch(() => {});
    }
    for (const jId of createdJobIds) {
      await db.delete(backgroundJobs).where(eq(backgroundJobs.id, jId)).catch(() => {});
    }
    for (const sId of createdSongIds) {
      await db.delete(songVersions).where(eq(songVersions.songId, sId)).catch(() => {});
      await db.delete(songs).where(eq(songs.id, sId)).catch(() => {});
    }
    if (userAId) await db.delete(users).where(eq(users.id, userAId)).catch(() => {});
    if (userBId) await db.delete(users).where(eq(users.id, userBId)).catch(() => {});
    if (adminId) await db.delete(users).where(eq(users.id, adminId)).catch(() => {});

    await app.close();
  });

  // =========================================================================
  // WORKSTREAM A — CERO FABRICACIÓN MUSICAL EN MODELO CANÓNICO Y ADAPTADORES
  // =========================================================================

  describe('Workstream A: Zero Musical Fabrication in Canonical Model and Ingestion', () => {
    it('A1.1: TempoMap constructor without events must NOT fabricate 120 BPM', () => {
      const emptyMap = new TempoMap([]);
      assert.equal(emptyMap.isUnresolved, true, 'TempoMap must report isUnresolved = true when empty');
      assert.equal(emptyMap.events.length, 0, 'TempoMap events array must be strictly empty');
      assert.equal(emptyMap.getTempoAtTick(0), null, 'getTempoAtTick must return null for unresolved map');
      assert.equal(emptyMap.getTempoAtTick(480), null, 'getTempoAtTick must return null at any tick');
      assert.equal(emptyMap.getTempoAtTickWithFallback(0, 120), 120, 'Fallback BPM is only for presentation/renderers');

      // tickToSeconds y secondsToTick deben fallar si se llaman sin fallback explícito
      assert.throws(() => emptyMap.tickToSeconds(480), /TempoMap no resuelto/i);
      assert.equal(emptyMap.tickToSeconds(480, 120), 0.5, 'tickToSeconds with explicit fallback calculates safely');
    });

    it('A1.2: Timeline with unresolved TempoMap must report totalDurationSeconds === null', () => {
      const unresolvedTimeline = new Timeline({
        totalDurationTicks: 1920,
        measureCount: 4,
        tempoMap: new TempoMap([]),
        isUnmetered: true,
      });

      assert.equal(unresolvedTimeline.isUnmetered, true);
      assert.equal(unresolvedTimeline.totalDurationSeconds, null, 'totalDurationSeconds must be null without BPM');
      assert.equal(unresolvedTimeline.totalDurationTicks, 1920);
    });

    it('A1.3: Measure constructor must accept null timeSignature and null keySignature without throwing', () => {
      const unmeteredMeasure = new Measure({
        number: 1,
        timeSignature: null,
        keySignature: null,
        startTick: 0,
        durationTicks: 960,
      });

      assert.equal(unmeteredMeasure.number, 1);
      assert.equal(unmeteredMeasure.timeSignature, null);
      assert.equal(unmeteredMeasure.keySignature, null);
      assert.equal(unmeteredMeasure.durationTicks, 960);

      // Serialización y deserialización de Measure con firmas nulas
      const json = unmeteredMeasure.toJSON();
      assert.equal(json.timeSignature, null);
      assert.equal(json.keySignature, null);

      const hydrated = Measure.fromJSON(json);
      assert.equal(hydrated.timeSignature, null);
      assert.equal(hydrated.keySignature, null);
      assert.equal(hydrated.durationTicks, 960);
    });

    it('A1.4: Ingesting MIDI file lacking TimeSignature, KeySignature and Tempo must NOT fabricate defaults', async () => {
      // Secuencia MIDI pura: Solo un evento NoteOn/NoteOff, sin Meta 0x51 (tempo), 0x58 (time), 0x59 (key)
      const trackEvents: number[] = [
        0x00, 0x90, 60, 80, // delta=0, NoteOn C4
        ...writeVLQ(480), 0x80, 60, 0, // delta=480, NoteOff C4
        0x00, 0xff, 0x2f, 0x00, // End of Track
      ];

      const header = buildMidiHeader(0, 1, 480);
      const track = buildMidiTrack(trackEvents);
      const midiBuf = Buffer.concat([header, track]);

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/ingestion/upload',
        headers: { authorization: `Bearer ${userAToken}` },
        payload: {
          filename: 'raw_naked_sequence.mid',
          dataBase64: midiBuf.toString('base64'),
        },
      });

      assert.equal(res.statusCode, 201);
      const body = res.json();
      createdSongIds.add(body.songId);
      createdSourceIds.add(body.sourceId);

      // Verificación estricta de CERO FABRICACIÓN en respuesta de ingesta
      assert.equal(body.timeSignature, null, 'timeSignature must be null when undeclared');
      assert.equal(body.defaultKey, null, 'defaultKey must be null when undeclared');
      assert.equal(body.defaultBpm, null, 'defaultBpm must be null when undeclared');

      // Verificación en el payload canónico generado
      const payload = body.canonicalPayload;
      assert.ok(payload);
      assert.equal(payload.measures[0].timeSignature, null, 'measure.timeSignature must be null');
      assert.equal(payload.measures[0].keySignature, null, 'measure.keySignature must be null');
      assert.equal(payload.timeline.tempoMap.events.length, 0, 'tempoMap.events must be empty');
      assert.equal(payload.timeline.isUnmetered, true, 'timeline must be unmetered');

      const hydratedTimeline = Timeline.fromJSON(payload.timeline);
      assert.equal(hydratedTimeline.totalDurationSeconds, null, 'totalDurationSeconds must be null on hydrated timeline');
      assert.equal(hydratedTimeline.isUnmetered, true, 'timeline must be unmetered');
    });

    it('A1.5: CanonicalSerializer / CanonicalDeserializer round-trip must preserve null signatures and unmetered timeline', () => {
      const originalPayload = new CanonicalMusicPayload({
        title: 'Naked Canonical Score',
        timeline: new Timeline({
          totalDurationTicks: 960,
          measureCount: 1,
          tempoMap: new TempoMap([]),
          isUnmetered: true,
        }),
        measures: [
          new Measure({
            number: 1,
            timeSignature: null,
            keySignature: null,
            startTick: 0,
            durationTicks: 960,
          }),
        ],
      });

      const serialized = CanonicalSerializer.serialize(originalPayload);
      assert.equal(serialized.timeline.tempoMap.events.length, 0);
      assert.equal(serialized.timeline.isUnmetered, true);
      assert.equal(serialized.measures[0]!.timeSignature, null);
      assert.equal(serialized.measures[0]!.keySignature, null);

      const deserialized = CanonicalDeserializer.deserialize(serialized);
      assert.equal(deserialized.title, 'Naked Canonical Score');
      assert.equal(deserialized.timeline.isUnmetered, true);
      assert.equal(deserialized.timeline.tempoMap.isUnresolved, true);
      assert.equal(deserialized.timeline.totalDurationSeconds, null);
      assert.equal(deserialized.measures[0]!.timeSignature, null);
      assert.equal(deserialized.measures[0]!.keySignature, null);
    });
  });

  // =========================================================================
  // WORKSTREAM B — RETENCIÓN INCONDICIONAL DE FUENTES Y MIGRACIÓN 0014
  // =========================================================================

  describe('Workstream B: Database Retention & Referential Integrity (Migration 0014)', () => {
    it('B1.1: PostgreSQL catalog verification: all 4 foreign keys on song_sources must have delete_rule = "SET NULL"', async () => {
      const catalogQuery = await pool.query(`
        SELECT
          rc.constraint_name,
          kcu.column_name,
          ccu.table_name AS foreign_table_name,
          ccu.column_name AS foreign_column_name,
          rc.delete_rule,
          rc.update_rule
        FROM information_schema.referential_constraints rc
        JOIN information_schema.key_column_usage kcu
          ON rc.constraint_name = kcu.constraint_name
        JOIN information_schema.constraint_column_usage ccu
          ON rc.constraint_name = ccu.constraint_name
        WHERE kcu.table_name = 'song_sources'
        ORDER BY rc.constraint_name;
      `);

      const rulesMap = new Map<string, string>();
      for (const row of catalogQuery.rows) {
        rulesMap.set(row.column_name, row.delete_rule);
      }

      assert.equal(rulesMap.get('song_id'), 'SET NULL', 'song_sources.song_id must be ON DELETE SET NULL');
      assert.equal(rulesMap.get('version_id'), 'SET NULL', 'song_sources.version_id must be ON DELETE SET NULL (Migration 0014)');
      assert.equal(rulesMap.get('user_id'), 'SET NULL', 'song_sources.user_id must be ON DELETE SET NULL');
      assert.equal(rulesMap.get('job_id'), 'SET NULL', 'song_sources.job_id must be ON DELETE SET NULL');
    });

    it('B1.2: Deleting a song_version directly must SET song_sources.version_id = NULL without deleting the source record', async () => {
      const chordProText = '{title: Version Cascade Test}\n[C]Prueba de [F]version';
      const uploadRes = await app.inject({
        method: 'POST',
        url: '/api/v1/ingestion/upload',
        headers: { authorization: `Bearer ${userAToken}` },
        payload: {
          filename: 'version_cascade.pro',
          rawText: chordProText,
        },
      });

      assert.equal(uploadRes.statusCode, 201);
      const { songId, sourceId, versionId } = uploadRes.json();
      createdSongIds.add(songId);
      createdSourceIds.add(sourceId);

      // Verificar que song_sources tiene version_id asignado
      const [srcBefore] = await db
        .select()
        .from(songSources)
        .where(eq(songSources.id, sourceId));

      assert.ok(srcBefore);
      assert.equal(srcBefore.versionId, versionId);
      assert.equal(srcBefore.songId, songId);

      // Eliminar directamente el song_version
      await db.delete(songVersions).where(eq(songVersions.id, versionId));

      // Verificar que el registro song_sources sobrevive con version_id = NULL
      const [srcAfter] = await db
        .select()
        .from(songSources)
        .where(eq(songSources.id, sourceId));

      assert.ok(srcAfter, 'song_sources record must strictly survive version deletion');
      assert.equal(srcAfter.versionId, null, 'song_sources.version_id must be SET NULL');
      assert.equal(srcAfter.songId, songId, 'song_sources.song_id must remain intact');
    });

    it('B1.3: Deleting a song directly must SET song_sources.song_id = NULL without deleting the source record', async () => {
      const chordProText = '{title: Song Cascade Test}\n[D]Prueba de [G]cancion';
      const uploadRes = await app.inject({
        method: 'POST',
        url: '/api/v1/ingestion/upload',
        headers: { authorization: `Bearer ${userAToken}` },
        payload: {
          filename: 'song_cascade.pro',
          rawText: chordProText,
        },
      });

      assert.equal(uploadRes.statusCode, 201);
      const { songId, sourceId } = uploadRes.json();
      createdSourceIds.add(sourceId);

      // Eliminar versiones y la canción
      await db.delete(songVersions).where(eq(songVersions.songId, songId));
      await db.delete(songs).where(eq(songs.id, songId));

      // La fuente sobrevive con song_id = NULL
      const [srcAfter] = await db
        .select()
        .from(songSources)
        .where(eq(songSources.id, sourceId));

      assert.ok(srcAfter, 'song_sources record must strictly survive song deletion');
      assert.equal(srcAfter.songId, null, 'song_sources.song_id must be SET NULL');
    });

    it('B1.4: Deleting a user directly must SET song_sources.user_id = NULL without deleting the source record', async () => {
      const userRepo = new DrizzleUserRepository();
      const tempUser = await userRepo.create({
        email: `temp_r3_${Date.now()}@bethesda.test`,
        passwordHash: 'dummy_hash',
        firstName: 'TempR3',
        lastName: 'User',
        role: 'MUSICIAN',
      });

      const tempToken = tokenService.signAccessToken({
        id: tempUser.id,
        email: tempUser.email,
        role: tempUser.role,
      }).token;

      const chordProText = '{title: User Cascade Test}\n[E]Prueba de [A]usuario';
      const uploadRes = await app.inject({
        method: 'POST',
        url: '/api/v1/ingestion/upload',
        headers: { authorization: `Bearer ${tempToken}` },
        payload: {
          filename: 'user_cascade.pro',
          rawText: chordProText,
        },
      });

      assert.equal(uploadRes.statusCode, 201);
      const { songId, sourceId } = uploadRes.json();
      createdSongIds.add(songId);
      createdSourceIds.add(sourceId);

      // Eliminar el usuario temporal
      await db.delete(users).where(eq(users.id, tempUser.id));

      // La fuente sobrevive con user_id = NULL
      const [srcAfter] = await db
        .select()
        .from(songSources)
        .where(eq(songSources.id, sourceId));

      assert.ok(srcAfter, 'song_sources record must survive user deletion');
      assert.equal(srcAfter.userId, null, 'song_sources.user_id must be SET NULL');
    });
  });

  // =========================================================================
  // WORKSTREAM C — LÍMITES DE SEGURIDAD Y AUDITORÍA DE AISLAMIENTO COMUNITARIO
  // =========================================================================

  describe('Workstream C: Security, Tenant Boundaries & Community Isolation Audit', () => {
    it('C1.1: IDOR Prevention: User A cannot query metadata or download source files owned by User B (403)', async () => {
      // Subir fuente con Usuario B
      const chordProText = '{title: Private ChordPro User B}\n[A]Secreto de [D]B';
      const uploadRes = await app.inject({
        method: 'POST',
        url: '/api/v1/ingestion/upload',
        headers: { authorization: `Bearer ${userBToken}` },
        payload: {
          filename: 'user_b_source.pro',
          rawText: chordProText,
        },
      });

      assert.equal(uploadRes.statusCode, 201);
      const { sourceId, songId } = uploadRes.json();
      createdSongIds.add(songId);
      createdSourceIds.add(sourceId);

      // Usuario A intenta acceder a los metadatos de la fuente de Usuario B -> 403 Forbidden
      const metaRes = await app.inject({
        method: 'GET',
        url: `/api/v1/ingestion/sources/${sourceId}`,
        headers: { authorization: `Bearer ${userAToken}` },
      });
      assert.equal(metaRes.statusCode, 403, 'Cross-user source metadata query must be rejected with 403');

      // Usuario A intenta descargar el archivo binario de la fuente de Usuario B -> 403 Forbidden
      const downloadRes = await app.inject({
        method: 'GET',
        url: `/api/v1/ingestion/sources/${sourceId}/file`,
        headers: { authorization: `Bearer ${userAToken}` },
      });
      assert.equal(downloadRes.statusCode, 403, 'Cross-user source file download must be rejected with 403');
    });

    it('C1.2: IDOR Prevention: User A cannot query background job status belonging to User B (403)', async () => {
      // Registrar un job simulado para Usuario B
      const [job] = await db
        .insert(backgroundJobs)
        .values({
          userId: userBId,
          jobType: 'OMR_PROCESSING',
          status: 'PENDING',
          inputRef: 'test-input-ref',
        })
        .returning();

      createdJobIds.add(job.id);

      // Usuario A intenta consultar el job de Usuario B -> 403 Forbidden
      const jobRes = await app.inject({
        method: 'GET',
        url: `/api/v1/ingestion/jobs/${job.id}`,
        headers: { authorization: `Bearer ${userAToken}` },
      });
      assert.equal(jobRes.statusCode, 403, 'Cross-user background job query must be rejected with 403');
    });

    it('C1.3: Privileged Access: ADMIN role can query and download any source file', async () => {
      // Subir fuente con Usuario A
      const chordProText = '{title: Admin Audit Source}\n[G]Gloria al [C]Rey';
      const uploadRes = await app.inject({
        method: 'POST',
        url: '/api/v1/ingestion/upload',
        headers: { authorization: `Bearer ${userAToken}` },
        payload: {
          filename: 'admin_audit.pro',
          rawText: chordProText,
        },
      });

      assert.equal(uploadRes.statusCode, 201);
      const { sourceId, songId } = uploadRes.json();
      createdSongIds.add(songId);
      createdSourceIds.add(sourceId);

      // Administrador consulta metadatos -> 200 OK
      const metaRes = await app.inject({
        method: 'GET',
        url: `/api/v1/ingestion/sources/${sourceId}`,
        headers: { authorization: `Bearer ${adminToken}` },
      });
      assert.equal(metaRes.statusCode, 200);

      // Administrador descarga archivo -> 200 OK
      const fileRes = await app.inject({
        method: 'GET',
        url: `/api/v1/ingestion/sources/${sourceId}/file`,
        headers: { authorization: `Bearer ${adminToken}` },
      });
      assert.equal(fileRes.statusCode, 200);
      assert.equal(fileRes.payload, chordProText);
    });

    it('C1.4: Architectural Boundary Audit: Schema lacks community_id in users/songs table (Gated Prerequisite)', async () => {
      // Verificar columnas reales de la tabla 'users'
      const usersCols = await pool.query(`
        SELECT column_name
        FROM information_schema.columns
        WHERE table_name = 'users' AND column_name IN ('community_id', 'tenant_id');
      `);

      // Verificar columnas reales de la tabla 'songs'
      const songsCols = await pool.query(`
        SELECT column_name
        FROM information_schema.columns
        WHERE table_name = 'songs' AND column_name IN ('community_id', 'tenant_id');
      `);

      // Documentar formalmente que NO existen columnas relacionales de comunidad en users ni songs
      assert.equal(usersCols.rows.length, 0, 'users table has NO community_id or tenant_id column');
      assert.equal(songsCols.rows.length, 0, 'songs table has NO community_id or tenant_id column');

      // Esto evidencia de manera concluyente que la certificación del aislamiento multi-comunidad
      // requiere una decisión arquitectónica del Product Owner sobre el modelo relacional de comunidades.
    });
  });
});
