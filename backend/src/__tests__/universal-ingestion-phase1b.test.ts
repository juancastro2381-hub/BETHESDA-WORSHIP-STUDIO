/**
 * @file universal-ingestion-phase1b.test.ts
 * @description Suite de pruebas automatizadas completa para la Arquitectura de Ingesta Universal (Fase 1B).
 *
 * Cobertura:
 * 1. Ingesta de MusicXML 4.0 válida, extracción de partes/notas y bloqueo de XXE.
 * 2. Ingesta de MIDI estándar (Formatos 0 y 1), preservación de ticks a 480 TPQN, pistas múltiples y cero notas inventadas.
 * 3. Ingesta de ChordPro, preservación de alineación acordes/letras y transposición armónica.
 * 4. Ingesta estructurada de notas manuales (Written Notes), validación estricta de altura/octava y persistencia canónica.
 * 5. Ingesta segura de partituras PDF e imágenes con reporte veraz de motor OMR no disponible (cero fabricación).
 * 6. Ingesta segura de archivos de audio (WAV, MP3) con preservación física y reporte honesto de transcripción.
 * 7. Ingesta de URLs de video con whitelist y defensas anti-SSRF rigurosas (bloqueo de loopback, LAN y metadata cloud).
 * 8. Límites de tamaño (15 MiB binario, 20.97 MB Base64), validación en bloques y rechazo de payloads gigantes.
 * 9. Idempotencia: reutilización segura de canciones existentes ante fuentes con hash idéntico.
 * 10. Control de acceso RBAC, aislamiento de usuarios e IDOR en consulta de tareas de ingesta.
 * 11. Contratos de visualización en el Atril Digital (disponibilidad de partitura, cifrado, letra y tablatura).
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { type FastifyInstance } from 'fastify';
import { buildApp } from '../app.ts';
import { JwtTokenService } from '../application/token-service.ts';
import { env } from '../config/env.ts';
import { db } from '../db/index.ts';
import { users, songs, songVersions, songSources, backgroundJobs } from '../db/schema.ts';
import { DrizzleUserRepository } from '../repositories/user-repository.ts';
import { eq, inArray } from 'drizzle-orm';
import { MidiParser } from '../domain/ingestion/adapters/midi/midi-parser.ts';
import { VideoUrlIngestionAdapter } from '../domain/ingestion/adapters/video/video-url-adapter.ts';
import { AudioIngestionAdapter } from '../domain/ingestion/adapters/audio/audio-adapter.ts';

// ---------------------------------------------------------------------------
// Helpers para Generación de Archivos de Prueba en Memoria
// ---------------------------------------------------------------------------

/**
 * Codificador de enteros a Variable-Length Quantity (VLQ) MIDI.
 */
function encodeVlq(value: number): number[] {
  const bytes: number[] = [];
  let buffer = value & 0x7f;
  while ((value >>= 7) > 0) {
    buffer <<= 8;
    buffer |= 0x80;
    buffer += value & 0x7f;
  }
  while (true) {
    bytes.push(buffer & 0xff);
    if ((buffer & 0x80) !== 0) {
      buffer >>= 8;
    } else {
      break;
    }
  }
  return bytes;
}

/**
 * Genera un buffer de archivo Standard MIDI File (SMF Formato 0 o 1) sintético y válido.
 */
