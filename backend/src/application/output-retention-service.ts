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
import { db as defaultDb, pool as defaultPool, type Database } from '../db/index.ts';
import { backgroundJobs, songSources, auditLogs, casDeletionIntents, type CasDeletionState } from '../db/schema.ts';
import {
  type IStorageProvider,
  LocalFileSystemStorageProvider,
  StorageNotFoundError,
} from '../domain/storage/storage-provider.ts';
import path from 'node:path';
import type { Pool, PoolClient } from 'pg';

export interface CasReconciliationReport {
  timestamp: string;
  scannedCount: number;
  reconciledCount: number;
  failedCount: number;
  errors: Array<{ storageKey: string; error: string }>;
}

export interface RetentionPruneItem {
  jobId: string;
  storageKey: string;
  checksumSha256: string | null;
  fileDeleted: boolean;
  audited: boolean;
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
  audited: boolean;
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

export interface CasLockOptions {
  lockTimeoutMs?: number;
}

export interface RetentionServiceOptions {
  defaultRetentionDays?: number;
  defaultQuarantineDays?: number;
  defaultLockTimeoutMs?: number;
}

export class OutputRetentionService {
  public static readonly DEFAULT_RETENTION_DAYS = 30;
  public static readonly DEFAULT_QUARANTINE_DAYS = 7;
  public static readonly DEFAULT_LOCK_TIMEOUT_MS = 10000;
  public static readonly MIN_LOCK_TIMEOUT_MS = 0;
  public static readonly MAX_LOCK_TIMEOUT_MS = 300000;

  private readonly retentionDays: number;
  private readonly quarantineDays: number;
  private readonly defaultLockTimeoutMs: number;
  private readonly pool: Pool;

  /**
   * Valida estrictamente un valor de timeout de bloqueo en milisegundos.
   * 
   * Invariantes de Seguridad y Validación:
   * 1. Solo acepta valores de tipo 'number'.
   * 2. Rechaza valores no finitos (NaN, +Infinity, -Infinity).
   * 3. Rechaza números no enteros (flotantes como 12.5).
   * 4. Rechaza números negativos (< 0).
   * 5. Enforza un límite máximo seguro (MAX_LOCK_TIMEOUT_MS = 300,000 ms / 5 minutos).
   * 6. Preserva 0 como valor semántico documentado para desactivar el timeout de sentencia.
   */
  public static validateLockTimeout(timeoutMs: unknown): number {
    if (typeof timeoutMs !== 'number' || Number.isNaN(timeoutMs) || !Number.isFinite(timeoutMs)) {
      throw new TypeError(
        `El timeout de bloqueo debe ser un número entero finito. Recibido: ${String(timeoutMs)}`
      );
    }
    if (!Number.isInteger(timeoutMs)) {
      throw new TypeError(
        `El timeout de bloqueo debe ser un número entero (sin decimales). Recibido: ${timeoutMs}`
      );
    }
    if (timeoutMs < OutputRetentionService.MIN_LOCK_TIMEOUT_MS) {
      throw new RangeError(
        `El timeout de bloqueo no puede ser negativo (${timeoutMs} ms). Mínimo permitido: ${OutputRetentionService.MIN_LOCK_TIMEOUT_MS} ms.`
      );
    }
    if (timeoutMs > OutputRetentionService.MAX_LOCK_TIMEOUT_MS) {
      throw new RangeError(
        `El timeout de bloqueo excede el límite máximo seguro (${timeoutMs} ms). Máximo permitido: ${OutputRetentionService.MAX_LOCK_TIMEOUT_MS} ms (5 minutos).`
      );
    }
    return timeoutMs;
  }

  public constructor(
    private readonly db: Database = defaultDb,
    private readonly outputStorage: IStorageProvider = new LocalFileSystemStorageProvider(
      'storage/outputs'
    ),
    options?: RetentionServiceOptions,
    customPool?: Pool
  ) {
    this.retentionDays = options?.defaultRetentionDays ?? OutputRetentionService.DEFAULT_RETENTION_DAYS;
    this.quarantineDays = options?.defaultQuarantineDays ?? OutputRetentionService.DEFAULT_QUARANTINE_DAYS;
    if (options?.defaultLockTimeoutMs !== undefined) {
      this.defaultLockTimeoutMs = OutputRetentionService.validateLockTimeout(options.defaultLockTimeoutMs);
    } else {
      this.defaultLockTimeoutMs = OutputRetentionService.DEFAULT_LOCK_TIMEOUT_MS;
    }
    this.pool = customPool ?? defaultPool;
  }

  /**
   * Obtiene la clave del artefacto canónico compañero (.canonical.json) a partir de la clave primaria.
   */
  public static getCompanionKey(primaryKey: string): string | null {
    if (primaryKey.endsWith('.canonical.json')) {
      return null;
    }
    return primaryKey.replace(/\.[^.]+$/, '.canonical.json');
  }

