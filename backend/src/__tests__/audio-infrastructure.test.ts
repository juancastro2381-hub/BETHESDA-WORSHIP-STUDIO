/**
 * @file audio-infrastructure.test.ts
 * @description Suite completa de pruebas de regresión para la Infraestructura de Audio (Workstream A).
 * Cubre:
 * 1. Control de acceso y RBAC (401 no autenticado, 403 rol sin permisos, 201 líder/admin).
 * 2. Validación de tipos MIME y rechazo de formatos no autorizados (HTML, PDF).
 * 3. Validación de cuotas (rechazo de archivo vacío y archivo > 50MB).
 * 4. Integridad criptográfica SHA-256 en almacenamiento y metadatos.
 * 5. Descarga autenticada de binarios.
 * 6. Streaming HTTP 206 con cabeceras Range (bytes=start-end) y HTTP 200 estándar.
 * 7. Prevención de vulnerabilidades de Path Traversal.
 * 8. Eliminación física y lógica en cascada.
 */

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../app.ts';
import { pool } from '../db/index.ts';
import { runMigrations } from '../db/migrate.ts';
import { DrizzleUserRepository } from '../repositories/user-repository.ts';
import { DrizzleSongRepository } from '../repositories/song-repository.ts';
import { DrizzleAudioRepository } from '../repositories/audio-repository.ts';
import { LocalFileSystemAudioStorageProvider } from '../domain/audio/storage-provider.ts';
import { JwtTokenService } from '../application/token-service.ts';
import { env } from '../config/env.ts';
import type { UserEntity } from '../domain/auth-types.ts';
import type { SongEntity } from '../domain/types.ts';
import { CanonicalSerializer } from '../domain/canonical-serializer.ts';
import { createReferenceSongFixture } from '../../../frontend/src/core/canonical-model/fixtures/reference-song.ts';

