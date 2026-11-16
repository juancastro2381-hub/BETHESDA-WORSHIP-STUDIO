/**
 * @file audio-transcription-service.ts
 * @description Orquestador de Análisis Acústico (WS-AUDIO-02), Transcripción Musical (WS-AUDIO-03),
 * Revisión Humana Obligatoria y Publicación Protegida al Catálogo Canónico / Atril Digital (Scope 1C).
 *
 * Invariantes de Gobernanza (Secciones 5, 6, 7, 8, 9 y 10):
 * 1. CERO Fabricación: Nunca inventa acordes, BPM, tonalidad, métrica, notas melódicas, letra ni digitaciones de tablatura.
 * 2. MIDI y Tablatura se generan ÚNICAMENTE cuando existen eventos de notas verificados con timing y confianza suficientes.
 * 3. Todo resultado derivado de audio nace estrictamente como borrador (DRAFT_READY / REVIEW_REQUIRED, isAiDraft: true).
 * 4. Protección Canónica Absoluta: Las canciones y versiones canónicas existentes jamás se sobrescriben automáticamente.
 * 5. Toda aprobación humana registra identidad del revisor, marca de tiempo, ID del activo de audio, versión de análisis/transcripción,
 *    versión aprobada creada en song_versions y cambios realizados durante la revisión.
 */

import crypto from 'node:crypto';
import { and, desc, eq } from 'drizzle-orm';
import { db as defaultDb, type Database } from '../db/index.ts';
import {
  audioAssets,
  backgroundJobs,
  omrProposalMeasures,
  omrProposals,
  songs,
  songSources,
  songVersions,
  type AudioAsset,
} from '../db/schema.ts';
import { ForbiddenError, NotFoundError, ValidationError } from '../domain/errors.ts';
import type { AuthenticatedUser } from '../domain/auth-types.ts';
import { DrizzleAuditLogRepository, type IAuditLogRepository } from '../repositories/audit-repository.ts';
import { type IAudioStorageProvider } from '../domain/audio/storage-provider.ts';
import {
  PythonAudioWorkerBridge,
  globalPythonAudioWorkerBridge,
  type PythonWorkerAnalysisResult,
  type PythonWorkerTargetEvaluation,
} from '../infrastructure/python-worker/python-audio-worker-bridge.ts';
import { CanonicalSerializer, CanonicalDeserializer } from '../domain/canonical-serializer.ts';
import { CanonicalMusicPayload, type CanonicalMusicPayloadJSON } from '../../../frontend/src/core/canonical-model/canonical-music-payload.ts';
import { Measure } from '../../../frontend/src/core/canonical-model/measure.ts';
import { Section } from '../../../frontend/src/core/canonical-model/section.ts';
import { Timeline } from '../../../frontend/src/core/canonical-model/timeline.ts';
import { TempoEvent, TempoMap } from '../../../frontend/src/core/canonical-model/tempo-map.ts';
import { TimeSignature } from '../../../frontend/src/core/canonical-model/time-signature.ts';
import { KeySignatureReference } from '../../../frontend/src/core/canonical-model/key-signature-reference.ts';
import { ChordEvent, type ChordEvidenceStatus } from '../../../frontend/src/core/canonical-model/chord-event.ts';
import { Note, Rest, Voice } from '../../../frontend/src/core/canonical-model/musical-event.ts';
import { LyricSyllable } from '../../../frontend/src/core/canonical-model/lyric-syllable.ts';
import { InstrumentTrack } from '../../../frontend/src/core/canonical-model/instrument-track.ts';
import { CANONICAL_TPQN } from '../../../frontend/src/core/canonical-model/types.ts';
import { MidiExportGatekeeper } from '../../../frontend/src/core/canonical-model/midi-export-gatekeeper.ts';
import { Chord } from '../../../frontend/src/core/music-theory/chord.ts';
import { MusicalKey } from '../../../frontend/src/core/music-theory/musical-key.ts';
import { NoteName, type BaseNoteLetter } from '../../../frontend/src/core/music-theory/note-name.ts';
import { Accidental } from '../../../frontend/src/core/music-theory/accidental.ts';
import { Pitch } from '../../../frontend/src/core/music-theory/pitch.ts';
import { UnifiedMusicImporter } from '../../../frontend/src/core/ingestion/unified-importer.ts';
import {
  CanonicalToChordProSerializer,
  CanonicalToLyricsSerializer,
  CanonicalToMidiSerializer,
  CanonicalToMusicXmlSerializer,
  CanonicalToTablatureSerializer,
} from '../../../frontend/src/core/conversion/exporters/index.ts';

export type AudioConversionWorkflowState =
  | 'AUDIO_PRESERVED'
  | 'ANALYSIS_QUEUED'
  | 'ANALYSIS_RUNNING'
  | 'ANALYSIS_COMPLETED'
  | 'ANALYSIS_PARTIAL'
  | 'TRANSCRIPTION_RUNNING'
  | 'DRAFT_READY'
  | 'REVIEW_REQUIRED'
  | 'APPROVED'
  | 'REJECTED'
  | 'FAILED';

export type SupportedReviewInstrument = 'GUITAR' | 'BASS' | 'PIANO' | 'VOCAL';

export type ApprovalTargetFormat = 'CHORD_PRO' | 'MUSIC_XML' | 'MIDI' | 'TABLATURE' | 'LYRICS_ONLY';

export interface HarmonicEvidenceBreakdown {
  readonly totalChords: number;
  readonly detectedCount: number;
  readonly estimatedCount: number;
  readonly ambiguousCount: number;
  readonly humanVerifiedCount: number;
  readonly melodicNotesCount: number;
}

export interface BlockedFormatRecord {
  readonly format: ApprovalTargetFormat;
  readonly status: 'NOT_GENERATABLE' | 'EXCLUDED_BY_REVIEWER';
  readonly reason: string;
}

export interface GeneratedTargetArtifact {
  readonly format: ApprovalTargetFormat;
  readonly status: 'DRAFT_READY' | 'REVIEW_REQUIRED' | 'NOT_GENERATABLE';
  readonly generatable: boolean;
  readonly confidence: number;
  readonly reason: string;
  readonly filename: string;
  readonly mimeType: string;
  readonly isBinary: boolean;
  /** Contenido textual (ChordPro, MusicXML, Tablatura, Letra) o Base64 (MIDI) cuando generatable === true */
  readonly content: string | null;
  readonly instrument?: SupportedReviewInstrument;
}

export interface AudioDraftReviewChangeRecord {
  readonly changedAt: string;
  readonly changedByUserId: string;
  readonly summary: string;
  readonly fieldsModified: string[];
}

export interface AudioDraftApprovalMetadata {
  readonly approvedByUserId: string;
  readonly approvedAt: string;
  readonly sourceAudioAssetId: string;
  readonly sourceAudioSha256: string;
  readonly analysisVersion: string;
  readonly transcriptionVersion: string;
  readonly targetSongId: string;
  readonly approvedSongVersionId: string;
  readonly approvedVersionNumber: number;
  readonly setAsCurrent: boolean;
  readonly reviewNotes?: string | undefined;
  readonly changesMadeDuringReview: AudioDraftReviewChangeRecord[];
  readonly approvedFormats?: ApprovalTargetFormat[] | undefined;
  readonly blockedFormats?: BlockedFormatRecord[] | undefined;
  readonly approvalScope?: 'HARMONIC_LEAD_SHEET_ONLY' | 'MELODIC_AND_HARMONIC' | undefined;
  readonly harmonicEvidenceSummary?: HarmonicEvidenceBreakdown | undefined;
}

export interface AudioDraftProposalDTO {
  readonly proposalId: string;
  readonly jobId: string | null;
  readonly audioAssetId: string;
  readonly songId: string;
  readonly songTitle: string;
  readonly sourceFilename: string;
  readonly sourceSha256: string;
  readonly workflowState: AudioConversionWorkflowState;
  readonly reviewStatus: 'DRAFT' | 'PENDING_REVIEW' | 'APPROVED_FOR_IMPORT' | 'REJECTED' | 'COMMITTED';
  readonly isAiDraft: boolean;
  readonly analysisVersion: string;
  readonly transcriptionVersion: string;
  readonly title: string;
  readonly detectedKey: string | null;
  readonly detectedBpm: number | null;
  readonly detectedTimeSignature: string | null;
  readonly overallConfidence: number;
  readonly selectedInstrument: SupportedReviewInstrument;
  readonly verifiedLyrics: string;
  readonly proposedChordPro: string;
  readonly proposedCanonicalPayload: CanonicalMusicPayloadJSON;
  readonly analysisSummary: PythonWorkerAnalysisResult;
  readonly targets: Record<string, GeneratedTargetArtifact>;
  readonly changesMadeDuringReview: AudioDraftReviewChangeRecord[];
  readonly approvalMetadata: AudioDraftApprovalMetadata | null;
  readonly harmonicEvidenceSummary?: HarmonicEvidenceBreakdown | undefined;
  readonly createdAt: string;
  readonly reviewedAt: string | null;
  readonly reviewedByUserId: string | null;
}

export interface AnalyzeAndTranscribeOptions {
  readonly verifiedLyrics?: string | undefined;
  readonly selectedInstrument?: SupportedReviewInstrument | undefined;
  readonly titleOverride?: string | undefined;
  readonly keyOverride?: string | undefined;
  readonly bpmOverride?: number | undefined;
  readonly timeSignatureOverride?: string | undefined;
}

export interface UpdateAudioDraftInput {
  readonly title?: string | undefined;
  readonly key?: string | undefined;
  readonly bpm?: number | undefined;
  readonly timeSignature?: string | undefined;
  readonly proposedChordPro?: string | undefined;
  readonly verifiedLyrics?: string | undefined;
  readonly selectedInstrument?: SupportedReviewInstrument | undefined;
  readonly reason?: string | undefined;
}

export interface ApproveAudioDraftInput {
  readonly targetSongId?: string | undefined;
  readonly versionName?: string | undefined;
  readonly versionDescription?: string | undefined;
  readonly setAsCurrent?: boolean | undefined;
  readonly reviewNotes?: string | undefined;
  readonly approvedFormats?: ApprovalTargetFormat[] | undefined;
}

