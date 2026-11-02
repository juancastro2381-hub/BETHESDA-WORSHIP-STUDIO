/**
 * @file omr-proposal-repository.ts
 * @description Repositorio persistente en PostgreSQL con Drizzle ORM para propuestas OMR,
 * compases discretos y auditoría inmutable de decisiones humanas (Fase 1A & 1A-R).
 */

import { eq, desc, asc, and } from 'drizzle-orm';
import { db as defaultDb, type Database } from '../db/index.ts';
import {
  omrProposals,
  omrProposalMeasures,
  omrAuditHistory,
  songs,
  songVersions,
  songMetadata,
} from '../db/schema.ts';
import type {
  OmrProposal,
  OmrMeasureProposal,
  OmrReviewStatus,
  OmrAuditEntry,
  OmrActionType,
} from '../domain/omr/types.ts';
import type { CreateSongDTO } from '../domain/types.ts';
import type { SongWithVersion } from './song-repository.ts';
import { CanonicalDeserializer, CanonicalSerializer } from '../domain/canonical-serializer.ts';
import { ForbiddenError, NotFoundError, ValidationError } from '../domain/errors.ts';

export interface IOmrProposalRepository {
  saveProposal(proposal: OmrProposal): Promise<OmrProposal>;
  findProposalById(
    proposalId: string,
    requestingUser?: { id: string; role: string }
  ): Promise<OmrProposal | null>;
  updateProposalStatus(
    proposalId: string,
    status: OmrReviewStatus,
    reviewedByUserId?: string
  ): Promise<void>;
  updateProposalStatusAndAudit(
    proposalId: string,
    status: OmrReviewStatus,
    reviewedByUserId?: string,
    reason?: string
  ): Promise<void>;
  updateMeasure(proposalId: string, measure: OmrMeasureProposal): Promise<void>;
  recordAudit(entry: OmrAuditEntry): Promise<void>;
  getAuditHistory(
    proposalId: string,
    requestingUser?: { id: string; role: string }
  ): Promise<OmrAuditEntry[]>;
  commitProposalTransaction(
    proposalId: string,
    userId: string,
    songDto: CreateSongDTO,
    title: string
  ): Promise<SongWithVersion>;
  deleteProposal(proposalId: string): Promise<boolean>;
}

export class DrizzleOmrProposalRepository implements IOmrProposalRepository {
  public constructor(private readonly db: Database = defaultDb) {}

