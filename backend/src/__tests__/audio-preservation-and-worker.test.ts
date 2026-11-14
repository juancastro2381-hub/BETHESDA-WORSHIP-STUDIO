/**
 * @file audio-preservation-and-worker.test.ts
 * @description Suite integral de aceptación para WS-AUDIO-01 (Puerta de Aceptación Gate 1).
 *
 * Valida los 11 criterios obligatorios de Gate 1:
 * 1. Detección precisa de MP3 con ID3v2 sin falsos positivos.
 * 2. Detección precisa de MP3 sin ID3 (tramas MPEG crudas).
 * 3. Detección de formatos de audio universales (WAV, FLAC, OGG, M4A, AAC).
 * 4. Integridad binaria absoluta (cero decodificación a texto ni corrupción de bytes).
 * 5. Adaptador de ingesta: SHA-256 exacto, metadatos canónicos nulos (CERO notas/acordes inventados).
 * 6. Rechazo estricto (fail-closed) de archivos no-audio disfrazados (HTML/ejecutables renombrados a .mp3).
 * 7. Rechazo categórico de firmas binarias inválidas o corruptas.
 * 8. Almacenamiento duradero y re-verificación criptográfica SHA-256 ante descargas/recuperación.
 * 9. Seguridad anti-IDOR: protección contra eliminación de activos de audio por usuarios no autorizados.
 * 10. Worker local de audio en Python: bridge IPC por stdin/stdout, PING, inspección profunda, eventos de progreso y decodificación PCM.
 * 11. Cero regresión en formatos canónicos existentes (MusicXML, ChordPro, MIDI).
 */

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../app.ts';
import { areDatabaseTargetsEquivalent, pool } from '../db/index.ts';
import { runMigrations } from '../db/migrate.ts';
import { DrizzleUserRepository } from '../repositories/user-repository.ts';
import { DrizzleSongRepository } from '../repositories/song-repository.ts';
import { DrizzleAudioRepository, type IAudioRepository } from '../repositories/audio-repository.ts';
import {
  DrizzleAuditLogRepository,
  type CreateAuditLogInput,
  type IAuditLogRepository,
  type ListAuditLogsOptions,
} from '../repositories/audit-repository.ts';
import {
  LocalFileSystemAudioStorageProvider,
  type IAudioStorageProvider,
} from '../domain/audio/storage-provider.ts';
import {
  AudioService,
  type AudioStartupRecoveryLogger,
  type AudioUploadCompensationReport,
} from '../application/audio-service.ts';
import { JwtTokenService } from '../application/token-service.ts';
import { Argon2PasswordHasher } from '../domain/crypto/password-hasher.ts';
import { globalStreamTicketService } from '../application/stream-ticket-service.ts';
import { env } from '../config/env.ts';
import type { AudioAsset, NewAudioAsset } from '../db/schema.ts';
import type { AuditLogEntity, UserEntity } from '../domain/auth-types.ts';
import type { SongEntity } from '../domain/types.ts';
import { ValidationError, ForbiddenError, PersistenceError } from '../domain/errors.ts';
import { CanonicalSerializer } from '../domain/canonical-serializer.ts';
import { createReferenceSongFixture } from '../../../frontend/src/core/canonical-model/fixtures/reference-song.ts';
import {
  inspectAudioSignature,
  validateAudioBuffer,
  detectAudioFormatFromBytes,
} from '../domain/audio/audio-signature-validator.ts';
import { AudioIngestionAdapter } from '../domain/ingestion/adapters/audio/audio-adapter.ts';
import { globalPythonAudioWorkerBridge } from '../infrastructure/python-worker/python-audio-worker-bridge.ts';

// Generador de fixtures binarias mínimas válidas
function makeMpegFrame(bitrateKbps = 128, sampleRate = 44100, isMono = false): Buffer {
  const b0 = 0xff;
  const b1 = 0xfb; // MPEG-1 Layer 3, no CRC
  const b2 = 0x90; // 128 kbps, 44100 Hz, no padding
  const b3 = isMono ? 0xc0 : 0x00;
  const frameLength = Math.floor((144 * 128 * 1000) / 44100);
  const buf = Buffer.alloc(frameLength, 0x55);
  buf[0] = b0;
  buf[1] = b1;
  buf[2] = b2;
  buf[3] = b3;
  return buf;
}

function makeValidMp3Buffer(withFrames = 3): Buffer {
  const frame = makeMpegFrame(128, 44100);
  return Buffer.concat(Array.from({ length: withFrames }, () => frame));
}

function makeValidMp3WithId3Buffer(): Buffer {
  const tagHeader = Buffer.from([
    0x49, 0x44, 0x33, // "ID3"
    0x03, 0x00,       // v2.3.0
    0x00,             // flags
    0x00, 0x00, 0x00, 0x0a, // 10 bytes de payload synchsafe
  ]);
  const tagBody = Buffer.alloc(10, 0xaa);
  const audioData = makeValidMp3Buffer(3);
  return Buffer.concat([tagHeader, tagBody, audioData]);
}

function makeValidWavBuffer(): Buffer {
  const sampleRate = 44100;
  const numChannels = 1;
  const bitsPerSample = 16;
  const byteRate = (sampleRate * numChannels * bitsPerSample) / 8;
  const blockAlign = (numChannels * bitsPerSample) / 8;
  const dataSize = 100;

  const header = Buffer.alloc(44);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + dataSize, 4);
  header.write('WAVE', 8, 'ascii');
  header.write('fmt ', 12, 'ascii');
  header.writeUInt32LE(16, 16); // subchunk1 size
  header.writeUInt16LE(1, 20);  // PCM format
  header.writeUInt16LE(numChannels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(dataSize, 40);

  const pcm = Buffer.alloc(dataSize, 0x00);
  return Buffer.concat([header, pcm]);
}

function makeValidFlacBuffer(): Buffer {
  const header = Buffer.alloc(42);
  header.write('fLaC', 0, 'ascii');
  header[4] = 0x00; // STREAMINFO metadata block header
  header.writeUInt32BE(34, 4); // length = 34
  // Packed SR and channels
  header[18] = 0xac;
  header[19] = 0x44;
  header[20] = 0x00;
  return header;
}

function makeValidOggBuffer(): Buffer {
  const buf = Buffer.alloc(64, 0x00);
  buf.write('OggS', 0, 'ascii');
  buf[4] = 0x00;
  buf[5] = 0x02; // BOS
  buf.writeUInt32LE(1, 14); // bitstream serial
  buf.writeUInt32LE(0, 18); // page sequence
  buf[26] = 0x01; // 1 segment
  buf[27] = 0x1e;
  buf[28] = 0x01;
  buf.write('vorbis', 29, 'ascii');
  buf[39] = 2; // 2 channels
  buf.writeUInt32LE(44100, 40); // 44100 Hz
  return buf;
}

