/**
 * @file audio-service.ts
 * @description Servicio de aplicación para la gestión del ciclo de vida de audio (Workstream A / R1).
 * Orquesta validaciones de MIME, verificación de magic bytes binarios, cuotas, almacenamiento físico,
 * persistencia en BD y streaming conforme con soporte estricto de HTTP Range (RFC 7233 / 9110).
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { type IAudioRepository } from '../repositories/audio-repository.ts';
import { type IAudioStorageProvider } from '../domain/audio/storage-provider.ts';
import { type ISongRepository } from '../repositories/song-repository.ts';
import { DrizzleAuditLogRepository, type IAuditLogRepository } from '../repositories/audit-repository.ts';
import type { AuditLogEntity } from '../domain/auth-types.ts';
import { type AudioAsset } from '../db/schema.ts';
import { ValidationError, NotFoundError, PersistenceError, RangeNotSatisfiableError } from '../domain/errors.ts';
import { validateAudioBuffer } from '../domain/audio/audio-signature-validator.ts';
import {
  PythonAudioWorkerBridge,
  PythonWorkerError,
  globalPythonAudioWorkerBridge,
  type InspectAudioOptions,
  type PythonWorkerInspectResult,
} from '../infrastructure/python-worker/python-audio-worker-bridge.ts';

export interface UploadAudioParams {
  readonly songId: string;
  readonly title: string;
  readonly filename: string;
  readonly mimeType: string;
  readonly buffer: Buffer;
  readonly durationSeconds?: number | undefined;
  readonly uploadedByUserId?: string | undefined;
  readonly verifyWithPythonWorker?: boolean | undefined;
}

export interface AudioUploadCompensationReport {
  readonly attempted: boolean;
  readonly succeeded: boolean;
  readonly storagePath: string;
  readonly checksumSha256: string;
  readonly fileSizeBytes: number;
  readonly compensationError?: string | undefined;
  readonly recoveryRecordId?: string | undefined;
  readonly persistedToAuditLog: boolean;
  readonly durablyRecorded: boolean;
  readonly recordedAt: string;
}

export type AudioRecoveryType =
  | 'UPLOAD_COMPENSATION_ORPHAN'
  | 'DELETE_PHYSICAL_FAILED'
  | 'DELETE_DB_FAILED_AFTER_PHYSICAL_DELETE';

export type AudioRecoveryStatus =
  | 'PENDING_RECOVERY'
  | 'ABORTED_DB_PRESERVED'
  | 'RECOVERED'
  | 'MANUAL_INTERVENTION_REQUIRED';

export type AudioRecoveryLifecycleState =
  | 'OPERATION_FAILURE'
  | 'RECOVERY_PENDING'
  | 'RECOVERY_COMPLETED'
  | 'MANUAL_INTERVENTION_REQUIRED';

export const AUDIO_RECOVERY_EVENT_TYPES = [
  'AUDIO_UPLOAD_COMPENSATION_FAILED',
  'AUDIO_DELETE_PHYSICAL_FAILED',
  'AUDIO_DELETE_DB_FAILED_AFTER_PHYSICAL_DELETE',
  'AUDIO_RECOVERY_COMPLETED',
  'AUDIO_ORPHAN_FILE_PURGED',
] as const;

export interface AudioMalformedRecoveryAuditEntry {
  readonly auditLogId: string;
  readonly eventType: string;
  readonly resource: string | null;
  readonly storagePath?: string | undefined;
  readonly reason: string;
  readonly rawMetadata: Record<string, unknown>;
  readonly detectedAt: string;
  readonly lifecycleState: 'MANUAL_INTERVENTION_REQUIRED';
}

export interface AudioRecoveryRehydrationReport {
  readonly rehydrationSucceeded: boolean;
  readonly scannedAuditEvents: number;
  readonly reconstructedRecords: number;
  readonly pendingCount: number;
  readonly completedCount: number;
  readonly manualInterventionCount: number;
  readonly malformedEvents: AudioMalformedRecoveryAuditEntry[];
  readonly error?: string | undefined;
}

export interface AudioStorageRecoveryRecord {
  id: string;
  recoveryType: AudioRecoveryType;
  status: AudioRecoveryStatus;
  lifecycleState: AudioRecoveryLifecycleState;
  storagePath: string;
  assetId?: string | undefined;
  songId: string;
  filename: string;
  mimeType: string;
  checksumSha256: string;
  fileSizeBytes: number;
  primaryError: string;
  secondaryError?: string | undefined;
  persistedToAuditLog: boolean;
  durablyRecorded: boolean;
  auditLogId?: string | undefined;
  aliasRecoveryIds?: string[] | undefined;
  createdAt: string;
  recoveredAt?: string | undefined;
}

export interface AudioStorageReconciliationOptions {
  readonly purgeOrphanFiles?: boolean | undefined;
  readonly recoverFailedOperations?: boolean | undefined;
  readonly minOrphanAgeMs?: number | undefined;
}

export interface AudioStorageReconciliationReport {
  readonly checkedAssets: number;
  readonly healthyAssetIds: string[];
  readonly missingPhysicalFiles: Array<{ assetId: string; storagePath: string }>;
  readonly corruptedPhysicalFiles: Array<{ assetId: string; storagePath: string; reason: string }>;
  readonly orphanFiles: string[];
  readonly purgedOrphanFiles: string[];
  readonly skippedInFlightFiles: string[];
  readonly ambiguousFiles: Array<{ storagePath: string; reason: string }>;
  readonly failedOrphanPurges: Array<{ storagePath: string; reason: string }>;
  readonly pendingRecoveryRecords: AudioStorageRecoveryRecord[];
  readonly manualInterventionRecords: AudioStorageRecoveryRecord[];
  readonly malformedRecoveryEvents: AudioMalformedRecoveryAuditEntry[];
  readonly rehydrationReport: AudioRecoveryRehydrationReport;
  readonly recoveredOperations: Array<{
    recoveryRecordId: string;
    recoveryType: AudioRecoveryType;
    target: string;
  }>;
  readonly auditLogIds: string[];
}

export interface AudioStartupRecoveryLogger {
  info(obj: Record<string, unknown>, msg?: string): void;
  warn(obj: Record<string, unknown>, msg?: string): void;
  error(obj: Record<string, unknown>, msg?: string): void;
}

export interface AudioStartupRecoveryOptions {
  readonly enabled?: boolean | undefined;
  readonly purgeConfirmedOrphans?: boolean | undefined;
  readonly minOrphanAgeMs?: number | undefined;
  readonly logger?: AudioStartupRecoveryLogger | undefined;
}

export type AudioStartupRecoveryOutcome =
  | 'NOT_RUN'
  | 'SKIPPED_DISABLED'
  | 'COMPLETED'
  | 'DEGRADED_MANUAL_ACTION_REQUIRED'
  | 'FAILED_NON_FATAL';

export interface AudioStartupRecoveryStatus {
  readonly invoked: boolean;
  readonly enabled: boolean;
  readonly purgeConfirmedOrphansConfigured: boolean;
  readonly status: AudioStartupRecoveryOutcome;
  readonly startedAt?: string | undefined;
  readonly completedAt?: string | undefined;
  readonly rehydrationSucceeded: boolean;
  readonly destructiveRecoveryBlocked: boolean;
  readonly reconciliationReport?: AudioStorageReconciliationReport | undefined;
  readonly error?: string | undefined;
}

export interface AudioStreamResponse {
  readonly stream: NodeJS.ReadableStream;
  readonly statusCode: 200 | 206;
  readonly headers: Record<string, string | number>;
}

export interface AudioDownloadResponse {
  readonly buffer: Buffer;
  readonly filename: string;
  readonly mimeType: string;
  readonly fileSizeBytes: number;
  readonly checksumSha256: string;
}

const ALLOWED_MIME_TYPES = new Set([
  'audio/mpeg',
  'audio/mp3',
  'audio/wav',
  'audio/wave',
  'audio/x-wav',
  'audio/ogg',
  'audio/mp4',
  'audio/aac',
  'audio/x-m4a',
  'audio/m4a',
  'audio/webm',
  'audio/flac',
]);

const ALLOWED_AUDIO_EXTENSIONS = new Set([
  '.mp3',
  '.wav',
  '.wave',
  '.ogg',
  '.m4a',
  '.mp4',
  '.aac',
  '.flac',
  '.webm',
]);

/**
 * Valida la firma binaria ("magic bytes") del archivo para prevenir falsificación MIME.
 */
export function validateAudioMagicBytes(buffer: Buffer, mimeType: string): void {
  if (!buffer || buffer.length < 4) {
    throw new ValidationError('El archivo es demasiado pequeño para contener una cabecera de audio válida.');
  }

  const normalized = mimeType.toLowerCase().trim();

  // Caso especial: WebM (EBML container)
  if (normalized === 'audio/webm') {
    const isEbml =
      buffer[0] === 0x1a && buffer[1] === 0x45 && buffer[2] === 0xdf && buffer[3] === 0xa3;
    if (!isEbml) {
      throw new ValidationError(
        'El archivo no posee una firma válida de audio WebM (falta encabezado EBML). Posible falsificación MIME.'
      );
    }
    return;
  }

  // Validación binaria profunda universal (MP3 con/sin ID3, WAV, FLAC, OGG, M4A, AAC)
  validateAudioBuffer(buffer, normalized);
}

