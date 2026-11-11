/**
 * @file output-retention-service.ts
 * @description Servicio de retención, podado de artefactos generados y recolección de huérfanos (Fase 2B.1).
 *
 * Principios y Políticas de Seguridad:
 * 1. INMUTABILIDAD DE FUENTES: Los archivos originales en storage/sources/ son sagrados y NUNCA se podan.
 * 2. VENTANA DE RETENCIÓN (30 DÍAS): Los archivos generados en storage/outputs/ asociados a trabajos completados
 *    o fallidos cuya antigüedad supere los 30 días son elegibles para podado, preservando siempre la fila del trabajo
 *    y marcando pruned_at = NOW().
 * 3. CUARENTENA Y SEGURIDAD CAS (7 DÍAS): Los archivos físicos no referenciados no se eliminan inmediatamente;
 *    se exige una ventana de cuarentena mínima de 7 días para proteger escrituras concurrentes o en vuelo.
 * 4. FENCING Y CONSISTENCIA REFERENCIAL: Antes de podar, se valida que no existan arrendamientos activos y
 *    que ningún otro trabajo o registro de catálogo comparta la misma clave de almacenamiento (deduplicación CAS).
 * 5. AUDITORÍA INMUTABLE: Cada eliminación física y marca de podado genera un registro en audit_logs.
 */

import { and, eq, inArray, isNotNull, isNull, lt, not, or, sql } from 'drizzle-orm';
import { db as defaultDb, type Database } from '../db/index.ts';
import { backgroundJobs, songSources, auditLogs } from '../db/schema.ts';
import {
  type IStorageProvider,
  LocalFileSystemStorageProvider,
  StorageNotFoundError,
} from '../domain/storage/storage-provider.ts';
import path from 'node:path';

export interface RetentionPruneItem {
  jobId: string;
  storageKey: string;
  checksumSha256: string | null;
  fileDeleted: boolean;
  sharedReferencesRemaining: number;
}

export interface RetentionPruneReport {
  timestamp: string;
  dryRun: boolean;
  retentionWindowDays: number;
  scannedJobsCount: number;
  prunedJobsCount: number;
  filesDeletedCount: number;
  filesRetainedDueToSharedRef: number;
  errors: Array<{ jobId: string; error: string }>;
  prunedItems: RetentionPruneItem[];
}

export interface OrphanItem {
  storageKey: string;
  byteLength: number;
  createdAt: Date;
  deleted: boolean;
  reason?: string;
}

export interface OrphanCollectionReport {
  timestamp: string;
  dryRun: boolean;
  quarantineWindowDays: number;
  scannedFilesCount: number;
  activeReferencesCount: number;
  quarantinedFilesCount: number;
  orphansDeletedCount: number;
  errors: Array<{ storageKey: string; error: string }>;
  orphanItems: OrphanItem[];
}

export interface RetentionServiceOptions {
  defaultRetentionDays?: number;
  defaultQuarantineDays?: number;
}

export class OutputRetentionService {
  public static readonly DEFAULT_RETENTION_DAYS = 30;
  public static readonly DEFAULT_QUARANTINE_DAYS = 7;

  private readonly retentionDays: number;
  private readonly quarantineDays: number;

  public constructor(
    private readonly db: Database = defaultDb,
    private readonly outputStorage: IStorageProvider = new LocalFileSystemStorageProvider(
      'storage/outputs'
    ),
    options?: RetentionServiceOptions
  ) {
    this.retentionDays = options?.defaultRetentionDays ?? OutputRetentionService.DEFAULT_RETENTION_DAYS;
    this.quarantineDays = options?.defaultQuarantineDays ?? OutputRetentionService.DEFAULT_QUARANTINE_DAYS;
  }