describe('WS-AUDIO-01 — Gate 1 Comprehensive Audio Acceptance Suite', () => {
  let app: FastifyInstance;
  let tokenService: JwtTokenService;
  let userRepo: DrizzleUserRepository;
  let songRepo: DrizzleSongRepository;
  let audioRepo: DrizzleAudioRepository;
  let storageProvider: LocalFileSystemAudioStorageProvider;
  let audioService: AudioService;

  let directorUser: UserEntity;
  let musicianUser: UserEntity;
  let otherMusicianUser: UserEntity;

  let directorToken: string;
  let musicianToken: string;
  let otherMusicianToken: string;

  let testSong: SongEntity;
  const createdSongIds = new Set<string>();
  const createdUserIds = new Set<string>();
  const createdAudioStoragePaths = new Set<string>();
  const tempFilesToClean: string[] = [];
  const tempDirsToClean: string[] = [];

  function generateRealMp3WithBundledFfmpeg(durationSec = 0.6): Buffer {
    const pyExe = globalPythonAudioWorkerBridge.resolvePythonExecutable();
    const outPath = path.join(os.tmpdir(), `bethesda_real_${Date.now()}_${Math.random().toString(16).slice(2)}.mp3`);
    tempFilesToClean.push(outPath);
    const pyScript = [
      'import sys, subprocess, imageio_ffmpeg',
      'ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()',
      'subprocess.run([ffmpeg, "-nostdin", "-threads", "1", "-v", "error", "-y", "-f", "lavfi", "-i", f"sine=frequency=440:duration={sys.argv[1]}", "-ar", "44100", "-ac", "1", "-b:a", "128k", "-id3v2_version", "3", "-metadata", "title=Bethesda Test", sys.argv[2]], check=True)',
    ].join('; ');
    execFileSync(pyExe, ['-c', pyScript, String(durationSec), outPath], { windowsHide: true });
    return fs.readFileSync(outPath);
  }

  const SUITE_TEST_RUN_ID = `ws-audio-01-run-${Date.now()}-${crypto.randomUUID()}`;
  const HISTORICAL_SEED_MARKER = `historical-seed-${crypto.randomUUID()}`;
  const suiteCreatedAuditLogIds = new Set<string>();
  let preExistingAuditLogIds: string[] = [];
  let historicalSeedAuditId: string | null = null;
  let unexpectedBeforeOrTestCleanupError: unknown = null;

  function assertIsolatedTestDatabaseForAuditCleanup(
    context: {
      nodeEnv?: string | undefined;
      testDatabaseUrl?: string | undefined;
      databaseUrl?: string | undefined;
      correlationId?: string | undefined;
    } = {}
  ): void {
    const nodeEnv = context.nodeEnv ?? env.NODE_ENV;
    const testDatabaseUrl = context.testDatabaseUrl ?? env.TEST_DATABASE_URL;
    const databaseUrl = context.databaseUrl ?? env.DATABASE_URL;
    const correlationId = context.correlationId ?? SUITE_TEST_RUN_ID;

    if (nodeEnv !== 'test') {
      throw new Error(
        `Limpieza destructiva de auditoría rechazada: NODE_ENV='${nodeEnv}' debe ser estrictamente 'test'.`
      );
    }

    if (!testDatabaseUrl || !testDatabaseUrl.trim()) {
      throw new Error(
        'Limpieza destructiva de auditoría rechazada: TEST_DATABASE_URL es obligatoria.'
      );
    }

    let parsedTestUrl: URL;
    try {
      parsedTestUrl = new URL(testDatabaseUrl);
    } catch {
      throw new Error(
        'Limpieza destructiva de auditoría rechazada: TEST_DATABASE_URL no es una URL válida.'
      );
    }

    const dbName = parsedTestUrl.pathname.replace(/^\/+|\/+$/g, '').toLowerCase();
    if (!dbName || /prod(uction)?/i.test(dbName)) {
      throw new Error(
        `Limpieza destructiva de auditoría rechazada: nombre de base de datos '${dbName || '(vacío)'}' no es un entorno de pruebas aislado seguro.`
      );
    }

    if (databaseUrl && areDatabaseTargetsEquivalent(testDatabaseUrl, databaseUrl)) {
      throw new Error(
        'Limpieza destructiva de auditoría rechazada: TEST_DATABASE_URL apunta al mismo destino que DATABASE_URL.'
      );
    }

    if (!/^ws-audio-01-run-[0-9]+-[0-9a-f-]{36}$/i.test(correlationId)) {
      throw new Error(
        `Limpieza destructiva de auditoría rechazada: identificador de correlación '${correlationId}' inválido.`
      );
    }
  }

  async function cleanupCorrelatedTestAuditLogs(options: {
    targetIds: Iterable<string>;
    runCorrelationId?: string | undefined;
    scopeCorrelationId?: string | undefined;
    envContext?: {
      nodeEnv?: string | undefined;
      testDatabaseUrl?: string | undefined;
      databaseUrl?: string | undefined;
    };
  }): Promise<number> {
    const runId = options.runCorrelationId ?? SUITE_TEST_RUN_ID;
    assertIsolatedTestDatabaseForAuditCleanup({
      ...options.envContext,
      correlationId: runId,
    });

    const ids = Array.from(new Set(options.targetIds));
    if (ids.length === 0) {
      return 0;
    }

    if (options.scopeCorrelationId) {
      const res = await pool.query<{ id: string }>(
        `DELETE FROM audit_logs
         WHERE id = ANY($1::uuid[])
           AND metadata->>'testRunCorrelationId' = $2
           AND metadata->>'testScopeCorrelationId' = $3
         RETURNING id`,
        [ids, runId, options.scopeCorrelationId]
      );
      for (const row of res.rows) {
        suiteCreatedAuditLogIds.delete(row.id);
      }
      return res.rowCount ?? res.rows.length;
    }

    const res = await pool.query<{ id: string }>(
      `DELETE FROM audit_logs
       WHERE id = ANY($1::uuid[])
         AND metadata->>'testRunCorrelationId' = $2
       RETURNING id`,
      [ids, runId]
    );
    for (const row of res.rows) {
      suiteCreatedAuditLogIds.delete(row.id);
    }
    return res.rowCount ?? res.rows.length;
  }

  function createScopedTestAuditRepo(
    scopeName: string,
    hooks: {
      onCreated?: (entity: AuditLogEntity) => void;
    } = {}
  ): {
    scopeCorrelationId: string;
    createdIds: Set<string>;
    auditRepo: IAuditLogRepository;
    cleanup: () => Promise<number>;
  } {
    assertIsolatedTestDatabaseForAuditCleanup();
    const realAuditRepo = new DrizzleAuditLogRepository();
    const scopeCorrelationId = `${scopeName}-${crypto.randomUUID()}`;
    const createdIds = new Set<string>();

    const auditRepo: IAuditLogRepository = {
      async create(input: CreateAuditLogInput): Promise<AuditLogEntity> {
        assertIsolatedTestDatabaseForAuditCleanup();
        const created = await realAuditRepo.create({
          ...input,
          metadata: {
            ...(input.metadata ?? {}),
            testRunCorrelationId: SUITE_TEST_RUN_ID,
            testScopeCorrelationId: scopeCorrelationId,
          },
        });
        createdIds.add(created.id);
        suiteCreatedAuditLogIds.add(created.id);
        hooks.onCreated?.(created);
        return created;
      },
      async list(options: ListAuditLogsOptions = {}): Promise<AuditLogEntity[]> {
        const orderDirection = options.orderDirection ?? 'desc';
        const wantedOffset = options.offset ?? 0;
        const wantedLimit = options.limit ?? 1000;
        const matched: AuditLogEntity[] = [];
        const rawBatchSize = 1000;
        let rawOffset = 0;

        while (rawOffset < 50_000) {
          const batch = await realAuditRepo.list({
            ...(options.eventTypes ? { eventTypes: options.eventTypes } : {}),
            limit: rawBatchSize,
            offset: rawOffset,
            orderDirection,
          });

          for (const row of batch) {
            const meta = row.metadata as Record<string, unknown> | undefined;
            if (meta?.['testScopeCorrelationId'] === scopeCorrelationId) {
              matched.push(row);
            }
          }

          if (batch.length < rawBatchSize) {
            break;
          }
          rawOffset += batch.length;
        }

        return matched.slice(wantedOffset, wantedOffset + wantedLimit);
      },
    };

    const cleanup = async (): Promise<number> => {
      return await cleanupCorrelatedTestAuditLogs({
        targetIds: createdIds,
        runCorrelationId: SUITE_TEST_RUN_ID,
        scopeCorrelationId,
      });
    };

    return {
      scopeCorrelationId,
      createdIds,
      auditRepo,
      cleanup,
    };
  }

  async function withIsolatedTestScope<T>(
    scopeName: string,
    fn: (scope: ReturnType<typeof createScopedTestAuditRepo>) => Promise<T>
  ): Promise<T> {
    const scope = createScopedTestAuditRepo(scopeName);
    try {
      return await fn(scope);
    } finally {
      await scope.cleanup();
    }
  }

  before(async () => {
    assertIsolatedTestDatabaseForAuditCleanup();
    await runMigrations();

    // Instantánea de registros históricos preexistentes antes de ejecutar la suite
    const baselineRes = await pool.query<{ id: string }>('SELECT id FROM audit_logs');
    preExistingAuditLogIds = baselineRes.rows.map((r) => r.id);

    // Sembrar registro histórico no relacionado (sin testRunCorrelationId) para verificar preservación intacta (Escenario A)
    const seededHistorical = await new DrizzleAuditLogRepository().create({
      eventType: 'AUDIO_HISTORICAL_AUDIT_SEED',
      userId: null,
      resource: 'historical/preexisting-audio.mp3',
      metadata: {
        historicalSeedMarker: HISTORICAL_SEED_MARKER,
        note: 'Unrelated historical AUDIO_ audit row that must survive suite execution and cleanup.',
      },
    });
    historicalSeedAuditId = seededHistorical.id;

    app = await buildApp();
    await app.ready();

    tokenService = new JwtTokenService(env.JWT_SECRET, env.JWT_ACCESS_EXPIRES_IN);
    userRepo = new DrizzleUserRepository();
    songRepo = new DrizzleSongRepository();
    audioRepo = new DrizzleAudioRepository();
    storageProvider = new LocalFileSystemAudioStorageProvider(env.AUDIO_STORAGE_PATH, env.MAX_AUDIO_FILE_SIZE_BYTES);
    audioService = new AudioService(audioRepo, storageProvider, songRepo, env.MAX_AUDIO_FILE_SIZE_BYTES);

    const ts = Date.now();

    // 1. Director / Worship Leader
    directorUser = await userRepo.create({
      email: `audio-director-${ts}@bethesda.co`,
      passwordHash: 'dummy_hash',
      firstName: 'Director',
      lastName: 'Worship',
      role: 'WORSHIP_LEADER',
      accountStatus: 'ACTIVE',
    });
    createdUserIds.add(directorUser.id);
    directorToken = tokenService.signAccessToken({
      sub: directorUser.id,
      email: directorUser.email,
      role: directorUser.role,
    }).token;

    // 2. Musician A
    musicianUser = await userRepo.create({
      email: `audio-musician-a-${ts}@bethesda.co`,
      passwordHash: 'dummy_hash',
      firstName: 'Musico',
      lastName: 'A',
      role: 'MUSICIAN',
      accountStatus: 'ACTIVE',
    });
    createdUserIds.add(musicianUser.id);
    musicianToken = tokenService.signAccessToken({
      sub: musicianUser.id,
      email: musicianUser.email,
      role: musicianUser.role,
    }).token;

    // 3. Musician B (para pruebas Anti-IDOR)
    otherMusicianUser = await userRepo.create({
      email: `audio-musician-b-${ts}@bethesda.co`,
      passwordHash: 'dummy_hash',
      firstName: 'Musico',
      lastName: 'B',
      role: 'MUSICIAN',
      accountStatus: 'ACTIVE',
    });
    createdUserIds.add(otherMusicianUser.id);
    otherMusicianToken = tokenService.signAccessToken({
      sub: otherMusicianUser.id,
      email: otherMusicianUser.email,
      role: otherMusicianUser.role,
    }).token;

    // 4. Canción canónica para asociar audios
    const canonicalSong = createReferenceSongFixture();
    const canonicalJSON = CanonicalSerializer.serialize(canonicalSong);

    const songResult = await songRepo.create({
      title: 'Al Que Está Sentado En El Trono',
      artist: 'Marcos Brunet',
      defaultKey: 'D',
      defaultBpm: 72,
      timeSignature: '4/4',
      status: 'APPROVED',
      versionName: 'Versión Canónica',
      sourceFormat: 'INTERNAL',
      canonicalPayload: canonicalJSON,
    });
    testSong = songResult.song;
    createdSongIds.add(testSong.id);
  });

  after(async () => {
    try {
      assertIsolatedTestDatabaseForAuditCleanup();
      await cleanupCorrelatedTestAuditLogs({
        targetIds: suiteCreatedAuditLogIds,
        runCorrelationId: SUITE_TEST_RUN_ID,
      });

      if (historicalSeedAuditId) {
        const seedCheck = await pool.query<{ id: string }>(
          'SELECT id FROM audit_logs WHERE id = $1',
          [historicalSeedAuditId]
        );
        assert.strictEqual(
          seedCheck.rows.length,
          1,
          'El registro histórico AUDIO_ no correlacionado debe sobrevivir intacto a toda la suite y su limpieza.'
        );
        await pool.query(
          "DELETE FROM audit_logs WHERE id = $1 AND metadata->>'historicalSeedMarker' = $2",
          [historicalSeedAuditId, HISTORICAL_SEED_MARKER]
        );
      }

      if (preExistingAuditLogIds.length > 0) {
        const preservedRes = await pool.query<{ count: string }>(
          'SELECT COUNT(*)::text AS count FROM audit_logs WHERE id = ANY($1::uuid[])',
          [preExistingAuditLogIds]
        );
        assert.strictEqual(
          Number(preservedRes.rows[0]?.count ?? '0'),
          preExistingAuditLogIds.length,
          'Todos los registros preexistentes de audit_logs deben permanecer intactos.'
        );
      }
    } catch (cleanupErr) {
      unexpectedBeforeOrTestCleanupError = cleanupErr;
    }

    if (createdSongIds.size > 0) {
      await pool.query('DELETE FROM songs WHERE id = ANY($1)', [Array.from(createdSongIds)]);
    }
    if (createdUserIds.size > 0) {
      await pool.query('DELETE FROM users WHERE id = ANY($1)', [Array.from(createdUserIds)]);
    }

    for (const relStoragePath of createdAudioStoragePaths) {
      await storageProvider.delete(relStoragePath).catch(() => {});
    }

    for (const file of tempFilesToClean) {
      try {
        if (fs.existsSync(file)) {
          fs.chmodSync(file, 0o666);
          fs.unlinkSync(file);
        }
      } catch {
        // ignore cleanup error
      }
    }

    for (const dir of tempDirsToClean) {
      try {
        if (fs.existsSync(dir)) {
          fs.rmSync(dir, { recursive: true, force: true });
        }
      } catch {
        // ignore cleanup error
      }
    }

    await app.close();
    await pool.end();
    if (unexpectedBeforeOrTestCleanupError) {
      throw unexpectedBeforeOrTestCleanupError;
    }
  });

  // CRITERIO 1: MP3 con ID3v2
  it('1. should validate MP3 with ID3v2 header and verify chained MPEG audio frame', () => {
    const mp3Id3 = makeValidMp3WithId3Buffer();
    const result = inspectAudioSignature(mp3Id3);
    assert.strictEqual(result.valid, true);
    assert.strictEqual(result.format, 'MP3');
    assert.strictEqual(result.hasId3v2, true);
    assert.strictEqual(result.id3TagSizeBytes, 20);
    assert.strictEqual(result.sampleRateHz, 44100);
    assert.strictEqual(result.bitrateKbps, 128);
  });

  // CRITERIO 2: MP3 sin ID3 (tramas MPEG puras)
  it('2. should validate raw MP3 without ID3 header via frame sync detection', () => {
    const rawMp3 = makeValidMp3Buffer(2);
    const result = inspectAudioSignature(rawMp3);
    assert.strictEqual(result.valid, true);
    assert.strictEqual(result.format, 'MP3');
    assert.strictEqual(result.hasId3v2, false);
    assert.strictEqual(result.sampleRateHz, 44100);
    assert.strictEqual(result.bitrateKbps, 128);
  });

  // CRITERIO 3: Formatos universales (WAV, FLAC, OGG)
  it('3. should validate signatures for WAV, FLAC, and OGG formats', () => {
    const wav = makeValidWavBuffer();
    const wavRes = inspectAudioSignature(wav);
    assert.strictEqual(wavRes.valid, true);
    assert.strictEqual(wavRes.format, 'WAV');
    assert.strictEqual(wavRes.mimeType, 'audio/wav');

    const flac = makeValidFlacBuffer();
    const flacRes = inspectAudioSignature(flac);
    assert.strictEqual(flacRes.valid, true);
    assert.strictEqual(flacRes.format, 'FLAC');
    assert.strictEqual(flacRes.mimeType, 'audio/flac');

    const ogg = makeValidOggBuffer();
    const oggRes = inspectAudioSignature(ogg);
    assert.strictEqual(oggRes.valid, true);
    assert.strictEqual(oggRes.format, 'OGG');
    assert.strictEqual(oggRes.mimeType, 'audio/ogg');
  });

  // CRITERIO 4: Integridad binaria y preservación de hash SHA-256
  it('4. should maintain absolute byte integrity and deterministic SHA-256 through storage', async () => {
    const audioBytes = makeValidMp3Buffer(5);
    const originalHash = crypto.createHash('sha256').update(audioBytes).digest('hex');

    const asset = await audioService.uploadAudio({
      songId: testSong.id,
      title: 'Pista de Integridad',
      filename: 'integridad_test.mp3',
      mimeType: 'audio/mpeg',
      buffer: audioBytes,
      uploadedByUserId: directorUser.id,
    });

    assert.strictEqual(asset.checksumSha256, originalHash);
    assert.strictEqual(asset.fileSizeBytes, audioBytes.length);
    createdAudioStoragePaths.add(asset.storagePath);

    // Descarga y re-verificación criptográfica
    const downloaded = await audioService.downloadAudio(asset.id);
    const downloadedHash = crypto.createHash('sha256').update(downloaded.buffer).digest('hex');
    assert.strictEqual(downloadedHash, originalHash);
    assert.strictEqual(Buffer.compare(downloaded.buffer, audioBytes), 0);
  });

  // CRITERIO 5: Ingestion Adapter — CERO notas, acordes, clave o tempo inventados
  it('5. should ingest audio file returning NULL for all musical inferences (Zero Fabrication)', async () => {
    const adapter = new AudioIngestionAdapter();
    const wavBuffer = makeValidWavBuffer();

    const output = await adapter.ingest(
      {
        filename: 'pista_ensayo.wav',
        mimeType: 'audio/wav',
        sourceType: 'AUDIO',
        buffer: wavBuffer,
      },
      directorUser as any
    );

    assert.strictEqual(output.sourceType, 'AUDIO');
    assert.strictEqual(output.status, 'RECOGNITION_UNAVAILABLE');
    assert.strictEqual(output.defaultKey, null, 'CERO clave inventada');
    assert.strictEqual(output.defaultBpm, null, 'CERO tempo inventado');
    assert.strictEqual(output.timeSignature, null, 'CERO métrica inventada');
    assert.strictEqual(output.canonicalPayload, null, 'CERO partitura canónica falsa');
    assert.ok(output.sourceHash.length === 64, 'Debe generar checksum SHA-256');
  });

  // CRITERIO 6: Rechazo fail-closed de archivos falsificados (HTML / Texto con extensión .mp3)
  it('6. should reject fake audio files disguised with audio extension (Fail-Closed)', () => {
    const htmlFake = Buffer.from('<!DOCTYPE html><html><body>Fake Audio</body></html>');
    assert.throws(
      () => validateAudioBuffer(htmlFake, 'audio/mpeg'),
      (err: any) => err instanceof ValidationError && err.message.includes('magic bytes')
    );

    const textFake = Buffer.from('Just some plain text notes without MPEG sync');
    assert.throws(
      () => validateAudioBuffer(textFake, 'audio/mpeg'),
      (err: any) => err instanceof ValidationError
    );
  });

  // CRITERIO 7: Detección de etiqueta ID3 aislada sin tramas MPEG reales
  it('7. should reject files with ID3 tag but NO valid MPEG audio frames', () => {
    const fakeId3Only = Buffer.concat([
      Buffer.from([0x49, 0x44, 0x33, 0x03, 0x00, 0x00, 0x00, 0x00, 0x00, 0x05]),
      Buffer.from('HELLO'),
      Buffer.from('NOT AUDIO FRAMES AT ALL'),
    ]);

    const result = inspectAudioSignature(fakeId3Only);
    assert.strictEqual(result.valid, false);
    assert.ok(result.reason?.includes('no se encontró ninguna trama de audio MPEG válida'));
  });

  // CRITERIO 8: Detección de corrupción/adulteración física al descargar
  it('8. should detect physical storage tampering and reject download with ValidationError', async () => {
    const validMp3 = makeValidMp3Buffer(2);
    const asset = await audioService.uploadAudio({
      songId: testSong.id,
      title: 'Audio Tamper Test',
      filename: 'tamper.mp3',
      mimeType: 'audio/mpeg',
      buffer: validMp3,
      uploadedByUserId: directorUser.id,
    });
    createdAudioStoragePaths.add(asset.storagePath);

    // Simular corrupción física deliberada del archivo en disco (elevando permisos de solo lectura primero)
    const fullPath = path.resolve(env.AUDIO_STORAGE_PATH, asset.storagePath);
    if (fs.existsSync(fullPath)) {
      fs.chmodSync(fullPath, 0o666);
      const corruptedBytes = Buffer.from('CORRUPTED DATA OVERWRITTEN');
      fs.writeFileSync(fullPath, corruptedBytes);

      await assert.rejects(
        () => audioService.downloadAudio(asset.id),
        (err: any) => err instanceof ValidationError && err.message.includes('Integridad física comprometida')
      );
    }
  });

  // CRITERIO 9: Seguridad Anti-IDOR en eliminación de recursos de audio
  it('9. should enforce Anti-IDOR: reject deletion when unprivileged user does not own asset', async () => {
    // 1. Subir audio por el director
    const validMp3 = makeValidMp3Buffer(2);
    const asset = await audioService.uploadAudio({
      songId: testSong.id,
      title: 'Pista Director',
      filename: 'pista_director.mp3',
      mimeType: 'audio/mpeg',
      buffer: validMp3,
      uploadedByUserId: directorUser.id,
    });

    // 2. Músico A intenta eliminar el audio del Director: debe fallar con 403 Forbidden
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/v1/audio/${asset.id}`,
      headers: {
        authorization: `Bearer ${musicianToken}`,
      },
    });

    assert.strictEqual(res.statusCode, 403, 'Anti-IDOR: debe rechazar eliminación con 403 Forbidden');
    const json = res.json();
    assert.ok(json.error.message.includes('No tiene autorización para eliminar un recurso de audio registrado por otro usuario'));

    // 3. Director (autorizado) sí puede eliminarlo
    const deleteRes = await app.inject({
      method: 'DELETE',
      url: `/api/v1/audio/${asset.id}`,
      headers: {
        authorization: `Bearer ${directorToken}`,
      },
    });
    assert.strictEqual(deleteRes.statusCode, 204);
  });

  // CRITERIO 10: Worker local de audio en Python — Bridge IPC (PING y verificación)
  it('10. should communicate with local Python audio worker via stdin/stdout IPC (PING)', async () => {
    const pingResult = await globalPythonAudioWorkerBridge.ping(10000);
    assert.strictEqual(pingResult.status, 'READY');
    assert.strictEqual(pingResult.workerVersion, '0.1.0');
    assert.ok(pingResult.pythonVersion.startsWith('3.14'), `Python 3.14 esperado, obtenido: ${pingResult.pythonVersion}`);
  });

  it('10b. should inspect and verify audio file with local Python worker and report PCM decode', async () => {
    // Crear archivo WAV temporal
    const wavBuffer = makeValidWavBuffer();
    const tempWav = path.join(os.tmpdir(), `bethesda_test_${Date.now()}.wav`);
    fs.writeFileSync(tempWav, wavBuffer);
    tempFilesToClean.push(tempWav);

    const expectedSha256 = crypto.createHash('sha256').update(wavBuffer).digest('hex');

    const progressReports: number[] = [];
    const inspectResult = await globalPythonAudioWorkerBridge.inspectAndVerifyAudio(
      `test-job-${Date.now()}`,
      tempWav,
      expectedSha256,
      {
        timeoutMs: 15000,
        onProgress: (pct) => progressReports.push(pct),
      }
    );

    assert.strictEqual(inspectResult.detectedFormat, 'WAV');
    assert.strictEqual(inspectResult.verifiedSha256, expectedSha256);
    assert.strictEqual(inspectResult.pcmDecodeVerified, true);
    assert.strictEqual(inspectResult.sampleRateHz, 44100);
    assert.strictEqual(inspectResult.channels, 1);
    assert.ok(progressReports.length > 0, 'Debe haber emitido eventos de progreso');
  });

  // CRITERIO 11: Cero regresión en formatos canónicos existentes
  it('11. should preserve zero regression on existing canonical formats (ChordPro & MusicXML)', () => {
    // MusicXML
    const xmlHeader = '<?xml version="1.0" encoding="UTF-8"?><score-partwise version="4.0"><part-list></part-list></score-partwise>';
    const xmlBytes = Buffer.from(xmlHeader, 'utf-8');
    const xmlRes = inspectAudioSignature(xmlBytes);
    assert.strictEqual(xmlRes.valid, false, 'MusicXML no debe ser identificado como audio');

    // ChordPro
    const chordProText = '{title: Tu Fidelidad}\n[D]Tu fidelidad [Em]es grande';
    const choBytes = Buffer.from(chordProText, 'utf-8');
    const choRes = inspectAudioSignature(choBytes);
    assert.strictEqual(choRes.valid, false, 'ChordPro no debe ser identificado como audio');
  });

  // ==========================================================================
  // REMEDIACIÓN DE AUDITORÍA INDEPENDIENTE (FINDINGS A, B, C, E)
  // ==========================================================================

  // CRITERIO 12 (Finding A): Verificación SHA-256 previa al streaming incluso en Range parciales
  it('12. (Finding A) should verify full-file SHA-256 BEFORE streaming HTTP Range 206 and block out-of-range tail tampering', async () => {
    const mp3Buffer = generateRealMp3WithBundledFfmpeg(0.6);
    const asset = await audioService.uploadAudio({
      songId: testSong.id,
      title: 'Streaming Tail Tamper Guard Test',
      filename: 'tail_tamper.mp3',
      mimeType: 'audio/mpeg',
      buffer: mp3Buffer,
      uploadedByUserId: directorUser.id,
    });
    createdAudioStoragePaths.add(asset.storagePath);

    // Manipular ÚNICAMENTE el último byte del archivo en disco (fuera del rango bytes=0-15 solicitado)
    const fullPath = storageProvider.resolveSafePath(asset.storagePath);
    fs.chmodSync(fullPath, 0o666);
    const diskBytes = fs.readFileSync(fullPath);
    diskBytes[diskBytes.length - 1] = diskBytes[diskBytes.length - 1]! ^ 0xff;
    fs.writeFileSync(fullPath, diskBytes);
    fs.chmodSync(fullPath, 0o444);

    // Solicitar Range bytes=0-15 (bytes iniciales aparentemente intactos): debe fallar antes de entregar datos
    const streamRes = await app.inject({
      method: 'GET',
      url: `/api/v1/audio/${asset.id}/stream`,
      headers: {
        authorization: `Bearer ${musicianToken}`,
        range: 'bytes=0-15',
      },
    });

    assert.strictEqual(streamRes.statusCode, 400);
    const body = streamRes.json();
    assert.strictEqual(body.error.code, 'VALIDATION_ERROR');
    assert.ok(body.error.message.includes('Integridad física comprometida'));

    // La descarga completa también debe rechazar con ValidationError
    await assert.rejects(
      () => audioService.downloadAudio(asset.id),
      (err: any) => err instanceof ValidationError && err.message.includes('Integridad física comprometida')
    );

    await audioService.deleteAudio(asset.id);
    createdAudioStoragePaths.delete(asset.storagePath);
  });

  // CRITERIO 13 (Finding A): Archivo físico ausente retorna 404 NotFoundError controlado
  it('13. (Finding A) should return structured 404 NotFoundError when physical audio file is missing on download or stream', async () => {
    const mp3Buffer = makeValidMp3Buffer(4);
    const asset = await audioService.uploadAudio({
      songId: testSong.id,
      title: 'Missing Physical Audio Test',
      filename: 'missing_physical.mp3',
      mimeType: 'audio/mpeg',
      buffer: mp3Buffer,
      uploadedByUserId: directorUser.id,
    });

    const fullPath = storageProvider.resolveSafePath(asset.storagePath);
    fs.chmodSync(fullPath, 0o666);
    fs.unlinkSync(fullPath);

    const downloadRes = await app.inject({
      method: 'GET',
      url: `/api/v1/audio/${asset.id}/download`,
      headers: { authorization: `Bearer ${musicianToken}` },
    });
    assert.strictEqual(downloadRes.statusCode, 404);
    assert.strictEqual(downloadRes.json().error.code, 'NOT_FOUND');

    const streamRes = await app.inject({
      method: 'GET',
      url: `/api/v1/audio/${asset.id}/stream`,
      headers: {
        authorization: `Bearer ${musicianToken}`,
        range: 'bytes=0-15',
      },
    });
    assert.strictEqual(streamRes.statusCode, 404);
    assert.strictEqual(streamRes.json().error.code, 'NOT_FOUND');

    await audioRepo.delete(asset.id);
  });

  // CRITERIO 14 (Finding A): Permisos 0o444 en disco, cabeceras SHA-256 y Range seeking repetible sin mutación
  it('14. (Finding A) should enforce read-only permissions on disk, emit checksum headers, and sustain repeated Range playback', async () => {
    const mp3Buffer = generateRealMp3WithBundledFfmpeg(0.6);
    const asset = await audioService.uploadAudio({
      songId: testSong.id,
      title: 'Range Playback Integrity Test',
      filename: 'playback_integrity.mp3',
      mimeType: 'audio/mpeg',
      buffer: mp3Buffer,
      uploadedByUserId: directorUser.id,
    });
    createdAudioStoragePaths.add(asset.storagePath);

    const fullPath = storageProvider.resolveSafePath(asset.storagePath);
    const stat = fs.statSync(fullPath);
    assert.strictEqual(stat.mode & 0o222, 0, 'El archivo preservado debe quedar en modo solo-lectura en disco');

    const ticketRes = await app.inject({
      method: 'POST',
      url: `/api/v1/audio/${asset.id}/ticket`,
      headers: { authorization: `Bearer ${musicianToken}` },
    });
    assert.strictEqual(ticketRes.statusCode, 200);
    const { ticket } = ticketRes.json().data;

    const r1 = await app.inject({
      method: 'GET',
      url: `/api/v1/audio/${asset.id}/stream?ticket=${ticket}`,
      headers: { range: 'bytes=0-31' },
    });
    assert.strictEqual(r1.statusCode, 206);
    assert.strictEqual(r1.headers['x-checksum-sha256'], asset.checksumSha256);
    assert.strictEqual(r1.headers.etag, `"${asset.checksumSha256}"`);
    assert.strictEqual(Buffer.compare(r1.rawPayload, mp3Buffer.subarray(0, 32)), 0);

    const r2 = await app.inject({
      method: 'GET',
      url: `/api/v1/audio/${asset.id}/stream?ticket=${ticket}`,
      headers: { range: 'bytes=32-63' },
    });
    assert.strictEqual(r2.statusCode, 206);
    assert.strictEqual(Buffer.compare(r2.rawPayload, mp3Buffer.subarray(32, 64)), 0);

    const diskShaAfter = crypto.createHash('sha256').update(fs.readFileSync(fullPath)).digest('hex');
    assert.strictEqual(diskShaAfter, asset.checksumSha256);

    await audioService.deleteAudio(asset.id);
    createdAudioStoragePaths.delete(asset.storagePath);
  });

  // CRITERIO 15 (Finding B): Revocación inmediata de tickets al suspender, bloquear o eliminar usuario
  it('15. (Finding B) should immediately revoke and reject stream tickets when user is suspended, locked, deleted, or on cross-asset reuse', async () => {
    const tempEmail = `revoked-stream-${Date.now()}@bethesda.co`;
    const tempUser = await userRepo.create({
      email: tempEmail,
      passwordHash: 'dummy_hash',
      firstName: 'Temp',
      lastName: 'Streamer',
      role: 'MUSICIAN',
      accountStatus: 'ACTIVE',
    });
    createdUserIds.add(tempUser.id);

    const tempToken = tokenService.signAccessToken({
      sub: tempUser.id,
      email: tempUser.email,
      role: tempUser.role,
    }).token;

    const assetA = await audioService.uploadAudio({
      songId: testSong.id,
      title: 'Asset A Revocation',
      filename: 'asset_a.mp3',
      mimeType: 'audio/mpeg',
      buffer: makeValidMp3Buffer(3),
      uploadedByUserId: directorUser.id,
    });
    createdAudioStoragePaths.add(assetA.storagePath);

    const assetB = await audioService.uploadAudio({
      songId: testSong.id,
      title: 'Asset B Revocation',
      filename: 'asset_b.mp3',
      mimeType: 'audio/mpeg',
      buffer: makeValidMp3Buffer(3),
      uploadedByUserId: directorUser.id,
    });
    createdAudioStoragePaths.add(assetB.storagePath);

    // 1. Emitir ticket válido y confirmar streaming inicial exitoso
    const t1Res = await app.inject({
      method: 'POST',
      url: `/api/v1/audio/${assetA.id}/ticket`,
      headers: { authorization: `Bearer ${tempToken}` },
    });
    assert.strictEqual(t1Res.statusCode, 200);
    const ticket1 = t1Res.json().data.ticket;

    const okStream = await app.inject({
      method: 'GET',
      url: `/api/v1/audio/${assetA.id}/stream?ticket=${ticket1}`,
      headers: { range: 'bytes=0-15' },
    });
    assert.strictEqual(okStream.statusCode, 206);

    // 2. Suspender usuario en PostgreSQL dentro del TTL del ticket: debe rechazar con 403 y revocar el ticket
    await userRepo.updateStatus(tempUser.id, 'SUSPENDED');

    const suspendedTicketStream = await app.inject({
      method: 'GET',
      url: `/api/v1/audio/${assetA.id}/stream?ticket=${ticket1}`,
      headers: { range: 'bytes=0-15' },
    });
    assert.strictEqual(suspendedTicketStream.statusCode, 403);
    assert.strictEqual(suspendedTicketStream.json().error.code, 'FORBIDDEN');
    assert.strictEqual(globalStreamTicketService.getTicketState(ticket1), null, 'El ticket debe haber sido purgado');

    // Incluso Bearer token sin ticket debe fallar en tiempo real cuando el usuario está SUSPENDED
    const suspendedBearerStream = await app.inject({
      method: 'GET',
      url: `/api/v1/audio/${assetA.id}/stream`,
      headers: { authorization: `Bearer ${tempToken}` },
    });
    assert.strictEqual(suspendedBearerStream.statusCode, 403);

    // 3. Reactivar usuario, emitir nuevo ticket y bloquear temporalmente por lockoutUntil
    await userRepo.updateStatus(tempUser.id, 'ACTIVE');
    const t2Res = await app.inject({
      method: 'POST',
      url: `/api/v1/audio/${assetA.id}/ticket`,
      headers: { authorization: `Bearer ${tempToken}` },
    });
    const ticket2 = t2Res.json().data.ticket;

    await userRepo.update(tempUser.id, { lockoutUntil: new Date(Date.now() + 10 * 60 * 1000) });
    const lockedStream = await app.inject({
      method: 'GET',
      url: `/api/v1/audio/${assetA.id}/stream?ticket=${ticket2}`,
    });
    assert.strictEqual(lockedStream.statusCode, 403);
    assert.strictEqual(globalStreamTicketService.getTicketState(ticket2), null);

    // 4. Desbloquear y validar rechazo de uso cruzado entre activos (ticket de assetA usado en assetB)
    await userRepo.update(tempUser.id, { lockoutUntil: null });
    const t3Res = await app.inject({
      method: 'POST',
      url: `/api/v1/audio/${assetA.id}/ticket`,
      headers: { authorization: `Bearer ${tempToken}` },
    });
    const ticket3 = t3Res.json().data.ticket;

    const crossAssetRes = await app.inject({
      method: 'GET',
      url: `/api/v1/audio/${assetB.id}/stream?ticket=${ticket3}`,
    });
    assert.strictEqual(crossAssetRes.statusCode, 401);

    // 5. Eliminar usuario en BD con ticket vigente: debe fallar con 401 y purgar el ticket
    await pool.query('DELETE FROM users WHERE id = $1', [tempUser.id]);
    createdUserIds.delete(tempUser.id);

    const deletedUserStream = await app.inject({
      method: 'GET',
      url: `/api/v1/audio/${assetA.id}/stream?ticket=${ticket3}`,
    });
    assert.strictEqual(deletedUserStream.statusCode, 401);
    assert.strictEqual(globalStreamTicketService.getTicketState(ticket3), null);

    await audioService.deleteAudio(assetA.id);
    await audioService.deleteAudio(assetB.id);
    createdAudioStoragePaths.delete(assetA.storagePath);
    createdAudioStoragePaths.delete(assetB.storagePath);
  });

  // CRITERIO 16 (Finding C): Rollback transaccional anti-huérfanos y reconciliación almacenamiento/BD
  it('16. (Finding C) should roll back physical file when DB insert fails and reconcile orphan/missing/corrupted entries', async () => {
    const isolatedDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bethesda-audio-gov-'));
    tempDirsToClean.push(isolatedDir);
    const isolatedStorage = new LocalFileSystemAudioStorageProvider(isolatedDir, env.MAX_AUDIO_FILE_SIZE_BYTES);

    // 1. Simular fallo de inserción en PostgreSQL durante uploadAudio -> 0 archivos huérfanos en disco
    const failingRepo: IAudioRepository = {
      async create() {
        throw new Error('Simulated PostgreSQL constraint error');
      },
      async findById() {
        return null;
      },
      async findBySongId() {
        return [];
      },
      async findAll() {
        return [];
      },
      async delete() {
        return false;
      },
    };
    await withIsolatedTestScope('test-16-rollback-reconcile', async (scope) => {
      const failingService = new AudioService(
        failingRepo,
        isolatedStorage,
        songRepo,
        env.MAX_AUDIO_FILE_SIZE_BYTES,
        globalPythonAudioWorkerBridge,
        scope.auditRepo
      );

      await assert.rejects(
        () =>
          failingService.uploadAudio({
            songId: testSong.id,
            title: 'Failed Insert Rollback',
            filename: 'rollback.mp3',
            mimeType: 'audio/mpeg',
            buffer: makeValidMp3Buffer(2),
            uploadedByUserId: directorUser.id,
          }),
        /Simulated PostgreSQL constraint error/
      );
      assert.deepStrictEqual(
        await isolatedStorage.listKeys(),
        [],
        'El archivo físico debe eliminarse automáticamente si falla el registro en BD'
      );

      // 2. Reconciliación completa (healthy, missing, corrupted y orphan con purgeOrphanFiles)
      const memStore = new Map<string, AudioAsset>();
      const memRepo: IAudioRepository = {
        async create(data: NewAudioAsset) {
          const record: AudioAsset = {
            id: crypto.randomUUID(),
            songId: data.songId,
            title: data.title,
            filename: data.filename,
            storagePath: data.storagePath,
            mimeType: data.mimeType,
            fileSizeBytes: data.fileSizeBytes,
            checksumSha256: data.checksumSha256,
            durationSeconds: data.durationSeconds ?? null,
            uploadedByUserId: data.uploadedByUserId ?? null,
            createdAt: new Date(),
            updatedAt: new Date(),
          };
          memStore.set(record.id, record);
          return record;
        },
        async findById(id: string) {
          return memStore.get(id) ?? null;
        },
        async findBySongId(sId: string) {
          return Array.from(memStore.values()).filter((a) => a.songId === sId);
        },
        async findAll() {
          return Array.from(memStore.values());
        },
        async delete(id: string) {
          return memStore.delete(id);
        },
      };

      const isolatedService = new AudioService(
        memRepo,
        isolatedStorage,
        songRepo,
        env.MAX_AUDIO_FILE_SIZE_BYTES,
        globalPythonAudioWorkerBridge,
        scope.auditRepo
      );
      const healthy = await isolatedService.uploadAudio({
        songId: testSong.id,
        title: 'Healthy',
        filename: 'healthy.mp3',
        mimeType: 'audio/mpeg',
        buffer: makeValidMp3Buffer(3),
      });
      const missing = await isolatedService.uploadAudio({
        songId: testSong.id,
        title: 'Missing',
        filename: 'missing.mp3',
        mimeType: 'audio/mpeg',
        buffer: makeValidMp3Buffer(2),
      });
      const corrupted = await isolatedService.uploadAudio({
        songId: testSong.id,
        title: 'Corrupted',
        filename: 'corrupted.mp3',
        mimeType: 'audio/mpeg',
        buffer: makeValidMp3Buffer(2),
      });

      // Inducir ausencia física de `missing`, adulteración de `corrupted` y crear archivo huérfano
      await isolatedStorage.delete(missing.storagePath);
      const corruptedFullPath = isolatedStorage.resolveSafePath(corrupted.storagePath);
      fs.chmodSync(corruptedFullPath, 0o666);
      fs.writeFileSync(corruptedFullPath, Buffer.from('TAMPERED'));
      const orphanKey = 'orphan-unreferenced.mp3';
      fs.writeFileSync(path.join(isolatedDir, orphanKey), Buffer.from('ORPHAN'));

      const reportDry = await isolatedService.reconcileStorageConsistency({ purgeOrphanFiles: false });
      assert.strictEqual(reportDry.checkedAssets, 3);
      assert.deepStrictEqual(reportDry.healthyAssetIds, [healthy.id]);
      assert.strictEqual(reportDry.missingPhysicalFiles[0]?.assetId, missing.id);
      assert.strictEqual(reportDry.corruptedPhysicalFiles[0]?.assetId, corrupted.id);
      assert.deepStrictEqual(reportDry.orphanFiles, [orphanKey]);
      assert.deepStrictEqual(reportDry.purgedOrphanFiles, []);

      const reportPurge = await isolatedService.reconcileStorageConsistency({ purgeOrphanFiles: true });
      assert.deepStrictEqual(reportPurge.purgedOrphanFiles, [orphanKey]);
      assert.strictEqual(fs.existsSync(path.join(isolatedDir, orphanKey)), false);
      assert.strictEqual(await isolatedStorage.exists(healthy.storagePath), true);
    });
  });

  // CRITERIO 17 (Finding E): Integración real de PythonAudioWorkerBridge en AudioService y rutas HTTP
  it('17. (Finding E) should integrate Python worker into uploadAudio (verifyWithWorker=true), POST /api/v1/audio/:id/verify, and enforce bridge guards', async () => {
    const realMp3 = generateRealMp3WithBundledFfmpeg(0.6);
    const expectedSha = crypto.createHash('sha256').update(realMp3).digest('hex');

    // 1. Subida con verificación sincrónica del worker Python en producción
    const uploadRes = await app.inject({
      method: 'POST',
      url: `/api/v1/songs/${testSong.id}/audio`,
      headers: { authorization: `Bearer ${directorToken}` },
      payload: {
        title: 'MP3 Verificado por Worker',
        filename: 'verified_worship.mp3',
        mimeType: 'audio/mpeg',
        dataBase64: realMp3.toString('base64'),
        verifyWithWorker: true,
      },
    });

    assert.strictEqual(uploadRes.statusCode, 201, uploadRes.body);
    const assetData = uploadRes.json().data;
    createdAudioStoragePaths.add(assetData.storagePath);
    assert.strictEqual(assetData.checksumSha256, expectedSha);

    // 2. Verificación bajo demanda mediante endpoint POST /api/v1/audio/:id/verify
    const verifyRes = await app.inject({
      method: 'POST',
      url: `/api/v1/audio/${assetData.id}/verify`,
      headers: { authorization: `Bearer ${musicianToken}` },
    });
    assert.strictEqual(verifyRes.statusCode, 200, verifyRes.body);
    const verifyJson = verifyRes.json();
    assert.strictEqual(verifyJson.status, 'success');
    assert.strictEqual(verifyJson.data.detectedFormat, 'MP3');
    assert.strictEqual(verifyJson.data.hasId3v2, true);
    assert.strictEqual(verifyJson.data.pcmDecodeVerified, true);
    assert.strictEqual(verifyJson.data.verifiedSha256, expectedSha);

    // 3. Archivo sintético no decodificable con verifyWithWorker=true debe fallar y NO dejar huérfanos en disco
    const beforeKeys = new Set(await storageProvider.listKeys());
    const badUploadRes = await app.inject({
      method: 'POST',
      url: `/api/v1/songs/${testSong.id}/audio`,
      headers: { authorization: `Bearer ${directorToken}` },
      payload: {
        title: 'Corrupt Truncated MP3',
        filename: 'corrupt.mp3',
        mimeType: 'audio/mpeg',
        dataBase64: makeValidMp3Buffer(2).toString('base64'),
        verifyWithWorker: true,
      },
    });
    assert.strictEqual(badUploadRes.statusCode, 400);
    const afterKeys = await storageProvider.listKeys();
    const leaked = afterKeys.filter((k) => !beforeKeys.has(k));
    assert.deepStrictEqual(leaked, [], 'No debe quedar archivo físico en disco si falla el worker');

    // 4. Guardas del puente Node->Python: anti-sobrescritura, anti-URI y AbortSignal
    const realFullPath = storageProvider.resolveSafePath(assetData.storagePath);
    await assert.rejects(
      () =>
        globalPythonAudioWorkerBridge.inspectAndVerifyAudio('guard-overwrite', realFullPath, expectedSha, {
          derivativeWavPath: realFullPath,
        }),
      (err: any) => err instanceof ValidationError && err.message.includes('inmutabilidad')
    );

    await assert.rejects(
      () =>
        globalPythonAudioWorkerBridge.inspectAndVerifyAudio(
          'guard-proto',
          'https://evil.example/audio.mp3',
          expectedSha
        ),
      (err: any) => err instanceof ValidationError && err.message.includes('protocolos externos')
    );

    const ac = new AbortController();
    ac.abort();
    await assert.rejects(
      () =>
        globalPythonAudioWorkerBridge.inspectAndVerifyAudio('guard-abort', realFullPath, expectedSha, {
          signal: ac.signal,
        }),
      (err: any) => err instanceof ValidationError && err.message.includes('AbortSignal')
    );

    await audioService.deleteAudio(assetData.id);
    createdAudioStoragePaths.delete(assetData.storagePath);
  });

  // ==========================================================================
  // AUDITORÍA FINAL DE RUTAS DE FALLO DE ALMACENAMIENTO (CRITERIO 18)
  // ==========================================================================

  it('18.1 should preserve primary DB error and report successful physical rollback on upload DB failure', async () => {
    const isolatedDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bethesda_audit_18_1_'));
    tempDirsToClean.push(isolatedDir);
    const isolatedStorage = new LocalFileSystemAudioStorageProvider(isolatedDir, env.MAX_AUDIO_FILE_SIZE_BYTES);

    const primaryDbError = new Error('Simulated PostgreSQL unique constraint failure on audio_assets');
    const failingRepo: IAudioRepository = {
      async create() {
        throw primaryDbError;
      },
      async findById() {
        return null;
      },
      async findBySongId() {
        return [];
      },
      async findAll() {
        return [];
      },
      async delete() {
        return false;
      },
    };

    await withIsolatedTestScope('test-18-1', async (scope) => {
      const recordedAuditEvents: AuditLogEntity[] = [];
      const auditSpyRepo: IAuditLogRepository = {
        async create(input: CreateAuditLogInput) {
          const created = await scope.auditRepo.create(input);
          recordedAuditEvents.push(created);
          return created;
        },
        async list(opts) {
          return await scope.auditRepo.list(opts);
        },
      };

      const service = new AudioService(
        failingRepo,
        isolatedStorage,
        songRepo,
        env.MAX_AUDIO_FILE_SIZE_BYTES,
        globalPythonAudioWorkerBridge,
        auditSpyRepo
      );

      let thrownErr: any;
      try {
        await service.uploadAudio({
          songId: testSong.id,
          title: 'Rollback Success Audit',
          filename: 'rollback_ok.mp3',
          mimeType: 'audio/mpeg',
          buffer: makeValidMp3Buffer(3),
          uploadedByUserId: directorUser.id,
        });
        assert.fail('uploadAudio debería haber lanzado el error primario de BD');
      } catch (err) {
        thrownErr = err;
      }

      assert.strictEqual(thrownErr, primaryDbError);
      const comp1 = (thrownErr as Error & { compensation?: AudioUploadCompensationReport }).compensation;
      assert.ok(comp1);
      assert.strictEqual(comp1.attempted, true);
      assert.strictEqual(comp1.succeeded, true);
      assert.strictEqual(comp1.persistedToAuditLog, false);
      assert.deepStrictEqual(await isolatedStorage.listKeys(), []);
      assert.strictEqual(service.getRecoveryRecords().length, 0);
      assert.strictEqual(recordedAuditEvents.length, 0);
    });
  });

  it('18.2 should preserve primary upload error, persist recovery record when physical compensation fails, and recover via reconciliation', async () => {
    const isolatedDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bethesda_audit_18_2_'));
    tempDirsToClean.push(isolatedDir);
    const baseStorage = new LocalFileSystemAudioStorageProvider(isolatedDir, env.MAX_AUDIO_FILE_SIZE_BYTES);

    let failPhysicalDelete = true;
    const faultStorage: IAudioStorageProvider = {
      save: (f, b) => baseStorage.save(f, b),
      getStream: (p, s, e, o) => baseStorage.getStream(p, s, e, o),
      getBuffer: (p) => baseStorage.getBuffer(p),
      exists: (p) => baseStorage.exists(p),
      stat: (p) => baseStorage.stat(p),
      resolveSafePath: (p) => baseStorage.resolveSafePath(p),
      listKeys: () => baseStorage.listKeys(),
      delete: async (p) => {
        if (failPhysicalDelete) {
          throw new PersistenceError(`EACCES: simulated permission lock removing ${p}`, {
            storagePath: p,
            code: 'EACCES',
          });
        }
        return await baseStorage.delete(p);
      },
    };

    const primaryDbError = new Error('Simulated PostgreSQL connection timeout during INSERT');
    let rejectDbCreate = true;
    const memStore = new Map<string, AudioAsset>();
    const repo: IAudioRepository = {
      async create(data: NewAudioAsset) {
        if (rejectDbCreate) {
          throw primaryDbError;
        }
        const row: AudioAsset = {
          id: crypto.randomUUID(),
          songId: data.songId,
          title: data.title,
          filename: data.filename,
          storagePath: data.storagePath,
          mimeType: data.mimeType,
          fileSizeBytes: data.fileSizeBytes,
          checksumSha256: data.checksumSha256,
          durationSeconds: data.durationSeconds ?? null,
          uploadedByUserId: data.uploadedByUserId ?? null,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        memStore.set(row.id, row);
        return row;
      },
      async findById(id: string) {
        return memStore.get(id) ?? null;
      },
      async findBySongId(sId: string) {
        return Array.from(memStore.values()).filter((a) => a.songId === sId);
      },
      async findAll() {
        return Array.from(memStore.values());
      },
      async delete(id: string) {
        return memStore.delete(id);
      },
    };

    await withIsolatedTestScope('test-18-2', async (scope) => {
      const recordedAuditEvents: AuditLogEntity[] = [];
      const auditSpyRepo: IAuditLogRepository = {
        async create(input: CreateAuditLogInput) {
          const created = await scope.auditRepo.create(input);
          recordedAuditEvents.push(created);
          return created;
        },
        async list(opts) {
          return await scope.auditRepo.list(opts);
        },
      };

      const service = new AudioService(
        repo,
        faultStorage,
        songRepo,
        env.MAX_AUDIO_FILE_SIZE_BYTES,
        globalPythonAudioWorkerBridge,
        auditSpyRepo
      );

      const mp3Buffer = makeValidMp3Buffer(4);
      const expectedSha = crypto.createHash('sha256').update(mp3Buffer).digest('hex');

      let thrownErr: any;
      try {
        await service.uploadAudio({
          songId: testSong.id,
          title: 'Failed Rollback Orphan',
          filename: 'failed_rollback.mp3',
          mimeType: 'audio/mpeg',
          buffer: mp3Buffer,
          uploadedByUserId: directorUser.id,
        });
        assert.fail('uploadAudio debía haber lanzado el error primario de BD');
      } catch (err) {
        thrownErr = err;
      }

      // 1. Error primario preservado intacto (no enmascarado por el fallo de limpieza)
      assert.strictEqual(thrownErr, primaryDbError);
      const comp2 = (thrownErr as Error & { compensation?: AudioUploadCompensationReport }).compensation;
      assert.ok(comp2);
      assert.strictEqual(comp2.attempted, true);
      assert.strictEqual(comp2.succeeded, false);
      assert.ok(comp2.compensationError?.includes('EACCES'));
      assert.ok(comp2.recoveryRecordId);
      assert.strictEqual(comp2.persistedToAuditLog, true);

      const leakedStoragePath = comp2.storagePath;
      assert.strictEqual(await baseStorage.exists(leakedStoragePath), true);

      // 2. Registro de recuperación accionable persistido tanto en audit_logs como en estado del servicio
      const pendingRecords = service.getRecoveryRecords();
      assert.strictEqual(pendingRecords.length, 1);
      assert.strictEqual(pendingRecords[0]?.recoveryType, 'UPLOAD_COMPENSATION_ORPHAN');
      assert.strictEqual(pendingRecords[0]?.status, 'PENDING_RECOVERY');
      assert.strictEqual(pendingRecords[0]?.storagePath, leakedStoragePath);
      assert.strictEqual(pendingRecords[0]?.checksumSha256, expectedSha);
      assert.strictEqual(pendingRecords[0]?.fileSizeBytes, mp3Buffer.length);
      assert.strictEqual(pendingRecords[0]?.persistedToAuditLog, true);

      const auditFailureEvent = recordedAuditEvents.find(
        (e) => e.eventType === 'AUDIO_UPLOAD_COMPENSATION_FAILED'
      );
      assert.ok(auditFailureEvent, 'Debe persistirse AUDIO_UPLOAD_COMPENSATION_FAILED en audit_logs');
      assert.strictEqual(auditFailureEvent.metadata['storagePath'], leakedStoragePath);

      // 3. Reconciliación mientras el almacenamiento sigue bloqueado registra failedOrphanPurges sin perder trazabilidad
      const blockedRec = await service.reconcileStorageConsistency({ purgeOrphanFiles: true });
      assert.deepStrictEqual(blockedRec.orphanFiles, [leakedStoragePath]);
      assert.deepStrictEqual(blockedRec.purgedOrphanFiles, []);
      assert.strictEqual(blockedRec.failedOrphanPurges[0]?.storagePath, leakedStoragePath);

      // 4. Cuando se resuelve el bloqueo de almacenamiento, la reconciliación purga el huérfano y marca RECOVERED
      failPhysicalDelete = false;
      rejectDbCreate = false;
      const recoveredRec = await service.reconcileStorageConsistency({
        purgeOrphanFiles: true,
        recoverFailedOperations: true,
      });
      assert.deepStrictEqual(recoveredRec.purgedOrphanFiles, [leakedStoragePath]);
      assert.strictEqual(await baseStorage.exists(leakedStoragePath), false);
      assert.strictEqual(recoveredRec.pendingRecoveryRecords.length, 0);
      assert.strictEqual(recoveredRec.recoveredOperations.length, 1);
      assert.strictEqual(recoveredRec.recoveredOperations[0]?.recoveryType, 'UPLOAD_COMPENSATION_ORPHAN');
      assert.ok(recordedAuditEvents.some((e) => e.eventType === 'AUDIO_ORPHAN_FILE_PURGED'));
      assert.ok(recordedAuditEvents.some((e) => e.eventType === 'AUDIO_RECOVERY_COMPLETED'));

      // 5. Re-ejecución idempotente de la reconciliación
      const secondRec = await service.reconcileStorageConsistency({
        purgeOrphanFiles: true,
        recoverFailedOperations: true,
      });
      assert.deepStrictEqual(secondRec.orphanFiles, []);
      assert.deepStrictEqual(secondRec.purgedOrphanFiles, []);
      assert.deepStrictEqual(secondRec.recoveredOperations, []);
    });
  });

  it('18.3 should abort DB deletion and preserve consistent state when physical file deletion fails', async () => {
    const isolatedDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bethesda_audit_18_3_'));
    tempDirsToClean.push(isolatedDir);
    const baseStorage = new LocalFileSystemAudioStorageProvider(isolatedDir, env.MAX_AUDIO_FILE_SIZE_BYTES);

    let blockPhysicalDelete = false;
    const faultStorage: IAudioStorageProvider = {
      save: (f, b) => baseStorage.save(f, b),
      getStream: (p, s, e, o) => baseStorage.getStream(p, s, e, o),
      getBuffer: (p) => baseStorage.getBuffer(p),
      exists: (p) => baseStorage.exists(p),
      stat: (p) => baseStorage.stat(p),
      resolveSafePath: (p) => baseStorage.resolveSafePath(p),
      listKeys: () => baseStorage.listKeys(),
      delete: async (p) => {
        if (blockPhysicalDelete) {
          throw new PersistenceError(`EBUSY: file handle busy on ${p}`, { storagePath: p, code: 'EBUSY' });
        }
        return await baseStorage.delete(p);
      },
    };

    const memStore = new Map<string, AudioAsset>();
    const repo: IAudioRepository = {
      async create(data: NewAudioAsset) {
        const row: AudioAsset = {
          id: crypto.randomUUID(),
          songId: data.songId,
          title: data.title,
          filename: data.filename,
          storagePath: data.storagePath,
          mimeType: data.mimeType,
          fileSizeBytes: data.fileSizeBytes,
          checksumSha256: data.checksumSha256,
          durationSeconds: data.durationSeconds ?? null,
          uploadedByUserId: data.uploadedByUserId ?? null,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        memStore.set(row.id, row);
        return row;
      },
      async findById(id: string) {
        return memStore.get(id) ?? null;
      },
      async findBySongId(sId: string) {
        return Array.from(memStore.values()).filter((a) => a.songId === sId);
      },
      async findAll() {
        return Array.from(memStore.values());
      },
      async delete(id: string) {
        return memStore.delete(id);
      },
    };

    await withIsolatedTestScope('test-18-3', async (scope) => {
      const recordedAuditEvents: AuditLogEntity[] = [];
      const auditSpyRepo: IAuditLogRepository = {
        async create(input: CreateAuditLogInput) {
          const created = await scope.auditRepo.create(input);
          recordedAuditEvents.push(created);
          return created;
        },
        async list(opts) {
          return await scope.auditRepo.list(opts);
        },
      };

      const service = new AudioService(
        repo,
        faultStorage,
        songRepo,
        env.MAX_AUDIO_FILE_SIZE_BYTES,
        globalPythonAudioWorkerBridge,
        auditSpyRepo
      );

      const mp3Buffer = makeValidMp3Buffer(4);
      const asset = await service.uploadAudio({
        songId: testSong.id,
        title: 'Scenario A Physical Failure',
        filename: 'scenario_a.mp3',
        mimeType: 'audio/mpeg',
        buffer: mp3Buffer,
        uploadedByUserId: directorUser.id,
      });

      // Activar fallo de eliminación física antes de deleteAudio
      blockPhysicalDelete = true;
      await assert.rejects(
        () => service.deleteAudio(asset.id, directorUser.id),
        (err: any) => {
          const details = err?.details as Record<string, unknown> | undefined;
          return (
            err instanceof PersistenceError &&
            details?.['dbRecordPreserved'] === true &&
            details?.['assetId'] === asset.id
          );
        }
      );

      // El registro en BD y el archivo físico deben permanecer íntegros y descargables
      assert.ok(await repo.findById(asset.id), 'El registro en BD debe preservarse ante fallo físico');
      assert.strictEqual(await baseStorage.exists(asset.storagePath), true);
      const download = await service.downloadAudio(asset.id);
      assert.strictEqual(Buffer.compare(download.buffer, mp3Buffer), 0);

      const abortRecord = service.getRecoveryRecords().find((r) => r.recoveryType === 'DELETE_PHYSICAL_FAILED');
      assert.ok(abortRecord);
      assert.strictEqual(abortRecord.status, 'ABORTED_DB_PRESERVED');
      assert.ok(recordedAuditEvents.some((e) => e.eventType === 'AUDIO_DELETE_PHYSICAL_FAILED'));

      // Reconciliación confirma activo saludable y no purga su archivo
      const recReport = await service.reconcileStorageConsistency({ purgeOrphanFiles: true });
      assert.deepStrictEqual(recReport.healthyAssetIds, [asset.id]);

      // Al resolver el bloqueo físico, el reintento de deleteAudio completa la eliminación e idempotencia
      blockPhysicalDelete = false;
      assert.strictEqual(await service.deleteAudio(asset.id, directorUser.id), true);
      assert.strictEqual(await repo.findById(asset.id), null);
      assert.strictEqual(await baseStorage.exists(asset.storagePath), false);
      assert.strictEqual(service.getRecoveryRecords()[0]?.status, 'RECOVERED');
      assert.ok(recordedAuditEvents.some((e) => e.eventType === 'AUDIO_RECOVERY_COMPLETED'));

      // Tercer llamado idempotente retorna false
      assert.strictEqual(await service.deleteAudio(asset.id, directorUser.id), false);
    });
  });

  it('18.4 should record actionable recovery metadata when DB deletion fails after physical deletion and complete idempotently via reconciliation & retry', async () => {
    const isolatedDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bethesda_audit_18_4_'));
    tempDirsToClean.push(isolatedDir);
    const baseStorage = new LocalFileSystemAudioStorageProvider(isolatedDir, env.MAX_AUDIO_FILE_SIZE_BYTES);

    let failDbDelete = false;
    const memStore = new Map<string, AudioAsset>();
    const repo: IAudioRepository = {
      async create(data: NewAudioAsset) {
        const row: AudioAsset = {
          id: crypto.randomUUID(),
          songId: data.songId,
          title: data.title,
          filename: data.filename,
          storagePath: data.storagePath,
          mimeType: data.mimeType,
          fileSizeBytes: data.fileSizeBytes,
          checksumSha256: data.checksumSha256,
          durationSeconds: data.durationSeconds ?? null,
          uploadedByUserId: data.uploadedByUserId ?? null,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        memStore.set(row.id, row);
        return row;
      },
      async findById(id: string) {
        return memStore.get(id) ?? null;
      },
      async findBySongId(sId: string) {
        return Array.from(memStore.values()).filter((a) => a.songId === sId);
      },
      async findAll() {
        return Array.from(memStore.values());
      },
      async delete(id: string) {
        if (failDbDelete) {
          throw new Error(`Simulated PostgreSQL deadlock deleting audio_assets(${id})`);
        }
        return memStore.delete(id);
      },
    };

    await withIsolatedTestScope('test-18-4', async (scope) => {
      const recordedAuditEvents: AuditLogEntity[] = [];
      const auditSpyRepo: IAuditLogRepository = {
        async create(input: CreateAuditLogInput) {
          const created = await scope.auditRepo.create(input);
          recordedAuditEvents.push(created);
          return created;
        },
        async list(opts) {
          return await scope.auditRepo.list(opts);
        },
      };

      const service = new AudioService(
        repo,
        baseStorage,
        songRepo,
        env.MAX_AUDIO_FILE_SIZE_BYTES,
        globalPythonAudioWorkerBridge,
        auditSpyRepo
      );

      // Parte A: Recuperación mediante reconcileStorageConsistency({ recoverFailedOperations: true })
      const assetA = await service.uploadAudio({
        songId: testSong.id,
        title: 'Scenario B Reconcile Recovery',
        filename: 'scenario_b_rec.mp3',
        mimeType: 'audio/mpeg',
        buffer: makeValidMp3Buffer(3),
        uploadedByUserId: directorUser.id,
      });

      failDbDelete = true;
      await assert.rejects(
        () => service.deleteAudio(assetA.id, directorUser.id),
        (err: any) => {
          const details = err?.details as Record<string, unknown> | undefined;
          return (
            err instanceof PersistenceError &&
            details?.['physicalDeleted'] === true &&
            details?.['dbDeleted'] === false &&
            typeof details?.['recoveryRecordId'] === 'string'
          );
        }
      );

      assert.strictEqual(await baseStorage.exists(assetA.storagePath), false);
      assert.ok(await repo.findById(assetA.id), 'El registro en BD aún existe pendiente de recuperación');

      // Reconciliación sin recuperación automática expone claramente el desajuste y el pendiente (cero silencio)
      const dryInspect = await service.reconcileStorageConsistency({ recoverFailedOperations: false });
      assert.strictEqual(dryInspect.missingPhysicalFiles[0]?.assetId, assetA.id);
      assert.strictEqual(dryInspect.pendingRecoveryRecords.length, 1);
      assert.strictEqual(
        dryInspect.pendingRecoveryRecords[0]?.recoveryType,
        'DELETE_DB_FAILED_AFTER_PHYSICAL_DELETE'
      );
      assert.ok(
        recordedAuditEvents.some((e) => e.eventType === 'AUDIO_DELETE_DB_FAILED_AFTER_PHYSICAL_DELETE')
      );

      // Restaurar BD y ejecutar reconciliación con recuperación automática
      failDbDelete = false;
      const recoveredReport = await service.reconcileStorageConsistency({
        recoverFailedOperations: true,
      });
      assert.strictEqual(await repo.findById(assetA.id), null);
      assert.deepStrictEqual(recoveredReport.missingPhysicalFiles, []);
      assert.deepStrictEqual(recoveredReport.pendingRecoveryRecords, []);
      assert.strictEqual(recoveredReport.recoveredOperations.length, 1);
      assert.strictEqual(recoveredReport.recoveredOperations[0]?.target, assetA.id);

      // Re-ejecuciones repetidas (reconciliación + retry de deleteAudio) son idempotentes
      const secondPass = await service.reconcileStorageConsistency({
        purgeOrphanFiles: true,
        recoverFailedOperations: true,
      });
      assert.deepStrictEqual(secondPass.recoveredOperations, []);
      assert.strictEqual(await service.deleteAudio(assetA.id, directorUser.id), false);

      // Parte B: Recuperación directa mediante reintento idempotente de deleteAudio()
      const assetB = await service.uploadAudio({
        songId: testSong.id,
        title: 'Scenario B Direct Retry',
        filename: 'scenario_b_retry.mp3',
        mimeType: 'audio/mpeg',
        buffer: makeValidMp3Buffer(3),
        uploadedByUserId: directorUser.id,
      });

      failDbDelete = true;
      await assert.rejects(() => service.deleteAudio(assetB.id, directorUser.id), PersistenceError);

      failDbDelete = false;
      assert.strictEqual(await service.deleteAudio(assetB.id, directorUser.id), true);
      assert.strictEqual(await repo.findById(assetB.id), null);
      assert.strictEqual(await service.deleteAudio(assetB.id, directorUser.id), false);
      assert.strictEqual(
        service.getRecoveryRecords().every((r) => r.status === 'RECOVERED'),
        true
      );
    });
  });

  it('18.5 should protect in-flight concurrent uploads and ambiguous files from reconciliation purge', async () => {
    const isolatedDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bethesda_audit_18_5_'));
    tempDirsToClean.push(isolatedDir);
    const isolatedStorage = new LocalFileSystemAudioStorageProvider(isolatedDir, env.MAX_AUDIO_FILE_SIZE_BYTES);

    let notifyCreateReached!: () => void;
    const createReachedPromise = new Promise<void>((resolve) => {
      notifyCreateReached = resolve;
    });
    let releaseCreate!: () => void;
    const createGatePromise = new Promise<void>((resolve) => {
      releaseCreate = resolve;
    });

    const memStore = new Map<string, AudioAsset>();
    const delayedRepo: IAudioRepository = {
      async create(data: NewAudioAsset) {
        notifyCreateReached();
        await createGatePromise;
        const row: AudioAsset = {
          id: crypto.randomUUID(),
          songId: data.songId,
          title: data.title,
          filename: data.filename,
          storagePath: data.storagePath,
          mimeType: data.mimeType,
          fileSizeBytes: data.fileSizeBytes,
          checksumSha256: data.checksumSha256,
          durationSeconds: data.durationSeconds ?? null,
          uploadedByUserId: data.uploadedByUserId ?? null,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        memStore.set(row.id, row);
        return row;
      },
      async findById(id: string) {
        return memStore.get(id) ?? null;
      },
      async findBySongId(sId: string) {
        return Array.from(memStore.values()).filter((a) => a.songId === sId);
      },
      async findAll() {
        return Array.from(memStore.values());
      },
      async delete(id: string) {
        return memStore.delete(id);
      },
    };

    await withIsolatedTestScope('test-18-5', async (scope) => {
      const service = new AudioService(
        delayedRepo,
        isolatedStorage,
        songRepo,
        env.MAX_AUDIO_FILE_SIZE_BYTES,
        globalPythonAudioWorkerBridge,
        scope.auditRepo
      );

      // Crear un archivo ambiguo (extensión no perteneciente al catálogo de audio gestionado) y un audio reciente
      const ambiguousFile = 'readme-notes.txt';
      fs.writeFileSync(path.join(isolatedDir, ambiguousFile), Buffer.from('DO NOT AUTO-DELETE'));
      const recentUnreferencedAudio = 'recent-maybe-inflight.mp3';
      fs.writeFileSync(path.join(isolatedDir, recentUnreferencedAudio), Buffer.from('RECENT'));

      const mp3Buffer = makeValidMp3Buffer(4);
      const uploadPromise = service.uploadAudio({
        songId: testSong.id,
        title: 'Concurrent In-Flight Upload',
        filename: 'inflight.mp3',
        mimeType: 'audio/mpeg',
        buffer: mp3Buffer,
        uploadedByUserId: directorUser.id,
      });

      // Esperar a que el archivo físico ya exista en disco pero audioRepo.create() aún esté pendiente
      await createReachedPromise;

      const concurrentRec = await service.reconcileStorageConsistency({
        purgeOrphanFiles: true,
        minOrphanAgeMs: 60_000,
      });

      // La subida en vuelo NUNCA debe clasificarse ni purgarse como huérfana
      assert.strictEqual(concurrentRec.skippedInFlightFiles.length, 1);
      const inFlightKey = concurrentRec.skippedInFlightFiles[0]!;
      assert.strictEqual(concurrentRec.orphanFiles.includes(inFlightKey), false);
      assert.strictEqual(concurrentRec.purgedOrphanFiles.includes(inFlightKey), false);
      assert.strictEqual(await isolatedStorage.exists(inFlightKey), true);

      // Los archivos ambiguos (extensión desconocida o dentro de ventana de seguridad) NUNCA se purgan automáticamente
      assert.deepStrictEqual(concurrentRec.purgedOrphanFiles, []);
      assert.ok(concurrentRec.ambiguousFiles.some((a) => a.storagePath === ambiguousFile));
      assert.ok(concurrentRec.ambiguousFiles.some((a) => a.storagePath === recentUnreferencedAudio));
      assert.strictEqual(fs.existsSync(path.join(isolatedDir, ambiguousFile)), true);
      assert.strictEqual(fs.existsSync(path.join(isolatedDir, recentUnreferencedAudio)), true);

      // Liberar barrera para finalizar la subida y verificar descarga íntegra SHA-256
      releaseCreate();
      const createdAsset = await uploadPromise;
      assert.strictEqual(createdAsset.storagePath, inFlightKey);
      const downloaded = await service.downloadAudio(createdAsset.id);
      assert.strictEqual(Buffer.compare(downloaded.buffer, mp3Buffer), 0);
    });
  });

  // =========================================================================
  // CRITERIO 19: REHIDRATACIÓN Y RECUPERACIÓN DURABLE TRAS REINICIO DE BACKEND
  // =========================================================================

  function createInMemoryAudioRepo(
    memStore: Map<string, AudioAsset>,
    options: {
      failCreate?: () => Error | null;
      failDelete?: () => Error | null;
      onDeleteCalled?: () => void;
    } = {}
  ): IAudioRepository {
    return {
      async create(data: NewAudioAsset) {
        const err = options.failCreate?.() ?? null;
        if (err) throw err;
        const row: AudioAsset = {
          id: crypto.randomUUID(),
          songId: data.songId,
          title: data.title,
          filename: data.filename,
          storagePath: data.storagePath,
          mimeType: data.mimeType,
          fileSizeBytes: data.fileSizeBytes,
          checksumSha256: data.checksumSha256,
          durationSeconds: data.durationSeconds ?? null,
          uploadedByUserId: data.uploadedByUserId ?? null,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        memStore.set(row.id, row);
        return row;
      },
      async findById(id: string) {
        return memStore.get(id) ?? null;
      },
      async findBySongId(sId: string) {
        return Array.from(memStore.values()).filter((a) => a.songId === sId);
      },
      async findAll() {
        return Array.from(memStore.values());
      },
      async delete(id: string) {
        options.onDeleteCalled?.();
        const err = options.failDelete?.() ?? null;
        if (err) throw err;
        return memStore.delete(id);
      },
    };
  }

  function createFaultyStorageWrapper(
    baseStorage: LocalFileSystemAudioStorageProvider,
    options: {
      failDelete?: () => Error | null;
      onDeleteCalled?: () => void;
    } = {}
  ): IAudioStorageProvider {
    return {
      save: (f, b) => baseStorage.save(f, b),
      getStream: (p, s, e, o) => baseStorage.getStream(p, s, e, o),
      getBuffer: (p) => baseStorage.getBuffer(p),
      exists: (p) => baseStorage.exists(p),
      stat: (p) => baseStorage.stat(p),
      resolveSafePath: (p) => baseStorage.resolveSafePath(p),
      listKeys: () => baseStorage.listKeys(),
      delete: async (p) => {
        options.onDeleteCalled?.();
        const err = options.failDelete?.() ?? null;
        if (err) throw err;
        return await baseStorage.delete(p);
      },
    };
  }

  it('19.1 (Scenario A) should rehydrate upload compensation failure after backend restart and recover orphan safely', async () => {
    await withIsolatedTestScope('test-19-1', async (scope) => {
      const isolatedDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bethesda_rehydrate_19_1_'));
      tempDirsToClean.push(isolatedDir);
      const baseStorage = new LocalFileSystemAudioStorageProvider(isolatedDir, env.MAX_AUDIO_FILE_SIZE_BYTES);
      const faultStorage = createFaultyStorageWrapper(baseStorage, {
        failDelete: () => new PersistenceError('EPERM: simulated disk lock during upload compensation'),
      });

      const dbRows = new Map<string, AudioAsset>();
      const primaryDbErr = new PersistenceError('PostgreSQL connection dropped during audio_assets insert');
      const failingCreateRepo = createInMemoryAudioRepo(dbRows, {
        failCreate: () => primaryDbErr,
      });

      const process1Service = new AudioService(
        failingCreateRepo,
        faultStorage,
        songRepo,
        env.MAX_AUDIO_FILE_SIZE_BYTES,
        globalPythonAudioWorkerBridge,
        scope.auditRepo
      );

      const mp3Buffer = makeValidMp3Buffer(4);
      let thrownErr: unknown = null;
      try {
        await process1Service.uploadAudio({
          songId: testSong.id,
          title: 'Restart Orphan Recovery',
          filename: 'restart-orphan.mp3',
          mimeType: 'audio/mpeg',
          buffer: mp3Buffer,
          uploadedByUserId: directorUser.id,
        });
      } catch (err) {
        thrownErr = err;
      }

      assert.strictEqual(thrownErr, primaryDbErr);
      const compensation = (thrownErr as Error & { compensation?: AudioUploadCompensationReport }).compensation;
      assert.ok(compensation);
      assert.strictEqual(compensation.attempted, true);
      assert.strictEqual(compensation.succeeded, false);
      assert.strictEqual(compensation.persistedToAuditLog, true);
      assert.strictEqual(compensation.durablyRecorded, true);
      assert.ok(compensation.recoveryRecordId);

      const originalRec = process1Service
        .getRecoveryRecords()
        .find((r) => r.id === compensation.recoveryRecordId);
      assert.ok(originalRec);
      assert.strictEqual(originalRec.status, 'PENDING_RECOVERY');
      assert.strictEqual(originalRec.lifecycleState, 'RECOVERY_PENDING');
      assert.strictEqual(originalRec.durablyRecorded, true);
      assert.strictEqual(await baseStorage.exists(originalRec.storagePath), true);

      // Simular reinicio completo del backend: nueva instancia AudioService sin estado previo en memoria
      const process2Repo = createInMemoryAudioRepo(dbRows);
      const process2Storage = new LocalFileSystemAudioStorageProvider(isolatedDir, env.MAX_AUDIO_FILE_SIZE_BYTES);
      const process2Service = new AudioService(
        process2Repo,
        process2Storage,
        songRepo,
        env.MAX_AUDIO_FILE_SIZE_BYTES,
        globalPythonAudioWorkerBridge,
        scope.auditRepo
      );

      assert.deepStrictEqual(process2Service.getRecoveryRecords(), []);

      const rehydrationReport = await process2Service.rehydrateRecoveryRecordsFromAuditLogs();
      assert.strictEqual(rehydrationReport.rehydrationSucceeded, true);
      assert.strictEqual(rehydrationReport.reconstructedRecords, 1);
      assert.strictEqual(rehydrationReport.pendingCount, 1);
      assert.strictEqual(rehydrationReport.completedCount, 0);

      const restored = process2Service.getRecoveryRecords();
      assert.strictEqual(restored.length, 1);
      const restoredRec = restored[0]!;
      assert.strictEqual(restoredRec.id, originalRec.id);
      assert.strictEqual(restoredRec.recoveryType, 'UPLOAD_COMPENSATION_ORPHAN');
      assert.strictEqual(restoredRec.storagePath, originalRec.storagePath);
      assert.strictEqual(restoredRec.checksumSha256, originalRec.checksumSha256);
      assert.strictEqual(restoredRec.fileSizeBytes, originalRec.fileSizeBytes);
      assert.strictEqual(restoredRec.createdAt, originalRec.createdAt);
      assert.strictEqual(restoredRec.durablyRecorded, true);
      assert.strictEqual(restoredRec.lifecycleState, 'RECOVERY_PENDING');

      // Recuperar tras el reinicio respetando minOrphanAgeMs alto: el registro durable + SHA-256 autorizan la purga
      const recReport = await process2Service.reconcileStorageConsistency({
        purgeOrphanFiles: true,
        recoverFailedOperations: true,
        minOrphanAgeMs: 60_000,
      });

      assert.deepStrictEqual(recReport.purgedOrphanFiles, [originalRec.storagePath]);
      assert.strictEqual(await process2Storage.exists(originalRec.storagePath), false);
      assert.deepStrictEqual(recReport.pendingRecoveryRecords, []);
      assert.strictEqual(recReport.recoveredOperations.length, 1);
      assert.strictEqual(recReport.recoveredOperations[0]?.recoveryRecordId, originalRec.id);
      assert.strictEqual(recReport.recoveredOperations[0]?.recoveryType, 'UPLOAD_COMPENSATION_ORPHAN');

      const postRecovery = process2Service.getRecoveryRecords()[0]!;
      assert.strictEqual(postRecovery.status, 'RECOVERED');
      assert.strictEqual(postRecovery.lifecycleState, 'RECOVERY_COMPLETED');

      const auditEvents = await scope.auditRepo.list({
        eventTypes: ['AUDIO_ORPHAN_FILE_PURGED', 'AUDIO_RECOVERY_COMPLETED'],
        orderDirection: 'asc',
      });
      assert.ok(auditEvents.some((e) => e.eventType === 'AUDIO_ORPHAN_FILE_PURGED'));
      assert.ok(auditEvents.some((e) => e.eventType === 'AUDIO_RECOVERY_COMPLETED'));
    });
  });

  it('19.2 (Scenario B) should rehydrate DB-delete failure after physical delete across restart and clean DB row only after verifying absence and metadata match', async () => {
    await withIsolatedTestScope('test-19-2', async (scope) => {
      const isolatedDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bethesda_rehydrate_19_2_'));
      tempDirsToClean.push(isolatedDir);
      const storage = new LocalFileSystemAudioStorageProvider(isolatedDir, env.MAX_AUDIO_FILE_SIZE_BYTES);
      const dbRows = new Map<string, AudioAsset>();

      let failDbDelete = false;
      const process1Repo = createInMemoryAudioRepo(dbRows, {
        failDelete: () =>
          failDbDelete ? new PersistenceError('Simulated PostgreSQL deadlock during DELETE FROM audio_assets') : null,
      });

      const process1Service = new AudioService(
        process1Repo,
        storage,
        songRepo,
        env.MAX_AUDIO_FILE_SIZE_BYTES,
        globalPythonAudioWorkerBridge,
        scope.auditRepo
      );

      const mp3Buffer = makeValidMp3Buffer(4);
      const uploaded = await process1Service.uploadAudio({
        songId: testSong.id,
        title: 'Scenario B Asset',
        filename: 'scenario-b.mp3',
        mimeType: 'audio/mpeg',
        buffer: mp3Buffer,
        uploadedByUserId: directorUser.id,
      });

      failDbDelete = true;
      let deleteErr: unknown = null;
      try {
        await process1Service.deleteAudio(uploaded.id, directorUser.id);
      } catch (err) {
        deleteErr = err;
      }

      assert.ok(deleteErr instanceof PersistenceError);
      assert.strictEqual(await storage.exists(uploaded.storagePath), false);
      assert.strictEqual(dbRows.has(uploaded.id), true);

      const originalRec = process1Service.getRecoveryRecords()[0]!;
      assert.strictEqual(originalRec.recoveryType, 'DELETE_DB_FAILED_AFTER_PHYSICAL_DELETE');
      assert.strictEqual(originalRec.assetId, uploaded.id);
      assert.strictEqual(originalRec.status, 'PENDING_RECOVERY');
      assert.strictEqual(originalRec.lifecycleState, 'RECOVERY_PENDING');
      assert.strictEqual(originalRec.durablyRecorded, true);

      // Simular reinicio del backend con la BD ya disponible nuevamente
      const process2Repo = createInMemoryAudioRepo(dbRows);
      const process2Service = new AudioService(
        process2Repo,
        storage,
        songRepo,
        env.MAX_AUDIO_FILE_SIZE_BYTES,
        globalPythonAudioWorkerBridge,
        scope.auditRepo
      );

      const rehydration = await process2Service.rehydrateRecoveryRecordsFromAuditLogs();
      assert.strictEqual(rehydration.rehydrationSucceeded, true);
      assert.strictEqual(rehydration.reconstructedRecords, 1);
      assert.strictEqual(rehydration.pendingCount, 1);

      const restoredRec = process2Service.getRecoveryRecords()[0]!;
      assert.strictEqual(restoredRec.id, originalRec.id);
      assert.strictEqual(restoredRec.assetId, uploaded.id);
      assert.strictEqual(restoredRec.storagePath, uploaded.storagePath);
      assert.strictEqual(restoredRec.checksumSha256, uploaded.checksumSha256);
      assert.strictEqual(restoredRec.fileSizeBytes, uploaded.fileSizeBytes);
      assert.strictEqual(restoredRec.createdAt, originalRec.createdAt);

      const recReport = await process2Service.reconcileStorageConsistency({
        recoverFailedOperations: true,
      });

      assert.strictEqual(dbRows.has(uploaded.id), false);
      assert.strictEqual(recReport.pendingRecoveryRecords.length, 0);
      assert.strictEqual(recReport.recoveredOperations.length, 1);
      assert.strictEqual(recReport.recoveredOperations[0]?.recoveryRecordId, originalRec.id);
      assert.strictEqual(recReport.recoveredOperations[0]?.recoveryType, 'DELETE_DB_FAILED_AFTER_PHYSICAL_DELETE');

      const finalRec = process2Service.getRecoveryRecords()[0]!;
      assert.strictEqual(finalRec.status, 'RECOVERED');
      assert.strictEqual(finalRec.lifecycleState, 'RECOVERY_COMPLETED');
    });
  });

  it('19.3 (Scenario C) should never re-execute or resurrect previously completed recoveries across subsequent restarts', async () => {
    await withIsolatedTestScope('test-19-3', async (scope) => {
      const isolatedDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bethesda_rehydrate_19_3_'));
      tempDirsToClean.push(isolatedDir);
      const baseStorage = new LocalFileSystemAudioStorageProvider(isolatedDir, env.MAX_AUDIO_FILE_SIZE_BYTES);
      const dbRows = new Map<string, AudioAsset>();

      // 1. Generar y recuperar un UPLOAD_COMPENSATION_ORPHAN
      let blockStorageDelete = true;
      const faultStorage = createFaultyStorageWrapper(baseStorage, {
        failDelete: () => (blockStorageDelete ? new PersistenceError('EBUSY') : null),
      });
      const serviceA = new AudioService(
        createInMemoryAudioRepo(dbRows, {
          failCreate: () => new PersistenceError('DB insert fail for Scenario C'),
        }),
        faultStorage,
        songRepo,
        env.MAX_AUDIO_FILE_SIZE_BYTES,
        globalPythonAudioWorkerBridge,
        scope.auditRepo
      );
      await assert.rejects(
        () =>
          serviceA.uploadAudio({
            songId: testSong.id,
            title: 'Completed Upload Orphan',
            filename: 'completed-c-upload.mp3',
            mimeType: 'audio/mpeg',
            buffer: makeValidMp3Buffer(4),
            uploadedByUserId: directorUser.id,
          }),
        PersistenceError
      );

      // 2. Generar un DELETE_DB_FAILED_AFTER_PHYSICAL_DELETE
      let failDbDelete = false;
      const repoB = createInMemoryAudioRepo(dbRows, {
        failDelete: () => (failDbDelete ? new PersistenceError('DB delete fail for Scenario C') : null),
      });
      const serviceB = new AudioService(
        repoB,
        baseStorage,
        songRepo,
        env.MAX_AUDIO_FILE_SIZE_BYTES,
        globalPythonAudioWorkerBridge,
        scope.auditRepo
      );
      const assetB = await serviceB.uploadAudio({
        songId: testSong.id,
        title: 'Completed Delete Orphan',
        filename: 'completed-c-delete.mp3',
        mimeType: 'audio/mpeg',
        buffer: makeValidMp3Buffer(4),
        uploadedByUserId: directorUser.id,
      });
      failDbDelete = true;
      await assert.rejects(() => serviceB.deleteAudio(assetB.id, directorUser.id), PersistenceError);

      // 3. Ejecutar recuperación limpia tras un primer reinicio
      blockStorageDelete = false;
      failDbDelete = false;
      const recoveryService = new AudioService(
        createInMemoryAudioRepo(dbRows),
        baseStorage,
        songRepo,
        env.MAX_AUDIO_FILE_SIZE_BYTES,
        globalPythonAudioWorkerBridge,
        scope.auditRepo
      );
      const firstRecovery = await recoveryService.reconcileStorageConsistency({
        purgeOrphanFiles: true,
        recoverFailedOperations: true,
        minOrphanAgeMs: 60_000,
      });
      assert.strictEqual(firstRecovery.pendingRecoveryRecords.length, 0);
      assert.strictEqual(firstRecovery.recoveredOperations.length, 2);

      // 4. Simular un nuevo reinicio y verificar 0 ejecuciones repetidas y 0 resurrecciones
      let storageDeleteCalls = 0;
      let repoDeleteCalls = 0;
      const spiedStorage = createFaultyStorageWrapper(baseStorage, {
        onDeleteCalled: () => {
          storageDeleteCalls += 1;
        },
      });
      const spiedRepo = createInMemoryAudioRepo(dbRows, {
        onDeleteCalled: () => {
          repoDeleteCalls += 1;
        },
      });
      const restartedService = new AudioService(
        spiedRepo,
        spiedStorage,
        songRepo,
        env.MAX_AUDIO_FILE_SIZE_BYTES,
        globalPythonAudioWorkerBridge,
        scope.auditRepo
      );

      const rehydrateAfterCompletion = await restartedService.rehydrateRecoveryRecordsFromAuditLogs();
      assert.strictEqual(rehydrateAfterCompletion.rehydrationSucceeded, true);
      assert.strictEqual(rehydrateAfterCompletion.reconstructedRecords, 2);
      assert.strictEqual(rehydrateAfterCompletion.pendingCount, 0);
      assert.strictEqual(rehydrateAfterCompletion.completedCount, 2);

      const secondReconcile = await restartedService.reconcileStorageConsistency({
        purgeOrphanFiles: true,
        recoverFailedOperations: true,
        minOrphanAgeMs: 0,
      });
      assert.deepStrictEqual(secondReconcile.recoveredOperations, []);
      assert.deepStrictEqual(secondReconcile.pendingRecoveryRecords, []);
      assert.deepStrictEqual(secondReconcile.purgedOrphanFiles, []);
      assert.strictEqual(storageDeleteCalls, 0);
      assert.strictEqual(repoDeleteCalls, 0);
      assert.ok(
        restartedService
          .getRecoveryRecords()
          .every((r) => r.status === 'RECOVERED' && r.lifecycleState === 'RECOVERY_COMPLETED')
      );
    });
  });

  it('19.4 (Scenario D) should deterministically deduplicate duplicate recovery audit events across restart', async () => {
    await withIsolatedTestScope('test-19-4', async (scope) => {
      const isolatedDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bethesda_rehydrate_19_4_'));
      tempDirsToClean.push(isolatedDir);
      const baseStorage = new LocalFileSystemAudioStorageProvider(isolatedDir, env.MAX_AUDIO_FILE_SIZE_BYTES);
      const mp3Buffer = makeValidMp3Buffer(4);
      const saved = await baseStorage.save('dup-target.mp3', mp3Buffer);
      const checksumSha256 = crypto.createHash('sha256').update(mp3Buffer).digest('hex');

      const recIdA = crypto.randomUUID();
      const recIdB = crypto.randomUUID();
      const createdAtIso = new Date().toISOString();

      const buildMeta = (recoveryRecordId: string) => ({
        recoveryRecordId,
        recoveryType: 'UPLOAD_COMPENSATION_ORPHAN',
        status: 'PENDING_RECOVERY',
        songId: testSong.id,
        storagePath: saved.storagePath,
        filename: 'dup-target.mp3',
        mimeType: 'audio/mpeg',
        checksumSha256,
        fileSizeBytes: mp3Buffer.byteLength,
        primaryError: 'Simulated duplicate primary DB error',
        compensationError: 'Simulated duplicate compensation error',
        createdAt: createdAtIso,
      });

      await scope.auditRepo.create({
        eventType: 'AUDIO_UPLOAD_COMPENSATION_FAILED',
        userId: directorUser.id,
        resource: saved.storagePath,
        metadata: buildMeta(recIdA),
      });
      await new Promise((r) => setTimeout(r, 15));
      // Duplicado con mismo recoveryRecordId
      await scope.auditRepo.create({
        eventType: 'AUDIO_UPLOAD_COMPENSATION_FAILED',
        userId: directorUser.id,
        resource: saved.storagePath,
        metadata: buildMeta(recIdA),
      });
      await new Promise((r) => setTimeout(r, 15));
      // Duplicado con distinto recoveryRecordId apuntando al mismo storagePath
      await scope.auditRepo.create({
        eventType: 'AUDIO_UPLOAD_COMPENSATION_FAILED',
        userId: directorUser.id,
        resource: saved.storagePath,
        metadata: buildMeta(recIdB),
      });

      let deleteCalls = 0;
      const spiedStorage = createFaultyStorageWrapper(baseStorage, {
        onDeleteCalled: () => {
          deleteCalls += 1;
        },
      });
      const dbRows = new Map<string, AudioAsset>();
      const restartedService = new AudioService(
        createInMemoryAudioRepo(dbRows),
        spiedStorage,
        songRepo,
        env.MAX_AUDIO_FILE_SIZE_BYTES,
        globalPythonAudioWorkerBridge,
        scope.auditRepo
      );

      const rehydration = await restartedService.rehydrateRecoveryRecordsFromAuditLogs();
      assert.strictEqual(rehydration.rehydrationSucceeded, true);
      assert.strictEqual(rehydration.reconstructedRecords, 1);
      assert.strictEqual(rehydration.pendingCount, 1);

      const canonicalRecords = restartedService.getRecoveryRecords();
      assert.strictEqual(canonicalRecords.length, 1);
      assert.strictEqual(canonicalRecords[0]!.id, recIdA);
      assert.ok(canonicalRecords[0]!.aliasRecoveryIds?.includes(recIdB));

      const recReport = await restartedService.reconcileStorageConsistency({
        purgeOrphanFiles: true,
        recoverFailedOperations: true,
        minOrphanAgeMs: 60_000,
      });
      assert.strictEqual(deleteCalls, 1);
      assert.deepStrictEqual(recReport.purgedOrphanFiles, [saved.storagePath]);
      assert.deepStrictEqual(recReport.pendingRecoveryRecords, []);
      assert.strictEqual(await baseStorage.exists(saved.storagePath), false);

      // Verificar en un segundo reinicio que tanto el ID canónico como el alias permanecen completados
      const restartedAgain = new AudioService(
        createInMemoryAudioRepo(dbRows),
        baseStorage,
        songRepo,
        env.MAX_AUDIO_FILE_SIZE_BYTES,
        globalPythonAudioWorkerBridge,
        scope.auditRepo
      );
      const rehydrationAgain = await restartedAgain.rehydrateRecoveryRecordsFromAuditLogs();
      assert.strictEqual(rehydrationAgain.reconstructedRecords, 1);
      assert.strictEqual(rehydrationAgain.pendingCount, 0);
      assert.strictEqual(rehydrationAgain.completedCount, 1);
    });
  });

  it('19.5 (Scenario E) should reject malformed recovery events without fabrication and block unsafe auto-purge when PostgreSQL audit is unavailable', async () => {
    await withIsolatedTestScope('test-19-5', async (scope) => {
      // Subcaso E1: eventos malformados/incompletos en PostgreSQL audit_logs
      const dirE1 = fs.mkdtempSync(path.join(os.tmpdir(), 'bethesda_rehydrate_19_5_e1_'));
      tempDirsToClean.push(dirE1);
      const storageE1 = new LocalFileSystemAudioStorageProvider(dirE1, env.MAX_AUDIO_FILE_SIZE_BYTES);
      const mp3Buffer = makeValidMp3Buffer(4);
      const savedMalformed = await storageE1.save('malformed-protected.mp3', mp3Buffer);
      const oldTime = new Date(Date.now() - 10 * 60_000);
      fs.utimesSync(storageE1.resolveSafePath(savedMalformed.storagePath), oldTime, oldTime);

      // 1. Falta checksumSha256 obligatorio para el archivo guardado en disco
      await scope.auditRepo.create({
        eventType: 'AUDIO_UPLOAD_COMPENSATION_FAILED',
        userId: directorUser.id,
        resource: savedMalformed.storagePath,
        metadata: {
          recoveryRecordId: crypto.randomUUID(),
          recoveryType: 'UPLOAD_COMPENSATION_ORPHAN',
          songId: testSong.id,
          storagePath: savedMalformed.storagePath,
          filename: 'malformed-protected.mp3',
          mimeType: 'audio/mpeg',
          fileSizeBytes: mp3Buffer.byteLength,
        },
      });
      // 2. checksumSha256 inválido (no hex SHA-256)
      await scope.auditRepo.create({
        eventType: 'AUDIO_UPLOAD_COMPENSATION_FAILED',
        userId: directorUser.id,
        resource: 'other-invalid.mp3',
        metadata: {
          recoveryRecordId: crypto.randomUUID(),
          songId: testSong.id,
          storagePath: 'other-invalid.mp3',
          filename: 'other-invalid.mp3',
          mimeType: 'audio/mpeg',
          checksumSha256: 'not-a-valid-sha256',
          fileSizeBytes: mp3Buffer.byteLength,
        },
      });
      // 3. DELETE_DB_FAILED_AFTER_PHYSICAL_DELETE sin assetId obligatorio
      await scope.auditRepo.create({
        eventType: 'AUDIO_DELETE_DB_FAILED_AFTER_PHYSICAL_DELETE',
        userId: directorUser.id,
        resource: 'missing-asset-id.mp3',
        metadata: {
          recoveryRecordId: crypto.randomUUID(),
          songId: testSong.id,
          storagePath: 'missing-asset-id.mp3',
          filename: 'missing-asset-id.mp3',
          mimeType: 'audio/mpeg',
          checksumSha256: 'a'.repeat(64),
          fileSizeBytes: 1024,
        },
      });

      const dbRowsE1 = new Map<string, AudioAsset>();
      const serviceE1 = new AudioService(
        createInMemoryAudioRepo(dbRowsE1),
        storageE1,
        songRepo,
        env.MAX_AUDIO_FILE_SIZE_BYTES,
        globalPythonAudioWorkerBridge,
        scope.auditRepo
      );

      const rehydrationE1 = await serviceE1.rehydrateRecoveryRecordsFromAuditLogs();
      assert.strictEqual(rehydrationE1.rehydrationSucceeded, true);
      assert.strictEqual(rehydrationE1.reconstructedRecords, 0);
      assert.strictEqual(rehydrationE1.malformedEvents.length, 3);
      assert.strictEqual(rehydrationE1.manualInterventionCount, 3);
      assert.deepStrictEqual(serviceE1.getRecoveryRecords(), []);
      assert.ok(
        serviceE1
          .getMalformedRecoveryAuditEntries()
          .every((m) => m.lifecycleState === 'MANUAL_INTERVENTION_REQUIRED')
      );

      const reconcileE1 = await serviceE1.reconcileStorageConsistency({
        purgeOrphanFiles: true,
        recoverFailedOperations: true,
        minOrphanAgeMs: 60_000,
      });
      assert.deepStrictEqual(reconcileE1.purgedOrphanFiles, []);
      assert.ok(reconcileE1.ambiguousFiles.some((f) => f.storagePath === savedMalformed.storagePath));
      assert.strictEqual(await storageE1.exists(savedMalformed.storagePath), true);

      // Subcaso E2: falla escritura en PostgreSQL audit_logs -> registro local marcado no durable y nunca auto-purgado
      const dirE2 = fs.mkdtempSync(path.join(os.tmpdir(), 'bethesda_rehydrate_19_5_e2_'));
      tempDirsToClean.push(dirE2);
      const storageE2Base = new LocalFileSystemAudioStorageProvider(dirE2, env.MAX_AUDIO_FILE_SIZE_BYTES);
      let blockDeleteE2 = true;
      const storageE2 = createFaultyStorageWrapper(storageE2Base, {
        failDelete: () => (blockDeleteE2 ? new PersistenceError('EPERM') : null),
      });
      const unavailableWriteAuditRepo: IAuditLogRepository = {
        async create() {
          throw new Error('ECONNREFUSED postgresql audit_logs write failed');
        },
        async list() {
          return [];
        },
      };
      const serviceE2 = new AudioService(
        createInMemoryAudioRepo(new Map<string, AudioAsset>(), {
          failCreate: () => new PersistenceError('DB upload insert error'),
        }),
        storageE2,
        songRepo,
        env.MAX_AUDIO_FILE_SIZE_BYTES,
        globalPythonAudioWorkerBridge,
        unavailableWriteAuditRepo
      );

      let errE2: unknown = null;
      try {
        await serviceE2.uploadAudio({
          songId: testSong.id,
          title: 'Non Durable Audit Test',
          filename: 'non-durable.mp3',
          mimeType: 'audio/mpeg',
          buffer: mp3Buffer,
          uploadedByUserId: directorUser.id,
        });
      } catch (err) {
        errE2 = err;
      }

      const compE2 = (errE2 as Error & { compensation?: AudioUploadCompensationReport }).compensation;
      assert.ok(compE2);
      assert.strictEqual(compE2.persistedToAuditLog, false);
      assert.strictEqual(compE2.durablyRecorded, false);

      const recE2Local = serviceE2.getRecoveryRecords()[0]!;
      assert.strictEqual(recE2Local.durablyRecorded, false);
      assert.strictEqual(recE2Local.status, 'MANUAL_INTERVENTION_REQUIRED');
      assert.strictEqual(recE2Local.lifecycleState, 'MANUAL_INTERVENTION_REQUIRED');

      // Envejecer el archivo y habilitar eliminación física: aún así NO debe auto-purgarse porque no es durable
      blockDeleteE2 = false;
      fs.utimesSync(storageE2Base.resolveSafePath(recE2Local.storagePath), oldTime, oldTime);

      const reconcileE2 = await serviceE2.reconcileStorageConsistency({
        purgeOrphanFiles: true,
        recoverFailedOperations: true,
        minOrphanAgeMs: 60_000,
      });
      assert.strictEqual(reconcileE2.manualInterventionRecords.length, 1);
      assert.deepStrictEqual(reconcileE2.recoveredOperations, []);
      assert.deepStrictEqual(reconcileE2.purgedOrphanFiles, []);
      assert.ok(reconcileE2.ambiguousFiles.some((f) => f.storagePath === recE2Local.storagePath));
      assert.strictEqual(await storageE2Base.exists(recE2Local.storagePath), true);

      // Subcaso E3: falla lectura de PostgreSQL audit_logs en rehidratación -> rehydrationSucceeded=false y bloqueo de purga
      const dirE3 = fs.mkdtempSync(path.join(os.tmpdir(), 'bethesda_rehydrate_19_5_e3_'));
      tempDirsToClean.push(dirE3);
      const storageE3 = new LocalFileSystemAudioStorageProvider(dirE3, env.MAX_AUDIO_FILE_SIZE_BYTES);
      const agedFileE3 = await storageE3.save('aged-unverified.mp3', mp3Buffer);
      fs.utimesSync(storageE3.resolveSafePath(agedFileE3.storagePath), oldTime, oldTime);

      const unavailableReadAuditRepo: IAuditLogRepository = {
        async create(input) {
          return await scope.auditRepo.create(input);
        },
        async list() {
          throw new Error('PostgreSQL timeout reading audit_logs');
        },
      };
      const serviceE3 = new AudioService(
        createInMemoryAudioRepo(new Map<string, AudioAsset>()),
        storageE3,
        songRepo,
        env.MAX_AUDIO_FILE_SIZE_BYTES,
        globalPythonAudioWorkerBridge,
        unavailableReadAuditRepo
      );

      const reconcileE3 = await serviceE3.reconcileStorageConsistency({
        purgeOrphanFiles: true,
        recoverFailedOperations: true,
        minOrphanAgeMs: 60_000,
      });
      assert.strictEqual(reconcileE3.rehydrationReport.rehydrationSucceeded, false);
      assert.ok(reconcileE3.rehydrationReport.error);
      assert.deepStrictEqual(reconcileE3.purgedOrphanFiles, []);
      assert.ok(reconcileE3.ambiguousFiles.some((f) => f.storagePath === agedFileE3.storagePath));
      assert.strictEqual(await storageE3.exists(agedFileE3.storagePath), true);
    });
  });

  // =========================================================================
  // CRITERIO 20: AISLAMIENTO NO DESTRUCTIVO DE AUDITORÍA EN PRUEBAS (FINDING A)
  // =========================================================================

  it('20.1 (Finding A / Scenario A) should preserve unrelated historical AUDIO_ audit records across suite execution and correlated cleanup', async () => {
    assert.ok(historicalSeedAuditId, 'historicalSeedAuditId debe haber sido sembrado en before()');

    const beforeCleanup = await pool.query<{ id: string; event_type: string }>(
      'SELECT id, event_type FROM audit_logs WHERE id = $1',
      [historicalSeedAuditId]
    );
    assert.strictEqual(beforeCleanup.rows.length, 1);
    assert.strictEqual(beforeCleanup.rows[0]?.event_type, 'AUDIO_HISTORICAL_AUDIT_SEED');

    // Incluso pasando el ID histórico explícitamente, la cláusula SQL por testRunCorrelationId debe preservarlo intacto
    const deletedCount = await cleanupCorrelatedTestAuditLogs({
      targetIds: [historicalSeedAuditId],
    });
    assert.strictEqual(deletedCount, 0);

    const afterCleanup = await pool.query<{ id: string }>(
      'SELECT id FROM audit_logs WHERE id = $1',
      [historicalSeedAuditId]
    );
    assert.strictEqual(afterCleanup.rows.length, 1);

    if (preExistingAuditLogIds.length > 0) {
      const preExistingRes = await pool.query<{ count: string }>(
        'SELECT COUNT(*)::text AS count FROM audit_logs WHERE id = ANY($1::uuid[])',
        [preExistingAuditLogIds]
      );
      assert.strictEqual(Number(preExistingRes.rows[0]?.count ?? '0'), preExistingAuditLogIds.length);
    }
  });

  it('20.2 (Finding A / Scenario B) should clean up ONLY records belonging to the targeted correlated test scope', async () => {
    const controlMarker = `control-${crypto.randomUUID()}`;
    const rawAuditRepo = new DrizzleAuditLogRepository();
    const controlRow = await rawAuditRepo.create({
      eventType: 'AUDIO_UPLOAD_COMPENSATION_FAILED',
      userId: null,
      resource: 'uncorrelated/control-orphan.mp3',
      metadata: { tempControlMarker: controlMarker },
    });

    const scopeA = createScopedTestAuditRepo('test-20-2-a');
    const scopeB = createScopedTestAuditRepo('test-20-2-b');

    try {
      const a1 = await scopeA.auditRepo.create({
        eventType: 'AUDIO_UPLOAD_COMPENSATION_FAILED',
        userId: directorUser.id,
        resource: 'scope-a-1.mp3',
        metadata: { tag: 'a1' },
      });
      const a2 = await scopeA.auditRepo.create({
        eventType: 'AUDIO_RECOVERY_COMPLETED',
        userId: null,
        resource: 'scope-a-1.mp3',
        metadata: { tag: 'a2' },
      });
      const b1 = await scopeB.auditRepo.create({
        eventType: 'AUDIO_UPLOAD_COMPENSATION_FAILED',
        userId: directorUser.id,
        resource: 'scope-b-1.mp3',
        metadata: { tag: 'b1' },
      });

      const deletedA = await scopeA.cleanup();
      assert.strictEqual(deletedA, 2);

      const remainingA = await pool.query<{ id: string }>(
        'SELECT id FROM audit_logs WHERE id = ANY($1::uuid[])',
        [[a1.id, a2.id]]
      );
      assert.strictEqual(remainingA.rows.length, 0);

      const survivingRes = await pool.query<{ id: string }>(
        'SELECT id FROM audit_logs WHERE id = ANY($1::uuid[])',
        [[b1.id, controlRow.id, ...(historicalSeedAuditId ? [historicalSeedAuditId] : [])]]
      );
      assert.strictEqual(survivingRes.rows.length, historicalSeedAuditId ? 3 : 2);

      const deletedB = await scopeB.cleanup();
      assert.strictEqual(deletedB, 1);

      const remainingB = await pool.query<{ id: string }>(
        'SELECT id FROM audit_logs WHERE id = $1',
        [b1.id]
      );
      assert.strictEqual(remainingB.rows.length, 0);
    } finally {
      await scopeA.cleanup().catch(() => 0);
      await scopeB.cleanup().catch(() => 0);
      await pool.query(
        "DELETE FROM audit_logs WHERE id = $1 AND metadata->>'tempControlMarker' = $2",
        [controlRow.id, controlMarker]
      );
    }
  });

  it('20.3 (Finding A / Scenario C) should execute correlated cleanup safely on unexpected test failure without affecting historical records', async () => {
    const createdInFailedTest: string[] = [];

    await assert.rejects(
      () =>
        withIsolatedTestScope('test-20-3-failure', async (scope) => {
          const ev1 = await scope.auditRepo.create({
            eventType: 'AUDIO_UPLOAD_COMPENSATION_FAILED',
            userId: directorUser.id,
            resource: 'failed-test-orphan.mp3',
            metadata: { simulatedCrash: true },
          });
          createdInFailedTest.push(ev1.id);

          const ev2 = await scope.auditRepo.create({
            eventType: 'AUDIO_DELETE_PHYSICAL_FAILED',
            userId: directorUser.id,
            resource: 'failed-test-delete.mp3',
            metadata: { simulatedCrash: true },
          });
          createdInFailedTest.push(ev2.id);

          throw new Error('Simulated unexpected assertion failure during test execution');
        }),
      /Simulated unexpected assertion failure/
    );

    assert.strictEqual(createdInFailedTest.length, 2);
    const leakedRows = await pool.query<{ id: string }>(
      'SELECT id FROM audit_logs WHERE id = ANY($1::uuid[])',
      [createdInFailedTest]
    );
    assert.strictEqual(leakedRows.rows.length, 0);

    if (historicalSeedAuditId) {
      const seedStillIntact = await pool.query<{ id: string }>(
        'SELECT id FROM audit_logs WHERE id = $1',
        [historicalSeedAuditId]
      );
      assert.strictEqual(seedStillIntact.rows.length, 1);
    }
  });

  it('20.4 (Finding A / Scenario D) should reject destructive cleanup under production or unsafe database configurations', async () => {
    await withIsolatedTestScope('test-20-4-prod-guard', async (scope) => {
      const protectedRow = await scope.auditRepo.create({
        eventType: 'AUDIO_UPLOAD_COMPENSATION_FAILED',
        userId: directorUser.id,
        resource: 'guard-check.mp3',
        metadata: { guarded: true },
      });

      assert.throws(
        () =>
          assertIsolatedTestDatabaseForAuditCleanup({
            nodeEnv: 'production',
            testDatabaseUrl: env.TEST_DATABASE_URL,
            databaseUrl: env.DATABASE_URL,
          }),
        /NODE_ENV='production'/
      );

      assert.throws(
        () =>
          assertIsolatedTestDatabaseForAuditCleanup({
            nodeEnv: 'development',
            testDatabaseUrl: env.TEST_DATABASE_URL,
            databaseUrl: env.DATABASE_URL,
          }),
        /NODE_ENV='development'/
      );

      assert.throws(
        () =>
          assertIsolatedTestDatabaseForAuditCleanup({
            nodeEnv: 'test',
            testDatabaseUrl: env.DATABASE_URL,
            databaseUrl: env.DATABASE_URL,
          }),
        /mismo destino que DATABASE_URL/
      );

      assert.throws(
        () =>
          assertIsolatedTestDatabaseForAuditCleanup({
            nodeEnv: 'test',
            testDatabaseUrl: 'postgresql://user:pass@localhost:5432/bethesda_production',
            databaseUrl: env.DATABASE_URL,
          }),
        /entorno de pruebas aislado seguro/
      );

      await assert.rejects(
        () =>
          cleanupCorrelatedTestAuditLogs({
            targetIds: [protectedRow.id],
            runCorrelationId: 'unsafe-correlation-id',
            envContext: {
              nodeEnv: 'production',
              testDatabaseUrl: env.TEST_DATABASE_URL,
              databaseUrl: env.DATABASE_URL,
            },
          }),
        /NODE_ENV='production'/
      );

      // Verificar que la fila no fue tocada por ninguno de los intentos rechazados
      const checkRow = await pool.query<{ id: string }>(
        'SELECT id FROM audit_logs WHERE id = $1',
        [protectedRow.id]
      );
      assert.strictEqual(checkRow.rows.length, 1);
    });
  });

  // =========================================================================
  // CRITERIO 21: GOBIERNO DE RECUPERACIÓN AL ARRANQUE Y ENDPOINTS ADMIN (FINDING B)
  // =========================================================================

  it('21.1 (Finding B) should execute safe startup recovery by default (no auto-purge without opt-in) and purge only when explicitly configured', async () => {
    await withIsolatedTestScope('test-21-1-startup', async (scope) => {
      const isolatedDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bethesda_startup_21_1_'));
      tempDirsToClean.push(isolatedDir);
      const storage = new LocalFileSystemAudioStorageProvider(isolatedDir, env.MAX_AUDIO_FILE_SIZE_BYTES);
      const dbRows = new Map<string, AudioAsset>();

      const mp3Buffer = makeValidMp3Buffer(4);
      const orphanSha = crypto.createHash('sha256').update(mp3Buffer).digest('hex');
      const orphanSaved = await storage.save('startup-orphan.mp3', mp3Buffer);
      const oldTime = new Date(Date.now() - 10 * 60_000);
      fs.utimesSync(storage.resolveSafePath(orphanSaved.storagePath), oldTime, oldTime);

      await scope.auditRepo.create({
        eventType: 'AUDIO_UPLOAD_COMPENSATION_FAILED',
        userId: directorUser.id,
        resource: orphanSaved.storagePath,
        metadata: {
          recoveryRecordId: crypto.randomUUID(),
          recoveryType: 'UPLOAD_COMPENSATION_ORPHAN',
          status: 'PENDING_RECOVERY',
          songId: testSong.id,
          storagePath: orphanSaved.storagePath,
          filename: 'startup-orphan.mp3',
          mimeType: 'audio/mpeg',
          checksumSha256: orphanSha,
          fileSizeBytes: mp3Buffer.byteLength,
          primaryError: 'Simulated startup orphan failure',
          createdAt: new Date(Date.now() - 60_000).toISOString(),
        },
      });

      // Además simular DELETE_DB_FAILED_AFTER_PHYSICAL_DELETE (archivo ya ausente en disco, fila en BD coincidente)
      let failDeleteFlag = false;
      const preRepo = createInMemoryAudioRepo(dbRows, {
        failDelete: () => (failDeleteFlag ? new PersistenceError('Simulated DB delete fail') : null),
      });
      const setupService = new AudioService(
        preRepo,
        storage,
        songRepo,
        env.MAX_AUDIO_FILE_SIZE_BYTES,
        globalPythonAudioWorkerBridge,
        scope.auditRepo
      );
      const tempAsset = await setupService.uploadAudio({
        songId: testSong.id,
        title: 'Startup Delete Cleanup Asset',
        filename: 'startup-del.mp3',
        mimeType: 'audio/mpeg',
        buffer: mp3Buffer,
        uploadedByUserId: directorUser.id,
      });
      failDeleteFlag = true;
      await assert.rejects(() => setupService.deleteAudio(tempAsset.id, directorUser.id), PersistenceError);
      assert.strictEqual(await storage.exists(tempAsset.storagePath), false);
      assert.strictEqual(dbRows.has(tempAsset.id), true);

      // Reinicio con configuración por defecto (purgeConfirmedOrphans = false)
      const capturedLogs: Array<{ level: string; obj: Record<string, unknown>; msg?: string | undefined }> = [];
      const logger: AudioStartupRecoveryLogger = {
        info: (obj, msg) => capturedLogs.push({ level: 'info', obj, msg }),
        warn: (obj, msg) => capturedLogs.push({ level: 'warn', obj, msg }),
        error: (obj, msg) => capturedLogs.push({ level: 'error', obj, msg }),
      };

      const startupService = new AudioService(
        createInMemoryAudioRepo(dbRows),
        storage,
        songRepo,
        env.MAX_AUDIO_FILE_SIZE_BYTES,
        globalPythonAudioWorkerBridge,
        scope.auditRepo
      );

      const safeStatus = await startupService.runStartupRecovery({ logger });
      assert.strictEqual(safeStatus.invoked, true);
      assert.strictEqual(safeStatus.enabled, true);
      assert.strictEqual(safeStatus.purgeConfirmedOrphansConfigured, false);
      assert.strictEqual(safeStatus.rehydrationSucceeded, true);
      assert.strictEqual(safeStatus.destructiveRecoveryBlocked, true);
      assert.strictEqual(safeStatus.status, 'DEGRADED_MANUAL_ACTION_REQUIRED');
      // La limpieza no destructiva de BD SÍ se completó, pero el huérfano físico NO se purgó sin opt-in
      assert.strictEqual(dbRows.has(tempAsset.id), false);
      assert.strictEqual(await storage.exists(orphanSaved.storagePath), true);
      assert.ok(capturedLogs.some((l) => l.obj['event'] === 'AUDIO_STARTUP_RECOVERY_ATTENTION_REQUIRED'));

      // Con opt-in explícito purgeConfirmedOrphans: true -> sí purga tras verificar SHA-256
      const purgeStatus = await startupService.runStartupRecovery({
        enabled: true,
        purgeConfirmedOrphans: true,
        minOrphanAgeMs: 60_000,
        logger,
      });
      assert.strictEqual(purgeStatus.status, 'COMPLETED');
      assert.strictEqual(purgeStatus.destructiveRecoveryBlocked, false);
      assert.strictEqual(await storage.exists(orphanSaved.storagePath), false);
      assert.ok(capturedLogs.some((l) => l.obj['event'] === 'AUDIO_STARTUP_RECOVERY_COMPLETED'));

      // Deshabilitado -> SKIPPED_DISABLED observable
      const skippedStatus = await startupService.runStartupRecovery({
        enabled: false,
        logger,
      });
      assert.strictEqual(skippedStatus.status, 'SKIPPED_DISABLED');
      assert.strictEqual(skippedStatus.enabled, false);
      assert.ok(capturedLogs.some((l) => l.obj['event'] === 'AUDIO_STARTUP_RECOVERY_SKIPPED'));
    });
  });

  it('21.2 (Finding B) should block destructive recovery when startup rehydration fails without crashing backend readiness', async () => {
    const isolatedDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bethesda_startup_21_2_'));
    tempDirsToClean.push(isolatedDir);
    const storage = new LocalFileSystemAudioStorageProvider(isolatedDir, env.MAX_AUDIO_FILE_SIZE_BYTES);
    const mp3Buffer = makeValidMp3Buffer(4);
    const agedOrphan = await storage.save('startup-fail-protected.mp3', mp3Buffer);
    const oldTime = new Date(Date.now() - 10 * 60_000);
    fs.utimesSync(storage.resolveSafePath(agedOrphan.storagePath), oldTime, oldTime);

    const unavailableAuditRepo: IAuditLogRepository = {
      async create() {
        throw new Error('PostgreSQL unavailable');
      },
      async list() {
        throw new Error('PostgreSQL audit_logs outage at boot');
      },
    };

    const capturedLogs: Array<{ level: string; obj: Record<string, unknown> }> = [];
    const logger: AudioStartupRecoveryLogger = {
      info: (obj) => capturedLogs.push({ level: 'info', obj }),
      warn: (obj) => capturedLogs.push({ level: 'warn', obj }),
      error: (obj) => capturedLogs.push({ level: 'error', obj }),
    };

    const service = new AudioService(
      createInMemoryAudioRepo(new Map<string, AudioAsset>()),
      storage,
      songRepo,
      env.MAX_AUDIO_FILE_SIZE_BYTES,
      globalPythonAudioWorkerBridge,
      unavailableAuditRepo
    );

    const bootStatus = await service.runStartupRecovery({
      enabled: true,
      purgeConfirmedOrphans: true,
      minOrphanAgeMs: 60_000,
      logger,
    });

    assert.strictEqual(bootStatus.invoked, true);
    assert.strictEqual(bootStatus.status, 'FAILED_NON_FATAL');
    assert.strictEqual(bootStatus.rehydrationSucceeded, false);
    assert.strictEqual(bootStatus.destructiveRecoveryBlocked, true);
    assert.ok(bootStatus.error?.includes('outage at boot'));
    assert.strictEqual(service.getLastStartupRecoveryStatus().status, 'FAILED_NON_FATAL');
    assert.strictEqual(await storage.exists(agedOrphan.storagePath), true);
    assert.ok(capturedLogs.some((l) => l.obj['event'] === 'AUDIO_STARTUP_RECOVERY_DEGRADED'));
  });

  it('21.3 (Finding B) should serialize concurrent runStartupRecovery and reconcileStorageConsistency calls', async () => {
    await withIsolatedTestScope('test-21-3-concurrency', async (scope) => {
      const isolatedDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bethesda_startup_21_3_'));
      tempDirsToClean.push(isolatedDir);
      const baseStorage = new LocalFileSystemAudioStorageProvider(isolatedDir, env.MAX_AUDIO_FILE_SIZE_BYTES);
      const dbRows = new Map<string, AudioAsset>();

      const mp3Buffer = makeValidMp3Buffer(4);
      const orphanSha = crypto.createHash('sha256').update(mp3Buffer).digest('hex');
      const saved = await baseStorage.save('concurrent-orphan.mp3', mp3Buffer);

      await scope.auditRepo.create({
        eventType: 'AUDIO_UPLOAD_COMPENSATION_FAILED',
        userId: directorUser.id,
        resource: saved.storagePath,
        metadata: {
          recoveryRecordId: crypto.randomUUID(),
          recoveryType: 'UPLOAD_COMPENSATION_ORPHAN',
          status: 'PENDING_RECOVERY',
          songId: testSong.id,
          storagePath: saved.storagePath,
          filename: 'concurrent-orphan.mp3',
          mimeType: 'audio/mpeg',
          checksumSha256: orphanSha,
          fileSizeBytes: mp3Buffer.byteLength,
          primaryError: 'Simulated concurrent recovery test',
          createdAt: new Date(Date.now() - 60_000).toISOString(),
        },
      });

      let storageDeleteCalls = 0;
      const slowSpiedStorage: IAudioStorageProvider = {
        save: (f, b) => baseStorage.save(f, b),
        getStream: (p, s, e, o) => baseStorage.getStream(p, s, e, o),
        getBuffer: (p) => baseStorage.getBuffer(p),
        exists: (p) => baseStorage.exists(p),
        stat: (p) => baseStorage.stat(p),
        resolveSafePath: (p) => baseStorage.resolveSafePath(p),
        listKeys: () => baseStorage.listKeys(),
        delete: async (p) => {
          storageDeleteCalls += 1;
          await new Promise((r) => setTimeout(r, 25));
          return await baseStorage.delete(p);
        },
      };

      const service = new AudioService(
        createInMemoryAudioRepo(dbRows),
        slowSpiedStorage,
        songRepo,
        env.MAX_AUDIO_FILE_SIZE_BYTES,
        globalPythonAudioWorkerBridge,
        scope.auditRepo
      );

      const [startupA, startupB, manualReconcile] = await Promise.all([
        service.runStartupRecovery({
          enabled: true,
          purgeConfirmedOrphans: true,
          minOrphanAgeMs: 60_000,
        }),
        service.runStartupRecovery({
          enabled: true,
          purgeConfirmedOrphans: true,
          minOrphanAgeMs: 60_000,
        }),
        service.reconcileStorageConsistency({
          purgeOrphanFiles: true,
          recoverFailedOperations: true,
          minOrphanAgeMs: 60_000,
        }),
      ]);

      assert.strictEqual(storageDeleteCalls, 1);
      assert.strictEqual(startupA.status, 'COMPLETED');
      assert.strictEqual(startupB.status, 'COMPLETED');
      assert.strictEqual(manualReconcile.recoveredOperations.length, 0);
      assert.strictEqual(await baseStorage.exists(saved.storagePath), false);
    });
  });

  it('21.4 (Finding B) should enforce RBAC on /api/v1/audio/recovery/status and /api/v1/audio/recovery/reconcile endpoints', async () => {
    const tsAdmin = Date.now();
    const superAdminUser = await userRepo.create({
      email: `audio-superadmin-${tsAdmin}@bethesda.co`,
      passwordHash: 'dummy_hash',
      firstName: 'Admin',
      lastName: 'Recovery',
      role: 'SUPER_ADMIN',
      accountStatus: 'ACTIVE',
    });
    createdUserIds.add(superAdminUser.id);
    const superAdminToken = tokenService.signAccessToken({
      sub: superAdminUser.id,
      email: superAdminUser.email,
      role: superAdminUser.role,
    }).token;

    // 1. Sin autenticación -> 401
    const unauthStatus = await app.inject({
      method: 'GET',
      url: '/api/v1/audio/recovery/status',
    });
    assert.strictEqual(unauthStatus.statusCode, 401);

    const unauthReconcile = await app.inject({
      method: 'POST',
      url: '/api/v1/audio/recovery/reconcile',
      payload: { purgeOrphanFiles: false, recoverFailedOperations: false },
    });
    assert.strictEqual(unauthReconcile.statusCode, 401);

    // 2. MUSICIAN y WORSHIP_LEADER (carecen de 'audit:read') -> 403 Forbidden
    for (const deniedToken of [musicianToken, directorToken]) {
      const deniedStatus = await app.inject({
        method: 'GET',
        url: '/api/v1/audio/recovery/status',
        headers: { authorization: `Bearer ${deniedToken}` },
      });
      assert.strictEqual(deniedStatus.statusCode, 403);

      const deniedReconcile = await app.inject({
        method: 'POST',
        url: '/api/v1/audio/recovery/reconcile',
        headers: { authorization: `Bearer ${deniedToken}` },
        payload: { purgeOrphanFiles: false, recoverFailedOperations: false },
      });
      assert.strictEqual(deniedReconcile.statusCode, 403);
    }

    // 3. SUPER_ADMIN (posee 'audit:read') -> 200 en POST reconcile no destructivo y GET status
    const adminReconcile = await app.inject({
      method: 'POST',
      url: '/api/v1/audio/recovery/reconcile',
      headers: { authorization: `Bearer ${superAdminToken}` },
      payload: { purgeOrphanFiles: false, recoverFailedOperations: false, minOrphanAgeMs: 60_000 },
    });
    assert.strictEqual(adminReconcile.statusCode, 200, adminReconcile.body);
    const reconcileJson = adminReconcile.json();
    assert.strictEqual(reconcileJson.status, 'success');
    assert.strictEqual(reconcileJson.data.rehydrationReport.rehydrationSucceeded, true);
    assert.deepStrictEqual(reconcileJson.data.purgedOrphanFiles, []);

    const adminStatus = await app.inject({
      method: 'GET',
      url: '/api/v1/audio/recovery/status',
      headers: { authorization: `Bearer ${superAdminToken}` },
    });
    assert.strictEqual(adminStatus.statusCode, 200, adminStatus.body);
    const statusJson = adminStatus.json();
    assert.strictEqual(statusJson.status, 'success');
    assert.ok(statusJson.data.startupRecovery);
    assert.ok(statusJson.data.lastReconciliationReport);

    // 4. Validación estricta de payload en POST reconcile -> 400
    const badBody = await app.inject({
      method: 'POST',
      url: '/api/v1/audio/recovery/reconcile',
      headers: { authorization: `Bearer ${superAdminToken}` },
      payload: { purgeOrphanFiles: 'yes' },
    });
    assert.strictEqual(badBody.statusCode, 400);
  });

  // =========================================================================
  // CRITERIO 22: REGRESIÓN INTEGRAL DE PRESERVACIÓN HTTP 400/401 (SECCIÓN 8: ESCENARIOS 1 AL 13)
  // =========================================================================
  it('22.1-22.6 (Preservation HTTP 400 Remediation) should cover valid MP3 preservation (JSON, multipart/form-data, chained ID3v2), invalid songId, malformed multipart/body, invalid MIME/signature, oversized upload, and RBAC', async () => {
    const mp3ElSenor = makeValidMp3WithId3Buffer();
    const expectedSha = crypto.createHash('sha256').update(mp3ElSenor).digest('hex');

    // Escenario 1a: Preservación MP3 válida vía JSON (con Content-Type: application/json)
    const jsonUploadRes = await app.inject({
      method: 'POST',
      url: `/api/v1/songs/${testSong.id}/audio`,
      headers: {
        authorization: `Bearer ${directorToken}`,
        'content-type': 'application/json',
      },
      payload: JSON.stringify({
        title: 'El Señor Está en Este Lugar',
        filename: 'El Señor Está en Este Lugar.mp3',
        mimeType: 'audio/mpeg',
        dataBase64: mp3ElSenor.toString('base64'),
      }),
    });
    assert.strictEqual(jsonUploadRes.statusCode, 201, jsonUploadRes.body);
    const createdJsonAsset = jsonUploadRes.json().data;
    createdAudioStoragePaths.add(createdJsonAsset.storagePath);
    assert.strictEqual(createdJsonAsset.songId, testSong.id);
    assert.strictEqual(createdJsonAsset.filename, 'El Señor Está en Este Lugar.mp3');
    assert.strictEqual(createdJsonAsset.mimeType, 'audio/mpeg');
    assert.strictEqual(createdJsonAsset.checksumSha256, expectedSha);
    assert.strictEqual(createdJsonAsset.fileSizeBytes, mp3ElSenor.byteLength);

    // Escenario 1b: Preservación MP3 válida vía multipart/form-data binario
    const boundary = '----BethesdaAudioMultipartBoundary22';
    const mp3MultipartBuf = makeValidMp3WithId3Buffer();
    const expectedMultipartSha = crypto.createHash('sha256').update(mp3MultipartBuf).digest('hex');
    const multipartBody = Buffer.concat([
      Buffer.from(
        `--${boundary}\r\n` +
          `Content-Disposition: form-data; name="title"\r\n\r\n` +
          `El Señor Está en Este Lugar (Multipart)\r\n` +
          `--${boundary}\r\n` +
          `Content-Disposition: form-data; name="filename"\r\n\r\n` +
          `El_Senor_Multipart.mp3\r\n` +
          `--${boundary}\r\n` +
          `Content-Disposition: form-data; name="mimeType"\r\n\r\n` +
          `audio/mp3; codecs=mp3\r\n` +
          `--${boundary}\r\n` +
          `Content-Disposition: form-data; name="durationSeconds"\r\n\r\n` +
          `185\r\n` +
          `--${boundary}\r\n` +
          `Content-Disposition: form-data; name="file"; filename="El_Senor_Multipart.mp3"\r\n` +
          `Content-Type: audio/mpeg\r\n\r\n`,
        'utf8'
      ),
      mp3MultipartBuf,
      Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8'),
    ]);

    const multipartRes = await app.inject({
      method: 'POST',
      url: `/api/v1/songs/${testSong.id}/audio`,
      headers: {
        authorization: `Bearer ${directorToken}`,
        'content-type': `multipart/form-data; boundary=${boundary}`,
      },
      payload: multipartBody,
    });
    assert.strictEqual(multipartRes.statusCode, 201, multipartRes.body);
    const createdMultipartAsset = multipartRes.json().data;
    createdAudioStoragePaths.add(createdMultipartAsset.storagePath);
    assert.strictEqual(createdMultipartAsset.checksumSha256, expectedMultipartSha);
    assert.strictEqual(createdMultipartAsset.mimeType, 'audio/mpeg');
    assert.strictEqual(createdMultipartAsset.durationSeconds, 185);

    // Escenario 1c: MP3 con etiquetas ID3v2 encadenadas consecutivas
    const id3First = Buffer.from([0x49, 0x44, 0x33, 0x03, 0x00, 0x00, 0x00, 0x00, 0x00, 0x10]);
    const id3Second = Buffer.from([0x49, 0x44, 0x33, 0x04, 0x00, 0x00, 0x00, 0x00, 0x00, 0x10]);
    const chainedMp3 = Buffer.concat([
      id3First,
      Buffer.alloc(16, 0x00),
      id3Second,
      Buffer.alloc(16, 0x00),
      makeValidMp3Buffer(5),
    ]);
    const chainedRes = await app.inject({
      method: 'POST',
      url: `/api/v1/songs/${testSong.id}/audio`,
      headers: { authorization: `Bearer ${directorToken}` },
      payload: {
        title: 'MP3 Doble ID3v2',
        filename: 'chained_id3.mp3',
        mimeType: 'audio/x-mp3',
        dataBase64: chainedMp3.toString('base64'),
      },
    });
    assert.strictEqual(chainedRes.statusCode, 201, chainedRes.body);
    createdAudioStoragePaths.add(chainedRes.json().data.storagePath);

    // Escenario 2: Identificador de canción inválido (UUID malformado -> 400; UUID inexistente -> 404)
    const malformedSongRes = await app.inject({
      method: 'POST',
      url: '/api/v1/songs/not-a-valid-uuid/audio',
      headers: { authorization: `Bearer ${directorToken}` },
      payload: {
        title: 'Test',
        filename: 'test.mp3',
        mimeType: 'audio/mpeg',
        dataBase64: mp3ElSenor.toString('base64'),
      },
    });
    assert.strictEqual(malformedSongRes.statusCode, 400);
    assert.strictEqual(malformedSongRes.json().error.code, 'VALIDATION_ERROR');

    const missingSongRes = await app.inject({
      method: 'POST',
      url: `/api/v1/songs/${crypto.randomUUID()}/audio`,
      headers: { authorization: `Bearer ${directorToken}` },
      payload: {
        title: 'Test',
        filename: 'test.mp3',
        mimeType: 'audio/mpeg',
        dataBase64: mp3ElSenor.toString('base64'),
      },
    });
    assert.strictEqual(missingSongRes.statusCode, 404);
    assert.strictEqual(missingSongRes.json().error.code, 'NOT_FOUND');

    // Escenario 3: Campo multipart ausente o malformado y cuerpo no-JSON malformado -> 400
    const noBoundaryRes = await app.inject({
      method: 'POST',
      url: `/api/v1/songs/${testSong.id}/audio`,
      headers: {
        authorization: `Bearer ${directorToken}`,
        'content-type': 'multipart/form-data',
      },
      payload: Buffer.from('invalid-multipart-without-boundary', 'utf8'),
    });
    assert.strictEqual(noBoundaryRes.statusCode, 400);
    assert.strictEqual(noBoundaryRes.json().error.code, 'VALIDATION_ERROR');

    const missingFileMultipart = Buffer.from(
      `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="title"\r\n\r\n` +
        `Solo Titulo Sin Archivo\r\n` +
        `--${boundary}--\r\n`,
      'utf8'
    );
    const missingFileRes = await app.inject({
      method: 'POST',
      url: `/api/v1/songs/${testSong.id}/audio`,
      headers: {
        authorization: `Bearer ${directorToken}`,
        'content-type': `multipart/form-data; boundary=${boundary}`,
      },
      payload: missingFileMultipart,
    });
    assert.strictEqual(missingFileRes.statusCode, 400);
    assert.strictEqual(missingFileRes.json().error.code, 'VALIDATION_ERROR');

    const malformedPlainTextRes = await app.inject({
      method: 'POST',
      url: `/api/v1/songs/${testSong.id}/audio`,
      headers: {
        authorization: `Bearer ${directorToken}`,
        'content-type': 'text/plain;charset=UTF-8',
      },
      payload: 'NOT_A_JSON_OBJECT',
    });
    assert.strictEqual(malformedPlainTextRes.statusCode, 400);
    assert.strictEqual(malformedPlainTextRes.json().error.code, 'VALIDATION_ERROR');

    // Escenario 4: Combinación MIME/firma binaria inválida -> 400 sin archivos huérfanos
    const wavHeaderFakeMp3 = Buffer.from([
      0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x41, 0x56, 0x45,
      0x66, 0x6d, 0x74, 0x20, 0x10, 0x00, 0x00, 0x00, 0x01, 0x00, 0x02, 0x00,
    ]);
    const mismatchMimeRes = await app.inject({
      method: 'POST',
      url: `/api/v1/songs/${testSong.id}/audio`,
      headers: { authorization: `Bearer ${directorToken}` },
      payload: {
        title: 'WAV disfrazado de MP3',
        filename: 'mismatch.mp3',
        mimeType: 'audio/mpeg',
        dataBase64: wavHeaderFakeMp3.toString('base64'),
      },
    });
    assert.strictEqual(mismatchMimeRes.statusCode, 400);
    assert.strictEqual(mismatchMimeRes.json().error.code, 'VALIDATION_ERROR');

    // Escenario 5: Carga útil que excede la cuota configurada -> 400 sin archivos huérfanos
    const quotaDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bethesda_quota_22_5_'));
    tempDirsToClean.push(quotaDir);
    const quotaStorage = new LocalFileSystemAudioStorageProvider(quotaDir, 1024);
    const quotaService = new AudioService(audioRepo, quotaStorage, songRepo, 1024);
    await assert.rejects(
      async () => {
        await quotaService.uploadAudio({
          songId: testSong.id,
          title: 'Oversized MP3',
          filename: 'oversized.mp3',
          mimeType: 'audio/mpeg',
          buffer: makeValidMp3Buffer(10), // > 1024 bytes
        });
      },
      (err: unknown) => err instanceof ValidationError && err.message.includes('supera el límite máximo')
    );
    assert.deepStrictEqual(await quotaStorage.listKeys(), []);

    // Escenario 6: Usuario no autorizado (401 sin token; 403 con rol MUSICIAN sin songs:create)
    const noTokenRes = await app.inject({
      method: 'POST',
      url: `/api/v1/songs/${testSong.id}/audio`,
      payload: {
        title: 'Unauth',
        filename: 'unauth.mp3',
        mimeType: 'audio/mpeg',
        dataBase64: mp3ElSenor.toString('base64'),
      },
    });
    assert.strictEqual(noTokenRes.statusCode, 401);

    const forbiddenMusicianRes = await app.inject({
      method: 'POST',
      url: `/api/v1/songs/${testSong.id}/audio`,
      headers: { authorization: `Bearer ${musicianToken}` },
      payload: {
        title: 'Forbidden Musician',
        filename: 'forbidden.mp3',
        mimeType: 'audio/mpeg',
        dataBase64: mp3ElSenor.toString('base64'),
      },
    });
    assert.strictEqual(forbiddenMusicianRes.statusCode, 403);
  });

  it('22.7-22.8 (Auth Refresh 401 Lifecycle) should support GET and POST /api/v1/auth/refresh with valid HttpOnly cookie rotation and reject missing/revoked refresh cookies with 401', async () => {
    // Escenario 8: Refresh fallido sin cookie tanto en GET como en POST -> 401 UNAUTHORIZED
    const getRefreshNoCookie = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/refresh',
    });
    assert.strictEqual(getRefreshNoCookie.statusCode, 401);
    assert.strictEqual(getRefreshNoCookie.json().error.code, 'UNAUTHORIZED');

    const postRefreshNoCookie = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
    });
    assert.strictEqual(postRefreshNoCookie.statusCode, 401);
    assert.strictEqual(postRefreshNoCookie.json().error.code, 'UNAUTHORIZED');

    // Escenario 8b: Refresh con cookie inválida -> 401 y limpieza de cookie
    const invalidCookieRefresh = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/refresh',
      cookies: { bethesda_refresh_token: 'invalid-or-expired-refresh-token' },
    });
    assert.strictEqual(invalidCookieRefresh.statusCode, 401);

    // Escenario 7: Sesión expirada + renovación exitosa vía cookie HttpOnly (POST y GET) seguida de preservación de audio exitosa
    const hasher = new Argon2PasswordHasher();
    const rawPassword = 'ValidDirectorPassword!2026';
    const passwordHash = await hasher.hash(rawPassword);
    const refreshUser = await userRepo.create({
      email: `refresh-director-${Date.now()}@bethesda.co`,
      passwordHash,
      firstName: 'Refresh',
      lastName: 'Director',
      role: 'WORSHIP_LEADER',
      accountStatus: 'ACTIVE',
    });
    createdUserIds.add(refreshUser.id);

    const loginRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: refreshUser.email, password: rawPassword },
    });
    assert.strictEqual(loginRes.statusCode, 200, loginRes.body);
    const loginCookie = loginRes.cookies.find((c) => c.name === 'bethesda_refresh_token');
    assert.ok(loginCookie?.value, 'Debe emitir cookie HttpOnly bethesda_refresh_token en login');

    // Renovar sesión mediante GET /api/v1/auth/refresh con la cookie HttpOnly
    const getRefreshRes = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/refresh',
      cookies: { bethesda_refresh_token: loginCookie!.value },
    });
    assert.strictEqual(getRefreshRes.statusCode, 200, getRefreshRes.body);
    const refreshedAccessToken = getRefreshRes.json().data.accessToken as string;
    assert.ok(refreshedAccessToken);

    // Usar el nuevo accessToken renovado para preservar audio
    const mp3Buf = makeValidMp3WithId3Buffer();
    const preserveAfterRefresh = await app.inject({
      method: 'POST',
      url: `/api/v1/songs/${testSong.id}/audio`,
      headers: {
        authorization: `Bearer ${refreshedAccessToken}`,
        'content-type': 'application/json',
      },
      payload: JSON.stringify({
        title: 'Audio Tras Refresh Exitoso',
        filename: 'post_refresh.mp3',
        mimeType: 'audio/mpeg',
        dataBase64: mp3Buf.toString('base64'),
      }),
    });
    assert.strictEqual(preserveAfterRefresh.statusCode, 201, preserveAfterRefresh.body);
    createdAudioStoragePaths.add(preserveAfterRefresh.json().data.storagePath);
  });

  it('22.9-22.13 (Compensation, No-False-DB-Success, Idempotency, SHA-256 Recovery & Range Streaming) should enforce atomic invariants and idempotent retries', async () => {
    await withIsolatedTestScope('test-22-9-to-22-13', async (scope) => {
      const isolatedDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bethesda_22_9_'));
      tempDirsToClean.push(isolatedDir);
      const isolatedStorage = new LocalFileSystemAudioStorageProvider(isolatedDir, env.MAX_AUDIO_FILE_SIZE_BYTES);
      const inMemRows = new Map<string, AudioAsset>();
      const baseRepo = createInMemoryAudioRepo(inMemRows);

      // Escenario 9: Fallo de base de datos con compensación física verificada
      const failingDbRepo: IAudioRepository = {
        ...baseRepo,
        async create() {
          throw new PersistenceError('Simulated PostgreSQL insert failure in 22.9');
        },
      };
      const compService = new AudioService(
        failingDbRepo,
        isolatedStorage,
        songRepo,
        env.MAX_AUDIO_FILE_SIZE_BYTES,
        globalPythonAudioWorkerBridge,
        scope.auditRepo
      );

      let capturedComp: AudioUploadCompensationReport | undefined;
      await assert.rejects(async () => {
        try {
          await compService.uploadAudio({
            songId: testSong.id,
            title: 'Compensated Upload',
            filename: 'compensated_22_9.mp3',
            mimeType: 'audio/mpeg',
            buffer: makeValidMp3Buffer(4),
            uploadedByUserId: directorUser.id,
          });
        } catch (err) {
          capturedComp = (err as { compensation?: AudioUploadCompensationReport })?.compensation;
          throw err;
        }
      });
      assert.ok(capturedComp);
      assert.strictEqual(capturedComp.attempted, true);
      assert.strictEqual(capturedComp.succeeded, true);
      assert.deepStrictEqual(await isolatedStorage.listKeys(), []);
      assert.strictEqual(inMemRows.size, 0);

      // Escenario 10: Fallo de almacenamiento físico sin falso éxito en base de datos
      let dbCreateCalled = false;
      const spyDbRepo: IAudioRepository = {
        ...baseRepo,
        async create(data) {
          dbCreateCalled = true;
          return await baseRepo.create(data);
        },
      };
      const failingStorage: IAudioStorageProvider = {
        save: async () => {
          throw new PersistenceError('Simulated disk write EIO failure in 22.10');
        },
        getStream: (p, s, e, o) => isolatedStorage.getStream(p, s, e, o),
        getBuffer: (p) => isolatedStorage.getBuffer(p),
        delete: (p) => isolatedStorage.delete(p),
        exists: (p) => isolatedStorage.exists(p),
        resolveSafePath: (p) => isolatedStorage.resolveSafePath(p),
        listKeys: () => isolatedStorage.listKeys(),
      };
      const storageFailService = new AudioService(
        spyDbRepo,
        failingStorage,
        songRepo,
        env.MAX_AUDIO_FILE_SIZE_BYTES,
        globalPythonAudioWorkerBridge,
        scope.auditRepo
      );
      await assert.rejects(
        async () => {
          await storageFailService.uploadAudio({
            songId: testSong.id,
            title: 'Disk Fail Upload',
            filename: 'disk_fail_22_10.mp3',
            mimeType: 'audio/mpeg',
            buffer: makeValidMp3Buffer(4),
          });
        },
        (err: unknown) => err instanceof PersistenceError && err.message.includes('EIO')
      );
      assert.strictEqual(dbCreateCalled, false, 'Nunca debe insertar en PostgreSQL si falla la escritura física');
      assert.strictEqual(inMemRows.size, 0);

      // Escenario 11: Idempotencia ante reintentos secuenciales y concurrentes (single-flight)
      const idempotentService = new AudioService(
        baseRepo,
        isolatedStorage,
        songRepo,
        env.MAX_AUDIO_FILE_SIZE_BYTES,
        globalPythonAudioWorkerBridge,
        scope.auditRepo
      );
      const idempotentMp3 = makeValidMp3WithId3Buffer();
      const [concurrentA, concurrentB] = await Promise.all([
        idempotentService.uploadAudio({
          songId: testSong.id,
          title: 'El Señor Está en Este Lugar - Idempotente',
          filename: 'idempotent_worship.mp3',
          mimeType: 'audio/mpeg',
          buffer: idempotentMp3,
          uploadedByUserId: directorUser.id,
        }),
        idempotentService.uploadAudio({
          songId: testSong.id,
          title: 'El Señor Está en Este Lugar - Idempotente',
          filename: 'idempotent_worship.mp3',
          mimeType: 'audio/mpeg',
          buffer: idempotentMp3,
          uploadedByUserId: directorUser.id,
        }),
      ]);
      const sequentialRetry = await idempotentService.uploadAudio({
        songId: testSong.id,
        title: 'El Señor Está en Este Lugar - Idempotente',
        filename: 'idempotent_worship.mp3',
        mimeType: 'audio/mpeg',
        buffer: idempotentMp3,
        uploadedByUserId: directorUser.id,
      });

      assert.strictEqual(concurrentA.id, concurrentB.id);
      assert.strictEqual(concurrentA.id, sequentialRetry.id);
      assert.strictEqual(concurrentA.storagePath, sequentialRetry.storagePath);
      assert.strictEqual(inMemRows.size, 1, 'No debe crear filas duplicadas en reintentos');
      assert.strictEqual((await isolatedStorage.listKeys()).length, 1, 'No debe crear archivos físicos duplicados');

      // Escenario 12: Verificación SHA-256 y reconciliación durable
      const downloaded = await idempotentService.downloadAudio(concurrentA.id);
      assert.strictEqual(
        crypto.createHash('sha256').update(downloaded.buffer).digest('hex'),
        concurrentA.checksumSha256
      );
      const reconcileOk = await idempotentService.reconcileStorageConsistency({
        purgeOrphanFiles: false,
        recoverFailedOperations: true,
      });
      assert.deepStrictEqual(reconcileOk.healthyAssetIds, [concurrentA.id]);
      assert.strictEqual(reconcileOk.corruptedPhysicalFiles.length, 0);

      // Escenario 13: Streaming HTTP Range (200 y 206 Partial Content) tras preservación exitosa en la aplicación real
      const streamMp3 = makeValidMp3WithId3Buffer();
      const streamUploadRes = await app.inject({
        method: 'POST',
        url: `/api/v1/songs/${testSong.id}/audio`,
        headers: {
          authorization: `Bearer ${directorToken}`,
          'content-type': 'application/json',
        },
        payload: JSON.stringify({
          title: 'El Señor Está en Este Lugar - Streaming Atril',
          filename: 'streaming_atril_22_13.mp3',
          mimeType: 'audio/mpeg',
          dataBase64: streamMp3.toString('base64'),
        }),
      });
      assert.strictEqual(streamUploadRes.statusCode, 201, streamUploadRes.body);
      const streamAsset = streamUploadRes.json().data;
      createdAudioStoragePaths.add(streamAsset.storagePath);

      const ticketRes = await app.inject({
        method: 'POST',
        url: `/api/v1/audio/${streamAsset.id}/ticket`,
        headers: { authorization: `Bearer ${musicianToken}` },
      });
      assert.strictEqual(ticketRes.statusCode, 200);
      const streamTicket = ticketRes.json().data.ticket as string;

      const rangeRes = await app.inject({
        method: 'GET',
        url: `/api/v1/audio/${streamAsset.id}/stream?ticket=${encodeURIComponent(streamTicket)}`,
        headers: { range: 'bytes=0-127' },
      });
      assert.strictEqual(rangeRes.statusCode, 206);
      assert.strictEqual(rangeRes.headers['content-range'], `bytes 0-127/${streamMp3.byteLength}`);
      assert.strictEqual(rangeRes.headers['accept-ranges'], 'bytes');
      assert.strictEqual(rangeRes.headers['x-checksum-sha256'], streamAsset.checksumSha256);
      assert.strictEqual(rangeRes.rawPayload.byteLength, 128);
      assert.strictEqual(Buffer.compare(rangeRes.rawPayload, streamMp3.subarray(0, 128)), 0);
    });
  });
});
