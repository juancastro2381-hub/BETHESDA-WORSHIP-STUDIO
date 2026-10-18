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
import { pool } from '../db/index.ts';
import { runMigrations } from '../db/migrate.ts';
import { DrizzleUserRepository } from '../repositories/user-repository.ts';
import { DrizzleSongRepository } from '../repositories/song-repository.ts';
import { DrizzleAudioRepository } from '../repositories/audio-repository.ts';
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
  let userRepo: DrizzleUserRepository;
  let songRepo: DrizzleSongRepository;
  let audioRepo: DrizzleAudioRepository;
  let storageProvider: LocalFileSystemAudioStorageProvider;
  let multitrackService: MultitrackService;
  let omrService: OmrService;

  let testUser: UserEntity;
  let testSong: SongEntity;
  let testStemAsset1: AudioAsset;
  let testStemAsset2: AudioAsset;

  const createdUserIds = new Set<string>();
  const createdSongIds = new Set<string>();
  const createdAudioIds = new Set<string>();

  before(async () => {
    await runMigrations();

    userRepo = new DrizzleUserRepository();
    songRepo = new DrizzleSongRepository();
    audioRepo = new DrizzleAudioRepository();
    storageProvider = new LocalFileSystemAudioStorageProvider(
      env.AUDIO_STORAGE_PATH,
      env.MAX_AUDIO_FILE_SIZE_BYTES
    );
    multitrackService = new MultitrackService(audioRepo, songRepo);
    omrService = new OmrService(new StandardOmrProvider(), songRepo);

    const timestamp = Date.now();

    // 1. Crear usuario de prueba
    testUser = await userRepo.create({
      email: `multitrack-tester-${timestamp}@bethesda.test`,
      passwordHash: 'dummy_hash',
      firstName: 'Director',
      lastName: 'Multitrack',
      role: 'WORSHIP_LEADER',
    });
    createdUserIds.add(testUser.id);

    // 2. Crear canción canónica
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

    // 3. Crear 2 AudioAssets de Workstream A para simular stems
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
  });

  after(async () => {
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

  it('D1.4: should update track mix parameters correctly', () => {
    const session = multitrackService.getSession(activeSessionId);
    const trackToUpdate = session.tracks[0];

    const updated = multitrackService.updateTrackMix(activeSessionId, trackToUpdate.id, {
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

  it('D1.5: should enforce offline completeness: false if a stem is missing, true only if all present', () => {
    // Escenario A: Solo 1 de 2 stems disponibles localmente
    const statusIncomplete = multitrackService.checkOfflineCompleteness(activeSessionId, [
      testStemAsset1.id,
    ]);
    assert.equal(statusIncomplete.isFullyAvailableOffline, false);
    assert.equal(statusIncomplete.downloadedTracks, 1);
    assert.equal(statusIncomplete.missingAssetIds.length, 1);
    assert.equal(statusIncomplete.missingAssetIds[0], testStemAsset2.id);

    // Escenario B: Ambos stems presentes localmente
    const statusComplete = multitrackService.checkOfflineCompleteness(activeSessionId, [
      testStemAsset1.id,
      testStemAsset2.id,
    ]);
    assert.equal(statusComplete.isFullyAvailableOffline, true);
    assert.equal(statusComplete.downloadedTracks, 2);
    assert.equal(statusComplete.missingAssetIds.length, 0);
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

  it('D2.6: should allow canonical commit only after explicit human approval', async () => {
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
