/**
 * @file omr-proposal-repository.ts
 * @description Repositorio relacional PostgreSQL para Propuestas OMR, Compases e Historial Inmutable de Auditoría (Fase 1A, 1A-R, 1A-R2 & 1A-R3).
 *
 * Principios Mandatorios de Seguridad, Integridad y Arquitectura (R3-01 a R3-07):
 * 1. Identidad de usuario autenticada obligatoria (AuthenticatedUser) en todas las operaciones protegidas (R3-01).
 *    CERO defaults fabricados, CERO asignaciones implícitas de rol, y CERO confianza ciega en IDs pasados como strings sueltos.
 * 2. Inmutabilidad estricta de auditoría: omr_audit_history es append-only a nivel de motor PostgreSQL (R3-02).
 * 3. Integridad referencial reforzada (ON DELETE RESTRICT): un registro de canción canónica generado nunca puede disolver silenciosamente su referencia (R3-05).
 * 4. Transacciones atómicas reales y bloqueo de concurrencia exclusivo (SELECT ... FOR UPDATE) (R3-06).
 * 5. CERO mutación ni eliminación sobre registros históricos de auditoría.
 */

import { eq, and, asc, desc, sql } from 'drizzle-orm';
import { db as defaultDb, type Database } from '../db/index.ts';
import {
  omrProposals,
  omrProposalMeasures,
  omrAuditHistory,
  songs,
  songVersions,
} from '../db/schema.ts';
import type {
  OmrProposal,
  OmrMeasureProposal,
  OmrAuditEntry,
  CreateOmrAuditEntryInput,
  OmrReviewStatus,
  OmrActionType,
  AuthenticatedUser,
} from '../domain/omr/types.ts';
import type { CreateSongDTO } from '../domain/types.ts';
import type { SongWithVersion } from './song-repository.ts';
import { CanonicalDeserializer } from '../domain/canonical-serializer.ts';
import { CanonicalSerializer } from '../domain/canonical-serializer.ts';
import {
  NotFoundError,
  ForbiddenError,
  ValidationError,
  UnauthorizedError,
  ConflictError,
} from '../domain/errors.ts';

export interface IOmrProposalRepository {
  saveProposal(proposal: OmrProposal, requestingUser: AuthenticatedUser): Promise<OmrProposal>;
  findProposalById(
    proposalId: string,
    requestingUser: AuthenticatedUser
  ): Promise<OmrProposal | null>;
  updateProposalStatusAndAudit(
    proposalId: string,
    status: OmrReviewStatus,
    requestingUser: AuthenticatedUser,
    notes?: string
  ): Promise<void>;
  updateMeasure(
    proposalId: string,
    measure: Partial<OmrMeasureProposal> & { measureNumber: number },
    requestingUser: AuthenticatedUser
  ): Promise<OmrMeasureProposal>;
  recordAudit(
    entry: CreateOmrAuditEntryInput,
    requestingUser: AuthenticatedUser
  ): Promise<void>;
  getAuditHistory(
    proposalId: string,
    requestingUser: AuthenticatedUser
  ): Promise<OmrAuditEntry[]>;
  commitProposalTransaction(
    proposalId: string,
    requestingUser: AuthenticatedUser,
    songDto: CreateSongDTO,
    title: string
  ): Promise<SongWithVersion>;
  deleteProposal(
    proposalId: string,
    requestingUser: AuthenticatedUser
  ): Promise<boolean>;
}

function assertRepoAuthenticatedUser(user: unknown): asserts user is AuthenticatedUser {
  if (
    !user ||
    typeof user !== 'object' ||
    typeof (user as any).id !== 'string' ||
    !(user as any).id.trim() ||
    typeof (user as any).role !== 'string' ||
    !(user as any).role.trim()
  ) {
    throw new UnauthorizedError('Identidad de usuario autenticada requerida.');
  }
  const VALID_ROLES = ['ADMIN', 'SUPER_ADMIN', 'WORSHIP_LEADER', 'MUSICIAN'];
  if (!VALID_ROLES.includes((user as any).role)) {
    throw new ForbiddenError(`Rol de usuario '${(user as any).role}' no reconocido o no autorizado.`);
  }
}

export class DrizzleOmrProposalRepository implements IOmrProposalRepository {
  public constructor(private readonly db: Database = defaultDb) {}

