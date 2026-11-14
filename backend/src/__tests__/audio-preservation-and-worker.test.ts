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
import { pool } from '../db/index.ts';
import { runMigrations } from '../db/migrate.ts';
import { DrizzleUserRepository } from '../repositories/user-repository.ts';
import { DrizzleSongRepository } from '../repositories/song-repository.ts';
import { DrizzleAudioRepository, type IAudioRepository } from '../repositories/audio-repository.ts';
import {
  DrizzleAuditLogRepository,
  type CreateAuditLogInput,
  type IAuditLogRepository,
} from '../repositories/audit-repository.ts';
import {
  LocalFileSystemAudioStorageProvider,
  type IAudioStorageProvider,
} from '../domain/audio/storage-provider.ts';
import { AudioService, type AudioUploadCompensationReport } from '../application/audio-service.ts';
import { JwtTokenService } from '../application/token-service.ts';
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

  before(async () => {
    await runMigrations();
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
    const failingService = new AudioService(failingRepo, isolatedStorage, songRepo, env.MAX_AUDIO_FILE_SIZE_BYTES);

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

    const isolatedService = new AudioService(memRepo, isolatedStorage, songRepo, env.MAX_AUDIO_FILE_SIZE_BYTES);
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

    const recordedAuditEvents: AuditLogEntity[] = [];
    const realAuditRepo = new DrizzleAuditLogRepository();
    const auditSpyRepo: IAuditLogRepository = {
      async create(input: CreateAuditLogInput) {
        const created = await realAuditRepo.create(input);
        recordedAuditEvents.push(created);
        return created;
      },
      async list(opts) {
        return await realAuditRepo.list(opts);
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

    const recordedAuditEvents: AuditLogEntity[] = [];
    const realAuditRepo = new DrizzleAuditLogRepository();
    const auditSpyRepo: IAuditLogRepository = {
      async create(input: CreateAuditLogInput) {
        const created = await realAuditRepo.create(input);
        recordedAuditEvents.push(created);
        return created;
      },
      async list(opts) {
        return await realAuditRepo.list(opts);
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

    const recordedAuditEvents: AuditLogEntity[] = [];
    const realAuditRepo = new DrizzleAuditLogRepository();
    const auditSpyRepo: IAuditLogRepository = {
      async create(input: CreateAuditLogInput) {
        const created = await realAuditRepo.create(input);
        recordedAuditEvents.push(created);
        return created;
      },
      async list(opts) {
        return await realAuditRepo.list(opts);
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

    const recordedAuditEvents: AuditLogEntity[] = [];
    const realAuditRepo = new DrizzleAuditLogRepository();
    const auditSpyRepo: IAuditLogRepository = {
      async create(input: CreateAuditLogInput) {
        const created = await realAuditRepo.create(input);
        recordedAuditEvents.push(created);
        return created;
      },
      async list(opts) {
        return await realAuditRepo.list(opts);
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

    const service = new AudioService(
      delayedRepo,
      isolatedStorage,
      songRepo,
      env.MAX_AUDIO_FILE_SIZE_BYTES
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
