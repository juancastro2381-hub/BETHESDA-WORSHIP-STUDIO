/**
 * @file omr-proposal-repository.ts
 * @description Repositorio persistente en PostgreSQL con Drizzle ORM para propuestas OMR,
 * compases discretos y auditoría de decisiones humanas (Fase 1A).
 */

import { eq, desc, asc } from 'drizzle-orm';
import { db as defaultDb, type Database } from '../db/index.ts';
import {
  omrProposals,
  omrProposalMeasures,
  omrAuditHistory,
  type OmrProposalRow,
  type OmrProposalMeasureRow,
  type OmrAuditHistoryRow,
} from '../db/schema.ts';
import type {
  OmrProposal,
  OmrMeasureProposal,
  OmrReviewStatus,
  OmrAuditEntry,
  OmrActionType,
} from '../domain/omr/types.ts';

export interface IOmrProposalRepository {
  saveProposal(proposal: OmrProposal): Promise<OmrProposal>;
  findProposalById(proposalId: string): Promise<OmrProposal | null>;
  updateProposalStatus(
    proposalId: string,
    status: OmrReviewStatus,
    reviewedByUserId?: string
  ): Promise<void>;
  updateMeasure(proposalId: string, measure: OmrMeasureProposal): Promise<void>;
  recordAudit(entry: OmrAuditEntry): Promise<void>;
  getAuditHistory(proposalId: string): Promise<OmrAuditEntry[]>;
}

export class DrizzleOmrProposalRepository implements IOmrProposalRepository {
  public constructor(private readonly db: Database = defaultDb) {}

  public async saveProposal(proposal: OmrProposal): Promise<OmrProposal> {
    await this.db.transaction(async (tx) => {
      // 1. Insertar propuesta principal
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

      // 2. Insertar compases reconocidos
      if (proposal.measures && proposal.measures.length > 0) {
        for (const m of proposal.measures) {
          await tx
            .insert(omrProposalMeasures)
            .values({
              proposalId: proposal.proposalId,
              measureNumber: m.measureNumber,
              timeSignature: m.timeSignature ?? proposal.detectedTimeSignature ?? '4/4',
              keySignature: m.keySignature ?? proposal.detectedKey ?? null,
              chordsDetected: m.chordsDetected ?? [],
              notesDetected: m.notesDetected ?? [],
              lyricsDetected: m.lyricsDetected ?? [],
              measureConfidence: m.measureConfidence ?? 0,
              flags: m.flags ?? [],
            })
            .onConflictDoUpdate({
              target: [omrProposalMeasures.proposalId, omrProposalMeasures.measureNumber],
              set: {
                timeSignature: m.timeSignature ?? proposal.detectedTimeSignature ?? '4/4',
                keySignature: m.keySignature ?? proposal.detectedKey ?? null,
                chordsDetected: m.chordsDetected ?? [],
                notesDetected: m.notesDetected ?? [],
                lyricsDetected: m.lyricsDetected ?? [],
                measureConfidence: m.measureConfidence ?? 0,
                flags: m.flags ?? [],
              },
            });
        }
      }

      // 3. Registrar auditoría de creación si es nueva propuesta
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

  public async findProposalById(proposalId: string): Promise<OmrProposal | null> {
    const [row] = await this.db
      .select()
      .from(omrProposals)
      .where(eq(omrProposals.id, proposalId))
      .limit(1);

    if (!row) {
      return null;
    }

    const measuresRows = await this.db
      .select()
      .from(omrProposalMeasures)
      .where(eq(omrProposalMeasures.proposalId, proposalId))
      .orderBy(asc(omrProposalMeasures.measureNumber));

    const measures: OmrMeasureProposal[] = measuresRows.map((m) => ({
      measureNumber: m.measureNumber,
      timeSignature: m.timeSignature,
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

  public async updateMeasure(
    proposalId: string,
    measure: OmrMeasureProposal
  ): Promise<void> {
    await this.db
      .insert(omrProposalMeasures)
      .values({
        proposalId,
        measureNumber: measure.measureNumber,
        timeSignature: measure.timeSignature ?? '4/4',
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
          timeSignature: measure.timeSignature ?? '4/4',
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

  public async getAuditHistory(proposalId: string): Promise<OmrAuditEntry[]> {
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
}

