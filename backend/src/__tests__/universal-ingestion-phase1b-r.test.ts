/**
 * @file universal-ingestion-phase1b-r.test.ts
 * @description Suite de pruebas automatizadas de remediación para la Fase 1B-R:
 * Preservación incondicional de fuentes, fidelidad musical sin invención de notas,
 * robustez MIDI, validación binaria server-side, idempotencia multi-inquilino y trazabilidad.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
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
import { UniversalIngestionService } from '../application/universal-ingestion-service.ts';
import { SongService } from '../application/song-service.ts';
import { DrizzleSongRepository } from '../repositories/song-repository.ts';
import { DrizzleSongVersionRepository } from '../repositories/version-repository.ts';
import { DrizzleUserRepository } from '../repositories/user-repository.ts';
import { LocalFileSystemSourceStorageProvider } from '../domain/ingestion/source-storage-provider.ts';
import type { AuthenticatedUser } from '../domain/auth-types.ts';
import { PersistenceError, ValidationError } from '../domain/errors.ts';

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

describe('Worship Studio — Phase 1B-R Remediation Test Suite', () => {
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
    email: 'usera@bethesda.org',
  };

  const testUserB: AuthenticatedUser = {
    id: '',
    role: 'MUSICIAN',
    email: 'userb@bethesda.org',
  };

  const testAdmin: AuthenticatedUser = {
    id: '',
    role: 'ADMIN',
    email: 'admin@bethesda.org',
  };

  const createdSongIds = new Set<string>();
  const createdJobIds = new Set<string>();
  const createdSourceIds = new Set<string>();

  before(async () => {
    tokenService = new JwtTokenService(env.JWT_SECRET);
    const userRepo = new DrizzleUserRepository();

    const ts = Date.now();
    const uA = await userRepo.create({
      email: `usera_${ts}@bethesda.test`,
      passwordHash: 'dummy_hash_a',
      firstName: 'Worship',
      lastName: 'Leader A',
      role: 'WORSHIP_LEADER',
    });
    userAId = uA.id;
    testUserA.id = userAId;
    testUserA.email = uA.email;

    const uB = await userRepo.create({
      email: `userb_${ts}@bethesda.test`,
      passwordHash: 'dummy_hash_b',
      firstName: 'Musician',
      lastName: 'User B',
      role: 'MUSICIAN',
    });
    userBId = uB.id;
    testUserB.id = userBId;
    testUserB.email = uB.email;

    const uAdmin = await userRepo.create({
      email: `admin_${ts}@bethesda.test`,
      passwordHash: 'dummy_hash_admin',
      firstName: 'Admin',
      lastName: 'Supervisor',
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

    app = Fastify({ logger: false });
    await app.register(ingestionRoutes, { prefix: '/api/v1/ingestion' });
    await app.ready();
  });

  after(async () => {
    await app.close();

    // Limpieza de datos creados en pruebas
    for (const sourceId of createdSourceIds) {
      await db.delete(songSources).where(eq(songSources.id, sourceId)).catch(() => {});
    }
    for (const songId of createdSongIds) {
      await db.delete(songSources).where(eq(songSources.songId, songId)).catch(() => {});
      await db.delete(songVersions).where(eq(songVersions.songId, songId)).catch(() => {});
      await db.delete(songs).where(eq(songs.id, songId)).catch(() => {});
    }
    for (const jobId of createdJobIds) {
      await db.delete(backgroundJobs).where(eq(backgroundJobs.id, jobId)).catch(() => {});
    }

    await db.delete(users).where(eq(users.id, userAId)).catch(() => {});
    await db.delete(users).where(eq(users.id, userBId)).catch(() => {});
    await db.delete(users).where(eq(users.id, adminId)).catch(() => {});
  });

  // =========================================================================
  // WORKSTREAM A: Universal Source Preservation Independently of Format
  // =========================================================================
  describe('Workstream A: Universal Source Preservation Independently of Format', () => {
    it('A1.1: should preserve original MusicXML bytes and create a complete song_sources record before parsing', async () => {
      const musicXmlContent = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="3.1">
  <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>1</divisions>
        <key><fifths>0</fifths></key>
        <time><beats>4</beats><beat-type>4</beat-type></time>
      </attributes>
      <direction><sound tempo="120"/></direction>
      <note>
        <pitch><step>C</step><octave>4</octave></pitch>
        <duration>4</duration>
        <type>whole</type>
      </note>
    </measure>
  </part>
</score-partwise>`;

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/ingestion/upload',
        headers: { authorization: `Bearer ${userAToken}` },
        payload: {
          filename: 'preservation_test.musicxml',
          rawText: musicXmlContent,
          title: 'Himno de Preservación',
        },
      });

      assert.equal(res.statusCode, 201);
      const body = res.json();
      assert.ok(body.sourceId);
      createdSourceIds.add(body.sourceId);
      if (body.songId) createdSongIds.add(body.songId);

      // Consultar registro song_sources directamente en BD
      const [sourceRow] = await db
        .select()
        .from(songSources)
        .where(eq(songSources.id, body.sourceId))
        .limit(1);

      assert.ok(sourceRow);
      assert.equal(sourceRow.userId, userAId);
      assert.ok(sourceRow.storagePath);
      assert.ok(sourceRow.fileSizeBytes && sourceRow.fileSizeBytes > 0);
      assert.ok(sourceRow.checksumSha256);
      assert.equal(
        sourceRow.checksumSha256,
        crypto.createHash('sha256').update(Buffer.from(musicXmlContent, 'utf-8')).digest('hex')
      );
      assert.ok(sourceRow.importerName && sourceRow.importerName.includes('MusicXML'));
    });

    it('A1.2: should stream original file bytes byte-for-byte with correct headers via GET /sources/:id/file', async () => {
      const rawText = `{title: Canto de Gloria}
{key: G}
{time: 4/4}
[G]Gloria a [C]Dios en las [D]alturas`;

      const uploadRes = await app.inject({
        method: 'POST',
        url: '/api/v1/ingestion/upload',
        headers: { authorization: `Bearer ${userAToken}` },
        payload: {
          filename: 'gloria.cho',
          rawText,
        },
      });

      assert.equal(uploadRes.statusCode, 201);
      const uploadBody = uploadRes.json();
      const sourceId = uploadBody.sourceId;
      assert.ok(sourceId);
      createdSourceIds.add(sourceId);
      if (uploadBody.songId) createdSongIds.add(uploadBody.songId);

      // Descargar archivo binario
      const fileRes = await app.inject({
        method: 'GET',
        url: `/api/v1/ingestion/sources/${sourceId}/file`,
        headers: { authorization: `Bearer ${userAToken}` },
      });

      assert.equal(fileRes.statusCode, 200);
      assert.ok(fileRes.headers['content-type']);
      assert.ok(fileRes.headers['content-disposition']?.includes('gloria.cho'));
      const expectedHash = crypto.createHash('sha256').update(Buffer.from(rawText, 'utf-8')).digest('hex');
      assert.equal(fileRes.headers['x-checksum-sha256'], expectedHash);
      assert.equal(fileRes.body, rawText);
    });

    it('A1.3: should fail ingestion and mark job FAILED if physical storage fails (fail-safe)', async () => {
      const failingStorage = {
        save: async () => {
          throw new Error('Disco lleno o permiso denegado en volumen físico de almacenamiento.');
        },
        getBuffer: async () => Buffer.alloc(0),
        exists: async () => false,
        delete: async () => false,
        resolveSafePath: () => '/dev/null',
      };

      const songRepo = new DrizzleSongRepository();
      const versionRepo = new DrizzleSongVersionRepository();
      const songService = new SongService(songRepo, versionRepo);
      const service = new UniversalIngestionService(songService, failingStorage);

      await assert.rejects(
        async () => {
          await service.ingest(
            {
              filename: 'test_failing_storage.mid',
              buffer: Buffer.from('MThd\0\0\0\x06\0\0\0\x01\x01\xe0MTrk\0\0\0\x04\0\xff/\0'),
            },
            testUserA
          );
        },
        (err: any) => {
          assert.ok(err instanceof PersistenceError);
          assert.ok(err.message.includes('almacenar el archivo fuente original'));
          return true;
        }
      );
    });
  });

  // =========================================================================
  // WORKSTREAM B: Musical Metadata Integrity (Zero Guessing)
  // =========================================================================
  describe('Workstream B: Musical Metadata Integrity (Zero Guessing)', () => {
    it('B1.1: should report defaultBpm as null when tempo is absent in MIDI (no fake 120 BPM)', () => {
      // Archivo MIDI válido de 1 compás pero SIN evento de tempo (0xFF 0x51)
      const division = 480;
      const header = buildMidiHeader(0, 1, division);
      const events: number[] = [
        0x00, 0x90, 60, 100, // Note On C4
        ...writeVLQ(480), 0x80, 60, 64, // Note Off C4
        0x00, 0xff, 0x2f, 0x00, // End of Track
      ];
      const track = buildMidiTrack(events);
      const midiBuf = Buffer.concat([header, track]);

      const parsed = MidiParser.parse(midiBuf);
      assert.equal(parsed.defaultBpm, null, 'El tempo debe ser estrictamente null cuando no está declarado');
      assert.equal(parsed.defaultKey, null, 'La tonalidad debe ser null cuando no está declarada');
    });

    it('B1.2: should report defaultKey and timeSignature as null when absent in MusicXML (no fake C or 4/4)', async () => {
      const xmlWithoutKeyOrMeter = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="3.1">
  <part-list><score-part id="P1"><part-name>Voz</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>1</divisions>
      </attributes>
      <note>
        <pitch><step>D</step><octave>4</octave></pitch>
        <duration>1</duration>
        <type>quarter</type>
      </note>
    </measure>
  </part>
</score-partwise>`;

      const adapter = new MusicXmlIngestionAdapter();
      const output = await adapter.ingest(
        {
          sourceType: 'MUSICXML',
          rawText: xmlWithoutKeyOrMeter,
          filename: 'sin_metadatos.xml',
        },
        testUserA
      );

      assert.equal(output.defaultKey, null, 'defaultKey debe ser null sin <key>');
      assert.equal(output.timeSignature, null, 'timeSignature debe ser null sin <time>');
      assert.equal(output.defaultBpm, null, 'defaultBpm debe ser null sin tempo');
      assert.ok(output.diagnostics.some((d) => d.code === 'MISSING_KEY_SIGNATURE'));
      assert.ok(output.diagnostics.some((d) => d.code === 'MISSING_TIME_SIGNATURE'));
      assert.ok(output.diagnostics.some((d) => d.code === 'MISSING_TEMPO'));
      assert.equal(output.status, 'PARTIALLY_CONVERTED');
    });

    it('B1.3: should maintain LeadSheet invariant: ZERO notes generated for pure chord charts (ChordPro)', async () => {
      const chordProText = `{title: Santo es el Señor}
{key: E}
{time: 4/4}
[E]Santo, [B]Santo, [C#m]Santo es el [A]Señor`;

      const adapter = new ChordProIngestionAdapter();
      const output = await adapter.ingest(
        {
          sourceType: 'CHORDPRO',
          rawText: chordProText,
        },
        testUserA
      );

      assert.ok(output.defaultKey === 'E' || output.defaultKey === 'E Mayor');
      assert.equal(output.timeSignature, '4/4');
      assert.equal(output.defaultBpm, null, 'Tempo debe ser null al no tener directiva {tempo}');
      assert.ok(output.canonicalPayload);
      const totalNotes = output.canonicalPayload.measures.reduce(
        (acc, m) =>
          acc +
          m.voices.reduce(
            (vAcc, v) => vAcc + v.events.filter((e) => e.type === 'NOTE').length,
            0
          ),
        0
      );
      assert.equal(totalNotes, 0, 'Invariante LeadSheet: totalNotes debe ser exactamente 0');
    });

    it('B1.4: should distinguish between explicit user metadata and missing metadata in written notes', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/ingestion/written-notes',
        headers: { authorization: `Bearer ${userAToken}` },
        payload: {
          title: 'Melodía con Metadatos Explícitos',
          keySignature: 'F#m',
          timeSignature: { numerator: 3, denominator: 4 },
          tempoBpm: 84,
          measures: [
            {
              measureNumber: 1,
              notes: [
                { step: 'A', octave: 4, duration: 'quarter' },
                { step: 'B', octave: 4, duration: 'half' },
              ],
            },
          ],
        },
      });

      assert.equal(res.statusCode, 201);
      const body = res.json();
      assert.ok(body.defaultKey === 'F#m' || body.defaultKey === 'F# menor', 'La tonalidad declarada debe preservarse');
      assert.equal(body.timeSignature, '3/4', 'El compás declarado debe preservarse');
      assert.equal(body.defaultBpm, 84, 'El tempo declarado debe preservarse');
      assert.equal(body.status, 'CONVERTED');
      if (body.songId) createdSongIds.add(body.songId);
      if (body.sourceId) createdSourceIds.add(body.sourceId);
    });
  });

  // =========================================================================
  // WORKSTREAM C: MIDI Robustness, Running Status & Tied Notes
  // =========================================================================
  describe('Workstream C: MIDI Processing Correctness & Non-Destructive Quantization', () => {
    it('C1.1: should split notes crossing measure boundaries into tied notes without duration truncation', async () => {
      // 4/4 con division = 480 -> Cada compás dura 1920 ticks.
      // Una nota de 2400 ticks iniciada en el tick 960 (mitad del compás 1):
      // Compás 1 (960..1920): 960 ticks (tie: START)
      // Compás 2 (1920..3360): 1440 ticks (tie: STOP)
      // Duración total exacta: 960 + 1440 = 2400 ticks (CERO truncación).
      const division = 480;
      const header = buildMidiHeader(0, 1, division);
      const events: number[] = [
        // Time signature 4/4
        0x00, 0xff, 0x58, 0x04, 0x04, 0x02, 0x18, 0x08,
        // Tempo 120 BPM
        0x00, 0xff, 0x51, 0x03, 0x07, 0xa1, 0x20,
        // Nota inicia en tick 960
        ...writeVLQ(960), 0x90, 60, 100, // C4 on
        // Nota termina en tick 3360 (delta 2400 ticks)
        ...writeVLQ(2400), 0x80, 60, 64, // C4 off
        0x00, 0xff, 0x2f, 0x00,
      ];
      const track = buildMidiTrack(events);
      const midiBuf = Buffer.concat([header, track]);

      const adapter = new MidiIngestionAdapter();
      const output = await adapter.ingest(
        {
          sourceType: 'MIDI',
          buffer: midiBuf,
          filename: 'tied_note_test.mid',
        },
        testUserA
      );

      assert.ok(output.canonicalPayload);
      const measures = output.canonicalPayload.measures;
      assert.ok(measures.length >= 2, 'Debe haber generado al menos 2 compases');

      // Buscar notas en compás 1 y compás 2
      const m1Notes = (measures[0].voices[0]?.events.filter((e) => e.type === 'NOTE') ?? []) as any[];
      const m2Notes = (measures[1].voices[0]?.events.filter((e) => e.type === 'NOTE') ?? []) as any[];

      assert.equal(m1Notes.length, 1, 'Compás 1 debe tener el segmento inicial');
      assert.equal(m2Notes.length, 1, 'Compás 2 debe tener el segmento final');

      assert.equal((m1Notes[0] as any).tie, 'START');
      assert.equal((m2Notes[0] as any).tie, 'STOP');

      const totalTiedDuration = m1Notes[0].durationTicks + m2Notes[0].durationTicks;
      assert.equal(totalTiedDuration, 2400, 'La duración acumulada debe ser exactamente 2400 ticks (CERO truncación)');
    });

    it('C1.2: should preserve 1-tick ultra-short note without clamping to arbitrary 15 ticks', async () => {
      const division = 480;
      const header = buildMidiHeader(0, 1, division);
      const events: number[] = [
        0x00, 0x90, 64, 100, // E4 on
        ...writeVLQ(1), 0x80, 64, 64, // E4 off tras 1 tick
        0x00, 0xff, 0x2f, 0x00,
      ];
      const track = buildMidiTrack(events);
      const midiBuf = Buffer.concat([header, track]);

      const parsed = MidiParser.parse(midiBuf);
      assert.equal(parsed.tracks[0].notes[0].durationTicksCanonical, 1, 'Debe conservar 1 tick exacto');
    });

    it('C1.3: should handle unmatched Note-On at end of track without inventing an arbitrary quarter note', async () => {
      // Note-On sin Note-Off correspondiente antes de End-Of-Track
      const division = 480;
      const header = buildMidiHeader(0, 1, division);
      const events: number[] = [
        0x00, 0x90, 67, 100, // G4 on en tick 0
        ...writeVLQ(100), 0xff, 0x2f, 0x00, // End of Track en tick 100
      ];
      const track = buildMidiTrack(events);
      const midiBuf = Buffer.concat([header, track]);

      const parsed = MidiParser.parse(midiBuf);
      assert.equal(parsed.tracks[0].notes[0].durationTicksCanonical, 100, 'La duración debe extenderse hasta el final real del track');
      assert.ok(parsed.diagnostics.some((d) => d.code === 'UNMATCHED_NOTE_ON'));
    });

    it('C1.4: should cancel running status upon encountering a meta-event or SysEx', () => {
      const division = 480;
      const header = buildMidiHeader(0, 1, division);
      const events: number[] = [
        0x00, 0x90, 60, 100, // Note On (status = 0x90)
        // Meta-event (debe cancelar running status)
        0x00, 0xff, 0x01, 0x04, 0x54, 0x65, 0x73, 0x74, // Text: "Test"
        // Si el siguiente byte intenta usar running status sin status byte, debe lanzar error
        0x10, 62, 100,
        0x00, 0xff, 0x2f, 0x00,
      ];
      const track = buildMidiTrack(events);
      const midiBuf = Buffer.concat([header, track]);

      assert.throws(
        () => {
          MidiParser.parse(midiBuf);
        },
        (err: any) => {
          assert.ok(err instanceof ValidationError);
          assert.ok(
            err.message.includes('Running status MIDI inválido') ||
            err.message.includes('running status') ||
            err.message.includes('status previo')
          );
          return true;
        }
      );
    });

    it('C1.5: should reject malformed VLQ exceeding 4 bytes / 28 bits with ValidationError', () => {
      // 5 bytes con bit 7 encendido (overflow de VLQ)
      const division = 480;
      const header = buildMidiHeader(0, 1, division);
      const events: number[] = [
        0x81, 0x81, 0x81, 0x81, 0x01, 0x90, 60, 100,
        0x00, 0xff, 0x2f, 0x00,
      ];
      const track = buildMidiTrack(events);
      const midiBuf = Buffer.concat([header, track]);

      assert.throws(
        () => {
          MidiParser.parse(midiBuf);
        },
        (err: any) => {
          assert.ok(err instanceof ValidationError);
          assert.ok(err.message.includes('Desbordamiento de VLQ') || err.message.includes('4 bytes'));
          return true;
        }
      );
    });
  });

  // =========================================================================
  // WORKSTREAM D: Content-Based Binary Validation & Video URL SSRF Defense
  // =========================================================================
  describe('Workstream D: Content-Based Binary Validation & Video URL SSRF Defense', () => {
    it('D1.1: should reject executable payload disguised as audio/wav (Magic Bytes inspection)', async () => {
      // Binario con cabecera de ejecutable Windows MZ (0x4D, 0x5A)
      const executableDisguised = Buffer.alloc(1024);
      executableDisguised[0] = 0x4d;
      executableDisguised[1] = 0x5a;
      executableDisguised[2] = 0x90;
      executableDisguised[3] = 0x00;

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/ingestion/upload',
        headers: { authorization: `Bearer ${userAToken}` },
        payload: {
          filename: 'pista_worship.wav',
          mimeType: 'audio/wav',
          dataBase64: executableDisguised.toString('base64'),
        },
      });

      assert.equal(res.statusCode, 400);
      const body = res.json();
      assert.ok(
        (body.message && body.message.includes('Firma binaria de audio no reconocida')) ||
        (body.error && typeof body.error === 'string' && body.error.includes('Bad Request'))
      );
    });

    it('D1.2: should register video URL with status REGISTERED and canonicalPayload null (ZERO fake score)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/ingestion/video-url',
        headers: { authorization: `Bearer ${userAToken}` },
        payload: {
          videoUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
          title: 'Referencia Rick',
        },
      });

      assert.equal(res.statusCode, 201);
      const body = res.json();
      assert.equal(body.sourceType, 'VIDEO_URL');
      assert.equal(body.status, 'REGISTERED');
      assert.equal(body.canonicalPayload, null, 'No debe inventar partitura canónica vacía');
      assert.equal(body.defaultKey, null);
      assert.equal(body.defaultBpm, null);
      assert.equal(body.timeSignature, null);
      assert.ok(body.sourceId);
      createdSourceIds.add(body.sourceId);
    });

    it('D1.3: should strictly reject SSRF attempts to 127.0.0.1, localhost and cloud metadata', () => {
      const maliciousUrls = [
        'http://127.0.0.1:8080/secret',
        'http://localhost/admin',
        'http://169.254.169.254/latest/meta-data/',
        'http://10.0.0.1/internal',
        'http://192.168.1.1/router',
        'https://attacker-domain.org/video',
      ];

      for (const url of maliciousUrls) {
        assert.throws(
          () => {
            VideoUrlIngestionAdapter.validateVideoUrl(url);
          },
          (err: any) => {
            assert.ok(err instanceof ValidationError);
            return true;
          },
          `La URL ${url} debió ser bloqueada por las defensas SSRF`
        );
      }
    });
  });

  // =========================================================================
  // WORKSTREAM E: Multi-Tenant Boundaries & Ownership Enforcement
  // =========================================================================
  describe('Workstream E: Multi-Tenant Boundaries & Ownership Enforcement', () => {
    it('E1.1: should isolate duplicate uploads per user: User B uploading the same file gets their OWN song', async () => {
      const sharedXml = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="3.1">
  <part-list><score-part id="P1"><part-name>Flauta</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes><divisions>1</divisions><key><fifths>2</fifths></key><time><beats>3</beats><beat-type>4</beat-type></time></attributes>
      <direction><sound tempo="90"/></direction>
      <note><pitch><step>D</step><octave>4</octave></pitch><duration>3</duration><type>half</type><dot/></note>
    </measure>
  </part>
</score-partwise>`;

      // 1. User A sube el archivo
      const resA = await app.inject({
        method: 'POST',
        url: '/api/v1/ingestion/upload',
        headers: { authorization: `Bearer ${userAToken}` },
        payload: {
          filename: 'shared_score.xml',
          rawText: sharedXml,
          title: 'Canción de User A',
        },
      });

      assert.equal(resA.statusCode, 201);
      const bodyA = resA.json();
      assert.ok(bodyA.songId);
      assert.ok(bodyA.sourceId);
      createdSongIds.add(bodyA.songId);
      createdSourceIds.add(bodyA.sourceId);

      // 2. User B sube EXACTAMENTE el mismo archivo
      const resB = await app.inject({
        method: 'POST',
        url: '/api/v1/ingestion/upload',
        headers: { authorization: `Bearer ${userBToken}` },
        payload: {
          filename: 'shared_score.xml',
          rawText: sharedXml,
          title: 'Canción de User B',
        },
      });

      assert.equal(resB.statusCode, 201);
      const bodyB = resB.json();
      assert.ok(bodyB.songId);
      assert.ok(bodyB.sourceId);
      createdSongIds.add(bodyB.songId);
      createdSourceIds.add(bodyB.sourceId);

      // Multi-tenant boundary assertion:
      assert.notEqual(
        bodyB.songId,
        bodyA.songId,
        'Violación de Multi-Tenancy: User B NO debe recibir la canción de User A'
      );
      assert.notEqual(
        bodyB.sourceId,
        bodyA.sourceId,
        'Violación de Multi-Tenancy: User B debe tener su propio registro de fuente'
      );

      // 3. User A re-sube el mismo archivo -> Idempotencia para el MISMO usuario
      const resA2 = await app.inject({
        method: 'POST',
        url: '/api/v1/ingestion/upload',
        headers: { authorization: `Bearer ${userAToken}` },
        payload: {
          filename: 'shared_score.xml',
          rawText: sharedXml,
        },
      });

      assert.equal(resA2.statusCode, 201);
      const bodyA2 = resA2.json();
      assert.equal(bodyA2.songId, bodyA.songId, 'Idempotencia: User A debe recibir su propia canción previa');
      assert.ok(bodyA2.diagnostics.some((d: any) => d.code === 'IDEMPOTENT_IMPORT_REUSED'));
    });

    it('E1.2: should reject cross-user access to source metadata with 403 Forbidden (IDOR prevention)', async () => {
      // User A crea una fuente
      const resA = await app.inject({
        method: 'POST',
        url: '/api/v1/ingestion/upload',
        headers: { authorization: `Bearer ${userAToken}` },
        payload: {
          filename: 'privada_user_a.cho',
          rawText: '{title: Privada}\n[C]Nota secreta',
        },
      });

      const sourceId = resA.json().sourceId;
      assert.ok(sourceId);
      createdSourceIds.add(sourceId);
      if (resA.json().songId) createdSongIds.add(resA.json().songId);

      // User B intenta consultar los metadatos de la fuente de User A
      const resB = await app.inject({
        method: 'GET',
        url: `/api/v1/ingestion/sources/${sourceId}`,
        headers: { authorization: `Bearer ${userBToken}` },
      });

      assert.equal(resB.statusCode, 403, 'User B debe recibir 403 Forbidden');
    });

    it('E1.3: should reject cross-user download of source file with 403 Forbidden (IDOR prevention)', async () => {
      // User A crea una fuente
      const resA = await app.inject({
        method: 'POST',
        url: '/api/v1/ingestion/upload',
        headers: { authorization: `Bearer ${userAToken}` },
        payload: {
          filename: 'archivo_protegido.cho',
          rawText: '{title: Archivo Protegido}\n[D]Confidencial',
        },
      });

      const sourceId = resA.json().sourceId;
      assert.ok(sourceId);
      createdSourceIds.add(sourceId);
      if (resA.json().songId) createdSongIds.add(resA.json().songId);

      // User B intenta descargar el archivo original de User A
      const resB = await app.inject({
        method: 'GET',
        url: `/api/v1/ingestion/sources/${sourceId}/file`,
        headers: { authorization: `Bearer ${userBToken}` },
      });

      assert.equal(resB.statusCode, 403, 'User B no debe poder descargar el archivo de User A');
    });

    it('E1.4: should allow ADMIN role to query any source (Privileged Access)', async () => {
      const resA = await app.inject({
        method: 'POST',
        url: '/api/v1/ingestion/upload',
        headers: { authorization: `Bearer ${userAToken}` },
        payload: {
          filename: 'fuente_para_admin.cho',
          rawText: '{title: Auditoría}\n[A]Acorde',
        },
      });

      const sourceId = resA.json().sourceId;
      assert.ok(sourceId);
      createdSourceIds.add(sourceId);
      if (resA.json().songId) createdSongIds.add(resA.json().songId);

      // Admin consulta la fuente de User A
      const resAdmin = await app.inject({
        method: 'GET',
        url: `/api/v1/ingestion/sources/${sourceId}`,
        headers: { authorization: `Bearer ${adminToken}` },
      });

      assert.equal(resAdmin.statusCode, 200, 'Admin debe poder acceder');
      assert.equal(resAdmin.json().id, sourceId);
    });
  });

  // =========================================================================
  // WORKSTREAM F: Background Job Transparency
  // =========================================================================
  describe('Workstream F: Background Job Transparency', () => {
    it('F1.1: should populate background_jobs with non-null userId and track COMPLETED status', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/ingestion/upload',
        headers: { authorization: `Bearer ${userAToken}` },
        payload: {
          filename: 'job_track_test.cho',
          rawText: '{title: Trazabilidad}\n[G]Trazable',
        },
      });

      assert.equal(res.statusCode, 201);
      const body = res.json();
      assert.ok(body.sourceId);
      createdSourceIds.add(body.sourceId);
      if (body.songId) createdSongIds.add(body.songId);

      // Obtener el jobId desde songSources
      const [sourceRow] = await db
        .select()
        .from(songSources)
        .where(eq(songSources.id, body.sourceId))
        .limit(1);

      assert.ok(sourceRow);
      assert.ok(sourceRow.jobId);
      createdJobIds.add(sourceRow.jobId);

      // Consultar endpoint de tarea
      const jobRes = await app.inject({
        method: 'GET',
        url: `/api/v1/ingestion/jobs/${sourceRow.jobId}`,
        headers: { authorization: `Bearer ${userAToken}` },
      });

      assert.equal(jobRes.statusCode, 200);
      const job = jobRes.json();
      assert.equal(job.status, 'COMPLETED');
      assert.equal(job.progress, 100);
      assert.equal(job.outputRef, body.songId);
      assert.ok(job.completedAt);
    });
  });
});
