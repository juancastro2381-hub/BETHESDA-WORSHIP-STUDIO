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
   * Ejecuta el podado de artefactos generados que han expirado su ventana de retención (CR-04 & CR-08 Remediation).
   * 
   * Protocolo Transaccional Seguro de Dos Fases (Defect 2 Remediation):
   * 1. FASE DB PRIMERO: Bloqueo de fila y transición atómica de pruned_at = NOW() en la base de datos.
   *    Esto garantiza que ninguna solicitud concurrente de descarga (/download) ni persistencia en catálogo
   *    (commitJobToCatalog) pueda referenciar un artefacto podado.
   * 2. COMPROBACIÓN DE REFERENCIAS COMPARTIDAS (CAS DEDUPLICATION): Se verifica si otros trabajos no podados
   *    o registros en song_sources continúan vinculados a la clave de almacenamiento.
   * 3. ELIMINACIÓN FÍSICA Y AUDITORÍA: Solo si no restan referencias activas se procede a la eliminación física.
   *    Si la eliminación física falla, el estado de la base de datos se mantiene consistente (pruned_at persiste)
   *    y el archivo en disco podrá ser recolectado por el colector de huérfanos de forma idempotente.
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
        let fileDeleted = false;
        let otherRefCount = 0;
        let deletionError: string | null = null;

        // FASE 1: Transición transaccional en Base de Datos PRIMERO
        let transitioned = false;
        if (!dryRun) {
          const [updated] = await this.db
            .update(backgroundJobs)
            .set({
              prunedAt: now,
              updatedAt: now,
            })
            .where(
              and(
                eq(backgroundJobs.id, job.id),
                isNull(backgroundJobs.prunedAt),
                lt(backgroundJobs.completedAt, cutoffDate),
                or(
                  isNull(backgroundJobs.leaseExpiresAt),
                  lt(backgroundJobs.leaseExpiresAt, now)
                )
              )
            )
            .returning({ id: backgroundJobs.id });

          if (!updated) {
            // El trabajo fue tomado por un worker concurrente o ya fue podado
            continue;
          }
          transitioned = true;
        } else {
          transitioned = true;
        }

        // FASE 2: Comprobación de referencias compartidas (CAS Deduplication)
        // Como el trabajo actual ya tiene pruned_at = now, no cuenta como referencia activa
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

        const [activeSources] = await this.db
          .select({ count: sql<number>`count(*)::int` })
          .from(songSources)
          .where(eq(songSources.storagePath, storageKey));

        otherRefCount = (activeOtherJobs?.count ?? 0) + (activeSources?.count ?? 0);

        // FASE 3: Eliminación física idempotente (Solo si cero referencias activas)
        if (otherRefCount === 0) {
          if (!dryRun) {
            try {
              await this.outputStorage.delete(storageKey);
              fileDeleted = true;
              report.filesDeletedCount++;

              // También eliminar el archivo canónico companion si existe
              const canonicalKey = storageKey.replace(/\.[^.]+$/, '.canonical.json');
              if (await this.outputStorage.exists(canonicalKey)) {
                await this.outputStorage.delete(canonicalKey).catch(() => {});
              }
            } catch (delErr: any) {
              if (delErr instanceof StorageNotFoundError) {
                fileDeleted = false; // Ya no existía en disco (idempotencia)
              } else {
                deletionError = delErr?.message ?? String(delErr);
                // Fail-soft: La base de datos es consistente (pruned_at establecido).
                // El archivo físico huérfano será limpiado por el recolector de huérfanos.
              }
            }
          } else {
            fileDeleted = true;
            report.filesDeletedCount++;
          }
        } else {
          report.filesRetainedDueToSharedRef++;
        }

        // FASE 4: Registro de auditoría
        if (!dryRun && transitioned) {
          try {
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
                deletionError,
              },
            });
          } catch (auditErr: any) {
            report.errors.push({
              jobId: job.id,
              error: `Fallo al registrar auditoría de podado: ${auditErr?.message ?? String(auditErr)}`,
            });
          }
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

          // 3. Verificar si es un archivo companion canónico (*.canonical.json)
          if (key.endsWith('.canonical.json')) {
            const baseHash = path.basename(key, '.canonical.json');
            const [compJob] = await this.db
              .select({ id: backgroundJobs.id })
              .from(backgroundJobs)
              .where(
                and(
                  eq(backgroundJobs.outputChecksumSha256, baseHash),
                  isNull(backgroundJobs.prunedAt)
                )
              )
              .limit(1);

            const [compSource] = await this.db
              .select({ id: songSources.id })
              .from(songSources)
              .where(eq(songSources.checksumSha256, baseHash))
              .limit(1);

            if (compJob || compSource) {
              report.activeReferencesCount++;
              continue;
            }
          }

          // 4. Verificar referencias en background_jobs
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

          // 5. Verificar referencias en song_sources
          const [sourceRef] = await this.db
            .select({ id: songSources.id })
            .from(songSources)
            .where(eq(songSources.storagePath, key))
            .limit(1);

          if (jobRef || sourceRef) {
            report.activeReferencesCount++;
            continue;
          }

          // 6. Verificación inmediata pre-eliminación contra referencias concurrentes en vuelo (Defect 3 Remediation)
          const [freshJobRef] = await this.db
            .select({ id: backgroundJobs.id })
            .from(backgroundJobs)
            .where(
              and(
                or(
                  eq(backgroundJobs.outputStorageKey, key),
                  eq(backgroundJobs.outputChecksumSha256, meta.checksumSha256)
                ),
                or(
                  isNull(backgroundJobs.prunedAt),
                  inArray(backgroundJobs.status, ['PENDING', 'PROCESSING'])
                )
              )
            )
            .limit(1);

          const [freshSourceRef] = await this.db
            .select({ id: songSources.id })
            .from(songSources)
            .where(
              or(
                eq(songSources.storagePath, key),
                eq(songSources.checksumSha256, meta.checksumSha256)
              )
            )
            .limit(1);

          if (freshJobRef || freshSourceRef) {
            report.activeReferencesCount++;
            continue;
          }

          // 7. El archivo no tiene referencias en base de datos y superó la cuarentena: es un huérfano confirmado
          let deleted = false;
          if (!dryRun) {
            try {
              await this.outputStorage.delete(key);
              deleted = true;
              report.orphansDeletedCount++;
            } catch (delErr: any) {
              if (delErr instanceof StorageNotFoundError) {
                deleted = false;
              } else {
                throw delErr;
              }
            }

            // Registrar en auditoría
            try {
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
            } catch (auditErr: any) {
              report.errors.push({
                storageKey: key,
                error: `Fallo al registrar auditoría de huérfano: ${auditErr?.message ?? String(auditErr)}`,
              });
            }
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