const LEGACY_UTF8_REPLACEMENTS: ReadonlyArray<readonly [RegExp, string]> = [
  [/Grabaci\uFFFDn/g, 'Grabación'],
  [/grabaci\uFFFDn/g, 'grabación'],
  [/Fabricaci\uFFFDn/g, 'Fabricación'],
  [/fabricaci\uFFFDn/g, 'fabricación'],
  [/Extracci\uFFFDn/g, 'Extracción'],
  [/extracci\uFFFDn/g, 'extracción'],
  [/Polif\uFFFDnic([ao]s?)/g, 'Polifónic$1'],
  [/polif\uFFFDnic([ao]s?)/g, 'polifónic$1'],
  [/Polifon\uFFFDa/g, 'Polifonía'],
  [/polifon\uFFFDa/g, 'polifonía'],
  [/Monof\uFFFDnic([ao]s?)/g, 'Monofónic$1'],
  [/monof\uFFFDnic([ao]s?)/g, 'monofónic$1'],
  [/Arm\uFFFDnic([ao]s?)/g, 'Armónic$1'],
  [/arm\uFFFDnic([ao]s?)/g, 'armónic$1'],
  [/Mel\uFFFDdic([ao]s?)/g, 'Melódic$1'],
  [/mel\uFFFDdic([ao]s?)/g, 'melódic$1'],
  [/Revisi\uFFFDn/g, 'Revisión'],
  [/revisi\uFFFDn/g, 'revisión'],
  [/Ac\uFFFDstic([ao]s?)/g, 'Acústic$1'],
  [/ac\uFFFDstic([ao]s?)/g, 'acústic$1'],
  [/L\uFFFDric([ao]s?)/g, 'Líric$1'],
  [/l\uFFFDric([ao]s?)/g, 'líric$1'],
  [/Transcripci\uFFFDn/g, 'Transcripción'],
  [/transcripci\uFFFDn/g, 'transcripción'],
  [/Progresi\uFFFDn/g, 'Progresión'],
  [/progresi\uFFFDn/g, 'progresión'],
  [/Digitaci\uFFFDn/g, 'Digitación'],
  [/digitaci\uFFFDn/g, 'digitación'],
  [/Decodificaci\uFFFDn/g, 'Decodificación'],
  [/decodificaci\uFFFDn/g, 'decodificación'],
  [/Evaluaci\uFFFDn/g, 'Evaluación'],
  [/evaluaci\uFFFDn/g, 'evaluación'],
  [/Segmentaci\uFFFDn/g, 'Segmentación'],
  [/segmentaci\uFFFDn/g, 'segmentación'],
  [/Identificaci\uFFFDn/g, 'Identificación'],
  [/identificaci\uFFFDn/g, 'identificación'],
  [/Estimaci\uFFFDn/g, 'Estimación'],
  [/estimaci\uFFFDn/g, 'estimación'],
  [/An\uFFFDlisis/g, 'Análisis'],
  [/an\uFFFDlisis/g, 'análisis'],
  [/Se\uFFFDal/g, 'Señal'],
  [/se\uFFFDal/g, 'señal'],
  [/L\uFFFDnea/g, 'Línea'],
  [/l\uFFFDnea/g, 'línea'],
  [/\uFFFDndice/g, 'índice'],
  [/detect\uFFFD/g, 'detectó'],
  [/t\uFFFDcnic([ao]s?)/g, 'técnic$1'],
  [/estad\uFFFDstic([ao]s?)/g, 'estadístic$1'],
  [/comp\uFFFDs/g, 'compás'],
  [/t\uFFFDnica/g, 'tónica'],
  [/vii\uFFFD/g, 'vii°'],
  [/m\uFFFDltiples/g, 'múltiples'],
  [/\s\uFFFD\s/g, ' — '],
];

export function repairLegacyUtf8Text(value: string): string {
  if (!value || !value.includes('\uFFFD')) return value;
  let repaired = value;
  for (const [pattern, replacement] of LEGACY_UTF8_REPLACEMENTS) {
    repaired = repaired.replace(pattern, replacement);
  }
  return repaired;
}

const TRANSCRIPTION_VERSION = 'ws-audio-03-v1.0';

export class AudioTranscriptionService {
  private readonly importer = new UnifiedMusicImporter();

  public constructor(
    private readonly storageProvider: IAudioStorageProvider,
    private readonly pythonWorkerBridge: PythonAudioWorkerBridge = globalPythonAudioWorkerBridge,
    private readonly db: Database = defaultDb,
    private readonly auditRepo: IAuditLogRepository = new DrizzleAuditLogRepository()
  ) {}

  /**
   * Ejecuta el flujo secuencial WS-AUDIO-02 (Análisis Python de 10 etapas) + WS-AUDIO-03 (Transcripción a borradores)
   * para un activo de audio previamente preservado en `audio_assets`.
   * Crea el trabajo en `background_jobs` y persiste el borrador en `omr_proposals` + `omr_proposal_measures` + `omr_audit_history`.
   */
  public async analyzeAndTranscribeAudioAsset(
    audioId: string,
    user: AuthenticatedUser,
    options: AnalyzeAndTranscribeOptions = {}
  ): Promise<AudioDraftProposalDTO> {
    if (!user?.id) {
      throw new ValidationError('Se requiere un usuario autenticado para analizar y transcribir audio.');
    }

    // 1. Verificar existencia del activo de audio y su canción asociada (WS-AUDIO-01)
    const [asset] = await this.db
      .select()
      .from(audioAssets)
      .where(eq(audioAssets.id, audioId))
      .limit(1);

    if (!asset) {
      throw new NotFoundError('Activo de audio', audioId);
    }

    const [song] = await this.db
      .select()
      .from(songs)
      .where(eq(songs.id, asset.songId))
      .limit(1);

    if (!song) {
      throw new NotFoundError('Canción asociada al activo de audio', asset.songId);
    }

    const existsOnDisk = await this.storageProvider.exists(asset.storagePath);
    if (!existsOnDisk) {
      throw new NotFoundError('Archivo físico de audio en almacenamiento', asset.storagePath);
    }
    const fullPath = this.storageProvider.resolveSafePath(asset.storagePath);

    // 2. Registrar trabajo en background_jobs (Estado: ANALYSIS_QUEUED -> ANALYSIS_RUNNING)
    const [job] = await this.db
      .insert(backgroundJobs)
      .values({
        jobType: 'AUDIO_TRANSCRIPTION',
        status: 'PROCESSING',
        userId: user.id,
        tenantId: 'bethesda-default',
        inputRef: asset.filename,
        correlationId: asset.id,
        progress: 5,
        startedAt: new Date(),
        errorDetails: {
          workflowState: 'ANALYSIS_RUNNING',
          audioAssetId: asset.id,
          songId: asset.songId,
          checksumSha256: asset.checksumSha256,
        },
      })
      .returning();

    if (!job) {
      throw new ValidationError('No se pudo crear el registro de trabajo para análisis de audio.');
    }

    try {
      // 3. Ejecutar WS-AUDIO-02: Pipeline de 10 etapas en el worker local de Python
      const rawAnalysis = await this.pythonWorkerBridge.analyzeAudio(
        job.id,
        fullPath,
        asset.checksumSha256
      );
      const analysis = this.repairLegacyUtf8AnalysisStrings(rawAnalysis);

      // Actualizar duración en audio_assets si aún era null y el análisis la determinó con precisión
      if (asset.durationSeconds === null && analysis.durationSeconds > 0) {
        await this.db
          .update(audioAssets)
          .set({
            durationSeconds: Math.round(analysis.durationSeconds),
            updatedAt: new Date(),
          })
          .where(eq(audioAssets.id, asset.id));
      }

      // Actualizar estado intermedio a TRANSCRIPTION_RUNNING (WS-AUDIO-03)
      await this.db
        .update(backgroundJobs)
        .set({
          progress: 75,
          updatedAt: new Date(),
          errorDetails: {
            workflowState: 'TRANSCRIPTION_RUNNING',
            audioAssetId: asset.id,
            songId: asset.songId,
            analysisStatus: analysis.overallStatus,
            overallConfidence: analysis.overallConfidence,
          },
        })
        .where(eq(backgroundJobs.id, job.id));

      const resolvedTitle = (options.titleOverride?.trim() || asset.title || song.title).trim();
      const resolvedKey = (options.keyOverride?.trim() || analysis.key || null);
      const resolvedBpm = options.bpmOverride ?? analysis.bpm ?? null;
      const resolvedTimeSig = (options.timeSignatureOverride?.trim() || analysis.timeSignature || null);
      const selectedInstrument: SupportedReviewInstrument = options.selectedInstrument ?? 'GUITAR';
      const verifiedLyrics = options.verifiedLyrics?.trim() ?? '';

      // 4. Ejecutar WS-AUDIO-03: Construir CanonicalMusicPayload preliminar y artefactos por formato objetivo
      const canonicalPayload = this.buildCanonicalPayloadFromAnalysis({
        title: resolvedTitle,
        songTitle: song.title,
        asset,
        analysis,
        resolvedKey,
        resolvedBpm,
        resolvedTimeSig,
        verifiedLyrics,
        selectedInstrument,
      });

      const targets = this.generateTargetArtifacts(
        canonicalPayload,
        analysis,
        verifiedLyrics,
        selectedInstrument
      );

      const proposedChordPro =
        targets['CHORD_PRO']?.content ??
        this.buildFallbackChordProHeader(resolvedTitle, resolvedKey, resolvedBpm, resolvedTimeSig, analysis);

      const workflowState: AudioConversionWorkflowState =
        analysis.overallStatus === 'UNSUPPORTED'
          ? 'REVIEW_REQUIRED'
          : analysis.overallConfidence >= 0.65 && targets['CHORD_PRO']?.generatable
          ? 'DRAFT_READY'
          : 'REVIEW_REQUIRED';

      const canonicalJson = CanonicalSerializer.serialize(canonicalPayload);

      // 5. Persistir propuesta de borrador en PostgreSQL (omr_proposals + omr_proposal_measures + omr_audit_history)
      const proposalId = crypto.randomUUID();
      const nowIso = new Date().toISOString();

      const rawPayloadData = {
        proposalType: 'AUDIO_TRANSCRIPTION_DRAFT',
        workflowState,
        audioAssetId: asset.id,
        songId: asset.songId,
        songTitle: song.title,
        sourceFilename: asset.filename,
        sourceSha256: asset.checksumSha256,
        analysisVersion: analysis.analysisVersion,
        transcriptionVersion: TRANSCRIPTION_VERSION,
        selectedInstrument,
        verifiedLyrics,
        proposedChordPro,
        proposedCanonicalPayload: canonicalJson,
        analysisSummary: analysis,
        targets,
        changesMadeDuringReview: [] as AudioDraftReviewChangeRecord[],
        approvalMetadata: null as AudioDraftApprovalMetadata | null,
      };

      await this.db.transaction(async (tx) => {
        await tx.insert(omrProposals).values({
          id: proposalId,
          jobId: job.id,
          userId: user.id,
          sourceFilename: asset.filename,
          sourceHash: asset.checksumSha256,
          detectedTitle: resolvedTitle,
          detectedArtist: song.artist ?? null,
          detectedKey: resolvedKey,
          detectedBpm: resolvedBpm,
          detectedTimeSignature: resolvedTimeSig,
          overallConfidence: analysis.overallConfidence,
          isAiDraft: true,
          reviewStatus: 'PENDING_REVIEW',
          rawPayload: rawPayloadData,
          canonicalSongId: null,
        });

        for (const m of analysis.measures) {
          await tx.insert(omrProposalMeasures).values({
            proposalId,
            measureNumber: m.measureNumber,
            timeSignature: m.timeSignature,
            keySignature: m.keySignature,
            chordsDetected: m.chordsDetected,
            notesDetected: m.notesDetected,
            lyricsDetected: [],
            measureConfidence: m.measureConfidence,
            flags: m.flags,
          });
        }

        await tx
          .update(backgroundJobs)
          .set({
            status: 'REVIEW_REQUIRED',
            progress: 100,
            outputRef: `${resolvedTitle}.cho`,
            completedAt: new Date(),
            updatedAt: new Date(),
            errorDetails: {
              workflowState,
              proposalId,
              audioAssetId: asset.id,
              songId: asset.songId,
              checksumSha256: asset.checksumSha256,
              detectedKey: resolvedKey,
              detectedBpm: resolvedBpm,
              detectedTimeSignature: resolvedTimeSig,
              overallConfidence: analysis.overallConfidence,
              canonicalPayload: canonicalJson,
              targetFormat: 'CHORD_PRO',
              mimeType: 'text/plain',
              isBinary: false,
              data: proposedChordPro,
            },
          })
          .where(eq(backgroundJobs.id, job.id));
      });

      await this.auditRepo
        .create({
          eventType: 'AUDIO_DRAFT_CREATED',
          userId: user.id,
          resource: proposalId,
          metadata: {
            proposalId,
            jobId: job.id,
            audioAssetId: asset.id,
            songId: asset.songId,
            workflowState,
            analysisVersion: analysis.analysisVersion,
            transcriptionVersion: TRANSCRIPTION_VERSION,
            overallConfidence: analysis.overallConfidence,
            createdAt: nowIso,
          },
        })
        .catch(() => {});

      return await this.getDraftById(audioId, proposalId, user);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await this.db
        .update(backgroundJobs)
        .set({
          status: 'FAILED',
          progress: 100,
          errorCode: 'AUDIO_ANALYSIS_OR_TRANSCRIPTION_FAILED',
          completedAt: new Date(),
          updatedAt: new Date(),
          errorDetails: {
            workflowState: 'FAILED',
            audioAssetId: asset.id,
            songId: asset.songId,
            message: msg,
          },
        })
        .where(eq(backgroundJobs.id, job.id));
      throw err;
    }
  }