  /**
   * Obtiene todas las claves CAS relacionadas (primaria + compañera canónica si aplica).
   */
  public static getRelatedCasKeys(storageKey: string): string[] {
    const companion = OutputRetentionService.getCompanionKey(storageKey);
    return companion ? [storageKey, companion] : [storageKey];
  }

  /**
   * Ejecuta una operación bajo bloqueos consultivos a nivel de sesión en PostgreSQL (pg_advisory_lock).
   * 
   * Protocolo Determinista de Bloqueo Jerárquico:
   * 1. Ordenamiento lexicográfico estricto de todas las claves CAS (clave principal + claves canónicas/compañeras).
   *    Esto elimina matemáticamente cualquier posibilidad de interbloqueo (deadlock) entre workers concurrentes y procesos de retención.
   * 2. Configuración acotada de lock_timeout para evitar bloqueos indefinidos ante particiones de red o contención persistente.
   * 3. Adquisición secuencial de cada clave bajo la misma conexión de cliente PostgreSQL (PoolClient).
   * 4. Liberación confiable en bloque 'finally' en orden inverso de adquisición, manejando fallos parciales de adquisición.
   * 5. Si ocurre cualquier error o timeout, la conexión se descarta del pool (client.release(true)) para evitar fuga de estado de sesión.
   */
  public async withCasAdvisoryLocks<T>(
    keys: string | string[],
    operation: (client: PoolClient) => Promise<T>,
    options?: CasLockOptions
  ): Promise<T> {
    const keyArray = Array.isArray(keys) ? keys : [keys];
    const sortedKeys = Array.from(new Set(keyArray.filter(Boolean))).sort();

    // Validación estricta y temprana de configuración de timeout antes del checkout de conexión
    const rawTimeout = options?.lockTimeoutMs !== undefined ? options.lockTimeoutMs : this.defaultLockTimeoutMs;
    const timeoutMs = OutputRetentionService.validateLockTimeout(rawTimeout);

    const client = await this.pool.connect();
    const acquiredKeys: string[] = [];
    let isConnectionDirty = false;

    try {
      if (timeoutMs > 0) {
        await client.query(`SET lock_timeout = ${timeoutMs}`);
        isConnectionDirty = true;
      }

      for (const key of sortedKeys) {
        await client.query('SELECT pg_advisory_lock(hashtext($1))', [key]);
        acquiredKeys.push(key);
      }

      if (isConnectionDirty) {
        await client.query('RESET lock_timeout');
        isConnectionDirty = false;
      }

      return await operation(client);
    } catch (error) {
      isConnectionDirty = true;
      throw error;
    } finally {
      for (const key of [...acquiredKeys].reverse()) {
        try {
          await client.query('SELECT pg_advisory_unlock(hashtext($1))', [key]);
        } catch {
          isConnectionDirty = true;
        }
      }

      if (isConnectionDirty) {
        client.release(true);
      } else {
        client.release();
      }
    }
  }