  public async saveProposal(proposal: OmrProposal): Promise<OmrProposal> {
    await this.db.transaction(async (tx) => {
      // 1. Insertar propuesta principal (Durable write)
      await tx
        .insert(omrProposals)
        .values({
          id: proposal.proposalId,
          jobId: proposal.jobId ?? null,
          userId: proposal.userId ?? null,
          sourceFilename: proposal.sourceFilename,
          sourceHash: proposal.sourceHash,
          detectedTitle: proposal.detectedTitle,
          detectedArtist: proposal.detectedArtist,
          detectedKey: proposal.detectedKey,
          detectedBpm: proposal.detectedBpm,
          detectedTimeSignature: proposal.detectedTimeSignature,
          overallConfidence: proposal.overallConfidence,
          isAiDraft: true,
          reviewStatus: proposal.reviewStatus,
          rawPayload: { unrecognizedRegions: proposal.unrecognizedRegions ?? [] },
        })
        .onConflictDoUpdate({
          target: omrProposals.id,
          set: {
            detectedTitle: proposal.detectedTitle,
            detectedArtist: proposal.detectedArtist,
            detectedKey: proposal.detectedKey,
            detectedBpm: proposal.detectedBpm,
            detectedTimeSignature: proposal.detectedTimeSignature,
            overallConfidence: proposal.overallConfidence,
            reviewStatus: proposal.reviewStatus,
            reviewedAt: proposal.reviewedAt ? new Date(proposal.reviewedAt) : null,
            reviewedByUserId: proposal.reviewedByUserId ?? null,
            rawPayload: { unrecognizedRegions: proposal.unrecognizedRegions ?? [] },
          },
        });

      // 2. Insertar compases reconocidos (CERO defaults musicales fabricados como '4/4')
      if (proposal.measures && proposal.measures.length > 0) {
        for (const m of proposal.measures) {
          const resolvedTimeSig = m.timeSignature ?? proposal.detectedTimeSignature ?? null;
          const resolvedKeySig = m.keySignature ?? proposal.detectedKey ?? null;

          await tx
            .insert(omrProposalMeasures)
            .values({
              proposalId: proposal.proposalId,
              measureNumber: m.measureNumber,
              timeSignature: resolvedTimeSig,
              keySignature: resolvedKeySig,
              chordsDetected: m.chordsDetected ?? [],
              notesDetected: m.notesDetected ?? [],
              lyricsDetected: m.lyricsDetected ?? [],
              measureConfidence: m.measureConfidence ?? 0,
              flags: m.flags ?? [],
            })
            .onConflictDoUpdate({
              target: [omrProposalMeasures.proposalId, omrProposalMeasures.measureNumber],
              set: {
                timeSignature: resolvedTimeSig,
                keySignature: resolvedKeySig,
                chordsDetected: m.chordsDetected ?? [],
                notesDetected: m.notesDetected ?? [],
                lyricsDetected: m.lyricsDetected ?? [],
                measureConfidence: m.measureConfidence ?? 0,
                flags: m.flags ?? [],
              },
            });
        }
      }

      // 3. Registrar auditoría inmutable de creación
      await tx.insert(omrAuditHistory).values({
        proposalId: proposal.proposalId,
        userId: proposal.userId ?? null,
        actionType: 'CREATE_PROPOSAL',
        newValue: {
          filename: proposal.sourceFilename,
          hash: proposal.sourceHash,
          measureCount: proposal.measures?.length ?? 0,
          confidence: proposal.overallConfidence,
        },
        reason: 'Creación inicial de propuesta OMR (AI Draft)',
      });
    });

    return proposal;
  }

  public async findProposalById(
    proposalId: string,
    requestingUser?: { id: string; role: string }
  ): Promise<OmrProposal | null> {
    const [row] = await this.db
      .select()
      .from(omrProposals)
      .where(eq(omrProposals.id, proposalId))
      .limit(1);

    if (!row) {
      return null;
    }

    // Aislamiento de usuario (IDOR mitigation): si no es ADMIN/SUPER_ADMIN, debe ser el propietario
    if (requestingUser && !['ADMIN', 'SUPER_ADMIN'].includes(requestingUser.role)) {
      if (row.userId && row.userId !== requestingUser.id) {
        throw new ForbiddenError('No tiene autorización para acceder a una propuesta de otro usuario.');
      }
    }

    const measuresRows = await this.db
      .select()
      .from(omrProposalMeasures)
      .where(eq(omrProposalMeasures.proposalId, proposalId))
      .orderBy(asc(omrProposalMeasures.measureNumber));

    const measures: OmrMeasureProposal[] = measuresRows.map((m) => ({
      measureNumber: m.measureNumber,
      timeSignature: m.timeSignature ?? undefined,
      keySignature: m.keySignature ?? undefined,
      chordsDetected: (m.chordsDetected as any) ?? [],
      notesDetected: (m.notesDetected as any) ?? [],
      lyricsDetected: (m.lyricsDetected as any) ?? [],
      measureConfidence: m.measureConfidence,
      flags: (m.flags as string[]) ?? [],
    }));

    const rawPayload = (row.rawPayload as any) ?? {};

    return {
      proposalId: row.id,
      jobId: row.jobId ?? undefined,
      userId: row.userId ?? undefined,
      sourceFilename: row.sourceFilename,
      sourceHash: row.sourceHash,
      detectedTitle: row.detectedTitle,
      detectedArtist: row.detectedArtist,
      detectedKey: row.detectedKey,
      detectedBpm: row.detectedBpm,
      detectedTimeSignature: row.detectedTimeSignature,
      overallConfidence: row.overallConfidence,
      isAiDraft: true,
      reviewStatus: row.reviewStatus as OmrReviewStatus,
      measures,
      unrecognizedRegions: rawPayload.unrecognizedRegions ?? [],
      createdAt: row.createdAt.toISOString(),
      reviewedAt: row.reviewedAt?.toISOString(),
      reviewedByUserId: row.reviewedByUserId ?? undefined,
    };
  }