  /**
   * Lista todos los borradores musicales derivados de un activo de audio específico.
   */
  public async listDraftsByAudioAsset(
    audioId: string,
    user: AuthenticatedUser
  ): Promise<AudioDraftProposalDTO[]> {
    const [asset] = await this.db
      .select()
      .from(audioAssets)
      .where(eq(audioAssets.id, audioId))
      .limit(1);
    if (!asset) {
      throw new NotFoundError('Activo de audio', audioId);
    }

    const rows = await this.db
      .select()
      .from(omrProposals)
      .where(eq(omrProposals.sourceHash, asset.checksumSha256))
      .orderBy(desc(omrProposals.createdAt));

    const matching = rows.filter((r) => {
      const raw = r.rawPayload as Record<string, unknown> | null;
      return raw?.['proposalType'] === 'AUDIO_TRANSCRIPTION_DRAFT' && raw?.['audioAssetId'] === audioId;
    });

    const dtos: AudioDraftProposalDTO[] = [];
    for (const row of matching) {
      dtos.push(await this.mapProposalRowToDto(row, asset));
    }
    return dtos;
  }

  /**
   * Lista todos los borradores musicales derivados de audio asociados a una canción del catálogo.
   */
  public async listDraftsBySongId(
    songId: string,
    _user: AuthenticatedUser
  ): Promise<AudioDraftProposalDTO[]> {
    const [song] = await this.db.select().from(songs).where(eq(songs.id, songId)).limit(1);
    if (!song) {
      throw new NotFoundError('Canción', songId);
    }

    const assets = await this.db
      .select()
      .from(audioAssets)
      .where(eq(audioAssets.songId, songId))
      .orderBy(desc(audioAssets.createdAt));

    if (assets.length === 0) {
      return [];
    }

    const assetMap = new Map<string, AudioAsset>(assets.map((a) => [a.id, a]));
    const rows = await this.db
      .select()
      .from(omrProposals)
      .orderBy(desc(omrProposals.createdAt));

    const dtos: AudioDraftProposalDTO[] = [];
    for (const row of rows) {
      const raw = row.rawPayload as Record<string, unknown> | null;
      if (raw?.['proposalType'] !== 'AUDIO_TRANSCRIPTION_DRAFT') continue;
      const aId = String(raw?.['audioAssetId'] ?? '');
      const matchedAsset = assetMap.get(aId);
      if (matchedAsset || raw?.['songId'] === songId) {
        const effectiveAsset = matchedAsset ?? assets[0]!;
        dtos.push(await this.mapProposalRowToDto(row, effectiveAsset));
      }
    }
    return dtos;
  }

  /**
   * Obtiene un borrador derivado de audio por su ID verificando que pertenezca al activo de audio indicado.
   */
  public async getDraftById(
    audioId: string,
    proposalId: string,
    _user: AuthenticatedUser
  ): Promise<AudioDraftProposalDTO> {
    const [asset] = await this.db
      .select()
      .from(audioAssets)
      .where(eq(audioAssets.id, audioId))
      .limit(1);
    if (!asset) {
      throw new NotFoundError('Activo de audio', audioId);
    }

    const [row] = await this.db
      .select()
      .from(omrProposals)
      .where(eq(omrProposals.id, proposalId))
      .limit(1);

    if (!row) {
      throw new NotFoundError('Borrador de transcripción de audio', proposalId);
    }

    const raw = row.rawPayload as Record<string, unknown> | null;
    if (raw?.['proposalType'] !== 'AUDIO_TRANSCRIPTION_DRAFT' || raw?.['audioAssetId'] !== audioId) {
      throw new ValidationError(
        `El borrador '${proposalId}' no pertenece al activo de audio '${audioId}'. Asociación cruzada rechazada.`
      );
    }

    return await this.mapProposalRowToDto(row, asset);
  }

  /**
   * Permite al revisor humano editar el contenido musical propuesto (ChordPro, tonalidad, BPM, métrica,
   * letra verificada o instrumento seleccionado) antes de aprobarlo (Gate 4 — Revisión Humana).
   */
  public async updateDraft(
    audioId: string,
    proposalId: string,
    input: UpdateAudioDraftInput,
    user: AuthenticatedUser
  ): Promise<AudioDraftProposalDTO> {
    if (!['WORSHIP_LEADER', 'ADMIN', 'SUPER_ADMIN', 'MUSICIAN'].includes(user.role ?? '')) {
      throw new ForbiddenError('No posee permisos para editar borradores de transcripción de audio.');
    }

    const currentDto = await this.getDraftById(audioId, proposalId, user);
    if (currentDto.reviewStatus === 'COMMITTED') {
      throw new ValidationError(
        'Este borrador ya fue aprobado y publicado como versión canónica; cree un nuevo análisis o versión para realizar cambios adicionales.'
      );
    }

    const [asset] = await this.db
      .select()
      .from(audioAssets)
      .where(eq(audioAssets.id, audioId))
      .limit(1);
    if (!asset) {
      throw new NotFoundError('Activo de audio', audioId);
    }

    const fieldsModified: string[] = [];
    const newTitle = input.title?.trim() ? input.title.trim() : currentDto.title;
    if (input.title?.trim() && input.title.trim() !== currentDto.title) {
      fieldsModified.push('title');
    }

    const newKey = input.key !== undefined ? (input.key.trim() || null) : currentDto.detectedKey;
    if (input.key !== undefined && newKey !== currentDto.detectedKey) {
      fieldsModified.push('key');
    }

    const newBpm = input.bpm !== undefined ? input.bpm : currentDto.detectedBpm;
    if (input.bpm !== undefined && newBpm !== currentDto.detectedBpm) {
      fieldsModified.push('bpm');
    }

    const newTimeSig =
      input.timeSignature !== undefined
        ? input.timeSignature.trim() || null
        : currentDto.detectedTimeSignature;
    if (input.timeSignature !== undefined && newTimeSig !== currentDto.detectedTimeSignature) {
      fieldsModified.push('timeSignature');
    }

    const newInstrument: SupportedReviewInstrument =
      input.selectedInstrument ?? currentDto.selectedInstrument;
    if (input.selectedInstrument && input.selectedInstrument !== currentDto.selectedInstrument) {
      fieldsModified.push('selectedInstrument');
    }

    const newVerifiedLyrics =
      input.verifiedLyrics !== undefined ? input.verifiedLyrics.trim() : currentDto.verifiedLyrics;
    if (input.verifiedLyrics !== undefined && newVerifiedLyrics !== currentDto.verifiedLyrics) {
      fieldsModified.push('verifiedLyrics');
    }

    let updatedCanonical: CanonicalMusicPayload;
    let updatedChordPro: string;

    if (input.proposedChordPro !== undefined && input.proposedChordPro.trim().length > 0) {
      fieldsModified.push('proposedChordPro');
      updatedChordPro = input.proposedChordPro;
      // Importar el ChordPro editado por el humano hacia el modelo canónico preservando notas si existían
      const imported = this.importer.import(updatedChordPro, `${newTitle}.cho`);
      if (imported.status === 'FAILED' || !imported.payload) {
        throw new ValidationError(
          `El contenido ChordPro editado contiene errores de sintaxis: ${imported.diagnostics.map((d) => d.message).join('; ')}`
        );
      }
      const prevCanonical = CanonicalDeserializer.deserialize(currentDto.proposedCanonicalPayload);
      updatedCanonical = this.mergeEditedChordProWithAnalysisNotes(
        imported.payload,
        newTitle,
        newKey,
        newBpm,
        newTimeSig,
        currentDto.analysisSummary,
        asset,
        newInstrument,
        prevCanonical
      );
    } else {
      updatedCanonical = this.buildCanonicalPayloadFromAnalysis({
        title: newTitle,
        songTitle: currentDto.songTitle,
        asset,
        analysis: currentDto.analysisSummary,
        resolvedKey: newKey,
        resolvedBpm: newBpm,
        resolvedTimeSig: newTimeSig,
        verifiedLyrics: newVerifiedLyrics,
        selectedInstrument: newInstrument,
      });
      const chordProExport = CanonicalToChordProSerializer.serialize(updatedCanonical);
      updatedChordPro = chordProExport.content as string;
    }

    const updatedTargets = this.generateTargetArtifacts(
      updatedCanonical,
      currentDto.analysisSummary,
      newVerifiedLyrics,
      newInstrument
    );
    // Si el revisor editó directamente el texto ChordPro, conservar su texto exacto en el target CHORD_PRO
    if (input.proposedChordPro !== undefined && updatedTargets['CHORD_PRO']) {
      updatedTargets['CHORD_PRO'] = {
        ...updatedTargets['CHORD_PRO'],
        status: 'DRAFT_READY',
        generatable: true,
        content: updatedChordPro,
      };
    }

    const changeRecord: AudioDraftReviewChangeRecord = {
      changedAt: new Date().toISOString(),
      changedByUserId: user.id,
      summary:
        input.reason?.trim() ||
        `Edición humana de borrador (${fieldsModified.join(', ') || 'revisión de contenido'}).`,
      fieldsModified,
    };

    const updatedChanges = [...currentDto.changesMadeDuringReview, changeRecord];
    const canonicalJson = CanonicalSerializer.serialize(updatedCanonical);

    const updatedRawPayload = {
      proposalType: 'AUDIO_TRANSCRIPTION_DRAFT',
      workflowState: 'DRAFT_READY' as AudioConversionWorkflowState,
      audioAssetId: asset.id,
      songId: asset.songId,
      songTitle: currentDto.songTitle,
      sourceFilename: asset.filename,
      sourceSha256: asset.checksumSha256,
      analysisVersion: currentDto.analysisVersion,
      transcriptionVersion: currentDto.transcriptionVersion,
      selectedInstrument: newInstrument,
      verifiedLyrics: newVerifiedLyrics,
      proposedChordPro: updatedChordPro,
      proposedCanonicalPayload: canonicalJson,
      analysisSummary: currentDto.analysisSummary,
      targets: updatedTargets,
      changesMadeDuringReview: updatedChanges,
      approvalMetadata: currentDto.approvalMetadata,
    };

    await this.db.transaction(async (tx) => {
      await tx
        .update(omrProposals)
        .set({
          detectedTitle: newTitle,
          detectedKey: newKey,
          detectedBpm: newBpm,
          detectedTimeSignature: newTimeSig,
          reviewStatus: 'PENDING_REVIEW',
          rawPayload: updatedRawPayload,
        })
        .where(eq(omrProposals.id, proposalId));
    });

    await this.auditRepo
      .create({
        eventType: 'AUDIO_DRAFT_UPDATED',
        userId: user.id,
        resource: proposalId,
        metadata: {
          proposalId,
          audioAssetId: audioId,
          songId: asset.songId,
          fieldsModified,
          summary: changeRecord.summary,
        },
      })
      .catch(() => {});

    return await this.getDraftById(audioId, proposalId, user);
  }