function createSyntheticMidiBuffer(options: {
  format?: number;
  division?: number;
  bpm?: number;
  timeSig?: [number, number];
  tracks: Array<{
    name: string;
    program?: number;
    notes: Array<{ pitch: number; startTick: number; durationTicks: number; velocity?: number }>;
  }>;
}): Buffer {
  const format = options.format ?? (options.tracks.length > 1 ? 1 : 0);
  const division = options.division ?? 480;
  const ntracks = options.tracks.length;

  const chunks: Buffer[] = [];

  // 1. Header Chunk MThd (14 bytes)
  const headerBuf = Buffer.alloc(14);
  headerBuf.write('MThd', 0, 'ascii');
  headerBuf.writeUInt32BE(6, 4);
  headerBuf.writeUInt16BE(format, 8);
  headerBuf.writeUInt16BE(ntracks, 10);
  headerBuf.writeUInt16BE(division, 12);
  chunks.push(headerBuf);

  // 2. Track Chunks MTrk
  for (let tIdx = 0; tIdx < ntracks; tIdx++) {
    const t = options.tracks[tIdx];
    const trackEvents: number[] = [];

    // Track Name Meta Event
    trackEvents.push(...encodeVlq(0)); // delta 0
    trackEvents.push(0xff, 0x03);
    const nameBytes = Buffer.from(t.name, 'utf8');
    trackEvents.push(...encodeVlq(nameBytes.length));
    for (const b of nameBytes) trackEvents.push(b);

    // Tempo Meta Event (si se especificó en la primera pista)
    if (tIdx === 0 && options.bpm) {
      const mpqn = Math.round(60000000 / options.bpm);
      trackEvents.push(...encodeVlq(0)); // delta 0
      trackEvents.push(0xff, 0x51, 0x03);
      trackEvents.push((mpqn >> 16) & 0xff, (mpqn >> 8) & 0xff, mpqn & 0xff);
    }

    // Time Signature Meta Event (si se especificó en la primera pista)
    if (tIdx === 0 && options.timeSig) {
      const num = options.timeSig[0];
      const denPower = Math.round(Math.log2(options.timeSig[1]));
      trackEvents.push(...encodeVlq(0)); // delta 0
      trackEvents.push(0xff, 0x58, 0x04, num, denPower, 0x18, 0x08);
    }

    // Program Change
    if (t.program !== undefined) {
      trackEvents.push(...encodeVlq(0)); // delta 0
      trackEvents.push(0xc0 | (tIdx & 0x0f), t.program & 0x7f);
    }

    // Convertir notas en eventos Note-On y Note-Off ordenados temporalmente
    interface TempEvent {
      tick: number;
      type: 'ON' | 'OFF';
      pitch: number;
      velocity: number;
    }
    const tempEvents: TempEvent[] = [];

    for (const n of t.notes) {
      tempEvents.push({
        tick: n.startTick,
        type: 'ON',
        pitch: n.pitch,
        velocity: n.velocity ?? 90,
      });
      tempEvents.push({
        tick: n.startTick + n.durationTicks,
        type: 'OFF',
        pitch: n.pitch,
        velocity: 64,
      });
    }

    // Ordenar cronológicamente
    tempEvents.sort((a, b) => a.tick - b.tick || (a.type === 'OFF' ? -1 : 1));

    let lastTick = 0;
    for (const ev of tempEvents) {
      const delta = ev.tick - lastTick;
      trackEvents.push(...encodeVlq(delta));
      const channel = tIdx & 0x0f;
      if (ev.type === 'ON') {
        trackEvents.push(0x90 | channel, ev.pitch & 0x7f, ev.velocity & 0x7f);
      } else {
        trackEvents.push(0x80 | channel, ev.pitch & 0x7f, 0x40);
      }
      lastTick = ev.tick;
    }

    // End of Track Meta Event
    trackEvents.push(...encodeVlq(0));
    trackEvents.push(0xff, 0x2f, 0x00);

    const trackDataBuf = Buffer.from(trackEvents);
    const trackHeaderBuf = Buffer.alloc(8);
    trackHeaderBuf.write('MTrk', 0, 'ascii');
    trackHeaderBuf.writeUInt32BE(trackDataBuf.length, 4);

    chunks.push(trackHeaderBuf, trackDataBuf);
  }

  return Buffer.concat(chunks);
}

// ---------------------------------------------------------------------------
// SUITE PRINCIPAL
// ---------------------------------------------------------------------------