  public async saveProposal(
    proposal: OmrProposal,
    requestingUser: AuthenticatedUser
  ): Promise<OmrProposal> {
    assertRepoAuthenticatedUser(requestingUser);

    proposal.userId = requestingUser.id;

    await this.db.transaction(async (tx) => {
      // 1. Insertar propuesta principal (Durable write)
      await tx
        .insert(omrProposals)
        .values({
          id: proposal.proposalId,
          jobId: proposal.jobId ?? null,
          userId: requestingUser.id,
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

      // 3. Registrar auditoría inmutable de creación (R3-02)
      await tx.insert(omrAuditHistory).values({
        proposalId: proposal.proposalId,
        userId: requestingUser.id,
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
    requestingUser: AuthenticatedUser
  ): Promise<OmrProposal | null> {
    assertRepoAuthenticatedUser(requestingUser);

    const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (!UUID_REGEX.test(proposalId)) {
      return null;
    }

    const [row] = await this.db
      .select()
      .from(omrProposals)
      .where(eq(omrProposals.id, proposalId))
      .limit(1);

    if (!row) {
      return null;
    }

    // Aislamiento de usuario y verificación estricta de propiedad (R3-01):
    if (!['ADMIN', 'SUPER_ADMIN'].includes(requestingUser.role)) {
      if (!row.userId) {
        throw new ForbiddenError(
          'Acceso denegado: la propuesta carece de propietario asignado y requiere privilegios de administrador.'
        );
      }
      if (row.userId !== requestingUser.id) {
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
      canonicalSongId: row.canonicalSongId ?? undefined,
    };
  }

  public async updateProposalStatusAndAudit(
    proposalId: string,
    status: OmrReviewStatus,
    requestingUser: AuthenticatedUser,
    notes?: string
  ): Promise<void> {
    assertRepoAuthenticatedUser(requestingUser);

    if (!['WORSHIP_LEADER', 'ADMIN', 'SUPER_ADMIN'].includes(requestingUser.role)) {
      throw new ForbiddenError('No tiene autorización para revisar propuestas OMR.');
    }

    const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (!UUID_REGEX.test(proposalId)) {
      throw new NotFoundError('Propuesta OMR', proposalId);
    }

    const now = new Date();
    await this.db.transaction(async (tx) => {
      // Row lock para concurrencia segura
      const [proposal] = await tx
        .select()
        .from(omrProposals)
        .where(eq(omrProposals.id, proposalId))
        .for('update')
        .limit(1);

      if (!proposal) {
        throw new NotFoundError('Propuesta OMR', proposalId);
      }

      if (!['ADMIN', 'SUPER_ADMIN'].includes(requestingUser.role)) {
        if (!proposal.userId) {
          throw new ForbiddenError(
            'Acceso denegado: la propuesta carece de propietario asignado y requiere privilegios de administrador.'
          );
        }
        if (proposal.userId !== requestingUser.id) {
          throw new ForbiddenError('No tiene autorización para revisar una propuesta de otro usuario.');
        }
      }

      await tx
        .update(omrProposals)
        .set({
          reviewStatus: status,
          reviewedAt: now,
          reviewedByUserId: requestingUser.id,
        })
        .where(eq(omrProposals.id, proposalId));

      await tx.insert(omrAuditHistory).values({
        proposalId,
        userId: requestingUser.id,
        actionType: status === 'APPROVED_FOR_IMPORT' ? 'APPROVE_PROPOSAL' : 'REJECT_PROPOSAL',
        newValue: { status },
        reason: notes ?? `Revisión humana: estado actualizado a ${status}`,
      });
    });
  }

  public async updateMeasure(
    proposalId: string,
    measure: Partial<OmrMeasureProposal> & { measureNumber: number },
    requestingUser: AuthenticatedUser
  ): Promise<OmrMeasureProposal> {
    assertRepoAuthenticatedUser(requestingUser);

    const proposal = await this.findProposalById(proposalId, requestingUser);
    if (!proposal) {
      throw new NotFoundError('Propuesta OMR', proposalId);
    }

    if (requestingUser.role !== 'ADMIN' && proposal.userId !== requestingUser.id) {
      throw new ForbiddenError('No tiene autorización para modificar compases de una propuesta de otro usuario.');
    }

    if (!['WORSHIP_LEADER', 'ADMIN', 'SUPER_ADMIN'].includes(requestingUser.role)) {
      throw new ForbiddenError('No tiene autorización para modificar compases de la propuesta OMR.');
    }

    let mergedResult: OmrMeasureProposal;

    await this.db.transaction(async (tx) => {
      // 1. Cargar el compás existente desde la base de datos
      const [existingRow] = await tx
        .select()
        .from(omrProposalMeasures)
        .where(
          and(
            eq(omrProposalMeasures.proposalId, proposalId),
            eq(omrProposalMeasures.measureNumber, measure.measureNumber)
          )
        );

      if (!existingRow) {
        throw new NotFoundError(
          `Compás ${measure.measureNumber} de la propuesta OMR`,
          proposalId
        );
      }

      // 2. Semántica PATCH segura (R3.2-04):
      // Los campos omitidos conservan sus valores persistidos previos.
      // Los campos provistos explícitamente se actualizan.
      // La confianza no se incrementa a 1 por omisión.
      const previousValue = {
        measureNumber: existingRow.measureNumber,
        timeSignature: existingRow.timeSignature ?? undefined,
        keySignature: existingRow.keySignature ?? undefined,
        chordsDetected: (existingRow.chordsDetected as any[]) ?? [],
        notesDetected: (existingRow.notesDetected as any[]) ?? [],
        lyricsDetected: (existingRow.lyricsDetected as any[]) ?? [],
        measureConfidence: Number(existingRow.measureConfidence ?? 0),
        flags: (existingRow.flags as string[]) ?? [],
      };

      const mergedTimeSignature =
        measure.timeSignature !== undefined
          ? measure.timeSignature
          : existingRow.timeSignature;
      const mergedKeySignature =
        measure.keySignature !== undefined
          ? measure.keySignature
          : existingRow.keySignature;
      const mergedChords =
        measure.chordsDetected !== undefined
          ? measure.chordsDetected
          : ((existingRow.chordsDetected as any[]) ?? []);
      const mergedNotes =
        measure.notesDetected !== undefined
          ? measure.notesDetected
          : ((existingRow.notesDetected as any[]) ?? []);
      const mergedLyrics =
        measure.lyricsDetected !== undefined
          ? measure.lyricsDetected
          : ((existingRow.lyricsDetected as any[]) ?? []);
      const mergedConfidence =
        measure.measureConfidence !== undefined
          ? measure.measureConfidence
          : Number(existingRow.measureConfidence ?? 0);
      const mergedFlags =
        measure.flags !== undefined
          ? measure.flags
          : ((existingRow.flags as string[]) ?? []);

      mergedResult = {
        measureNumber: measure.measureNumber,
        timeSignature: mergedTimeSignature ?? undefined,
        keySignature: mergedKeySignature ?? undefined,
        chordsDetected: mergedChords,
        notesDetected: mergedNotes,
        lyricsDetected: mergedLyrics,
        measureConfidence: mergedConfidence,
        flags: mergedFlags,
      };

      // 3. Persistir compás fusionado
      await tx
        .update(omrProposalMeasures)
        .set({
          timeSignature: mergedTimeSignature ?? null,
          keySignature: mergedKeySignature ?? null,
          chordsDetected: mergedChords,
          notesDetected: mergedNotes,
          lyricsDetected: mergedLyrics,
          measureConfidence: mergedConfidence,
          flags: mergedFlags,
        })
        .where(
          and(
            eq(omrProposalMeasures.proposalId, proposalId),
            eq(omrProposalMeasures.measureNumber, measure.measureNumber)
          )
        );

      // 4. Registrar auditoría con valores previo y nuevo completos
      await tx.insert(omrAuditHistory).values({
        proposalId,
        userId: requestingUser.id,
        actionType: 'UPDATE_MEASURE',
        targetMeasure: measure.measureNumber,
        previousValue,
        newValue: mergedResult,
        reason: 'Modificación parcial de compás (PATCH) por usuario autorizado',
      });
    });

    return mergedResult!;
  }

  public async recordAudit(
    entry: CreateOmrAuditEntryInput,
    requestingUser: AuthenticatedUser
  ): Promise<void> {
    assertRepoAuthenticatedUser(requestingUser);

    // Prevención estricta de falsificación de actor (R3.2-01):
    // El campo userId está prohibido en CreateOmrAuditEntryInput. Si un llamador
    // lo suministra en tiempo de ejecución, se rechaza inmediatamente sin importar su valor.
    if ('userId' in (entry as unknown as Record<string, unknown>) && (entry as any).userId !== undefined) {
      throw new ForbiddenError(
        'Violación de seguridad: El campo userId está estrictamente prohibido en el DTO de auditoría. La identidad del actor se deriva exclusivamente del principal autenticado.'
      );
    }

    const proposal = await this.findProposalById(entry.proposalId, requestingUser);
    if (!proposal) {
      throw new NotFoundError('Propuesta OMR', entry.proposalId);
    }

    if (requestingUser.role !== 'ADMIN' && proposal.userId !== requestingUser.id) {
      throw new ForbiddenError(
        'No tiene autorización para registrar auditoría en una propuesta de otro usuario.'
      );
    }

    await this.db.insert(omrAuditHistory).values({
      proposalId: entry.proposalId,
      userId: requestingUser.id,
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
    requestingUser: AuthenticatedUser
  ): Promise<OmrAuditEntry[]> {
    assertRepoAuthenticatedUser(requestingUser);

    const proposal = await this.findProposalById(proposalId, requestingUser);
    if (!proposal) {
      throw new NotFoundError('Propuesta OMR', proposalId);
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
   * Ejecuta el compromiso canónico en una ÚNICA transacción atómica en PostgreSQL (R3-05 & R3-06).
   * Inserta la canción, su versión, actualiza el estado de la propuesta y registra la auditoría.
   * Si cualquiera de los pasos falla, TODO el lote se revierte automáticamente sin estados parciales.
   */
  public async commitProposalTransaction(
    proposalId: string,
    requestingUser: AuthenticatedUser,
    songDto: CreateSongDTO,
    title: string
  ): Promise<SongWithVersion> {
    assertRepoAuthenticatedUser(requestingUser);

    if (!['WORSHIP_LEADER', 'ADMIN', 'SUPER_ADMIN'].includes(requestingUser.role)) {
      throw new ForbiddenError('No tiene autorización para comprometer propuestas OMR al catálogo canónico.');
    }

    const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (!UUID_REGEX.test(proposalId)) {
      throw new NotFoundError('Propuesta OMR', proposalId);
    }

    // Validación preventiva de metadatos musicales en el DTO (R2-02 / R3-03)
    if (songDto.defaultKey !== undefined && (!songDto.defaultKey || !songDto.defaultKey.trim())) {
      throw new ValidationError('La tonalidad musical (defaultKey) es obligatoria y no puede fabricarse.');
    }
    if (songDto.defaultBpm !== undefined && (!songDto.defaultBpm || songDto.defaultBpm <= 0)) {
      throw new ValidationError(
        'El tempo (defaultBpm) es obligatorio y debe ser un valor numérico positivo sin valores por defecto fabricados.'
      );
    }
    if (songDto.timeSignature !== undefined && (!songDto.timeSignature || !songDto.timeSignature.trim())) {
      throw new ValidationError('La métrica de compás (timeSignature) es obligatoria y no puede fabricarse.');
    }

    return await this.db.transaction(async (tx) => {
      // 1. Bloqueo de fila exclusivo (SELECT ... FOR UPDATE) para prevenir carreras de concurrencia (R2-06)
      const [proposal] = await tx
        .select()
        .from(omrProposals)
        .where(eq(omrProposals.id, proposalId))
        .for('update')
        .limit(1);

      if (!proposal) {
        throw new NotFoundError('Propuesta OMR', proposalId);
      }

      // 2. Verificación estricta de propiedad y aislamiento de usuario (R3-01)
      if (!['ADMIN', 'SUPER_ADMIN'].includes(requestingUser.role)) {
        if (!proposal.userId) {
          throw new ForbiddenError(
            'Acceso denegado: la propuesta carece de propietario asignado y requiere privilegios de administrador.'
          );
        }
        if (proposal.userId !== requestingUser.id) {
          throw new ForbiddenError('No tiene autorización para comprometer una propuesta perteneciente a otro usuario.');
        }
      }

      // 3. Garantía de idempotencia bajo concurrencia y preservación histórica (R3-05)
      if (proposal.reviewStatus === 'COMMITTED') {
        if (!proposal.canonicalSongId) {
          throw new ConflictError(
            `Inconsistencia crítica de datos: la propuesta ${proposalId} tiene estado COMMITTED pero canonical_song_id es nulo.`
          );
        }
        const [existingSong] = await tx
          .select()
          .from(songs)
          .where(eq(songs.id, proposal.canonicalSongId))
          .limit(1);

        if (!existingSong) {
          throw new ConflictError(
            `Inconsistencia crítica de datos: la canción canónica ${proposal.canonicalSongId} vinculada a la propuesta ${proposalId} no existe en la base de datos.`
          );
        }

        if (!existingSong.currentVersionId) {
          throw new ConflictError(
            `Inconsistencia crítica de datos: la canción canónica ${proposal.canonicalSongId} carece de versión activa.`
          );
        }

        const [existingVersion] = await tx
          .select()
          .from(songVersions)
          .where(eq(songVersions.id, existingSong.currentVersionId))
          .limit(1);

        if (!existingVersion) {
          throw new ConflictError(
            `Inconsistencia crítica de datos: la versión ${existingSong.currentVersionId} de la canción ${existingSong.id} no fue encontrada.`
          );
        }

        return {
          song: existingSong as any,
          version: existingVersion as any,
        };
      }

      if (proposal.reviewStatus !== 'APPROVED_FOR_IMPORT') {
        throw new ValidationError(
          `La propuesta OMR debe estar en estado APPROVED_FOR_IMPORT para comprometerse al catálogo (estado actual: ${proposal.reviewStatus}).`
        );
      }

      // 4. Eliminación de CUALQUIER default musical fabricado a nivel de persistencia canónica (R2-02)
      if (!songDto.defaultKey || !songDto.defaultKey.trim()) {
        throw new ValidationError('La tonalidad musical (defaultKey) es obligatoria y no puede fabricarse.');
      }
      if (!songDto.defaultBpm || songDto.defaultBpm <= 0) {
        throw new ValidationError(
          'El tempo (defaultBpm) es obligatorio y debe ser un valor numérico positivo sin valores por defecto fabricados.'
        );
      }
      if (!songDto.timeSignature || !songDto.timeSignature.trim()) {
        throw new ValidationError('La métrica de compás (timeSignature) es obligatoria y no puede fabricarse.');
      }

      // 5. Extraer y validar el payload canónico
      const deserializedPayload = CanonicalDeserializer.deserialize(songDto.canonicalPayload);
      const canonicalJSON = CanonicalSerializer.serialize(deserializedPayload);
      const stats = CanonicalSerializer.extractStatistics(deserializedPayload);

      // 6. Insertar canción maestra sin fallbacks
      const [newSong] = await tx
        .insert(songs)
        .values({
          title: title.trim(),
          artist: songDto.artist ? songDto.artist.trim() : null,
          ccliNumber: songDto.ccliNumber ? songDto.ccliNumber.trim() : null,
          defaultKey: songDto.defaultKey.trim(),
          defaultBpm: songDto.defaultBpm,
          timeSignature: songDto.timeSignature.trim(),
          status: 'APPROVED',
          createdByUserId: requestingUser.id,
        })
        .returning();

      if (!newSong) {
        throw new Error('Fallo al insertar el registro de canción canónica.');
      }

      // 7. Insertar versión inicial
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
          createdByUserId: requestingUser.id,
        })
        .returning();

      if (!newVersion) {
        throw new Error('Fallo al insertar la versión inicial canónica.');
      }

      // 8. Actualizar versión actual en canción
      await tx
        .update(songs)
        .set({ currentVersionId: newVersion.id, updatedAt: new Date() })
        .where(eq(songs.id, newSong.id));

      // 9. Actualizar estado de la propuesta a COMMITTED con referencia canónica protegida (R3-05)
      await tx
        .update(omrProposals)
        .set({
          reviewStatus: 'COMMITTED',
          canonicalSongId: newSong.id,
          reviewedAt: new Date(),
          reviewedByUserId: requestingUser.id,
        })
        .where(eq(omrProposals.id, proposalId));

      // 10. Registrar auditoría inmutable atómica de compromiso canónico (R3-02 & R3-06)
      await tx.insert(omrAuditHistory).values({
        proposalId,
        userId: requestingUser.id,
        actionType: 'COMMIT_TO_SONG',
        newValue: {
          canonicalSongId: newSong.id,
          title: newSong.title,
          key: newSong.defaultKey,
          bpm: newSong.defaultBpm,
          timeSignature: newSong.timeSignature,
        },
        reason: `Propuesta OMR aprobada y comprometida al catálogo canónico por usuario autorizado (${requestingUser.id})`,
      });

      return {
        song: newSong as any,
        version: newVersion as any,
      };
    });
  }

  public async deleteProposal(
    proposalId: string,
    requestingUser: AuthenticatedUser
  ): Promise<boolean> {
    assertRepoAuthenticatedUser(requestingUser);

    if (!['ADMIN', 'SUPER_ADMIN'].includes(requestingUser.role)) {
      throw new ForbiddenError('Solo administradores pueden eliminar propuestas OMR.');
    }

    try {
      const deleted = await this.db
        .delete(omrProposals)
        .where(eq(omrProposals.id, proposalId))
        .returning({ id: omrProposals.id });

      return deleted.length > 0;
    } catch (err: any) {
      if (
        err?.code === '23503' ||
        err?.cause?.code === '23503' ||
        String(err?.message || err).includes('23503') ||
        String(err?.message || err).includes('violates foreign key constraint') ||
        String(err?.message || err).includes('violates RESTRICT')
      ) {
        throw new ValidationError(
          'No se puede eliminar la propuesta OMR porque contiene registros históricos de auditoría inmutables.'
        );
      }
      throw err;
    }
  }
}