  /**
   * Registra una decisión de revisión humana sobre el borrador:
   * - REJECTED: Rechaza el borrador sin tocar la canción canónica.
   * - CORRECTION_REQUESTED: Marca el borrador en estado REVIEW_REQUIRED con observaciones del revisor.
   * - APPROVED_FOR_IMPORT: Marca el borrador como validado y listo para publicación canónica.
   */
  public async reviewDraftDecision(
    audioId: string,
    proposalId: string,
    decision: 'REJECTED' | 'CORRECTION_REQUESTED' | 'APPROVED_FOR_IMPORT',
    user: AuthenticatedUser,
    notes?: string
  ): Promise<AudioDraftProposalDTO> {
    if (!['WORSHIP_LEADER', 'ADMIN', 'SUPER_ADMIN'].includes(user.role ?? '')) {
      throw new ForbiddenError(
        'No posee permisos (songs:update_draft) para aprobar, rechazar o solicitar corrección en borradores de audio.'
      );
    }

    const currentDto = await this.getDraftById(audioId, proposalId, user);
    if (currentDto.reviewStatus === 'COMMITTED') {
      throw new ValidationError('El borrador ya fue publicado en el catálogo y no puede cambiar su estado de revisión.');
    }

    const [row] = await this.db
      .select()
      .from(omrProposals)
      .where(eq(omrProposals.id, proposalId))
      .limit(1);
    if (!row) {
      throw new NotFoundError('Borrador de audio', proposalId);
    }

    const raw = { ...(row.rawPayload as Record<string, unknown>) };
    const now = new Date();
    const nowIso = now.toISOString();

    let nextReviewStatus: 'PENDING_REVIEW' | 'APPROVED_FOR_IMPORT' | 'REJECTED';
    let nextWorkflowState: AudioConversionWorkflowState;

    if (decision === 'REJECTED') {
      nextReviewStatus = 'REJECTED';
      nextWorkflowState = 'REJECTED';
    } else if (decision === 'CORRECTION_REQUESTED') {
      nextReviewStatus = 'PENDING_REVIEW';
      nextWorkflowState = 'REVIEW_REQUIRED';
    } else {
      nextReviewStatus = 'APPROVED_FOR_IMPORT';
      nextWorkflowState = 'DRAFT_READY';
    }

    const changes = Array.isArray(raw['changesMadeDuringReview'])
      ? [...(raw['changesMadeDuringReview'] as AudioDraftReviewChangeRecord[])]
      : [];
    changes.push({
      changedAt: nowIso,
      changedByUserId: user.id,
      summary:
        notes?.trim() ||
        (decision === 'REJECTED'
          ? 'Borrador rechazado durante la revisión humana; contenido canónico preservado intacto.'
          : decision === 'CORRECTION_REQUESTED'
          ? 'Se solicitaron correcciones adicionales sobre el borrador.'
          : 'Borrador validado por revisor humano.'),
      fieldsModified: ['reviewStatus'],
    });

    raw['workflowState'] = nextWorkflowState;
    raw['changesMadeDuringReview'] = changes;

    await this.db.transaction(async (tx) => {
      await tx
        .update(omrProposals)
        .set({
          reviewStatus: nextReviewStatus,
          reviewedAt: now,
          reviewedByUserId: user.id,
          rawPayload: raw,
        })
        .where(eq(omrProposals.id, proposalId));

      if (row.jobId) {
        await tx
          .update(backgroundJobs)
          .set({
            status: decision === 'REJECTED' ? 'CANCELLED' : 'REVIEW_REQUIRED',
            updatedAt: now,
          })
          .where(eq(backgroundJobs.id, row.jobId));
      }
    });

    await this.auditRepo
      .create({
        eventType:
          decision === 'REJECTED'
            ? 'AUDIO_DRAFT_REJECTED'
            : decision === 'CORRECTION_REQUESTED'
            ? 'AUDIO_DRAFT_CORRECTION_REQUESTED'
            : 'AUDIO_DRAFT_VALIDATED',
        userId: user.id,
        resource: proposalId,
        metadata: {
          proposalId,
          audioAssetId: audioId,
          songId: currentDto.songId,
          decision,
          notes: notes ?? null,
          reviewedAt: nowIso,
        },
      })
      .catch(() => {});

    return await this.getDraftById(audioId, proposalId, user);
  }

