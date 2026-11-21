/**
 * @file musical-content-completion-service.ts
 * @description Orquestador de completitud de información musical y habilitación inteligente
 * de formatos del Atril Digital (PARTITURE, CHORDS_WITH_LYRICS, LYRICS_ONLY, TABLATURE).
 *
 * Invariantes:
 * 1. CERO fabricación: nunca inventa notas melódicas, letras, ritmos ni digitaciones.
 * 2. Preservación canónica: las propuestas se almacenan en `omr_proposals` y la fuente original
 *    en `song_sources` + almacenamiento físico con SHA-256 antes de cualquier aprobación.
 * 3. Versionado no destructivo: aprobar crea `song_versions` v(N+1) conservando v1..vN intactas.
 * 4. El backend es la fuente autoritativa de disponibilidad de formatos y aprobación RBAC.
 */

import crypto from 'node:crypto';
import { and, desc, eq, sql } from 'drizzle-orm';
import { db as defaultDb, type Database } from '../db/index.ts';
import {
  omrProposals,
  songs,
  songSources,
  songVersions,
} from '../db/schema.ts';
import {
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '../domain/errors.ts';
import type { AuthenticatedUser } from '../domain/auth-types.ts';
import { CanonicalDeserializer, CanonicalSerializer } from '../domain/canonical-serializer.ts';
import {
  LocalFileSystemSourceStorageProvider,
  type ISourceStorageProvider,
} from '../domain/ingestion/source-storage-provider.ts';
import { MidiIngestionAdapter } from '../domain/ingestion/adapters/midi/midi-adapter.ts';
import { MidiParser } from '../domain/ingestion/adapters/midi/midi-parser.ts';
import { WrittenNotesIngestionAdapter } from '../domain/ingestion/adapters/written-notes/written-notes-adapter.ts';
import type { WrittenNotesPayload } from '../domain/ingestion/types.ts';
import { MAX_OMR_FILE_SIZE_BYTES } from '../domain/omr/types.ts';
import {
  DrizzleAuditLogRepository,
  type IAuditLogRepository,
} from '../repositories/audit-repository.ts';
import {
  DrizzleSongRepository,
  type ISongRepository,
} from '../repositories/song-repository.ts';
import {
  DrizzleSongVersionRepository,
  type ISongVersionRepository,
} from '../repositories/version-repository.ts';
import { CanonicalMusicPayload, type CanonicalMusicPayloadJSON } from '../../../frontend/src/core/canonical-model/canonical-music-payload.ts';
import { ChordEvent } from '../../../frontend/src/core/canonical-model/chord-event.ts';
import { InstrumentTrack } from '../../../frontend/src/core/canonical-model/instrument-track.ts';
import { LyricSyllable } from '../../../frontend/src/core/canonical-model/lyric-syllable.ts';
import { Measure } from '../../../frontend/src/core/canonical-model/measure.ts';
import { Note, Rest, Voice } from '../../../frontend/src/core/canonical-model/musical-event.ts';
import { Section } from '../../../frontend/src/core/canonical-model/section.ts';
import { TimeSignature } from '../../../frontend/src/core/canonical-model/time-signature.ts';
import { Timeline } from '../../../frontend/src/core/canonical-model/timeline.ts';
import { UnifiedMusicImporter } from '../../../frontend/src/core/ingestion/unified-importer.ts';
import { InstrumentRegistry, type InstrumentProfile } from '../../../frontend/src/core/projection/instrument-profile.ts';
import {
  StandFormatCapabilityResolver,
  type SongContentSummary,
  type StandFormatCapabilityDescriptor,
  type StandReadingFormatId,
} from '../../../frontend/src/core/workspace/stand-format-capabilities.ts';

export type CompletionSourceKind =
  | 'MUSICXML'
  | 'MIDI'
  | 'CHORDPRO'
  | 'WRITTEN_NOTES'
  | 'LYRICS_TEXT'
  | 'TABLATURE_ASCII'
  | 'EXISTING_NOTES_FRET_OVERRIDE';

export interface LyricsCompletionInput {
  readonly lyricsText: string;
  readonly alignmentMode: 'BY_MEASURE' | 'BY_SECTION' | 'UNALIGNED';
  readonly measureAllocations?: ReadonlyArray<{
    readonly measureNumber: number;
    readonly text: string;
  }>;
  readonly sourceOrigin?: 'MANUAL_ENTRY' | 'TXT_IMPORT' | 'UNVERIFIED_AUDIO_SPEECH';
  readonly verifiedByHuman?: boolean;
}

export interface TablatureCompletionConfig {
  readonly instrumentId: string;
  readonly capoFret?: number;
  readonly fretOverrides?: ReadonlyArray<{
    readonly noteId: string;
    readonly stringNumber: number;
    readonly fret: number;
  }>;
  readonly tablatureVerified?: boolean;
}

export interface MusicalCompletionRequestInput {
  readonly targetFormat: StandReadingFormatId;
  readonly sourceKind: CompletionSourceKind;
  readonly instrumentId?: string;
  readonly filename?: string;
  readonly rawText?: string;
  readonly dataBase64?: string;
  readonly writtenNotes?: WrittenNotesPayload;
  readonly lyricsData?: LyricsCompletionInput;
  readonly tablatureConfig?: TablatureCompletionConfig;
  readonly mergeMode?: 'MERGE_INTO_SONG' | 'REPLACE_DRAFT';
  readonly notes?: string;
}

export interface CompletionProposalSummaryDTO {
  readonly proposalId: string;
  readonly songId: string;
  readonly targetFormat: StandReadingFormatId;
  readonly sourceKind: CompletionSourceKind;
  readonly reviewStatus: 'DRAFT' | 'PENDING_REVIEW' | 'APPROVED_FOR_IMPORT' | 'REJECTED' | 'COMMITTED';
  readonly sourceFilename: string;
  readonly sourceHash: string;
  readonly createdAt: string;
  readonly reviewedAt: string | null;
  readonly notes: string | null;
  readonly capabilitiesPreview: Record<StandReadingFormatId, StandFormatCapabilityDescriptor>;
  readonly approvedVersionId?: string | null;
  readonly approvedVersionNumber?: number | null;
}

export interface SongFormatCapabilitiesResponse {
  readonly songId: string;
  readonly songStatus: 'DRAFT' | 'APPROVED' | 'ARCHIVED';
  readonly versionId: string;
  readonly versionNumber: number;
  readonly instrumentId: string;
  readonly capoFret: number;
  readonly contentSummary: SongContentSummary;
  readonly capabilities: Record<StandReadingFormatId, StandFormatCapabilityDescriptor>;
  readonly proposals: CompletionProposalSummaryDTO[];
}

export interface CompletionPreviewResponse {
  readonly songId: string;
  readonly targetFormat: StandReadingFormatId;
  readonly sourceKind: CompletionSourceKind;
  readonly valid: boolean;
  readonly validationErrors: readonly string[];
  readonly validationWarnings: readonly string[];
  readonly contentSummary: SongContentSummary;
  readonly capabilities: Record<StandReadingFormatId, StandFormatCapabilityDescriptor>;
  readonly candidateCanonicalPayload: CanonicalMusicPayloadJSON;
  readonly diagnostics: ReadonlyArray<{ code: string; severity: string; message: string }>;
}

const COMPLETION_PROPOSAL_TYPE = 'MUSICAL_CONTENT_COMPLETION_DRAFT';
const COMPLETION_IMPORTER_VERSION = 'completion-v1.0';

function parseStrictBase64(b64: string): Buffer {
  const cleaned = b64.trim();
  if (!cleaned || cleaned.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(cleaned)) {
    throw new ValidationError('El contenido binario Base64 suministrado está malformado.');
  }
  const buffer = Buffer.from(cleaned, 'base64');
  if (buffer.length === 0) {
    throw new ValidationError('El archivo binario decodificado está vacío.');
  }
  if (buffer.length > MAX_OMR_FILE_SIZE_BYTES) {
    throw new ValidationError(
      `El archivo binario (${(buffer.length / (1024 * 1024)).toFixed(2)} MiB) supera el límite máximo permitido de 15 MiB.`
    );
  }
  return buffer;
}

export class MusicalContentCompletionService {
  private readonly instrumentRegistry = new InstrumentRegistry();
  private readonly unifiedImporter = new UnifiedMusicImporter();
  private readonly midiAdapter = new MidiIngestionAdapter();
  private readonly writtenNotesAdapter = new WrittenNotesIngestionAdapter();

  public constructor(
    private readonly songRepo: ISongRepository = new DrizzleSongRepository(),
    private readonly versionRepo: ISongVersionRepository = new DrizzleSongVersionRepository(),
    private readonly sourceStorage: ISourceStorageProvider = new LocalFileSystemSourceStorageProvider(),
    private readonly auditRepo: IAuditLogRepository = new DrizzleAuditLogRepository(),
    private readonly db: Database = defaultDb
  ) {}

  public async getSongFormatCapabilities(
    songId: string,
    options?: {
      versionId?: string | undefined;
      instrumentId?: string | undefined;
      capoFret?: number | undefined;
    }
  ): Promise<SongFormatCapabilitiesResponse> {
    const songWithVersion = await this.songRepo.findWithCurrentVersion(songId);
    if (!songWithVersion) {
      throw new NotFoundError('Canción', songId);
    }

    let targetVersion = songWithVersion.version;
    if (options?.versionId) {
      const requestedVersion = await this.versionRepo.findById(options.versionId);
      if (!requestedVersion || requestedVersion.songId !== songId) {
        throw new NotFoundError('Versión de canción', options.versionId);
      }
      targetVersion = requestedVersion;
    }

    const canonical = CanonicalDeserializer.deserialize(targetVersion.canonicalPayload);
    const instrument = this.resolveInstrument(options?.instrumentId);
    const capoFret = Math.max(0, Math.min(12, options?.capoFret ?? 0));

    const proposals = await this.listCompletionProposalsForSong(songId);
    const pendingProposalFormats = Array.from(
      new Set(
        proposals
          .filter((p) => p.reviewStatus === 'PENDING_REVIEW' || p.reviewStatus === 'DRAFT')
          .map((p) => p.targetFormat)
      )
    );
    const rejectedProposalFormats = Array.from(
      new Set(
        proposals
          .filter((p) => p.reviewStatus === 'REJECTED')
          .map((p) => p.targetFormat)
      )
    );

    const meta = (canonical.metadata ?? {}) as Record<string, unknown>;
    const approvalMeta = Array.isArray(meta['approvedFormats'])
      ? {
          approvedFormats: meta['approvedFormats'] as string[],
          blockedFormats: Array.isArray(meta['blockedFormats'])
            ? (meta['blockedFormats'] as Array<{ format: string; reason: string }>)
            : [],
          approvalScope:
            typeof meta['approvalScope'] === 'string' ? meta['approvalScope'] : undefined,
        }
      : null;

    const capabilities = StandFormatCapabilityResolver.evaluateAll(canonical, instrument, {
      songStatus: songWithVersion.song.status,
      capoFret,
      pendingProposalFormats,
      rejectedProposalFormats,
      approvalMetadata: approvalMeta,
    });

    return {
      songId,
      songStatus: songWithVersion.song.status,
      versionId: targetVersion.id,
      versionNumber: targetVersion.versionNumber,
      instrumentId: instrument.id,
      capoFret,
      contentSummary: StandFormatCapabilityResolver.summarizeContent(canonical),
      capabilities,
      proposals,
    };
  }

  public async validatePreview(
    songId: string,
    input: MusicalCompletionRequestInput,
    user: AuthenticatedUser
  ): Promise<CompletionPreviewResponse> {
    const built = await this.buildAndValidateCompletionCandidate(songId, input, user);
    return {
      songId,
      targetFormat: input.targetFormat,
      sourceKind: input.sourceKind,
      valid: built.validationErrors.length === 0,
      validationErrors: built.validationErrors,
      validationWarnings: built.validationWarnings,
      contentSummary: built.contentSummary,
      capabilities: built.capabilities,
      candidateCanonicalPayload: CanonicalSerializer.serialize(built.candidatePayload),
      diagnostics: built.diagnostics,
    };
  }

  public async createCompletionProposal(
    songId: string,
    input: MusicalCompletionRequestInput,
    user: AuthenticatedUser
  ): Promise<CompletionProposalSummaryDTO> {
    if (!user?.id) {
      throw new ValidationError('Autenticación requerida para proponer contenido musical.');
    }

    const built = await this.buildAndValidateCompletionCandidate(songId, input, user);
    if (built.validationErrors.length > 0) {
      throw new ValidationError(built.validationErrors.join(' '), built.validationErrors);
    }

    // Preservar el archivo fuente original en disco antes de registrar la propuesta
    const saveResult = await this.sourceStorage.save(built.sourceFilename, built.rawBuffer);
    const sourceId = crypto.randomUUID();
    const proposalId = crypto.randomUUID();
    const serializedCandidate = CanonicalSerializer.serialize(built.candidatePayload);

    const sourceTypeForDb =
      input.sourceKind === 'MUSICXML'
        ? 'MUSIC_XML'
        : input.sourceKind === 'MIDI'
        ? 'MIDI'
        : input.sourceKind === 'CHORDPRO'
        ? 'CHORD_PRO'
        : input.sourceKind === 'TABLATURE_ASCII'
        ? 'TABLATURE'
        : input.sourceKind === 'LYRICS_TEXT'
        ? 'LYRICS_TEXT'
        : 'INTERNAL';

    const rawTextToPersist =
      input.sourceKind === 'MIDI'
        ? null
        : built.rawBuffer.toString('utf-8');

    const rawPayloadData = {
      proposalType: COMPLETION_PROPOSAL_TYPE,
      songId,
      baseVersionId: built.baseVersionId,
      targetFormat: input.targetFormat,
      sourceKind: input.sourceKind,
      instrumentId: built.instrument.id,
      capoFret: input.tablatureConfig?.capoFret ?? 0,
      sourceId,
      sourcePreservation: {
        storageKey: saveResult.storageKey,
        checksumSha256: saveResult.checksumSha256,
        fileSizeBytes: saveResult.fileSizeBytes,
        sourceType: sourceTypeForDb,
        filename: built.sourceFilename,
        mimeType: built.mimeType,
      },
      candidateCanonicalPayload: serializedCandidate,
      capabilitiesPreview: built.capabilities,
      validationWarnings: built.validationWarnings,
      notes: input.notes?.trim() || null,
      createdByUserId: user.id,
    };

    const meta = (built.candidatePayload.metadata ?? {}) as Record<string, unknown>;
    const [inserted] = await this.db.transaction(async (tx) => {
      await tx.insert(songSources).values({
        id: sourceId,
        songId,
        versionId: null,
        userId: user.id,
        sourceType: sourceTypeForDb,
        filename: built.sourceFilename,
        storagePath: saveResult.storageKey,
        mimeType: built.mimeType,
        fileSizeBytes: saveResult.fileSizeBytes,
        checksumSha256: saveResult.checksumSha256,
        rawContent: rawTextToPersist,
        importerName: 'MusicalContentCompletionService',
        importerVersion: COMPLETION_IMPORTER_VERSION,
      });

      return tx
        .insert(omrProposals)
        .values({
          id: proposalId,
          jobId: null,
          userId: user.id,
          sourceFilename: built.sourceFilename,
          sourceHash: saveResult.checksumSha256,
          detectedTitle: built.candidatePayload.title,
          detectedKey:
            typeof meta['key'] === 'string' ? meta['key'] : built.songDefaultKey,
          detectedBpm:
            typeof meta['bpm'] === 'number' ? meta['bpm'] : built.songDefaultBpm,
          detectedTimeSignature:
            typeof meta['timeSignature'] === 'string'
              ? meta['timeSignature']
              : built.songDefaultTimeSignature,
          overallConfidence: built.validationWarnings.length === 0 ? 1.0 : 0.75,
          isAiDraft: input.lyricsData?.sourceOrigin === 'UNVERIFIED_AUDIO_SPEECH',
          reviewStatus: 'PENDING_REVIEW',
          rawPayload: rawPayloadData,
          canonicalSongId: null, // Evitar colisión en idx_omr_proposals_canonical_song_id entre múltiples propuestas de una misma canción
        })
        .returning();
    });

    await this.auditRepo
      .create({
        eventType: 'SONG_COMPLETION_PROPOSAL_CREATED',
        userId: user.id,
        resource: proposalId,
        metadata: {
          proposalId,
          songId,
          targetFormat: input.targetFormat,
          sourceKind: input.sourceKind,
          sourceId,
          checksumSha256: saveResult.checksumSha256,
        },
      })
      .catch(() => {});

    return {
      proposalId: inserted!.id,
      songId,
      targetFormat: input.targetFormat,
      sourceKind: input.sourceKind,
      reviewStatus: inserted!.reviewStatus,
      sourceFilename: inserted!.sourceFilename,
      sourceHash: inserted!.sourceHash,
      createdAt: inserted!.createdAt.toISOString(),
      reviewedAt: null,
      notes: rawPayloadData.notes,
      capabilitiesPreview: built.capabilities,
      approvedVersionId: null,
      approvedVersionNumber: null,
    };
  }

  public async reviewProposal(
    songId: string,
    proposalId: string,
    decision: 'APPROVED' | 'REJECTED' | 'CORRECTION_REQUESTED',
    user: AuthenticatedUser,
    options?: {
      readonly notes?: string | undefined;
      readonly versionName?: string | undefined;
      readonly setAsCurrent?: boolean | undefined;
    }
  ): Promise<{
    proposal: CompletionProposalSummaryDTO;
    capabilitiesResponse: SongFormatCapabilitiesResponse;
  }> {
    if (!['WORSHIP_LEADER', 'ADMIN', 'SUPER_ADMIN'].includes(user.role ?? '')) {
      throw new ForbiddenError(
        'Solo un Director de Alabanza o Administrador puede aprobar, rechazar o publicar propuestas musicales al Atril Digital.'
      );
    }

    const [row] = await this.db
      .select()
      .from(omrProposals)
      .where(eq(omrProposals.id, proposalId))
      .limit(1);

    if (!row) {
      throw new NotFoundError('Propuesta de completitud musical', proposalId);
    }

    const raw = (row.rawPayload ?? {}) as Record<string, unknown>;
    if (raw['proposalType'] !== COMPLETION_PROPOSAL_TYPE || raw['songId'] !== songId) {
      throw new NotFoundError('Propuesta de completitud musical asociada a esta canción', proposalId);
    }

    if (row.reviewStatus === 'COMMITTED') {
      throw new ValidationError('Esta propuesta ya fue aprobada y publicada previamente.');
    }
    if (decision === 'APPROVED' && row.reviewStatus === 'REJECTED') {
      throw new ValidationError(
        'No se puede aprobar una propuesta previamente rechazada; cree una nueva propuesta revisada.'
      );
    }

    const targetFormat = raw['targetFormat'] as StandReadingFormatId;
    const sourceKind = raw['sourceKind'] as CompletionSourceKind;
    const instrumentId = String(raw['instrumentId'] ?? 'acoustic_guitar');
    const capoFret = Number(raw['capoFret'] ?? 0);

    if (decision === 'REJECTED' || decision === 'CORRECTION_REQUESTED') {
      const nextStatus = decision === 'REJECTED' ? 'REJECTED' : 'PENDING_REVIEW';
      const updatedRaw = {
        ...raw,
        reviewNotes: options?.notes?.trim() || null,
      };
      await this.db
        .update(omrProposals)
        .set({
          reviewStatus: nextStatus,
          reviewedAt: new Date(),
          reviewedByUserId: user.id,
          rawPayload: updatedRaw,
        })
        .where(eq(omrProposals.id, proposalId));

      await this.auditRepo
        .create({
          eventType:
            decision === 'REJECTED'
              ? 'SONG_COMPLETION_PROPOSAL_REJECTED'
              : 'SONG_COMPLETION_CORRECTION_REQUESTED',
          userId: user.id,
          resource: proposalId,
          metadata: {
            proposalId,
            songId,
            targetFormat,
            notes: options?.notes ?? null,
          },
        })
        .catch(() => {});

      const capRes = await this.getSongFormatCapabilities(songId, { instrumentId, capoFret });
      const summary = capRes.proposals.find((p) => p.proposalId === proposalId)!;
      return { proposal: summary, capabilitiesResponse: capRes };
    }

    // Decisión === 'APPROVED': Verificar estrictamente en backend antes de crear versión nueva v(N+1)
    const songWithVersion = await this.songRepo.findWithCurrentVersion(songId);
    if (!songWithVersion) {
      throw new NotFoundError('Canción', songId);
    }

    const candidateCanonical = CanonicalDeserializer.deserialize(raw['candidateCanonicalPayload']);
    const instrument = this.resolveInstrument(instrumentId);

    const existingMeta = (candidateCanonical.metadata ?? {}) as Record<string, unknown>;
    const normalizedMetadata: Record<string, unknown> = {
      ...existingMeta,
      approvalStatus: 'APPROVED',
      approvedByUserId: user.id,
      approvedAt: new Date().toISOString(),
      completionProposalId: proposalId,
      ...(targetFormat === 'LYRICS_ONLY' || targetFormat === 'CHORD_CHART'
        ? {
            lyricsVerifiedByHuman: true,
            ...(existingMeta['lyricsSource'] === 'UNVERIFIED_AUDIO_SPEECH'
              ? { lyricsSource: 'HUMAN_VERIFIED_FROM_TRANSCRIPT' }
              : {}),
            ...(existingMeta['lyricAlignmentStatus'] === 'ALIGNED_PENDING_REVIEW'
              ? { lyricAlignmentStatus: 'ALIGNED_VERIFIED' }
              : {}),
          }
        : {}),
      ...(targetFormat === 'TABLATURE' ? { tablatureVerified: true } : {}),
    };

    const approvedPayload = new CanonicalMusicPayload({
      version: candidateCanonical.version,
      title: candidateCanonical.title,
      timeline: candidateCanonical.timeline,
      sections: [...candidateCanonical.sections],
      measures: [...candidateCanonical.measures],
      instrumentTracks: [...candidateCanonical.instrumentTracks],
      metadata: normalizedMetadata,
    });

    const evalAfterReview = StandFormatCapabilityResolver.evaluateAll(approvedPayload, instrument, {
      songStatus: 'APPROVED',
      capoFret,
    });
    const targetDescriptor = evalAfterReview[targetFormat];
    if (!targetDescriptor.isAvailable || targetDescriptor.validationErrors.length > 0) {
      throw new ValidationError(
        `No se puede aprobar '${targetFormat}': ${targetDescriptor.blockingReason || targetDescriptor.validationErrors.join('; ')}`
      );
    }

    const serializedApproved = CanonicalSerializer.serialize(approvedPayload);
    const stats = CanonicalSerializer.extractStatistics(approvedPayload);
    const setAsCurrent = options?.setAsCurrent ?? true;
    const sourcePreservation = raw['sourcePreservation'] as Record<string, unknown> | undefined;
    const sourceId = typeof raw['sourceId'] === 'string' ? raw['sourceId'] : null;

    const dbSourceFormat =
      sourceKind === 'MUSICXML'
        ? 'MUSIC_XML'
        : sourceKind === 'MIDI'
        ? 'MIDI'
        : sourceKind === 'CHORDPRO'
        ? 'CHORD_PRO'
        : sourceKind === 'TABLATURE_ASCII'
        ? 'TABLATURE'
        : targetFormat === 'LYRICS_ONLY'
        ? 'LYRICS_ONLY'
        : 'INTERNAL';

    const txResult = await this.db.transaction(async (tx) => {
      const [latestVer] = await tx
        .select({ versionNumber: songVersions.versionNumber })
        .from(songVersions)
        .where(eq(songVersions.songId, songId))
        .orderBy(desc(songVersions.versionNumber))
        .limit(1);

      const nextVersionNumber = (latestVer?.versionNumber ?? 0) + 1;

      if (setAsCurrent) {
        await tx
          .update(songVersions)
          .set({ isCurrent: false })
          .where(eq(songVersions.songId, songId));
      }

      const versionName =
        options?.versionName?.trim() ||
        `Completitud ${targetDescriptor.label} (v${nextVersionNumber})`;
      const versionDescription =
        options?.notes?.trim() ||
        `Aprobado por revisión humana desde fuente "${String(sourcePreservation?.['filename'] ?? row.sourceFilename)}" (SHA-256: ${row.sourceHash.slice(0, 12)}...).`;

      const [createdVersion] = await tx
        .insert(songVersions)
        .values({
          songId,
          versionNumber: nextVersionNumber,
          name: versionName,
          description: versionDescription,
          sourceFormat: dbSourceFormat,
          canonicalPayload: serializedApproved,
          totalMeasures: stats.totalMeasures,
          totalNotes: stats.totalNotes,
          totalChords: stats.totalChords,
          isCurrent: setAsCurrent,
          createdByUserId: user.id,
        })
        .returning();

      if (!createdVersion) {
        throw new ValidationError('No se pudo crear la nueva versión aprobada.');
      }

      if (setAsCurrent) {
        await tx
          .update(songs)
          .set({
            currentVersionId: createdVersion.id,
            status: 'APPROVED',
            updatedByUserId: user.id,
            updatedAt: new Date(),
          })
          .where(eq(songs.id, songId));
      }

      if (sourceId) {
        await tx
          .update(songSources)
          .set({ versionId: createdVersion.id })
          .where(eq(songSources.id, sourceId));
      }

      const updatedRaw = {
        ...raw,
        candidateCanonicalPayload: serializedApproved,
        capabilitiesPreview: evalAfterReview,
        approvedVersionId: createdVersion.id,
        approvedVersionNumber: nextVersionNumber,
        reviewNotes: options?.notes?.trim() || null,
      };

      await tx
        .update(omrProposals)
        .set({
          reviewStatus: 'COMMITTED',
          reviewedAt: new Date(),
          reviewedByUserId: user.id,
          rawPayload: updatedRaw,
        })
        .where(eq(omrProposals.id, proposalId));

      return createdVersion;
    });

    await this.auditRepo
      .create({
        eventType: 'SONG_COMPLETION_PROPOSAL_APPROVED',
        userId: user.id,
        resource: proposalId,
        metadata: {
          proposalId,
          songId,
          targetFormat,
          approvedVersionId: txResult.id,
          approvedVersionNumber: txResult.versionNumber,
          sourceHash: row.sourceHash,
        },
      })
      .catch(() => {});

    const capRes = await this.getSongFormatCapabilities(songId, { instrumentId, capoFret });
    const summary = capRes.proposals.find((p) => p.proposalId === proposalId)!;
    return { proposal: summary, capabilitiesResponse: capRes };
  }

  public async listCompletionProposalsForSong(songId: string): Promise<CompletionProposalSummaryDTO[]> {
    const rows = await this.db
      .select()
      .from(omrProposals)
      .where(
        and(
          sql`${omrProposals.rawPayload}->>'proposalType' = ${COMPLETION_PROPOSAL_TYPE}`,
          sql`${omrProposals.rawPayload}->>'songId' = ${songId}`
        )
      )
      .orderBy(desc(omrProposals.createdAt));

    return rows.map((row) => {
      const raw = (row.rawPayload ?? {}) as Record<string, unknown>;
      return {
        proposalId: row.id,
        songId,
        targetFormat: (raw['targetFormat'] as StandReadingFormatId) ?? 'STAFF_NOTATION',
        sourceKind: (raw['sourceKind'] as CompletionSourceKind) ?? 'MUSICXML',
        reviewStatus: row.reviewStatus,
        sourceFilename: row.sourceFilename,
        sourceHash: row.sourceHash,
        createdAt: row.createdAt.toISOString(),
        reviewedAt: row.reviewedAt ? row.reviewedAt.toISOString() : null,
        notes: typeof raw['notes'] === 'string' ? raw['notes'] : null,
        capabilitiesPreview: (raw['capabilitiesPreview'] ?? {}) as Record<
          StandReadingFormatId,
          StandFormatCapabilityDescriptor
        >,
        approvedVersionId: typeof raw['approvedVersionId'] === 'string' ? raw['approvedVersionId'] : null,
        approvedVersionNumber:
          typeof raw['approvedVersionNumber'] === 'number' ? raw['approvedVersionNumber'] : null,
      };
    });
  }

  private resolveInstrument(instrumentId?: string): InstrumentProfile {
    if (instrumentId) {
      const found = this.instrumentRegistry.get(instrumentId);
      if (!found) {
        throw new ValidationError(`Perfil de instrumento no reconocido: '${instrumentId}'.`);
      }
      return found;
    }
    return this.instrumentRegistry.getOrThrow('acoustic_guitar');
  }

  private async buildAndValidateCompletionCandidate(
    songId: string,
    input: MusicalCompletionRequestInput,
    user: AuthenticatedUser
  ): Promise<{
    baseVersionId: string;
    songDefaultKey: string | null;
    songDefaultBpm: number | null;
    songDefaultTimeSignature: string | null;
    instrument: InstrumentProfile;
    sourceFilename: string;
    mimeType: string;
    rawBuffer: Buffer;
    candidatePayload: CanonicalMusicPayload;
    contentSummary: SongContentSummary;
    capabilities: Record<StandReadingFormatId, StandFormatCapabilityDescriptor>;
    validationErrors: string[];
    validationWarnings: string[];
    diagnostics: Array<{ code: string; severity: string; message: string }>;
  }> {
    const songWithVersion = await this.songRepo.findWithCurrentVersion(songId);
    if (!songWithVersion) {
      throw new NotFoundError('Canción', songId);
    }

    const baseCanonical = CanonicalDeserializer.deserialize(songWithVersion.version.canonicalPayload);
    const instrument = this.resolveInstrument(
      input.tablatureConfig?.instrumentId ?? input.instrumentId
    );
    const capoFret = Math.max(0, Math.min(12, input.tablatureConfig?.capoFret ?? 0));
    const mergeWithExisting =
      input.mergeMode !== 'REPLACE_DRAFT' && baseCanonical.measures.length > 0;

    let candidatePayload: CanonicalMusicPayload;
    let rawBuffer: Buffer;
    let sourceFilename = input.filename?.trim() || `${songWithVersion.song.title}_completion`;
    let mimeType = 'text/plain';
    const diagnostics: Array<{ code: string; severity: string; message: string }> = [];
    const customErrors: string[] = [];
    const customWarnings: string[] = [];

    if (input.sourceKind === 'MUSICXML') {
      const xmlText = this.extractUtf8Source(input, 'MusicXML');
      if (xmlText.length > 5 * 1024 * 1024) {
        throw new ValidationError('El contenido MusicXML supera el límite máximo permitido de 5 MiB.');
      }
      rawBuffer = Buffer.from(xmlText, 'utf-8');
      if (!sourceFilename.toLowerCase().endsWith('.xml') && !sourceFilename.toLowerCase().endsWith('.musicxml')) {
        sourceFilename += '.musicxml';
      }
      mimeType = 'application/vnd.recordare.musicxml+xml';

      const imp = this.unifiedImporter.getImporter('MUSIC_XML')!;
      if (!imp.canHandle(xmlText, sourceFilename)) {
        throw new ValidationError(
          'El archivo suministrado no tiene estructura válida de MusicXML (<score-partwise> o <score-timewise>).'
        );
      }
      const res = imp.import(xmlText, { sourceName: sourceFilename });
      diagnostics.push(...res.diagnostics.map((d) => ({ code: d.code, severity: d.severity, message: d.message })));
      if (res.status === 'FAILED' || !res.payload) {
        throw new ValidationError(
          `Error validando MusicXML: ${res.diagnostics.map((d) => d.message).join('; ')}`
        );
      }
      if (res.payload.getAllNotes().length === 0) {
        customErrors.push(
          'La partitura MusicXML importada no contiene eventos de notas melódicas reales (un cifrado de acordes no sustituye a una melodía).'
        );
      }
      candidatePayload = mergeWithExisting
        ? this.mergeImportedNotationIntoSong(baseCanonical, res.payload, 'IMPORTED')
        : this.tagCandidateMetadata(res.payload, 'IMPORTED');
    } else if (input.sourceKind === 'MIDI') {
      if (!input.dataBase64) {
        throw new ValidationError('Para importar MIDI debe suministrar dataBase64 válido.');
      }
      rawBuffer = parseStrictBase64(input.dataBase64);
      if (!sourceFilename.toLowerCase().endsWith('.mid') && !sourceFilename.toLowerCase().endsWith('.midi')) {
        sourceFilename += '.mid';
      }
      mimeType = 'audio/midi';
      if (!MidiParser.isMidiFile(rawBuffer)) {
        throw new ValidationError('El archivo no contiene cabecera binaria MIDI válida (MThd).');
      }
      const out = await this.midiAdapter.ingest(
        { sourceType: 'MIDI', filename: sourceFilename, buffer: rawBuffer, title: songWithVersion.song.title },
        user
      );
      diagnostics.push(...out.diagnostics);
      const importedMidi = CanonicalDeserializer.deserialize(out.canonicalPayload);
      if (importedMidi.getAllNotes().length === 0) {
        customErrors.push('El archivo MIDI no contiene eventos Note On utilizables para notación melódica.');
      }
      candidatePayload = mergeWithExisting
        ? this.mergeImportedNotationIntoSong(baseCanonical, importedMidi, 'IMPORTED')
        : this.tagCandidateMetadata(importedMidi, 'IMPORTED');
    } else if (input.sourceKind === 'WRITTEN_NOTES') {
      if (!input.writtenNotes) {
        throw new ValidationError('Debe suministrar medidas y notas estructuradas en writtenNotes.');
      }
      rawBuffer = Buffer.from(JSON.stringify(input.writtenNotes, null, 2), 'utf-8');
      sourceFilename = sourceFilename.endsWith('.json') ? sourceFilename : `${sourceFilename}_notes.json`;
      mimeType = 'application/json';

      const out = await this.writtenNotesAdapter.ingest(
        {
          sourceType: 'WRITTEN_NOTES',
          writtenNotes: input.writtenNotes,
          title: input.writtenNotes.title || songWithVersion.song.title,
        },
        user
      );
      diagnostics.push(...out.diagnostics);
      const importedNotes = CanonicalDeserializer.deserialize(out.canonicalPayload);
      if (importedNotes.getAllNotes().length === 0) {
        customErrors.push('Las medidas ingresadas no contienen notas melódicas (los silencios no habilitan Partitura).');
      }
      candidatePayload = mergeWithExisting
        ? this.mergeImportedNotationIntoSong(baseCanonical, importedNotes, 'MANUALLY_ENTERED')
        : this.tagCandidateMetadata(importedNotes, 'MANUALLY_ENTERED');
    } else if (input.sourceKind === 'CHORDPRO') {
      const choText = this.extractUtf8Source(input, 'ChordPro');
      rawBuffer = Buffer.from(choText, 'utf-8');
      if (!sourceFilename.toLowerCase().endsWith('.cho') && !sourceFilename.toLowerCase().endsWith('.chordpro')) {
        sourceFilename += '.cho';
      }
      mimeType = 'text/x-chordpro';

      const imp = this.unifiedImporter.getImporter('CHORD_PRO')!;
      const res = imp.import(choText, { sourceName: sourceFilename });
      diagnostics.push(...res.diagnostics.map((d) => ({ code: d.code, severity: d.severity, message: d.message })));
      if (res.status === 'FAILED' || !res.payload) {
        throw new ValidationError(
          `Error validando ChordPro: ${res.diagnostics.map((d) => d.message).join('; ')}`
        );
      }
      candidatePayload = mergeWithExisting
        ? this.mergeChordsAndLyricsPreservingEvidence(baseCanonical, res.payload)
        : this.tagCandidateMetadata(res.payload, 'IMPORTED');
    } else if (input.sourceKind === 'LYRICS_TEXT') {
      const lyricsText = input.lyricsData?.lyricsText ?? input.rawText ?? '';
      if (!lyricsText.trim()) {
        throw new ValidationError('El texto de la letra no puede estar vacío.');
      }
      if (lyricsText.length > 200_000) {
        throw new ValidationError('El texto de la letra excede el tamaño máximo permitido.');
      }
      if (lyricsText.includes('\u0000')) {
        throw new ValidationError('El archivo de letra contiene bytes nulos o contenido binario inválido.');
      }
      rawBuffer = Buffer.from(lyricsText, 'utf-8');
      if (!sourceFilename.toLowerCase().endsWith('.txt')) {
        sourceFilename += '.txt';
      }
      mimeType = 'text/plain; charset=utf-8';

      candidatePayload = this.applyLyricsCompletion(
        baseCanonical,
        songWithVersion.song.title,
        {
          lyricsText,
          alignmentMode: input.lyricsData?.alignmentMode ?? (input.targetFormat === 'LYRICS_ONLY' ? 'BY_MEASURE' : 'UNALIGNED'),
          measureAllocations: input.lyricsData?.measureAllocations,
          sourceOrigin: input.lyricsData?.sourceOrigin ?? 'MANUAL_ENTRY',
          verifiedByHuman: input.lyricsData?.verifiedByHuman ?? false,
        }
      );
    } else if (input.sourceKind === 'TABLATURE_ASCII') {
      const tabText = this.extractUtf8Source(input, 'Tablatura ASCII');
      rawBuffer = Buffer.from(tabText, 'utf-8');
      if (!sourceFilename.toLowerCase().endsWith('.tab')) {
        sourceFilename += '.tab';
      }
      mimeType = 'text/plain; charset=utf-8';

      const imp = this.unifiedImporter.getImporter('TABLATURE')!;
      if (!imp.canHandle(tabText, sourceFilename)) {
        throw new ValidationError('El contenido no coincide con el formato de tablatura ASCII soportado (p. ej. e|---2---3---|).');
      }
      const res = imp.import(tabText, { sourceName: sourceFilename });
      diagnostics.push(...res.diagnostics.map((d) => ({ code: d.code, severity: d.severity, message: d.message })));
      if (res.status === 'FAILED' || !res.payload) {
        throw new ValidationError(
          `Error validando Tablatura ASCII: ${res.diagnostics.map((d) => d.message).join('; ')}`
        );
      }
      candidatePayload = mergeWithExisting
        ? this.mergeImportedNotationIntoSong(baseCanonical, res.payload, 'IMPORTED')
        : this.tagCandidateMetadata(res.payload, 'IMPORTED');
    } else if (input.sourceKind === 'EXISTING_NOTES_FRET_OVERRIDE') {
      rawBuffer = Buffer.from(
        JSON.stringify(input.tablatureConfig ?? { instrumentId: instrument.id, capoFret }, null, 2),
        'utf-8'
      );
      sourceFilename = sourceFilename.endsWith('.json') ? sourceFilename : `${sourceFilename}_tab.json`;
      mimeType = 'application/json';
      if (baseCanonical.getAllNotes().length === 0) {
        customErrors.push(
          'Un símbolo de acorde por sí solo no determina una digitación única de tablatura. Se requieren eventos de notas verificadas.'
        );
      }
      candidatePayload = baseCanonical;
    } else {
      throw new ValidationError(`Origen de completitud no soportado: '${String(input.sourceKind)}'.`);
    }

    // Aplicar overrides explícitos de traste/cuerda y validar coherencia física con afinación
    if (input.tablatureConfig?.fretOverrides && input.tablatureConfig.fretOverrides.length > 0) {
      const overrideRes = this.applyValidatedTablatureOverrides(
        candidatePayload,
        instrument,
        capoFret,
        input.tablatureConfig.fretOverrides,
        Boolean(input.tablatureConfig.tablatureVerified)
      );
      candidatePayload = overrideRes.payload;
      customErrors.push(...overrideRes.errors);
    } else if (input.tablatureConfig?.tablatureVerified) {
      candidatePayload = new CanonicalMusicPayload({
        version: candidatePayload.version,
        title: candidatePayload.title,
        timeline: candidatePayload.timeline,
        sections: [...candidatePayload.sections],
        measures: [...candidatePayload.measures],
        instrumentTracks: [...candidatePayload.instrumentTracks],
        metadata: {
          ...(candidatePayload.metadata ?? {}),
          tablatureVerified: true,
        },
      });
    }

    const capabilities = StandFormatCapabilityResolver.evaluateAll(candidatePayload, instrument, {
      songStatus: 'DRAFT', // Previo a aprobación, la propuesta siempre requiere revisión/aprobación humana
      capoFret,
    });
    const targetCap = capabilities[input.targetFormat];

    const validationErrors = Array.from(
      new Set([
        ...customErrors,
        // No bloquear propuestas cuando el objetivo explícito es LYRICS_ONLY unaligned o PENDING_REVIEW de voz sin confirmar:
        ...(input.targetFormat === 'CHORD_CHART' &&
        input.lyricsData?.alignmentMode === 'UNALIGNED'
          ? []
          : input.targetFormat === 'LYRICS_ONLY' &&
            input.lyricsData?.sourceOrigin === 'UNVERIFIED_AUDIO_SPEECH' &&
            !input.lyricsData?.verifiedByHuman
          ? []
          : targetCap.validationErrors),
      ])
    );

    const validationWarnings = Array.from(
      new Set([
        ...customWarnings,
        ...targetCap.validationWarnings,
      ])
    );

    return {
      baseVersionId: songWithVersion.version.id,
      songDefaultKey: songWithVersion.song.defaultKey,
      songDefaultBpm: songWithVersion.song.defaultBpm,
      songDefaultTimeSignature: songWithVersion.song.timeSignature,
      instrument,
      sourceFilename,
      mimeType,
      rawBuffer,
      candidatePayload,
      contentSummary: StandFormatCapabilityResolver.summarizeContent(candidatePayload),
      capabilities,
      validationErrors,
      validationWarnings,
      diagnostics,
    };
  }

  private extractUtf8Source(input: MusicalCompletionRequestInput, formatLabel: string): string {
    if (input.rawText && input.rawText.trim().length > 0) {
      if (input.rawText.includes('\u0000')) {
        throw new ValidationError(`El contenido textual de ${formatLabel} contiene caracteres nulos inválidos.`);
      }
      return input.rawText;
    }
    if (input.dataBase64) {
      const buf = parseStrictBase64(input.dataBase64);
      if (buf.includes(0)) {
        throw new ValidationError(`El archivo suministrado como ${formatLabel} parece binario y no texto UTF-8 válido.`);
      }
      return buf.toString('utf-8');
    }
    throw new ValidationError(`Debe proporcionar rawText o dataBase64 para importar ${formatLabel}.`);
  }

  private tagCandidateMetadata(
    payload: CanonicalMusicPayload,
    evidenceStatus: 'IMPORTED' | 'MANUALLY_ENTERED'
  ): CanonicalMusicPayload {
    return new CanonicalMusicPayload({
      version: payload.version,
      title: payload.title,
      timeline: payload.timeline,
      sections: [...payload.sections],
      measures: [...payload.measures],
      instrumentTracks: [...payload.instrumentTracks],
      metadata: {
        ...(payload.metadata ?? {}),
        approvalStatus: 'DRAFT_REVIEW_REQUIRED',
        evidenceStatus,
        contentOrigin: evidenceStatus,
      },
    });
  }

  private mergeImportedNotationIntoSong(
    base: CanonicalMusicPayload,
    imported: CanonicalMusicPayload,
    evidenceStatus: 'IMPORTED' | 'MANUALLY_ENTERED'
  ): CanonicalMusicPayload {
    const importedTotalMeasures = imported.measures.length;
    const totalMeasures = Math.max(base.measures.length, importedTotalMeasures);
    const mergedMeasures: Measure[] = [];
    let runningTick: number | null = 0;
    let idSeq = 1;

    for (let i = 0; i < totalMeasures; i++) {
      const mNum = i + 1;
      const baseM = base.measures[i];
      const impM = imported.measures[i];
      const timeSig =
        baseM?.timeSignature ??
        impM?.timeSignature ??
        (i === 0 ? new TimeSignature(4, 4) : null);
      const keySig = baseM?.keySignature ?? impM?.keySignature ?? null;
      const durationTicks =
        baseM?.durationTicks ??
        impM?.durationTicks ??
        (timeSig ? timeSig.calculateMeasureDurationTicks() : 1920);
      const measureStartTick = runningTick;

      const newVoices: Voice[] = [];
      if (impM && impM.voices.length > 0 && durationTicks !== null) {
        const impStartBase = impM.startTick ?? 0;
        for (const v of impM.voices) {
          const adjustedEvents: Array<Note | Rest> = [];
          for (const ev of v.events) {
            let relTick: number | null = null;
            if (ev.startTick !== null) {
              relTick = Math.max(0, ev.startTick - impStartBase);
              if (relTick >= durationTicks) {
                relTick = Math.max(0, durationTicks - (ev.durationTicks ?? 120));
              }
            }
            const adjStart =
              measureStartTick !== null && relTick !== null ? measureStartTick + relTick : null;
            const safeDur =
              ev.durationTicks !== null && relTick !== null && relTick + ev.durationTicks > durationTicks
                ? Math.max(1, durationTicks - relTick)
                : ev.durationTicks;

            if (ev.isRest) {
              adjustedEvents.push(
                new Rest({
                  id: `cmp_rest_${mNum}_${idSeq++}`,
                  startTick: adjStart,
                  durationTicks: safeDur,
                  voice: v.id,
                  staff: ev.staff,
                })
              );
            } else {
              adjustedEvents.push(
                new Note({
                  id: `cmp_note_${mNum}_${idSeq++}`,
                  pitch: ev.pitch,
                  startTick: adjStart,
                  durationTicks: safeDur,
                  voice: v.id,
                  staff: ev.staff,
                  velocity: ev.velocity,
                  ...(ev.dynamic ? { dynamic: ev.dynamic } : {}),
                  articulations: [...ev.articulations],
                  tie: ev.tie,
                  stemDirection: ev.stemDirection,
                  ...(ev.notationMetadata ? { notationMetadata: { ...ev.notationMetadata } } : {}),
                })
              );
            }
          }
          newVoices.push(new Voice(v.id, adjustedEvents));
        }
      } else if (baseM && baseM.voices.length > 0) {
        newVoices.push(...baseM.voices);
      }

      // Preservar los acordes existentes del Audio Scope 1C intactos (con su evidenceStatus!)
      const preservedChords: ChordEvent[] = baseM
        ? [...baseM.chords]
        : impM
        ? impM.chords.map(
            (c, cIdx) =>
              new ChordEvent({
                id: `cmp_ch_${mNum}_${cIdx + 1}`,
                chord: c.chord,
                startTick:
                  measureStartTick !== null && c.startTick !== null && impM.startTick !== null
                    ? measureStartTick + Math.max(0, Math.min(durationTicks - 1, c.startTick - impM.startTick))
                    : null,
                measureNumber: mNum,
                voice: c.voice,
                ...(c.evidenceStatus ? { evidenceStatus: c.evidenceStatus } : {}),
                ...(c.confidence !== undefined ? { confidence: c.confidence } : {}),
                ...(c.alternativeSymbol !== undefined ? { alternativeSymbol: c.alternativeSymbol } : {}),
              })
          )
        : [];

      const preservedLyrics: LyricSyllable[] = baseM
        ? [...baseM.lyrics]
        : impM
        ? impM.lyrics.map(
            (l, lIdx) =>
              new LyricSyllable({
                id: `cmp_lyr_${mNum}_${lIdx + 1}`,
                text: l.text,
                isHyphenated: l.isHyphenated,
                boundNoteId: null,
                measureNumber: mNum,
                tickOffset:
                  l.tickOffset !== null
                    ? Math.max(0, Math.min(durationTicks - 1, l.tickOffset))
                    : null,
                sequenceNumber: l.sequenceNumber,
                chordAbove: l.chordAbove,
              })
          )
        : [];

      mergedMeasures.push(
        new Measure({
          number: mNum,
          timeSignature: baseM?.timeSignature ?? impM?.timeSignature ?? null,
          keySignature: keySig,
          startTick: measureStartTick,
          durationTicks,
          voices: newVoices,
          chords: preservedChords,
          lyrics: preservedLyrics,
        })
      );

      if (runningTick !== null && durationTicks !== null) {
        runningTick += durationTicks;
      } else {
        runningTick = null;
      }
    }

    const timeline = new Timeline({
      tpqn: base.timeline.tpqn,
      tempoMap:
        base.timeline.tempoMap.events.length > 0
          ? base.timeline.tempoMap
          : imported.timeline.tempoMap,
      measureCount: mergedMeasures.length,
      totalDurationTicks: runningTick ?? 0,
    });

    const tracks = [...base.instrumentTracks];
    for (const tr of imported.instrumentTracks) {
      if (!tracks.some((b) => b.id === tr.id)) {
        tracks.push(tr);
      }
    }

    return new CanonicalMusicPayload({
      version: base.version,
      title: base.title,
      timeline,
      sections: base.sections.length > 0 ? [...base.sections] : [...imported.sections],
      measures: mergedMeasures,
      instrumentTracks: tracks.length > 0 ? tracks : [new InstrumentTrack({ id: 'track_1', name: 'Melodía Principal', family: 'VOCALS', voiceIds: [1] })],
      metadata: {
        ...(base.metadata ?? {}),
        approvalStatus: 'DRAFT_REVIEW_REQUIRED',
        evidenceStatus,
        noteExtractionStatus: 'COMPLETED',
        partitureEvidenceStatus: evidenceStatus,
      },
    });
  }

  private mergeChordsAndLyricsPreservingEvidence(
    base: CanonicalMusicPayload,
    imported: CanonicalMusicPayload
  ): CanonicalMusicPayload {
    const totalMeasures = Math.max(base.measures.length, imported.measures.length);
    const mergedMeasures: Measure[] = [];
    let runningTick: number | null = 0;

    for (let i = 0; i < totalMeasures; i++) {
      const mNum = i + 1;
      const baseM = base.measures[i];
      const impM = imported.measures[i];
      const durationTicks = baseM?.durationTicks ?? impM?.durationTicks ?? 1920;
      const startTick = runningTick;

      const chords: ChordEvent[] = [];
      if (impM && impM.chords.length > 0) {
        impM.chords.forEach((c, idx) => {
          const prev = baseM?.chords[idx];
          const sameSymbol = prev && prev.chord.toString('STANDARD') === c.chord.toString('STANDARD');
          chords.push(
            new ChordEvent({
              id: `cho_ch_${mNum}_${idx + 1}`,
              chord: c.chord,
              startTick: startTick !== null ? startTick + Math.min(durationTicks - 1, idx * 480) : null,
              measureNumber: mNum,
              voice: c.voice,
              ...(sameSymbol && prev?.evidenceStatus
                ? {
                    evidenceStatus: prev.evidenceStatus,
                    confidence: prev.confidence,
                    alternativeSymbol: prev.alternativeSymbol ?? null,
                  }
                : { evidenceStatus: 'HUMAN_VERIFIED' as const }),
            })
          );
        });
      } else if (baseM) {
        chords.push(...baseM.chords);
      }

      const lyrics: LyricSyllable[] = [];
      if (impM && impM.lyrics.length > 0) {
        impM.lyrics.forEach((l, lIdx) => {
          lyrics.push(
            new LyricSyllable({
              id: `cho_lyr_${mNum}_${lIdx + 1}`,
              text: l.text,
              isHyphenated: l.isHyphenated,
              boundNoteId: null,
              measureNumber: mNum,
              tickOffset: Math.min(durationTicks - 1, l.tickOffset ?? lIdx * 120),
              sequenceNumber: l.sequenceNumber,
              chordAbove: l.chordAbove,
            })
          );
        });
      } else if (baseM) {
        lyrics.push(...baseM.lyrics);
      }

      mergedMeasures.push(
        new Measure({
          number: mNum,
          timeSignature: baseM?.timeSignature ?? impM?.timeSignature ?? null,
          keySignature: baseM?.keySignature ?? impM?.keySignature ?? null,
          startTick,
          durationTicks,
          voices: baseM ? [...baseM.voices] : [],
          chords,
          lyrics,
        })
      );

      if (runningTick !== null) runningTick += durationTicks;
    }

    const timeline = new Timeline({
      tpqn: base.timeline.tpqn,
      tempoMap:
        base.timeline.tempoMap.events.length > 0
          ? base.timeline.tempoMap
          : imported.timeline.tempoMap,
      measureCount: mergedMeasures.length,
      totalDurationTicks: runningTick ?? 0,
    });

    return new CanonicalMusicPayload({
      version: base.version,
      title: base.title,
      timeline,
      sections: base.sections.length > 0 ? [...base.sections] : [...imported.sections],
      measures: mergedMeasures,
      instrumentTracks: [...base.instrumentTracks],
      metadata: {
        ...(base.metadata ?? {}),
        approvalStatus: 'DRAFT_REVIEW_REQUIRED',
        lyricAlignmentStatus: 'ALIGNED_PENDING_REVIEW',
        unalignedLyrics: [],
      },
    });
  }

  private normalizeTextForComparison(text: string): string {
    return text
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  }

  private isNonLyricHeaderOrMetadataLine(line: string, normalizedTitle: string): boolean {
    const trimmed = line.trim();
    if (!trimmed) return true;
    if (/^[-_=*~]{3,}$/.test(trimmed)) return true;
    if (/^(tonalidad|comp[aá]s|tempo|bpm|key|time|meter|autor|compositor|artist|artista|ccli|fuente|source|copyright)\s*:/i.test(trimmed)) {
      return true;
    }
    if (
      /\|/.test(trimmed) &&
      /(tonalidad|comp[aá]s|tempo|bpm|key|time)/i.test(trimmed)
    ) {
      return true;
    }
    if (/^(canci[oó]n\s+original(\s+de\s+prueba)?|archivo\s+de\s+prueba|test\s+song)$/i.test(trimmed)) {
      return true;
    }
    const normLine = this.normalizeTextForComparison(trimmed);
    if (normalizedTitle && normLine === normalizedTitle) {
      return true;
    }
    return false;
  }

  private applyLyricsCompletion(
    base: CanonicalMusicPayload,
    fallbackTitle: string,
    lyricsInput: LyricsCompletionInput
  ): CanonicalMusicPayload {
    const rawLines = lyricsInput.lyricsText
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0);

    const normalizedTitle = this.normalizeTextForComparison(base.title || fallbackTitle);
    const sectionPattern = /^\[(.+)\]$/;
    const parsedEntries: Array<{ sectionLabel?: string; text: string }> = [];
    const strippedHeaderLines: string[] = [];
    let currentSection: string | undefined;
    let seenFirstSection = false;

    for (const line of rawLines) {
      const m = line.match(sectionPattern);
      if (m) {
        seenFirstSection = true;
        currentSection = m[1]!.trim();
      } else if (!seenFirstSection && this.isNonLyricHeaderOrMetadataLine(line, normalizedTitle)) {
        strippedHeaderLines.push(line);
      } else if (this.isNonLyricHeaderOrMetadataLine(line, '')) {
        strippedHeaderLines.push(line);
      } else {
        parsedEntries.push({ ...(currentSection ? { sectionLabel: currentSection } : {}), text: line });
      }
    }

    if (parsedEntries.length === 0) {
      throw new ValidationError(
        'El texto suministrado solo contiene encabezados o metadatos, pero no contiene versos ni letra real.'
      );
    }

    const lyricsLines = parsedEntries.map((e) => e.text);
    const metaBase: Record<string, unknown> = {
      ...(base.metadata ?? {}),
      approvalStatus: 'DRAFT_REVIEW_REQUIRED',
      lyricsSource: lyricsInput.sourceOrigin ?? 'MANUAL_ENTRY',
      lyricsVerifiedByHuman: Boolean(lyricsInput.verifiedByHuman),
      ...(strippedHeaderLines.length > 0 ? { lyricsHeaderMetadata: strippedHeaderLines } : {}),
    };

    // Si las letras se ingresaron SIN alineación explícita a compases de acordes: preservar en metadata sin fabricar alineación
    if (lyricsInput.alignmentMode === 'UNALIGNED') {
      return new CanonicalMusicPayload({
        version: base.version,
        title: base.title || fallbackTitle,
        timeline: base.timeline,
        sections: [...base.sections],
        measures: [...base.measures],
        instrumentTracks: [...base.instrumentTracks],
        metadata: {
          ...metaBase,
          unalignedLyrics: lyricsLines,
          lyricAlignmentStatus: 'UNALIGNED',
        },
      });
    }

    // Modo alineado por compás (explícito via measureAllocations, por sección coincidente o secuencial)
    const allocationMap = new Map<number, string>();
    if (lyricsInput.measureAllocations && lyricsInput.measureAllocations.length > 0) {
      for (const alloc of lyricsInput.measureAllocations) {
        if (alloc.text.trim()) {
          allocationMap.set(alloc.measureNumber, alloc.text.trim());
        }
      }
    } else if (base.sections.length > 0 && parsedEntries.some((e) => e.sectionLabel)) {
      // Alinear líneas dentro de sus secciones correspondientes en la canción existente
      const sectionLineCounters = new Map<string, number>();
      let fallbackMeasure = 1;
      for (const entry of parsedEntries) {
        const lbl = entry.sectionLabel ? this.normalizeTextForComparison(entry.sectionLabel) : '';
        const matchedSection = lbl
          ? base.sections.find((s) => this.normalizeTextForComparison(s.label) === lbl) ??
            base.sections.find((s) => this.normalizeTextForComparison(s.label).includes(lbl))
          : undefined;

        if (matchedSection) {
          const offset = sectionLineCounters.get(matchedSection.id) ?? 0;
          const targetMeasure = matchedSection.startMeasure + offset;
          if (targetMeasure <= matchedSection.startMeasure + matchedSection.measureCount - 1) {
            allocationMap.set(targetMeasure, entry.text);
          } else {
            // Si hay más líneas que compases en la sección, concatenar en el último compás de la sección
            const lastM = matchedSection.startMeasure + matchedSection.measureCount - 1;
            const prev = allocationMap.get(lastM);
            allocationMap.set(lastM, prev ? `${prev} / ${entry.text}` : entry.text);
          }
          sectionLineCounters.set(matchedSection.id, offset + 1);
          fallbackMeasure = Math.max(fallbackMeasure, targetMeasure + 1);
        } else {
          allocationMap.set(fallbackMeasure++, entry.text);
        }
      }
    } else {
      lyricsLines.forEach((line, idx) => {
        allocationMap.set(idx + 1, line);
      });
    }

    const maxAllocMeasure = Math.max(0, ...Array.from(allocationMap.keys()));
    const totalMeasures = Math.max(base.measures.length, maxAllocMeasure);
    const updatedMeasures: Measure[] = [];
    let runningTick = 0;
    let sylSeq = 1;

    for (let i = 0; i < totalMeasures; i++) {
      const mNum = i + 1;
      const baseM = base.measures[i];
      const durationTicks = baseM?.durationTicks ?? 1920;
      const startTick = runningTick;
      const lineText = allocationMap.get(mNum);
      const newLyrics: LyricSyllable[] = [];

      if (lineText) {
        const words = lineText.split(/\s+/).filter(Boolean);
        for (let w = 0; w < words.length; w++) {
          const tickOffset = Math.min(
            durationTicks - 1,
            Math.round((w / Math.max(1, words.length)) * Math.max(1, durationTicks - 120))
          );
          const chordAbove =
            w === 0 && baseM?.chords[0]
              ? baseM.chords[0].chord
              : undefined;
          newLyrics.push(
            new LyricSyllable({
              id: `cmp_lyr_${mNum}_${sylSeq}`,
              text: words[w]!,
              measureNumber: mNum,
              tickOffset,
              sequenceNumber: sylSeq++,
              isHyphenated: false,
              ...(chordAbove ? { chordAbove } : {}),
            })
          );
        }
      }

      updatedMeasures.push(
        new Measure({
          number: mNum,
          timeSignature: baseM?.timeSignature ?? (i === 0 ? new TimeSignature(4, 4) : null),
          keySignature: baseM?.keySignature ?? null,
          startTick,
          durationTicks,
          voices: baseM ? [...baseM.voices] : [],
          chords: baseM ? [...baseM.chords] : [],
          lyrics: newLyrics,
        })
      );

      runningTick += durationTicks;
    }

    // Construir secciones a partir de etiquetas [Verso]/[Coro] solo si base no tenía secciones
    const sectionsToUse: Section[] = [...base.sections];
    if (sectionsToUse.length === 0 && parsedEntries.some((e) => e.sectionLabel)) {
      let curLabel: string | null = null;
      let startMeasure = 1;
      for (let idx = 0; idx < parsedEntries.length; idx++) {
        const entry = parsedEntries[idx]!;
        const mNum = idx + 1;
        const lbl = entry.sectionLabel ?? 'Verso';
        if (curLabel === null) {
          curLabel = lbl;
          startMeasure = mNum;
        } else if (lbl !== curLabel) {
          const count = mNum - startMeasure;
          if (count > 0 && mNum - 1 <= updatedMeasures.length) {
            sectionsToUse.push(
              new Section({
                id: `cmp_sec_${sectionsToUse.length + 1}`,
                type: curLabel.toLowerCase().includes('coro') ? 'CHORUS' : 'VERSE',
                label: curLabel,
                startMeasure,
                measureCount: count,
                startTick: (startMeasure - 1) * 1920,
                durationTicks: count * 1920,
              })
            );
          }
          curLabel = lbl;
          startMeasure = mNum;
        }
      }
      if (curLabel !== null && updatedMeasures.length >= startMeasure) {
        const count = updatedMeasures.length - startMeasure + 1;
        sectionsToUse.push(
          new Section({
            id: `cmp_sec_${sectionsToUse.length + 1}`,
            type: curLabel.toLowerCase().includes('coro') ? 'CHORUS' : 'VERSE',
            label: curLabel,
            startMeasure,
            measureCount: count,
            startTick: (startMeasure - 1) * 1920,
            durationTicks: count * 1920,
          })
        );
      }
    }

    const timeline = new Timeline({
      tpqn: base.timeline.tpqn,
      tempoMap: base.timeline.tempoMap,
      measureCount: updatedMeasures.length,
      totalDurationTicks: runningTick,
    });

    return new CanonicalMusicPayload({
      version: base.version,
      title: base.title || fallbackTitle,
      timeline,
      sections: sectionsToUse,
      measures: updatedMeasures,
      instrumentTracks: [...base.instrumentTracks],
      metadata: {
        ...metaBase,
        unalignedLyrics: [],
        lyricAlignmentStatus: 'ALIGNED_PENDING_REVIEW',
      },
    });
  }

  private applyValidatedTablatureOverrides(
    payload: CanonicalMusicPayload,
    instrument: InstrumentProfile,
    capoFret: number,
    overrides: ReadonlyArray<{ readonly noteId: string; readonly stringNumber: number; readonly fret: number }>,
    tablatureVerified: boolean
  ): { payload: CanonicalMusicPayload; errors: string[] } {
    const tuning = instrument.tuning;
    const errors: string[] = [];
    if (!tuning) {
      return {
        payload,
        errors: [`El instrumento '${instrument.name}' no posee afinación de cuerdas para asignar posiciones de tablatura.`],
      };
    }

    const overrideMap = new Map<string, { stringNumber: number; fret: number }>();
    const matchedIds = new Set<string>();
    for (const ov of overrides) {
      overrideMap.set(ov.noteId, { stringNumber: ov.stringNumber, fret: ov.fret });
    }

    const updatedMeasures = payload.measures.map((m) => {
      const updatedVoices = m.voices.map((v) => {
        const updatedEvents = v.events.map((ev) => {
          if (ev.isRest) return ev;
          const ov = overrideMap.get(ev.id);
          if (!ov) return ev;
          matchedIds.add(ev.id);

          if (
            !Number.isInteger(ov.stringNumber) ||
            ov.stringNumber < 1 ||
            ov.stringNumber > tuning.stringPitches.length
          ) {
            errors.push(
              `Cuerda ${ov.stringNumber} inválida para nota ${ev.id} en ${tuning.name} (${tuning.stringPitches.length} cuerdas).`
            );
            return ev;
          }
          if (!Number.isInteger(ov.fret) || ov.fret < 0 || ov.fret > 24) {
            errors.push(`Traste ${ov.fret} fuera del rango permitido (0–24) en nota ${ev.id}.`);
            return ev;
          }

          const openPitch = tuning.stringPitches[ov.stringNumber - 1]!;
          const producedMidi = openPitch.midiNumber + capoFret + ov.fret;
          if (producedMidi !== ev.pitch.midiNumber) {
            errors.push(
              `Posición físicamente inconsistente en nota ${ev.id}: Cuerda ${ov.stringNumber} Traste ${ov.fret} (capo ${capoFret}) produce MIDI ${producedMidi}, pero la nota canónica es ${ev.pitch.toString()} (MIDI ${ev.pitch.midiNumber}).`
            );
            return ev;
          }

          return new Note({
            id: ev.id,
            pitch: ev.pitch,
            startTick: ev.startTick,
            durationTicks: ev.durationTicks,
            voice: ev.voice,
            staff: ev.staff,
            velocity: ev.velocity,
            ...(ev.dynamic ? { dynamic: ev.dynamic } : {}),
            articulations: [...ev.articulations],
            tie: ev.tie,
            stemDirection: ev.stemDirection,
            notationMetadata: {
              ...(ev.notationMetadata ?? {}),
              tablature: {
                stringNumber: ov.stringNumber,
                fret: ov.fret,
                tuningName: tuning.name,
                capoFret,
                isHumanOverride: true,
              },
            },
          });
        });
        return new Voice(v.id, updatedEvents);
      });

      return new Measure({
        number: m.number,
        timeSignature: m.timeSignature,
        keySignature: m.keySignature,
        startTick: m.startTick,
        durationTicks: m.durationTicks,
        voices: updatedVoices,
        chords: [...m.chords],
        lyrics: [...m.lyrics],
      });
    });

    for (const ov of overrides) {
      if (!matchedIds.has(ov.noteId)) {
        errors.push(`No se encontró la nota '${ov.noteId}' para asignar posición de tablatura.`);
      }
    }

    const nextPayload = new CanonicalMusicPayload({
      version: payload.version,
      title: payload.title,
      timeline: payload.timeline,
      sections: [...payload.sections],
      measures: updatedMeasures,
      instrumentTracks: [...payload.instrumentTracks],
      metadata: {
        ...(payload.metadata ?? {}),
        ...(tablatureVerified ? { tablatureVerified: true } : {}),
      },
    });

    return { payload: nextPayload, errors };
  }
}