  public async updateProposalStatus(
    proposalId: string,
    status: OmrReviewStatus,
    reviewedByUserId?: string
  ): Promise<void> {
    const now = new Date();
    await this.db
      .update(omrProposals)
      .set({
        reviewStatus: status,
        reviewedAt: now,
        reviewedByUserId: reviewedByUserId ?? null,
      })
      .where(eq(omrProposals.id, proposalId));
  }

  public async updateProposalStatusAndAudit(
    proposalId: string,
    status: OmrReviewStatus,
    reviewedByUserId?: string,
    reason?: string
  ): Promise<void> {
    const now = new Date();
    await this.db.transaction(async (tx) => {
      const [updated] = await tx
        .update(omrProposals)
        .set({
          reviewStatus: status,
          reviewedAt: now,
          reviewedByUserId: reviewedByUserId ?? null,
        })
        .where(eq(omrProposals.id, proposalId))
        .returning({ id: omrProposals.id });

      if (!updated) {
        throw new NotFoundError('Propuesta OMR', proposalId);
      }

      await tx.insert(omrAuditHistory).values({
        proposalId,
        userId: reviewedByUserId ?? null,
        actionType: status === 'APPROVED_FOR_IMPORT' ? 'APPROVE_PROPOSAL' : 'REJECT_PROPOSAL',
        newValue: { status },
        reason: reason ?? `Revisión humana: estado actualizado a ${status}`,
      });
    });
  }

  public async updateMeasure(
    proposalId: string,
    measure: OmrMeasureProposal
  ): Promise<void> {
    await this.db
      .insert(omrProposalMeasures)
      .values({
        proposalId,
        measureNumber: measure.measureNumber,
        timeSignature: measure.timeSignature ?? null,
        keySignature: measure.keySignature ?? null,
        chordsDetected: measure.chordsDetected ?? [],
        notesDetected: measure.notesDetected ?? [],
        lyricsDetected: measure.lyricsDetected ?? [],
        measureConfidence: measure.measureConfidence ?? 0,
        flags: measure.flags ?? [],
      })
      .onConflictDoUpdate({
        target: [omrProposalMeasures.proposalId, omrProposalMeasures.measureNumber],
        set: {
          timeSignature: measure.timeSignature ?? null,
          keySignature: measure.keySignature ?? null,
          chordsDetected: measure.chordsDetected ?? [],
          notesDetected: measure.notesDetected ?? [],
          lyricsDetected: measure.lyricsDetected ?? [],
          measureConfidence: measure.measureConfidence ?? 0,
          flags: measure.flags ?? [],
        },
      });
  }

  public async recordAudit(entry: OmrAuditEntry): Promise<void> {
    await this.db.insert(omrAuditHistory).values({
      proposalId: entry.proposalId,
      userId: entry.userId ?? null,
      actionType: entry.actionType,
      targetMeasure: entry.targetMeasure ?? null,
      targetTick: entry.targetTick ?? null,
      previousValue: entry.previousValue ?? null,
      newValue: entry.newValue ?? null,
      reason: entry.reason ?? null,
    });
  }

  public async getAuditHistory(
    proposalId: string,
    requestingUser?: { id: string; role: string }
  ): Promise<OmrAuditEntry[]> {
    if (requestingUser) {
      await this.findProposalById(proposalId, requestingUser);
    }

    const rows = await this.db
      .select()
      .from(omrAuditHistory)
      .where(eq(omrAuditHistory.proposalId, proposalId))
      .orderBy(desc(omrAuditHistory.createdAt));

    return rows.map((r) => ({
      id: r.id,
      proposalId: r.proposalId,
      userId: r.userId ?? undefined,
      actionType: r.actionType as OmrActionType,
      targetMeasure: r.targetMeasure ?? undefined,
      targetTick: r.targetTick ?? undefined,
      previousValue: r.previousValue,
      newValue: r.newValue,
      reason: r.reason ?? undefined,
      createdAt: r.createdAt.toISOString(),
    }));
  }