  /**
   * Aprueba explícitamente un borrador revisado y publica una NUEVA versión controlada en `song_versions`
   * para la canción asociada, sin sobrescribir ni destruir versiones canónicas previas (Secciones 7, 8 y 9).
   */
  public async approveAndPublishDraft(
    audioId: string,
    proposalId: string,
    input: ApproveAudioDraftInput,
    user: AuthenticatedUser
  ): Promise<{
    draft: AudioDraftProposalDTO;
    songId: string;
    versionId: string;
    versionNumber: number;
    approvalMetadata: AudioDraftApprovalMetadata;
  }> {
    if (!['WORSHIP_LEADER', 'ADMIN', 'SUPER_ADMIN'].includes(user.role ?? '')) {
      throw new ForbiddenError(
        'Solo un Director de Alabanza o Administrador puede aprobar y publicar borradores al Atril Digital.'
      );
    }

    const currentDto = await this.getDraftById(audioId, proposalId, user);

    if (currentDto.reviewStatus === 'REJECTED' || currentDto.workflowState === 'REJECTED') {
      throw new ValidationError(
        'No se puede publicar un borrador rechazado. Edite y valide el borrador antes de aprobarlo.'
      );
    }

    // Protección contra asociaciones cruzadas entre canciones (Sección 8)
    const targetSongId = input.targetSongId?.trim() || currentDto.songId;
    if (targetSongId !== currentDto.songId) {
      throw new ValidationError(
        `Violación de protección canónica: no se permite asociar ni aprobar un borrador del activo de audio (canción '${currentDto.songId}') hacia una canción distinta ('${targetSongId}').`
      );
    }

    // Idempotencia si ya fue publicado previamente
    if (currentDto.reviewStatus === 'COMMITTED' && currentDto.approvalMetadata) {
      return {
        draft: currentDto,
        songId: currentDto.approvalMetadata.targetSongId,
        versionId: currentDto.approvalMetadata.approvedSongVersionId,
        versionNumber: currentDto.approvalMetadata.approvedVersionNumber,
        approvalMetadata: currentDto.approvalMetadata,
      };
    }

    const [asset] = await this.db
      .select()
      .from(audioAssets)
      .where(eq(audioAssets.id, audioId))
      .limit(1);
    if (!asset) {
      throw new NotFoundError('Activo de audio', audioId);
    }

    const [existingSong] = await this.db
      .select()
      .from(songs)
      .where(eq(songs.id, targetSongId))
      .limit(1);
    if (!existingSong) {
      throw new NotFoundError('Canción destino', targetSongId);
    }

    // Rehidratar y enriquecer el CanonicalMusicPayload con metadatos inmutables de aprobación y procedencia
    const baseCanonical = CanonicalDeserializer.deserialize(currentDto.proposedCanonicalPayload);
    const totalChords = baseCanonical.getAllChords().length;
    const totalNotes = baseCanonical.getAllNotes().length;
    const totalLyrics = baseCanonical.getAllLyrics().length;

    if (baseCanonical.measures.length === 0 || (totalChords === 0 && totalNotes === 0 && totalLyrics === 0)) {
      throw new ValidationError(
        'No se puede aprobar ni publicar al Atril Digital un borrador vacío sin compases, acordes, notas ni letra verificada.'
      );
    }

    const refreshedTargets = this.generateTargetArtifacts(
      baseCanonical,
      currentDto.analysisSummary,
      currentDto.verifiedLyrics,
      currentDto.selectedInstrument
    );
    const harmonicEvidenceSummary = this.computeHarmonicEvidenceBreakdown(baseCanonical);
    const approvalScope: 'HARMONIC_LEAD_SHEET_ONLY' | 'MELODIC_AND_HARMONIC' =
      harmonicEvidenceSummary.melodicNotesCount > 0 ? 'MELODIC_AND_HARMONIC' : 'HARMONIC_LEAD_SHEET_ONLY';

    const ALL_TARGET_FORMATS: ApprovalTargetFormat[] = [
      'CHORD_PRO',
      'MUSIC_XML',
      'MIDI',
      'TABLATURE',
      'LYRICS_ONLY',
    ];
    const midiEligibility = MidiExportGatekeeper.isEligible(baseCanonical);
    const isFormatGeneratable = (fmt: ApprovalTargetFormat): boolean => {
      const target = refreshedTargets[fmt];
      if (!target || !target.generatable) return false;
      if (fmt === 'MIDI') return totalNotes > 0 && midiEligibility.eligible;
      if (fmt === 'TABLATURE') return totalNotes > 0;
      if (fmt === 'LYRICS_ONLY') return totalLyrics > 0 || currentDto.verifiedLyrics.trim().length > 0;
      return true;
    };

    const generatableFormats = ALL_TARGET_FORMATS.filter(isFormatGeneratable);
    let approvedFormats: ApprovalTargetFormat[];
    if (input.approvedFormats !== undefined) {
      const requested = Array.from(new Set(input.approvedFormats));
      if (requested.length === 0) {
        throw new ValidationError(
          'Debe seleccionar al menos un formato generable válido (p. ej., CHORD_PRO o MUSIC_XML) para aprobar este borrador.'
        );
      }
      const blockedRequested = requested.filter((fmt) => !isFormatGeneratable(fmt));
      if (blockedRequested.length > 0) {
        const details = blockedRequested
          .map((fmt) => `${fmt}: ${refreshedTargets[fmt]?.reason ?? 'NOT_GENERATABLE'}`)
          .join(' | ');
        throw new ValidationError(
          `No se pueden aprobar formatos no generables (Principio de Cero Fabricación): ${blockedRequested.join(', ')}. ${details}`
        );
      }
      approvedFormats = requested;
    } else {
      approvedFormats = generatableFormats;
      if (approvedFormats.length === 0) {
        throw new ValidationError(
          'Ningún formato objetivo es generable actualmente para aprobar este borrador.'
        );
      }
    }

    const blockedFormats: BlockedFormatRecord[] = ALL_TARGET_FORMATS.filter(
      (fmt) => !approvedFormats.includes(fmt)
    ).map((fmt) =>
      !isFormatGeneratable(fmt)
        ? {
            format: fmt,
            status: 'NOT_GENERATABLE',
            reason: repairLegacyUtf8Text(
              refreshedTargets[fmt]?.reason ?? 'Formato no generable sin evidencia suficiente.'
            ),
          }
        : {
            format: fmt,
            status: 'EXCLUDED_BY_REVIEWER',
            reason: 'Excluido del alcance de aprobación por decisión del revisor humano.',
          }
    );

    const approvedAtIso = new Date().toISOString();
    const setAsCurrent = input.setAsCurrent ?? true;

    const result = await this.db.transaction(async (tx) => {
      // Determinar el siguiente número de versión sin sobrescribir ninguna versión existente (Sección 8)
      const [latestVersion] = await tx
        .select({ versionNumber: songVersions.versionNumber })
        .from(songVersions)
        .where(eq(songVersions.songId, targetSongId))
        .orderBy(desc(songVersions.versionNumber))
        .limit(1);

      const nextVersionNumber = (latestVersion?.versionNumber ?? 0) + 1;

      const enrichedMetadata: Record<string, unknown> = {
        ...(baseCanonical.metadata ?? {}),
        isVisualOnly: false,
        isAudioDerived: true,
        approvalStatus: 'APPROVED',
        audioAssetId: asset.id,
        sourceAudioAssetId: asset.id,
        audioFilename: asset.filename,
        audioChecksumSha256: asset.checksumSha256,
        sourceAudioSha256: asset.checksumSha256,
        proposalId,
        analysisVersion: currentDto.analysisVersion,
        transcriptionVersion: currentDto.transcriptionVersion,
        approvedByUserId: user.id,
        approvedAt: approvedAtIso,
        versionNumber: nextVersionNumber,
        key: currentDto.detectedKey ?? existingSong.defaultKey ?? undefined,
        bpm: currentDto.detectedBpm ?? existingSong.defaultBpm ?? undefined,
        timeSignature: currentDto.detectedTimeSignature ?? existingSong.timeSignature ?? undefined,
        changesCount: currentDto.changesMadeDuringReview.length,
        approvedFormats,
        blockedFormats,
        approvalScope,
        harmonicEvidenceSummary,
      };

      const approvedCanonical = new CanonicalMusicPayload({
        version: baseCanonical.version,
        title: currentDto.title || existingSong.title,
        timeline: baseCanonical.timeline,
        sections: [...baseCanonical.sections],
        measures: [...baseCanonical.measures],
        instrumentTracks: [...baseCanonical.instrumentTracks],
        metadata: enrichedMetadata,
      });

      const serializedCanonical = CanonicalSerializer.serialize(approvedCanonical);
      const stats = CanonicalSerializer.extractStatistics(approvedCanonical);

      if (setAsCurrent) {
        await tx
          .update(songVersions)
          .set({ isCurrent: false })
          .where(eq(songVersions.songId, targetSongId));
      }

      const versionName =
        input.versionName?.trim() ||
        `Transcripción Audio Aprobada (v${nextVersionNumber})`;
      const versionDescription =
        input.versionDescription?.trim() ||
        `Aprobada por revisión humana (${approvalScope}; formatos: ${approvedFormats.join(', ')}) desde "${asset.filename}" (SHA-256: ${asset.checksumSha256.slice(0, 12)}...). Evidencia armónica: ${harmonicEvidenceSummary.detectedCount} detectados, ${harmonicEvidenceSummary.estimatedCount} estimados, ${harmonicEvidenceSummary.ambiguousCount} ambiguos, ${harmonicEvidenceSummary.humanVerifiedCount} verificados manualmente.`;

      const [createdVersion] = await tx
        .insert(songVersions)
        .values({
          songId: targetSongId,
          versionNumber: nextVersionNumber,
          name: versionName,
          description: versionDescription,
          sourceFormat:
            approvedFormats.includes('MUSIC_XML') && totalNotes > 0
              ? 'MUSIC_XML'
              : approvedFormats.includes('CHORD_PRO')
              ? 'CHORD_PRO'
              : approvedFormats[0]!,
          canonicalPayload: serializedCanonical,
          totalMeasures: stats.totalMeasures,
          totalNotes: stats.totalNotes,
          totalChords: stats.totalChords,
          isCurrent: setAsCurrent,
          createdByUserId: user.id,
        })
        .returning();

      if (!createdVersion) {
        throw new ValidationError('No se pudo insertar la nueva versión aprobada en song_versions.');
      }

      if (setAsCurrent) {
        await tx
          .update(songs)
          .set({
            currentVersionId: createdVersion.id,
            defaultKey: currentDto.detectedKey ?? existingSong.defaultKey,
            defaultBpm: currentDto.detectedBpm ?? existingSong.defaultBpm,
            timeSignature: currentDto.detectedTimeSignature ?? existingSong.timeSignature,
            status: 'APPROVED',
            updatedByUserId: user.id,
            updatedAt: new Date(),
          })
          .where(eq(songs.id, targetSongId));
      }

      await tx.insert(songSources).values({
        songId: targetSongId,
        versionId: createdVersion.id,
        userId: user.id,
        sourceType: 'AUDIO',
        filename: asset.filename,
        storagePath: asset.storagePath,
        mimeType: asset.mimeType,
        fileSizeBytes: asset.fileSizeBytes,
        checksumSha256: asset.checksumSha256,
        rawContent: currentDto.proposedChordPro,
        importerName: 'AudioTranscriptionService',
        importerVersion: TRANSCRIPTION_VERSION,
      });

      const approvalMetadata: AudioDraftApprovalMetadata = {
        approvedByUserId: user.id,
        approvedAt: approvedAtIso,
        sourceAudioAssetId: asset.id,
        sourceAudioSha256: asset.checksumSha256,
        analysisVersion: currentDto.analysisVersion,
        transcriptionVersion: currentDto.transcriptionVersion,
        targetSongId,
        approvedSongVersionId: createdVersion.id,
        approvedVersionNumber: nextVersionNumber,
        setAsCurrent,
        ...(input.reviewNotes ? { reviewNotes: input.reviewNotes } : {}),
        changesMadeDuringReview: currentDto.changesMadeDuringReview,
        approvedFormats,
        blockedFormats,
        approvalScope,
        harmonicEvidenceSummary,
      };

      const [proposalRow] = await tx
        .select()
        .from(omrProposals)
        .where(eq(omrProposals.id, proposalId))
        .limit(1);

      const updatedRaw = {
        ...((proposalRow?.rawPayload as Record<string, unknown>) ?? {}),
        workflowState: 'APPROVED' as AudioConversionWorkflowState,
        proposedCanonicalPayload: serializedCanonical,
        targets: refreshedTargets,
        approvalMetadata,
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

      if (proposalRow?.jobId) {
        await tx
          .update(backgroundJobs)
          .set({
            status: 'COMPLETED',
            updatedAt: new Date(),
          })
          .where(eq(backgroundJobs.id, proposalRow.jobId));
      }

      return {
        versionId: createdVersion.id,
        versionNumber: nextVersionNumber,
        approvalMetadata,
      };
    });

    await this.auditRepo
      .create({
        eventType: 'AUDIO_DRAFT_APPROVED_AND_PUBLISHED',
        userId: user.id,
        resource: proposalId,
        metadata: {
          ...(result.approvalMetadata as unknown as Record<string, unknown>),
          audioAssetId: audioId,
        },
      })
      .catch(() => {});

    const updatedDraft = await this.getDraftById(audioId, proposalId, user);
    return {
      draft: updatedDraft,
      songId: targetSongId,
      versionId: result.versionId,
      versionNumber: result.versionNumber,
      approvalMetadata: result.approvalMetadata,
    };
  }

  /**
   * Exporta bajo demanda un formato objetivo específico ('CHORD_PRO' | 'MUSIC_XML' | 'MIDI' | 'TABLATURE' | 'LYRICS_ONLY')
   * de un borrador derivado de audio, rechazando con ValidationError (400) si el formato es NOT_GENERATABLE.
   */
  public async exportDraftArtifact(
    audioId: string,
    proposalId: string,
    format: 'CHORD_PRO' | 'MUSIC_XML' | 'MIDI' | 'TABLATURE' | 'LYRICS_ONLY',
    instrument: SupportedReviewInstrument | undefined,
    user: AuthenticatedUser
  ): Promise<GeneratedTargetArtifact> {
    const draft = await this.getDraftById(audioId, proposalId, user);
    const canonical = CanonicalDeserializer.deserialize(draft.proposedCanonicalPayload);
    const effectiveInstrument = instrument ?? draft.selectedInstrument;
    const refreshedTargets = this.generateTargetArtifacts(
      canonical,
      draft.analysisSummary,
      draft.verifiedLyrics,
      effectiveInstrument
    );

    const artifact = refreshedTargets[format];
    if (!artifact || !artifact.generatable || artifact.content === null) {
      throw new ValidationError(
        artifact?.reason ??
          `El formato '${format}' no puede generarse de forma confiable para esta grabación (NOT_GENERATABLE).`
      );
    }
    return artifact;
  }

  private buildCanonicalPayloadFromAnalysis(params: {
    title: string;
    songTitle: string;
    asset: AudioAsset;
    analysis: PythonWorkerAnalysisResult;
    resolvedKey: string | null;
    resolvedBpm: number | null;
    resolvedTimeSig: string | null;
    verifiedLyrics: string;
    selectedInstrument: SupportedReviewInstrument;
  }): CanonicalMusicPayload {
    const {
      title,
      asset,
      analysis,
      resolvedKey,
      resolvedBpm,
      resolvedTimeSig,
      verifiedLyrics,
      selectedInstrument,
    } = params;

    let keySigRef: KeySignatureReference | null = null;
    if (resolvedKey) {
      try {
        keySigRef = KeySignatureReference.fromMusicalKey(MusicalKey.parse(resolvedKey));
      } catch {
        keySigRef = null;
      }
    }

    let timeSig: TimeSignature | null = null;
    if (resolvedTimeSig) {
      try {
        timeSig = TimeSignature.parse(resolvedTimeSig);
      } catch {
        timeSig = null;
      }
    }
    const effectiveTimeSig = timeSig ?? new TimeSignature(4, 4);
    const measureDurationTicks = effectiveTimeSig.calculateMeasureDurationTicks();

    const tempoMap =
      resolvedBpm && resolvedBpm > 0
        ? new TempoMap([new TempoEvent(0, resolvedBpm)])
        : new TempoMap([]);

    // Distribuir líneas de letra verificada (si fueron provistas por el usuario) entre los compases
    const lyricLines = verifiedLyrics
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && !l.startsWith('#') && !l.startsWith('{'));

    const measures: Measure[] = [];
    let currentTick = 0;
    let sylSeq = 1;

    for (let i = 0; i < analysis.measures.length; i++) {
      const mData = analysis.measures[i]!;
      const measureNum = mData.measureNumber || i + 1;
      const measureStartTick = currentTick;

      // 1. Acordes detectados/estimados/ambiguos en el compás (preservando evidencia exacta)
      const chordEvents: ChordEvent[] = [];
      let chordIdx = 1;
      for (const c of mData.chordsDetected) {
        try {
          const parsedChord = Chord.parse(c.chord);
          const relOffset =
            typeof c.tickOffset === 'number'
              ? c.tickOffset
              : Math.max(0, (c.beat - 1) * effectiveTimeSig.beatDurationTicks);
          const evStatus: ChordEvidenceStatus =
            c.status === 'DETECTED' || c.status === 'ESTIMATED' || c.status === 'AMBIGUOUS'
              ? c.status
              : 'ESTIMATED';
          chordEvents.push(
            new ChordEvent({
              id: `aud_ch_${measureNum}_${chordIdx++}`,
              chord: parsedChord,
              startTick: measureStartTick + relOffset,
              measureNumber: measureNum,
              voice: 1,
              evidenceStatus: evStatus,
              confidence: c.confidence,
              alternativeSymbol: c.alternativeChord ?? null,
            })
          );
        } catch {
          // Ignorar acorde no parseable
        }
      }

      // 2. Notas y silencios verificados (SOLO si existen en mData.notesDetected)
      const events: (Note | Rest)[] = [];
      if (mData.notesDetected && mData.notesDetected.length > 0) {
        let evIdx = 1;
        for (const n of mData.notesDetected) {
          const startTick = measureStartTick + (n.startTick ?? 0);
          const durationTicks = n.durationTicks > 0 ? n.durationTicks : 480;
          if (n.isRest) {
            events.push(
              new Rest({
                id: `aud_rest_${measureNum}_${evIdx++}`,
                startTick,
                durationTicks,
                voice: 1,
                staff: 1,
              })
            );
          } else {
            try {
              const stepLetter = (n.step?.trim().toUpperCase() || 'C') as BaseNoteLetter;
              const acc = Accidental.fromSemitones(n.alter ?? 0);
              const noteName = new NoteName(stepLetter, acc);
              const pitch = new Pitch(noteName, n.octave);
              events.push(
                new Note({
                  id: `aud_note_${measureNum}_${evIdx++}`,
                  pitch,
                  startTick,
                  durationTicks,
                  voice: 1,
                  staff: 1,
                })
              );
            } catch {
              // Ignorar nota malformada
            }
          }
        }
      }

      const voices = events.length > 0 ? [new Voice(1, events)] : [];

      // 3. Letra verificada (ÚNICAMENTE si el usuario suministró verifiedLyrics explícitamente)
      const lyrics: LyricSyllable[] = [];
      if (i < lyricLines.length && lyricLines[i]) {
        const words = lyricLines[i]!.split(/\s+/).filter(Boolean);
        for (let wIdx = 0; wIdx < words.length; wIdx++) {
          const tickOffset = Math.round((wIdx / Math.max(1, words.length)) * (measureDurationTicks - 120));
          const matchedChord =
            wIdx === 0 && chordEvents[0]
              ? chordEvents[0].chord
              : wIdx === Math.floor(words.length / 2) && chordEvents[1]
              ? chordEvents[1].chord
              : undefined;
          lyrics.push(
            new LyricSyllable({
              id: `aud_lyr_${measureNum}_${sylSeq}`,
              text: words[wIdx]!,
              measureNumber: measureNum,
              tickOffset,
              sequenceNumber: sylSeq++,
              isHyphenated: false,
              ...(matchedChord ? { chordAbove: matchedChord } : {}),
            })
          );
        }
      }

      measures.push(
        new Measure({
          number: measureNum,
          startTick: measureStartTick,
          durationTicks: measureDurationTicks,
          timeSignature: i === 0 ? timeSig : null,
          keySignature: i === 0 ? keySigRef : null,
          voices,
          chords: chordEvents,
          lyrics,
        })
      );

      currentTick += measureDurationTicks;
    }

    // 4. Secciones estructurales
    const sections: Section[] = [];
    for (const s of analysis.sections) {
      if (s.startMeasure >= 1 && s.startMeasure <= measures.length) {
        const validCount = Math.min(s.measureCount, measures.length - s.startMeasure + 1);
        if (validCount > 0) {
          const validType = ['INTRO', 'VERSE', 'PRE_CHORUS', 'CHORUS', 'BRIDGE', 'INTERLUDE', 'OUTRO', 'TAG'].includes(
            s.type
          )
            ? (s.type as any)
            : 'VERSE';
          sections.push(
            new Section({
              id: s.id,
              type: validType,
              label: s.label,
              startMeasure: s.startMeasure,
              measureCount: validCount,
              startTick: (s.startMeasure - 1) * measureDurationTicks,
              durationTicks: validCount * measureDurationTicks,
            })
          );
        }
      }
    }

    const familyMap: Record<SupportedReviewInstrument, 'GUITAR' | 'BASS' | 'KEYS' | 'VOCALS'> = {
      GUITAR: 'GUITAR',
      BASS: 'BASS',
      PIANO: 'KEYS',
      VOCAL: 'VOCALS',
    };
    const nameMap: Record<SupportedReviewInstrument, string> = {
      GUITAR: 'Guitarra (6 Cuerdas)',
      BASS: 'Bajo Eléctrico (4 Cuerdas)',
      PIANO: 'Piano / Teclado Principal',
      VOCAL: 'Voz / Guía Armónica',
    };

    const instrumentTracks: InstrumentTrack[] = [
      new InstrumentTrack({
        id: `track_${selectedInstrument.toLowerCase()}`,
        name: nameMap[selectedInstrument],
        family: familyMap[selectedInstrument],
        voiceIds: [1],
        transpositionOffsetSemitones: 0,
      }),
    ];

    const timeline = new Timeline({
      tpqn: CANONICAL_TPQN,
      tempoMap,
      measureCount: measures.length,
      totalDurationTicks: Math.max(measureDurationTicks, currentTick),
    });

    const draftPayload = new CanonicalMusicPayload({
      title,
      timeline,
      sections,
      measures,
      instrumentTracks,
      metadata: {
        isAiDraft: true,
        isAudioDerived: true,
        approvalStatus: 'DRAFT_REVIEW_REQUIRED',
        audioAssetId: asset.id,
        sourceAudioAssetId: asset.id,
        audioFilename: asset.filename,
        audioChecksumSha256: asset.checksumSha256,
        sourceAudioSha256: asset.checksumSha256,
        analysisVersion: analysis.analysisVersion,
        transcriptionVersion: TRANSCRIPTION_VERSION,
        overallConfidence: analysis.overallConfidence,
        key: resolvedKey ?? undefined,
        keyConfidence: analysis.keyConfidence,
        keyStatus: analysis.keyStatus,
        bpm: resolvedBpm ?? undefined,
        bpmConfidence: analysis.bpmConfidence,
        bpmStatus: analysis.bpmStatus,
        timeSignature: resolvedTimeSig ?? undefined,
        meterConfidence: analysis.meterConfidence,
        meterStatus: analysis.meterStatus,
        noteExtractionStatus: analysis.noteExtractionStatus,
        noteExtractionReason: repairLegacyUtf8Text(analysis.noteExtractionReason),
        instrument: selectedInstrument,
      },
    });
    const harmonicEvidenceSummary = this.computeHarmonicEvidenceBreakdown(draftPayload);
    return new CanonicalMusicPayload({
      version: draftPayload.version,
      title: draftPayload.title,
      timeline: draftPayload.timeline,
      sections: [...draftPayload.sections],
      measures: [...draftPayload.measures],
      instrumentTracks: [...draftPayload.instrumentTracks],
      metadata: {
        ...draftPayload.metadata,
        harmonicEvidenceSummary,
      },
    });
  }

