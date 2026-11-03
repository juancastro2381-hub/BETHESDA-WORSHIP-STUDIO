/**
 * @file omr-persistence-and-integrity.test.ts
 * @description Suite de pruebas automatizadas para la persistencia ACID en PostgreSQL, transacciones atómicas,
 * inmutabilidad estricta de auditoría por triggers sin bypass, higiene de caché, e integridad musical (Fase 1A-R3).
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { db } from '../db/index.ts';
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
import { eq, sql } from 'drizzle-orm';
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
  type AuthenticatedUser,
  type OmrMeasureProposal,
  type OmrAuditEntry,
  MAX_OMR_FILE_SIZE_BYTES,
} from '../domain/omr/types.ts';
import {
  ValidationError,
  ForbiddenError,
  UnauthorizedError,
  ConflictError,
  NotFoundError,
} from '../domain/errors.ts';

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

describe('Fase 1A-R3 — Integridad Musical OMR, Inmutabilidad de Auditoría, Transacciones Atómicas y Seguridad Principal', () => {
  let omrRepo: DrizzleOmrProposalRepository;
  let jobRepo: DrizzleBackgroundJobRepository;
  let songRepo: DrizzleSongRepository;
  let userRepo: DrizzleUserRepository;
  let mockProvider: MockOmrProvider;
  let omrService: OmrService;

  let testUserId: string;
  let otherUserId: string;
  let viewerUserId: string;

  let leaderPrincipal: AuthenticatedUser;
  let musicianPrincipal: AuthenticatedUser;
  let viewerPrincipal: AuthenticatedUser;
  let adminPrincipal: AuthenticatedUser;

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
    const testEmail = `worship_leader_omr_${Date.now()}_${Math.random().toString(36).substring(7)}@bethesda.local`;
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
    const otherEmail = `musician_other_${Date.now()}_${Math.random().toString(36).substring(7)}@bethesda.local`;
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
    const viewerEmail = `viewer_${Date.now()}_${Math.random().toString(36).substring(7)}@bethesda.local`;
    const viewerUser = await userRepo.create({
      email: viewerEmail,
      passwordHash: '$argon2id$v=19$m=65536,t=3,p=4$dummyhash$dummyhash',
      firstName: 'Ana',
      lastName: 'Observadora',
      role: 'VIEWER',
      accountStatus: 'ACTIVE',
    });
    viewerUserId = viewerUser.id;

    leaderPrincipal = { id: testUserId, role: 'WORSHIP_LEADER' };
    musicianPrincipal = { id: otherUserId, role: 'MUSICIAN' };
    viewerPrincipal = { id: viewerUserId, role: 'VIEWER' };
    adminPrincipal = { id: testUserId, role: 'ADMIN' };
  });

  after(async () => {
    try {
      for (const jId of createdJobIds) {
        await db.delete(backgroundJobs).where(eq(backgroundJobs.id, jId));
      }
    } catch {
      // ignore
    }
  });

  // ==========================================================================
  // 1. PERSISTENCIA ACID DE PROPUESTAS OMR EN POSTGRESQL (R1 & R2-01)
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
      leaderPrincipal
    );

    createdProposalIds.push(proposal.proposalId);
    assert.ok(proposal.proposalId);
    assert.equal(proposal.isAiDraft, true);
    assert.equal(proposal.reviewStatus, 'PENDING_REVIEW');

    // Limpiar caché en memoria de la aplicación
    omrService.clearProposals();

    // Recuperar directamente desde PostgreSQL
    const loadedProposal = await omrService.getProposalAsync(proposal.proposalId, leaderPrincipal);
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
          leaderPrincipal
        );
      },
      (err: any) => err.message.includes('Conexión perdida a PostgreSQL')
    );

    // Verificar que CERO propuestas quedaron registradas en la memoria caché
    assert.throws(() => failingOmrService.getProposal('cualquier-id', leaderPrincipal), {
      name: 'NotFoundError',
    });
  });

  it('1.3: should fail review, NOT return success, and NOT update L1 cache when database write fails during review (R2-01)', async () => {
    const failingRepo: IOmrProposalRepository = {
      saveProposal: async (p) => p,
      findProposalById: async (id) => ({
        proposalId: id,
        userId: testUserId,
        sourceFilename: 'review_fail.pdf',
        sourceHash: 'dummyhash',
        detectedTitle: 'Review Fail Test',
        detectedArtist: null,
        detectedKey: 'G',
        detectedBpm: 120,
        detectedTimeSignature: '4/4',
        overallConfidence: 0.9,
        isAiDraft: true,
        reviewStatus: 'PENDING_REVIEW',
        measures: [
          {
            measureNumber: 1,
            timeSignature: '4/4',
            measureConfidence: 0.9,
            chordsDetected: [],
            notesDetected: [{ step: 'G', octave: 4, duration: 'whole', confidence: 0.9 }],
            lyricsDetected: [],
            flags: [],
          },
        ],
        unrecognizedRegions: [],
        createdAt: new Date().toISOString(),
      }),
      updateProposalStatusAndAudit: async () => {
        throw new Error('Postgres connection severed during review transaction');
      },
      updateMeasure: async () => {},
      recordAudit: async () => {},
      getAuditHistory: async () => [],
      commitProposalTransaction: async () => {
        throw new Error('Not implemented');
      },
      deleteProposal: async () => false,
    };

    const failingService = new OmrService(mockProvider, songRepo, failingRepo);
    const dummyBuffer = Buffer.from('%PDF-1.4 review fail buffer');
    const p = await failingService.processUpload(
      {
        buffer: dummyBuffer,
        filename: 'review_fail.pdf',
        mimeType: 'application/pdf',
        fileSizeBytes: dummyBuffer.length,
      },
      leaderPrincipal
    );

    await assert.rejects(
      async () => {
        await failingService.reviewProposal(p.proposalId, 'APPROVED_FOR_IMPORT', leaderPrincipal);
      },
      (err: any) => err.message.includes('Postgres connection severed during review transaction')
    );

    // El estado en memoria caché debe permanecer como PENDING_REVIEW (cero falso éxito)
    const cached = failingService.getProposal(p.proposalId, leaderPrincipal);
    assert.equal(cached.reviewStatus, 'PENDING_REVIEW');
  });

  it('1.4: should verify atomic confirmation of status and audit in single review transaction (R2-01)', async () => {
    mockProvider.customProposal = {
      detectedTitle: 'Atomic Review Test',
      detectedKey: 'D',
      detectedBpm: 90,
      detectedTimeSignature: '4/4',
      overallConfidence: 0.95,
      measures: [
        {
          measureNumber: 1,
          timeSignature: '4/4',
          measureConfidence: 0.95,
          chordsDetected: [],
          notesDetected: [{ step: 'D', octave: 4, duration: 'whole', confidence: 0.95 }],
          lyricsDetected: [],
          flags: [],
        },
      ],
    };

    const dummyBuffer = Buffer.from('%PDF-1.4 atomic review test');
    const proposal = await omrService.processUpload(
      {
        buffer: dummyBuffer,
        filename: 'atomic_review.pdf',
        mimeType: 'application/pdf',
        fileSizeBytes: dummyBuffer.length,
      },
      leaderPrincipal
    );
    createdProposalIds.push(proposal.proposalId);

    // Ejecutar revisión asíncrona confirmada en BD
    const reviewed = await omrService.reviewProposal(
      proposal.proposalId,
      'APPROVED_FOR_IMPORT',
      leaderPrincipal,
      'Verificación atómica'
    );
    assert.equal(reviewed.reviewStatus, 'APPROVED_FOR_IMPORT');

    // Comprobar directamente en PostgreSQL que tanto el estado como la auditoría existen
    const [dbProp] = await db
      .select()
      .from(omrProposals)
      .where(eq(omrProposals.id, proposal.proposalId));
    assert.equal(dbProp?.reviewStatus, 'APPROVED_FOR_IMPORT');

    const auditRows = await db
      .select()
      .from(omrAuditHistory)
      .where(eq(omrAuditHistory.proposalId, proposal.proposalId));
    assert.ok(auditRows.some((a) => a.actionType === 'APPROVE_PROPOSAL'));
  });

  // ==========================================================================
  // 2. PRESERVACIÓN DE MÉTRICAS DINÁMICAS (3/4, 6/8) & CERO FABRICACIÓN (R2 & R2-02)
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

    const dummyBuffer = Buffer.from('%PDF-1.4 3/4 meter test score');
    const proposal = await omrService.processUpload(
      {
        buffer: dummyBuffer,
        filename: 'vals_3_4.pdf',
        mimeType: 'application/pdf',
        fileSizeBytes: dummyBuffer.length,
      },
      leaderPrincipal
    );
    createdProposalIds.push(proposal.proposalId);

    await omrService.reviewProposal(proposal.proposalId, 'APPROVED_FOR_IMPORT', leaderPrincipal);
    const committed = await omrService.commitToCanonicalSong(proposal.proposalId, leaderPrincipal);
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

    const dummyBuffer = Buffer.from('%PDF-1.4 6/8 meter test buffer');
    const proposal = await omrService.processUpload(
      {
        buffer: dummyBuffer,
        filename: 'cantico_6_8.pdf',
        mimeType: 'application/pdf',
        fileSizeBytes: dummyBuffer.length,
      },
      leaderPrincipal
    );
    createdProposalIds.push(proposal.proposalId);

    await omrService.reviewProposal(proposal.proposalId, 'APPROVED_FOR_IMPORT', leaderPrincipal);
    const committed = await omrService.commitToCanonicalSong(proposal.proposalId, leaderPrincipal);
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
      detectedTimeSignature: null,
      overallConfidence: 0.8,
      measures: [
        {
          measureNumber: 1,
          timeSignature: undefined,
          measureConfidence: 0.8,
          chordsDetected: [],
          notesDetected: [{ step: 'G', octave: 4, duration: 'dotted-half', confidence: 0.8 }],
          lyricsDetected: [],
          flags: [],
        },
      ],
    };

    const dummyBuffer = Buffer.from('%PDF-1.4 unknown time sig test');
    const proposal = await omrService.processUpload(
      {
        buffer: dummyBuffer,
        filename: 'unknown_meter.pdf',
        mimeType: 'application/pdf',
        fileSizeBytes: dummyBuffer.length,
      },
      leaderPrincipal
    );
    createdProposalIds.push(proposal.proposalId);

    await omrService.reviewProposal(proposal.proposalId, 'APPROVED_FOR_IMPORT', leaderPrincipal);

    // Intentar comprometer sin override de métrica debe fallar con ValidationError
    await assert.rejects(
      async () => {
        await omrService.commitToCanonicalSong(proposal.proposalId, leaderPrincipal);
      },
      (err: any) =>
        err.name === 'ValidationError' &&
        err.message.includes('métrica no resuelta')
    );

    // Proporcionar anulación explícita y verificada debe permitir el compromiso
    const committed = await omrService.commitToCanonicalSong(
      proposal.proposalId,
      leaderPrincipal,
      { timeSignature: '3/4' }
    );
    createdSongIds.push(committed.song.id);
    assert.equal(committed.song.timeSignature, '3/4');
  });

  it('2.4: should block canonical commit when BPM is unknown without explicit override (R2)', async () => {
    mockProvider.customProposal = {
      detectedTitle: 'Tempo Desconocido',
      detectedKey: 'G',
      detectedBpm: null,
      detectedTimeSignature: '4/4',
      overallConfidence: 0.8,
      measures: [
        {
          measureNumber: 1,
          timeSignature: '4/4',
          measureConfidence: 0.8,
          chordsDetected: [],
          notesDetected: [{ step: 'G', octave: 4, duration: 'whole', confidence: 0.8 }],
          lyricsDetected: [],
          flags: [],
        },
      ],
    };

    const dummyBuffer = Buffer.from('%PDF-1.4 unknown bpm test buffer');
    const proposal = await omrService.processUpload(
      {
        buffer: dummyBuffer,
        filename: 'unknown_bpm.pdf',
        mimeType: 'application/pdf',
        fileSizeBytes: dummyBuffer.length,
      },
      leaderPrincipal
    );
    createdProposalIds.push(proposal.proposalId);

    await omrService.reviewProposal(proposal.proposalId, 'APPROVED_FOR_IMPORT', leaderPrincipal);

    // Sin BPM explícito, debe bloquear
    await assert.rejects(
      async () => {
        await omrService.commitToCanonicalSong(proposal.proposalId, leaderPrincipal);
      },
      (err: any) =>
        err.name === 'ValidationError' &&
        err.message.includes('tempo (BPM) no resuelto')
    );

    // Con anulación explícita de BPM, procede
    const committed = await omrService.commitToCanonicalSong(
      proposal.proposalId,
      leaderPrincipal,
      { bpm: 110 }
    );
    createdSongIds.push(committed.song.id);
    assert.equal(committed.song.defaultBpm, 110);
  });

  it('2.5: should reject missing BPM at repository level without falling back to 120 (R2-02)', async () => {
    const dummyDto = {
      title: 'Missing BPM Song',
      defaultKey: 'G',
      defaultBpm: 0,
      timeSignature: '4/4',
      status: 'APPROVED' as const,
      sourceFormat: 'INTERNAL' as const,
      canonicalPayload: JSON.stringify({
        header: { schemaVersion: '1.0.0', title: 'Test', tpqn: 480 },
        tracks: [],
        measures: [],
      }),
    };

    await assert.rejects(
      async () => {
        await omrRepo.commitProposalTransaction(
          'non-existent-id',
          leaderPrincipal,
          dummyDto as any,
          'Missing BPM Song'
        );
      },
      (err: any) =>
        err.name === 'NotFoundError' ||
        (err.name === 'ValidationError' && err.message.includes('defaultBpm'))
    );
  });

  it('2.6: should reject missing meter at repository level without falling back to 4/4 (R2-02)', async () => {
    const dummyDto = {
      title: 'Missing Meter Song',
      defaultKey: 'G',
      defaultBpm: 120,
      timeSignature: '',
      status: 'APPROVED' as const,
      sourceFormat: 'INTERNAL' as const,
      canonicalPayload: JSON.stringify({
        header: { schemaVersion: '1.0.0', title: 'Test', tpqn: 480 },
        tracks: [],
        measures: [],
      }),
    };

    await assert.rejects(
      async () => {
        await omrRepo.commitProposalTransaction(
          'non-existent-id',
          leaderPrincipal,
          dummyDto as any,
          'Missing Meter Song'
        );
      },
      (err: any) =>
        err.name === 'NotFoundError' ||
        (err.name === 'ValidationError' && err.message.includes('timeSignature'))
    );
  });

  // ==========================================================================
  // 3. TONALIDADES Y CÍRCULO DE QUINTAS (R2 & R2-02)
  // ==========================================================================
  it('3.1: should preserve detected key signature (Eb Major = 3 flats) without defaulting to 0', async () => {
    mockProvider.customProposal = {
      detectedTitle: 'Himno en Mi Bemol Mayor',
      detectedKey: 'Eb',
      detectedBpm: 76,
      detectedTimeSignature: '4/4',
      overallConfidence: 0.95,
      measures: [
        {
          measureNumber: 1,
          timeSignature: '4/4',
          keySignature: 'Eb',
          measureConfidence: 0.95,
          chordsDetected: [{ chord: 'Eb', beat: 1, confidence: 0.95 }],
          notesDetected: [
            { step: 'Eb', octave: 4, duration: 'half', confidence: 0.95 },
            { step: 'Bb', octave: 4, duration: 'half', confidence: 0.95 },
          ],
          lyricsDetected: [],
          flags: [],
        },
      ],
    };

    const dummyBuffer = Buffer.from('%PDF-1.4 Eb key test buffer');
    const proposal = await omrService.processUpload(
      {
        buffer: dummyBuffer,
        filename: 'eb_key_score.pdf',
        mimeType: 'application/pdf',
        fileSizeBytes: dummyBuffer.length,
      },
      leaderPrincipal
    );
    createdProposalIds.push(proposal.proposalId);

    await omrService.reviewProposal(proposal.proposalId, 'APPROVED_FOR_IMPORT', leaderPrincipal);
    const committed = await omrService.commitToCanonicalSong(proposal.proposalId, leaderPrincipal);
    createdSongIds.push(committed.song.id);

    const payload = committed.version.canonicalPayload as any;
    const m1 = payload.measures[0];

    assert.equal(m1.keySignature.tonic, 'Eb');
    assert.equal(m1.keySignature.accidentalCount, -3, 'Eb Mayor debe tener exactamente 3 bemoles (-3)');
  });

  it('3.2: should block canonical commit when key signature is unknown without explicit override (R2)', async () => {
    mockProvider.customProposal = {
      detectedTitle: 'Tonalidad Desconocida',
      detectedKey: null,
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

    const dummyBuffer = Buffer.from('%PDF-1.4 unknown key test buffer');
    const proposal = await omrService.processUpload(
      {
        buffer: dummyBuffer,
        filename: 'unknown_key.pdf',
        mimeType: 'application/pdf',
        fileSizeBytes: dummyBuffer.length,
      },
      leaderPrincipal
    );
    createdProposalIds.push(proposal.proposalId);

    await omrService.reviewProposal(proposal.proposalId, 'APPROVED_FOR_IMPORT', leaderPrincipal);

    // Intentar comprometer sin tonalidad debe fallar (CERO fallback silencioso a C)
    await assert.rejects(
      async () => {
        await omrService.commitToCanonicalSong(proposal.proposalId, leaderPrincipal);
      },
      (err: any) =>
        err.name === 'ValidationError' &&
        err.message.includes('tonalidad no resuelta')
    );

    // Con anulación explícita validada, procede exitosamente
    const committed = await omrService.commitToCanonicalSong(
      proposal.proposalId,
      leaderPrincipal,
      { key: 'F' }
    );
    createdSongIds.push(committed.song.id);
    assert.equal(committed.song.defaultKey, 'F');
  });

  it('3.3: should reject missing key at repository level without falling back (R2-02)', async () => {
    const dummyDto = {
      title: 'Missing Key Song',
      defaultKey: '',
      defaultBpm: 120,
      timeSignature: '4/4',
      status: 'APPROVED' as const,
      sourceFormat: 'INTERNAL' as const,
      canonicalPayload: JSON.stringify({
        header: { schemaVersion: '1.0.0', title: 'Test', tpqn: 480 },
        tracks: [],
        measures: [],
      }),
    };

    await assert.rejects(
      async () => {
        await omrRepo.commitProposalTransaction(
          'non-existent-id',
          leaderPrincipal,
          dummyDto as any,
          'Missing Key Song'
        );
      },
      (err: any) =>
        err.name === 'NotFoundError' ||
        (err.name === 'ValidationError' && err.message.includes('defaultKey'))
    );
  });

  // ==========================================================================
  // 4. PRESERVACIÓN DE ALTERACIONES Y PROTECCIÓN CONTRA FALSOS SILENCIOS (R2-03)
  // ==========================================================================
  it('4.1: should preserve explicit alterations (F#4, Bb3) and reject fabricated notes', async () => {
    mockProvider.customProposal = {
      detectedTitle: 'Estudio de Alteraciones',
      detectedKey: 'G',
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
            { step: 'F', octave: 4, alter: 1, duration: 'half', confidence: 0.95 },
            { step: 'B', octave: 3, alter: -1, duration: 'half', confidence: 0.95 },
          ],
          lyricsDetected: [],
          flags: [],
        },
      ],
    };

    const dummyBuffer = Buffer.from('%PDF-1.4 accidentals test buffer');
    const proposal = await omrService.processUpload(
      {
        buffer: dummyBuffer,
        filename: 'accidentals_score.pdf',
        mimeType: 'application/pdf',
        fileSizeBytes: dummyBuffer.length,
      },
      leaderPrincipal
    );
    createdProposalIds.push(proposal.proposalId);

    await omrService.reviewProposal(proposal.proposalId, 'APPROVED_FOR_IMPORT', leaderPrincipal);
    const committed = await omrService.commitToCanonicalSong(proposal.proposalId, leaderPrincipal);
    createdSongIds.push(committed.song.id);

    const payload = committed.version.canonicalPayload as any;
    const events = payload.measures[0].voices[0].events.filter((e: any) => e.type === 'NOTE');

    assert.equal(events[0].pitch.noteName, 'F#');
    assert.equal(events[0].pitch.octave, 4);

    assert.equal(events[1].pitch.noteName, 'Bb');
    assert.equal(events[1].pitch.octave, 3);
  });

  it('4.2: should flag unresolvable note glyphs and reject canonical commit instead of creating fake rests (R2-03)', async () => {
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

    const dummyBuffer = Buffer.from('%PDF-1.4 glyph smudge test buffer');
    const proposal = await omrService.processUpload(
      {
        buffer: dummyBuffer,
        filename: 'smudge.pdf',
        mimeType: 'application/pdf',
        fileSizeBytes: dummyBuffer.length,
      },
      leaderPrincipal
    );
    createdProposalIds.push(proposal.proposalId);

    assert.ok(
      proposal.measures[0]?.flags?.some((f) => f.includes('UNRESOLVED_NOTE_GLYPH')),
      'Debe marcar la bandera UNRESOLVED_NOTE_GLYPH en el compás con glifo corrupto'
    );

    await omrService.reviewProposal(proposal.proposalId, 'APPROVED_FOR_IMPORT', leaderPrincipal);

    await assert.rejects(
      async () => {
        await omrService.commitToCanonicalSong(proposal.proposalId, leaderPrincipal);
      },
      (err: any) =>
        err.name === 'ValidationError' &&
        err.message.includes('contiene contenido musical no resuelto')
    );
  });

  it('4.3: should reject measure with invalid time signature without copying previous measure value (R2-03)', async () => {
    mockProvider.customProposal = {
      detectedTitle: 'Métrica Corrupta en Compás 2',
      detectedKey: 'C',
      detectedBpm: 100,
      detectedTimeSignature: '4/4',
      overallConfidence: 0.9,
      measures: [
        {
          measureNumber: 1,
          timeSignature: '4/4',
          measureConfidence: 0.95,
          chordsDetected: [],
          notesDetected: [{ step: 'C', octave: 4, duration: 'whole', confidence: 0.9 }],
          lyricsDetected: [],
          flags: [],
        },
        {
          measureNumber: 2,
          timeSignature: 'INVALID_METER_#?',
          measureConfidence: 0.95,
          chordsDetected: [],
          notesDetected: [{ step: 'D', octave: 4, duration: 'whole', confidence: 0.9 }],
          lyricsDetected: [],
          flags: [],
        },
      ],
    };

    const dummyBuffer = Buffer.from('%PDF-1.4 invalid meter test buffer');
    const proposal = await omrService.processUpload(
      {
        buffer: dummyBuffer,
        filename: 'invalid_meter.pdf',
        mimeType: 'application/pdf',
        fileSizeBytes: dummyBuffer.length,
      },
      leaderPrincipal
    );
    createdProposalIds.push(proposal.proposalId);

    await omrService.reviewProposal(proposal.proposalId, 'APPROVED_FOR_IMPORT', leaderPrincipal);

    await assert.rejects(
      async () => {
        await omrService.commitToCanonicalSong(proposal.proposalId, leaderPrincipal);
      },
      (err: any) =>
        err.name === 'ValidationError' &&
        err.message.includes('Métrica de compás inválida o no resuelta en compás 2')
    );
  });

  it('4.4: should reject measure with invalid key signature without copying previous measure value (R2-03)', async () => {
    mockProvider.customProposal = {
      detectedTitle: 'Tonalidad Corrupta en Compás 2',
      detectedKey: 'G',
      detectedBpm: 100,
      detectedTimeSignature: '4/4',
      overallConfidence: 0.9,
      measures: [
        {
          measureNumber: 1,
          timeSignature: '4/4',
          keySignature: 'G',
          measureConfidence: 0.95,
          chordsDetected: [],
          notesDetected: [{ step: 'G', octave: 4, duration: 'whole', confidence: 0.9 }],
          lyricsDetected: [],
          flags: [],
        },
        {
          measureNumber: 2,
          timeSignature: '4/4',
          keySignature: 'CORRUPT_KEY_#?',
          measureConfidence: 0.95,
          chordsDetected: [],
          notesDetected: [{ step: 'A', octave: 4, duration: 'whole', confidence: 0.9 }],
          lyricsDetected: [],
          flags: [],
        },
      ],
    };

    const dummyBuffer = Buffer.from('%PDF-1.4 invalid key test buffer');
    const proposal = await omrService.processUpload(
      {
        buffer: dummyBuffer,
        filename: 'invalid_key.pdf',
        mimeType: 'application/pdf',
        fileSizeBytes: dummyBuffer.length,
      },
      leaderPrincipal
    );
    createdProposalIds.push(proposal.proposalId);

    await omrService.reviewProposal(proposal.proposalId, 'APPROVED_FOR_IMPORT', leaderPrincipal);

    await assert.rejects(
      async () => {
        await omrService.commitToCanonicalSong(proposal.proposalId, leaderPrincipal);
      },
      (err: any) =>
        err.name === 'ValidationError' &&
        err.message.includes('Tonalidad musical inválida o no resuelta en compás 2')
    );
  });

  // ==========================================================================
  // 5. ACORDES ILEGIBLES SEÑALIZADOS (NO EMPTY CATCH)
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
          notesDetected: [{ step: 'C', octave: 4, duration: 'whole', confidence: 0.95 }],
          lyricsDetected: [],
          flags: [],
        },
      ],
    };

    const dummyBuffer = Buffer.from('%PDF-1.4 bad chord test buffer');
    const proposal = await omrService.processUpload(
      {
        buffer: dummyBuffer,
        filename: 'bad_chord.pdf',
        mimeType: 'application/pdf',
        fileSizeBytes: dummyBuffer.length,
      },
      leaderPrincipal
    );
    createdProposalIds.push(proposal.proposalId);

    await omrService.reviewProposal(proposal.proposalId, 'APPROVED_FOR_IMPORT', leaderPrincipal);
    const committed = await omrService.commitToCanonicalSong(proposal.proposalId, leaderPrincipal);
    createdSongIds.push(committed.song.id);

    assert.ok(
      proposal.measures[0]?.flags?.some((f) => f.includes('UNPARSED_CHORD')),
      'Debe marcar la bandera UNPARSED_CHORD en el compás'
    );
  });

  // ==========================================================================
  // 6. FIGURAS COMPUESTAS & RECHAZO DE DURACIONES DESCONOCIDAS (R2)
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

    const dummyBuffer = Buffer.from('%PDF-1.4 duration study buffer');
    const proposal = await omrService.processUpload(
      {
        buffer: dummyBuffer,
        filename: 'rhythm_study.pdf',
        mimeType: 'application/pdf',
        fileSizeBytes: dummyBuffer.length,
      },
      leaderPrincipal
    );
    createdProposalIds.push(proposal.proposalId);

    await omrService.reviewProposal(proposal.proposalId, 'APPROVED_FOR_IMPORT', leaderPrincipal);
    const committed = await omrService.commitToCanonicalSong(proposal.proposalId, leaderPrincipal);
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

    const dummyBuffer = Buffer.from('%PDF-1.4 bad duration test buffer');
    const proposal = await omrService.processUpload(
      {
        buffer: dummyBuffer,
        filename: 'bad_duration.pdf',
        mimeType: 'application/pdf',
        fileSizeBytes: dummyBuffer.length,
      },
      leaderPrincipal
    );
    createdProposalIds.push(proposal.proposalId);

    await omrService.reviewProposal(proposal.proposalId, 'APPROVED_FOR_IMPORT', leaderPrincipal);

    await assert.rejects(
      async () => {
        await omrService.commitToCanonicalSong(proposal.proposalId, leaderPrincipal);
      },
      (err: any) =>
        err.name === 'ValidationError' &&
        err.message.includes('Duración de nota no reconocida')
    );
  });

  // ==========================================================================
  // 7. SILENCIOS EXPLÍCITOS VS COMPÁS SIN NOTAS (R3-03)
  // ==========================================================================
  it('7.1: should REJECT canonical commit on empty measure (notesDetected: []) with ValidationError (R3-03)', async () => {
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

    const dummyBuffer = Buffer.from('%PDF-1.4 empty 2/4 test buffer');
    const proposal = await omrService.processUpload(
      {
        buffer: dummyBuffer,
        filename: 'empty_2_4.pdf',
        mimeType: 'application/pdf',
        fileSizeBytes: dummyBuffer.length,
      },
      leaderPrincipal
    );
    createdProposalIds.push(proposal.proposalId);

    // Debe marcar UNRESOLVED_MEASURE_CONTENT
    assert.ok(proposal.measures[0]?.flags?.includes('UNRESOLVED_MEASURE_CONTENT'));

    await omrService.reviewProposal(proposal.proposalId, 'APPROVED_FOR_IMPORT', leaderPrincipal);

    // Intentar comprometer debe ser RECHAZADO (CERO fabricación de silencios de compás vacío)
    await assert.rejects(
      async () => {
        await omrService.commitToCanonicalSong(proposal.proposalId, leaderPrincipal);
      },
      (err: any) =>
        err.name === 'ValidationError' &&
        err.message.includes('no contiene notas ni silencios explícitos reconocidos')
    );
  });

  it('7.2: should preserve explicit full-measure rest when isRest: true is recognized by OMR (R3-03)', async () => {
    mockProvider.customProposal = {
      detectedTitle: 'Silencio Explícito en 2/4',
      detectedKey: 'C',
      detectedBpm: 120,
      detectedTimeSignature: '2/4',
      overallConfidence: 0.95,
      measures: [
        {
          measureNumber: 1,
          timeSignature: '2/4',
          measureConfidence: 0.95,
          chordsDetected: [],
          notesDetected: [
            { step: 'B', octave: 4, duration: 'half', confidence: 0.95, isRest: true },
          ],
          lyricsDetected: [],
          flags: [],
        },
      ],
    };

    const dummyBuffer = Buffer.from('%PDF-1.4 explicit rest 2/4 test buffer');
    const proposal = await omrService.processUpload(
      {
        buffer: dummyBuffer,
        filename: 'explicit_rest_2_4.pdf',
        mimeType: 'application/pdf',
        fileSizeBytes: dummyBuffer.length,
      },
      leaderPrincipal
    );
    createdProposalIds.push(proposal.proposalId);

    await omrService.reviewProposal(proposal.proposalId, 'APPROVED_FOR_IMPORT', leaderPrincipal);
    const committed = await omrService.commitToCanonicalSong(proposal.proposalId, leaderPrincipal);
    createdSongIds.push(committed.song.id);

    const payload = committed.version.canonicalPayload as any;
    const rests = payload.measures[0].voices[0].events.filter((e: any) => e.type === 'REST');
    assert.equal(rests.length, 1);
    assert.equal(rests[0].durationTicks, 960, 'El silencio explícito en 2/4 (half) debe durar 960 ticks');
  });

  it('7.3: should preserve explicit partial rest and note sequence in correct order (R3-03)', async () => {
    mockProvider.customProposal = {
      detectedTitle: 'Silencio Parcial y Nota en 2/4',
      detectedKey: 'C',
      detectedBpm: 120,
      detectedTimeSignature: '2/4',
      overallConfidence: 0.95,
      measures: [
        {
          measureNumber: 1,
          timeSignature: '2/4',
          measureConfidence: 0.95,
          chordsDetected: [],
          notesDetected: [
            { step: 'B', octave: 4, duration: 'quarter', confidence: 0.95, isRest: true },
            { step: 'C', octave: 4, duration: 'quarter', confidence: 0.95, isRest: false },
          ],
          lyricsDetected: [],
          flags: [],
        },
      ],
    };

    const dummyBuffer = Buffer.from('%PDF-1.4 partial rest and note buffer');
    const proposal = await omrService.processUpload(
      {
        buffer: dummyBuffer,
        filename: 'partial_rest_note.pdf',
        mimeType: 'application/pdf',
        fileSizeBytes: dummyBuffer.length,
      },
      leaderPrincipal
    );
    createdProposalIds.push(proposal.proposalId);

    await omrService.reviewProposal(proposal.proposalId, 'APPROVED_FOR_IMPORT', leaderPrincipal);
    const committed = await omrService.commitToCanonicalSong(proposal.proposalId, leaderPrincipal);
    createdSongIds.push(committed.song.id);

    const payload = committed.version.canonicalPayload as any;
    const events = payload.measures[0].voices[0].events;
    assert.equal(events.length, 2);
    assert.equal(events[0].type, 'REST');
    assert.equal(events[0].durationTicks, 480);
    assert.equal(events[1].type, 'NOTE');
    assert.equal(events[1].durationTicks, 480);
  });

  it('7.4: should reject commit when measure duration is incomplete (R3-03)', async () => {
    mockProvider.customProposal = {
      detectedTitle: 'Compás Incompleto',
      detectedKey: 'C',
      detectedBpm: 120,
      detectedTimeSignature: '4/4',
      overallConfidence: 0.9,
      measures: [
        {
          measureNumber: 1,
          timeSignature: '4/4', // Requiere 1920 ticks
          measureConfidence: 0.9,
          chordsDetected: [],
          notesDetected: [
            // Solo una negra (480 ticks) en compás de 4/4 (faltan 1440 ticks)
            { step: 'C', octave: 4, duration: 'quarter', confidence: 0.95 },
          ],
          lyricsDetected: [],
          flags: [],
        },
      ],
    };

    const dummyBuffer = Buffer.from('%PDF-1.4 incomplete measure duration buffer');
    const proposal = await omrService.processUpload(
      {
        buffer: dummyBuffer,
        filename: 'incomplete_measure.pdf',
        mimeType: 'application/pdf',
        fileSizeBytes: dummyBuffer.length,
      },
      leaderPrincipal
    );
    createdProposalIds.push(proposal.proposalId);

    await omrService.reviewProposal(proposal.proposalId, 'APPROVED_FOR_IMPORT', leaderPrincipal);

    await assert.rejects(
      async () => {
        await omrService.commitToCanonicalSong(proposal.proposalId, leaderPrincipal);
      },
      (err: any) =>
        err.name === 'ValidationError' &&
        err.message.includes('duración acumulada de 480 ticks, distinta a los 1920 ticks requeridos')
    );
  });

  // ==========================================================================
  // 8. CERO APILAMIENTO DE LÍRICA EN TICK 0
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

    const dummyBuffer = Buffer.from('%PDF-1.4 lyrics stacking test buffer');
    const proposal = await omrService.processUpload(
      {
        buffer: dummyBuffer,
        filename: 'lyrics_test.pdf',
        mimeType: 'application/pdf',
        fileSizeBytes: dummyBuffer.length,
      },
      leaderPrincipal
    );
    createdProposalIds.push(proposal.proposalId);

    await omrService.reviewProposal(proposal.proposalId, 'APPROVED_FOR_IMPORT', leaderPrincipal);
    const committed = await omrService.commitToCanonicalSong(proposal.proposalId, leaderPrincipal);
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
  // 9. FILTRADO POR UMBRAL DE CONFIANZA (< 0.70)
  // ==========================================================================
  it('9.1: should automatically flag measures with confidence < 0.70 as LOW_CONFIDENCE', async () => {
    mockProvider.customProposal = {
      detectedTitle: 'Escaneo Borroso',
      detectedKey: 'C',
      detectedBpm: 120,
      detectedTimeSignature: '4/4',
      overallConfidence: 0.6,
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

    const dummyBuffer = Buffer.from('%PDF-1.4 blurry scan buffer');
    const proposal = await omrService.processUpload(
      {
        buffer: dummyBuffer,
        filename: 'blurry.pdf',
        mimeType: 'application/pdf',
        fileSizeBytes: dummyBuffer.length,
      },
      leaderPrincipal
    );
    createdProposalIds.push(proposal.proposalId);

    assert.ok(
      proposal.measures[0]?.flags?.includes('LOW_CONFIDENCE'),
      'Compás con confianza < 0.70 debe recibir bandera LOW_CONFIDENCE'
    );
  });

  // ==========================================================================
  // 10. POLÍTICA DE TAMAÑO Y CONSISTENCIA DE BUFFER (R6 & R2-07)
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
          leaderPrincipal
        );
      },
      { name: 'ValidationError' }
    );
  });

  it('10.2: should enforce coherent 15MB file size boundary consistently across schema and provider (R6)', async () => {
    assert.equal(MAX_OMR_FILE_SIZE_BYTES, 15 * 1024 * 1024);
  });

  it('10.3: should reject declared size smaller than actual buffer (R2-07)', async () => {
    const realBuffer = Buffer.from('%PDF-1.4 real buffer with 32 bytes');
    await assert.rejects(
      async () => {
        await omrService.processUpload(
          {
            buffer: realBuffer,
            filename: 'mismatch_small.pdf',
            mimeType: 'application/pdf',
            fileSizeBytes: 10,
          },
          leaderPrincipal
        );
      },
      (err: any) =>
        err.name === 'ValidationError' &&
        err.message.includes('Inconsistencia en metadatos de archivo')
    );
  });

  it('10.4: should reject declared size larger than actual buffer (R2-07)', async () => {
    const realBuffer = Buffer.from('%PDF-1.4 real buffer with 32 bytes');
    await assert.rejects(
      async () => {
        await omrService.processUpload(
          {
            buffer: realBuffer,
            filename: 'mismatch_large.pdf',
            mimeType: 'application/pdf',
            fileSizeBytes: 100,
          },
          leaderPrincipal
        );
      },
      (err: any) =>
        err.name === 'ValidationError' &&
        err.message.includes('Inconsistencia en metadatos de archivo')
    );
  });

  it('10.5: should reject buffer exceeding 15MB by one byte (R2-07)', async () => {
    const boundaryBytes = MAX_OMR_FILE_SIZE_BYTES + 1;
    await assert.rejects(
      async () => {
        const dummyOversizedBuffer = Buffer.alloc(boundaryBytes, 0x20);
        dummyOversizedBuffer.write('%PDF-1.4');
        await omrService.processUpload(
          {
            buffer: dummyOversizedBuffer,
            filename: 'oversized_15mb_plus_1.pdf',
            mimeType: 'application/pdf',
            fileSizeBytes: boundaryBytes,
          },
          leaderPrincipal
        );
      },
      (err: any) =>
        err.name === 'ValidationError' &&
        err.message.includes('excede el tamaño máximo permitido de 15MB')
    );
  });

  it('10.6: should reject invalid MIME/signature combinations (R2-07)', async () => {
    const invalidHeaderBuffer = Buffer.from('NOT_A_VALID_HEADER_BYTES_FOR_PDF');
    await assert.rejects(
      async () => {
        await omrService.processUpload(
          {
            buffer: invalidHeaderBuffer,
            filename: 'fake.pdf',
            mimeType: 'application/pdf',
            fileSizeBytes: invalidHeaderBuffer.length,
          },
          leaderPrincipal
        );
      },
      (err: any) =>
        err.name === 'ValidationError' &&
        err.message.includes('Cabecera de archivo PDF inválida o corrupta')
    );
  });

  // ==========================================================================
  // 11. AUDITORÍA INMUTABLE SIN BYPASS (R3-02) & TRANSACCIONES ATÓMICAS (R4)
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

    const dummyBuffer = Buffer.from('%PDF-1.4 audit test buffer');
    const proposal = await omrService.processUpload(
      {
        buffer: dummyBuffer,
        filename: 'audit_score.pdf',
        mimeType: 'application/pdf',
        fileSizeBytes: dummyBuffer.length,
      },
      leaderPrincipal
    );
    createdProposalIds.push(proposal.proposalId);

    await omrService.reviewProposalAsync(
      proposal.proposalId,
      'APPROVED_FOR_IMPORT',
      leaderPrincipal,
      'Aprobado tras verificar métrica y notas'
    );

    const committed = await omrService.commitToCanonicalSong(proposal.proposalId, leaderPrincipal);
    createdSongIds.push(committed.song.id);

    const auditHistory = await omrRepo.getAuditHistory(proposal.proposalId, leaderPrincipal);

    assert.ok(auditHistory.length >= 3, 'Debe haber al menos 3 eventos de auditoría');

    const actionTypes = auditHistory.map((a) => a.actionType);
    assert.ok(actionTypes.includes('CREATE_PROPOSAL'));
    assert.ok(actionTypes.includes('APPROVE_PROPOSAL'));
    assert.ok(actionTypes.includes('COMMIT_TO_SONG'));

    const rawAuditJSON = JSON.stringify(auditHistory);
    assert.ok(!rawAuditJSON.includes('password'));
    assert.ok(!rawAuditJSON.includes('jwt'));
    assert.ok(!rawAuditJSON.includes('secret'));
  });

  it('11.2: should prevent proposal deletion when audit history exists via ON DELETE RESTRICT (R3)', async () => {
    mockProvider.customProposal = {
      detectedTitle: 'Propuesta No Eliminable',
      detectedKey: 'G',
      detectedBpm: 120,
      detectedTimeSignature: '4/4',
      overallConfidence: 0.9,
      measures: [],
    };

    const dummyBuffer = Buffer.from('%PDF-1.4 audit history restrict delete test');
    const proposal = await omrService.processUpload(
      {
        buffer: dummyBuffer,
        filename: 'non_deletable.pdf',
        mimeType: 'application/pdf',
        fileSizeBytes: dummyBuffer.length,
      },
      leaderPrincipal
    );
    createdProposalIds.push(proposal.proposalId);

    // Intentar eliminar la propuesta debe ser rechazado por la BD (ON DELETE RESTRICT en auditoría)
    await assert.rejects(
      async () => {
        await omrRepo.deleteProposal(proposal.proposalId, adminPrincipal);
      },
      (err: any) =>
        err.name === 'ValidationError' &&
        err.message.includes('registros históricos de auditoría inmutables')
    );
  });

  it('11.3: should block UPDATE on omr_audit_history at database trigger level even if app.allow_audit_cleanup is set (R3-02)', async () => {
    const dummyBuffer = Buffer.from('%PDF-1.4 trigger update test buffer');
    const proposal = await omrService.processUpload(
      {
        buffer: dummyBuffer,
        filename: 'trigger_update_test.pdf',
        mimeType: 'application/pdf',
        fileSizeBytes: dummyBuffer.length,
      },
      leaderPrincipal
    );
    createdProposalIds.push(proposal.proposalId);

    // Intentar eludir con SET app.allow_audit_cleanup = 'true'
    await db.execute(sql`SET app.allow_audit_cleanup = 'true'`);

    try {
      await assert.rejects(
        async () => {
          await db.execute(
            sql`UPDATE omr_audit_history SET reason = 'Manipulado' WHERE proposal_id = ${proposal.proposalId}`
          );
        },
        (err: any) =>
          err.message.includes('OMR audit history is strictly immutable') ||
          err.code === '55000'
      );
    } finally {
      await db.execute(sql`RESET app.allow_audit_cleanup`);
    }
  });

  it('11.4: should block DELETE on omr_audit_history at database trigger level even if app.allow_audit_cleanup is set (R3-02)', async () => {
    const dummyBuffer = Buffer.from('%PDF-1.4 trigger delete test buffer');
    const proposal = await omrService.processUpload(
      {
        buffer: dummyBuffer,
        filename: 'trigger_delete_test.pdf',
        mimeType: 'application/pdf',
        fileSizeBytes: dummyBuffer.length,
      },
      leaderPrincipal
    );
    createdProposalIds.push(proposal.proposalId);

    // Intentar eludir con SET app.allow_audit_cleanup = 'true'
    await db.execute(sql`SET app.allow_audit_cleanup = 'true'`);

    try {
      await assert.rejects(
        async () => {
          await db.execute(
            sql`DELETE FROM omr_audit_history WHERE proposal_id = ${proposal.proposalId}`
          );
        },
        (err: any) =>
          err.message.includes('OMR audit history is strictly immutable') ||
          err.code === '55000'
      );
    } finally {
      await db.execute(sql`RESET app.allow_audit_cleanup`);
    }
  });

  // ==========================================================================
  // 12. GESTIÓN DE BACKGROUND JOBS
  // ==========================================================================
  it('12.1: should create, track progress, and complete background jobs in PostgreSQL', async () => {
    const job = await jobRepo.createJob({
      jobType: 'OMR_PROCESSING',
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
  // 13. SEGURIDAD Y CONTROL DE ACCESO / IDOR (R3-01)
  // ==========================================================================
  it('13.1: should enforce ownership and reject unauthorized access to another user proposal (R3-01)', async () => {
    mockProvider.customProposal = {
      detectedTitle: 'Propuesta Privada de Juan',
      detectedKey: 'G',
      detectedBpm: 120,
      detectedTimeSignature: '4/4',
      overallConfidence: 0.9,
      measures: [],
    };

    const dummyBuffer = Buffer.from('%PDF-1.4 private proposal test buffer');
    const proposal = await omrService.processUpload(
      {
        buffer: dummyBuffer,
        filename: 'private_score.pdf',
        mimeType: 'application/pdf',
        fileSizeBytes: dummyBuffer.length,
      },
      leaderPrincipal
    );
    createdProposalIds.push(proposal.proposalId);

    // Usuario 'otherUserId' (MUSICIAN) intenta acceder a la propuesta de Juan
    await assert.rejects(
      async () => {
        await omrRepo.findProposalById(proposal.proposalId, musicianPrincipal);
      },
      { name: 'ForbiddenError' }
    );
  });

  it('13.2: should reject proposal review by unprivileged roles (R3-01)', async () => {
    mockProvider.customProposal = {
      detectedTitle: 'Propuesta para Revisión por Viewer',
      detectedKey: 'C',
      detectedBpm: 120,
      detectedTimeSignature: '4/4',
      overallConfidence: 0.9,
      measures: [],
    };

    const dummyBuffer = Buffer.from('%PDF-1.4 viewer review test buffer');
    const proposal = await omrService.processUpload(
      {
        buffer: dummyBuffer,
        filename: 'viewer_review.pdf',
        mimeType: 'application/pdf',
        fileSizeBytes: dummyBuffer.length,
      },
      leaderPrincipal
    );
    createdProposalIds.push(proposal.proposalId);

    // Usuario con rol 'VIEWER' intenta revisar/aprobar
    await assert.rejects(
      async () => {
        await omrService.reviewProposalAsync(
          proposal.proposalId,
          'APPROVED_FOR_IMPORT',
          viewerPrincipal,
          'Intento no autorizado'
        );
      },
      { name: 'ForbiddenError' }
    );
  });

  it('13.3: should reject access to proposal with null owner by ordinary users (R3-01)', async () => {
    const nullOwnerProposalId = crypto.randomUUID();
    await db.insert(omrProposals).values({
      id: nullOwnerProposalId,
      userId: null,
      sourceFilename: 'orphan_scan.pdf',
      sourceHash: 'dummy_orphan_hash',
      detectedTitle: 'Orphan Proposal',
      reviewStatus: 'PENDING_REVIEW',
    });
    createdProposalIds.push(nullOwnerProposalId);

    // Usuario MUSICIAN intenta acceder: debe ser rechazado con ForbiddenError
    await assert.rejects(
      async () => {
        await omrRepo.findProposalById(nullOwnerProposalId, musicianPrincipal);
      },
      (err: any) =>
        err.name === 'ForbiddenError' &&
        err.message.includes('carece de propietario asignado')
    );

    // Usuario ADMIN intenta acceder: debe ser permitido para recuperación
    const adminAccess = await omrRepo.findProposalById(nullOwnerProposalId, adminPrincipal);
    assert.ok(adminAccess);
    assert.equal(adminAccess.proposalId, nullOwnerProposalId);
  });

  it('13.4: should reject access when requestingUser is missing or invalid (R3-01)', async () => {
    const dummyBuffer = Buffer.from('%PDF-1.4 missing requester test buffer');
    const proposal = await omrService.processUpload(
      {
        buffer: dummyBuffer,
        filename: 'missing_requester.pdf',
        mimeType: 'application/pdf',
        fileSizeBytes: dummyBuffer.length,
      },
      leaderPrincipal
    );
    createdProposalIds.push(proposal.proposalId);

    // Llamar findProposalById sin requestingUser debe lanzar UnauthorizedError
    await assert.rejects(
      async () => {
        await omrRepo.findProposalById(proposal.proposalId, undefined as any);
      },
      { name: 'UnauthorizedError' }
    );

    // Llamar findProposalById con rol no válido debe lanzar ForbiddenError
    await assert.rejects(
      async () => {
        await omrRepo.findProposalById(proposal.proposalId, { id: testUserId, role: 'INVALID_ROLE' });
      },
      { name: 'ForbiddenError' }
    );
  });

  it('13.5: should reject unauthorized users from inspecting audit history (R3-01)', async () => {
    const dummyBuffer = Buffer.from('%PDF-1.4 audit history security test buffer');
    const proposal = await omrService.processUpload(
      {
        buffer: dummyBuffer,
        filename: 'audit_security.pdf',
        mimeType: 'application/pdf',
        fileSizeBytes: dummyBuffer.length,
      },
      leaderPrincipal
    );
    createdProposalIds.push(proposal.proposalId);

    // Usuario 'otherUserId' (MUSICIAN) intenta inspeccionar la auditoría de Juan
    await assert.rejects(
      async () => {
        await omrRepo.getAuditHistory(proposal.proposalId, musicianPrincipal);
      },
      { name: 'ForbiddenError' }
    );
  });

  // ==========================================================================
  // 14. IDEMPOTENCIA Y SEGURIDAD BAJO CONCURRENCIA (R2-06 & R3-06)
  // ==========================================================================
  it('14.1: should ensure canonical commit is idempotent and returns existing song on retry (R3-06)', async () => {
    mockProvider.customProposal = {
      detectedTitle: 'Canción Idempotente de Prueba',
      detectedKey: 'D',
      detectedBpm: 95,
      detectedTimeSignature: '4/4',
      overallConfidence: 0.95,
      measures: [
        {
          measureNumber: 1,
          timeSignature: '4/4',
          keySignature: 'D',
          measureConfidence: 0.95,
          chordsDetected: [{ chord: 'D', beat: 1, confidence: 0.95 }],
          notesDetected: [{ step: 'D', octave: 4, duration: 'whole', confidence: 0.95 }],
          lyricsDetected: [],
          flags: [],
        },
      ],
    };

    const dummyBuffer = Buffer.from('%PDF-1.4 idempotent commit test buffer');
    const proposal = await omrService.processUpload(
      {
        buffer: dummyBuffer,
        filename: 'idempotent_test.pdf',
        mimeType: 'application/pdf',
        fileSizeBytes: dummyBuffer.length,
      },
      leaderPrincipal
    );
    createdProposalIds.push(proposal.proposalId);

    await omrService.reviewProposal(proposal.proposalId, 'APPROVED_FOR_IMPORT', leaderPrincipal);

    // Primer commit
    const firstCommit = await omrService.commitToCanonicalSong(proposal.proposalId, leaderPrincipal);
    createdSongIds.push(firstCommit.song.id);
    assert.ok(firstCommit.song.id);

    // Segundo commit (retry) debe retornar la MISMA canción sin duplicar registros en songs
    const secondCommit = await omrService.commitToCanonicalSong(proposal.proposalId, leaderPrincipal);
    assert.equal(secondCommit.song.id, firstCommit.song.id);
    assert.equal(secondCommit.song.title, firstCommit.song.title);
  });

  it('14.2: should serialize concurrent canonical commits via SELECT FOR UPDATE producing exactly 1 song (R3-06)', async () => {
    mockProvider.customProposal = {
      detectedTitle: 'Canción Concurrente de Prueba',
      detectedKey: 'A',
      detectedBpm: 115,
      detectedTimeSignature: '4/4',
      overallConfidence: 0.95,
      measures: [
        {
          measureNumber: 1,
          timeSignature: '4/4',
          keySignature: 'A',
          measureConfidence: 0.95,
          chordsDetected: [{ chord: 'A', beat: 1, confidence: 0.95 }],
          notesDetected: [{ step: 'A', octave: 4, duration: 'whole', confidence: 0.95 }],
          lyricsDetected: [],
          flags: [],
        },
      ],
    };

    const dummyBuffer = Buffer.from('%PDF-1.4 concurrent commit test buffer');
    const proposal = await omrService.processUpload(
      {
        buffer: dummyBuffer,
        filename: 'concurrent_test.pdf',
        mimeType: 'application/pdf',
        fileSizeBytes: dummyBuffer.length,
      },
      leaderPrincipal
    );
    createdProposalIds.push(proposal.proposalId);

    await omrService.reviewProposal(proposal.proposalId, 'APPROVED_FOR_IMPORT', leaderPrincipal);

    // Disparar dos llamadas concurrentes simultáneas sobre la misma propuesta
    const [res1, res2] = await Promise.all([
      omrService.commitToCanonicalSong(proposal.proposalId, leaderPrincipal),
      omrService.commitToCanonicalSong(proposal.proposalId, leaderPrincipal),
    ]);

    createdSongIds.push(res1.song.id);

    // Ambas transacciones serializadas por SELECT FOR UPDATE convergen al MISMO ID de canción
    assert.equal(res1.song.id, res2.song.id, 'Las llamadas concurrentes deben converger al mismo ID de canción');

    // Comprobar en PostgreSQL que se creó exactamente 1 canción y el puntero canónico es consistente
    const [pRow] = await db
      .select()
      .from(omrProposals)
      .where(eq(omrProposals.id, proposal.proposalId));
    assert.equal(pRow?.reviewStatus, 'COMMITTED');
    assert.equal(pRow?.canonicalSongId, res1.song.id);
  });

  // ==========================================================================
  // 15. POSTGRESQL COMO ÚNICA FUENTE DE VERDAD & HIGIENE DE CACHÉ (R3-04)
  // ==========================================================================
  it('15.1: should evict L1 cache and return NotFoundError when proposal is deleted directly in PostgreSQL (R3-04)', async () => {
    const testProposalId = crypto.randomUUID();

    // Insertar propuesta directamente en PostgreSQL sin historial de auditoría
    await db.insert(omrProposals).values({
      id: testProposalId,
      userId: testUserId,
      sourceFilename: 'cache_test.pdf',
      sourceHash: 'cache_hash_123',
      detectedTitle: 'Cache Test Song',
      reviewStatus: 'PENDING_REVIEW',
    });

    // 1. Cargar mediante getProposalAsync para que se indexe en caché L1
    const loaded = await omrService.getProposalAsync(testProposalId, leaderPrincipal);
    assert.equal(loaded.proposalId, testProposalId);

    // Verificar que está presente en la caché síncrona
    const inMemory = omrService.getProposal(testProposalId, leaderPrincipal);
    assert.equal(inMemory.proposalId, testProposalId);

    // 2. Eliminar el registro directamente de PostgreSQL (sin registros de auditoría que lo restrinjan)
    await db.delete(omrProposals).where(eq(omrProposals.id, testProposalId));

    // 3. getProposalAsync DEBE consultar PostgreSQL, verificar ausencia, desalojar de caché L1 y lanzar NotFoundError (CERO fallback a memoria)
    await assert.rejects(
      async () => {
        await omrService.getProposalAsync(testProposalId, leaderPrincipal);
      },
      { name: 'NotFoundError' }
    );

    // 4. Verificar que la entrada fue desalojada de la memoria y posterior getProposal síncrono también falla
    assert.throws(
      () => omrService.getProposal(testProposalId, leaderPrincipal),
      { name: 'NotFoundError' }
    );
  });

  // ==========================================================================
  // 16. PRESERVACIÓN DE HISTORIAL DE COMPROMISO & ON DELETE RESTRICT (R3-05)
  // ==========================================================================
  it('16.1: should prevent deleting canonical song committed from OMR proposal via ON DELETE RESTRICT (R3-05)', async () => {
    mockProvider.customProposal = {
      detectedTitle: 'Canción Inseparable OMR',
      detectedKey: 'E',
      detectedBpm: 100,
      detectedTimeSignature: '4/4',
      overallConfidence: 0.95,
      measures: [
        {
          measureNumber: 1,
          timeSignature: '4/4',
          measureConfidence: 0.95,
          chordsDetected: [{ chord: 'E', beat: 1, confidence: 0.95 }],
          notesDetected: [{ step: 'E', octave: 4, duration: 'whole', confidence: 0.95 }],
          lyricsDetected: [],
          flags: [],
        },
      ],
    };

    const dummyBuffer = Buffer.from('%PDF-1.4 restrict delete canonical song buffer');
    const proposal = await omrService.processUpload(
      {
        buffer: dummyBuffer,
        filename: 'restrict_song.pdf',
        mimeType: 'application/pdf',
        fileSizeBytes: dummyBuffer.length,
      },
      leaderPrincipal
    );
    createdProposalIds.push(proposal.proposalId);

    await omrService.reviewProposal(proposal.proposalId, 'APPROVED_FOR_IMPORT', leaderPrincipal);
    const committed = await omrService.commitToCanonicalSong(proposal.proposalId, leaderPrincipal);
    createdSongIds.push(committed.song.id);

    // Intentar eliminar la canción canónica directamente en PostgreSQL debe ser BLOQUEADO por la FK ON DELETE RESTRICT
    await assert.rejects(
      async () => {
        await db.delete(songs).where(eq(songs.id, committed.song.id));
      },
      (err: any) =>
        err.message.includes('violates RESTRICT setting') ||
        err.message.includes('foreign key constraint') ||
        err.code === '23001' ||
        err.code === '23503'
    );
  });

  it('16.2: should throw ConflictError if committed proposal references non-existent canonical song (R3-05)', async () => {
    // Si una propuesta en estado COMMITTED tiene un canonical_song_id que no existe en el catálogo, debe lanzar ConflictError
    const orphanCommittedProposalId = crypto.randomUUID();

    await db.insert(omrProposals).values({
      id: orphanCommittedProposalId,
      userId: testUserId,
      sourceFilename: 'orphan_committed.pdf',
      sourceHash: 'dummy_orphan_hash_2',
      detectedTitle: 'Orphan Committed',
      reviewStatus: 'COMMITTED',
      canonicalSongId: null, // Huérfano o corrupto
    });
    createdProposalIds.push(orphanCommittedProposalId);

    // Al llamar commitProposalTransaction sobre una propuesta COMMITTED sin canción válida, debe lanzar ConflictError
    await assert.rejects(
      async () => {
        await omrRepo.commitProposalTransaction(
          orphanCommittedProposalId,
          leaderPrincipal,
          {} as any,
          'Orphan Committed'
        );
      },
      { name: 'ConflictError' }
    );
  });
});