  /**
   * Ejecuta el compromiso canónico en una ÚNICA transacción atómica en PostgreSQL (R4).
   * Inserta la canción, su versión, actualiza el estado de la propuesta y registra la auditoría.
   * Si cualquiera de los pasos falla, TODO el lote se revierte automáticamente sin estados parciales.
   */
  public async commitProposalTransaction(
    proposalId: string,
    userId: string,
    songDto: CreateSongDTO,
    title: string
  ): Promise<SongWithVersion> {
    return await this.db.transaction(async (tx) => {
      // 1. Verificar estado de la propuesta dentro de la transacción
      const [proposal] = await tx
        .select()
        .from(omrProposals)
        .where(eq(omrProposals.id, proposalId))
        .limit(1);

      if (!proposal) {
        throw new NotFoundError('Propuesta OMR', proposalId);
      }

      if (proposal.reviewStatus !== 'APPROVED_FOR_IMPORT') {
        throw new ValidationError(
          'La propuesta OMR debe estar en estado APPROVED_FOR_IMPORT para comprometerse al catálogo.'
        );
      }

      // 2. Extraer y validar el payload canónico
      const deserializedPayload = CanonicalDeserializer.deserialize(songDto.canonicalPayload);
      const canonicalJSON = CanonicalSerializer.serialize(deserializedPayload);
      const stats = CanonicalSerializer.extractStatistics(deserializedPayload);

      // 3. Insertar canción maestra
      const [newSong] = await tx
        .insert(songs)
        .values({
          title: title.trim(),
          artist: songDto.artist ? songDto.artist.trim() : null,
          ccliNumber: songDto.ccliNumber ? songDto.ccliNumber.trim() : null,
          defaultKey: songDto.defaultKey.trim(),
          defaultBpm: songDto.defaultBpm ?? 120,
          timeSignature: songDto.timeSignature ?? '4/4',
          status: 'APPROVED',
          createdByUserId: userId,
        })
        .returning();

      if (!newSong) {
        throw new Error('Fallo al insertar el registro de canción canónica.');
      }

      // 4. Insertar versión inicial
      const [newVersion] = await tx
        .insert(songVersions)
        .values({
          songId: newSong.id,
          versionNumber: 1,
          name: songDto.versionName ?? 'Partitura Escaneada (OMR)',
          description: songDto.versionDescription,
          sourceFormat: 'INTERNAL',
          canonicalPayload: canonicalJSON,
          totalMeasures: stats.totalMeasures,
          totalNotes: stats.totalNotes,
          totalChords: stats.totalChords,
          isCurrent: true,
          createdByUserId: userId,
        })
        .returning();

      if (!newVersion) {
        throw new Error('Fallo al insertar la versión inicial canónica.');
      }

      // 5. Actualizar versión actual en canción
      await tx
        .update(songs)
        .set({ currentVersionId: newVersion.id, updatedAt: new Date() })
        .where(eq(songs.id, newSong.id));

      // 6. Actualizar estado de la propuesta a COMMITTED
      await tx
        .update(omrProposals)
        .set({
          reviewStatus: 'COMMITTED',
          reviewedAt: new Date(),
          reviewedByUserId: userId,
        })
        .where(eq(omrProposals.id, proposalId));

      // 7. Registrar auditoría inmutable
      await tx.insert(omrAuditHistory).values({
        proposalId,
        userId,
        actionType: 'COMMIT_TO_SONG',
        newValue: {
          songId: newSong.id,
          versionId: newVersion.id,
          title: newSong.title,
        },
        reason: 'Compromiso atómico y consistente al catálogo canónico.',
      });

      return {
        song: newSong as any,
        version: newVersion as any,
      };
    });
  }

  /**
   * Intenta eliminar una propuesta.
   * Si existen registros en omr_audit_history, PostgreSQL rechazará la eliminación
   * debido a la restricción ON DELETE RESTRICT (R3).
   */
  public async deleteProposal(proposalId: string): Promise<boolean> {
    const deleted = await this.db
      .delete(omrProposals)
      .where(eq(omrProposals.id, proposalId))
      .returning({ id: omrProposals.id });

    return deleted.length > 0;
  }
}