  private mergeEditedChordProWithAnalysisNotes(
    importedChordProPayload: CanonicalMusicPayload,
    title: string,
    resolvedKey: string | null,
    resolvedBpm: number | null,
    resolvedTimeSig: string | null,
    analysis: PythonWorkerAnalysisResult,
    asset: AudioAsset,
    selectedInstrument: SupportedReviewInstrument,
    previousCanonical?: CanonicalMusicPayload
  ): CanonicalMusicPayload {
    const prevMeasuresByNum = new Map<number, Measure>(
      (previousCanonical?.measures ?? []).map((m) => [m.number, m])
    );
    const analysisMeasuresByNum = new Map<number, PythonWorkerAnalysisResult['measures'][number]>(
      analysis.measures.map((m) => [m.measureNumber, m])
    );

    const preservedMeasures = importedChordProPayload.measures.map((m) => {
      const prevMeasure = prevMeasuresByNum.get(m.number);
      const analysisMeasure = analysisMeasuresByNum.get(m.number);
      const updatedChords = m.chords.map((ce, idx) => {
        const importedSymbol = ce.chord.toString('STANDARD');
        const prevChord = prevMeasure?.chords[idx];
        if (prevChord && prevChord.chord.toString('STANDARD') === importedSymbol) {
          return new ChordEvent({
            id: ce.id,
            chord: ce.chord,
            startTick: ce.startTick,
            durationTicks: ce.durationTicks ?? null,
            measureNumber: ce.measureNumber,
            ...(ce.voice !== undefined ? { voice: ce.voice } : {}),
            ...(prevChord.evidenceStatus !== undefined ? { evidenceStatus: prevChord.evidenceStatus } : {}),
            ...(prevChord.confidence !== undefined ? { confidence: prevChord.confidence } : {}),
            ...(prevChord.alternativeSymbol !== undefined ? { alternativeSymbol: prevChord.alternativeSymbol } : {}),
          });
        }
        const rawAnalysisChord = analysisMeasure?.chordsDetected[idx];
        if (rawAnalysisChord && rawAnalysisChord.chord === importedSymbol) {
          const evStatus: ChordEvidenceStatus =
            rawAnalysisChord.status === 'DETECTED' ||
            rawAnalysisChord.status === 'ESTIMATED' ||
            rawAnalysisChord.status === 'AMBIGUOUS'
              ? rawAnalysisChord.status
              : 'ESTIMATED';
          return new ChordEvent({
            id: ce.id,
            chord: ce.chord,
            startTick: ce.startTick,
            durationTicks: ce.durationTicks ?? null,
            measureNumber: ce.measureNumber,
            ...(ce.voice !== undefined ? { voice: ce.voice } : {}),
            evidenceStatus: evStatus,
            confidence: rawAnalysisChord.confidence,
            alternativeSymbol: rawAnalysisChord.alternativeChord ?? null,
          });
        }
        // Solo si el acorde fue alterado o insertado manualmente en el editor pasa a HUMAN_VERIFIED
        return new ChordEvent({
          id: ce.id,
          chord: ce.chord,
          startTick: ce.startTick,
          durationTicks: ce.durationTicks ?? null,
          measureNumber: ce.measureNumber,
          ...(ce.voice !== undefined ? { voice: ce.voice } : {}),
          evidenceStatus: 'HUMAN_VERIFIED',
          confidence: 1.0,
          alternativeSymbol: prevChord ? prevChord.chord.toString('STANDARD') : null,
        });
      });

      return new Measure({
        number: m.number,
        startTick: m.startTick,
        durationTicks: m.durationTicks,
        timeSignature: m.timeSignature,
        keySignature: m.keySignature,
        voices: m.voices.length > 0 ? [...m.voices] : [...(prevMeasure?.voices ?? [])],
        chords: updatedChords,
        lyrics: [...m.lyrics],
      });
    });

    const draftPayload = new CanonicalMusicPayload({
      version: importedChordProPayload.version,
      title,
      timeline: importedChordProPayload.timeline,
      sections: [...importedChordProPayload.sections],
      measures: preservedMeasures,
      instrumentTracks: [...importedChordProPayload.instrumentTracks],
      metadata: {
        ...(importedChordProPayload.metadata ?? {}),
        isAiDraft: true,
        isAudioDerived: true,
        approvalStatus: 'DRAFT_REVIEW_REQUIRED',
        audioAssetId: asset.id,
        sourceAudioAssetId: asset.id,
        audioFilename: asset.filename,
        audioChecksumSha256: asset.checksumSha256,
        sourceAudioSha256: asset.checksumSha256,
        analysisVersion: analysis.analysisVersion,
        transcriptionVersion: TRANSCRIPTION_VERSION,
        overallConfidence: analysis.overallConfidence,
        key: resolvedKey ?? undefined,
        bpm: resolvedBpm ?? undefined,
        timeSignature: resolvedTimeSig ?? undefined,
        noteExtractionStatus: analysis.noteExtractionStatus,
        noteExtractionReason: repairLegacyUtf8Text(analysis.noteExtractionReason),
        instrument: selectedInstrument,
      },
    });
    const harmonicEvidenceSummary = this.computeHarmonicEvidenceBreakdown(draftPayload);
    return new CanonicalMusicPayload({
      version: draftPayload.version,
      title: draftPayload.title,
      timeline: draftPayload.timeline,
      sections: [...draftPayload.sections],
      measures: [...draftPayload.measures],
      instrumentTracks: [...draftPayload.instrumentTracks],
      metadata: {
        ...draftPayload.metadata,
        harmonicEvidenceSummary,
      },
    });
  }

