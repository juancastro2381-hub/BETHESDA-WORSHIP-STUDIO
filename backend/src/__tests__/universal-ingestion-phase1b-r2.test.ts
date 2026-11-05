/**
 * @file universal-ingestion-phase1b-r2.test.ts
 * @description Suite de pruebas automatizadas exhaustivas para la Fase 1B-R2:
 * 1. Workstream A: Cero Fabricación Musical en Datos Canónicos MIDI (sin compases artificiales de 4/4,
 *    sin tonalidad inventada, sin tempo inventado, sin silencios fabricados, familia OTHER para instrumentos indeterminados).
 * 2. Workstream B: Integridad Criptográfica de Fuente (SHA256(original) === SHA256(almacenado) === SHA256(recuperado),
 *    detección de manipulación de archivo con SourceIntegrityError, registro seguro de VIDEO_REFERENCE sin descarga de stream).
 * 3. Workstream C: Retención Incondicional de Fuentes y Migración 0013 (ON DELETE SET NULL ante borrado de canción o usuario).
 * 4. Workstream D: Seguridad Multi-Inquilino y Prevención IDOR (aislamiento estricto, regla ADMIN, protección de fuentes comunitarias).
 * 5. Workstream E: Clasificación de Tipos de Fuente (detección de firmas binarias PNG, JPEG, TIFF vs PDF_SCORE / IMAGE_SCORE).
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import Fastify, { type FastifyInstance } from 'fastify';
import { and, eq } from 'drizzle-orm';
import { db, pool } from '../db/index.ts';
import { users, songs, songVersions, songSources, backgroundJobs } from '../db/schema.ts';
import { ingestionRoutes } from '../interfaces/http/routes/ingestion.routes.ts';
import { JwtTokenService } from '../application/token-service.ts';
import { env } from '../config/env.ts';
import { MidiParser } from '../domain/ingestion/adapters/midi/midi-parser.ts';
import { MidiIngestionAdapter } from '../domain/ingestion/adapters/midi/midi-adapter.ts';
import { MusicXmlIngestionAdapter } from '../domain/ingestion/adapters/musicxml/musicxml-adapter.ts';
import { ChordProIngestionAdapter } from '../domain/ingestion/adapters/chordpro/chordpro-adapter.ts';
import { AudioIngestionAdapter } from '../domain/ingestion/adapters/audio/audio-adapter.ts';
import { VideoUrlIngestionAdapter } from '../domain/ingestion/adapters/video/video-url-adapter.ts';
import { VisualScoreIngestionAdapter } from '../domain/ingestion/adapters/visual-score/visual-score-adapter.ts';
import { UniversalIngestionService } from '../application/universal-ingestion-service.ts';
import { SongService } from '../application/song-service.ts';
import { DrizzleSongRepository } from '../repositories/song-repository.ts';
import { DrizzleSongVersionRepository } from '../repositories/version-repository.ts';
import { DrizzleUserRepository } from '../repositories/user-repository.ts';
import { LocalFileSystemSourceStorageProvider } from '../domain/ingestion/source-storage-provider.ts';
import type { AuthenticatedUser } from '../domain/auth-types.ts';
import { SourceIntegrityError } from '../domain/errors.ts';

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
  const trackData = Buffer.from(events);
  const header = Buffer.alloc(8);
  header.write('MTrk', 0, 4, 'ascii');
  header.writeUInt32BE(trackData.length, 4);
  return Buffer.concat([header, trackData]);
}

describe('Worship Studio — Phase 1B-R2 Final Integrity Remediation Suite', () => {
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
    email: 'leader_r2_a@bethesda.test',
  };

  const testUserB: AuthenticatedUser = {
    id: '',
    role: 'MUSICIAN',
    email: 'musician_r2_b@bethesda.test',
  };

  const testAdmin: AuthenticatedUser = {
    id: '',
    role: 'ADMIN',
    email: 'admin_r2@bethesda.test',
  };

  const createdSongIds = new Set<string>();
  const createdJobIds = new Set<string>();
  const createdSourceIds = new Set<string>();

  before(async () => {
    tokenService = new JwtTokenService(env.JWT_SECRET);
    const userRepo = new DrizzleUserRepository();

    const ts = Date.now();
    const uA = await userRepo.create({
      email: `leaderr2_a_${ts}@bethesda.test`,
      passwordHash: 'dummy_hash_a',
      firstName: 'Leader',
      lastName: 'R2-A',
      role: 'WORSHIP_LEADER',
    });
    userAId = uA.id;
    testUserA.id = userAId;
    testUserA.email = uA.email;

    const uB = await userRepo.create({
      email: `musicianr2_b_${ts}@bethesda.test`,
      passwordHash: 'dummy_hash_b',
      firstName: 'Musician',
      lastName: 'R2-B',
      role: 'MUSICIAN',
    });
    userBId = uB.id;
    testUserB.id = userBId;
    testUserB.email = uB.email;

    const uAdmin = await userRepo.create({
      email: `adminr2_${ts}@bethesda.test`,
      passwordHash: 'dummy_hash_admin',
      firstName: 'Admin',
      lastName: 'R2',
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

    // Configuración de Fastify
    app = Fastify({ logger: false });
    await app.register(ingestionRoutes, { prefix: '/api/v1/ingestion' });
    await app.ready();
  });

  after(async () => {
    // Limpieza de datos creados en pruebas
    for (const jId of createdJobIds) {
      await db.delete(backgroundJobs).where(eq(backgroundJobs.id, jId)).catch(() => {});
    }
    for (const sId of createdSourceIds) {
      await db.delete(songSources).where(eq(songSources.id, sId)).catch(() => {});
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
  // WORKSTREAM A — CERO FABRICACIÓN MUSICAL EN DATOS CANÓNICOS MIDI
  // =========================================================================

  describe('Workstream A: Zero Musical Fabrication in MIDI Canonical Data', () => {
    it('A1.1: should NOT fabricate 4/4 meter when MIDI lacks time signature event', async () => {
      // Secuencia MIDI sin evento Meta 0x58 (Time Signature)
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
          filename: 'unmetered_test.mid',
          dataBase64: midiBuf.toString('base64'),
        },
      });

      assert.equal(res.statusCode, 201);
      const body = res.json();
      assert.equal(body.timeSignature, null, 'timeSignature must be null when undeclared');
      assert.equal(body.status, 'PARTIALLY_CONVERTED');
      assert.ok(body.canonicalPayload);
      assert.equal(body.canonicalPayload.metadata.isUnmetered, true);
      assert.equal(body.canonicalPayload.metadata.hasUnresolvedMeter, true);

      // Debe contener diagnóstico informativo UNMETERED_TIMELINE
      const hasUnmeteredDiag = body.diagnostics.some((d: any) => d.code === 'UNMETERED_TIMELINE');
      assert.ok(hasUnmeteredDiag, 'Diagnostics must include UNMETERED_TIMELINE');

      // Las notas no deben dividirse con ligaduras artificiales de compás 4/4
      const m1 = body.canonicalPayload.measures[0];
      assert.ok(m1);
      const voice1 = m1.voices[0];
      const notes = voice1.events.filter((e: any) => !e.isRest);
      assert.equal(notes.length, 1);
      assert.equal(notes[0].tie, 'NONE');

      createdSongIds.add(body.songId);
      createdSourceIds.add(body.sourceId);
    });

    it('A1.2: should NOT fabricate C major when MIDI lacks key signature event', async () => {
      // MIDI con métrica 4/4 declarada pero SIN evento Meta 0x59 (Key Signature)
      const trackEvents: number[] = [
        0x00, 0xff, 0x58, 0x04, 0x04, 0x02, 0x18, 0x08, // TimeSig 4/4
        0x00, 0x90, 62, 75, // delta=0, NoteOn D4
        ...writeVLQ(480), 0x80, 62, 0, // delta=480, NoteOff D4
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
          filename: 'no_key_test.mid',
          dataBase64: midiBuf.toString('base64'),
        },
      });

      assert.equal(res.statusCode, 201);
      const body = res.json();
      assert.equal(body.defaultKey, null, 'defaultKey must be null when undeclared (never default to C Major)');
      assert.equal(body.canonicalPayload.metadata.hasUnresolvedKey, true);

      createdSongIds.add(body.songId);
      createdSourceIds.add(body.sourceId);
    });

    it('A1.3: should NOT fabricate 120 BPM tempo when MIDI lacks Set Tempo event', async () => {
      // MIDI con métrica 4/4 pero SIN evento Meta 0x51 (Set Tempo)
      const trackEvents: number[] = [
        0x00, 0xff, 0x58, 0x04, 0x04, 0x02, 0x18, 0x08, // TimeSig 4/4
        0x00, 0x90, 64, 75, // delta=0, NoteOn E4
        ...writeVLQ(480), 0x80, 64, 0, // delta=480, NoteOff E4
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
          filename: 'no_tempo_test.mid',
          dataBase64: midiBuf.toString('base64'),
        },
      });

      assert.equal(res.statusCode, 201);
      const body = res.json();
      assert.equal(body.defaultBpm, null, 'defaultBpm must be null when undeclared (never default to 120 BPM)');
      assert.equal(body.canonicalPayload.metadata.hasUnresolvedTempo, true);

      createdSongIds.add(body.songId);
      createdSourceIds.add(body.sourceId);
    });

    it('A1.4: should NOT fabricate fake Rest objects in empty voice or measure', async () => {
      // MIDI con dos pistas: Pista 1 tiene notas, Pista 2 es muda (sin notas)
      const track1Events: number[] = [
        0x00, 0xff, 0x58, 0x04, 0x04, 0x02, 0x18, 0x08,
        0x00, 0x90, 60, 80,
        ...writeVLQ(480), 0x80, 60, 0,
        0x00, 0xff, 0x2f, 0x00,
      ];

      const track2Events: number[] = [
        0x00, 0xff, 0x03, 0x04, 0x54, 0x65, 0x73, 0x74, // TrackName "Test"
        0x00, 0xff, 0x2f, 0x00, // Sin notas
      ];

      const header = buildMidiHeader(1, 2, 480);
      const track1 = buildMidiTrack(track1Events);
      const track2 = buildMidiTrack(track2Events);
      const midiBuf = Buffer.concat([header, track1, track2]);

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/ingestion/upload',
        headers: { authorization: `Bearer ${userAToken}` },
        payload: {
          filename: 'empty_track_test.mid',
          dataBase64: midiBuf.toString('base64'),
        },
      });

      assert.equal(res.statusCode, 201);
      const body = res.json();
      const m1 = body.canonicalPayload.measures[0];
      assert.ok(m1);

      // Verificar que ningún evento es un Rest fabricado
      for (const voice of m1.voices) {
        const rests = voice.events.filter((e: any) => e.isRest);
        assert.equal(rests.length, 0, 'Zero Rest objects must be fabricated in MIDI canonical voices');
      }

      createdSongIds.add(body.songId);
      createdSourceIds.add(body.sourceId);
    });

    it('A1.5: should classify unknown instrument as OTHER rather than assuming KEYS', () => {
      // Pista con nombre genérico y sin Program Change ni percusión en canal 0
      const family = MidiIngestionAdapter.detectInstrumentFamily('Pista de Prueba Desconocida', 0, undefined);
      assert.equal(family, 'OTHER', 'Unknown instrument must classify as OTHER, never default to KEYS');
    });
  });

  // =========================================================================
  // WORKSTREAM B — INTEGRIDAD CRIPTOGRÁFICA Y PRESERVACIÓN INCONDICIONAL
  // =========================================================================

  describe('Workstream B: Cryptographic Source Integrity & Immutability', () => {
    it('B1.1: should guarantee SHA256(original) === SHA256(stored) === SHA256(retrieved) for binary SMF', async () => {
      const trackEvents: number[] = [
        0x00, 0xff, 0x58, 0x04, 0x04, 0x02, 0x18, 0x08,
        0x00, 0x90, 67, 90,
        ...writeVLQ(480), 0x80, 67, 0,
        0x00, 0xff, 0x2f, 0x00,
      ];
      const originalBytes = Buffer.concat([buildMidiHeader(0, 1, 480), buildMidiTrack(trackEvents)]);
      const originalSha256 = crypto.createHash('sha256').update(originalBytes).digest('hex');

      const uploadRes = await app.inject({
        method: 'POST',
        url: '/api/v1/ingestion/upload',
        headers: { authorization: `Bearer ${userAToken}` },
        payload: {
          filename: 'crypto_contract.mid',
          dataBase64: originalBytes.toString('base64'),
        },
      });

      assert.equal(uploadRes.statusCode, 201);
      const uploadBody = uploadRes.json();
      assert.equal(uploadBody.sourceChecksumSha256, originalSha256, 'Reported sourceChecksumSha256 must match original');

      // Consultar registro en base de datos
      const [sourceRow] = await db
        .select()
        .from(songSources)
        .where(eq(songSources.id, uploadBody.sourceId));

      assert.ok(sourceRow);
      assert.equal(sourceRow.checksumSha256, originalSha256, 'DB stored checksum must match original');

      // Descargar archivo físico a través del endpoint
      const downloadRes = await app.inject({
        method: 'GET',
        url: `/api/v1/ingestion/sources/${uploadBody.sourceId}/file`,
        headers: { authorization: `Bearer ${userAToken}` },
      });

      assert.equal(downloadRes.statusCode, 200);
      const retrievedBytes = downloadRes.rawPayload;
      const retrievedSha256 = crypto.createHash('sha256').update(retrievedBytes).digest('hex');

      assert.equal(retrievedSha256, originalSha256, 'Retrieved bytes SHA256 must strictly equal original SHA256');

      createdSongIds.add(uploadBody.songId);
      createdSourceIds.add(uploadBody.sourceId);
    });

    it('B1.2: should guarantee SHA256(original) === SHA256(stored) === SHA256(retrieved) for Written Notes', async () => {
      const writtenNotes = {
        title: 'Notas Deterministas R2',
        tempoBpm: 120,
        measures: [
          {
            measureNumber: 1,
            timeSignature: { numerator: 4, denominator: 4 },
            notes: [{ step: 'C', octave: 4, duration: 'quarter' as const }],
          },
        ],
      };

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/ingestion/written-notes',
        headers: { authorization: `Bearer ${userAToken}` },
        payload: writtenNotes,
      });

      assert.equal(res.statusCode, 201);
      const body = res.json();
      assert.ok(body.sourceId);

      // Descargar archivo recuperado
      const downloadRes = await app.inject({
        method: 'GET',
        url: `/api/v1/ingestion/sources/${body.sourceId}/file`,
        headers: { authorization: `Bearer ${userAToken}` },
      });

      assert.equal(downloadRes.statusCode, 200);
      const retrievedBytes = downloadRes.rawPayload;
      const retrievedSha256 = crypto.createHash('sha256').update(retrievedBytes).digest('hex');

      assert.equal(retrievedSha256, body.sourceChecksumSha256);

      createdSongIds.add(body.songId);
      createdSourceIds.add(body.sourceId);
    });

    it('B1.3: should detect file tampering on disk and refuse to serve corrupted bytes (SourceIntegrityError)', async () => {
      const trackEvents: number[] = [
        0x00, 0x90, 60, 80,
        ...writeVLQ(480), 0x80, 60, 0,
        0x00, 0xff, 0x2f, 0x00,
      ];
      const midiBuf = Buffer.concat([buildMidiHeader(0, 1, 480), buildMidiTrack(trackEvents)]);

      const uploadRes = await app.inject({
        method: 'POST',
        url: '/api/v1/ingestion/upload',
        headers: { authorization: `Bearer ${userAToken}` },
        payload: {
          filename: 'tamper_test.mid',
          dataBase64: midiBuf.toString('base64'),
        },
      });

      assert.equal(uploadRes.statusCode, 201);
      const uploadBody = uploadRes.json();
      const sourceId = uploadBody.sourceId;

      // Localizar archivo físico en almacenamiento
      const [sourceRow] = await db
        .select()
        .from(songSources)
        .where(eq(songSources.id, sourceId));
      assert.ok(sourceRow);

      const storageProvider = new LocalFileSystemSourceStorageProvider();
      const filePath = storageProvider.resolveSafePath(sourceRow.storagePath!);

      // Simular corrupción/manipulación no autorizada modificando 1 byte en disco
      const originalDiskBytes = await fs.readFile(filePath);
      const tamperedBytes = Buffer.from(originalDiskBytes);
      tamperedBytes[tamperedBytes.length - 1] ^= 0xff; // Invertir último byte
      await fs.writeFile(filePath, tamperedBytes);

      // Intento de descarga debe fallar con 500 y SourceIntegrityError
      const downloadRes = await app.inject({
        method: 'GET',
        url: `/api/v1/ingestion/sources/${sourceId}/file`,
        headers: { authorization: `Bearer ${userAToken}` },
      });

      assert.equal(downloadRes.statusCode, 500, 'Tampered file on disk must fail retrieval with HTTP 500');
      const errBody = downloadRes.json();
      assert.equal(errBody.code, 'SOURCE_INTEGRITY_ERROR');

      // Restaurar bytes en disco para evitar efectos colaterales en cleanup
      await fs.writeFile(filePath, originalDiskBytes);

      createdSongIds.add(uploadBody.songId);
      createdSourceIds.add(sourceId);
    });

    it('B1.4: should register VIDEO_REFERENCE without downloading stream or pretending to hash media bytes', async () => {
      const youtubeUrl = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/ingestion/video-url',
        headers: { authorization: `Bearer ${userAToken}` },
        payload: {
          videoUrl: youtubeUrl,
          title: 'Referencia Video Litúrgico R2',
        },
      });

      assert.equal(res.statusCode, 201);
      const body = res.json();
      assert.equal(body.sourceType, 'VIDEO_URL');
      assert.equal(body.status, 'REGISTERED');
      assert.ok(body.sourceChecksumSha256);

      // Verificar que el archivo almacenado es un JSON descriptivo de la referencia
      const downloadRes = await app.inject({
        method: 'GET',
        url: `/api/v1/ingestion/sources/${body.sourceId}/file`,
        headers: { authorization: `Bearer ${userAToken}` },
      });

      assert.equal(downloadRes.statusCode, 200);
      const savedJson = JSON.parse(downloadRes.payload);
      assert.equal(savedJson.sourceKind, 'VIDEO_REFERENCE');
      assert.equal(savedJson.videoUrl, youtubeUrl);

      createdSongIds.add(body.songId);
      createdSourceIds.add(body.sourceId);
    });
  });

  // =========================================================================
  // WORKSTREAM C — RETENCIÓN INCONDICIONAL DE FUENTES (MIGRACIÓN 0013)
  // =========================================================================

  describe('Workstream C: Source Retention & Referential Integrity', () => {
    it('C1.1: should preserve song_sources record when song is deleted (ON DELETE SET NULL)', async () => {
      // Subir fuente vinculada a una canción
      const chordProText = '{title: Cancion Borrable R2}\n[G]Gracia sublime [C]es';
      const uploadRes = await app.inject({
        method: 'POST',
        url: '/api/v1/ingestion/upload',
        headers: { authorization: `Bearer ${userAToken}` },
        payload: {
          filename: 'deletable_song.pro',
          rawText: chordProText,
        },
      });

      assert.equal(uploadRes.statusCode, 201);
      const { songId, sourceId } = uploadRes.json();
      createdSourceIds.add(sourceId);

      // Verificar que la fuente apunta a la canción
      const [sourceBefore] = await db
        .select()
        .from(songSources)
        .where(eq(songSources.id, sourceId));
      assert.equal(sourceBefore.songId, songId);

      // Eliminar la canción
      await db.delete(songVersions).where(eq(songVersions.songId, songId));
      await db.delete(songs).where(eq(songs.id, songId));

      // La fuente NO DEBE haber sido borrada en cascada; song_id debe ser NULL
      const [sourceAfter] = await db
        .select()
        .from(songSources)
        .where(eq(songSources.id, sourceId));

      assert.ok(sourceAfter, 'song_sources record must survive parent song deletion');
      assert.equal(sourceAfter.songId, null, 'Foreign key song_id must be SET NULL upon song deletion');

      // El archivo físico debe permanecer accesible
      const downloadRes = await app.inject({
        method: 'GET',
        url: `/api/v1/ingestion/sources/${sourceId}/file`,
        headers: { authorization: `Bearer ${userAToken}` },
      });
      assert.equal(downloadRes.statusCode, 200);
      assert.equal(downloadRes.payload, chordProText);
    });

    it('C1.2: should preserve song_sources record when user is deleted (ON DELETE SET NULL)', async () => {
      // Crear un usuario temporal
      const userRepo = new DrizzleUserRepository();
      const tempUser = await userRepo.create({
        email: `temp_retention_${Date.now()}@bethesda.test`,
        passwordHash: 'dummy_hash',
        firstName: 'Temp',
        lastName: 'User',
        role: 'MUSICIAN',
      });

      const tempToken = tokenService.signAccessToken({
        id: tempUser.id,
        email: tempUser.email,
        role: tempUser.role,
      }).token;

      // Subir fuente con el usuario temporal
      const chordProText = '{title: Cancion Usuario Temporal}\n[D]Dios es [A]bueno';
      const uploadRes = await app.inject({
        method: 'POST',
        url: '/api/v1/ingestion/upload',
        headers: { authorization: `Bearer ${tempToken}` },
        payload: {
          filename: 'temp_user_song.pro',
          rawText: chordProText,
        },
      });

      assert.equal(uploadRes.statusCode, 201);
      const { songId, sourceId } = uploadRes.json();
      createdSongIds.add(songId);
      createdSourceIds.add(sourceId);

      // Verificar pertenencia inicial
      const [sourceBefore] = await db
        .select()
        .from(songSources)
        .where(eq(songSources.id, sourceId));
      assert.equal(sourceBefore.userId, tempUser.id);

      // Eliminar el usuario temporal
      await db.delete(users).where(eq(users.id, tempUser.id));

      // La fuente NO DEBE ser eliminada; user_id debe ser NULL
      const [sourceAfter] = await db
        .select()
        .from(songSources)
        .where(eq(songSources.id, sourceId));

      assert.ok(sourceAfter, 'song_sources record must survive parent user deletion');
      assert.equal(sourceAfter.userId, null, 'Foreign key user_id must be SET NULL upon user deletion');

      // Admin debe poder consultar y descargar esta fuente desvinculada
      const adminDownload = await app.inject({
        method: 'GET',
        url: `/api/v1/ingestion/sources/${sourceId}/file`,
        headers: { authorization: `Bearer ${adminToken}` },
      });
      assert.equal(adminDownload.statusCode, 200);
    });
  });

  // =========================================================================
  // WORKSTREAM D — SEGURIDAD MULTI-INQUILINO Y PREVENCIÓN IDOR
  // =========================================================================

  describe('Workstream D: Multi-Tenant Security & IDOR Prevention', () => {
    it('D1.1: should reject cross-user access to source metadata with 403 Forbidden', async () => {
      // User A sube una fuente
      const uploadRes = await app.inject({
        method: 'POST',
        url: '/api/v1/ingestion/upload',
        headers: { authorization: `Bearer ${userAToken}` },
        payload: {
          filename: 'usera_private.pro',
          rawText: '{title: Privado User A}\n[C]Santo, [F]Santo',
        },
      });

      const { sourceId, songId } = uploadRes.json();
      createdSongIds.add(songId);
      createdSourceIds.add(sourceId);

      // User B intenta consultar metadata de la fuente de User A
      const getRes = await app.inject({
        method: 'GET',
        url: `/api/v1/ingestion/sources/${sourceId}`,
        headers: { authorization: `Bearer ${userBToken}` },
      });

      assert.equal(getRes.statusCode, 403, 'Cross-user access to source metadata must return 403 Forbidden');
    });

    it('D1.2: should reject cross-user download of source file with 403 Forbidden', async () => {
      // User A sube una fuente
      const uploadRes = await app.inject({
        method: 'POST',
        url: '/api/v1/ingestion/upload',
        headers: { authorization: `Bearer ${userAToken}` },
        payload: {
          filename: 'usera_download_block.pro',
          rawText: '{title: Bloqueo Descarga}\n[Am]Alabaré',
        },
      });

      const { sourceId, songId } = uploadRes.json();
      createdSongIds.add(songId);
      createdSourceIds.add(sourceId);

      // User B intenta descargar el archivo físico de User A
      const downloadRes = await app.inject({
        method: 'GET',
        url: `/api/v1/ingestion/sources/${sourceId}/file`,
        headers: { authorization: `Bearer ${userBToken}` },
      });

      assert.equal(downloadRes.statusCode, 403, 'Cross-user download of source file must return 403 Forbidden');
    });

    it('D1.3: should reject standard user access to unassigned/community source (userId = null) with 403', async () => {
      // Insertar fuente de comunidad (userId = null)
      const [communitySource] = await db
        .insert(songSources)
        .values({
          songId: null,
          userId: null,
          sourceType: 'CHORD_PRO',
          filename: 'community_hymn.pro',
          storagePath: 'sources/community_hymn.pro',
          checksumSha256: crypto.createHash('sha256').update('community').digest('hex'),
          fileSizeBytes: 9,
          mimeType: 'text/plain',
          importerName: 'ChordProIngestionAdapter',
          importerVersion: '1.0.0',
        })
        .returning();

      createdSourceIds.add(communitySource.id);

      // User B (sin privilegios ADMIN) intenta acceder
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/ingestion/sources/${communitySource.id}`,
        headers: { authorization: `Bearer ${userBToken}` },
      });

      assert.equal(res.statusCode, 403, 'Standard users must NOT access unassigned sources without ownership');
    });

    it('D1.4: should allow ADMIN role to query and download any source', async () => {
      // User A sube una fuente
      const uploadRes = await app.inject({
        method: 'POST',
        url: '/api/v1/ingestion/upload',
        headers: { authorization: `Bearer ${userAToken}` },
        payload: {
          filename: 'admin_access_test.pro',
          rawText: '{title: Admin Access}\n[C]Aleluya',
        },
      });

      const { sourceId, songId } = uploadRes.json();
      createdSongIds.add(songId);
      createdSourceIds.add(sourceId);

      // ADMIN consulta metadata
      const getRes = await app.inject({
        method: 'GET',
        url: `/api/v1/ingestion/sources/${sourceId}`,
        headers: { authorization: `Bearer ${adminToken}` },
      });
      assert.equal(getRes.statusCode, 200);

      // ADMIN descarga archivo
      const downloadRes = await app.inject({
        method: 'GET',
        url: `/api/v1/ingestion/sources/${sourceId}/file`,
        headers: { authorization: `Bearer ${adminToken}` },
      });
      assert.equal(downloadRes.statusCode, 200);
    });
  });

  // =========================================================================
  // WORKSTREAM E — CLASIFICACIÓN DE TIPOS DE FUENTE (IMAGE_SCORE vs PDF_SCORE)
  // =========================================================================

  describe('Workstream E: Accurate Source Type Classification', () => {
    it('E1.1: should classify PNG file as IMAGE_SCORE and persist format IMAGE', async () => {
      // Magic bytes de PNG: 89 50 4E 47 0D 0A 1A 0A
      const pngHeader = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);
      const pngPayload = Buffer.concat([pngHeader, Buffer.alloc(100, 0)]);

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/ingestion/upload',
        headers: { authorization: `Bearer ${userAToken}` },
        payload: {
          filename: 'score_page.png',
          dataBase64: pngPayload.toString('base64'),
        },
      });

      assert.equal(res.statusCode, 201);
      const body = res.json();
      assert.equal(body.sourceType, 'IMAGE_SCORE');
      assert.equal(body.status, 'RECOGNITION_UNAVAILABLE');

      // Verificar persistencia en song_sources
      const [sourceRow] = await db
        .select()
        .from(songSources)
        .where(eq(songSources.id, body.sourceId));

      assert.ok(sourceRow);
      assert.equal(sourceRow.sourceType, 'IMAGE', 'PNG file must be persisted with sourceType IMAGE in song_sources');

      createdSongIds.add(body.songId);
      createdSourceIds.add(body.sourceId);
    });

    it('E1.2: should classify JPEG file as IMAGE_SCORE and persist format IMAGE', async () => {
      // Magic bytes de JPEG: FF D8 FF
      const jpegHeader = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
      const jpegPayload = Buffer.concat([jpegHeader, Buffer.alloc(100, 0)]);

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/ingestion/upload',
        headers: { authorization: `Bearer ${userAToken}` },
        payload: {
          filename: 'score_page.jpg',
          dataBase64: jpegPayload.toString('base64'),
        },
      });

      assert.equal(res.statusCode, 201);
      const body = res.json();
      assert.equal(body.sourceType, 'IMAGE_SCORE');
      assert.equal(body.status, 'RECOGNITION_UNAVAILABLE');

      const [sourceRow] = await db
        .select()
        .from(songSources)
        .where(eq(songSources.id, body.sourceId));

      assert.ok(sourceRow);
      assert.equal(sourceRow.sourceType, 'IMAGE', 'JPEG file must be persisted with sourceType IMAGE in song_sources');

      createdSongIds.add(body.songId);
      createdSourceIds.add(body.sourceId);
    });

    it('E1.3: should classify TIFF file as IMAGE_SCORE and persist format IMAGE', async () => {
      // Magic bytes de TIFF (Little Endian): 49 49 2A 00
      const tiffHeader = Buffer.from([0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00]);
      const tiffPayload = Buffer.concat([tiffHeader, Buffer.alloc(100, 0)]);

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/ingestion/upload',
        headers: { authorization: `Bearer ${userAToken}` },
        payload: {
          filename: 'score_scan.tiff',
          dataBase64: tiffPayload.toString('base64'),
        },
      });

      assert.equal(res.statusCode, 201);
      const body = res.json();
      assert.equal(body.sourceType, 'IMAGE_SCORE');
      assert.equal(body.status, 'RECOGNITION_UNAVAILABLE');

      const [sourceRow] = await db
        .select()
        .from(songSources)
        .where(eq(songSources.id, body.sourceId));

      assert.ok(sourceRow);
      assert.equal(sourceRow.sourceType, 'IMAGE', 'TIFF file must be persisted with sourceType IMAGE in song_sources');

      createdSongIds.add(body.songId);
      createdSourceIds.add(body.sourceId);
    });

    it('E1.4: should classify PDF file as PDF_SCORE and persist format PDF', async () => {
      // Magic bytes de PDF: %PDF-
      const pdfHeader = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF');

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/ingestion/upload',
        headers: { authorization: `Bearer ${userAToken}` },
        payload: {
          filename: 'choral_score.pdf',
          dataBase64: pdfHeader.toString('base64'),
        },
      });

      assert.equal(res.statusCode, 201);
      const body = res.json();
      assert.equal(body.sourceType, 'PDF_SCORE');
      assert.equal(body.status, 'RECOGNITION_UNAVAILABLE');

      const [sourceRow] = await db
        .select()
        .from(songSources)
        .where(eq(songSources.id, body.sourceId));

      assert.ok(sourceRow);
      assert.equal(sourceRow.sourceType, 'PDF', 'PDF file must be persisted with sourceType PDF in song_sources');

      createdSongIds.add(body.songId);
      createdSourceIds.add(body.sourceId);
    });
  });
});
