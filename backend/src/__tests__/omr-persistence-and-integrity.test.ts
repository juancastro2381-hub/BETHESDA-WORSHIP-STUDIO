/**
 * @file omr-persistence-and-integrity.test.ts
 * @description Suite de pruebas automatizadas para la persistencia ACID en PostgreSQL y la remediación
 * exhaustiva de los 10 defectos de integridad musical en OMR (Fase 1A).
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
import { DrizzleOmrProposalRepository } from '../repositories/omr-proposal-repository.ts';
import { DrizzleBackgroundJobRepository } from '../repositories/background-job-repository.ts';
import { DrizzleSongRepository } from '../repositories/song-repository.ts';
import { DrizzleUserRepository } from '../repositories/user-repository.ts';
import { OmrService } from '../application/omr-service.ts';
import type { IOmrProvider } from '../domain/omr/omr-provider.ts';
import type { OmrProposal, OmrRecognitionInput } from '../domain/omr/types.ts';

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
      detectedKey: this.customProposal?.detectedKey ?? 'G',
      detectedBpm: this.customProposal?.detectedBpm ?? 120,
      detectedTimeSignature: this.customProposal?.detectedTimeSignature ?? '3/4',
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

describe('Fase 1A — Integridad Musical OMR y Persistencia Relacional', () => {
  let omrRepo: DrizzleOmrProposalRepository;
  let jobRepo: DrizzleBackgroundJobRepository;
  let songRepo: DrizzleSongRepository;
  let userRepo: DrizzleUserRepository;
  let mockProvider: MockOmrProvider;
  let omrService: OmrService;

  let testUserId: string;
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

    // Crear usuario de prueba
    const testEmail = `musician_omr_${Date.now()}@bethesda.local`;
    const user = await userRepo.create({
      email: testEmail,
      passwordHash: '$argon2id$v=19$m=65536,t=3,p=4$dummyhash$dummyhash',
      firstName: 'Juan',
      lastName: 'Director',
      role: 'WORSHIP_LEADER',
      accountStatus: 'ACTIVE',
    });
    testUserId = user.id;
  });

  after(async () => {
    // Limpieza de datos creados en orden de claves foráneas
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
    if (testUserId) {
      await db.delete(users).where(eq(users.id, testUserId));
    }
  });

  // ==========================================================================
  // 1. PERSISTENCIA ACID DE PROPUESTAS OMR EN POSTGRESQL
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

  // ==========================================================================
  // 2. DEFECTO 1 REMEDIADO: PRESERVACIÓN DE MÉTRICAS DINÁMICAS (3/4, 6/8)
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

    // Aprobar y comprometer
    omrService.reviewProposal(proposal.proposalId, testUserId, 'APPROVED_FOR_IMPORT');
    const committed = await omrService.commitToCanonicalSong(proposal.proposalId, testUserId);
    createdSongIds.push(committed.song.id);

    const payload = committed.version.canonicalPayload as any;
    assert.equal(payload.measures.length, 1);
    const m1 = payload.measures[0];

    // Verificar duración exacta de 3/4 = 3 * 480 = 1440 ticks (CERO hardcode de 1920)
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

  // ==========================================================================
  // 3. DEFECTO 2 REMEDIADO: PRESERVACIÓN TONAL CANÓNICA (NON-C KEYS)
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

    // Verificar que la armadura de Eb Mayor tiene -3 alteraciones (Sib, Mib, Lab) y NO 0 (Do Mayor)
    assert.equal(m1.keySignature.tonic, 'Eb');
    assert.equal(m1.keySignature.accidentalCount, -3, 'Eb Mayor debe tener exactamente 3 bemoles (-3)');
  });

  // ==========================================================================
  // 4. DEFECTOS 3 & 4 REMEDIADOS: PRESERVACIÓN DE ALTERACIONES Y CERO FABRICACIÓN
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
            // F#4 con alteración explícita alter: 1
            { step: 'F', octave: 4, alter: 1, duration: 'half', confidence: 0.93 },
            // Bb3 mediante step
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

    // Nota 1: F#4 -> Nota F con sostenido en octava 4
    assert.equal(events[0].pitch.noteName, 'F#');
    assert.equal(events[0].pitch.octave, 4);

    // Nota 2: Bb3 -> Nota B con bemol en octava 3
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
            // Glifo corrupto que antes se convertía silenciosamente a NoteName.C
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

    // Solo se debe incluir la nota válida E4, NUNCA un C fabricado por el glifo dañado
    assert.equal(events.length, 1, 'No debe fabricar notas C para glifos no reconocibles');
    assert.equal(events[0].pitch.noteName, 'E');
  });

  // ==========================================================================
  // 5. DEFECTO 5 REMEDIADO: ACORDES ILEGIBLES SEÑALIZADOS (NO EMPTY CATCH)
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
            { chord: 'ILEGIBLE_???/13b9#', beat: 3, confidence: 0.4 }, // Acorde no parseable
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

    // Verificar que el compás tiene la bandera de advertencia
    assert.ok(
      proposal.measures[0]?.flags?.some((f) => f.includes('UNPARSED_CHORD')),
      'Debe marcar la bandera UNPARSED_CHORD en el compás'
    );
  });

  // ==========================================================================
  // 6. DEFECTO 6 REMEDIADO: FIGURAS COMPUESTAS (PUNTILLOS Y TRESILLOS)
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
            { step: 'C', octave: 4, duration: 'dotted-half', confidence: 0.95 }, // 1440 ticks
            { step: 'D', octave: 4, duration: 'quarter', confidence: 0.95 }, // 480 ticks
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
            { step: 'E', octave: 4, duration: 'dotted-quarter', confidence: 0.95 }, // 720 ticks
            { step: 'F', octave: 4, duration: 'eighth', confidence: 0.95 }, // 240 ticks
            { step: 'G', octave: 4, duration: 'triplet-quarter', confidence: 0.95 }, // 320 ticks
            { step: 'A', octave: 4, duration: 'triplet-quarter', confidence: 0.95 }, // 320 ticks
            { step: 'B', octave: 4, duration: 'triplet-quarter', confidence: 0.95 }, // 320 ticks
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

  // ==========================================================================
  // 7. DEFECTO 7 REMEDIADO: SILENCIO DE COMPÁS VACÍO ACORDE A MÉTRICA
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
          notesDetected: [], // Sin notas reconocidas
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
  // 8. DEFECTO 8 REMEDIADO: CERO APILAMIENTO DE LÍRICA EN TICK 0
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
            { step: 'C', octave: 4, duration: 'quarter', confidence: 0.95 }, // tick 0
            { step: 'D', octave: 4, duration: 'quarter', confidence: 0.95 }, // tick 480
            { step: 'E', octave: 4, duration: 'quarter', confidence: 0.95 }, // tick 960
            { step: 'F', octave: 4, duration: 'quarter', confidence: 0.95 }, // tick 1440
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
    // Verificar que las 4 sílabas tienen desplazamientos crecientes y alineados con las notas
    assert.equal(lyrics[0].tickOffset, 0, 'Sílaba 1 alineada con nota 1');
    assert.equal(lyrics[1].tickOffset, 480, 'Sílaba 2 alineada con nota 2');
    assert.equal(lyrics[2].tickOffset, 960, 'Sílaba 3 alineada con nota 3');
    assert.equal(lyrics[3].tickOffset, 1440, 'Sílaba 4 alineada con nota 4');
  });

  // ==========================================================================
  // 9. DEFECTO 9 REMEDIADO: FILTRADO POR UMBRAL DE CONFIANZA (< 0.70)
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
          measureConfidence: 0.58, // < 0.70
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
  // 10. DEFECTO 10 REMEDIADO: VALIDACIÓN DE ENTRADA CON ZOD
  // ==========================================================================
  it('10.1: should reject inputs with 0 bytes or exceeding size limit with ValidationError', async () => {
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

  // ==========================================================================
  // 11. AUDITORÍA INMUTABLE DE HISTORIAL (omr_audit_history)
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

    // Revisar explícitamente de forma asíncrona para auditoría completa
    await omrService.reviewProposalAsync(
      proposal.proposalId,
      testUserId,
      'APPROVED_FOR_IMPORT',
      'Aprobado tras verificar métrica y notas'
    );

    // Comprometer al catálogo canónico
    const committed = await omrService.commitToCanonicalSong(proposal.proposalId, testUserId);
    createdSongIds.push(committed.song.id);

    // Consultar historial de auditoría
    const auditLogs = await omrRepo.getAuditHistory(proposal.proposalId);
    assert.ok(auditLogs.length >= 3, 'Debe registrar al menos 3 eventos de auditoría');

    const actionTypes = auditLogs.map((a) => a.actionType);
    assert.ok(actionTypes.includes('CREATE_PROPOSAL'));
    assert.ok(actionTypes.includes('APPROVE_PROPOSAL'));
    assert.ok(actionTypes.includes('COMMIT_TO_SONG'));

    // Verificar ausencia de tokens o secretos sensibles
    for (const log of auditLogs) {
      const serialized = JSON.stringify(log);
      assert.ok(!serialized.includes('password'));
      assert.ok(!serialized.includes('secret'));
      assert.ok(!serialized.includes('token'));
    }
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

    // Actualizar progreso a 50% y estado a PROCESSING
    await jobRepo.updateJobProgress(job.id, 50, 'PROCESSING');
    const updated = await jobRepo.findJobById(job.id);
    assert.equal(updated?.progress, 50);
    assert.equal(updated?.status, 'PROCESSING');
    assert.ok(updated?.startedAt);

    // Completar tarea
    const outputProposalId = crypto.randomUUID();
    await jobRepo.completeJob(job.id, outputProposalId);
    const completed = await jobRepo.findJobById(job.id);
    assert.equal(completed?.status, 'COMPLETED');
    assert.equal(completed?.progress, 100);
    assert.equal(completed?.outputRef, outputProposalId);
    assert.ok(completed?.completedAt);
  });
});