  private generateTargetArtifacts(
    payload: CanonicalMusicPayload,
    analysis: PythonWorkerAnalysisResult,
    verifiedLyrics: string,
    selectedInstrument: SupportedReviewInstrument
  ): Record<string, GeneratedTargetArtifact> {
    const allChords = payload.getAllChords();
    const allNotes = payload.getAllNotes();
    const allLyrics = payload.getAllLyrics();
    const breakdown = this.computeHarmonicEvidenceBreakdown(payload);
    const breakdownClause = this.formatEvidenceSummaryClause(breakdown);
    const repairedAnalysis = this.repairLegacyUtf8AnalysisStrings(analysis);

    const evalMap = new Map<string, PythonWorkerTargetEvaluation>(
      (repairedAnalysis.targetEvaluations ?? []).map((e) => [e.format, e])
    );

    // A. CHORD_PRO / Lead Sheet
    let chordProArtifact: GeneratedTargetArtifact;
    if (allChords.length > 0 || allLyrics.length > 0) {
      const exported = CanonicalToChordProSerializer.serialize(payload);
      const headerComments = [
        `{comment: Borrador derivado de audio (${repairedAnalysis.analysisVersion} / ${TRANSCRIPTION_VERSION}) — Revisión humana obligatoria}`,
        `{comment: Evidencia armónica: ${allChords.length} acordes (${breakdownClause}) | Notas melódicas: ${allNotes.length}}`,
        `{comment: Confianza global: ${Math.round(repairedAnalysis.overallConfidence * 100)}% | Tonalidad: ${repairedAnalysis.key ?? 'No resuelta'} (${Math.round(repairedAnalysis.keyConfidence * 100)}%) | Tempo: ${repairedAnalysis.bpm ?? '—'} BPM (${Math.round(repairedAnalysis.bpmConfidence * 100)}%)}`,
      ].join('\n');
      const rawText = String(exported.content);
      const lines = rawText.split('\n');
      const blankIdx = lines.findIndex((l) => l.trim() === '');
      if (blankIdx !== -1) {
        lines.splice(blankIdx, 0, headerComments);
      } else {
        lines.unshift(headerComments);
      }
      const conf = evalMap.get('CHORD_PRO')?.confidence ?? repairedAnalysis.overallConfidence;
      chordProArtifact = {
        format: 'CHORD_PRO',
        status: conf >= 0.55 ? 'DRAFT_READY' : 'REVIEW_REQUIRED',
        generatable: true,
        confidence: conf,
        reason: `Guion armónico ChordPro con ${allChords.length} eventos (${breakdownClause}) en ${payload.measures.length} compases.`,
        filename: exported.filename,
        mimeType: 'text/plain',
        isBinary: false,
        content: lines.join('\n'),
      };
    } else {
      chordProArtifact = {
        format: 'CHORD_PRO',
        status: 'NOT_GENERATABLE',
        generatable: false,
        confidence: 0,
        reason:
          evalMap.get('CHORD_PRO')?.reason ??
          'La grabación no proporcionó evidencia armónica ni acordes suficientes para generar ChordPro.',
        filename: `${payload.title}.cho`,
        mimeType: 'text/plain',
        isBinary: false,
        content: null,
      };
    }

    // B. MUSIC_XML (Partitura MusicXML 4.0)
    let musicXmlArtifact: GeneratedTargetArtifact;
    if (allChords.length > 0 || allNotes.length > 0) {
      const exported = CanonicalToMusicXmlSerializer.serialize(payload);
      const xmlStr = String(exported.content);
      const isValidXml =
        xmlStr.includes('<?xml') &&
        xmlStr.includes('<score-partwise version="4.0">') &&
        xmlStr.includes('<measure');
      const conf = evalMap.get('MUSIC_XML')?.confidence ?? repairedAnalysis.overallConfidence;
      musicXmlArtifact = {
        format: 'MUSIC_XML',
        status: isValidXml ? (allNotes.length > 0 && conf >= 0.65 ? 'DRAFT_READY' : 'REVIEW_REQUIRED') : 'NOT_GENERATABLE',
        generatable: isValidXml,
        confidence: conf,
        reason:
          allNotes.length > 0
            ? `Partitura MusicXML 4.0 generada con ${allNotes.length} notas verificadas y ${allChords.length} acordes (${breakdownClause}).`
            : `Guion armónico estructural MusicXML 4.0 (${payload.measures.length} compases; 0 notas melódicas): ${allChords.length} eventos armónicos (${breakdownClause}).`,
        filename: exported.filename,
        mimeType: exported.mimeType,
        isBinary: false,
        content: isValidXml ? xmlStr : null,
      };
    } else {
      musicXmlArtifact = {
        format: 'MUSIC_XML',
        status: 'NOT_GENERATABLE',
        generatable: false,
        confidence: 0,
        reason: 'Sin eventos musicales ni evidencia armónica suficiente para construir MusicXML 4.0.',
        filename: `${payload.title}.musicxml`,
        mimeType: 'application/vnd.recordare.musicxml+xml',
        isBinary: false,
        content: null,
      };
    }

    // C. MIDI (SOLO cuando existen notas melódicas con timing verificado y MidiExportGatekeeper lo aprueba)
    let midiArtifact: GeneratedTargetArtifact;
    const midiEligibility = MidiExportGatekeeper.isEligible(payload);
    if (allNotes.length > 0 && midiEligibility.eligible) {
      const exported = CanonicalToMidiSerializer.serialize(payload);
      if (exported.success && exported.content instanceof Uint8Array && exported.content.byteLength > 0) {
        const b64 = Buffer.from(exported.content).toString('base64');
        const conf = evalMap.get('MIDI')?.confidence ?? repairedAnalysis.monophonicSalience;
        midiArtifact = {
          format: 'MIDI',
          status: conf >= 0.7 ? 'DRAFT_READY' : 'REVIEW_REQUIRED',
          generatable: true,
          confidence: conf,
          reason: `Secuencia MIDI SMF 1 generada con ${allNotes.length} eventos de notas verificados.`,
          filename: exported.filename,
          mimeType: 'audio/midi',
          isBinary: true,
          content: b64,
        };
      } else {
        midiArtifact = {
          format: 'MIDI',
          status: 'NOT_GENERATABLE',
          generatable: false,
          confidence: 0,
          reason:
            exported.diagnostics[0]?.message ??
            'No se pudo generar MIDI válido a partir de los eventos detectados.',
          filename: `${payload.title}.mid`,
          mimeType: 'audio/midi',
          isBinary: true,
          content: null,
        };
      }
    } else {
      midiArtifact = {
        format: 'MIDI',
        status: 'NOT_GENERATABLE',
        generatable: false,
        confidence: 0,
        reason: repairLegacyUtf8Text(
          evalMap.get('MIDI')?.reason ??
            midiEligibility.reason ??
            'NOT_GENERATABLE: La grabación no contiene eventos de notas individuales con timing suficientemente verificado (Cero Fabricación).'
        ),
        filename: `${payload.title}.mid`,
        mimeType: 'audio/midi',
        isBinary: true,
        content: null,
      };
    }

    // D. TABLATURE (SOLO para Guitarra o Bajo cuando existen notas verificadas)
    let tabArtifact: GeneratedTargetArtifact;
    const isStringInstrument = selectedInstrument === 'GUITAR' || selectedInstrument === 'BASS';
    if (allNotes.length > 0 && isStringInstrument) {
      const exported = CanonicalToTablatureSerializer.serialize(payload, {
        instrument: selectedInstrument === 'BASS' ? 'BASS' : 'GUITAR',
      });
      const conf = evalMap.get('TABLATURE')?.confidence ?? repairedAnalysis.monophonicSalience;
      tabArtifact = {
        format: 'TABLATURE',
        status: conf >= 0.7 ? 'DRAFT_READY' : 'REVIEW_REQUIRED',
        generatable: true,
        confidence: conf,
        reason: `Tablatura ASCII para ${selectedInstrument === 'BASS' ? 'Bajo (4 cuerdas)' : 'Guitarra (6 cuerdas)'} calculada sobre ${allNotes.length} notas verificadas.`,
        filename: exported.filename,
        mimeType: 'text/plain',
        isBinary: false,
        content: String(exported.content),
        instrument: selectedInstrument,
      };
    } else {
      const reason = repairLegacyUtf8Text(
        !isStringInstrument
          ? `El instrumento seleccionado (${selectedInstrument}) no utiliza tablatura de trastes; seleccione Guitarra o Bajo con notas verificadas.`
          : evalMap.get('TABLATURE')?.reason ??
            'NOT_GENERATABLE: No se fabrican posiciones de guitarra o bajo sin eventos de notas individuales verificados.'
      );
      tabArtifact = {
        format: 'TABLATURE',
        status: 'NOT_GENERATABLE',
        generatable: false,
        confidence: 0,
        reason,
        filename: `${payload.title}.tab`,
        mimeType: 'text/plain',
        isBinary: false,
        content: null,
        instrument: selectedInstrument,
      };
    }

    // E. LYRICS_ONLY (SOLO cuando existe letra verificada)
    let lyricsArtifact: GeneratedTargetArtifact;
    if (verifiedLyrics.trim().length > 0 || allLyrics.length > 0) {
      const exported = CanonicalToLyricsSerializer.serialize(payload);
      const textContent = String(exported.content).trim() || verifiedLyrics.trim();
      lyricsArtifact = {
        format: 'LYRICS_ONLY',
        status: 'DRAFT_READY',
        generatable: true,
        confidence: 1.0,
        reason: 'Texto lírico verificado e integrado al borrador musical.',
        filename: exported.filename,
        mimeType: 'text/plain',
        isBinary: false,
        content: textContent,
      };
    } else {
      lyricsArtifact = {
        format: 'LYRICS_ONLY',
        status: 'REVIEW_REQUIRED',
        generatable: false,
        confidence: 0,
        reason:
          'El motor acústico DSP no inventa letra vocal a partir del audio. Puede ingresar letra verificada en el panel de Revisión Humana para habilitar este formato.',
        filename: `${payload.title}_letra.txt`,
        mimeType: 'text/plain',
        isBinary: false,
        content: null,
      };
    }

    return {
      CHORD_PRO: chordProArtifact,
      MUSIC_XML: musicXmlArtifact,
      MIDI: midiArtifact,
      TABLATURE: tabArtifact,
      LYRICS_ONLY: lyricsArtifact,
    };
  }