  /**
   * Ejecuta el podado de artefactos generados que han expirado su ventana de retención (CR-04).
   * 
   * Criterios:
   * - status IN ('COMPLETED', 'FAILED', 'REVIEW_REQUIRED')
   * - output_storage_key IS NOT NULL
   * - pruned_at IS NULL
   * - completed_at < NOW() - retentionDays
   * - lease_expires_at IS NULL OR lease_expires_at < NOW()
   */
  public async pruneExpiredOutputs(options?: {
    retentionDays?: number;
    dryRun?: boolean;
    userId?: string;
  }): Promise<RetentionPruneReport> {
    const days = options?.retentionDays ?? this.retentionDays;
    const dryRun = options?.dryRun ?? false;
    const now = new Date();
    const cutoffDate = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

    const report: RetentionPruneReport = {
      timestamp: now.toISOString(),
      dryRun,
      retentionWindowDays: days,
      scannedJobsCount: 0,
      prunedJobsCount: 0,
      filesDeletedCount: 0,
      filesRetainedDueToSharedRef: 0,
      errors: [],
      prunedItems: [],
    };

    // 1. Identificar trabajos candidatos respetando las condiciones de arrendamiento
    const candidateJobs = await this.db
      .select({
        id: backgroundJobs.id,
        status: backgroundJobs.status,
        outputStorageKey: backgroundJobs.outputStorageKey,
        outputChecksumSha256: backgroundJobs.outputChecksumSha256,
        committedSongId: backgroundJobs.committedSongId,
        completedAt: backgroundJobs.completedAt,
        leaseToken: backgroundJobs.leaseToken,
        leaseExpiresAt: backgroundJobs.leaseExpiresAt,
      })
      .from(backgroundJobs)
      .where(
        and(
          inArray(backgroundJobs.status, ['COMPLETED', 'FAILED', 'REVIEW_REQUIRED']),
          isNotNull(backgroundJobs.outputStorageKey),
          isNull(backgroundJobs.prunedAt),
          lt(backgroundJobs.completedAt, cutoffDate),
          or(
            isNull(backgroundJobs.leaseExpiresAt),
            lt(backgroundJobs.leaseExpiresAt, now)
          )
        )
      );

    report.scannedJobsCount = candidateJobs.length;

    for (const job of candidateJobs) {
      const storageKey = job.outputStorageKey!;

      try {
        // 2. Verificar si existen otras referencias activas en background_jobs a esta misma storageKey
        const [activeOtherJobs] = await this.db
          .select({ count: sql<number>`count(*)::int` })
          .from(backgroundJobs)
          .where(
            and(
              eq(backgroundJobs.outputStorageKey, storageKey),
              isNull(backgroundJobs.prunedAt),
              not(eq(backgroundJobs.id, job.id))
            )
          );

        // 3. Verificar si el catálogo (song_sources) tiene vinculada esta misma storageKey
        const [activeSources] = await this.db
          .select({ count: sql<number>`count(*)::int` })
          .from(songSources)
          .where(eq(songSources.storagePath, storageKey));

        const otherRefCount = (activeOtherJobs?.count ?? 0) + (activeSources?.count ?? 0);
        let fileDeleted = false;

        if (otherRefCount === 0) {
          // No existen más referencias: procedemos a eliminar físicamente el archivo de salida
          if (!dryRun) {
            try {
              await this.outputStorage.delete(storageKey);
              fileDeleted = true;
              report.filesDeletedCount++;
            } catch (delErr) {
              if (delErr instanceof StorageNotFoundError) {
                // Ya no existía en disco, se considera purgado limpiamente
                fileDeleted = false;
              } else {
                throw delErr;
              }
            }
          } else {
            fileDeleted = true;
            report.filesDeletedCount++;
          }
        } else {
          // Retenido en disco porque otro trabajo o el catálogo aún lo referencia (Deduplicación CAS)
          report.filesRetainedDueToSharedRef++;
        }

        // 4. Marcar el trabajo como podado en la base de datos
        if (!dryRun) {
          await this.db
            .update(backgroundJobs)
            .set({
              prunedAt: now,
              updatedAt: now,
            })
            .where(eq(backgroundJobs.id, job.id));

          // 5. Registrar evento de auditoría
          await this.db.insert(auditLogs).values({
            eventType: 'CONVERSION_OUTPUT_PRUNED',
            userId: options?.userId ?? null,
            resource: `background_jobs/${job.id}`,
            metadata: {
              jobId: job.id,
              storageKey,
              checksumSha256: job.outputChecksumSha256,
              fileDeleted,
              sharedReferencesRemaining: otherRefCount,
              retentionDays: days,
              completedAt: job.completedAt?.toISOString(),
            },
          });
        }

        report.prunedJobsCount++;
        report.prunedItems.push({
          jobId: job.id,
          storageKey,
          checksumSha256: job.outputChecksumSha256,
          fileDeleted,
          sharedReferencesRemaining: otherRefCount,
        });
      } catch (err: any) {
        report.errors.push({
          jobId: job.id,
          error: err.message || String(err),
        });
      }
    }

    return report;
  }