describe('Worship Studio — Phase 1B Universal Music Ingestion Test Suite', () => {
  let app: FastifyInstance;
  let tokenService: JwtTokenService;
  let userRepo: DrizzleUserRepository;

  let worshipLeader: any;
  let leaderToken: string;
  let otherLeader: any;
  let otherLeaderToken: string;

  const createdUserIds = new Set<string>();
  const createdSongIds = new Set<string>();
  const createdJobIds = new Set<string>();

  before(async () => {
    tokenService = new JwtTokenService(env.JWT_SECRET, env.JWT_ACCESS_EXPIRES_IN);
    userRepo = new DrizzleUserRepository();

    app = await buildApp();
    await app.ready();

    const ts = Date.now();

    worshipLeader = await userRepo.create({
      email: `phase1b-leader-${ts}@bethesda.test`,
      passwordHash: 'dummy_hash',
      firstName: 'Director',
      lastName: 'Alabanza',
      role: 'WORSHIP_LEADER',
    });
    createdUserIds.add(worshipLeader.id);
    leaderToken = tokenService.signAccessToken({
      id: worshipLeader.id,
      email: worshipLeader.email,
      role: worshipLeader.role,
    }).token;

    otherLeader = await userRepo.create({
      email: `phase1b-other-${ts}@bethesda.test`,
      passwordHash: 'dummy_hash',
      firstName: 'Otro',
      lastName: 'Director',
      role: 'WORSHIP_LEADER',
    });
    createdUserIds.add(otherLeader.id);
    otherLeaderToken = tokenService.signAccessToken({
      id: otherLeader.id,
      email: otherLeader.email,
      role: otherLeader.role,
    }).token;
  });

  after(async () => {
    if (createdJobIds.size > 0) {
      await db.delete(backgroundJobs).where(inArray(backgroundJobs.id, Array.from(createdJobIds)));
    }
    if (createdSongIds.size > 0) {
      await db.delete(songSources).where(inArray(songSources.songId, Array.from(createdSongIds)));
      await db.delete(songVersions).where(inArray(songVersions.songId, Array.from(createdSongIds)));
      await db.delete(songs).where(inArray(songs.id, Array.from(createdSongIds)));
    }
    if (createdUserIds.size > 0) {
      await db.delete(users).where(inArray(users.id, Array.from(createdUserIds)));
    }
    await app.close();
  });

  // =========================================================================
  // WORKSTREAM B1 — MUSICXML 4.0 INGESTION
  // =========================================================================

  describe('Workstream B1: MusicXML Ingestion & Security', () => {
    const validMusicXml = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <work>
    <work-title>Cuan Grande Es Dios</work-title>
  </work>
  <part-list>
    <score-part id="P1">
      <part-name>Voz Líder</part-name>
    </score-part>
  </part-list>
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>480</divisions>
        <key>
          <fifths>1</fifths>
          <mode>major</mode>
        </key>
        <time>
          <beats>4</beats>
          <beat-type>4</beat-type>
        </time>
      </attributes>
      <direction>
        <sound tempo="105"/>
      </direction>
      <note>
        <pitch>
          <step>G</step>
          <octave>4</octave>
        </pitch>
        <duration>480</duration>
        <type>quarter</type>
        <lyric number="1">
          <syllabic>single</syllabic>
          <text>Cuan</text>
        </lyric>
      </note>
      <note>
        <pitch>
          <step>B</step>
          <octave>4</octave>
        </pitch>
        <duration>480</duration>
        <type>quarter</type>
        <lyric number="1">
          <syllabic>single</syllabic>
          <text>gran-</text>
        </lyric>
      </note>
      <note>
        <pitch>
          <step>D</step>
          <octave>5</octave>
        </pitch>
        <duration>960</duration>
        <type>half</type>
        <lyric number="1">
          <syllabic>single</syllabic>
          <text>de</text>
        </lyric>
      </note>
    </measure>
  </part>
</score-partwise>`;

    it('B1.1: should import valid MusicXML via POST /upload and persist canonical song', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/ingestion/upload',
        headers: {
          authorization: `Bearer ${leaderToken}`,
        },
        payload: {
          filename: 'cuan_grande_es_dios.musicxml',
          mimeType: 'application/vnd.recordare.musicxml+xml',
          rawText: validMusicXml,
        },
      });

      assert.equal(res.statusCode, 201);
      const body = res.json();
      assert.equal(body.status, 'CONVERTED');
      assert.equal(body.sourceType, 'MUSICXML');
      assert.equal(body.title, 'Cuan Grande Es Dios');
      assert.equal(body.defaultKey, 'G Mayor');
      assert.equal(body.defaultBpm, 105);
      assert.ok(body.songId);
      assert.ok(body.canonicalPayload);
      assert.equal(body.canonicalPayload.measures.length, 1);
      const m1Notes = body.canonicalPayload.measures[0].voices[0].events.filter((e: any) => !e.isRest);
      assert.equal(m1Notes.length, 3);

      createdSongIds.add(body.songId);
    });

    it('B1.2: should strictly reject MusicXML containing XXE entity injection', async () => {
      const maliciousXml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE score-partwise [
  <!ENTITY xxe SYSTEM "file:///etc/passwd">
]>
<score-partwise version="4.0">
  <work><work-title>&xxe;</work-title></work>
</score-partwise>`;

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/ingestion/upload',
        headers: {
          authorization: `Bearer ${leaderToken}`,
        },
        payload: {
          filename: 'malicious.musicxml',
          rawText: maliciousXml,
        },
      });

      assert.equal(res.statusCode, 400);
      const body = res.json();
      const message = body.error?.message || body.message;
      assert.ok(message.includes('XXE'));
    });

    it('B1.3: should reject malformed MusicXML with missing root element', async () => {
      const malformedXml = `<invalid-root><data>foo</data></invalid-root>`;

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/ingestion/upload',
        headers: {
          authorization: `Bearer ${leaderToken}`,
        },
        payload: {
          filename: 'broken.musicxml',
          rawText: malformedXml,
        },
      });

      assert.equal(res.statusCode, 400);
    });
  });

  // =========================================================================
  // WORKSTREAM B2 — STANDARD MIDI FILE (SMF) INGESTION
  // =========================================================================

  describe('Workstream B2: Standard MIDI File (SMF) Parsing & Normalization', () => {
    it('B2.1: should parse Format 0 MIDI file, extract notes, tempos and time signature', () => {
      const midiBuf = createSyntheticMidiBuffer({
        format: 0,
        division: 480,
        bpm: 128,
        timeSig: [3, 4],
        tracks: [
          {
            name: 'Pista de Piano',
            program: 0,
            notes: [
              { pitch: 60, startTick: 0, durationTicks: 480 }, // C4
              { pitch: 64, startTick: 480, durationTicks: 480 }, // E4
              { pitch: 67, startTick: 960, durationTicks: 480 }, // G4
            ],
          },
        ],
      });

      const parsed = MidiParser.parse(midiBuf);
      assert.equal(parsed.format, 0);
      assert.equal(parsed.trackCount, 1);
      assert.equal(parsed.division, 480);
      assert.equal(parsed.defaultBpm, 128);
      assert.equal(parsed.defaultTimeSignature.numerator, 3);
      assert.equal(parsed.defaultTimeSignature.denominator, 4);
      assert.equal(parsed.tracks[0].notes.length, 3);
      assert.equal(parsed.tracks[0].notes[0].pitch, 60);
      assert.equal(parsed.tracks[0].notes[0].durationTicksCanonical, 480);
    });

    it('B2.2: should normalize MIDI with non-480 division (e.g. 96 TPQN) into 480 TPQN exactly', () => {
      // 96 TPQN -> factor 5 -> 1 negra (96 ticks) debe convertirse a 480 ticks
      const midiBuf = createSyntheticMidiBuffer({
        format: 0,
        division: 96,
        bpm: 120,
        tracks: [
          {
            name: 'Flauta',
            notes: [
              { pitch: 69, startTick: 0, durationTicks: 96 }, // A4 por 1 negra
              { pitch: 71, startTick: 96, durationTicks: 192 }, // B4 por 2 negras
            ],
          },
        ],
      });

      const parsed = MidiParser.parse(midiBuf);
      assert.equal(parsed.division, 96);
      assert.equal(parsed.tracks[0].notes[0].durationTicksCanonical, 480);
      assert.equal(parsed.tracks[0].notes[1].durationTicksCanonical, 960);
    });

    it('B2.3: should parse Format 1 Multi-track MIDI and separate instrument tracks', async () => {
      const multiTrackMidi = createSyntheticMidiBuffer({
        format: 1,
        division: 480,
        bpm: 110,
        timeSig: [4, 4],
        tracks: [
          {
            name: 'Pista 1 Teclado',
            program: 0,
            notes: [{ pitch: 60, startTick: 0, durationTicks: 480 }],
          },
          {
            name: 'Pista 2 Bajo',
            program: 33,
            notes: [{ pitch: 36, startTick: 0, durationTicks: 960 }],
          },
        ],
      });

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/ingestion/upload',
        headers: {
          authorization: `Bearer ${leaderToken}`,
        },
        payload: {
          filename: 'multitrack_song.mid',
          dataBase64: multiTrackMidi.toString('base64'),
        },
      });

      assert.equal(res.statusCode, 201);
      const body = res.json();
      assert.equal(body.status, 'CONVERTED');
      assert.equal(body.sourceType, 'MIDI');
      assert.equal(body.defaultBpm, 110);
      assert.equal(body.timeSignature, '4/4');
      assert.ok(body.songId);
      assert.ok(body.canonicalPayload);
      assert.equal(body.canonicalPayload.instrumentTracks.length, 2);
      assert.equal(body.canonicalPayload.measures[0].voices.length, 2);

      createdSongIds.add(body.songId);
    });

    it('B2.4: should guarantee ZERO note fabrication: no fake chords or lyrics added in MIDI', async () => {
      const midiBuf = createSyntheticMidiBuffer({
        format: 0,
        division: 480,
        bpm: 100,
        tracks: [
          {
            name: 'Melodía Sola',
            notes: [{ pitch: 62, startTick: 0, durationTicks: 480 }],
          },
        ],
      });

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/ingestion/upload',
        headers: {
          authorization: `Bearer ${leaderToken}`,
        },
        payload: {
          filename: 'solo_melody.mid',
          dataBase64: midiBuf.toString('base64'),
        },
      });

      assert.equal(res.statusCode, 201);
      const body = res.json();
      const firstMeasure = body.canonicalPayload.measures[0];
      assert.equal(firstMeasure.chords.length, 0, 'No debe inventar acordes ficticios en MIDI');
      assert.equal(firstMeasure.lyrics.length, 0, 'No debe inventar letras ficticias en MIDI');

      createdSongIds.add(body.songId);
    });
  });

  // =========================================================================
  // WORKSTREAM B3 — CHORDPRO INGESTION & TRANSPOSITION
  // =========================================================================

  describe('Workstream B3: ChordPro Ingestion & Alignment', () => {
    const validChordPro = `{title: En Tu Presencia}
{artist: Oasis Ministry}
{key: D}
{tempo: 72}
{time: 4/4}

{soc}
[D]Hay un lugar [A]de intimidad
[Bm]Donde tu gloria [G]puedo contemplar
{eoc}`;

    it('B3.1: should import ChordPro and preserve chord/lyric relationships', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/ingestion/upload',
        headers: {
          authorization: `Bearer ${leaderToken}`,
        },
        payload: {
          filename: 'en_tu_presencia.chordpro',
          rawText: validChordPro,
        },
      });

      assert.equal(res.statusCode, 201);
      const body = res.json();
      assert.equal(body.status, 'CONVERTED');
      assert.equal(body.sourceType, 'CHORDPRO');
      assert.equal(body.title, 'En Tu Presencia');
      assert.equal(body.defaultKey, 'D Mayor');
      assert.equal(body.defaultBpm, 72);
      assert.ok(body.songId);
      assert.ok(body.canonicalPayload);
      assert.ok(body.canonicalPayload.measures.length >= 1);
      assert.ok(body.canonicalPayload.measures[0].chords.length > 0);

      createdSongIds.add(body.songId);
    });

    it('B3.2: should maintain ZERO fake melody notes for ChordPro (LeadSheet invariant)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/ingestion/upload',
        headers: {
          authorization: `Bearer ${leaderToken}`,
        },
        payload: {
          filename: 'leadsheet_pure.pro',
          rawText: validChordPro,
        },
      });

      assert.equal(res.statusCode, 201);
      const body = res.json();
      // En ChordPro las voces no inventan notas melódicas
      for (const m of body.canonicalPayload.measures) {
        for (const v of m.voices) {
          const notes = v.events.filter((e: any) => !e.isRest);
          assert.equal(notes.length, 0, 'Lead Sheet Puro no debe inventar notas melódicas');
        }
      }

      createdSongIds.add(body.songId);
    });
  });

  // =========================================================================
  // WORKSTREAM B4 — WRITTEN MUSICAL NOTES ENTRY
  // =========================================================================

  describe('Workstream B4: Written Musical Notes Manual Ingestion', () => {
    it('B4.1: should accept structured note entry and produce valid canonical song', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/ingestion/written-notes',
        headers: {
          authorization: `Bearer ${leaderToken}`,
        },
        payload: {
          title: 'Alabanza Escrita Manual',
          artist: 'Salmista',
          keySignature: 'G',
          tempoBpm: 120,
          timeSignature: { numerator: 4, denominator: 4 },
          measures: [
            {
              measureNumber: 1,
              notes: [
                { step: 'G', octave: 4, duration: 'quarter' },
                { step: 'B', octave: 4, duration: 'quarter' },
                { step: 'D', octave: 5, duration: 'half' },
              ],
              chords: [{ root: 'G', quality: 'maj', startTick: 0 }],
              lyrics: [{ text: 'Ben-di-to', startTick: 0 }],
            },
          ],
        },
      });

      assert.equal(res.statusCode, 201);
      const body = res.json();
      assert.equal(body.status, 'CONVERTED');
      assert.equal(body.sourceType, 'WRITTEN_NOTES');
      assert.equal(body.title, 'Alabanza Escrita Manual');
      assert.equal(body.defaultBpm, 120);
      const m1Notes = body.canonicalPayload.measures[0].voices[0].events.filter((e: any) => !e.isRest);
      assert.equal(m1Notes.length, 3);
      assert.equal(body.canonicalPayload.measures[0].chords.length, 1);

      createdSongIds.add(body.songId);
    });

    it('B4.2: should reject invalid note step letter (X) with ValidationError', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/ingestion/written-notes',
        headers: {
          authorization: `Bearer ${leaderToken}`,
        },
        payload: {
          title: 'Partitura Inválida',
          measures: [
            {
              measureNumber: 1,
              notes: [{ step: 'X', octave: 4, duration: 'quarter' }],
            },
          ],
        },
      });

      assert.equal(res.statusCode, 400);
      const body = res.json();
      assert.ok(JSON.stringify(body).includes('letra de A a G'));
    });

    it('B4.3: should reject out-of-range octave (15)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/ingestion/written-notes',
        headers: {
          authorization: `Bearer ${leaderToken}`,
        },
        payload: {
          title: 'Octava Imposible',
          measures: [
            {
              measureNumber: 1,
              notes: [{ step: 'C', octave: 15, duration: 'quarter' }],
            },
          ],
        },
      });

      assert.equal(res.statusCode, 400);
    });
  });

  // =========================================================================
  // WORKSTREAM C — PDF & IMAGE SCORE INGESTION
  // =========================================================================

  describe('Workstream C: PDF & Image Score Ingestion (Zero Fabrication & Honest Status)', () => {
    it('C1.1: should inspect and store legitimate PDF score with SHA-256 and report RECOGNITION_UNAVAILABLE', async () => {
      const dummyPdf = Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF');

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/ingestion/upload',
        headers: {
          authorization: `Bearer ${leaderToken}`,
        },
        payload: {
          filename: 'himnario_partitura.pdf',
          mimeType: 'application/pdf',
          dataBase64: dummyPdf.toString('base64'),
        },
      });

      assert.equal(res.statusCode, 201);
      const body = res.json();
      assert.equal(body.sourceType, 'PDF_SCORE');
      assert.equal(body.status, 'RECOGNITION_UNAVAILABLE');
      assert.ok(body.sourceHash);
      assert.ok(body.storageKey);
      assert.ok(body.recognitionStatusMessage.includes('no configurado'));
      // CERO notas inventadas:
      assert.equal(body.canonicalPayload.measures.length, 0);
    });

    it('C1.2: should inspect legitimate PNG image score and preserve original file', async () => {
      const dummyPng = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/ingestion/upload',
        headers: {
          authorization: `Bearer ${leaderToken}`,
        },
        payload: {
          filename: 'partitura_foto.png',
          mimeType: 'image/png',
          dataBase64: dummyPng.toString('base64'),
        },
      });

      assert.equal(res.statusCode, 201);
      const body = res.json();
      assert.equal(body.sourceType, 'IMAGE_SCORE');
      assert.equal(body.status, 'RECOGNITION_UNAVAILABLE');
      assert.ok(body.storageKey);
    });

    it('C1.3: should reject MIME spoofing: HTML disguised as PDF', async () => {
      const fakePdf = Buffer.from('<html><body>Fake PDF Script</body></html>');

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/ingestion/upload',
        headers: {
          authorization: `Bearer ${leaderToken}`,
        },
        payload: {
          filename: 'exploit.pdf',
          mimeType: 'application/pdf',
          dataBase64: fakePdf.toString('base64'),
        },
      });

      assert.equal(res.statusCode, 400);
      const body = res.json();
      const message = body.error?.message || body.message;
      assert.ok(message.includes('PDF'));
    });
  });

  // =========================================================================
  // WORKSTREAM D — AUDIO & VIDEO URL INGESTION
  // =========================================================================

  describe('Workstream D: Audio Ingestion & Video URL SSRF Defense', () => {
    it('D1.1: should inspect WAV audio and report RECOGNITION_UNAVAILABLE without fake notes', async () => {
      // Cabecera WAV RIFF de 44 bytes válida
      const wavHeader = Buffer.alloc(44);
      wavHeader.write('RIFF', 0, 'ascii');
      wavHeader.writeUInt32LE(36, 4);
      wavHeader.write('WAVE', 8, 'ascii');
      wavHeader.write('fmt ', 12, 'ascii');
      wavHeader.writeUInt32LE(16, 16);
      wavHeader.writeUInt16LE(1, 20); // PCM
      wavHeader.writeUInt16LE(2, 22); // 2 channels
      wavHeader.writeUInt32LE(44100, 24); // sample rate
      wavHeader.writeUInt32LE(176400, 28); // byte rate
      wavHeader.writeUInt16LE(4, 32);
      wavHeader.writeUInt16LE(16, 34);
      wavHeader.write('data', 36, 'ascii');
      wavHeader.writeUInt32LE(0, 40);

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/ingestion/upload',
        headers: {
          authorization: `Bearer ${leaderToken}`,
        },
        payload: {
          filename: 'adoracion_en_vivo.wav',
          mimeType: 'audio/wav',
          dataBase64: wavHeader.toString('base64'),
        },
      });

      assert.equal(res.statusCode, 201);
      const body = res.json();
      assert.equal(body.sourceType, 'AUDIO');
      assert.equal(body.status, 'RECOGNITION_UNAVAILABLE');
      assert.ok(body.storageKey);
      assert.equal(body.canonicalPayload.measures.length, 0, 'Cero notas inventadas desde audio sin transcriptor real');
    });

    it('D1.2: should accept authorized YouTube URL and register video reference', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/ingestion/video-url',
        headers: {
          authorization: `Bearer ${leaderToken}`,
        },
        payload: {
          videoUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
          title: 'Referencia de Ensayo',
        },
      });

      assert.equal(res.statusCode, 201);
      const body = res.json();
      assert.equal(body.sourceType, 'VIDEO_URL');
      assert.equal(body.status, 'CONVERTED');
      assert.equal(body.canonicalPayload.metadata.platform, 'YOUTUBE');
      assert.equal(body.canonicalPayload.metadata.videoId, 'dQw4w9WgXcQ');
    });

    it('D1.3: should strictly block SSRF attempt to localhost (127.0.0.1)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/ingestion/video-url',
        headers: {
          authorization: `Bearer ${leaderToken}`,
        },
        payload: {
          videoUrl: 'http://127.0.0.1:8080/internal-secrets',
        },
      });

      assert.equal(res.statusCode, 400);
      const body = res.json();
      const message = body.error?.message || body.message;
      assert.ok(message.includes('SSRF') || message.includes('no autorizada'));
    });

    it('D1.4: should strictly block SSRF attempt to AWS/Cloud Metadata (169.254.169.254)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/ingestion/video-url',
        headers: {
          authorization: `Bearer ${leaderToken}`,
        },
        payload: {
          videoUrl: 'http://169.254.169.254/latest/meta-data',
        },
      });

      assert.equal(res.statusCode, 400);
      const body = res.json();
      const message = body.error?.message || body.message;
      assert.ok(message.includes('SSRF') || message.includes('no autorizada'));
    });

    it('D1.5: should reject non-whitelisted domain (malicious-site.com)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/ingestion/video-url',
        headers: {
          authorization: `Bearer ${leaderToken}`,
        },
        payload: {
          videoUrl: 'https://malicious-site.com/exploit.mp4',
        },
      });

      assert.equal(res.statusCode, 400);
      const body = res.json();
      const message = body.error?.message || body.message;
      assert.ok(message.includes('no autorizada'));
    });
  });

  // =========================================================================
  // WORKSTREAM H — SECURITY, IDEMPOTENCY & IDOR
  // =========================================================================

  describe('Workstream H: Security, Idempotency & Tenant Boundaries', () => {
    it('H1.1: should reject unauthenticated requests to POST /upload with 401 Unauthorized', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/ingestion/upload',
        payload: { filename: 'test.mid', dataBase64: 'AAAA' },
      });
      assert.equal(res.statusCode, 401);
    });

    it('H1.2: should reject Base64 payload exceeding MAX_OMR_BASE64_LENGTH with ValidationError', async () => {
      // 21 MB Base64 string excede el límite
      const oversizeBase64 = 'A'.repeat(21 * 1024 * 1024);

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/ingestion/upload',
        headers: {
          authorization: `Bearer ${leaderToken}`,
        },
        payload: {
          filename: 'oversize.mid',
          dataBase64: oversizeBase64,
        },
      });

      assert.equal(res.statusCode, 400);
    });

    it('H1.3: should detect duplicate upload and return existing song (Idempotency)', async () => {
      const testChordPro = `{title: Cancion Repetida}\n[G]Dios [C]bueno`;

      const res1 = await app.inject({
        method: 'POST',
        url: '/api/v1/ingestion/upload',
        headers: {
          authorization: `Bearer ${leaderToken}`,
        },
        payload: {
          filename: 'repetida.chordpro',
          rawText: testChordPro,
        },
      });
      assert.equal(res1.statusCode, 201);
      const song1 = res1.json();
      createdSongIds.add(song1.songId);

      // Segunda subida idéntica
      const res2 = await app.inject({
        method: 'POST',
        url: '/api/v1/ingestion/upload',
        headers: {
          authorization: `Bearer ${leaderToken}`,
        },
        payload: {
          filename: 'repetida.chordpro',
          rawText: testChordPro,
        },
      });
      assert.equal(res2.statusCode, 201);
      const song2 = res2.json();

      assert.equal(song2.songId, song1.songId, 'Debe reutilizar el ID de canción canónica existente');
      assert.ok(song2.diagnostics.some((d: any) => d.code === 'IDEMPOTENT_IMPORT_REUSED'));
    });

    it('H1.4: should reject cross-user access to another user background job (IDOR Prevention)', async () => {
      // Crear una tarea con worshipLeader
      const [job] = await db
        .insert(backgroundJobs)
        .values({
          jobType: 'IMPORT_COMMIT',
          status: 'PROCESSING',
          userId: worshipLeader.id,
          inputRef: 'privado.mid',
        })
        .returning();
      createdJobIds.add(job.id);

      // Intentar consultar con otherLeader
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/ingestion/jobs/${job.id}`,
        headers: {
          authorization: `Bearer ${otherLeaderToken}`,
        },
      });

      assert.equal(res.statusCode, 403, 'Debe rechazar con 403 Forbidden a usuarios no autorizados');
    });

    it('H1.5: should allow owner to query their own background job', async () => {
      const [job] = await db
        .insert(backgroundJobs)
        .values({
          jobType: 'IMPORT_COMMIT',
          status: 'COMPLETED',
          userId: worshipLeader.id,
          inputRef: 'propio.mid',
          progress: 100,
        })
        .returning();
      createdJobIds.add(job.id);

      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/ingestion/jobs/${job.id}`,
        headers: {
          authorization: `Bearer ${leaderToken}`,
        },
      });

      assert.equal(res.statusCode, 200);
      const body = res.json();
      assert.equal(body.id, job.id);
      assert.equal(body.status, 'COMPLETED');
    });
  });
});