  private buildFallbackChordProHeader(
    title: string,
    key: string | null,
    bpm: number | null,
    timeSig: string | null,
    analysis: PythonWorkerAnalysisResult
  ): string {
    const lines = [`{title: ${title}}`];
    if (key) lines.push(`{key: ${key}}`);
    if (bpm) lines.push(`{tempo: ${bpm}}`);
    if (timeSig) lines.push(`{time: ${timeSig}}`);
    lines.push(
      `{comment: Análisis acústico estado ${analysis.overallStatus} (confianza ${Math.round(analysis.overallConfidence * 100)}%). Complete o edite los acordes durante la revisión humana.}`
    );
    return lines.join('\n') + '\n';
  }

  private computeHarmonicEvidenceBreakdown(payload: CanonicalMusicPayload): HarmonicEvidenceBreakdown {
    const allChords = payload.getAllChords();
    let detectedCount = 0;
    let estimatedCount = 0;
    let ambiguousCount = 0;
    let humanVerifiedCount = 0;
    for (const ce of allChords) {
      if (ce.evidenceStatus === 'HUMAN_VERIFIED') humanVerifiedCount += 1;
      else if (ce.evidenceStatus === 'DETECTED') detectedCount += 1;
      else if (ce.evidenceStatus === 'AMBIGUOUS') ambiguousCount += 1;
      else estimatedCount += 1;
    }
    return {
      totalChords: allChords.length,
      detectedCount,
      estimatedCount,
      ambiguousCount,
      humanVerifiedCount,
      melodicNotesCount: payload.getAllNotes().length,
    };
  }

  private formatEvidenceSummaryClause(breakdown: HarmonicEvidenceBreakdown): string {
    const det = breakdown.detectedCount === 1 ? '1 detectado' : `${breakdown.detectedCount} detectados`;
    const est = breakdown.estimatedCount === 1 ? '1 estimado' : `${breakdown.estimatedCount} estimados`;
    const amb = breakdown.ambiguousCount === 1 ? '1 ambiguo' : `${breakdown.ambiguousCount} ambiguos`;
    const hum =
      breakdown.humanVerifiedCount === 1
        ? '1 verificado por humano'
        : `${breakdown.humanVerifiedCount} verificados por humano`;
    return `${det}, ${est}, ${amb}, ${hum}`;
  }

  private repairLegacyUtf8AnalysisStrings(analysis: PythonWorkerAnalysisResult): PythonWorkerAnalysisResult {
    return {
      ...analysis,
      noteExtractionReason: repairLegacyUtf8Text(analysis.noteExtractionReason),
      stages: (analysis.stages ?? []).map((st) => ({
        ...st,
        summary: repairLegacyUtf8Text(st.summary),
        details:
          st.details && typeof st.details['noteExtractionReason'] === 'string'
            ? {
                ...st.details,
                noteExtractionReason: repairLegacyUtf8Text(st.details['noteExtractionReason']),
              }
            : st.details,
      })),
      targetEvaluations: (analysis.targetEvaluations ?? []).map((te) => ({
        ...te,
        reason: repairLegacyUtf8Text(te.reason),
      })),
      warnings: (analysis.warnings ?? []).map((w) => repairLegacyUtf8Text(w)),
    };
  }

  private computeEvidenceFromRawAnalysisAndCanonical(
    canonicalJson: CanonicalMusicPayloadJSON,
    analysis: PythonWorkerAnalysisResult
  ): HarmonicEvidenceBreakdown {
    const canonical = CanonicalDeserializer.deserialize(canonicalJson);
    const allChords = canonical.getAllChords();
    const hasExplicitStatus = allChords.some((c) => c.evidenceStatus !== undefined);
    if (hasExplicitStatus || allChords.length === 0) {
      return this.computeHarmonicEvidenceBreakdown(canonical);
    }
    // Respaldo para payloads legados previos a Scope 1C-final: derivar desde analysis.chordTimeline
    let detectedCount = 0;
    let estimatedCount = 0;
    let ambiguousCount = 0;
    for (const seg of analysis.chordTimeline ?? []) {
      if (seg.status === 'DETECTED') detectedCount += 1;
      else if (seg.status === 'AMBIGUOUS' || seg.status === 'UNSUPPORTED') ambiguousCount += 1;
      else estimatedCount += 1;
    }
    return {
      totalChords: allChords.length,
      detectedCount,
      estimatedCount,
      ambiguousCount,
      humanVerifiedCount: 0,
      melodicNotesCount: canonical.getAllNotes().length,
    };
  }

  private async mapProposalRowToDto(
    row: typeof omrProposals.$inferSelect,
    asset: AudioAsset
  ): Promise<AudioDraftProposalDTO> {
    const raw = (row.rawPayload as Record<string, unknown>) ?? {};
    const [song] = await this.db
      .select({ title: songs.title })
      .from(songs)
      .where(eq(songs.id, asset.songId))
      .limit(1);

    const workflowState =
      (raw['workflowState'] as AudioConversionWorkflowState | undefined) ??
      (row.reviewStatus === 'COMMITTED'
        ? 'APPROVED'
        : row.reviewStatus === 'REJECTED'
        ? 'REJECTED'
        : 'REVIEW_REQUIRED');

    const repairedAnalysis = this.repairLegacyUtf8AnalysisStrings(
      raw['analysisSummary'] as PythonWorkerAnalysisResult
    );
    const rawTargets = (raw['targets'] as Record<string, GeneratedTargetArtifact>) ?? {};
    const repairedTargets: Record<string, GeneratedTargetArtifact> = {};
    for (const [k, t] of Object.entries(rawTargets)) {
      repairedTargets[k] = {
        ...t,
        reason: repairLegacyUtf8Text(t.reason),
      };
    }
    const canonicalJson = raw['proposedCanonicalPayload'] as CanonicalMusicPayloadJSON;
    const harmonicEvidenceSummary = this.computeEvidenceFromRawAnalysisAndCanonical(
      canonicalJson,
      repairedAnalysis
    );

    return {
      proposalId: row.id,
      jobId: row.jobId ?? null,
      audioAssetId: asset.id,
      songId: asset.songId,
      songTitle: song?.title ?? String(raw['songTitle'] ?? asset.title),
      sourceFilename: asset.filename,
      sourceSha256: asset.checksumSha256,
      workflowState,
      reviewStatus: row.reviewStatus,
      isAiDraft: row.isAiDraft,
      analysisVersion: String(raw['analysisVersion'] ?? 'ws-audio-02-v1.0'),
      transcriptionVersion: String(raw['transcriptionVersion'] ?? TRANSCRIPTION_VERSION),
      title: row.detectedTitle ?? asset.title,
      detectedKey: row.detectedKey ?? null,
      detectedBpm: row.detectedBpm ?? null,
      detectedTimeSignature: row.detectedTimeSignature ?? null,
      overallConfidence: row.overallConfidence,
      selectedInstrument: (raw['selectedInstrument'] as SupportedReviewInstrument) ?? 'GUITAR',
      verifiedLyrics: String(raw['verifiedLyrics'] ?? ''),
      proposedChordPro: String(raw['proposedChordPro'] ?? ''),
      proposedCanonicalPayload: canonicalJson,
      analysisSummary: repairedAnalysis,
      targets: repairedTargets,
      changesMadeDuringReview: Array.isArray(raw['changesMadeDuringReview'])
        ? (raw['changesMadeDuringReview'] as AudioDraftReviewChangeRecord[])
        : [],
      approvalMetadata: (raw['approvalMetadata'] as AudioDraftApprovalMetadata | null) ?? null,
      harmonicEvidenceSummary,
      createdAt: row.createdAt.toISOString(),
      reviewedAt: row.reviewedAt ? row.reviewedAt.toISOString() : null,
      reviewedByUserId: row.reviewedByUserId ?? null,
    };
  }
}