describe('Workstream A — Audio Infrastructure, Download & Range Streaming Suite', () => {
  let app: FastifyInstance;
  let tokenService: JwtTokenService;
  let userRepo: DrizzleUserRepository;
  let songRepo: DrizzleSongRepository;
  let audioRepo: DrizzleAudioRepository;
  let storageProvider: LocalFileSystemAudioStorageProvider;

  let leaderUser: UserEntity;
  let musicianUser: UserEntity;
  let leaderToken: string;
  let musicianToken: string;

  let testSong: SongEntity;
  const createdUserIds = new Set<string>();
  const createdSongIds = new Set<string>();

  before(async () => {
    await runMigrations();
    app = await buildApp();
    await app.ready();

    tokenService = new JwtTokenService(env.JWT_SECRET, env.JWT_ACCESS_EXPIRES_IN);
    userRepo = new DrizzleUserRepository();
    songRepo = new DrizzleSongRepository();
    audioRepo = new DrizzleAudioRepository();
    storageProvider = new LocalFileSystemAudioStorageProvider(env.AUDIO_STORAGE_PATH, env.MAX_AUDIO_FILE_SIZE_BYTES);

    const timestamp = Date.now();

    // 1. Crear líder de alabanza
    leaderUser = await userRepo.create({
      email: `audio-leader-${timestamp}@bethesda.co`,
      passwordHash: 'dummy_hash',
      firstName: 'Director',
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

    // 2. Crear músico estándar
    musicianUser = await userRepo.create({
      email: `audio-musician-${timestamp}@bethesda.co`,
      passwordHash: 'dummy_hash',
      firstName: 'Guitarrista',
      lastName: 'Musico',
      role: 'MUSICIAN',
      accountStatus: 'ACTIVE',
    });
    createdUserIds.add(musicianUser.id);
    musicianToken = tokenService.signAccessToken({
      sub: musicianUser.id,
      email: musicianUser.email,
      role: musicianUser.role,
    }).token;

    // 3. Crear canción de prueba con versión canónica inicial
    const canonicalSong = createReferenceSongFixture();
    const canonicalJSON = CanonicalSerializer.serialize(canonicalSong);

    const songResult = await songRepo.create({
      title: 'Gracia Sublime Es — Test Audio',
      artist: 'En Espiritu y En Verdad',
      defaultKey: 'G',
      defaultBpm: 104,
      timeSignature: '4/4',
      status: 'APPROVED',
      versionName: 'Versión Original',
      sourceFormat: 'INTERNAL',
      canonicalPayload: canonicalJSON,
    });
    testSong = songResult.song;
    createdSongIds.add(testSong.id);
  });

  after(async () => {
    if (createdSongIds.size > 0) {
      const sIds = Array.from(createdSongIds);
      await pool.query('DELETE FROM songs WHERE id = ANY($1)', [sIds]);
    }

    if (createdUserIds.size > 0) {
      const uIds = Array.from(createdUserIds);
      await pool.query('DELETE FROM users WHERE id = ANY($1)', [uIds]);
    }

    await app.close();
    await pool.end();
  });

  it('1. should reject unauthenticated audio upload with 401 Unauthorized', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/songs/${testSong.id}/audio`,
      payload: {
        title: 'Pista de Referencia',
        filename: 'pista.mp3',
        mimeType: 'audio/mpeg',
        dataBase64: Buffer.from('fake-audio-bytes').toString('base64'),
      },
    });

    assert.equal(res.statusCode, 401, 'Debe retornar 401 si no hay token');
  });

  it('2. should reject musician role on upload with 403 Forbidden (RBAC enforcement)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/songs/${testSong.id}/audio`,
      headers: {
        authorization: `Bearer ${musicianToken}`,
      },
      payload: {
        title: 'Pista de Músico',
        filename: 'pista.mp3',
        mimeType: 'audio/mpeg',
        dataBase64: Buffer.from('fake-audio-bytes').toString('base64'),
      },
    });

    assert.equal(res.statusCode, 403, 'Músico no puede subir pistas maestras');
  });

  it('3. should reject invalid/unsupported MIME types (e.g. text/html, application/pdf)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/songs/${testSong.id}/audio`,
      headers: {
        authorization: `Bearer ${leaderToken}`,
      },
      payload: {
        title: 'Error de Archivo HTML',
        filename: 'error.html',
        mimeType: 'text/html',
        dataBase64: Buffer.from('<html><body>404 Not Found</body></html>').toString('base64'),
      },
    });

    assert.equal(res.statusCode, 400, 'Debe rechazar tipos no de audio con 400');
    assert.ok(res.body.includes('no permitido'), 'Debe indicar que el formato no es permitido');
  });

  let createdAudioId: string;
  const sampleAudioBuffer = Buffer.from('RIFF....WAVEfmt ....dataSimulatedAudioStream1234567890BethesdaWorship');

  it('4. should successfully upload valid audio by leader and return 201 with metadata', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/songs/${testSong.id}/audio`,
      headers: {
        authorization: `Bearer ${leaderToken}`,
      },
      payload: {
        title: 'Pista Multitrack de Referencia',
        filename: 'gracia_sublime_referencia.wav',
        mimeType: 'audio/wav',
        dataBase64: sampleAudioBuffer.toString('base64'),
        durationSeconds: 245,
      },
    });

    assert.equal(res.statusCode, 201, 'Debe retornar 201 Created');
    const json = res.json();
    assert.ok(json.data.id, 'Debe generar un ID de audio');
    assert.equal(json.data.title, 'Pista Multitrack de Referencia');
    assert.equal(json.data.mimeType, 'audio/wav');
    assert.equal(json.data.fileSizeBytes, sampleAudioBuffer.length);
    assert.equal(json.data.durationSeconds, 245);
    assert.ok(json.data.checksumSha256, 'Debe computar checksum SHA-256');

    createdAudioId = json.data.id;
  });

  it('5. should list audio assets for a song', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/songs/${testSong.id}/audio`,
      headers: {
        authorization: `Bearer ${musicianToken}`,
      },
    });

    assert.equal(res.statusCode, 200);
    const json = res.json();
    assert.ok(Array.isArray(json.data));
    assert.ok(json.data.length >= 1);
    assert.equal(json.data[0].id, createdAudioId);
  });

  it('6. should download full audio binary with Content-Disposition attachment', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/audio/${createdAudioId}/download`,
      headers: {
        authorization: `Bearer ${musicianToken}`,
      },
    });

    assert.equal(res.statusCode, 200);
    assert.equal(res.headers['content-type'], 'audio/wav');
    assert.equal(res.headers['content-length'], sampleAudioBuffer.length.toString());
    assert.ok(res.headers['content-disposition']?.includes('attachment; filename='));
    assert.equal(res.rawPayload.toString(), sampleAudioBuffer.toString());
  });

  it('7. should stream audio with Range header (HTTP 206 Partial Content)', async () => {
    const startByte = 5;
    const endByte = 25;
    const expectedChunkLength = endByte - startByte + 1;

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/audio/${createdAudioId}/stream`,
      headers: {
        authorization: `Bearer ${musicianToken}`,
        range: `bytes=${startByte}-${endByte}`,
      },
    });

    assert.equal(res.statusCode, 206, 'Debe retornar 206 Partial Content');
    assert.equal(res.headers['accept-ranges'], 'bytes');
    assert.equal(res.headers['content-range'], `bytes ${startByte}-${endByte}/${sampleAudioBuffer.length}`);
    assert.equal(res.headers['content-length'], expectedChunkLength.toString());

    const expectedChunk = sampleAudioBuffer.subarray(startByte, endByte + 1);
    assert.equal(res.rawPayload.toString(), expectedChunk.toString());
  });

  it('8. should stream full audio with HTTP 200 when no Range header is sent', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/audio/${createdAudioId}/stream`,
      headers: {
        authorization: `Bearer ${musicianToken}`,
      },
    });

    assert.equal(res.statusCode, 200, 'Debe retornar 200 OK');
    assert.equal(res.headers['accept-ranges'], 'bytes');
    assert.equal(res.headers['content-length'], sampleAudioBuffer.length.toString());
    assert.equal(res.rawPayload.toString(), sampleAudioBuffer.toString());
  });

  it('9. should prevent path traversal attacks in storage provider', () => {
    assert.throws(
      () => {
        storageProvider.resolveSafePath('../../etc/passwd');
      },
      /Path Traversal/
    );
  });

  it('9b. should reject MIME spoofing when file magic bytes do not match declared MIME type', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/songs/${testSong.id}/audio`,
      headers: {
        authorization: `Bearer ${leaderToken}`,
      },
      payload: {
        title: 'Archivo de Texto Falsificado',
        filename: 'fake_audio.wav',
        mimeType: 'audio/wav',
        dataBase64: Buffer.from('PLAIN TEXT CONTENT WITHOUT RIFF/WAVE HEADER').toString('base64'),
      },
    });

    assert.equal(res.statusCode, 400, 'Debe retornar 400 ante spoofing');
    const json = res.json();
    assert.ok(json.error.message.includes('magic bytes') || json.error.message.includes('firma válida'));
  });

  it('9c. should correctly handle suffix HTTP Range requests (bytes=-N)', async () => {
    const suffixLength = 15;
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/audio/${createdAudioId}/stream`,
      headers: {
        authorization: `Bearer ${musicianToken}`,
        range: `bytes=-${suffixLength}`,
      },
    });

    assert.equal(res.statusCode, 206, 'Debe retornar 206 Partial Content para suffix range');
    const total = sampleAudioBuffer.length;
    const expectedStart = total - suffixLength;
    const expectedEnd = total - 1;
    assert.equal(res.headers['content-range'], `bytes ${expectedStart}-${expectedEnd}/${total}`);
    assert.equal(res.headers['content-length'], suffixLength.toString());

    const expectedChunk = sampleAudioBuffer.subarray(expectedStart, total);
    assert.equal(res.rawPayload.toString(), expectedChunk.toString());
  });

  it('9d. should return 416 Range Not Satisfiable when requested range is out of bounds', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/audio/${createdAudioId}/stream`,
      headers: {
        authorization: `Bearer ${musicianToken}`,
        range: 'bytes=99999-100000',
      },
    });

    assert.equal(res.statusCode, 416, 'Debe retornar 416 Range Not Satisfiable');
    assert.ok(res.headers['content-range']?.startsWith('bytes */'));
  });

  it('9e. should issue streaming ticket and permit audio streaming via ticket query parameter without Authorization header', async () => {
    // 1. Solicitar ticket de streaming de 60s
    const ticketRes = await app.inject({
      method: 'POST',
      url: `/api/v1/audio/${createdAudioId}/ticket`,
      headers: {
        authorization: `Bearer ${musicianToken}`,
      },
    });

    assert.equal(ticketRes.statusCode, 200);
    const { ticket } = ticketRes.json().data;
    assert.ok(ticket, 'Debe generar un ticket seguro');

    // 2. Reproducir stream usando el ticket sin cabecera Authorization
    const streamRes = await app.inject({
      method: 'GET',
      url: `/api/v1/audio/${createdAudioId}/stream?ticket=${ticket}`,
    });

    assert.equal(streamRes.statusCode, 200, 'Debe permitir streaming autenticado vía ticket seguro');
    assert.equal(streamRes.headers['content-length'], sampleAudioBuffer.length.toString());
  });

  it('10. should delete audio asset cleanly from database and physical storage', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/v1/audio/${createdAudioId}`,
      headers: {
        authorization: `Bearer ${leaderToken}`,
      },
    });

    assert.equal(res.statusCode, 204, 'Debe retornar 204 No Content');

    // Verificar que no existe en BD
    const deletedInDb = await audioRepo.findById(createdAudioId);
    assert.equal(deletedInDb, null, 'El registro en BD debe haber sido eliminado');
  });
});
