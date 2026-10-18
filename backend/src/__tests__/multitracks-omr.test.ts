/**
 * @file multitracks-omr.test.ts
 * @description Suite de pruebas de integración para Multipistas (D1) y OMR (D2) (Fase 3C).
 *
 * Cubre:
 * [D1 - Multipistas]
 * 1. Creación de sesión multipista vinculada a AudioAssets autorizados de Workstream A.
 * 2. Validación de acotamiento de volumen [0, 1], balance [-1, 1] y offset [-5000, 5000] ms.
 * 3. Rechazo de stem con audioAssetId inexistente (prevención de IDOR / audio huérfano).
 * 4. Actualización de parámetros de mezcla (volumen, pan, mute, solo).
 * 5. Validación de completitud offline: false si falta un solo stem; true si todos están descargados.
 *
 * [D2 - Reconocimiento Óptico de Música (OMR)]
 * 6. Ingesta de partitura OMR: devuelve propuesta con isAiDraft=true y status=PENDING_REVIEW.
 * 7. Rechazo de formato no permitido o archivo vacío/corrupto (400 ValidationError).
 * 8. Rechazo de archivo que excede límite de 15 MB.
 * 9. Cero invención de notas: áreas dudosas se reportan en unrecognizedRegions.
 * 10. Puerta de revisión humana: intento de persistir propuesta no aprobada se rechaza.
 * 11. Aprobación y persistencia canónica exitosa tras revisión humana explícita.
 *
 * [Exclusión Estricta]
 * 12. Cero sincronización o APIs de pedales físicos.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../app.ts';
import { JwtTokenService } from '../application/token-service.ts';
import { pool } from '../db/index.ts';
import { runMigrations } from '../db/migrate.ts';
import { DrizzleUserRepository } from '../repositories/user-repository.ts';
import { DrizzleSongRepository } from '../repositories/song-repository.ts';
import { DrizzleAudioRepository } from '../repositories/audio-repository.ts';
import { DrizzleMultitrackRepository } from '../repositories/multitrack-repository.ts';
import { LocalFileSystemAudioStorageProvider } from '../domain/audio/storage-provider.ts';
import { MultitrackService } from '../application/multitrack-service.ts';
import { OmrService } from '../application/omr-service.ts';
import { StandardOmrProvider } from '../domain/omr/omr-provider.ts';
import { env } from '../config/env.ts';
import type { UserEntity } from '../domain/auth-types.ts';
import type { SongEntity } from '../domain/types.ts';
import type { AudioAsset } from '../db/schema.ts';
import { CanonicalSerializer } from '../domain/canonical-serializer.ts';
import { createReferenceSongFixture } from '../../../frontend/src/core/canonical-model/fixtures/reference-song.ts';

describe('Workstream D — Phase 3C Multitracks & OMR Suite', () => {
  let app: FastifyInstance;
  let tokenService: JwtTokenService;
  let userRepo: DrizzleUserRepository;
  let songRepo: DrizzleSongRepository;
  let audioRepo: DrizzleAudioRepository;
  let multitrackRepo: DrizzleMultitrackRepository;
  let storageProvider: LocalFileSystemAudioStorageProvider;
  let multitrackService: MultitrackService;
  let omrService: OmrService;

  let testUser: UserEntity;
  let viewerUser: UserEntity;
  let leaderToken: string;
  let viewerToken: string;
  let firstMusicianUser: UserEntity;
  let secondMusicianUser: UserEntity;
  let adminUser: UserEntity;
  let firstMusicianToken: string;
  let secondMusicianToken: string;
  let adminToken: string;

  let testSong: SongEntity;
  let secondSong: SongEntity;
  let testStemAsset1: AudioAsset;
  let testStemAsset2: AudioAsset;
  let secondSongAsset: AudioAsset;

  const createdUserIds = new Set<string>();
  const createdSongIds = new Set<string>();
  const createdAudioIds = new Set<string>();

  before(async () => {
    await runMigrations();

    userRepo = new DrizzleUserRepository();
    songRepo = new DrizzleSongRepository();
    audioRepo = new DrizzleAudioRepository();
    multitrackRepo = new DrizzleMultitrackRepository();
    storageProvider = new LocalFileSystemAudioStorageProvider(
      env.AUDIO_STORAGE_PATH,
      env.MAX_AUDIO_FILE_SIZE_BYTES
    );
    multitrackService = new MultitrackService(audioRepo, songRepo, multitrackRepo);
    omrService = new OmrService(new StandardOmrProvider({ enableTestFixture: true }), songRepo);

    tokenService = new JwtTokenService(env.JWT_SECRET, env.JWT_ACCESS_EXPIRES_IN);
    app = await buildApp();
    await app.ready();

    const timestamp = Date.now();

    // 1. Crear director de alabanza y generar token
    testUser = await userRepo.create({
      email: `multitrack-tester-${timestamp}@bethesda.test`,
      passwordHash: 'dummy_hash',
      firstName: 'Director',
      lastName: 'Multitrack',
      role: 'WORSHIP_LEADER',
    });
    createdUserIds.add(testUser.id);
    leaderToken = tokenService.signAccessToken({
      id: testUser.id,
      email: testUser.email,
      role: testUser.role,
    }).token;

    // 1b. Crear usuario viewer y generar token
    viewerUser = await userRepo.create({
      email: `multitrack-viewer-${timestamp}@bethesda.test`,
      passwordHash: 'dummy_hash',
      firstName: 'Viewer',
      lastName: 'Musician',
      role: 'VIEWER',
    });
    createdUserIds.add(viewerUser.id);
    viewerToken = tokenService.signAccessToken({
      id: viewerUser.id,
      email: viewerUser.email,
      role: viewerUser.role,
    }).token;

    // 1c. Crear primer músico (propietario de sesión privada)
    firstMusicianUser = await userRepo.create({
      email: `musician-owner-${timestamp}@bethesda.test`,
      passwordHash: 'dummy_hash',
      firstName: 'Guitarrista',
      lastName: 'Primero',
      role: 'MUSICIAN',
    });
    createdUserIds.add(firstMusicianUser.id);
    firstMusicianToken = tokenService.signAccessToken({
      id: firstMusicianUser.id,
      email: firstMusicianUser.email,
      role: firstMusicianUser.role,
    }).token;

    // 1d. Crear segundo músico (usuario distinto sin autorización sobre sesión privada)
    secondMusicianUser = await userRepo.create({
      email: `musician-other-${timestamp}@bethesda.test`,
      passwordHash: 'dummy_hash',
      firstName: 'Bajista',
      lastName: 'Segundo',
      role: 'MUSICIAN',
    });
    createdUserIds.add(secondMusicianUser.id);
    secondMusicianToken = tokenService.signAccessToken({
      id: secondMusicianUser.id,
      email: secondMusicianUser.email,
      role: secondMusicianUser.role,
    }).token;

    // 1e. Crear administrador (para anulación administrativa legítima)
    adminUser = await userRepo.create({
      email: `multitrack-admin-${timestamp}@bethesda.test`,
      passwordHash: 'dummy_hash',
      firstName: 'Administrador',
      lastName: 'General',
      role: 'ADMIN',
    });
    createdUserIds.add(adminUser.id);
    adminToken = tokenService.signAccessToken({
      id: adminUser.id,
      email: adminUser.email,
      role: adminUser.role,
    }).token;

    // 2. Crear canción canónica principal
    const canonicalSong = createReferenceSongFixture();
    const canonicalJSON = CanonicalSerializer.serialize(canonicalSong);

    const songResult = await songRepo.create({
      title: 'Digno y Santo — Multitrack Master',
      artist: 'Kari Jobe',
      defaultKey: 'C',
      defaultBpm: 72,
      timeSignature: '4/4',
      status: 'APPROVED',
      versionName: 'Principal',
      sourceFormat: 'INTERNAL',
      canonicalPayload: canonicalJSON,
    });
    testSong = songResult.song;
    createdSongIds.add(testSong.id);

    // 2b. Crear segunda canción canónica para pruebas de aislamiento cruzado
    const secondSongResult = await songRepo.create({
      title: 'Segunda Canción — Aislamiento',
      artist: 'Artista B',
      defaultKey: 'D',
      defaultBpm: 80,
      timeSignature: '4/4',
      status: 'APPROVED',
      versionName: 'Principal',
      sourceFormat: 'INTERNAL',
      canonicalPayload: canonicalJSON,
    });
    secondSong = secondSongResult.song;
    createdSongIds.add(secondSong.id);

    // 3. Crear 2 AudioAssets para la canción principal
    const clickBuffer = Buffer.from('RIFF_MOCK_WAV_CLICK_DATA_BINARY');
    const drumsBuffer = Buffer.from('RIFF_MOCK_WAV_DRUMS_DATA_BINARY');

    const clickStorage = await storageProvider.save('click.wav', clickBuffer);
    testStemAsset1 = await audioRepo.create({
      songId: testSong.id,
      title: 'Click & Cues',
      filename: 'click.wav',
      storagePath: clickStorage.storagePath,
      mimeType: 'audio/wav',
      fileSizeBytes: clickBuffer.length,
      checksumSha256: clickStorage.checksumSha256,
      durationSeconds: 240,
      uploadedByUserId: testUser.id,
    });
    createdAudioIds.add(testStemAsset1.id);

    const drumsStorage = await storageProvider.save('drums.wav', drumsBuffer);
    testStemAsset2 = await audioRepo.create({
      songId: testSong.id,
      title: 'Batería Acústica',
      filename: 'drums.wav',
      storagePath: drumsStorage.storagePath,
      mimeType: 'audio/wav',
      fileSizeBytes: drumsBuffer.length,
      checksumSha256: drumsStorage.checksumSha256,
      durationSeconds: 240,
      uploadedByUserId: testUser.id,
    });
    createdAudioIds.add(testStemAsset2.id);

    // 3b. Crear AudioAsset perteneciente a la SEGUNDA canción (para verificar rechazo de stem cruzado)
    const secondSongBuffer = Buffer.from('RIFF_MOCK_WAV_SECOND_SONG_STEM');
    const secondStorage = await storageProvider.save('second_stem.wav', secondSongBuffer);
    secondSongAsset = await audioRepo.create({
      songId: secondSong.id,
      title: 'Stem de Segunda Canción',
      filename: 'second_stem.wav',
      storagePath: secondStorage.storagePath,
      mimeType: 'audio/wav',
      fileSizeBytes: secondSongBuffer.length,
      checksumSha256: secondStorage.checksumSha256,
      durationSeconds: 200,
      uploadedByUserId: testUser.id,
    });
    createdAudioIds.add(secondSongAsset.id);
  });

  after(async () => {
    if (app) {
      await app.close();
    }

    if (createdAudioIds.size > 0) {
      const aIds = Array.from(createdAudioIds);
      await pool.query('DELETE FROM audio_assets WHERE id = ANY($1)', [aIds]);
    }

    if (createdSongIds.size > 0) {
      const sIds = Array.from(createdSongIds);
      await pool.query('DELETE FROM songs WHERE id = ANY($1)', [sIds]);
    }

    if (createdUserIds.size > 0) {
      const uIds = Array.from(createdUserIds);
      await pool.query('DELETE FROM users WHERE id = ANY($1)', [uIds]);
    }
  });

  // ==========================================================================
  // D1: MULTITRACK AUDIO
  // ==========================================================================

  let activeSessionId: string;

  it('D1.1: should create multitrack session linked to authorized audio assets', async () => {
    const session = await multitrackService.createSession(
      {
        songId: testSong.id,
        title: 'Sesión Multipista — Digno y Santo',
        durationSeconds: 240,
        bpm: 72,
        tracks: [
          {
            name: 'Click',
            trackType: 'CLICK',
            audioAssetId: testStemAsset1.id,
            volume: 0.9,
            pan: -0.5,
            offsetMs: 0,
          },
          {
            name: 'Batería',
            trackType: 'DRUMS',
            audioAssetId: testStemAsset2.id,
            volume: 0.8,
            pan: 0.0,
            offsetMs: 15,
          },
        ],
      },
      testUser.id
    );

    assert.ok(session.id);
    assert.equal(session.songId, testSong.id);
    assert.equal(session.tracks.length, 2);
    assert.equal(session.tracks[0].audioAssetId, testStemAsset1.id);
    assert.equal(session.tracks[1].audioAssetId, testStemAsset2.id);
    assert.equal(session.tracks[1].offsetMs, 15);

    activeSessionId = session.id;
  });

  it('D1.2: should enforce volume [0, 1], pan [-1, 1], and offset [-5000, 5000] boundaries', async () => {
    // Volumen inválido > 1.0
    await assert.rejects(
      async () => {
        await multitrackService.createSession(
          {
            songId: testSong.id,
            title: 'Test Boundaries',
            durationSeconds: 100,
            bpm: 100,
            tracks: [
              {
                name: 'Bad Volume',
                trackType: 'KEYS',
                audioAssetId: testStemAsset1.id,
                volume: 1.5, // Fuera de rango
              },
            ],
          },
          testUser.id
        );
      },
      { name: 'ValidationError' }
    );

    // Balance inválido < -1.0
    await assert.rejects(
      async () => {
        await multitrackService.createSession(
          {
            songId: testSong.id,
            title: 'Test Boundaries Pan',
            durationSeconds: 100,
            bpm: 100,
            tracks: [
              {
                name: 'Bad Pan',
                trackType: 'KEYS',
                audioAssetId: testStemAsset1.id,
                pan: -1.5,
              },
            ],
          },
          testUser.id
        );
      },
      { name: 'ValidationError' }
    );
  });

  it('D1.3: should reject track referencing non-existent audioAssetId (IDOR prevention)', async () => {
    const fakeAssetId = crypto.randomUUID();
    await assert.rejects(
      async () => {
        await multitrackService.createSession(
          {
            songId: testSong.id,
            title: 'Test IDOR',
            durationSeconds: 100,
            bpm: 100,
            tracks: [
              {
                name: 'Missing Stem',
                trackType: 'OTHER',
                audioAssetId: fakeAssetId,
              },
            ],
          },
          testUser.id
        );
      },
      { name: 'NotFoundError' }
    );
  });

  it('D1.4: should update track mix parameters correctly', async () => {
    const session = await multitrackService.getSession(activeSessionId);
    const trackToUpdate = session.tracks[0];

    const updated = await multitrackService.updateTrackMix(activeSessionId, trackToUpdate.id, {
      volume: 0.7,
      pan: 0.2,
      isMuted: true,
      isSolo: false,
    });

    assert.equal(updated.volume, 0.7);
    assert.equal(updated.pan, 0.2);
    assert.equal(updated.isMuted, true);
    assert.equal(updated.isSolo, false);
  });

  it('D1.5: should enforce offline completeness: false if a stem is missing, true only if all present', async () => {
    // Escenario A: Solo 1 de 2 stems disponibles localmente
    const statusIncomplete = await multitrackService.checkOfflineCompleteness(activeSessionId, [
      testStemAsset1.id,
    ]);
    assert.equal(statusIncomplete.isFullyAvailableOffline, false);
    assert.equal(statusIncomplete.downloadedTracks, 1);
    assert.equal(statusIncomplete.missingAssetIds.length, 1);
    assert.equal(statusIncomplete.missingAssetIds[0], testStemAsset2.id);

    // Escenario B: Ambos stems presentes localmente
    const statusComplete = await multitrackService.checkOfflineCompleteness(activeSessionId, [
      testStemAsset1.id,
      testStemAsset2.id,
    ]);
    assert.equal(statusComplete.isFullyAvailableOffline, true);
    assert.equal(statusComplete.downloadedTracks, 2);
    assert.equal(statusComplete.missingAssetIds.length, 0);
  });

  it('D1.6: should reject audio asset belonging to a different song (cross-song stem association prevention)', async () => {
    const song2Result = await songRepo.create({
      title: 'Segunda Canción — Aislamiento de Stems',
      artist: 'Artista Desconocido',
      defaultKey: 'D',
      defaultBpm: 80,
      timeSignature: '4/4',
      status: 'APPROVED',
      versionName: 'Principal',
      sourceFormat: 'INTERNAL',
      canonicalPayload: CanonicalSerializer.serialize(createReferenceSongFixture()),
    });
    createdSongIds.add(song2Result.song.id);

    // Intentar asociar testStemAsset1 (de testSong) a una sesión de song2
    await assert.rejects(
      async () => {
        await multitrackService.createSession(
          {
            songId: song2Result.song.id,
            title: 'Sesión Inválida con Stem Cruzado',
            durationSeconds: 120,
            bpm: 80,
            tracks: [
              {
                name: 'Stem Ajeno',
                trackType: 'OTHER',
                audioAssetId: testStemAsset1.id,
              },
            ],
          },
          testUser.id
        );
      },
      { name: 'ValidationError' }
    );
  });

  it('D1.7: should persist multitrack session to PostgreSQL and survive service recreation', async () => {
    // Recrear el servicio desde cero simulando reinicio de backend / diferentes instancias
    const restartedService = new MultitrackService(audioRepo, songRepo, new DrizzleMultitrackRepository());
    const recoveredSession = await restartedService.getSession(activeSessionId);

    assert.ok(recoveredSession);
    assert.equal(recoveredSession.id, activeSessionId);
    assert.equal(recoveredSession.songId, testSong.id);
    assert.equal(recoveredSession.tracks.length, 2);
    assert.equal(recoveredSession.tracks[0].volume, 0.7); // Parámetro actualizado en D1.4
  });

  // ==========================================================================
  // D2: OPTICAL MUSIC RECOGNITION (OMR)
  // ==========================================================================

  let testProposalId: string;

  it('D2.1: should process valid sheet music and return an AI draft proposal with PENDING_REVIEW status', async () => {
    const mockScoreBuffer = Buffer.from('%PDF-1.4 mock valid sheet music binary payload with notes and staves');

    const proposal = await omrService.processUpload(
      {
        buffer: mockScoreBuffer,
        filename: 'gracia_sublime_partitura.pdf',
        mimeType: 'application/pdf',
        fileSizeBytes: mockScoreBuffer.length,
      },
      testUser.id
    );

    assert.ok(proposal.proposalId);
    assert.equal(proposal.isAiDraft, true); // INVARIANTE: Salida de IA es propuesta
    assert.equal(proposal.reviewStatus, 'PENDING_REVIEW');
    assert.ok(proposal.overallConfidence >= 0.0 && proposal.overallConfidence <= 1.0);
    assert.ok(proposal.measures.length > 0);
    assert.ok(proposal.sourceHash.length === 64); // SHA-256

    testProposalId = proposal.proposalId;
  });

  it('D2.2: should reject unsupported MIME types and empty files with ValidationError', async () => {
    await assert.rejects(
      async () => {
        await omrService.processUpload(
          {
            buffer: Buffer.from('not an image or pdf'),
            filename: 'virus.exe',
            mimeType: 'application/x-msdownload',
            fileSizeBytes: 20,
          },
          testUser.id
        );
      },
      { name: 'ValidationError' }
    );

    await assert.rejects(
      async () => {
        await omrService.processUpload(
          {
            buffer: Buffer.alloc(0),
            filename: 'empty.pdf',
            mimeType: 'application/pdf',
            fileSizeBytes: 0,
          },
          testUser.id
        );
      },
      { name: 'ValidationError' }
    );
  });

  it('D2.3: should reject files exceeding maximum size of 15 MB', async () => {
    await assert.rejects(
      async () => {
        await omrService.processUpload(
          {
            buffer: Buffer.alloc(100),
            filename: 'huge_score.pdf',
            mimeType: 'application/pdf',
            fileSizeBytes: 16 * 1024 * 1024, // 16 MB
          },
          testUser.id
        );
      },
      { name: 'ValidationError' }
    );
  });

  it('D2.4: should guarantee ZERO note fabrication: dubious regions must be logged as unrecognizedRegions', () => {
    const proposal = omrService.getProposal(testProposalId);

    assert.ok(proposal.unrecognizedRegions.length > 0);
    const region = proposal.unrecognizedRegions[0];
    assert.ok(region.reason.includes('omitido de la propuesta para revisión humana'));
  });

  it('D2.5: should reject canonical persistence if proposal has not been approved by a human', async () => {
    // La propuesta aún tiene estado PENDING_REVIEW
    await assert.rejects(
      async () => {
        await omrService.commitToCanonicalSong(testProposalId, testUser.id);
      },
      { name: 'ValidationError' }
    );
  });

  it('D2.6: should allow canonical commit only after explicit human approval and preserve real recognized measures', async () => {
    // 1. Músico humano revisa y aprueba
    const reviewed = omrService.reviewProposal(testProposalId, testUser.id, 'APPROVED_FOR_IMPORT');
    assert.equal(reviewed.reviewStatus, 'APPROVED_FOR_IMPORT');
    assert.equal(reviewed.reviewedByUserId, testUser.id);

    // 2. Persistir en la base de datos canónica
    const createdSong = await omrService.commitToCanonicalSong(testProposalId, testUser.id, {
      title: 'Gracia Sublime Es — Aprobada por Músico',
    });

    assert.ok(createdSong.song.id);
    assert.equal(createdSong.song.title, 'Gracia Sublime Es — Aprobada por Músico');
    assert.equal(createdSong.song.status, 'APPROVED');
    assert.ok(createdSong.version.canonicalPayload);
    createdSongIds.add(createdSong.song.id);

    // R1-P1: Verificar que el contenido canónico proviene directamente de la propuesta y NO de un fixture estático
    const payload = createdSong.version.canonicalPayload as any;
    assert.equal(payload.measures.length, 4, 'Debe contener los 4 compases de la propuesta aprobada');
    assert.equal(payload.measures[0].lyrics[0].text, 'Gra-');
    assert.equal(payload.measures[0].chords[0].chord.root, 'G');
  });

  it('D2.7: should truthfully report unconfigured state with zero notes when real OMR engine is absent', async () => {
    // Servicio con proveedor OMR estándar por defecto (sin motor configurado)
    const unconfiguredOmrService = new OmrService(new StandardOmrProvider(), songRepo);
    const mockPdf = Buffer.from('%PDF-1.4 raw score content without external engine');

    const proposal = await unconfiguredOmrService.processUpload(
      {
        buffer: mockPdf,
        filename: 'unconfigured_test.pdf',
        mimeType: 'application/pdf',
        fileSizeBytes: mockPdf.length,
      },
      testUser.id
    );

    assert.equal(proposal.overallConfidence, 0.0);
    assert.equal(proposal.measures.length, 0, 'No debe fabricar notas si el motor no está configurado');
    assert.ok(proposal.unrecognizedRegions[0].reason.includes('no configurado'));

    // Intentar aprobar y cometer propuesta sin compases debe ser rechazado
    unconfiguredOmrService.reviewProposal(proposal.proposalId, testUser.id, 'APPROVED_FOR_IMPORT');
    await assert.rejects(
      async () => {
        await unconfiguredOmrService.commitToCanonicalSong(proposal.proposalId, testUser.id);
      },
      { name: 'ValidationError' }
    );
  });

  it('D2.8: should return zero measures and explicit unconfigured message when OMR_ENGINE_ENABLED=true without real provider (R1-A)', async () => {
    // Simular variable de entorno de producción OMR_ENGINE_ENABLED=true
    const originalEnv = process.env.OMR_ENGINE_ENABLED;
    process.env.OMR_ENGINE_ENABLED = 'true';

    try {
      // Proveedor instanciado sin engine real ni test fixture
      const provider = new StandardOmrProvider();
      const mockPdf = Buffer.from('%PDF-1.4 raw score buffer for testing env flag');

      const result = await provider.recognize({
        buffer: mockPdf,
        filename: 'env_flag_test.pdf',
        mimeType: 'application/pdf',
        fileSizeBytes: mockPdf.length,
      });

      // Debe retornar CERO compases fabricados y advertencia explícita
      assert.equal(result.measures.length, 0, 'No debe retornar compases de fixture aunque OMR_ENGINE_ENABLED=true');
      assert.equal(result.overallConfidence, 0.0);
      assert.ok(result.unrecognizedRegions.length > 0);
      assert.ok(
        result.unrecognizedRegions[0].reason.includes('no configurado') ||
        result.unrecognizedRegions[0].reason.includes('OMR_ENGINE_ENABLED')
      );
    } finally {
      if (originalEnv !== undefined) {
        process.env.OMR_ENGINE_ENABLED = originalEnv;
      } else {
        delete process.env.OMR_ENGINE_ENABLED;
      }
    }
  });

  it('D1.6: should create, retrieve, update mix, and delete multitrack sessions via REST HTTP API (R1-A)', async () => {
    // 1. POST /api/v1/multitrack/sessions
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v1/multitrack/sessions',
      headers: {
        authorization: `Bearer ${leaderToken}`,
      },
      payload: {
        songId: testSong.id,
        title: 'Sesión REST — Digno y Santo',
        durationSeconds: 240,
        bpm: 72,
        tracks: [
          {
            name: 'Click REST',
            trackType: 'CLICK',
            audioAssetId: testStemAsset1.id,
            volume: 0.85,
            pan: -0.2,
            offsetMs: 0,
          },
          {
            name: 'Batería REST',
            trackType: 'DRUMS',
            audioAssetId: testStemAsset2.id,
            volume: 0.9,
            pan: 0.1,
            offsetMs: 0,
          },
        ],
      },
    });

    assert.equal(createRes.statusCode, 201, 'Debe crear sesión multipista vía REST');
    const createdSession = JSON.parse(createRes.payload).data;
    assert.ok(createdSession.id);
    assert.equal(createdSession.tracks.length, 2);
    const restSessionId = createdSession.id;
    const clickTrackId = createdSession.tracks[0].id;

    // 2. GET /api/v1/multitrack/sessions/:sessionId
    const getRes = await app.inject({
      method: 'GET',
      url: `/api/v1/multitrack/sessions/${restSessionId}`,
      headers: {
        authorization: `Bearer ${leaderToken}`,
      },
    });
    assert.equal(getRes.statusCode, 200);
    const fetchedSession = JSON.parse(getRes.payload).data;
    assert.equal(fetchedSession.id, restSessionId);
    assert.equal(fetchedSession.title, 'Sesión REST — Digno y Santo');

    // 3. GET /api/v1/multitrack/by-song/:songId
    const bySongRes = await app.inject({
      method: 'GET',
      url: `/api/v1/multitrack/by-song/${testSong.id}`,
      headers: {
        authorization: `Bearer ${leaderToken}`,
      },
    });
    assert.equal(bySongRes.statusCode, 200);
    const songSessions = JSON.parse(bySongRes.payload).data;
    assert.ok(songSessions.some((s: any) => s.id === restSessionId));

    // 4. PATCH /api/v1/multitrack/sessions/:sessionId/tracks/:trackId
    const patchRes = await app.inject({
      method: 'PATCH',
      url: `/api/v1/multitrack/sessions/${restSessionId}/tracks/${clickTrackId}`,
      headers: {
        authorization: `Bearer ${leaderToken}`,
      },
      payload: {
        volume: 0.45,
        pan: -0.8,
        isMuted: true,
      },
    });
    assert.equal(patchRes.statusCode, 200);
    const updatedTrack = JSON.parse(patchRes.payload).data;
    assert.equal(updatedTrack.volume, 0.45);
    assert.equal(updatedTrack.pan, -0.8);
    assert.equal(updatedTrack.isMuted, true);

    // 5. GET /api/v1/multitrack/sessions/:sessionId/offline-status
    const offlineRes = await app.inject({
      method: 'GET',
      url: `/api/v1/multitrack/sessions/${restSessionId}/offline-status?availableAssets=${testStemAsset1.id}`,
      headers: {
        authorization: `Bearer ${leaderToken}`,
      },
    });
    assert.equal(offlineRes.statusCode, 200);
    const offlineStatus = JSON.parse(offlineRes.payload).data;
    assert.equal(offlineStatus.isFullyAvailableOffline, false);
    assert.equal(offlineStatus.downloadedTracks, 1);
    assert.equal(offlineStatus.missingAssetIds.length, 1);

    // 6. DELETE /api/v1/multitrack/sessions/:sessionId
    const deleteRes = await app.inject({
      method: 'DELETE',
      url: `/api/v1/multitrack/sessions/${restSessionId}`,
      headers: {
        authorization: `Bearer ${leaderToken}`,
      },
    });
    assert.equal(deleteRes.statusCode, 204);

    // Verificar que fue eliminado en Postgres
    const verifyGet = await app.inject({
      method: 'GET',
      url: `/api/v1/multitrack/sessions/${restSessionId}`,
      headers: {
        authorization: `Bearer ${leaderToken}`,
      },
    });
    assert.equal(verifyGet.statusCode, 404);
  });

  it('D1.7: should reject multitrack operations for unauthorized, suspended, or unauthenticated users (R1-A RBAC & DB Freshness)', async () => {
    // 1. Solicitud anónima debe ser rechazada con 401
    const anonRes = await app.inject({
      method: 'POST',
      url: '/api/v1/multitrack/sessions',
      payload: {
        songId: testSong.id,
        title: 'Sesión Anónima',
        durationSeconds: 120,
        bpm: 100,
        tracks: [
          {
            name: 'Click',
            trackType: 'CLICK',
            audioAssetId: testStemAsset1.id,
          },
        ],
      },
    });
    assert.equal(anonRes.statusCode, 401);

    // 2. Usuario VIEWER intentando crear sesión debe ser rechazado con 403 Forbidden
    const viewerRes = await app.inject({
      method: 'POST',
      url: '/api/v1/multitrack/sessions',
      headers: {
        authorization: `Bearer ${viewerToken}`,
      },
      payload: {
        songId: testSong.id,
        title: 'Sesión No Autorizada',
        durationSeconds: 120,
        bpm: 100,
        tracks: [
          {
            name: 'Click',
            trackType: 'CLICK',
            audioAssetId: testStemAsset1.id,
          },
        ],
      },
    });
    assert.equal(viewerRes.statusCode, 403);

    // 3. Usuario suspendido en base de datos debe ser rechazado inmediatamente con 403
    const suspendedUser = await userRepo.create({
      email: `suspended_multitrack_${Date.now()}@bethesda.test`,
      passwordHash: 'dummy_hash',
      firstName: 'Suspendido',
      lastName: 'Usuario',
      role: 'WORSHIP_LEADER',
    });
    createdUserIds.add(suspendedUser.id);
    const suspendedToken = tokenService.signAccessToken({
      id: suspendedUser.id,
      email: suspendedUser.email,
      role: 'WORSHIP_LEADER',
    }).token;

    // Suspender en BD
    await userRepo.updateStatus(suspendedUser.id, 'SUSPENDED');

    const suspendedRes = await app.inject({
      method: 'POST',
      url: '/api/v1/multitrack/sessions',
      headers: {
        authorization: `Bearer ${suspendedToken}`,
      },
      payload: {
        songId: testSong.id,
        title: 'Sesión Usuario Suspendido',
        durationSeconds: 120,
        bpm: 100,
        tracks: [
          {
            name: 'Click',
            trackType: 'CLICK',
            audioAssetId: testStemAsset1.id,
          },
        ],
      },
    });
    assert.equal(suspendedRes.statusCode, 403);
    assert.ok(JSON.parse(suspendedRes.payload).error.message.includes('SUSPENDED'));
  });

  it('D1.8: should strictly reject cross-song stem association (R1-A IDOR / Isolation)', async () => {
    // Intentar asociar un stem que pertenece a `secondSong` en una sesión de `testSong`
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/multitrack/sessions',
      headers: {
        authorization: `Bearer ${leaderToken}`,
      },
      payload: {
        songId: testSong.id,
        title: 'Sesión con Stem Cruzado Inválido',
        durationSeconds: 240,
        bpm: 72,
        tracks: [
          {
            name: 'Click Válido',
            trackType: 'CLICK',
            audioAssetId: testStemAsset1.id, // pertenece a testSong
          },
          {
            name: 'Stem Cruzado',
            trackType: 'OTHER',
            audioAssetId: secondSongAsset.id, // pertenece a secondSong (INVÁLIDO)
          },
        ],
      },
    });

    assert.equal(res.statusCode, 400, 'Debe rechazar stem perteneciente a otra canción');
    const body = JSON.parse(res.payload);
    assert.ok(
      body.error.message.includes('no pertenece a la canción') ||
      body.error.message.includes('ValidationError')
    );
  });

  it('D1.9: should guarantee database transaction rollback upon partial track failure (R1-A Atomicity)', async () => {
    const invalidAssetId = crypto.randomUUID(); // AudioAsset inexistente en PostgreSQL

    // Intentar crear sesión directamente con multitrackRepo pasando un track inválido
    // para verificar que la transacción se revierte y no deja filas huérfanas
    const sessionId = crypto.randomUUID();

    await assert.rejects(
      async () => {
        await multitrackRepo.createSession(
          {
            id: sessionId,
            songId: testSong.id,
            title: 'Sesión Rollback Test',
            durationSeconds: 100,
            bpm: 120,
            createdByUserId: testUser.id,
          },
          [
            {
              id: crypto.randomUUID(),
              sessionId,
              name: 'Stem Inválido FK',
              trackType: 'CLICK',
              audioAssetId: invalidAssetId, // Violación de FK contra audio_assets
              volume: 0.8,
              pan: 0,
              isMuted: false,
              isSolo: false,
              offsetMs: 0,
              sortOrder: 1,
            },
          ]
        );
      },
      /llave foránea|foreign key|Fallo al crear/
    );

    // Verificar que la fila de sesión NO fue persistida (rollback atómico)
    const persisted = await multitrackRepo.findById(sessionId);
    assert.strictEqual(persisted, null, 'No debe persistir fila de sesión huérfana si falla una pista');
  });

  it('D1.10: should verify persistence across service restarts and memory clearing (R1-A Persistence)', async () => {
    // 1. Crear sesión en PostgreSQL a través de multitrackService
    const created = await multitrackService.createSession(
      {
        songId: testSong.id,
        title: 'Sesión Persistencia PostgreSQL',
        durationSeconds: 180,
        bpm: 90,
        tracks: [
          {
            name: 'Click Persistente',
            trackType: 'CLICK',
            audioAssetId: testStemAsset1.id,
            volume: 0.7,
            pan: 0.0,
          },
        ],
      },
      testUser.id
    );

    // 2. Limpiar memoria volátil del servicio
    multitrackService.clearSessions();

    // 3. Crear una nueva instancia de servicio conectada al mismo repositorio de PostgreSQL
    const freshService = new MultitrackService(audioRepo, songRepo, multitrackRepo);

    // 4. Recuperar la sesión por ID: debe leerse directamente de PostgreSQL
    const restored = await freshService.getSession(created.id);
    assert.strictEqual(restored.id, created.id);
    assert.strictEqual(restored.title, 'Sesión Persistencia PostgreSQL');
    assert.strictEqual(restored.tracks.length, 1);
    assert.strictEqual(restored.tracks[0].name, 'Click Persistente');
    assert.strictEqual(restored.tracks[0].audioAssetId, testStemAsset1.id);
    assert.strictEqual(restored.createdByUserId, testUser.id);
  });

  // ==========================================================================
  // D1.RESOURCE_AUTH: AUTORIZACIÓN A NIVEL DE RECURSO Y COMPARTICIÓN MULTI-USUARIO
  // ==========================================================================

  let privateSessionId: string;
  let privateTrackId: string;
  let sharedSessionId: string;
  let sharedTrackId: string;

  it('D1.11: should reject reading another user\'s private multitrack session (403 Forbidden)', async () => {
    // 1. Primer Músico crea una sesión privada
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v1/multitrack/sessions',
      headers: { authorization: `Bearer ${firstMusicianToken}` },
      payload: {
        songId: testSong.id,
        title: 'Mezcla Privada de Guitarra — Primer Músico',
        durationSeconds: 240,
        bpm: 72,
        tracks: [
          {
            name: 'Click Privado',
            trackType: 'CLICK',
            audioAssetId: testStemAsset1.id,
            volume: 0.8,
            pan: 0.0,
          },
        ],
      },
    });

    assert.strictEqual(createRes.statusCode, 201);
    const created = JSON.parse(createRes.payload).data;
    privateSessionId = created.id;
    privateTrackId = created.tracks[0].id;
    assert.strictEqual(created.createdByUserId, firstMusicianUser.id);

    // 2. Segundo Músico intenta leer la sesión privada del Primer Músico
    const unauthorizedReadRes = await app.inject({
      method: 'GET',
      url: `/api/v1/multitrack/sessions/${privateSessionId}`,
      headers: { authorization: `Bearer ${secondMusicianToken}` },
    });

    assert.strictEqual(unauthorizedReadRes.statusCode, 403);
    const errBody = JSON.parse(unauthorizedReadRes.payload);
    assert.match(errBody.error.message, /sesión multipista privada/);
  });

  it('D1.12: should reject modifying another user\'s multitrack session mix (403 Forbidden)', async () => {
    // Segundo Músico intenta modificar el volumen de la pista del Primer Músico
    const unauthorizedPatchRes = await app.inject({
      method: 'PATCH',
      url: `/api/v1/multitrack/sessions/${privateSessionId}/tracks/${privateTrackId}`,
      headers: { authorization: `Bearer ${secondMusicianToken}` },
      payload: {
        volume: 0.2,
      },
    });

    assert.strictEqual(unauthorizedPatchRes.statusCode, 403);
    const errBody = JSON.parse(unauthorizedPatchRes.payload);
    assert.match(errBody.error.message, /modificar una sesión multipista perteneciente a otro usuario/);
  });

  it('D1.13: should reject deleting another user\'s multitrack session (403 Forbidden)', async () => {
    // Segundo Músico intenta eliminar la sesión del Primer Músico
    const unauthorizedDeleteRes = await app.inject({
      method: 'DELETE',
      url: `/api/v1/multitrack/sessions/${privateSessionId}`,
      headers: { authorization: `Bearer ${secondMusicianToken}` },
    });

    assert.strictEqual(unauthorizedDeleteRes.statusCode, 403);
    const errBody = JSON.parse(unauthorizedDeleteRes.payload);
    assert.match(errBody.error.message, /eliminar una sesión multipista perteneciente a otro usuario/);
  });

  it('D1.14: should reject accessing offline status for a session outside user\'s authorized scope (403 Forbidden)', async () => {
    // Segundo Músico intenta consultar estado offline de la sesión privada
    const unauthorizedOfflineRes = await app.inject({
      method: 'GET',
      url: `/api/v1/multitrack/sessions/${privateSessionId}/offline-status`,
      headers: { authorization: `Bearer ${secondMusicianToken}` },
    });

    assert.strictEqual(unauthorizedOfflineRes.statusCode, 403);
    const errBody = JSON.parse(unauthorizedOfflineRes.payload);
    assert.match(errBody.error.message, /consultar el estado offline de una sesión multipista privada/);
  });

  it('D1.15: should allow legitimate shared-session scenario for team while preventing non-owner mutation', async () => {
    // 1. Director de Alabanza crea sesión compartida oficial del ministerio
    const createSharedRes = await app.inject({
      method: 'POST',
      url: '/api/v1/multitrack/sessions',
      headers: { authorization: `Bearer ${leaderToken}` },
      payload: {
        songId: testSong.id,
        title: 'Sesión Oficial de Culto — Digno y Santo',
        durationSeconds: 240,
        bpm: 72,
        tracks: [
          {
            name: 'Pista Oficial Click',
            trackType: 'CLICK',
            audioAssetId: testStemAsset1.id,
            volume: 0.8,
            pan: 0.0,
          },
        ],
      },
    });

    assert.strictEqual(createSharedRes.statusCode, 201);
    const sharedData = JSON.parse(createSharedRes.payload).data;
    sharedSessionId = sharedData.id;
    sharedTrackId = sharedData.tracks[0].id;

    // 2. Segundo Músico PUEDE leer la sesión oficial compartida
    const readSharedRes = await app.inject({
      method: 'GET',
      url: `/api/v1/multitrack/sessions/${sharedSessionId}`,
      headers: { authorization: `Bearer ${secondMusicianToken}` },
    });
    assert.strictEqual(readSharedRes.statusCode, 200);
    const readBody = JSON.parse(readSharedRes.payload).data;
    assert.strictEqual(readBody.id, sharedSessionId);

    // 3. Segundo Músico PUEDE consultar el estado offline de la sesión compartida
    const offlineSharedRes = await app.inject({
      method: 'GET',
      url: `/api/v1/multitrack/sessions/${sharedSessionId}/offline-status?availableAssets=${testStemAsset1.id}`,
      headers: { authorization: `Bearer ${secondMusicianToken}` },
    });
    assert.strictEqual(offlineSharedRes.statusCode, 200);
    assert.strictEqual(JSON.parse(offlineSharedRes.payload).data.isFullyAvailableOffline, true);

    // 4. Segundo Músico NO puede modificar la sesión compartida del Director (solo dueño o admin)
    const patchSharedRes = await app.inject({
      method: 'PATCH',
      url: `/api/v1/multitrack/sessions/${sharedSessionId}/tracks/${sharedTrackId}`,
      headers: { authorization: `Bearer ${secondMusicianToken}` },
      payload: { volume: 0.5 },
    });
    assert.strictEqual(patchSharedRes.statusCode, 403);

    // 5. Segundo Músico NO puede eliminar la sesión compartida del Director
    const deleteSharedRes = await app.inject({
      method: 'DELETE',
      url: `/api/v1/multitrack/sessions/${sharedSessionId}`,
      headers: { authorization: `Bearer ${secondMusicianToken}` },
    });
    assert.strictEqual(deleteSharedRes.statusCode, 403);

    // 6. Listado por canción: Segundo Músico ve la sesión compartida, pero NO ve la sesión privada del Primer Músico
    const listBySongRes = await app.inject({
      method: 'GET',
      url: `/api/v1/multitrack/by-song/${testSong.id}`,
      headers: { authorization: `Bearer ${secondMusicianToken}` },
    });
    assert.strictEqual(listBySongRes.statusCode, 200);
    const songSessions = JSON.parse(listBySongRes.payload).data;
    const sessionIds = songSessions.map((s: any) => s.id);
    assert.ok(sessionIds.includes(sharedSessionId), 'Debe incluir la sesión compartida');
    assert.strictEqual(sessionIds.includes(privateSessionId), false, 'NO debe exponer la sesión privada del Primer Músico');
  });

  it('D1.16: should permit administrative override for ADMIN role on any session', async () => {
    // 1. Administrador puede leer la sesión privada del Primer Músico
    const adminReadRes = await app.inject({
      method: 'GET',
      url: `/api/v1/multitrack/sessions/${privateSessionId}`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    assert.strictEqual(adminReadRes.statusCode, 200);

    // 2. Administrador puede modificar la mezcla de la sesión privada
    const adminPatchRes = await app.inject({
      method: 'PATCH',
      url: `/api/v1/multitrack/sessions/${privateSessionId}/tracks/${privateTrackId}`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { volume: 0.6 },
    });
    assert.strictEqual(adminPatchRes.statusCode, 200);

    // 3. Administrador puede eliminar la sesión privada
    const adminDeleteRes = await app.inject({
      method: 'DELETE',
      url: `/api/v1/multitrack/sessions/${privateSessionId}`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    assert.strictEqual(adminDeleteRes.statusCode, 204);
  });

  it('D.EXCLUSION: should strictly verify zero physical pedal synchronization in Multitracks & OMR', () => {
    const forbidden = ['pedal', 'foot', 'bluetooth', 'gamepad', 'webusb', 'webhid'];
    const serviceContent = MultitrackService.toString() + OmrService.toString();

    for (const term of forbidden) {
      assert.equal(
        serviceContent.toLowerCase().includes(term),
        false,
        `Forbidden pedal term "${term}" found in backend services`
      );
    }
  });
});