  /**
   * Recolecta y purga archivos huérfanos en storage/outputs/ aplicando una estricta ventana de cuarentena (CR-04).
   *
   * Reglas de Protección:
   * - Aplica EXCLUSIVAMENTE a storage/outputs/. storage/sources/ NUNCA es auditado para eliminación.
   * - Los archivos cuya fecha de creación/modificación sea menor a quarantineDays (default: 7 días)
   *   son ignorados para proteger cargas y transacciones concurrentes en curso.
   * - Solo los archivos con antigüedad >= quarantineDays que no tengan ninguna referencia activa en BD se eliminan.
   */
  public async collectOrphans(options?: {
    quarantineDays?: number;
    dryRun?: boolean;
    userId?: string;
  }): Promise<OrphanCollectionReport> {
    const days = options?.quarantineDays ?? this.quarantineDays;
    const dryRun = options?.dryRun ?? false;
    const now = new Date();
    const quarantineCutoff = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

    const report: OrphanCollectionReport = {
      timestamp: now.toISOString(),
      dryRun,
      quarantineWindowDays: days,
      scannedFilesCount: 0,
      activeReferencesCount: 0,
      quarantinedFilesCount: 0,
      orphansDeletedCount: 0,
      errors: [],
      orphanItems: [],
    };

    try {
      // 1. Listar todas las claves físicas en el namespace de salidas
      const allKeys = await this.outputStorage.listKeys('outputs/');
      report.scannedFilesCount = allKeys.length;

      for (const key of allKeys) {
        // Garantía explícita de nunca tocar carpetas de origen
        if (key.startsWith('sources/') || key.includes('/sources/')) {
          continue;
        }

        try {
          const meta = await this.outputStorage.getMetadata(key);

          // 2. Comprobar ventana de cuarentena: si es muy reciente, omitir para no interrumpir operaciones concurrentes
          if (meta.createdAt > quarantineCutoff) {
            report.quarantinedFilesCount++;
            continue;
          }

          // 3. Verificar referencias en background_jobs
          const [jobRef] = await this.db
            .select({ id: backgroundJobs.id })
            .from(backgroundJobs)
            .where(
              and(
                eq(backgroundJobs.outputStorageKey, key),
                isNull(backgroundJobs.prunedAt)
              )
            )
            .limit(1);

          // 4. Verificar referencias en song_sources
          const [sourceRef] = await this.db
            .select({ id: songSources.id })
            .from(songSources)
            .where(eq(songSources.storagePath, key))
            .limit(1);

          if (jobRef || sourceRef) {
            report.activeReferencesCount++;
            continue;
          }

          // 5. El archivo no tiene referencias en base de datos y superó la cuarentena: es un huérfano confirmado
          let deleted = false;
          if (!dryRun) {
            await this.outputStorage.delete(key);
            deleted = true;
            report.orphansDeletedCount++;

            // Registrar en auditoría
            await this.db.insert(auditLogs).values({
              eventType: 'ORPHAN_OUTPUT_COLLECTED',
              userId: options?.userId ?? null,
              resource: `storage/${key}`,
              metadata: {
                storageKey: key,
                byteLength: meta.byteLength,
                checksumSha256: meta.checksumSha256,
                fileCreatedAt: meta.createdAt.toISOString(),
                quarantineDays: days,
              },
            });
          } else {
            deleted = true;
            report.orphansDeletedCount++;
          }

          report.orphanItems.push({
            storageKey: key,
            byteLength: meta.byteLength,
            createdAt: meta.createdAt,
            deleted,
            reason: 'Unreferenced file past quarantine period',
          });
        } catch (fileErr: any) {
          report.errors.push({
            storageKey: key,
            error: fileErr.message || String(fileErr),
          });
        }
      }
    } catch (listErr: any) {
      report.errors.push({
        storageKey: 'outputs/',
        error: `Error al listar claves de salida: ${listErr.message || String(listErr)}`,
      });
    }

    return report;
  }

  /**
   * Ejecuta el ciclo completo de retención: podado de expirados seguido de recolección de huérfanos.
   */
  public async runFullCycle(options?: {
    retentionDays?: number;
    quarantineDays?: number;
    dryRun?: boolean;
    userId?: string;
  }): Promise<{
    pruneReport: RetentionPruneReport;
    orphanReport: OrphanCollectionReport;
  }> {
    const pruneReport = await this.pruneExpiredOutputs(options);
    const orphanReport = await this.collectOrphans(options);
    return { pruneReport, orphanReport };
  }
}