  /**
   * Wrapper retrocompatible para bloquear una clave individual.
   */
  public async withCasAdvisoryLock<T>(
    storageKey: string,
    operation: (client: PoolClient) => Promise<T>,
    options?: CasLockOptions
  ): Promise<T> {
    return this.withCasAdvisoryLocks([storageKey], operation, options);
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
      const canonicalKey =
        (job as any).errorDetails?.canonicalStorageKey ??
        OutputRetentionService.getCompanionKey(storageKey);
      const keysToLock = [storageKey, canonicalKey].filter((k): k is string => Boolean(k)).sort();

      try {
        let fileDeleted = false;
        let audited = false;
        let otherRefCount = 0;
        let deletionError: string | null = null;
        let intentCommitted = false;

        if (!dryRun) {
          await this.withCasAdvisoryLocks(keysToLock, async () => {
            // =========================================================================
            // FASE 1: Compromiso de Intención de Eliminación en Base de Datos (Tx 1)
            // =========================================================================
            // La intención DELETE_PENDING y pruned_at = NOW() se comitean en PostgreSQL
            // ANTES de cualquier operación sobre el sistema de archivos.
            // Si Tx 1 falla o revierte, el archivo físico permanece intacto en disco.
            await this.db.transaction(async (tx) => {
              const [lockedJob] = await tx
                .select({ id: backgroundJobs.id })
                .from(backgroundJobs)
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
                .for('update');

              if (!lockedJob) {
                return; // Ya fue podado o tomado por un worker con lease activo
              }

              const [updated] = await tx
                .update(backgroundJobs)
                .set({
                  prunedAt: now,
                  updatedAt: now,
                })
                .where(eq(backgroundJobs.id, job.id))
                .returning({ id: backgroundJobs.id });

              if (!updated) {
                return;
              }

              // Comprobación de referencias compartidas (CAS Deduplication) tanto para primaryKey como para canonicalKey
              const [activeOtherJobs] = await tx
                .select({ count: sql<number>`count(*)::int` })
                .from(backgroundJobs)
                .where(
                  and(
                    or(
                      eq(backgroundJobs.outputStorageKey, storageKey),
                      canonicalKey ? eq(backgroundJobs.outputStorageKey, canonicalKey) : sql`false`,
                      sql`(${backgroundJobs.errorDetails}->>'outputStorageKey' = ${storageKey})`,
                      canonicalKey ? sql`(${backgroundJobs.errorDetails}->>'canonicalStorageKey' = ${canonicalKey})` : sql`false`
                    ),
                    isNull(backgroundJobs.prunedAt),
                    not(eq(backgroundJobs.id, job.id))
                  )
                );

              const [activeSources] = await tx
                .select({ count: sql<number>`count(*)::int` })
                .from(songSources)
                .where(
                  or(
                    eq(songSources.storagePath, storageKey),
                    canonicalKey ? eq(songSources.storagePath, canonicalKey) : sql`false`
                  )
                );

              otherRefCount = (activeOtherJobs?.count ?? 0) + (activeSources?.count ?? 0);

              // Si no existen referencias compartidas, registrar intención durable de eliminación
              if (otherRefCount === 0) {
                await tx
                  .insert(casDeletionIntents)
                  .values({
                    storageKey,
                    canonicalKey,
                    checksumSha256: job.outputChecksumSha256,
                    jobId: job.id,
                    state: 'DELETE_PENDING',
                    primaryDeleted: false,
                    companionDeleted: false,
                    attempts: 0,
                    createdAt: now,
                    updatedAt: now,
                  })
                  .onConflictDoUpdate({
                    target: casDeletionIntents.storageKey,
                    set: {
                      canonicalKey,
                      state: 'DELETE_PENDING',
                      primaryDeleted: false,
                      companionDeleted: false,
                      primaryError: null,
                      companionError: null,
                      lastError: null,
                      jobId: job.id,
                      updatedAt: now,
                    },
                  });
                intentCommitted = true;
              }
            });

            // Si el archivo sigue compartido con otros trabajos, NO debe eliminarse físicamente
            if (otherRefCount > 0 || !intentCommitted) {
              return;
            }

            // =========================================================================
            // FASE 2: Eliminación Física en Almacenamiento (SIN TRANSACCIÓN DB ABIERTA)
            // =========================================================================
            // Cumple con el Requirement 13: Cero transacciones DB retenidas durante E/S física
            // NUNCA suprime errores de eliminación del compañero canónico (.catch(() => {}))
            let primaryDeleted = false;
            let companionDeleted = !canonicalKey;
            let primaryError: string | null = null;
            let companionError: string | null = null;

            try {
              await this.outputStorage.delete(storageKey);
              primaryDeleted = true;
            } catch (delErr: any) {
              if (delErr instanceof StorageNotFoundError) {
                primaryDeleted = true; // Idempotencia si el archivo ya no existía
              } else {
                primaryDeleted = false;
                primaryError = delErr?.message ?? String(delErr);
              }
            }

            if (canonicalKey) {
              try {
                const exists = await this.outputStorage.exists(canonicalKey);
                if (exists) {
                  await this.outputStorage.delete(canonicalKey);
                }
                companionDeleted = true;
              } catch (compErr: any) {
                if (compErr instanceof StorageNotFoundError) {
                  companionDeleted = true;
                } else {
                  companionDeleted = false;
                  companionError = compErr?.message ?? String(compErr);
                }
              }
            }

            // =========================================================================
            // FASE 3: Persistencia de Estado Terminal y Auditoría (Tx 2)
            // =========================================================================
            if (!primaryDeleted || !companionDeleted) {
              const combinedError = [
                primaryError ? `Primary (${storageKey}): ${primaryError}` : null,
                companionError ? `Companion (${canonicalKey}): ${companionError}` : null,
              ].filter(Boolean).join('; ');

              deletionError = combinedError;

              // Si la eliminación física fue incompleta, registrar estado reintentable (RETRY_PENDING)
              await this.db
                .update(casDeletionIntents)
                .set({
                  state: 'RETRY_PENDING',
                  primaryDeleted,
                  companionDeleted,
                  primaryError,
                  companionError,
                  lastError: combinedError,
                  attempts: sql`${casDeletionIntents.attempts} + 1`,
                  updatedAt: new Date(),
                })
                .where(eq(casDeletionIntents.storageKey, storageKey));

              report.errors.push({
                jobId: job.id,
                error: `Fallo físico parcial o total (registrado RETRY_PENDING): ${combinedError}`,
              });
            } else {
              // Eliminación física de todos los artefactos completada: actualizar intención a DELETED
              await this.db.transaction(async (tx) => {
                await tx
                  .update(casDeletionIntents)
                  .set({
                    state: 'DELETED',
                    primaryDeleted: true,
                    companionDeleted: true,
                    primaryError: null,
                    companionError: null,
                    lastError: null,
                    deletedAt: new Date(),
                    updatedAt: new Date(),
                  })
                  .where(eq(casDeletionIntents.storageKey, storageKey));

                // Registro de auditoría mediante subtransacción aislada (SAVEPOINT)
                try {
                  await tx.transaction(async (subTx) => {
                    await subTx.insert(auditLogs).values({
                      eventType: 'CONVERSION_OUTPUT_PRUNED',
                      userId: options?.userId ?? null,
                      resource: `background_jobs/${job.id}`,
                      metadata: {
                        jobId: job.id,
                        storageKey,
                        canonicalKey,
                        checksumSha256: job.outputChecksumSha256,
                        fileDeleted: true,
                        primaryDeleted: true,
                        companionDeleted: true,
                        sharedReferencesRemaining: otherRefCount,
                        retentionDays: days,
                        completedAt: job.completedAt?.toISOString(),
                        deletionError: null,
                      },
                    });
                  });
                  audited = true;
                  await tx
                    .update(casDeletionIntents)
                    .set({ audited: true })
                    .where(eq(casDeletionIntents.storageKey, storageKey));
                } catch (aErr: any) {
                  audited = false;
                  const auditError = aErr?.message ?? String(aErr);
                  report.errors.push({
                    jobId: job.id,
                    error: `Fallo al registrar auditoría de podado: ${auditError}`,
                  });
                }
              });

              fileDeleted = true;
            }
          });
        } else {
          // Modo simulación (Dry Run)
          fileDeleted = true;
          audited = true;
        }

        if (fileDeleted) {
          report.filesDeletedCount++;
        } else if (otherRefCount > 0) {
          report.filesRetainedDueToSharedRef++;
        }

        report.prunedJobsCount++;
        report.prunedItems.push({
          jobId: job.id,
          storageKey,
          checksumSha256: job.outputChecksumSha256,
          fileDeleted,
          audited,
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

          let deleted = false;
          let audited = false;

          if (!dryRun) {
            const canonicalKey = OutputRetentionService.getCompanionKey(key);
            const keysToLock = OutputRetentionService.getRelatedCasKeys(key).sort();

            await this.withCasAdvisoryLocks(keysToLock, async () => {
              let otherRefCount = 0;
              let intentCommitted = false;
              let deletionError: string | null = null;

              // =========================================================================
              // FASE 1: Verificación de Referencias y Registro de Intención (Tx 1)
              // =========================================================================
              // Se comitea la intención DELETE_PENDING en PostgreSQL ANTES de cualquier
              // operación en el sistema de archivos (Requirement 4).
              await this.db.transaction(async (tx) => {
                // 3. Verificar si es un archivo companion canónico (*.canonical.json) bajo el lock
                if (key.endsWith('.canonical.json')) {
                  const baseHash = path.basename(key, '.canonical.json');
                  const [compJob] = await tx
                    .select({ id: backgroundJobs.id })
                    .from(backgroundJobs)
                    .where(
                      and(
                        eq(backgroundJobs.outputChecksumSha256, baseHash),
                        isNull(backgroundJobs.prunedAt)
                      )
                    )
                    .limit(1);

                  const [compSource] = await tx
                    .select({ id: songSources.id })
                    .from(songSources)
                    .where(eq(songSources.checksumSha256, baseHash))
                    .limit(1);

                  if (compJob || compSource) {
                    otherRefCount++;
                    return;
                  }
                }

                // 4. Verificar referencias en background_jobs bajo el lock
                const [jobRef] = await tx
                  .select({ id: backgroundJobs.id })
                  .from(backgroundJobs)
                  .where(
                    and(
                      or(
                        eq(backgroundJobs.outputStorageKey, key),
                        canonicalKey ? eq(backgroundJobs.outputStorageKey, canonicalKey) : sql`false`,
                        sql`(${backgroundJobs.errorDetails}->>'outputStorageKey' = ${key})`,
                        canonicalKey ? sql`(${backgroundJobs.errorDetails}->>'canonicalStorageKey' = ${canonicalKey})` : sql`false`
                      ),
                      isNull(backgroundJobs.prunedAt)
                    )
                  )
                  .limit(1);

                const [sourceRef] = await tx
                  .select({ id: songSources.id })
                  .from(songSources)
                  .where(
                    or(
                      eq(songSources.storagePath, key),
                      canonicalKey ? eq(songSources.storagePath, canonicalKey) : sql`false`
                    )
                  )
                  .limit(1);

                if (jobRef || sourceRef) {
                  otherRefCount++;
                  return;
                }

                // 5. Verificación inmediata pre-eliminación contra referencias concurrentes en vuelo (Defect 3 Remediation)
                const [freshJobRef] = await tx
                  .select({ id: backgroundJobs.id })
                  .from(backgroundJobs)
                  .where(
                    and(
                      or(
                        eq(backgroundJobs.outputStorageKey, key),
                        canonicalKey ? eq(backgroundJobs.outputStorageKey, canonicalKey) : sql`false`,
                        eq(backgroundJobs.outputChecksumSha256, meta.checksumSha256)
                      ),
                      or(
                        isNull(backgroundJobs.prunedAt),
                        inArray(backgroundJobs.status, ['PENDING', 'PROCESSING'])
                      )
                    )
                  )
                  .limit(1);

                const [freshSourceRef] = await tx
                  .select({ id: songSources.id })
                  .from(songSources)
                  .where(
                    or(
                      eq(songSources.storagePath, key),
                      canonicalKey ? eq(songSources.storagePath, canonicalKey) : sql`false`,
                      eq(songSources.checksumSha256, meta.checksumSha256)
                    )
                  )
                  .limit(1);

                if (freshJobRef || freshSourceRef) {
                  otherRefCount++;
                  return;
                }

                // Registrar intención de eliminación DELETE_PENDING
                await tx
                  .insert(casDeletionIntents)
                  .values({
                    storageKey: key,
                    canonicalKey,
                    checksumSha256: meta.checksumSha256,
                    state: 'DELETE_PENDING',
                    primaryDeleted: false,
                    companionDeleted: false,
                    attempts: 0,
                    createdAt: now,
                    updatedAt: now,
                  })
                  .onConflictDoUpdate({
                    target: casDeletionIntents.storageKey,
                    set: {
                      canonicalKey,
                      state: 'DELETE_PENDING',
                      primaryDeleted: false,
                      companionDeleted: false,
                      primaryError: null,
                      companionError: null,
                      lastError: null,
                      updatedAt: now,
                    },
                  });
                intentCommitted = true;
              });

              if (otherRefCount > 0 || !intentCommitted) {
                report.activeReferencesCount++;
                return;
              }

              // =========================================================================
              // FASE 2: Eliminación Física en Almacenamiento (SIN TRANSACCIÓN DB ABIERTA)
              // =========================================================================
              // Cumple con el Requirement 13: Cero transacciones DB retenidas durante E/S física
              let primaryDeleted = false;
              let companionDeleted = !canonicalKey;
              let primaryError: string | null = null;
              let companionError: string | null = null;

              try {
                const wasDeleted = await this.outputStorage.delete(key);
                primaryDeleted = true;
                if (wasDeleted) {
                  deleted = true;
                }
              } catch (delErr: any) {
                if (delErr instanceof StorageNotFoundError) {
                  primaryDeleted = true;
                } else {
                  primaryDeleted = false;
                  primaryError = delErr?.message ?? String(delErr);
                }
              }

              if (canonicalKey) {
                try {
                  const exists = await this.outputStorage.exists(canonicalKey);
                  if (exists) {
                    await this.outputStorage.delete(canonicalKey);
                  }
                  companionDeleted = true;
                } catch (compErr: any) {
                  if (compErr instanceof StorageNotFoundError) {
                    companionDeleted = true;
                  } else {
                    companionDeleted = false;
                    companionError = compErr?.message ?? String(compErr);
                  }
                }
              }

              // =========================================================================
              // FASE 3: Persistencia de Estado Terminal y Auditoría (Tx 2)
              // =========================================================================
              if (!primaryDeleted || !companionDeleted) {
                const combinedError = [
                  primaryError ? `Primary (${key}): ${primaryError}` : null,
                  companionError ? `Companion (${canonicalKey}): ${companionError}` : null,
                ].filter(Boolean).join('; ');

                deletionError = combinedError;

                await this.db
                  .update(casDeletionIntents)
                  .set({
                    state: 'RETRY_PENDING',
                    primaryDeleted,
                    companionDeleted,
                    primaryError,
                    companionError,
                    lastError: combinedError,
                    attempts: sql`${casDeletionIntents.attempts} + 1`,
                    updatedAt: new Date(),
                  })
                  .where(eq(casDeletionIntents.storageKey, key));

                report.errors.push({
                  storageKey: key,
                  error: `Fallo físico de eliminación huérfano (registrado RETRY_PENDING): ${combinedError}`,
                });
              } else {
                await this.db.transaction(async (tx) => {
                  await tx
                    .update(casDeletionIntents)
                    .set({
                      state: 'DELETED',
                      primaryDeleted: true,
                      companionDeleted: true,
                      primaryError: null,
                      companionError: null,
                      lastError: null,
                      deletedAt: new Date(),
                      updatedAt: new Date(),
                    })
                    .where(eq(casDeletionIntents.storageKey, key));

                  // 7. Registro de auditoría mediante subtransacción aislada (SAVEPOINT)
                  try {
                    await tx.transaction(async (subTx) => {
                      await subTx.insert(auditLogs).values({
                        eventType: 'ORPHAN_OUTPUT_COLLECTED',
                        userId: options?.userId ?? null,
                        resource: `storage/${key}`,
                        metadata: {
                          storageKey: key,
                          canonicalKey,
                          byteLength: meta.byteLength,
                          checksumSha256: meta.checksumSha256,
                          fileCreatedAt: meta.createdAt.toISOString(),
                          quarantineDays: days,
                        },
                      });
                    });
                    audited = true;
                    await tx
                      .update(casDeletionIntents)
                      .set({ audited: true })
                      .where(eq(casDeletionIntents.storageKey, key));
                  } catch (auditErr: any) {
                    audited = false;
                    report.errors.push({
                      storageKey: key,
                      error: `Fallo al registrar auditoría de huérfano: ${auditErr?.message ?? String(auditErr)}`,
                    });
                  }
                });
                report.orphansDeletedCount++;
              }
            });
          } else {
            // Modo simulación (Dry Run)
            deleted = true;
            audited = true;
            report.orphansDeletedCount++;
          }

          if (deleted) {
            report.orphanItems.push({
              storageKey: key,
              byteLength: meta.byteLength,
              createdAt: meta.createdAt,
              deleted,
              audited,
              reason: 'Unreferenced file past quarantine period',
            });
          }
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
   * Reconcilia intenciones de eliminación pendientes o fallidas (DELETE_PENDING, RETRY_PENDING) (CR-04 Remediation).
   * 
   * Garantiza la recuperabilidad total ante caídas abruptas de procesos o fallos de red durante el ciclo de vida CAS.
   */
  public async reconcilePendingDeletions(options?: {
    userId?: string;
  }): Promise<CasReconciliationReport> {
    const report: CasReconciliationReport = {
      timestamp: new Date().toISOString(),
      scannedCount: 0,
      reconciledCount: 0,
      failedCount: 0,
      errors: [],
    };

    const pendingIntents = await this.db
      .select()
      .from(casDeletionIntents)
      .where(inArray(casDeletionIntents.state, ['DELETE_PENDING', 'RETRY_PENDING']));

    report.scannedCount = pendingIntents.length;

    for (const intent of pendingIntents) {
      const primaryKey = intent.storageKey;
      const canonicalKey =
        intent.canonicalKey ?? OutputRetentionService.getCompanionKey(primaryKey);
      const keysToLock = [primaryKey, canonicalKey].filter((k): k is string => Boolean(k)).sort();

      try {
        await this.withCasAdvisoryLocks(keysToLock, async () => {
          // Re-consultar estado actual bajo el lock
          const [current] = await this.db
            .select()
            .from(casDeletionIntents)
            .where(eq(casDeletionIntents.storageKey, primaryKey))
            .limit(1);

          if (
            !current ||
            current.state === 'DELETED' ||
            current.state === 'RETAINED' ||
            current.state === 'CANCELLED'
          ) {
            return; // Ya reconciliado de forma idempotente
          }

          // Verificar si un nuevo worker o proceso registró una referencia legítima
          const [activeJob] = await this.db
            .select({ id: backgroundJobs.id })
            .from(backgroundJobs)
            .where(
              and(
                or(
                  eq(backgroundJobs.outputStorageKey, primaryKey),
                  canonicalKey ? eq(backgroundJobs.outputStorageKey, canonicalKey) : sql`false`,
                  sql`(${backgroundJobs.errorDetails}->>'outputStorageKey' = ${primaryKey})`,
                  canonicalKey ? sql`(${backgroundJobs.errorDetails}->>'canonicalStorageKey' = ${canonicalKey})` : sql`false`
                ),
                isNull(backgroundJobs.prunedAt)
              )
            )
            .limit(1);

          const [activeSource] = await this.db
            .select({ id: songSources.id })
            .from(songSources)
            .where(
              or(
                eq(songSources.storagePath, primaryKey),
                canonicalKey ? eq(songSources.storagePath, canonicalKey) : sql`false`
              )
            )
            .limit(1);

          if (activeJob || activeSource) {
            // CRITICAL RECOVERY SEMANTICS: Existe referencia activa.
            // Transición explícita a 'RETAINED' (NUNCA a 'DELETED').
            // El artefacto físico se conserva intacto porque está en uso legítimo.
            await this.db.transaction(async (tx) => {
              await tx
                .update(casDeletionIntents)
                .set({
                  state: 'RETAINED',
                  lastError: `Deletion cancelled: active reference detected (job: ${activeJob?.id ?? 'none'}, source: ${activeSource?.id ?? 'none'})`,
                  updatedAt: new Date(),
                })
                .where(eq(casDeletionIntents.storageKey, primaryKey));

              try {
                await tx.transaction(async (subTx) => {
                  await subTx.insert(auditLogs).values({
                    eventType: 'CAS_OBJECT_RETAINED',
                    userId: options?.userId ?? null,
                    resource: `storage/${primaryKey}`,
                    metadata: {
                      storageKey: primaryKey,
                      canonicalKey,
                      checksumSha256: current.checksumSha256,
                      jobId: current.jobId,
                      activeJobId: activeJob?.id ?? null,
                      activeSourceId: activeSource?.id ?? null,
                      reason:
                        'Active reference detected during recovery reconciliation; deletion cancelled and object retained.',
                      reconciledAt: new Date().toISOString(),
                    },
                  });
                });
                await tx
                  .update(casDeletionIntents)
                  .set({ audited: true })
                  .where(eq(casDeletionIntents.storageKey, primaryKey));
              } catch (auditErr: any) {
                report.errors.push({
                  storageKey: primaryKey,
                  error: `Fallo al registrar auditoría de retención: ${auditErr?.message ?? String(auditErr)}`,
                });
              }
            });
            report.reconciledCount++;
            return;
          }

          // No hay referencias activas: reintentar SOLO los artefactos incompletos
          let primaryDeleted = current.primaryDeleted;
          let companionDeleted = current.companionDeleted || !canonicalKey;
          let primaryError: string | null = null;
          let companionError: string | null = null;

          if (!primaryDeleted) {
            try {
              await this.outputStorage.delete(primaryKey);
              primaryDeleted = true;
            } catch (delErr: any) {
              if (delErr instanceof StorageNotFoundError) {
                primaryDeleted = true; // Idempotencia
              } else {
                primaryDeleted = false;
                primaryError = delErr?.message ?? String(delErr);
              }
            }
          }

          if (canonicalKey && !companionDeleted) {
            try {
              const exists = await this.outputStorage.exists(canonicalKey);
              if (exists) {
                await this.outputStorage.delete(canonicalKey);
              }
              companionDeleted = true;
            } catch (compErr: any) {
              if (compErr instanceof StorageNotFoundError) {
                companionDeleted = true;
              } else {
                companionDeleted = false;
                companionError = compErr?.message ?? String(compErr);
              }
            }
          }

          if (!primaryDeleted || !companionDeleted) {
            const nextAttempts = current.attempts + 1;
            const nextState =
              nextAttempts >= current.maxAttempts ? 'DELETE_FAILED' : 'RETRY_PENDING';
            const combinedError = [
              primaryError ? `Primary (${primaryKey}): ${primaryError}` : null,
              companionError ? `Companion (${canonicalKey}): ${companionError}` : null,
            ]
              .filter(Boolean)
              .join('; ');

            await this.db
              .update(casDeletionIntents)
              .set({
                state: nextState,
                attempts: nextAttempts,
                primaryDeleted,
                companionDeleted,
                primaryError: primaryError ?? current.primaryError,
                companionError: companionError ?? current.companionError,
                lastError: combinedError || current.lastError,
                updatedAt: new Date(),
              })
              .where(eq(casDeletionIntents.storageKey, primaryKey));

            report.failedCount++;
            report.errors.push({
              storageKey: primaryKey,
              error: combinedError || 'Incomplete deletion',
            });
          } else {
            // Ambos artefactos físicamente eliminados o ausentes: persistir DELETED y auditar
            await this.db.transaction(async (tx) => {
              await tx
                .update(casDeletionIntents)
                .set({
                  state: 'DELETED',
                  primaryDeleted: true,
                  companionDeleted: true,
                  primaryError: null,
                  companionError: null,
                  lastError: null,
                  deletedAt: new Date(),
                  updatedAt: new Date(),
                })
                .where(eq(casDeletionIntents.storageKey, primaryKey));

              try {
                await tx.transaction(async (subTx) => {
                  await subTx.insert(auditLogs).values({
                    eventType: 'CONVERSION_OUTPUT_DELETION_RECONCILED',
                    userId: options?.userId ?? null,
                    resource: `storage/${primaryKey}`,
                    metadata: {
                      storageKey: primaryKey,
                      canonicalKey,
                      checksumSha256: current.checksumSha256,
                      jobId: current.jobId,
                      primaryDeleted: true,
                      companionDeleted: true,
                      reconciledAt: new Date().toISOString(),
                    },
                  });
                });
                await tx
                  .update(casDeletionIntents)
                  .set({ audited: true })
                  .where(eq(casDeletionIntents.storageKey, primaryKey));
              } catch (auditErr: any) {
                report.errors.push({
                  storageKey: primaryKey,
                  error: `Fallo al registrar auditoría de reconciliación: ${auditErr?.message ?? String(auditErr)}`,
                });
              }
            });
            report.reconciledCount++;
          }
        });
      } catch (err: any) {
        report.failedCount++;
        report.errors.push({
          storageKey: intent.storageKey,
          error: err.message || String(err),
        });
      }
    }

    return report;
  }

  /**
   * Reconcilia registros de intenciones completadas físicamente (DELETED o RETAINED)
   * cuya persistencia de auditoría falló previamente en la subtransacción SAVEPOINT (audited = false).
   * 
   * Procedimiento de Reconciliación Concurrente e Idempotente:
   * 1. Consulta candidatos en estado terminal (DELETED, RETAINED) con audited = false.
   * 2. Para cada candidato, abre una transacción PostgreSQL dedicada.
   * 3. Adquiere bloqueo exclusivo de fila mediante SELECT ... FOR UPDATE.
   * 4. Re-evalúa estado y audited bajo el bloqueo: si otro worker concurrente ya lo reconcilió, omite.
   * 5. Verifica idempotencia contra audit_logs mediante el token de intención (metadata->>'intentId').
   * 6. Inserta exactamente un evento de auditoría y actualiza audited = true dentro de la misma transacción.
   * 7. Preserva el estado físico sin modificaciones (DELETED o RETAINED se mantienen intactos).
   * 8. Ante fallo (p.ej. violación de FK en auditLogs), el rollback de tx preserva audited = false truthful.
   */
  public async reconcileUnauditedDeletions(options?: {
    userId?: string;
  }): Promise<{
    scannedCount: number;
    reconciledCount: number;
    reconciledAuditCount: number;
    skippedCount: number;
    failedCount: number;
    errors: Array<{ storageKey: string; error: string }>;
  }> {
    const report = {
      scannedCount: 0,
      reconciledCount: 0,
      reconciledAuditCount: 0,
      skippedCount: 0,
      failedCount: 0,
      errors: [] as Array<{ storageKey: string; error: string }>,
    };

    const candidates = await this.db
      .select({ storageKey: casDeletionIntents.storageKey })
      .from(casDeletionIntents)
      .where(
        and(
          eq(casDeletionIntents.audited, false),
          inArray(casDeletionIntents.state, ['DELETED', 'RETAINED'])
        )
      );

    report.scannedCount = candidates.length;

    for (const candidate of candidates) {
      try {
        const wasReconciled = await this.db.transaction(async (tx) => {
          // Bloqueo exclusivo de fila para serializar workers concurrentes
          const [lockedIntent] = await tx
            .select()
            .from(casDeletionIntents)
            .where(eq(casDeletionIntents.storageKey, candidate.storageKey))
            .for('update');

          // Re-verificación bajo bloqueo: omitir si ya fue auditado o si el estado mutó
          if (
            !lockedIntent ||
            lockedIntent.audited ||
            !['DELETED', 'RETAINED'].includes(lockedIntent.state)
          ) {
            return false;
          }

          const eventType =
            lockedIntent.state === 'RETAINED'
              ? 'CAS_OBJECT_RETAINED'
              : 'CONVERSION_OUTPUT_DELETION_RECONCILED';

          // Salvaguarda de idempotencia: comprobar si ya existe una entrada previa en audit_logs
          const [existingAudit] = await tx
            .select({ id: auditLogs.id })
            .from(auditLogs)
            .where(
              and(
                eq(auditLogs.resource, `storage/${lockedIntent.storageKey}`),
                eq(auditLogs.eventType, eventType),
                sql`(${auditLogs.metadata}->>'intentId' = ${lockedIntent.id})`
              )
            )
            .limit(1);

          if (existingAudit) {
            await tx
              .update(casDeletionIntents)
              .set({ audited: true, updatedAt: new Date() })
              .where(eq(casDeletionIntents.storageKey, lockedIntent.storageKey));
            return false;
          }

          // Inserción de exactamente UN evento de auditoría
          await tx.insert(auditLogs).values({
            eventType,
            userId: options?.userId ?? null,
            resource: `storage/${lockedIntent.storageKey}`,
            metadata: {
              intentId: lockedIntent.id,
              storageKey: lockedIntent.storageKey,
              canonicalKey: lockedIntent.canonicalKey,
              checksumSha256: lockedIntent.checksumSha256,
              state: lockedIntent.state,
              reconciledAt: new Date().toISOString(),
              reason: 'Audit reconciliation for previously unaudited physical lifecycle event',
            },
          });

          // Actualizar audited = true en la MISMA transacción
          // Invariante de Dominio: El estado físico (state) NUNCA se altera
          await tx
            .update(casDeletionIntents)
            .set({ audited: true, updatedAt: new Date() })
            .where(eq(casDeletionIntents.storageKey, lockedIntent.storageKey));

          return true;
        });

        if (wasReconciled) {
          report.reconciledCount++;
          report.reconciledAuditCount++;
        } else {
          report.skippedCount++;
        }
      } catch (err: any) {
        // En caso de fallo transaccional (p.ej. violación de FK en auditLogs),
        // el rollback de tx garantiza que audited continúe siendo false
        report.failedCount++;
        report.errors.push({
          storageKey: candidate.storageKey,
          error: err.message || String(err),
        });
      }
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