export class AudioService {
  private readonly inFlightUploadPaths = new Set<string>();
  private readonly recoveryRecords = new Map<string, AudioStorageRecoveryRecord>();
  private readonly aliasToCanonicalId = new Map<string, string>();
  private readonly malformedAuditEntries = new Map<string, AudioMalformedRecoveryAuditEntry>();
  private readonly malformedStoragePaths = new Set<string>();
  private recoveryLockChain: Promise<unknown> = Promise.resolve();
  private activeStartupRecoveryPromise: Promise<AudioStartupRecoveryStatus> | null = null;
  private lastReconciliationReport: AudioStorageReconciliationReport | null = null;
  private lastStartupRecoveryStatus: AudioStartupRecoveryStatus = {
    invoked: false,
    enabled: true,
    purgeConfirmedOrphansConfigured: false,
    status: 'NOT_RUN',
    rehydrationSucceeded: false,
    destructiveRecoveryBlocked: false,
  };

  public constructor(
    private readonly audioRepo: IAudioRepository,
    private readonly storageProvider: IAudioStorageProvider,
    private readonly songRepo: ISongRepository,
    private readonly maxFileSizeBytes: number = 50 * 1024 * 1024, // 50MB
    private readonly pythonWorkerBridge: PythonAudioWorkerBridge = globalPythonAudioWorkerBridge,
    private readonly auditRepo: IAuditLogRepository = new DrizzleAuditLogRepository()
  ) {}

