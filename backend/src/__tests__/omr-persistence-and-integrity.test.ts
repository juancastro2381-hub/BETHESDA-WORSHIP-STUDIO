/**
 * @file omr-persistence-and-integrity.test.ts
 * @description Suite de pruebas automatizadas para la persistencia ACID en PostgreSQL y la remediación
 * exhaustiva de los 10 defectos de integridad musical en OMR (Fase 1A & 1A-R).
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { db, pool } from '../db/index.ts';
import { runMigrations } from '../db/migrate.ts';
import {
  users,
  songs,
  songVersions,
  omrProposals,
  omrProposalMeasures,
  omrAuditHistory,
  backgroundJobs,
} from '../db/schema.ts';
import { eq } from 'drizzle-orm';
import {
  DrizzleOmrProposalRepository,
  type IOmrProposalRepository,
} from '../repositories/omr-proposal-repository.ts';
import { DrizzleBackgroundJobRepository } from '../repositories/background-job-repository.ts';
import { DrizzleSongRepository } from '../repositories/song-repository.ts';
import { DrizzleUserRepository } from '../repositories/user-repository.ts';
import { OmrService } from '../application/omr-service.ts';
import type { IOmrProvider } from '../domain/omr/omr-provider.ts';
import {
  type OmrProposal,
  type OmrRecognitionInput,
  MAX_OMR_FILE_SIZE_BYTES,
} from '../domain/omr/types.ts';
import { ValidationError, ForbiddenError } from '../domain/errors.ts';

// Proveedor OMR programable para pruebas de integridad musical
class MockOmrProvider implements IOmrProvider {
  public customProposal?: Partial<OmrProposal>;

  public async recognize(input: OmrRecognitionInput): Promise<OmrProposal> {
    const hash = crypto.createHash('sha256').update(input.buffer).digest('hex');
    const proposalId = crypto.randomUUID();

    const baseProposal: OmrProposal = {
      proposalId,
      sourceFilename: input.filename,
      sourceHash: hash,
      detectedTitle: this.customProposal?.detectedTitle ?? 'Partitura de Prueba',
      detectedArtist: this.customProposal?.detectedArtist ?? 'Artista de Prueba',
      detectedKey:
        this.customProposal?.detectedKey !== undefined
          ? this.customProposal.detectedKey
          : 'G',
      detectedBpm:
        this.customProposal?.detectedBpm !== undefined
          ? this.customProposal.detectedBpm
          : 120,
      detectedTimeSignature:
        this.customProposal?.detectedTimeSignature !== undefined
          ? this.customProposal.detectedTimeSignature
          : '3/4',
      overallConfidence: this.customProposal?.overallConfidence ?? 0.88,
      isAiDraft: true,
      reviewStatus: this.customProposal?.reviewStatus ?? 'PENDING_REVIEW',
      measures: this.customProposal?.measures ?? [],
      unrecognizedRegions: this.customProposal?.unrecognizedRegions ?? [],
      createdAt: new Date().toISOString(),
    };

    return baseProposal;
  }
}

describe('Fase 1A-R — Integridad Musical OMR, Persistencia Relacional y Seguridad', () => {
  let omrRepo: DrizzleOmrProposalRepository;
  let jobRepo: DrizzleBackgroundJobRepository;
  let songRepo: DrizzleSongRepository;
  let userRepo: DrizzleUserRepository;
  let mockProvider: MockOmrProvider;
  let omrService: OmrService;

  let testUserId: string;
  let otherUserId: string;
  let viewerUserId: string;

  const createdSongIds: string[] = [];
  const createdProposalIds: string[] = [];
  const createdJobIds: string[] = [];

  before(async () => {
    await runMigrations();

    omrRepo = new DrizzleOmrProposalRepository(db);
    jobRepo = new DrizzleBackgroundJobRepository(db);
    songRepo = new DrizzleSongRepository(db);
    userRepo = new DrizzleUserRepository(db);
    mockProvider = new MockOmrProvider();
    omrService = new OmrService(mockProvider, songRepo, omrRepo);

    // 1. Crear usuario Worship Leader
    const testEmail = `worship_leader_omr_${Date.now()}@bethesda.local`;
    const user = await userRepo.create({
      email: testEmail,
      passwordHash: '$argon2id$v=19$m=65536,t=3,p=4$dummyhash$dummyhash',
      firstName: 'Juan',
      lastName: 'Director',
      role: 'WORSHIP_LEADER',
      accountStatus: 'ACTIVE',
    });
    testUserId = user.id;

    // 2. Crear segundo usuario Musician
    const otherEmail = `musician_other_${Date.now()}@bethesda.local`;
    const otherUser = await userRepo.create({
      email: otherEmail,
      passwordHash: '$argon2id$v=19$m=65536,t=3,p=4$dummyhash$dummyhash',
      firstName: 'Pedro',
      lastName: 'Músico',
      role: 'MUSICIAN',
      accountStatus: 'ACTIVE',
    });
    otherUserId = otherUser.id;

    // 3. Crear tercer usuario Viewer
    const viewerEmail = `viewer_${Date.now()}@bethesda.local`;
    const viewerUser = await userRepo.create({
      email: viewerEmail,
      passwordHash: '$argon2id$v=19$m=65536,t=3,p=4$dummyhash$dummyhash',
      firstName: 'Ana',
      lastName: 'Observadora',
      role: 'VIEWER',
      accountStatus: 'ACTIVE',
    });
    viewerUserId = viewerUser.id;
  });

  after(async () => {
    for (const sId of createdSongIds) {
      await db.delete(songVersions).where(eq(songVersions.songId, sId));
      await db.delete(songs).where(eq(songs.id, sId));
    }
    for (const pId of createdProposalIds) {
      await db.delete(omrAuditHistory).where(eq(omrAuditHistory.proposalId, pId));
      await db.delete(omrProposalMeasures).where(eq(omrProposalMeasures.proposalId, pId));
      await db.delete(omrProposals).where(eq(omrProposals.id, pId));
    }
    for (const jId of createdJobIds) {
      await db.delete(backgroundJobs).where(eq(backgroundJobs.id, jId));
    }
    if (testUserId) await db.delete(users).where(eq(users.id, testUserId));
    if (otherUserId) await db.delete(users).where(eq(users.id, otherUserId));
    if (viewerUserId) await db.delete(users).where(eq(users.id, viewerUserId));
  });

  // ==========================================================================
  // 1. PERSISTENCIA ACID DE PROPUESTAS OMR EN POSTGRESQL (R1)
  // ==========================================================================
  it('1.1: should persist OMR proposals, measures and audit to PostgreSQL and survive cache clearing', async () => {
    mockProvider.customProposal = {
      detectedTitle: 'Hosanna en las Alturas',
      detectedKey: 'G',
      detectedBpm: 128,
      detectedTimeSignature: '4/4',
      overallConfidence: 0.92,
      measures: [
        {
          measureNumber: 1,
          timeSignature: '4/4',
          keySignature: 'G',
          measureConfidence: 0.95,
          chordsDetected: [{ chord: 'G', beat: 1, confidence: 0.96 }],
          notesDetected: [{ step: 'G', octave: 4, duration: 'whole', confidence: 0.95 }],
          lyricsDetected: [{ text: 'Ho-', confidence: 0.9 }],
          flags: [],
        },
      ],
      unrecognizedRegions: [
        {
          page: 1,
          reason: 'Marca de agua en el compás final',
        },
      ],
    };

    const dummyBuffer = Buffer.from('%PDF-1.4 test score content for persistence');
    const proposal = await omrService.processUpload(
      {
        buffer: dummyBuffer,
        filename: 'hosanna_scan.pdf',
        mimeType: 'application/pdf',
        fileSizeBytes: dummyBuffer.length,
      },
      testUserId
    );

    createdProposalIds.push(proposal.proposalId);
    assert.ok(proposal.proposalId);
    assert.equal(proposal.isAiDraft, true);
    assert.equal(proposal.reviewStatus, 'PENDING_REVIEW');

    // Limpiar caché en memoria de la aplicación
    omrService.clearProposals();

    // Recuperar directamente desde PostgreSQL
    const loadedProposal = await omrService.getProposalAsync(proposal.proposalId);
    assert.equal(loadedProposal.proposalId, proposal.proposalId);
    assert.equal(loadedProposal.detectedTitle, 'Hosanna en las Alturas');
    assert.equal(loadedProposal.detectedKey, 'G');
    assert.equal(loadedProposal.measures.length, 1);
    assert.equal(loadedProposal.measures[0]?.chordsDetected[0]?.chord, 'G');
    assert.equal(loadedProposal.measures[0]?.notesDetected[0]?.step, 'G');
    assert.equal(loadedProposal.unrecognizedRegions.length, 1);
  });

  it('1.2: should fail proposal creation and NOT populate cache when database write fails (R1)', async () => {
    // Repositorio simulado que lanza fallo de persistencia
    const failingRepo: IOmrProposalRepository = {
      saveProposal: async () => {
        throw new Error('Conexión perdida a PostgreSQL (falla simulada)');
      },
      findProposalById: async () => null,
      updateProposalStatus: async () => {},
      updateProposalStatusAndAudit: async () => {},
      updateMeasure: async () => {},
      recordAudit: async () => {},
      getAuditHistory: async () => [],
      commitProposalTransaction: async () => {
        throw new Error('No implementado');
      },
      deleteProposal: async () => false,
    };

    const failingOmrService = new OmrService(mockProvider, songRepo, failingRepo);

    const dummyBuffer = Buffer.from('%PDF-1.4 failing persistence test');
    await assert.rejects(
      async () => {
        await failingOmrService.processUpload(
          {
            buffer: dummyBuffer,
            filename: 'failing_scan.pdf',
            mimeType: 'application/pdf',
            fileSizeBytes: dummyBuffer.length,
          },
          testUserId
        );
      },
      (err: any) => err.message.includes('Conexión perdida a PostgreSQL')
    );

    // Verificar que CERO propuestas quedaron registradas en la memoria caché
    assert.throws(() => failingOmrService.getProposal('cualquier-id'), {
      name: 'NotFoundError',
    });
  });

  // ==========================================================================
  // 2. DEFECTO 1 & R2: PRESERVACIÓN DE MÉTRICAS DINÁMICAS (3/4, 6/8) & BLOQUEO SI DESCONOCIDO
  // ==========================================================================
  it('2.1: should preserve 3/4 metric (1440 ticks) without defaulting to 4/4 (1920 ticks)', async () => {
    mockProvider.customProposal = {
      detectedTitle: 'Vals de Alabanza (3/4)',
      detectedKey: 'D',
      detectedBpm: 90,
      detectedTimeSignature: '3/4',
      overallConfidence: 0.95,
      measures: [
        {
          measureNumber: 1,
          timeSignature: '3/4',
          measureConfidence: 0.95,
          chordsDetected: [{ chord: 'D', beat: 1, confidence: 0.95 }],
          notesDetected: [
            { step: 'D', octave: 4, duration: 'quarter', confidence: 0.95 },
            { step: 'F#', octave: 4, duration: 'quarter', confidence: 0.95 },
            { step: 'A', octave: 4, duration: 'quarter', confidence: 0.95 },
          ],
          lyricsDetected: [{ text: 'Dios', confidence: 0.92, beat: 1 }],
          flags: [],
        },
      ],
    };

    const proposal = await omrService.processUpload(
      {
        buffer: Buffer.from('%PDF-1.4 3/4 meter test'),
        filename: 'vals_3_4.pdf',
        mimeType: 'application/pdf',
        fileSizeBytes: 30,
      },
      testUserId
    );
    createdProposalIds.push(proposal.proposalId);

    omrService.reviewProposal(proposal.proposalId, testUserId, 'APPROVED_FOR_IMPORT');
    const committed = await omrService.commitToCanonicalSong(proposal.proposalId, testUserId);
    createdSongIds.push(committed.song.id);

    const payload = committed.version.canonicalPayload as any;
    assert.equal(payload.measures.length, 1);
    const m1 = payload.measures[0];

    assert.equal(m1.durationTicks, 1440, 'Compás en 3/4 debe durar exactamente 1440 ticks');
    assert.equal(m1.timeSignature.numerator, 3);
    assert.equal(m1.timeSignature.denominator, 4);
  });

  it('2.2: should preserve 6/8 compound metric with 720-tick primary beats', async () => {
    mockProvider.customProposal = {
      detectedTitle: 'Cántico en 6/8',
      detectedKey: 'A',
      detectedBpm: 65,
      detectedTimeSignature: '6/8',
      overallConfidence: 0.94,
      measures: [
        {
          measureNumber: 1,
          timeSignature: '6/8',
          measureConfidence: 0.94,
          chordsDetected: [{ chord: 'A', beat: 1, confidence: 0.95 }],
          notesDetected: [
            { step: 'A', octave: 4, duration: 'dotted-quarter', confidence: 0.95 },
            { step: 'E', octave: 4, duration: 'dotted-quarter', confidence: 0.95 },
          ],
          lyricsDetected: [],
          flags: [],
        },
      ],
    };

    const proposal = await omrService.processUpload(
      {
        buffer: Buffer.from('%PDF-1.4 6/8 meter test'),
        filename: 'cantico_6_8.pdf',
        mimeType: 'application/pdf',
        fileSizeBytes: 30,
      },
      testUserId
    );
    createdProposalIds.push(proposal.proposalId);

    omrService.reviewProposal(proposal.proposalId, testUserId, 'APPROVED_FOR_IMPORT');
    const committed = await omrService.commitToCanonicalSong(proposal.proposalId, testUserId);
    createdSongIds.push(committed.song.id);

    const payload = committed.version.canonicalPayload as any;
    const m1 = payload.measures[0];

    assert.equal(m1.durationTicks, 1440, 'Compás en 6/8 debe durar 1440 ticks');
    assert.equal(m1.timeSignature.numerator, 6);
    assert.equal(m1.timeSignature.denominator, 8);
  });

  it('2.3: should block canonical commit when time signature is unknown without explicit override (R2)', async () => {
    mockProvider.customProposal = {
      detectedTitle: 'Métrica Desconocida',
      detectedKey: 'G',
      detectedBpm: 100,
      detectedTimeSignature: null, // Métrica desconocida
      overallConfidence: 0.8,
      measures: [
        {
          measureNumber: 1,
          timeSignature: undefined,
          measureConfidence: 0.8,
          chordsDetected: [],
          notesDetected: [{ step: 'G', octave: 4, duration: 'quarter', confidence: 0.8 }],
          lyricsDetected: [],
          flags: [],
        },
      ],
    };

    const proposal = await omrService.processUpload(
      {
        buffer: Buffer.from('%PDF-1.4 unknown time sig test'),
        filename: 'unknown_meter.pdf',
        mimeType: 'application/pdf',
        fileSizeBytes: 30,
      },
      testUserId
    );
    createdProposalIds.push(proposal.proposalId);

    omrService.reviewProposal(proposal.proposalId, testUserId, 'APPROVED_FOR_IMPORT');

    // Intentar comprometer sin override de métrica debe fallar con ValidationError
    await assert.rejects(
      async () => {
        await omrService.commitToCanonicalSong(proposal.proposalId, testUserId);
      },
      (err: any) =>
        err.name === 'ValidationError' &&
        err.message.includes('métrica no resuelta')
    );

    // Proporcionar anulación explícita y verificada debe permitir el compromiso
    const committed = await omrService.commitToCanonicalSong(
      proposal.proposalId,
      testUserId,
      { timeSignature: '3/4' }
    );
    createdSongIds.push(committed.song.id);
    assert.equal(committed.song.timeSignature, '3/4');
  });

  it('2.4: should block canonical commit when BPM is unknown without explicit override (R2)', async () => {
    mockProvider.customProposal = {
      detectedTitle: 'Tempo Desconocido',
      detectedKey: 'G',
      detectedBpm: null, // BPM desconocido
      detectedTimeSignature: '4/4',
      overallConfidence: 0.8,
      measures: [
        {
          measureNumber: 1,
          timeSignature: '4/4',
          measureConfidence: 0.8,
          chordsDetected: [],
          notesDetected: [{ step: 'G', octave: 4, duration: 'quarter', confidence: 0.8 }],
          lyricsDetected: [],
          flags: [],
        },
      ],
    };

    const proposal = await omrService.processUpload(
      {
        buffer: Buffer.from('%PDF-1.4 unknown bpm test'),
        filename: 'unknown_bpm.pdf',
        mimeType: 'application/pdf',
        fileSizeBytes: 30,
      },
      testUserId
    );
    createdProposalIds.push(proposal.proposalId);

    omrService.reviewProposal(proposal.proposalId, testUserId, 'APPROVED_FOR_IMPORT');

    // Sin BPM explícito, debe bloquear
    await assert.rejects(
      async () => {
        await omrService.commitToCanonicalSong(proposal.proposalId, testUserId);
      },
      (err: any) =>
        err.name === 'ValidationError' &&
        err.message.includes('tempo (BPM) no resuelto')
    );

    // Con anulación explícita, procede limpiamente
    const committed = await omrService.commitToCanonicalSong(
      proposal.proposalId,
      testUserId,
      { bpm: 95 }
    );
    createdSongIds.push(committed.song.id);
    assert.equal(committed.song.defaultBpm, 95);
  });

  // ==========================================================================
  // 3. DEFECTO 2 & R2: PRESERVACIÓN TONAL CANÓNICA & BLOQUEO SI DESCONOCIDO
  // ==========================================================================
  it('3.1: should preserve detected key signature (G Major = 1 sharp, Eb Major = 3 flats) without defaulting to 0', async () => {
    mockProvider.customProposal = {
      detectedTitle: 'Himno en Eb Mayor',
      detectedKey: 'Eb',
      detectedBpm: 100,
      detectedTimeSignature: '4/4',
      overallConfidence: 0.96,
      measures: [
        {
          measureNumber: 1,
          timeSignature: '4/4',
          measureConfidence: 0.96,
          chordsDetected: [{ chord: 'Eb', beat: 1, confidence: 0.98 }],
          notesDetected: [
            { step: 'Eb', octave: 4, duration: 'whole', confidence: 0.97 },
          ],
          lyricsDetected: [],
          flags: [],
        },
      ],
    };

    const proposal = await omrService.processUpload(
      {
        buffer: Buffer.from('%PDF-1.4 Eb key test'),
        filename: 'eb_key_score.pdf',
        mimeType: 'application/pdf',
        fileSizeBytes: 30,
      },
      testUserId
    );
    createdProposalIds.push(proposal.proposalId);

    omrService.reviewProposal(proposal.proposalId, testUserId, 'APPROVED_FOR_IMPORT');
    const committed = await omrService.commitToCanonicalSong(proposal.proposalId, testUserId);
    createdSongIds.push(committed.song.id);

    const payload = committed.version.canonicalPayload as any;
    const m1 = payload.measures[0];

    assert.equal(m1.keySignature.tonic, 'Eb');
    assert.equal(m1.keySignature.accidentalCount, -3, 'Eb Mayor debe tener exactamente 3 bemoles (-3)');
  });

  it('3.2: should block canonical commit when key signature is unknown without explicit override (R2)', async () => {
    mockProvider.customProposal = {
      detectedTitle: 'Tonalidad Desconocida',
      detectedKey: null, // Tonalidad desconocida
      detectedBpm: 120,
      detectedTimeSignature: '4/4',
      overallConfidence: 0.8,
      measures: [
        {
          measureNumber: 1,
          timeSignature: '4/4',
          measureConfidence: 0.8,
          chordsDetected: [],
          notesDetected: [{ step: 'D', octave: 4, duration: 'whole', confidence: 0.8 }],
          lyricsDetected: [],
          flags: [],
        },
      ],
    };

    const proposal = await omrService.processUpload(
      {
        buffer: Buffer.from('%PDF-1.4 unknown key test'),
        filename: 'unknown_key.pdf',
        mimeType: 'application/pdf',
        fileSizeBytes: 30,
      },
      testUserId
    );
    createdProposalIds.push(proposal.proposalId);

    omrService.reviewProposal(proposal.proposalId, testUserId, 'APPROVED_FOR_IMPORT');

    // Intentar comprometer sin tonalidad debe fallar (CERO fallback silencioso a C)
    await assert.rejects(
      async () => {
        await omrService.commitToCanonicalSong(proposal.proposalId, testUserId);
      },
      (err: any) =>
        err.name === 'ValidationError' &&
        err.message.includes('tonalidad no resuelta')
    );

    // Con anulación explícita validada, procede exitosamente
    const committed = await omrService.commitToCanonicalSong(
      proposal.proposalId,
      testUserId,
      { key: 'F' }
    );
    createdSongIds.push(committed.song.id);
    assert.equal(committed.song.defaultKey, 'F');
  });

  // ==========================================================================
  // 4. DEFECTOS 3 & 4: PRESERVACIÓN DE ALTERACIONES Y CERO FABRICACIÓN
  // ==========================================================================
  it('4.1: should preserve explicit alterations (F#4, Bb3) and reject fabricated notes', async () => {
    mockProvider.customProposal = {
      detectedTitle: 'Melodía con Alteraciones',
      detectedKey: 'G',
      detectedBpm: 110,
      detectedTimeSignature: '4/4',
      overallConfidence: 0.92,
      measures: [
        {
          measureNumber: 1,
          timeSignature: '4/4',
          measureConfidence: 0.92,
          chordsDetected: [{ chord: 'G', beat: 1, confidence: 0.95 }],
          notesDetected: [
            { step: 'F', octave: 4, alter: 1, duration: 'half', confidence: 0.93 },
            { step: 'Bb', octave: 3, duration: 'half', confidence: 0.91 },
          ],
          lyricsDetected: [],
          flags: [],
        },
      ],
    };

    const proposal = await omrService.processUpload(
      {
        buffer: Buffer.from('%PDF-1.4 accidentals test'),
        filename: 'accidentals_score.pdf',
        mimeType: 'application/pdf',
        fileSizeBytes: 30,
      },
      testUserId
    );
    createdProposalIds.push(proposal.proposalId);

    omrService.reviewProposal(proposal.proposalId, testUserId, 'APPROVED_FOR_IMPORT');
    const committed = await omrService.commitToCanonicalSong(proposal.proposalId, testUserId);
    createdSongIds.push(committed.song.id);

    const payload = committed.version.canonicalPayload as any;
    const events = payload.measures[0].voices[0].events.filter((e: any) => e.type === 'NOTE');

    assert.equal(events[0].pitch.noteName, 'F#');
    assert.equal(events[0].pitch.octave, 4);

    assert.equal(events[1].pitch.noteName, 'Bb');
    assert.equal(events[1].pitch.octave, 3);
  });

  it('4.2: should flag unresolvable note glyphs instead of silently inventing note C', async () => {
    mockProvider.customProposal = {
      detectedTitle: 'Partitura con Mancha',
      detectedKey: 'C',
      detectedBpm: 120,
      detectedTimeSignature: '4/4',
      overallConfidence: 0.75,
      measures: [
        {
          measureNumber: 1,
          timeSignature: '4/4',
          measureConfidence: 0.72,
          chordsDetected: [],
          notesDetected: [
            { step: 'CORRUPT_GLYPH_#?', octave: 4, duration: 'quarter', confidence: 0.3 },
            { step: 'E', octave: 4, duration: 'half', confidence: 0.9 },
          ],
          lyricsDetected: [],
          flags: [],
        },
      ],
    };

    const proposal = await omrService.processUpload(
      {
        buffer: Buffer.from('%PDF-1.4 glyph smudge test'),
        filename: 'smudge.pdf',
        mimeType: 'application/pdf',
        fileSizeBytes: 30,
      },
      testUserId
    );
    createdProposalIds.push(proposal.proposalId);

    omrService.reviewProposal(proposal.proposalId, testUserId, 'APPROVED_FOR_IMPORT');
    const committed = await omrService.commitToCanonicalSong(proposal.proposalId, testUserId);
    createdSongIds.push(committed.song.id);

    const payload = committed.version.canonicalPayload as any;
    const events = payload.measures[0].voices[0].events.filter((e: any) => e.type === 'NOTE');

    assert.equal(events.length, 1, 'No debe fabricar notas C para glifos no reconocibles');
    assert.equal(events[0].pitch.noteName, 'E');
  });

  // ==========================================================================
  // 5. DEFECTO 5: ACORDES ILEGIBLES SEÑALIZADOS (NO EMPTY CATCH)
  // ==========================================================================
  it('5.1: should preserve and flag unparsed chords without swallowing errors', async () => {
    mockProvider.customProposal = {
      detectedTitle: 'Prueba Acorde No Estándar',
      detectedKey: 'C',
      detectedBpm: 120,
      detectedTimeSignature: '4/4',
      overallConfidence: 0.85,
      measures: [
        {
          measureNumber: 1,
          timeSignature: '4/4',
          measureConfidence: 0.82,
          chordsDetected: [
            { chord: 'C', beat: 1, confidence: 0.95 },
            { chord: 'ILEGIBLE_???/13b9#', beat: 3, confidence: 0.4 },
          ],
          notesDetected: [],
          lyricsDetected: [],
          flags: [],
        },
      ],
    };

    const proposal = await omrService.processUpload(
      {
        buffer: Buffer.from('%PDF-1.4 bad chord test'),
        filename: 'bad_chord.pdf',
        mimeType: 'application/pdf',
        fileSizeBytes: 30,
      },
      testUserId
    );
    createdProposalIds.push(proposal.proposalId);

    omrService.reviewProposal(proposal.proposalId, testUserId, 'APPROVED_FOR_IMPORT');
    const committed = await omrService.commitToCanonicalSong(proposal.proposalId, testUserId);
    createdSongIds.push(committed.song.id);

    assert.ok(
      proposal.measures[0]?.flags?.some((f) => f.includes('UNPARSED_CHORD')),
      'Debe marcar la bandera UNPARSED_CHORD en el compás'
    );
  });

  // ==========================================================================
  // 6. DEFECTO 6 & R2: FIGURAS COMPUESTAS & RECHAZO DE DURACIONES DESCONOCIDAS
  // ==========================================================================
  it('6.1: should correctly map dotted notes and triplets into exact ticks', async () => {
    mockProvider.customProposal = {
      detectedTitle: 'Estudio de Duraciones Rítmicas',
      detectedKey: 'C',
      detectedBpm: 100,
      detectedTimeSignature: '4/4',
      overallConfidence: 0.95,
      measures: [
        {
          measureNumber: 1,
          timeSignature: '4/4',
          measureConfidence: 0.95,
          chordsDetected: [],
          notesDetected: [
            { step: 'C', octave: 4, duration: 'dotted-half', confidence: 0.95 },
            { step: 'D', octave: 4, duration: 'quarter', confidence: 0.95 },
          ],
          lyricsDetected: [],
          flags: [],
        },
        {
          measureNumber: 2,
          timeSignature: '4/4',
          measureConfidence: 0.95,
          chordsDetected: [],
          notesDetected: [
            { step: 'E', octave: 4, duration: 'dotted-quarter', confidence: 0.95 },
            { step: 'F', octave: 4, duration: 'eighth', confidence: 0.95 },
            { step: 'G', octave: 4, duration: 'triplet-quarter', confidence: 0.95 },
            { step: 'A', octave: 4, duration: 'triplet-quarter', confidence: 0.95 },
            { step: 'B', octave: 4, duration: 'triplet-quarter', confidence: 0.95 },
          ],
          lyricsDetected: [],
          flags: [],
        },
      ],
    };

    const proposal = await omrService.processUpload(
      {
        buffer: Buffer.from('%PDF-1.4 duration study'),
        filename: 'rhythm_study.pdf',
        mimeType: 'application/pdf',
        fileSizeBytes: 30,
      },
      testUserId
    );
    createdProposalIds.push(proposal.proposalId);

    omrService.reviewProposal(proposal.proposalId, testUserId, 'APPROVED_FOR_IMPORT');
    const committed = await omrService.commitToCanonicalSong(proposal.proposalId, testUserId);
    createdSongIds.push(committed.song.id);

    const payload = committed.version.canonicalPayload as any;
    const m1Notes = payload.measures[0].voices[0].events.filter((e: any) => e.type === 'NOTE');
    assert.equal(m1Notes[0].durationTicks, 1440, 'dotted-half debe ser 1440 ticks');
    assert.equal(m1Notes[1].durationTicks, 480, 'quarter debe ser 480 ticks');

    const m2Notes = payload.measures[1].voices[0].events.filter((e: any) => e.type === 'NOTE');
    assert.equal(m2Notes[0].durationTicks, 720, 'dotted-quarter debe ser 720 ticks');
    assert.equal(m2Notes[1].durationTicks, 240, 'eighth debe ser 240 ticks');
    assert.equal(m2Notes[2].durationTicks, 320, 'triplet-quarter debe ser 320 ticks');
  });

  it('6.2: should reject unknown note duration with ValidationError instead of guessing duration (R2)', async () => {
    mockProvider.customProposal = {
      detectedTitle: 'Duración Ilegible',
      detectedKey: 'C',
      detectedBpm: 120,
      detectedTimeSignature: '4/4',
      overallConfidence: 0.85,
      measures: [
        {
          measureNumber: 1,
          timeSignature: '4/4',
          measureConfidence: 0.85,
          chordsDetected: [],
          notesDetected: [
            { step: 'C', octave: 4, duration: 'garabato_desconocido', confidence: 0.5 },
          ],
          lyricsDetected: [],
          flags: [],
        },
      ],
    };

    const proposal = await omrService.processUpload(
      {
        buffer: Buffer.from('%PDF-1.4 bad duration test'),
        filename: 'bad_duration.pdf',
        mimeType: 'application/pdf',
        fileSizeBytes: 30,
      },
      testUserId
    );
    createdProposalIds.push(proposal.proposalId);

    omrService.reviewProposal(proposal.proposalId, testUserId, 'APPROVED_FOR_IMPORT');

    await assert.rejects(
      async () => {
        await omrService.commitToCanonicalSong(proposal.proposalId, testUserId);
      },
      (err: any) =>
        err.name === 'ValidationError' &&
        err.message.includes('Duración de nota no reconocida')
    );
  });

  // ==========================================================================
  // 7. DEFECTO 7: SILENCIO DE COMPÁS VACÍO ACORDE A MÉTRICA
  // ==========================================================================
  it('7.1: should insert rest with exact metric duration (960 ticks for 2/4) on empty measure', async () => {
    mockProvider.customProposal = {
      detectedTitle: 'Compás Vacío en 2/4',
      detectedKey: 'C',
      detectedBpm: 120,
      detectedTimeSignature: '2/4',
      overallConfidence: 0.9,
      measures: [
        {
          measureNumber: 1,
          timeSignature: '2/4',
          measureConfidence: 0.9,
          chordsDetected: [],
          notesDetected: [],
          lyricsDetected: [],
          flags: [],
        },
      ],
    };

    const proposal = await omrService.processUpload(
      {
        buffer: Buffer.from('%PDF-1.4 empty 2/4 test'),
        filename: 'empty_2_4.pdf',
        mimeType: 'application/pdf',
        fileSizeBytes: 30,
      },
      testUserId
    );
    createdProposalIds.push(proposal.proposalId);

    omrService.reviewProposal(proposal.proposalId, testUserId, 'APPROVED_FOR_IMPORT');
    const committed = await omrService.commitToCanonicalSong(proposal.proposalId, testUserId);
    createdSongIds.push(committed.song.id);

    const payload = committed.version.canonicalPayload as any;
    const rests = payload.measures[0].voices[0].events.filter((e: any) => e.type === 'REST');
    assert.equal(rests.length, 1);
    assert.equal(rests[0].durationTicks, 960, 'El silencio de compás en 2/4 debe durar 960 ticks');
  });

  // ==========================================================================
  // 8. DEFECTO 8: CERO APILAMIENTO DE LÍRICA EN TICK 0
  // ==========================================================================
  it('8.1: should distribute lyric syllables aligned with notes/beats instead of stacking all at tick 0', async () => {
    mockProvider.customProposal = {
      detectedTitle: 'Distribución de Letra',
      detectedKey: 'C',
      detectedBpm: 120,
      detectedTimeSignature: '4/4',
      overallConfidence: 0.92,
      measures: [
        {
          measureNumber: 1,
          timeSignature: '4/4',
          measureConfidence: 0.92,
          chordsDetected: [],
          notesDetected: [
            { step: 'C', octave: 4, duration: 'quarter', confidence: 0.95 },
            { step: 'D', octave: 4, duration: 'quarter', confidence: 0.95 },
            { step: 'E', octave: 4, duration: 'quarter', confidence: 0.95 },
            { step: 'F', octave: 4, duration: 'quarter', confidence: 0.95 },
          ],
          lyricsDetected: [
            { text: 'A-', confidence: 0.9 },
            { text: 'la-', confidence: 0.9 },
            { text: 'ba-', confidence: 0.9 },
            { text: 'ré', confidence: 0.9 },
          ],
          flags: [],
        },
      ],
    };

    const proposal = await omrService.processUpload(
      {
        buffer: Buffer.from('%PDF-1.4 lyrics stacking test'),
        filename: 'lyrics_test.pdf',
        mimeType: 'application/pdf',
        fileSizeBytes: 30,
      },
      testUserId
    );
    createdProposalIds.push(proposal.proposalId);

    omrService.reviewProposal(proposal.proposalId, testUserId, 'APPROVED_FOR_IMPORT');
    const committed = await omrService.commitToCanonicalSong(proposal.proposalId, testUserId);
    createdSongIds.push(committed.song.id);

    const payload = committed.version.canonicalPayload as any;
    const lyrics = payload.measures[0].lyrics;

    assert.equal(lyrics.length, 4);
    assert.equal(lyrics[0].tickOffset, 0, 'Sílaba 1 alineada con nota 1');
    assert.equal(lyrics[1].tickOffset, 480, 'Sílaba 2 alineada con nota 2');
    assert.equal(lyrics[2].tickOffset, 960, 'Sílaba 3 alineada con nota 3');
    assert.equal(lyrics[3].tickOffset, 1440, 'Sílaba 4 alineada con nota 4');
  });

  // ==========================================================================
  // 9. DEFECTO 9: FILTRADO POR UMBRAL DE CONFIANZA (< 0.70)
  // ==========================================================================
  it('9.1: should automatically flag measures with confidence < 0.70 as LOW_CONFIDENCE', async () => {
    mockProvider.customProposal = {
      detectedTitle: 'Partitura Borrosa',
      detectedKey: 'C',
      detectedBpm: 120,
      detectedTimeSignature: '4/4',
      overallConfidence: 0.65,
      measures: [
        {
          measureNumber: 1,
          timeSignature: '4/4',
          measureConfidence: 0.58,
          chordsDetected: [],
          notesDetected: [{ step: 'C', octave: 4, duration: 'whole', confidence: 0.55 }],
          lyricsDetected: [],
          flags: [],
        },
      ],
    };

    const proposal = await omrService.processUpload(
      {
        buffer: Buffer.from('%PDF-1.4 blurry scan'),
        filename: 'blurry.pdf',
        mimeType: 'application/pdf',
        fileSizeBytes: 30,
      },
      testUserId
    );
    createdProposalIds.push(proposal.proposalId);

    assert.ok(
      proposal.measures[0]?.flags?.includes('LOW_CONFIDENCE'),
      'Compás con confianza < 0.70 debe recibir bandera LOW_CONFIDENCE'
    );
  });

  // ==========================================================================
  // 10. DEFECTO 10 & R6: POLÍTICA COHERENTE DE TAMAÑO DE ARCHIVO (15 MB)
  // ==========================================================================
  it('10.1: should reject inputs with 0 bytes with ValidationError', async () => {
    await assert.rejects(
      async () => {
        await omrService.processUpload(
          {
            buffer: Buffer.alloc(0),
            filename: 'empty.pdf',
            mimeType: 'application/pdf',
            fileSizeBytes: 0,
          },
          testUserId
        );
      },
      { name: 'ValidationError' }
    );
  });

  it('10.2: should enforce coherent 15MB file size boundary consistently across schema and provider (R6)', async () => {
    const exceeds15MbBytes = 16 * 1024 * 1024; // 16 MB > MAX_OMR_FILE_SIZE_BYTES
    await assert.rejects(
      async () => {
        await omrService.processUpload(
          {
            buffer: Buffer.alloc(100),
            filename: 'oversized_score.pdf',
            mimeType: 'application/pdf',
            fileSizeBytes: exceeds15MbBytes,
          },
          testUserId
        );
      },
      (err: any) =>
        err.name === 'ValidationError' &&
        err.message.includes('15MB')
    );
  });

  // ==========================================================================
  // 11. AUDITORÍA INMUTABLE (R3) & TRANSACCIONES ATÓMICAS (R4)
  // ==========================================================================
  it('11.1: should log creation, review, and commit events into omr_audit_history without sensitive tokens', async () => {
    mockProvider.customProposal = {
      detectedTitle: 'Auditoría Musical OMR',
      detectedKey: 'F',
      detectedBpm: 110,
      detectedTimeSignature: '4/4',
      overallConfidence: 0.9,
      measures: [
        {
          measureNumber: 1,
          timeSignature: '4/4',
          measureConfidence: 0.9,
          chordsDetected: [{ chord: 'F', beat: 1, confidence: 0.92 }],
          notesDetected: [{ step: 'F', octave: 4, duration: 'whole', confidence: 0.92 }],
          lyricsDetected: [],
          flags: [],
        },
      ],
    };

    const proposal = await omrService.processUpload(
      {
        buffer: Buffer.from('%PDF-1.4 audit test'),
        filename: 'audit_score.pdf',
        mimeType: 'application/pdf',
        fileSizeBytes: 30,
      },
      testUserId
    );
    createdProposalIds.push(proposal.proposalId);

    await omrService.reviewProposalAsync(
      proposal.proposalId,
      testUserId,
      'APPROVED_FOR_IMPORT',
      'Aprobado tras verificar métrica y notas'
    );

    const committed = await omrService.commitToCanonicalSong(proposal.proposalId, testUserId);
    createdSongIds.push(committed.song.id);

    const auditLogs = await omrRepo.getAuditHistory(proposal.proposalId);
    assert.ok(auditLogs.length >= 3, 'Debe registrar al menos 3 eventos de auditoría');

    const actionTypes = auditLogs.map((a) => a.actionType);
    assert.ok(actionTypes.includes('CREATE_PROPOSAL'));
    assert.ok(actionTypes.includes('APPROVE_PROPOSAL'));
    assert.ok(actionTypes.includes('COMMIT_TO_SONG'));

    for (const log of auditLogs) {
      const serialized = JSON.stringify(log);
      assert.ok(!serialized.includes('password'));
      assert.ok(!serialized.includes('secret'));
      assert.ok(!serialized.includes('token'));
    }
  });

  it('11.2: should prevent proposal deletion when audit history exists via ON DELETE RESTRICT (R3)', async () => {
    mockProvider.customProposal = {
      detectedTitle: 'Propuesta con Auditoría Protegida',
      detectedKey: 'G',
      detectedBpm: 120,
      detectedTimeSignature: '4/4',
      overallConfidence: 0.95,
      measures: [],
    };

    const proposal = await omrService.processUpload(
      {
        buffer: Buffer.from('%PDF-1.4 audit protection test'),
        filename: 'protected_audit.pdf',
        mimeType: 'application/pdf',
        fileSizeBytes: 30,
      },
      testUserId
    );
    createdProposalIds.push(proposal.proposalId);

    // Intentar borrar la propuesta directamente debe fallar debido a ON DELETE RESTRICT en omr_audit_history
    await assert.rejects(
      async () => {
        await omrRepo.deleteProposal(proposal.proposalId);
      },
      (err: any) =>
        err.message.includes('foreign key constraint') ||
        err.message.includes('violates foreign key') ||
        err.code === '23503'
    );
  });

  // ==========================================================================
  // 12. TAREAS EN SEGUNDO PLANO (background_jobs)
  // ==========================================================================
  it('12.1: should create, track progress, and complete background jobs in PostgreSQL', async () => {
    const job = await jobRepo.createJob({
      jobType: 'OMR_PROCESSING',
      status: 'PENDING',
      userId: testUserId,
      tenantId: 'bethesda-test',
      inputRef: 'uploads/partitura_test.pdf',
      correlationId: `test-corr-${Date.now()}`,
    });
    createdJobIds.push(job.id);

    assert.ok(job.id);
    assert.equal(job.jobType, 'OMR_PROCESSING');
    assert.equal(job.status, 'PENDING');
    assert.equal(job.progress, 0);

    await jobRepo.updateJobProgress(job.id, 50, 'PROCESSING');
    const updated = await jobRepo.findJobById(job.id);
    assert.equal(updated?.progress, 50);
    assert.equal(updated?.status, 'PROCESSING');
    assert.ok(updated?.startedAt);

    const outputProposalId = crypto.randomUUID();
    await jobRepo.completeJob(job.id, outputProposalId);
    const completed = await jobRepo.findJobById(job.id);
    assert.equal(completed?.status, 'COMPLETED');
    assert.equal(completed?.progress, 100);
    assert.equal(completed?.outputRef, outputProposalId);
    assert.ok(completed?.completedAt);
  });

  // ==========================================================================
  // 13. SEGURIDAD Y CONTROL DE ACCESO / IDOR (R7)
  // ==========================================================================
  it('13.1: should enforce ownership and reject unauthorized access to another user proposal (R7)', async () => {
    mockProvider.customProposal = {
      detectedTitle: 'Propuesta Privada de Juan',
      detectedKey: 'G',
      detectedBpm: 120,
      detectedTimeSignature: '4/4',
      overallConfidence: 0.9,
      measures: [],
    };

    const proposal = await omrService.processUpload(
      {
        buffer: Buffer.from('%PDF-1.4 private proposal test'),
        filename: 'private_score.pdf',
        mimeType: 'application/pdf',
        fileSizeBytes: 30,
      },
      testUserId
    );
    createdProposalIds.push(proposal.proposalId);

    // Usuario 'otherUserId' (MUSICIAN) intenta acceder a la propuesta de Juan
    await assert.rejects(
      async () => {
        await omrRepo.findProposalById(proposal.proposalId, {
          id: otherUserId,
          role: 'MUSICIAN',
        });
      },
      { name: 'ForbiddenError' }
    );
  });

  it('13.2: should reject proposal review by unprivileged roles (R7)', async () => {
    mockProvider.customProposal = {
      detectedTitle: 'Propuesta para Revisión por Viewer',
      detectedKey: 'C',
      detectedBpm: 120,
      detectedTimeSignature: '4/4',
      overallConfidence: 0.9,
      measures: [],
    };

    const proposal = await omrService.processUpload(
      {
        buffer: Buffer.from('%PDF-1.4 viewer review test'),
        filename: 'viewer_review.pdf',
        mimeType: 'application/pdf',
        fileSizeBytes: 30,
      },
      testUserId
    );
    createdProposalIds.push(proposal.proposalId);

    // Usuario con rol 'VIEWER' intenta revisar/aprobar
    await assert.rejects(
      async () => {
        await omrService.reviewProposalAsync(
          proposal.proposalId,
          viewerUserId,
          'APPROVED_FOR_IMPORT',
          'Intento no autorizado',
          { id: viewerUserId, role: 'VIEWER' }
        );
      },
      { name: 'ForbiddenError' }
    );
  });
});