  private async withRecoveryLock<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.recoveryLockChain.then(fn, fn);
    this.recoveryLockChain = next.then(
      () => undefined,
      () => undefined
    );
    return next;
  }

  public getLastReconciliationReport(): AudioStorageReconciliationReport | null {
    return this.lastReconciliationReport ? { ...this.lastReconciliationReport } : null;
  }

  public getLastStartupRecoveryStatus(): AudioStartupRecoveryStatus {
    return { ...this.lastStartupRecoveryStatus };
  }

  /**
   * Retorna una instantánea de los registros de recuperación de fallos de almacenamiento registrados o rehidratados.
   */
  public getRecoveryRecords(): AudioStorageRecoveryRecord[] {
    return Array.from(this.recoveryRecords.values()).map((r) => ({ ...r }));
  }

  /**
   * Retorna las entradas de auditoría de recuperación con metadatos inválidos o incompletos que requieren revisión manual.
   */
  public getMalformedRecoveryAuditEntries(): AudioMalformedRecoveryAuditEntry[] {
    return Array.from(this.malformedAuditEntries.values()).map((e) => ({ ...e }));
  }

  private static getRecoveryTargetKey(
    recoveryType: AudioRecoveryType,
    storagePath: string,
    assetId?: string
  ): string {
    return `${recoveryType}::${assetId ?? ''}::${storagePath}`;
  }

  private static mapAuditEventToRecoveryType(eventType: string): AudioRecoveryType | null {
    switch (eventType) {
      case 'AUDIO_UPLOAD_COMPENSATION_FAILED':
        return 'UPLOAD_COMPENSATION_ORPHAN';
      case 'AUDIO_DELETE_PHYSICAL_FAILED':
        return 'DELETE_PHYSICAL_FAILED';
      case 'AUDIO_DELETE_DB_FAILED_AFTER_PHYSICAL_DELETE':
        return 'DELETE_DB_FAILED_AFTER_PHYSICAL_DELETE';
      default:
        return null;
    }
  }

  private static getEventReplayPriority(eventType: string): number {
    switch (eventType) {
      case 'AUDIO_UPLOAD_COMPENSATION_FAILED':
      case 'AUDIO_DELETE_PHYSICAL_FAILED':
      case 'AUDIO_DELETE_DB_FAILED_AFTER_PHYSICAL_DELETE':
        return 1;
      case 'AUDIO_ORPHAN_FILE_PURGED':
        return 2;
      case 'AUDIO_RECOVERY_COMPLETED':
        return 3;
      default:
        return 9;
    }
  }

  private static nonEmptyString(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  private parseFailureAuditEvent(
    event: AuditLogEntity
  ):
    | { ok: true; record: AudioStorageRecoveryRecord }
    | { ok: false; malformed: AudioMalformedRecoveryAuditEntry } {
    const recoveryType = AudioService.mapAuditEventToRecoveryType(event.eventType);
    const meta =
      event.metadata && typeof event.metadata === 'object' && !Array.isArray(event.metadata)
        ? (event.metadata as Record<string, unknown>)
        : null;

    const rawCandidatePath =
      AudioService.nonEmptyString(meta?.['storagePath']) ??
      AudioService.nonEmptyString(event.resource) ??
      undefined;

    const fail = (reason: string): { ok: false; malformed: AudioMalformedRecoveryAuditEntry } => ({
      ok: false,
      malformed: {
        auditLogId: event.id,
        eventType: event.eventType,
        resource: event.resource ?? null,
        ...(rawCandidatePath ? { storagePath: rawCandidatePath } : {}),
        reason,
        rawMetadata: meta ?? {},
        detectedAt: new Date().toISOString(),
        lifecycleState: 'MANUAL_INTERVENTION_REQUIRED',
      },
    });

    if (!recoveryType || !meta) {
      return fail('Metadatos de recuperación ausentes o con estructura inválida.');
    }

    const recoveryRecordId = AudioService.nonEmptyString(meta['recoveryRecordId']);
    if (!recoveryRecordId) {
      return fail('Falta recoveryRecordId obligatorio en el evento de auditoría.');
    }

    const storagePath = AudioService.nonEmptyString(meta['storagePath']);
    if (!storagePath) {
      return fail('Falta storagePath obligatorio en el evento de auditoría.');
    }

    try {
      this.storageProvider.resolveSafePath(storagePath);
    } catch (pathErr) {
      return fail(
        `storagePath inválido o inseguro en evento de recuperación: ${
          pathErr instanceof Error ? pathErr.message : String(pathErr)
        }`
      );
    }

    const songId = AudioService.nonEmptyString(meta['songId']);
    if (!songId) {
      return fail('Falta songId obligatorio en el evento de recuperación.');
    }

    const filename = AudioService.nonEmptyString(meta['filename']);
    if (!filename) {
      return fail('Falta filename obligatorio en el evento de recuperación.');
    }

    const mimeType = AudioService.nonEmptyString(meta['mimeType']);
    if (!mimeType) {
      return fail('Falta mimeType obligatorio en el evento de recuperación.');
    }

    const checksumSha256 = AudioService.nonEmptyString(meta['checksumSha256']);
    if (!checksumSha256 || !/^[0-9a-fA-F]{64}$/.test(checksumSha256)) {
      return fail('checksumSha256 ausente o sin formato hexadecimal SHA-256 válido de 64 caracteres.');
    }

    const fileSizeRaw = meta['fileSizeBytes'];
    if (
      typeof fileSizeRaw !== 'number' ||
      !Number.isInteger(fileSizeRaw) ||
      fileSizeRaw <= 0
    ) {
      return fail('fileSizeBytes ausente o no es un entero positivo válido.');
    }

    const assetId = AudioService.nonEmptyString(meta['assetId']) ?? undefined;
    if (
      (recoveryType === 'DELETE_PHYSICAL_FAILED' ||
        recoveryType === 'DELETE_DB_FAILED_AFTER_PHYSICAL_DELETE') &&
      !assetId
    ) {
      return fail(`Falta assetId obligatorio para recuperación de tipo '${recoveryType}'.`);
    }

    const primaryError =
      AudioService.nonEmptyString(meta['primaryError']) ??
      AudioService.nonEmptyString(meta['cause']) ??
      'Error registrado sin descripción detallada';
    const secondaryError =
      AudioService.nonEmptyString(meta['compensationError']) ?? undefined;
    const createdAt =
      AudioService.nonEmptyString(meta['recordedAt']) ??
      AudioService.nonEmptyString(meta['createdAt']) ??
      event.createdAt.toISOString();

    const isAbortedPhysical = recoveryType === 'DELETE_PHYSICAL_FAILED';

    return {
      ok: true,
      record: {
        id: recoveryRecordId,
        recoveryType,
        status: isAbortedPhysical ? 'ABORTED_DB_PRESERVED' : 'PENDING_RECOVERY',
        lifecycleState: isAbortedPhysical ? 'OPERATION_FAILURE' : 'RECOVERY_PENDING',
        storagePath,
        ...(assetId ? { assetId } : {}),
        songId,
        filename,
        mimeType,
        checksumSha256: checksumSha256.toLowerCase(),
        fileSizeBytes: fileSizeRaw,
        primaryError,
        ...(secondaryError ? { secondaryError } : {}),
        persistedToAuditLog: true,
        durablyRecorded: true,
        auditLogId: event.id,
        createdAt,
      },
    };
  }

  /**
   * Rehidrata de forma determinística e idempotente el estado de recuperación pendiente, completado
   * o inválido desde los eventos durables en PostgreSQL `audit_logs`.
   * Serializado mediante bloqueo de recuperación para evitar carreras concurrentes.
   */
  public async rehydrateRecoveryRecordsFromAuditLogs(): Promise<AudioRecoveryRehydrationReport> {
    return await this.withRecoveryLock(() => this.rehydrateRecoveryRecordsInternal());
  }

  private async rehydrateRecoveryRecordsInternal(): Promise<AudioRecoveryRehydrationReport> {
    const pageSize = 1000;
    const collectedEvents: AuditLogEntity[] = [];
    const seenEventIds = new Set<string>();

    try {
      let offset = 0;
      while (offset < 50_000) {
        const page = await this.auditRepo.list({
          eventTypes: [...AUDIO_RECOVERY_EVENT_TYPES],
          limit: pageSize,
          offset,
          orderDirection: 'asc',
        });

        let newlyAdded = 0;
        for (const ev of page) {
          if (!seenEventIds.has(ev.id)) {
            seenEventIds.add(ev.id);
            collectedEvents.push(ev);
            newlyAdded += 1;
          }
        }

        if (page.length < pageSize || newlyAdded === 0) {
          break;
        }
        offset += page.length;
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      const current = Array.from(this.recoveryRecords.values());
      return {
        rehydrationSucceeded: false,
        scannedAuditEvents: 0,
        reconstructedRecords: current.filter((r) => r.durablyRecorded).length,
        pendingCount: current.filter((r) => r.status === 'PENDING_RECOVERY').length,
        completedCount: current.filter((r) => r.status === 'RECOVERED').length,
        manualInterventionCount:
          current.filter((r) => r.status === 'MANUAL_INTERVENTION_REQUIRED').length +
          this.malformedAuditEntries.size,
        malformedEvents: this.getMalformedRecoveryAuditEntries(),
        error: `No se pudieron leer los eventos de recuperación desde PostgreSQL audit_logs: ${errorMsg}`,
      };
    }

    const relevantEvents = collectedEvents
      .filter((ev) =>
        (AUDIO_RECOVERY_EVENT_TYPES as readonly string[]).includes(ev.eventType)
      )
      .sort((a, b) => {
        const timeDiff = a.createdAt.getTime() - b.createdAt.getTime();
        if (timeDiff !== 0) return timeDiff;
        const prioDiff =
          AudioService.getEventReplayPriority(a.eventType) -
          AudioService.getEventReplayPriority(b.eventType);
        if (prioDiff !== 0) return prioDiff;
        return a.id.localeCompare(b.id);
      });

    // Preservar registros no durables en memoria y rehidratar determinísticamente desde eventos durables
    for (const [recId, existing] of this.recoveryRecords.entries()) {
      if (existing.durablyRecorded) {
        this.recoveryRecords.delete(recId);
      }
    }
    this.aliasToCanonicalId.clear();
    this.malformedAuditEntries.clear();
    this.malformedStoragePaths.clear();

    const targetToCanonicalId = new Map<string, string>();
    const completedTargetTimestamps = new Map<string, number>();

    for (const event of relevantEvents) {
      if (
        event.eventType === 'AUDIO_UPLOAD_COMPENSATION_FAILED' ||
        event.eventType === 'AUDIO_DELETE_PHYSICAL_FAILED' ||
        event.eventType === 'AUDIO_DELETE_DB_FAILED_AFTER_PHYSICAL_DELETE'
      ) {
        const parsed = this.parseFailureAuditEvent(event);
        if (!parsed.ok) {
          this.malformedAuditEntries.set(event.id, parsed.malformed);
          if (parsed.malformed.storagePath) {
            this.malformedStoragePaths.add(parsed.malformed.storagePath);
          }
          continue;
        }

        const candidate = parsed.record;
        const targetKey = AudioService.getRecoveryTargetKey(
          candidate.recoveryType,
          candidate.storagePath,
          candidate.assetId
        );

        const existingById =
          this.recoveryRecords.get(candidate.id) ??
          (() => {
            const aliased = this.aliasToCanonicalId.get(candidate.id);
            return aliased ? this.recoveryRecords.get(aliased) : undefined;
          })();

        if (existingById) {
          // Evento duplicado con el mismo ID: mantener estado actual (nunca resucitar RECOVERED ni MANUAL_INTERVENTION_REQUIRED)
          continue;
        }

        const existingCanonicalId = targetToCanonicalId.get(targetKey);
        if (existingCanonicalId) {
          const existingCanonical = this.recoveryRecords.get(existingCanonicalId);
          if (existingCanonical) {
            this.aliasToCanonicalId.set(candidate.id, existingCanonicalId);
            const aliases = new Set(existingCanonical.aliasRecoveryIds ?? []);
            if (candidate.id !== existingCanonicalId) {
              aliases.add(candidate.id);
              existingCanonical.aliasRecoveryIds = Array.from(aliases);
            }
            continue;
          }
        }

        // Si un target equivalente ya fue completado en una ventana igual o posterior, registrarlo como RECOVERED sin resucitarlo
        const completedTs = completedTargetTimestamps.get(targetKey);
        if (completedTs !== undefined && event.createdAt.getTime() <= completedTs) {
          candidate.status = 'RECOVERED';
          candidate.lifecycleState = 'RECOVERY_COMPLETED';
          candidate.recoveredAt = new Date(completedTs).toISOString();
        }

        this.recoveryRecords.set(candidate.id, candidate);
        targetToCanonicalId.set(targetKey, candidate.id);
      } else if (event.eventType === 'AUDIO_RECOVERY_COMPLETED') {
        const meta =
          event.metadata && typeof event.metadata === 'object' && !Array.isArray(event.metadata)
            ? (event.metadata as Record<string, unknown>)
            : null;
        const recId = AudioService.nonEmptyString(meta?.['recoveryRecordId']);
        const assetId = AudioService.nonEmptyString(meta?.['assetId']);
        const storagePath =
          AudioService.nonEmptyString(meta?.['storagePath']) ??
          AudioService.nonEmptyString(event.resource);
        const aliasIds = Array.isArray(meta?.['aliasRecoveryRecordIds'])
          ? (meta['aliasRecoveryRecordIds'] as unknown[])
              .map((v) => AudioService.nonEmptyString(v))
              .filter((v): v is string => v !== null)
          : [];

        if (!recId && !assetId && !storagePath) {
          this.malformedAuditEntries.set(event.id, {
            auditLogId: event.id,
            eventType: event.eventType,
            resource: event.resource ?? null,
            reason:
              'AUDIO_RECOVERY_COMPLETED carece de recoveryRecordId, assetId y storagePath para vincular la recuperación.',
            rawMetadata: meta ?? {},
            detectedAt: new Date().toISOString(),
            lifecycleState: 'MANUAL_INTERVENTION_REQUIRED',
          });
          continue;
        }

        const recoveredAtIso =
          AudioService.nonEmptyString(meta?.['recoveredAt']) ?? event.createdAt.toISOString();
        const recoveredAtMs = event.createdAt.getTime();
        const matchIds = new Set<string>([
          ...(recId ? [recId] : []),
          ...aliasIds,
        ]);

        for (const rec of this.recoveryRecords.values()) {
          const matchesId =
            matchIds.has(rec.id) ||
            Boolean(rec.aliasRecoveryIds?.some((a) => matchIds.has(a)));
          const matchesAsset = Boolean(assetId && rec.assetId === assetId);
          const matchesPath = Boolean(storagePath && rec.storagePath === storagePath);

          if (!matchesId && !matchesAsset && !matchesPath) {
            continue;
          }

          rec.status = 'RECOVERED';
          rec.lifecycleState = 'RECOVERY_COMPLETED';
          rec.recoveredAt = rec.recoveredAt ?? recoveredAtIso;

          const tKey = AudioService.getRecoveryTargetKey(
            rec.recoveryType,
            rec.storagePath,
            rec.assetId
          );
          completedTargetTimestamps.set(
            tKey,
            Math.max(completedTargetTimestamps.get(tKey) ?? 0, recoveredAtMs)
          );
        }
      } else if (event.eventType === 'AUDIO_ORPHAN_FILE_PURGED') {
        const meta =
          event.metadata && typeof event.metadata === 'object' && !Array.isArray(event.metadata)
            ? (event.metadata as Record<string, unknown>)
            : null;
        const storagePath =
          AudioService.nonEmptyString(meta?.['storagePath']) ??
          AudioService.nonEmptyString(event.resource);
        if (!storagePath) continue;

        const purgedAtIso =
          AudioService.nonEmptyString(meta?.['purgedAt']) ?? event.createdAt.toISOString();
        const purgedAtMs = event.createdAt.getTime();

        for (const rec of this.recoveryRecords.values()) {
          if (
            rec.recoveryType === 'UPLOAD_COMPENSATION_ORPHAN' &&
            rec.storagePath === storagePath
          ) {
            rec.status = 'RECOVERED';
            rec.lifecycleState = 'RECOVERY_COMPLETED';
            rec.recoveredAt = rec.recoveredAt ?? purgedAtIso;
            const tKey = AudioService.getRecoveryTargetKey(
              rec.recoveryType,
              rec.storagePath,
              rec.assetId
            );
            completedTargetTimestamps.set(
              tKey,
              Math.max(completedTargetTimestamps.get(tKey) ?? 0, purgedAtMs)
            );
          }
        }
      }
    }

    const allRecords = Array.from(this.recoveryRecords.values());
    return {
      rehydrationSucceeded: true,
      scannedAuditEvents: relevantEvents.length,
      reconstructedRecords: allRecords.filter((r) => r.durablyRecorded).length,
      pendingCount: allRecords.filter((r) => r.status === 'PENDING_RECOVERY').length,
      completedCount: allRecords.filter((r) => r.status === 'RECOVERED').length,
      manualInterventionCount:
        allRecords.filter((r) => r.status === 'MANUAL_INTERVENTION_REQUIRED').length +
        this.malformedAuditEntries.size,
      malformedEvents: this.getMalformedRecoveryAuditEntries(),
    };
  }

  private async persistAuditEvent(
    eventType: string,
    userId: string | null | undefined,
    resource: string,
    metadata: Record<string, unknown>
  ): Promise<{ persisted: boolean; auditLogId?: string; error?: string }> {
    const safeResource = resource.slice(0, 128);
    const enrichedMetadata: Record<string, unknown> = {
      ...metadata,
      actorUserId: userId ?? null,
    };

    try {
      const created = await this.auditRepo.create({
        eventType,
        userId: userId ?? null,
        resource: safeResource,
        metadata: enrichedMetadata,
      });
      return { persisted: true, auditLogId: created.id };
    } catch (firstErr) {
      if (userId) {
        try {
          const fallbackCreated = await this.auditRepo.create({
            eventType,
            userId: null,
            resource: safeResource,
            metadata: {
              ...enrichedMetadata,
              userIdFallbackReason: firstErr instanceof Error ? firstErr.message : String(firstErr),
            },
          });
          return { persisted: true, auditLogId: fallbackCreated.id };
        } catch (secondErr) {
          const msg = secondErr instanceof Error ? secondErr.message : String(secondErr);
          console.error(`[AudioService] Failed to persist audit event ${eventType}: ${msg}`);
          return { persisted: false, error: msg };
        }
      }

      const msg = firstErr instanceof Error ? firstErr.message : String(firstErr);
      console.error(`[AudioService] Failed to persist audit event ${eventType}: ${msg}`);
      return { persisted: false, error: msg };
    }
  }

  private async getFileMtimeMs(storagePath: string): Promise<number | null> {
    if (typeof this.storageProvider.stat === 'function') {
      const statResult = await this.storageProvider.stat(storagePath).catch(() => null);
      return statResult ? statResult.mtimeMs : null;
    }

    try {
      const fullPath = this.storageProvider.resolveSafePath(storagePath);
      const statResult = await fs.promises.stat(fullPath);
      return statResult.isFile() ? statResult.mtimeMs : null;
    } catch {
      return null;
    }
  }

  private async markRelatedRecoveriesCompleted(
    match: { assetId?: string | undefined; storagePath?: string | undefined; recoveryRecordId?: string | undefined },
    actorUserId?: string | null
  ): Promise<Array<{ recoveryRecordId: string; recoveryType: AudioRecoveryType; target: string; auditLogId?: string }>> {
    const completed: Array<{
      recoveryRecordId: string;
      recoveryType: AudioRecoveryType;
      target: string;
      auditLogId?: string;
    }> = [];
    const nowIso = new Date().toISOString();

    for (const record of this.recoveryRecords.values()) {
      if (record.status === 'RECOVERED') continue;
      const matchesId = Boolean(
        match.recoveryRecordId &&
          (record.id === match.recoveryRecordId ||
            record.aliasRecoveryIds?.includes(match.recoveryRecordId))
      );
      const matchesAsset = Boolean(match.assetId && record.assetId === match.assetId);
      const matchesPath = Boolean(match.storagePath && record.storagePath === match.storagePath);
      if (!matchesId && !matchesAsset && !matchesPath) continue;

      record.status = 'RECOVERED';
      record.lifecycleState = 'RECOVERY_COMPLETED';
      record.recoveredAt = nowIso;

      const auditResult = await this.persistAuditEvent(
        'AUDIO_RECOVERY_COMPLETED',
        actorUserId ?? null,
        record.storagePath,
        {
          recoveryRecordId: record.id,
          aliasRecoveryRecordIds: record.aliasRecoveryIds ?? [],
          recoveryType: record.recoveryType,
          assetId: record.assetId ?? null,
          storagePath: record.storagePath,
          songId: record.songId,
          checksumSha256: record.checksumSha256,
          recoveredAt: nowIso,
        }
      );

      completed.push({
        recoveryRecordId: record.id,
        recoveryType: record.recoveryType,
        target: record.assetId ?? record.storagePath,
        ...(auditResult.auditLogId ? { auditLogId: auditResult.auditLogId } : {}),
      });
    }

    return completed;
  }

  private async executeWorkerInspect(
    jobId: string,
    fullPath: string,
    expectedSha256: string,
    options: InspectAudioOptions = {}
  ): Promise<PythonWorkerInspectResult> {
    try {
      return await this.pythonWorkerBridge.inspectAndVerifyAudio(
        jobId,
        fullPath,
        expectedSha256,
        options
      );
    } catch (err) {
      if (err instanceof PythonWorkerError) {
        if (err.errorCode === 'SOURCE_FILE_NOT_FOUND') {
          throw new NotFoundError('Archivo físico de audio', fullPath);
        }
        if (
          err.errorCode === 'AUDIO_VALIDATION_FAILED' ||
          err.errorCode === 'AUDIO_DECODE_FAILED' ||
          err.errorCode === 'INVALID_ARGUMENT' ||
          err.errorCode === 'INVALID_WORKER_REQUEST' ||
          err.errorCode === 'MISSING_REQUIRED_FIELDS'
        ) {
          throw new ValidationError(err.message, { workerErrorCode: err.errorCode });
        }
      }
      throw err;
    }
  }

  /**
   * Sube y registra un nuevo activo de audio asociado a una canción.
   * Valida existencia de la canción, cuota de tamaño, tipo MIME y magic bytes binarios.
   * Ejecuta compensación física cuando falla el worker o la persistencia en BD; si la compensación física
   * también falla, preserva el error primario, adjunta telemetría y persiste un registro accionable de recuperación.
   */
  public async uploadAudio(params: UploadAudioParams): Promise<AudioAsset> {
    const { songId, title, filename, mimeType, buffer, durationSeconds, uploadedByUserId } = params;

    // 1. Validar existencia de la canción
    const song = await this.songRepo.findById(songId);
    if (!song) {
      throw new NotFoundError(`Canción con ID ${songId} no encontrada.`);
    }

    // 2. Validar tipo MIME permitido
    const normalizedMime = mimeType.toLowerCase().trim();
    if (!ALLOWED_MIME_TYPES.has(normalizedMime)) {
      throw new ValidationError(`Formato de audio no permitido o inválido: "${mimeType}".`);
    }

    // 3. Validar tamaño del buffer
    if (!buffer || buffer.length === 0) {
      throw new ValidationError('El archivo de audio no puede estar vacío.');
    }

    if (buffer.length > this.maxFileSizeBytes) {
      throw new ValidationError(
        `El archivo de audio (${buffer.length} bytes) supera el límite máximo de ${this.maxFileSizeBytes} bytes (50MB).`
      );
    }

    // 4. Validar firma binaria (magic bytes) para prevenir falsificación MIME
    validateAudioMagicBytes(buffer, normalizedMime);

    // 5. Guardar archivo físico de forma atómica e inmutable en el storage provider seguro
    const saveResult = await this.storageProvider.save(filename, buffer);
    this.inFlightUploadPaths.add(saveResult.storagePath);

    try {
      // 6. Verificación profunda opcional mediante worker local en Python
      if (params.verifyWithPythonWorker) {
        const fullPath = this.storageProvider.resolveSafePath(saveResult.storagePath);
        await this.executeWorkerInspect(
          `upload-${crypto.randomUUID()}`,
          fullPath,
          saveResult.checksumSha256
        );
      }

      // 7. Persistir metadatos en la base de datos
      const created = await this.audioRepo.create({
        songId,
        title: title.trim() || filename,
        filename: filename.trim(),
        storagePath: saveResult.storagePath,
        mimeType: normalizedMime,
        fileSizeBytes: saveResult.fileSizeBytes,
        checksumSha256: saveResult.checksumSha256,
        durationSeconds: durationSeconds && durationSeconds > 0 ? Math.floor(durationSeconds) : null,
        uploadedByUserId: uploadedByUserId ?? null,
      });

      return created;
    } catch (primaryError) {
      const recordedAt = new Date().toISOString();
      const primaryMessage =
        primaryError instanceof Error ? primaryError.message : String(primaryError);

      let cleanupError: unknown = null;
      try {
        await this.storageProvider.delete(saveResult.storagePath);
      } catch (err) {
        cleanupError = err;
      }

      const stillExists = await this.storageProvider
        .exists(saveResult.storagePath)
        .catch(() => true);

      const compensationSucceeded = !cleanupError && !stillExists;
      let compensationErrorMsg: string | undefined;
      let recoveryRecordId: string | undefined;
      let persistedToAuditLog = false;
      let durablyRecorded = false;

      if (!compensationSucceeded) {
        compensationErrorMsg =
          cleanupError instanceof Error
            ? cleanupError.message
            : cleanupError !== null
              ? String(cleanupError)
              : 'El archivo físico permanece en disco tras intentar la limpieza compensatoria.';

        const recoveryId = crypto.randomUUID();
        recoveryRecordId = recoveryId;

        const recoveryRecord: AudioStorageRecoveryRecord = {
          id: recoveryId,
          recoveryType: 'UPLOAD_COMPENSATION_ORPHAN',
          status: 'PENDING_RECOVERY',
          lifecycleState: 'RECOVERY_PENDING',
          storagePath: saveResult.storagePath,
          songId,
          filename: filename.trim(),
          mimeType: normalizedMime,
          checksumSha256: saveResult.checksumSha256,
          fileSizeBytes: saveResult.fileSizeBytes,
          primaryError: primaryMessage,
          secondaryError: compensationErrorMsg,
          persistedToAuditLog: false,
          durablyRecorded: false,
          createdAt: recordedAt,
        };

        const auditResult = await this.persistAuditEvent(
          'AUDIO_UPLOAD_COMPENSATION_FAILED',
          uploadedByUserId ?? null,
          saveResult.storagePath,
          {
            recoveryRecordId: recoveryId,
            recoveryType: recoveryRecord.recoveryType,
            status: recoveryRecord.status,
            storagePath: saveResult.storagePath,
            songId,
            filename: recoveryRecord.filename,
            mimeType: normalizedMime,
            checksumSha256: saveResult.checksumSha256,
            fileSizeBytes: saveResult.fileSizeBytes,
            primaryError: primaryMessage,
            compensationError: compensationErrorMsg,
            recordedAt,
          }
        );

        persistedToAuditLog = auditResult.persisted;
        durablyRecorded = auditResult.persisted;
        recoveryRecord.persistedToAuditLog = auditResult.persisted;
        recoveryRecord.durablyRecorded = auditResult.persisted;
        if (auditResult.auditLogId) {
          recoveryRecord.auditLogId = auditResult.auditLogId;
        }
        if (!auditResult.persisted) {
          recoveryRecord.status = 'MANUAL_INTERVENTION_REQUIRED';
          recoveryRecord.lifecycleState = 'MANUAL_INTERVENTION_REQUIRED';
          recoveryRecord.secondaryError = `${compensationErrorMsg} | AUDITORÍA NO DURABLE EN POSTGRESQL: ${
            auditResult.error ?? 'Error desconocido al escribir audit_logs'
          }`;
        }
        this.recoveryRecords.set(recoveryId, recoveryRecord);
      }

      const compensationReport: AudioUploadCompensationReport = {
        attempted: true,
        succeeded: compensationSucceeded,
        storagePath: saveResult.storagePath,
        checksumSha256: saveResult.checksumSha256,
        fileSizeBytes: saveResult.fileSizeBytes,
        ...(compensationErrorMsg ? { compensationError: compensationErrorMsg } : {}),
        ...(recoveryRecordId ? { recoveryRecordId } : {}),
        persistedToAuditLog,
        durablyRecorded,
        recordedAt,
      };

      if (primaryError && typeof primaryError === 'object') {
        (primaryError as Error & { compensation?: AudioUploadCompensationReport }).compensation =
          compensationReport;
      }

      throw primaryError;
    } finally {
      this.inFlightUploadPaths.delete(saveResult.storagePath);
    }
  }

  /**
   * Obtiene la lista de activos de audio para una canción específica.
   */
  public async getAudiosBySongId(songId: string): Promise<AudioAsset[]> {
    const song = await this.songRepo.findById(songId);
    if (!song) {
      throw new NotFoundError(`Canción con ID ${songId} no encontrada.`);
    }
    return await this.audioRepo.findBySongId(songId);
  }

  /**
   * Obtiene un activo de audio por su ID.
   */
  public async getAudioById(audioId: string): Promise<AudioAsset> {
    const asset = await this.audioRepo.findById(audioId);
    if (!asset) {
      throw new NotFoundError(`Activo de audio con ID ${audioId} no encontrado.`);
    }
    return asset;
  }

  /**
   * Genera un stream de audio con soporte de cabecera HTTP Range conforme a RFC 7233 / RFC 9110.
   * Maneja rangos cerrados (start-end), abiertos (start-) y sufijos (-N), retornando 206 o 416.
   */
  public async streamAudio(audioId: string, rangeHeader?: string): Promise<AudioStreamResponse> {
    const asset = await this.getAudioById(audioId);
    const totalSize = asset.fileSizeBytes;

    let start = 0;
    let end = totalSize - 1;
    let isRangeRequest = false;

    if (rangeHeader) {
      if (!rangeHeader.startsWith('bytes=')) {
        throw new RangeNotSatisfiableError(
          `Unidad de rango no soportada: ${rangeHeader}`,
          totalSize
        );
      }

      // Solicitud de múltiples rangos no soportada para streams directos de audio
      if (rangeHeader.includes(',')) {
        throw new RangeNotSatisfiableError(
          'Solicitud de múltiples rangos no soportada.',
          totalSize
        );
      }

      const rangeSpec = rangeHeader.slice('bytes='.length).trim();
      const parts = rangeSpec.split('-');
      if (parts.length !== 2) {
        throw new RangeNotSatisfiableError(
          `Formato de rango no satisfacible: ${rangeHeader}`,
          totalSize
        );
      }

      const rawStart = parts[0]?.trim();
      const rawEnd = parts[1]?.trim();

      if (rawStart === '' && rawEnd === '') {
        throw new RangeNotSatisfiableError(
          `Rango vacío o malformado: ${rangeHeader}`,
          totalSize
        );
      }

      // Caso A: Suffix range, e.g. bytes=-500 (los últimos 500 bytes del archivo)
      if (rawStart === '' && rawEnd !== '') {
        const suffixLength = parseInt(rawEnd, 10);
        if (isNaN(suffixLength) || suffixLength <= 0) {
          throw new RangeNotSatisfiableError(
            `Longitud de sufijo inválida: ${rawEnd}`,
            totalSize
          );
        }
        start = Math.max(0, totalSize - suffixLength);
        end = totalSize - 1;
      }
      // Caso B: Prefix range, e.g. bytes=500- (desde 500 hasta el final)
      else if (rawStart !== '' && rawEnd === '') {
        start = parseInt(rawStart, 10);
        if (isNaN(start) || start < 0) {
          throw new RangeNotSatisfiableError(
            `Posición de inicio inválida: ${rawStart}`,
            totalSize
          );
        }
        end = totalSize - 1;
      }
      // Caso C: Closed range, e.g. bytes=100-200
      else {
        start = parseInt(rawStart, 10);
        end = parseInt(rawEnd, 10);
        if (isNaN(start) || isNaN(end) || start < 0) {
          throw new RangeNotSatisfiableError(
            `Valores de rango inválidos: ${rangeHeader}`,
            totalSize
          );
        }
      }

      // Validar límites según RFC 7233
      if (start >= totalSize || start > end) {
        throw new RangeNotSatisfiableError(
          `Rango fuera de los límites del archivo (${totalSize} bytes): ${rangeHeader}`,
          totalSize
        );
      }

      // Clamping del extremo final si supera el tamaño total
      end = Math.min(end, totalSize - 1);
      isRangeRequest = true;
    }

    const { stream, chunkSize } = await this.storageProvider.getStream(
      asset.storagePath,
      start,
      end,
      {
        expectedChecksumSha256: asset.checksumSha256,
        expectedSizeBytes: asset.fileSizeBytes,
      }
    );

    if (isRangeRequest) {
      return {
        stream,
        statusCode: 206,
        headers: {
          'Content-Type': asset.mimeType,
          'Content-Length': chunkSize,
          'Content-Range': `bytes ${start}-${end}/${totalSize}`,
          'Accept-Ranges': 'bytes',
          'Cache-Control': 'private, no-cache',
          'X-Checksum-Sha256': asset.checksumSha256,
          ETag: `"${asset.checksumSha256}"`,
        },
      };
    }

    return {
      stream,
      statusCode: 200,
      headers: {
        'Content-Type': asset.mimeType,
        'Content-Length': totalSize,
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'private, no-cache',
        'X-Checksum-Sha256': asset.checksumSha256,
        ETag: `"${asset.checksumSha256}"`,
      },
    };
  }

  /**
   * Ejecuta inspección binaria profunda y verificación PCM mediante el worker local de Python
   * sobre un activo de audio ya preservado en disco.
   */
  public async inspectAndVerifyStoredAudio(
    audioId: string,
    options: InspectAudioOptions = {}
  ): Promise<PythonWorkerInspectResult> {
    const asset = await this.getAudioById(audioId);
    const exists = await this.storageProvider.exists(asset.storagePath);
    if (!exists) {
      throw new NotFoundError('Archivo físico de audio', asset.storagePath);
    }

    const fullPath = this.storageProvider.resolveSafePath(asset.storagePath);
    return await this.executeWorkerInspect(
      `verify-${asset.id}-${Date.now()}`,
      fullPath,
      asset.checksumSha256,
      options
    );
  }

  /**
   * Ejecuta la recuperación controlada al arranque del backend o bajo solicitud de gobierno operativo:
   * - Si `enabled === false`, omite la ejecución de forma observable sin lanzar excepciones.
   * - Si ya hay una recuperación de arranque en vuelo, reutiliza la ejecución única (single-flight).
   * - Primero rehidrata y valida eventos en PostgreSQL `audit_logs`.
   * - Nunca purga huérfanos destructivamente si `purgeConfirmedOrphans` no es `true` explícitamente o si falló la rehidratación.
   * - Nunca lanza excepciones fatales que bloqueen la disponibilidad o el reporte de estado del backend.
   */
  public async runStartupRecovery(
    options: AudioStartupRecoveryOptions = {}
  ): Promise<AudioStartupRecoveryStatus> {
    const enabled = options.enabled ?? true;
    const purgeConfirmedOrphans = options.purgeConfirmedOrphans ?? false;
    const log: AudioStartupRecoveryLogger = options.logger ?? {
      info: (obj, msg) => console.info(msg ?? '[AudioStartupRecovery]', JSON.stringify(obj)),
      warn: (obj, msg) => console.warn(msg ?? '[AudioStartupRecovery]', JSON.stringify(obj)),
      error: (obj, msg) => console.error(msg ?? '[AudioStartupRecovery]', JSON.stringify(obj)),
    };

    if (!enabled) {
      const skipped: AudioStartupRecoveryStatus = {
        invoked: true,
        enabled: false,
        purgeConfirmedOrphansConfigured: purgeConfirmedOrphans,
        status: 'SKIPPED_DISABLED',
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        rehydrationSucceeded: false,
        destructiveRecoveryBlocked: true,
      };
      this.lastStartupRecoveryStatus = skipped;
      log.info(
        {
          event: 'AUDIO_STARTUP_RECOVERY_SKIPPED',
          enabled: false,
          purgeConfirmedOrphans,
        },
        'Recuperación durable de audio al arranque omitida por configuración.'
      );
      return { ...skipped };
    }

    if (this.activeStartupRecoveryPromise) {
      return await this.activeStartupRecoveryPromise;
    }

    const execution = (async (): Promise<AudioStartupRecoveryStatus> => {
      const startedAt = new Date().toISOString();
      try {
        const report = await this.reconcileStorageConsistency({
          recoverFailedOperations: true,
          purgeOrphanFiles: purgeConfirmedOrphans,
          minOrphanAgeMs: options.minOrphanAgeMs ?? 60_000,
        });
        const completedAt = new Date().toISOString();

        if (!report.rehydrationReport.rehydrationSucceeded) {
          const failedRehydrationStatus: AudioStartupRecoveryStatus = {
            invoked: true,
            enabled: true,
            purgeConfirmedOrphansConfigured: purgeConfirmedOrphans,
            status: 'FAILED_NON_FATAL',
            startedAt,
            completedAt,
            rehydrationSucceeded: false,
            destructiveRecoveryBlocked: true,
            reconciliationReport: report,
            error:
              report.rehydrationReport.error ??
              'Error desconocido rehidratando registros de recuperación desde audit_logs.',
          };
          this.lastStartupRecoveryStatus = failedRehydrationStatus;
          log.warn(
            {
              event: 'AUDIO_STARTUP_RECOVERY_DEGRADED',
              status: failedRehydrationStatus.status,
              rehydrationSucceeded: false,
              destructiveRecoveryBlocked: true,
              error: failedRehydrationStatus.error,
            },
            'Recuperación durable de audio al arranque degradada: falló rehidratación de audit_logs; purga destructiva bloqueada.'
          );
          return { ...failedRehydrationStatus };
        }

        const needsAttention =
          report.manualInterventionRecords.length > 0 ||
          report.malformedRecoveryEvents.length > 0 ||
          report.missingPhysicalFiles.length > 0 ||
          report.corruptedPhysicalFiles.length > 0 ||
          report.failedOrphanPurges.length > 0 ||
          report.pendingRecoveryRecords.length > 0;

        const outcomeStatus: AudioStartupRecoveryStatus = {
          invoked: true,
          enabled: true,
          purgeConfirmedOrphansConfigured: purgeConfirmedOrphans,
          status: needsAttention ? 'DEGRADED_MANUAL_ACTION_REQUIRED' : 'COMPLETED',
          startedAt,
          completedAt,
          rehydrationSucceeded: true,
          destructiveRecoveryBlocked: !purgeConfirmedOrphans,
          reconciliationReport: report,
        };
        this.lastStartupRecoveryStatus = outcomeStatus;

        if (needsAttention) {
          log.warn(
            {
              event: 'AUDIO_STARTUP_RECOVERY_ATTENTION_REQUIRED',
              status: outcomeStatus.status,
              purgeConfirmedOrphans,
              destructiveRecoveryBlocked: outcomeStatus.destructiveRecoveryBlocked,
              recoveredCount: report.recoveredOperations.length,
              pendingRecoveryCount: report.pendingRecoveryRecords.length,
              manualInterventionCount: report.manualInterventionRecords.length,
              malformedEventsCount: report.malformedRecoveryEvents.length,
              missingPhysicalFilesCount: report.missingPhysicalFiles.length,
              corruptedPhysicalFilesCount: report.corruptedPhysicalFiles.length,
              orphanFilesCount: report.orphanFiles.length,
            },
            'Recuperación durable de audio al arranque completada con hallazgos que requieren revisión operativa.'
          );
        } else {
          log.info(
            {
              event: 'AUDIO_STARTUP_RECOVERY_COMPLETED',
              status: outcomeStatus.status,
              purgeConfirmedOrphans,
              recoveredCount: report.recoveredOperations.length,
              purgedOrphansCount: report.purgedOrphanFiles.length,
              checkedAssets: report.checkedAssets,
            },
            'Recuperación durable de audio al arranque completada correctamente.'
          );
        }

        return { ...outcomeStatus };
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        const failedStatus: AudioStartupRecoveryStatus = {
          invoked: true,
          enabled: true,
          purgeConfirmedOrphansConfigured: purgeConfirmedOrphans,
          status: 'FAILED_NON_FATAL',
          startedAt,
          completedAt: new Date().toISOString(),
          rehydrationSucceeded: false,
          destructiveRecoveryBlocked: true,
          error: errorMessage,
        };
        this.lastStartupRecoveryStatus = failedStatus;
        log.error(
          {
            event: 'AUDIO_STARTUP_RECOVERY_FAILED',
            status: failedStatus.status,
            destructiveRecoveryBlocked: true,
            error: errorMessage,
          },
          'Fallo no fatal durante la recuperación durable de audio al arranque; el servidor continúa en estado degradado.'
        );
        return { ...failedStatus };
      } finally {
        this.activeStartupRecoveryPromise = null;
      }
    })();

    this.activeStartupRecoveryPromise = execution;
    return await execution;
  }

  /**
   * Reconcilia la consistencia entre los registros de `audio_assets` en PostgreSQL y los archivos físicos en disco.
   * Rehidrata primero los registros durables de recuperación desde PostgreSQL `audit_logs`,
   * detecta archivos huérfanos en disco, registros sin archivo físico y archivos físicamente alterados (SHA-256),
   * protege subidas en vuelo y archivos ambiguos/no-durables/malformados, y ejecuta recuperación idempotente y auditada.
   * Ejecución serializada para prevenir condiciones de carrera concurrentes.
   */
  public async reconcileStorageConsistency(
    options: AudioStorageReconciliationOptions = {}
  ): Promise<AudioStorageReconciliationReport> {
    return await this.withRecoveryLock(() => this.reconcileStorageConsistencyInternal(options));
  }

  private async reconcileStorageConsistencyInternal(
    options: AudioStorageReconciliationOptions = {}
  ): Promise<AudioStorageReconciliationReport> {
    const rehydrationReport = await this.rehydrateRecoveryRecordsInternal();
    const shouldRecoverFailed = options.recoverFailedOperations ?? Boolean(options.purgeOrphanFiles);
    const recoveredOperations: Array<{
      recoveryRecordId: string;
      recoveryType: AudioRecoveryType;
      target: string;
    }> = [];
    const auditLogIds: string[] = [];

    // 1. Recuperación idempotente de eliminaciones de BD pendientes solo para registros durables validados
    if (shouldRecoverFailed && rehydrationReport.rehydrationSucceeded) {
      for (const rec of this.recoveryRecords.values()) {
        if (rec.status !== 'PENDING_RECOVERY' || !rec.durablyRecorded || !rec.persistedToAuditLog) {
          continue;
        }

        if (rec.recoveryType === 'DELETE_DB_FAILED_AFTER_PHYSICAL_DELETE' && rec.assetId) {
          const stillOnDisk = await this.storageProvider.exists(rec.storagePath).catch(() => true);
          if (stillOnDisk) {
            rec.status = 'MANUAL_INTERVENTION_REQUIRED';
            rec.lifecycleState = 'MANUAL_INTERVENTION_REQUIRED';
            rec.secondaryError =
              'El archivo físico aún existe en disco durante recuperación de eliminación en BD; se requiere revisión manual.';
            continue;
          }

          try {
            const existingAsset = await this.audioRepo.findById(rec.assetId);
            if (!existingAsset) {
              const completed = await this.markRelatedRecoveriesCompleted(
                { recoveryRecordId: rec.id, assetId: rec.assetId, storagePath: rec.storagePath },
                null
              );
              for (const item of completed) {
                recoveredOperations.push({
                  recoveryRecordId: item.recoveryRecordId,
                  recoveryType: item.recoveryType,
                  target: item.target,
                });
                if (item.auditLogId) {
                  auditLogIds.push(item.auditLogId);
                }
              }
              continue;
            }

            const metadataMatches =
              existingAsset.storagePath === rec.storagePath &&
              existingAsset.checksumSha256.toLowerCase() === rec.checksumSha256.toLowerCase() &&
              existingAsset.fileSizeBytes === rec.fileSizeBytes;

            if (!metadataMatches) {
              rec.status = 'MANUAL_INTERVENTION_REQUIRED';
              rec.lifecycleState = 'MANUAL_INTERVENTION_REQUIRED';
              rec.secondaryError =
                'Los metadatos actuales de audio_assets en PostgreSQL no coinciden con el registro de recuperación; requiere intervención manual.';
              continue;
            }

            const resolved = await this.audioRepo.delete(rec.assetId);
            if (resolved) {
              const completed = await this.markRelatedRecoveriesCompleted(
                { recoveryRecordId: rec.id, assetId: rec.assetId, storagePath: rec.storagePath },
                null
              );
              for (const item of completed) {
                recoveredOperations.push({
                  recoveryRecordId: item.recoveryRecordId,
                  recoveryType: item.recoveryType,
                  target: item.target,
                });
                if (item.auditLogId) {
                  auditLogIds.push(item.auditLogId);
                }
              }
            }
          } catch (recErr) {
            rec.secondaryError = recErr instanceof Error ? recErr.message : String(recErr);
          }
        }
      }
    }

    const [assets, physicalKeys] = await Promise.all([
      this.audioRepo.findAll(),
      this.storageProvider.listKeys(),
    ]);

    const referencedPaths = new Set(assets.map((a) => a.storagePath));
    const healthyAssetIds: string[] = [];
    const missingPhysicalFiles: Array<{ assetId: string; storagePath: string }> = [];
    const corruptedPhysicalFiles: Array<{ assetId: string; storagePath: string; reason: string }> = [];

    // Reconciliar casos UPLOAD_COMPENSATION_ORPHAN cuyo archivo físico ya desapareció o está referenciado en BD
    if (shouldRecoverFailed && rehydrationReport.rehydrationSucceeded) {
      for (const rec of this.recoveryRecords.values()) {
        if (
          rec.status !== 'PENDING_RECOVERY' ||
          !rec.durablyRecorded ||
          !rec.persistedToAuditLog ||
          rec.recoveryType !== 'UPLOAD_COMPENSATION_ORPHAN' ||
          this.inFlightUploadPaths.has(rec.storagePath)
        ) {
          continue;
        }

        if (referencedPaths.has(rec.storagePath)) {
          rec.status = 'MANUAL_INTERVENTION_REQUIRED';
          rec.lifecycleState = 'MANUAL_INTERVENTION_REQUIRED';
          rec.secondaryError =
            'El archivo señalado como huérfano ahora está referenciado por un registro activo en audio_assets; requiere revisión manual.';
          continue;
        }

        const stillOnDisk = await this.storageProvider.exists(rec.storagePath).catch(() => true);
        if (!stillOnDisk) {
          const completed = await this.markRelatedRecoveriesCompleted(
            { recoveryRecordId: rec.id, storagePath: rec.storagePath },
            null
          );
          for (const item of completed) {
            recoveredOperations.push({
              recoveryRecordId: item.recoveryRecordId,
              recoveryType: item.recoveryType,
              target: item.target,
            });
            if (item.auditLogId) {
              auditLogIds.push(item.auditLogId);
            }
          }
        }
      }
    }

    for (const asset of assets) {
      try {
        const probe = await this.storageProvider.getStream(asset.storagePath, undefined, undefined, {
          expectedChecksumSha256: asset.checksumSha256,
          expectedSizeBytes: asset.fileSizeBytes,
        });
        (probe.stream as any).on?.('error', () => {});
        if (typeof (probe.stream as any).destroy === 'function') {
          (probe.stream as any).destroy();
        }
        healthyAssetIds.push(asset.id);
      } catch (err: any) {
        if (err instanceof NotFoundError) {
          missingPhysicalFiles.push({
            assetId: asset.id,
            storagePath: asset.storagePath,
          });
        } else {
          corruptedPhysicalFiles.push({
            assetId: asset.id,
            storagePath: asset.storagePath,
            reason: err instanceof Error ? err.message : String(err),
          });
        }
      }
    }

    const orphanFiles: string[] = [];
    const purgedOrphanFiles: string[] = [];
    const skippedInFlightFiles: string[] = [];
    const ambiguousFiles: Array<{ storagePath: string; reason: string }> = [];
    const failedOrphanPurges: Array<{ storagePath: string; reason: string }> = [];

    for (const diskKey of physicalKeys) {
      if (referencedPaths.has(diskKey)) {
        continue;
      }

      // Guardia 1: Nunca clasificar ni purgar una subida actualmente en vuelo
      if (this.inFlightUploadPaths.has(diskKey)) {
        skippedInFlightFiles.push(diskKey);
        continue;
      }

      // Guardia 1.5: Si audit_logs en PostgreSQL no estuvo disponible, bloquear purga automática
      if (!rehydrationReport.rehydrationSucceeded) {
        ambiguousFiles.push({
          storagePath: diskKey,
          reason:
            'No se pudo rehidratar audit_logs en PostgreSQL; se bloquea purga automática para prevenir pérdida de evidencia.',
        });
        continue;
      }

      // Guardia 2: Nunca purgar automáticamente archivos vinculados a metadatos malformados o no durables en memoria
      if (this.malformedStoragePaths.has(diskKey)) {
        ambiguousFiles.push({
          storagePath: diskKey,
          reason:
            'El evento de auditoría asociado contiene metadatos de recuperación incompletos o inválidos; requiere intervención manual.',
        });
        continue;
      }

      const matchingNonDurableOrManual = Array.from(this.recoveryRecords.values()).find(
        (r) =>
          r.storagePath === diskKey &&
          (!r.durablyRecorded ||
            !r.persistedToAuditLog ||
            r.status === 'MANUAL_INTERVENTION_REQUIRED')
      );

      if (matchingNonDurableOrManual) {
        ambiguousFiles.push({
          storagePath: diskKey,
          reason:
            !matchingNonDurableOrManual.durablyRecorded ||
            !matchingNonDurableOrManual.persistedToAuditLog
              ? 'El registro en memoria no fue persistido de forma durable en PostgreSQL audit_logs; nunca se purga automáticamente.'
              : 'El registro de recuperación requiere intervención manual; nunca se purga automáticamente.',
        });
        continue;
      }

      const confirmedOrphanRecord = Array.from(this.recoveryRecords.values()).find(
        (r) =>
          r.status === 'PENDING_RECOVERY' &&
          r.durablyRecorded &&
          r.persistedToAuditLog &&
          r.recoveryType === 'UPLOAD_COMPENSATION_ORPHAN' &&
          r.storagePath === diskKey
      );

      if (confirmedOrphanRecord) {
        // Verificar tamaño exacto y SHA-256 en disco contra el registro durable antes de confirmar purga
        let hashMatched = false;
        let verifyFailureReason = '';
        try {
          const probe = await this.storageProvider.getStream(diskKey, undefined, undefined, {
            expectedChecksumSha256: confirmedOrphanRecord.checksumSha256,
            expectedSizeBytes: confirmedOrphanRecord.fileSizeBytes,
          });
          (probe.stream as any).on?.('error', () => {});
          if (typeof (probe.stream as any).destroy === 'function') {
            (probe.stream as any).destroy();
          }
          hashMatched = true;
        } catch (verifyErr) {
          verifyFailureReason =
            verifyErr instanceof Error ? verifyErr.message : String(verifyErr);
        }

        if (!hashMatched) {
          confirmedOrphanRecord.status = 'MANUAL_INTERVENTION_REQUIRED';
          confirmedOrphanRecord.lifecycleState = 'MANUAL_INTERVENTION_REQUIRED';
          confirmedOrphanRecord.secondaryError = `Discrepancia al verificar el archivo huérfano contra metadatos durables: ${verifyFailureReason}`;
          ambiguousFiles.push({
            storagePath: diskKey,
            reason: `El archivo en disco no coincide en tamaño/SHA-256 con el registro durable de recuperación (${verifyFailureReason}); requiere intervención manual.`,
          });
          continue;
        }
      } else {
        // Guardia 3: No clasificar como huérfanos elegibles a purga automática archivos ambiguos
        const ext = path.extname(diskKey).toLowerCase();
        if (!ALLOWED_AUDIO_EXTENSIONS.has(ext)) {
          ambiguousFiles.push({
            storagePath: diskKey,
            reason: 'Extensión no perteneciente al catálogo de audio gestionado; requiere revisión manual.',
          });
          continue;
        }

        if (options.minOrphanAgeMs !== undefined && options.minOrphanAgeMs > 0) {
          const mtimeMs = await this.getFileMtimeMs(diskKey);
          if (mtimeMs === null || Date.now() - mtimeMs < options.minOrphanAgeMs) {
            ambiguousFiles.push({
              storagePath: diskKey,
              reason: 'Archivo reciente o marca temporal no verificable dentro de la ventana de seguridad.',
            });
            continue;
          }
        }
      }

      orphanFiles.push(diskKey);
    }

    if (options.purgeOrphanFiles) {
      for (const orphanKey of orphanFiles) {
        let purgeErr: unknown = null;
        try {
          await this.storageProvider.delete(orphanKey);
        } catch (err) {
          purgeErr = err;
        }

        const existsAfter = await this.storageProvider.exists(orphanKey).catch(() => true);
        if (!purgeErr && !existsAfter) {
          purgedOrphanFiles.push(orphanKey);

          const purgeAudit = await this.persistAuditEvent(
            'AUDIO_ORPHAN_FILE_PURGED',
            null,
            orphanKey,
            {
              storagePath: orphanKey,
              purgedAt: new Date().toISOString(),
            }
          );
          if (purgeAudit.auditLogId) {
            auditLogIds.push(purgeAudit.auditLogId);
          }

          const completed = await this.markRelatedRecoveriesCompleted(
            { storagePath: orphanKey },
            null
          );
          for (const item of completed) {
            recoveredOperations.push({
              recoveryRecordId: item.recoveryRecordId,
              recoveryType: item.recoveryType,
              target: item.target,
            });
            if (item.auditLogId) {
              auditLogIds.push(item.auditLogId);
            }
          }
        } else {
          const reason =
            purgeErr instanceof Error
              ? purgeErr.message
              : purgeErr !== null
                ? String(purgeErr)
                : 'El archivo huérfano permanece en disco tras intentar purgarlo.';
          failedOrphanPurges.push({ storagePath: orphanKey, reason });

          const failAudit = await this.persistAuditEvent(
            'AUDIO_ORPHAN_PURGE_FAILED',
            null,
            orphanKey,
            {
              storagePath: orphanKey,
              reason,
              attemptedAt: new Date().toISOString(),
            }
          );
          if (failAudit.auditLogId) {
            auditLogIds.push(failAudit.auditLogId);
          }
        }
      }
    }

    const pendingRecoveryRecords = Array.from(this.recoveryRecords.values())
      .filter((r) => r.status === 'PENDING_RECOVERY')
      .map((r) => ({ ...r }));

    const manualInterventionRecords = Array.from(this.recoveryRecords.values())
      .filter((r) => r.status === 'MANUAL_INTERVENTION_REQUIRED')
      .map((r) => ({ ...r }));

    const report: AudioStorageReconciliationReport = {
      checkedAssets: assets.length,
      healthyAssetIds,
      missingPhysicalFiles,
      corruptedPhysicalFiles,
      orphanFiles,
      purgedOrphanFiles,
      skippedInFlightFiles,
      ambiguousFiles,
      failedOrphanPurges,
      pendingRecoveryRecords,
      manualInterventionRecords,
      malformedRecoveryEvents: this.getMalformedRecoveryAuditEntries(),
      rehydrationReport,
      recoveredOperations,
      auditLogIds,
    };
    this.lastReconciliationReport = report;
    return report;
  }

  /**
   * Obtiene la descarga binaria completa de un audio con verificación criptográfica SHA-256.
   */
  public async downloadAudio(audioId: string): Promise<AudioDownloadResponse> {
    const asset = await this.getAudioById(audioId);
    const buffer = await this.storageProvider.getBuffer(asset.storagePath);

    // Re-verificación de integridad física SHA-256
    const calculatedHash = crypto.createHash('sha256').update(buffer).digest('hex');
    if (calculatedHash !== asset.checksumSha256) {
      throw new ValidationError(
        `Integridad física comprometida: el hash SHA-256 verificado (${calculatedHash}) no coincide con el registro original (${asset.checksumSha256}).`
      );
    }

    return {
      buffer,
      filename: asset.filename,
      mimeType: asset.mimeType,
      fileSizeBytes: asset.fileSizeBytes,
      checksumSha256: asset.checksumSha256,
    };
  }

  /**
   * Elimina un archivo de audio tanto del disco físico como de la base de datos.
   * Si falla la eliminación física, preserva el registro en BD y lanza PersistenceError (sin falsos positivos).
   * Si el archivo físico fue eliminado pero falla la eliminación en BD, persiste metadatos accionables de recuperación y lanza PersistenceError.
   * Es seguro frente a reintentos idempotentes.
   */
  public async deleteAudio(audioId: string, actorUserId?: string): Promise<boolean> {
    const asset = await this.audioRepo.findById(audioId);
    if (!asset) {
      return false;
    }

    const effectiveActorId = actorUserId ?? asset.uploadedByUserId ?? null;
    const existedBefore = await this.storageProvider.exists(asset.storagePath).catch(() => true);

    // Fase 1: Eliminar archivo físico verificando resultado real
    let deletedPhysical = false;
    let physicalError: unknown = null;
    try {
      deletedPhysical = await this.storageProvider.delete(asset.storagePath);
    } catch (err) {
      physicalError = err;
    }

    const existsAfter = await this.storageProvider.exists(asset.storagePath).catch(() => true);
    if (physicalError || (existedBefore && !deletedPhysical) || existsAfter) {
      const causeMessage =
        physicalError instanceof Error
          ? physicalError.message
          : physicalError !== null
            ? String(physicalError)
            : `El archivo físico '${asset.storagePath}' permanece en disco tras intentar eliminarlo.`;
      const createdAt = new Date().toISOString();
      const recoveryId = crypto.randomUUID();

      const record: AudioStorageRecoveryRecord = {
        id: recoveryId,
        recoveryType: 'DELETE_PHYSICAL_FAILED',
        status: 'ABORTED_DB_PRESERVED',
        lifecycleState: 'OPERATION_FAILURE',
        storagePath: asset.storagePath,
        assetId: asset.id,
        songId: asset.songId,
        filename: asset.filename,
        mimeType: asset.mimeType,
        checksumSha256: asset.checksumSha256,
        fileSizeBytes: asset.fileSizeBytes,
        primaryError: causeMessage,
        persistedToAuditLog: false,
        durablyRecorded: false,
        createdAt,
      };

      const auditRes = await this.persistAuditEvent(
        'AUDIO_DELETE_PHYSICAL_FAILED',
        effectiveActorId,
        asset.storagePath,
        {
          recoveryRecordId: recoveryId,
          recoveryType: record.recoveryType,
          status: record.status,
          assetId: asset.id,
          songId: asset.songId,
          storagePath: asset.storagePath,
          filename: asset.filename,
          mimeType: asset.mimeType,
          checksumSha256: asset.checksumSha256,
          fileSizeBytes: asset.fileSizeBytes,
          cause: causeMessage,
          createdAt,
        }
      );
      record.persistedToAuditLog = auditRes.persisted;
      record.durablyRecorded = auditRes.persisted;
      if (auditRes.auditLogId) {
        record.auditLogId = auditRes.auditLogId;
      }
      if (!auditRes.persisted) {
        record.status = 'MANUAL_INTERVENTION_REQUIRED';
        record.lifecycleState = 'MANUAL_INTERVENTION_REQUIRED';
        record.secondaryError = `AUDITORÍA NO DURABLE EN POSTGRESQL: ${
          auditRes.error ?? 'Error desconocido al escribir audit_logs'
        }`;
      }
      this.recoveryRecords.set(recoveryId, record);

      throw new PersistenceError(
        `Fallo al eliminar el archivo físico de audio '${asset.storagePath}'. El registro en base de datos fue preservado para mantener la consistencia.${
          auditRes.persisted ? '' : ' ADVERTENCIA: el evento de recuperación NO pudo persistirse de forma durable en PostgreSQL.'
        }`,
        {
          assetId: asset.id,
          storagePath: asset.storagePath,
          recoveryRecordId: recoveryId,
          dbRecordPreserved: true,
          persistedToAuditLog: record.persistedToAuditLog,
          durablyRecorded: record.durablyRecorded,
          lifecycleState: record.lifecycleState,
          cause: causeMessage,
        }
      );
    }

    // Fase 2: Eliminar registro en base de datos
    let dbDeleted = false;
    let dbError: unknown = null;
    try {
      dbDeleted = await this.audioRepo.delete(audioId);
    } catch (err) {
      dbError = err;
    }

    if (dbError || !dbDeleted) {
      const causeMessage =
        dbError instanceof Error
          ? dbError.message
          : dbError !== null
            ? String(dbError)
            : `audioRepo.delete('${audioId}') retornó false tras la eliminación física.`;
      const createdAt = new Date().toISOString();
      const recoveryId = crypto.randomUUID();

      const record: AudioStorageRecoveryRecord = {
        id: recoveryId,
        recoveryType: 'DELETE_DB_FAILED_AFTER_PHYSICAL_DELETE',
        status: 'PENDING_RECOVERY',
        lifecycleState: 'RECOVERY_PENDING',
        storagePath: asset.storagePath,
        assetId: asset.id,
        songId: asset.songId,
        filename: asset.filename,
        mimeType: asset.mimeType,
        checksumSha256: asset.checksumSha256,
        fileSizeBytes: asset.fileSizeBytes,
        primaryError: causeMessage,
        persistedToAuditLog: false,
        durablyRecorded: false,
        createdAt,
      };

      const auditRes = await this.persistAuditEvent(
        'AUDIO_DELETE_DB_FAILED_AFTER_PHYSICAL_DELETE',
        effectiveActorId,
        asset.storagePath,
        {
          recoveryRecordId: recoveryId,
          recoveryType: record.recoveryType,
          status: record.status,
          assetId: asset.id,
          songId: asset.songId,
          storagePath: asset.storagePath,
          filename: asset.filename,
          mimeType: asset.mimeType,
          checksumSha256: asset.checksumSha256,
          fileSizeBytes: asset.fileSizeBytes,
          cause: causeMessage,
          createdAt,
        }
      );
      record.persistedToAuditLog = auditRes.persisted;
      record.durablyRecorded = auditRes.persisted;
      if (auditRes.auditLogId) {
        record.auditLogId = auditRes.auditLogId;
      }
      if (!auditRes.persisted) {
        record.status = 'MANUAL_INTERVENTION_REQUIRED';
        record.lifecycleState = 'MANUAL_INTERVENTION_REQUIRED';
        record.secondaryError = `AUDITORÍA NO DURABLE EN POSTGRESQL: ${
          auditRes.error ?? 'Error desconocido al escribir audit_logs'
        }`;
      }
      this.recoveryRecords.set(recoveryId, record);

      throw new PersistenceError(
        `El archivo físico '${asset.storagePath}' fue eliminado, pero falló la eliminación del registro en base de datos para el activo '${asset.id}'. ${
          auditRes.persisted
            ? `Se generó el registro durable de recuperación '${recoveryId}'.`
            : `ADVERTENCIA: no se pudo persistir el evento de recuperación en PostgreSQL (solo registro local no durable '${recoveryId}'; requiere intervención manual).`
        }`,
        {
          assetId: asset.id,
          storagePath: asset.storagePath,
          recoveryRecordId: recoveryId,
          physicalDeleted: true,
          dbDeleted: false,
          persistedToAuditLog: record.persistedToAuditLog,
          durablyRecorded: record.durablyRecorded,
          lifecycleState: record.lifecycleState,
          cause: causeMessage,
        }
      );
    }

    await this.markRelatedRecoveriesCompleted(
      { assetId: asset.id, storagePath: asset.storagePath },
      effectiveActorId
    );

    return true;
  }
}
