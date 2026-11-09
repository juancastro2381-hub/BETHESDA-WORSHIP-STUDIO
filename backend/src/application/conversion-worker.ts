/**
 * @file conversion-worker.ts
 * @description Worker autoritativo en segundo plano para el procesamiento de conversiones musicales (Fases 2A-R & 2A-R2).
 *
 * Implementa control estricto de concurrencia, arrendamientos distribuidos (leases),
 * testigo de ejecución (fencing token), latido de renovación (heartbeat),
 * recuperación consciente de arrendamientos expirados y protección de estados terminales / cancelación.
 */

import crypto from 'node:crypto';
import os from 'node:os';
import { and, eq, lt, or, sql } from 'drizzle-orm';
import { db as defaultDb, type Database } from '../db/index.ts';
import { backgroundJobs, type BackgroundJobRow } from '../db/schema.ts';
import {
  LocalFileSystemSourceStorageProvider,
  type ISourceStorageProvider,
} from '../domain/ingestion/source-storage-provider.ts';
import {
  CONVERSION_QUEUE_NAME,
  type ConversionJobPayload,
  enqueueConversionJob,
  getConversionQueue,
  startConversionQueue,
} from '../infrastructure/queue/conversion-queue.ts';
import {
  ConversionEngine,
  FormatCapabilitiesEvaluator,
  type ConversionExportResult,
} from '../../../frontend/src/core/conversion/index.ts';
import { CanonicalSerializer } from '../domain/canonical-serializer.ts';

export class TransientWorkerError extends Error {
  public constructor(message: string, public readonly originalError?: unknown) {
    super(message);
    this.name = 'TransientWorkerError';
  }
}

export function isTransientError(err: any): boolean {
  if (!err) return false;
  if (err instanceof TransientWorkerError || err?.name === 'TransientWorkerError') return true;
  const msg = String(err.message || '').toLowerCase();
  const code = String(err.code || '').toLowerCase();
  return (
    code === 'econnreset' ||
    code === 'econnrefused' ||
    code === 'etimedout' ||
    code === '57p01' || // PostgreSQL admin shutdown
    code === '08006' || // PostgreSQL connection failure
    code === '08001' || // PostgreSQL unable to establish connection
    code === '40001' || // PostgreSQL serialization failure / deadlock
    msg.includes('connection terminated') ||
    msg.includes('timeout') ||
    msg.includes('network') ||
    msg.includes('transient') ||
    msg.includes('transitorio') ||
    msg.includes('econnreset') ||
    msg.includes('deadlock')
  );
}

export interface ConversionWorkerOptions {
  recoveryIntervalMs?: number;
  onStageReached?: (stage: 'STAGE_A' | 'STAGE_B' | 'STAGE_C' | 'STAGE_D', jobId: string) => Promise<void> | void;
}

export class ConversionWorker {
  public static readonly LEASE_DURATION_MS = 60_000; // 60 segundos de validez de arrendamiento
  public static readonly HEARTBEAT_INTERVAL_MS = 15_000; // 15 segundos entre renovaciones de latido
  public static readonly DEFAULT_RECOVERY_INTERVAL_MS = 60_000; // 60 segundos por defecto entre pasadas de recuperación (WS03)

  public readonly workerId: string;
  private readonly engine: ConversionEngine;
  private readonly storage: ISourceStorageProvider;
  private readonly recoveryIntervalMs: number;
  private readonly onStageReached?: (stage: 'STAGE_A' | 'STAGE_B' | 'STAGE_C' | 'STAGE_D', jobId: string) => Promise<void> | void;
  private readonly activeJobIds = new Set<string>();
  private readonly activeJobCounts = new Map<string, number>();
  private recoveryTimer: NodeJS.Timeout | null = null;
  private recoveryCycleCount = 0;
  private isRecovering = false;
  private isWorking = false;
  private isStarted = false;
  private isStopping = false;
  private stoppingPromise: Promise<void> | null = null;

  public constructor(
    private readonly db: Database = defaultDb,
    customStorage?: ISourceStorageProvider,
    customEngine?: ConversionEngine,
    customWorkerId?: string,
    options?: ConversionWorkerOptions
  ) {
    this.workerId =
      customWorkerId ??
      `worker_${process.pid}_${os.hostname()}_${crypto.randomUUID().slice(0, 8)}`;
    this.storage = customStorage ?? new LocalFileSystemSourceStorageProvider();
    this.engine = customEngine ?? new ConversionEngine();
    this.recoveryIntervalMs = options?.recoveryIntervalMs ?? ConversionWorker.DEFAULT_RECOVERY_INTERVAL_MS;
    this.onStageReached = options?.onStageReached;
  }

  public isActive(): boolean {
    return this.isStarted && this.isWorking;
  }

  public getActiveJobsCount(): number {
    return this.activeJobIds.size;
  }

  public getActiveJobIds(): ReadonlySet<string> {
    return new Set(this.activeJobIds);
  }

  public getRecoveryCycleCount(): number {
    return this.recoveryCycleCount;
  }

  public isRecoveryActive(): boolean {
    return this.isRecovering;
  }

  private markJobActive(jobId: string): void {
    const current = this.activeJobCounts.get(jobId) ?? 0;
    this.activeJobCounts.set(jobId, current + 1);
    this.activeJobIds.add(jobId);
  }

  private markJobInactive(jobId: string): void {
    const current = this.activeJobCounts.get(jobId) ?? 1;
    if (current <= 1) {
      this.activeJobCounts.delete(jobId);
      this.activeJobIds.delete(jobId);
    } else {
      this.activeJobCounts.set(jobId, current - 1);
    }
  }

  /**
   * Inicia el worker y se suscribe autoritativamente a la cola pg-boss (CR-01).
   * Ejecuta además la recuperación segura y consciente de arrendamientos expirados (CR-04, WS03).
   * Idempotente ante llamadas repetidas de inicio.
   */
  public async start(): Promise<void> {
    if (this.stoppingPromise) {
      await this.stoppingPromise;
    }
    if (this.isStarted) return;

    // 1. Recuperar únicamente trabajos con arrendamiento expirado (CR-04, WS03)
    try {
      await this.recoverStaleJobs();
    } catch (err) {
      console.warn('[ConversionWorker] Error no fatal en recuperación inicial de stale jobs al arrancar:', err);
    }

    // 2. Programar recuperación periódica recurrente y segura (WS03)
    if (!this.recoveryTimer && this.recoveryIntervalMs > 0) {
      this.recoveryTimer = setInterval(async () => {
        try {
          await this.recoverStaleJobs();
        } catch (err) {
          console.error('[ConversionWorker] Error en ciclo periódico de recuperación de stale jobs:', err);
        }
      }, this.recoveryIntervalMs);
      if (this.recoveryTimer.unref) {
        this.recoveryTimer.unref();
      }
    }

    // 3. Iniciar pg-boss y registrar handler de trabajo
    const boss = await startConversionQueue();
    await boss.work<ConversionJobPayload>(CONVERSION_QUEUE_NAME, async (jobs) => {
      for (const job of jobs) {
        await this.processJob(job.data);
      }
    });

    this.isWorking = true;
    this.isStarted = true;
  }

  /**
   * Detiene el worker de forma segura, acotada e idempotente (WS02):
   * 1. Cómputo del plazo límite (deadline) inmediato previo a cualquier espera asíncrona.
   * 2. Desactivación de banderas y cancelación inmediata de temporizador periódico (WS03).
   * 3. Desuscripción de pg-boss acotada por el plazo restante.
   * 4. Drenaje acotado de trabajos activos por el plazo restante.
   * 5. Si expira el plazo, no se bloquea indefinidamente; los trabajos incompletos
   *    permanecen en PROCESSING para que sus arrendamientos expiren y sean recuperados.
   * 6. Idempotencia ante llamadas paralelas o secuenciales.
   */
  public async stop(timeoutMs: number = 5000): Promise<void> {
    if (this.isStopping) {
      return this.stoppingPromise ?? Promise.resolve();
    }
    if (!this.isStarted && !this.isWorking && this.activeJobIds.size === 0) {
      if (this.recoveryTimer) {
        clearInterval(this.recoveryTimer);
        this.recoveryTimer = null;
      }
      return;
    }

    this.isStopping = true;
    this.stoppingPromise = this.performStop(timeoutMs).finally(() => {
      this.isStopping = false;
      this.stoppingPromise = null;
    });

    return this.stoppingPromise;
  }

  private async performStop(timeoutMs: number): Promise<void> {
    const deadline = Date.now() + Math.max(0, timeoutMs);
    this.isWorking = false;

    // 1. Detener ciclo recurrente de recuperación inmediatamente (WS02/WS03)
    if (this.recoveryTimer) {
      clearInterval(this.recoveryTimer);
      this.recoveryTimer = null;
    }

    // 2. Cancelar suscripción a la cola en pg-boss de forma acotada (WS02)
    if (this.isStarted) {
      try {
        const remainingForOffWork = Math.max(0, deadline - Date.now());
        const boss = getConversionQueue();
        if (remainingForOffWork > 0) {
          await Promise.race([
            boss.offWork(CONVERSION_QUEUE_NAME),
            new Promise((resolve) => setTimeout(resolve, remainingForOffWork)),
          ]);
        }
      } catch {
        // Ignorar si la cola ya fue cerrada
      }
    }

    // 3. Espera acotada para que trabajos activos terminen (Graceful Drain)
    while (this.activeJobIds.size > 0 && Date.now() < deadline) {
      const remaining = deadline - Date.now();
      const step = Math.min(50, Math.max(1, remaining));
      await new Promise((resolve) => setTimeout(resolve, step));
    }

    if (this.activeJobIds.size > 0) {
      console.warn(
        `[ConversionWorker] Graceful shutdown timeout (${timeoutMs}ms) alcanzado con ${this.activeJobIds.size} trabajo(s) aún en ejecución. Los arrendamientos expirarán para recuperación segura.`
      );
    }

    this.isStarted = false;
  }

  /**
   * Procesa un trabajo de conversión con control de arrendamiento, testigo de ejecución (fencing)
   * y verificación de cancelación en cada etapa crítica (CR-02 & CR-03).
   */
  public async processJob(payload: ConversionJobPayload): Promise<ConversionExportResult> {
    const { jobId, storageKey, checksumSha256, filename, targetFormat, options } = payload;
    const executionToken = crypto.randomUUID(); // Testigo de ejecución único (fencing token)

    this.markJobActive(jobId);
    let heartbeatTimer: NodeJS.Timeout | null = null;

    try {
      // =========================================================================
      // 1. Adquisición atómica de procesamiento y arrendamiento (CR-02)
      // =========================================================================
      const acquiredJob = await this.acquireJob(jobId, executionToken);

      if (!acquiredJob) {
        // El trabajo ya fue adquirido por otro worker activo, o fue cancelado / completado previamente
        return {
          success: false,
          targetFormat,
          filename,
          mimeType: 'text/plain',
          content: '',
          diagnostics: [
            {
              code: 'JOB_NOT_ACQUIRED',
              severity: 'WARNING',
              message: `El trabajo ${jobId} no pudo ser adquirido: se encuentra activo bajo otro arrendamiento o en estado terminal.`,
            },
          ],
        };
      }

      // =========================================================================
      // 2. Latido periódico de renovación de arrendamiento (Heartbeat)
      // =========================================================================
      let isCancelledOrSuperseded = false;
      heartbeatTimer = setInterval(async () => {
        try {
          const renewed = await this.renewHeartbeat(jobId, executionToken);
          if (!renewed) {
            isCancelledOrSuperseded = true;
          }
        } catch {
          // Ignorar fallas transitorias de red en latidos individuales
        }
      }, ConversionWorker.HEARTBEAT_INTERVAL_MS);

      // -----------------------------------------------------------------------
      // Etapa A (30%): Verificación de propiedad activa y lectura de fuente
      // -----------------------------------------------------------------------
      if (isCancelledOrSuperseded || !(await this.verifyOwnershipAndActive(jobId, executionToken))) {
        return this.abortDueToCancellation(targetFormat, filename, jobId);
      }

      if (this.onStageReached) {
        await this.onStageReached('STAGE_A', jobId);
      }

      const sourceBuffer = await this.storage.getBuffer(storageKey);
      const computedHash = crypto.createHash('sha256').update(sourceBuffer).digest('hex');

      if (computedHash !== checksumSha256) {
        throw new Error(
          `Violación de Integridad Criptográfica: El hash del archivo en disco (${computedHash}) no coincide con el registrado (${checksumSha256}).`
        );
      }

      await this.updateProgressFenced(jobId, executionToken, 30);

      // -----------------------------------------------------------------------
      // Etapa B (50%): Detección de formato y categoría
      // -----------------------------------------------------------------------
      if (isCancelledOrSuperseded || !(await this.verifyOwnershipAndActive(jobId, executionToken))) {
        return this.abortDueToCancellation(targetFormat, filename, jobId);
      }

      if (this.onStageReached) {
        await this.onStageReached('STAGE_B', jobId);
      }

      const sourceCategory = FormatCapabilitiesEvaluator.detectSourceCategory(filename, sourceBuffer);

      if (sourceCategory === 'UNKNOWN_UNSUPPORTED') {
        const errCode = 'UNKNOWN_OR_UNSUPPORTED_FORMAT';
        const unsupportedMsg = `El archivo "${filename}" no es un formato musical soportado o su contenido no contiene datos de notación musical válidos. Se rechaza por fail-closed format validation.`;
        await this.failJobFenced(jobId, executionToken, errCode, unsupportedMsg);
        return {
          success: false,
          targetFormat,
          filename,
          mimeType: 'text/plain',
          content: '',
          diagnostics: [
            {
              code: errCode,
              severity: 'ERROR',
              message: unsupportedMsg,
            },
          ],
        };
      }

      if (
        sourceCategory === 'AUDIO_RECORDING' ||
        sourceCategory === 'VIDEO_REFERENCE' ||
        sourceCategory === 'PDF_SCORE' ||
        sourceCategory === 'IMAGE_SCORE' ||
        sourceCategory === 'TABLATURE_ASCII'
      ) {
        const isTab = sourceCategory === 'TABLATURE_ASCII';
        const errCode = isTab ? 'TABLATURE_INGESTION_UNSUPPORTED' : 'SOURCE_CATEGORY_DEFERRED_PHASE';
        const deferredError = isTab
          ? `La ingesta y conversión directa de tablaturas ASCII (.tab) no está soportada en esta versión. El motor de tablatura está planificado para la Fase 2B.`
          : `La fuente "${filename}" (${sourceCategory}) requiere transcripción o digitalización óptica diferida para Fase 2B.`;
        await this.failJobFenced(jobId, executionToken, errCode, deferredError);
        return {
          success: false,
          targetFormat,
          filename,
          mimeType: 'text/plain',
          content: '',
          diagnostics: [
            {
              code: errCode,
              severity: 'ERROR',
              message: deferredError,
            },
          ],
        };
      }

      // Validar viabilidad de conversión frente al principio de Cero Fabricación
      const caps = FormatCapabilitiesEvaluator.getFormatCapabilities(sourceCategory);
      const requestedCap = caps.find((c) => c.format === targetFormat);
      if (!requestedCap || !requestedCap.isAvailable) {
        const errCode = requestedCap?.statusBadge === 'BLOCKED_ZERO_FABRICATION'
          ? 'ZERO_FABRICATION_VIOLATION'
          : 'UNSUPPORTED_CONVERSION';
        const capMsg = requestedCap?.blockingReason ?? `Conversión de "${sourceCategory}" hacia "${targetFormat}" no es viable o carece de información musical esencial.`;
        await this.failJobFenced(jobId, executionToken, errCode, capMsg);
        return {
          success: false,
          targetFormat,
          filename,
          mimeType: 'text/plain',
          content: '',
          diagnostics: [
            {
              code: errCode,
              severity: 'ERROR',
              message: capMsg,
            },
          ],
        };
      }

      const contentString = new TextDecoder('utf-8', { fatal: false }).decode(sourceBuffer);
      await this.updateProgressFenced(jobId, executionToken, 70);

      // -----------------------------------------------------------------------
      // Etapa C (70% - 90%): Transpilación musical y opciones de transposición
      // -----------------------------------------------------------------------
      if (isCancelledOrSuperseded || !(await this.verifyOwnershipAndActive(jobId, executionToken))) {
        return this.abortDueToCancellation(targetFormat, filename, jobId);
      }

      if (this.onStageReached) {
        await this.onStageReached('STAGE_C', jobId);
      }

      const exportResult = this.engine.convertSource(contentString, filename, {
        targetFormat,
        transposeSemitones: options?.transposeSemitones,
        keyOverride: options?.keyOverride,
        bpmOverride: options?.bpmOverride,
        timeSignatureOverride: options?.timeSignatureOverride,
      });

      await this.updateProgressFenced(jobId, executionToken, 90);

      // -----------------------------------------------------------------------
      // Etapa D (100%): Evaluación final y persistencia de resultados con Fencing
      // -----------------------------------------------------------------------
      if (isCancelledOrSuperseded || !(await this.verifyOwnershipAndActive(jobId, executionToken))) {
        return this.abortDueToCancellation(targetFormat, filename, jobId);
      }

      if (this.onStageReached) {
        await this.onStageReached('STAGE_D', jobId);
      }

      if (!exportResult.success) {
        await this.failJobFenced(
          jobId,
          executionToken,
          'CONVERSION_FAILED',
          'Error durante la serialización al formato destino',
          { diagnostics: exportResult.diagnostics }
        );
        return exportResult;
      }

      const hasWarnings = exportResult.diagnostics.some((d) => d.severity === 'WARNING');
      const finalStatus = hasWarnings ? 'REVIEW_REQUIRED' : 'COMPLETED';

      const isBinary = exportResult.content instanceof Uint8Array;
      const dataStr = isBinary
        ? Buffer.from(exportResult.content as Uint8Array).toString('base64')
        : (exportResult.content as string);

      const canonicalPayloadJSON = exportResult.canonicalPayload
        ? CanonicalSerializer.serialize(exportResult.canonicalPayload)
        : null;

      // Actualización atómica terminal sujeta al testigo de ejecución (CR-02 & CR-03)
      const [finalizedJob] = await this.db
        .update(backgroundJobs)
        .set({
          status: finalStatus,
          progress: 100,
          outputRef: exportResult.filename,
          errorDetails: {
            targetFormat: exportResult.targetFormat,
            mimeType: exportResult.mimeType,
            isBinary,
            data: dataStr,
            diagnostics: exportResult.diagnostics,
            canonicalPayload: canonicalPayloadJSON, // CR-06
            storageKey,
            checksumSha256,
            options: options ?? {},
          },
          completedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(backgroundJobs.id, jobId),
            eq(backgroundJobs.leaseToken, executionToken),
            eq(backgroundJobs.status, 'PROCESSING')
          )
        )
        .returning({ id: backgroundJobs.id });

      if (!finalizedJob) {
        // La actualización terminal falló porque el trabajo fue cancelado o el arrendamiento expiró
        return this.abortDueToCancellation(targetFormat, filename, jobId);
      }

      return exportResult;
    } catch (err: any) {
      const isTransient = isTransientError(err);
      let attempts = 1;
      let maxAttempts = 3;

      try {
        const [currentJob] = await this.db
          .select({ attempts: backgroundJobs.attempts, maxAttempts: backgroundJobs.maxAttempts })
          .from(backgroundJobs)
          .where(eq(backgroundJobs.id, jobId));
        if (currentJob) {
          attempts = currentJob.attempts;
          maxAttempts = currentJob.maxAttempts;
        }
      } catch {
        // Fallback a valores por defecto
      }

      if (isTransient && attempts < maxAttempts) {
        // Error transitorio con reintentos disponibles: resetear arrendamiento y propagar a pg-boss
        await this.db
          .update(backgroundJobs)
          .set({
            status: 'PENDING',
            leaseOwner: null,
            leaseToken: null,
            leaseExpiresAt: null,
            heartbeatAt: null,
            progress: 0,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(backgroundJobs.id, jobId),
              eq(backgroundJobs.leaseToken, executionToken),
              eq(backgroundJobs.status, 'PROCESSING')
            )
          )
          .catch((dbErr) => {
            console.error(`[ConversionWorker] Error al resetear arrendamiento para reintento de job ${jobId}:`, dbErr);
          });

        throw err;
      }

      // Fallo permanente o reintentos agotados
      const errorCode = isTransient ? 'RETRIES_EXHAUSTED' : 'WORKER_PROCESSING_EXCEPTION';
      await this.failJobFenced(jobId, executionToken, errorCode, err.message);
      return {
        success: false,
        targetFormat,
        filename,
        mimeType: 'text/plain',
        content: '',
        diagnostics: [
          {
            code: errorCode,
            severity: 'ERROR',
            message: err.message,
          },
        ],
      };
    } finally {
      if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
      }
      this.markJobInactive(jobId);
    }
  }

  /**
   * Recupera trabajos que hayan quedado en estado PROCESSING con arrendamiento genuinamente expirado (CR-04).
   * Emplea un reclamo atómico de recuperación para evitar colisiones y garantiza que si el reencolado
   * en pg-boss falla, el trabajo no quede en el limbo sino inmediatamente recoverable en la siguiente pasada.
   */
  public async recoverStaleJobs(): Promise<number> {
    if (this.isRecovering) return 0;
    this.isRecovering = true;

    try {
      this.recoveryCycleCount++;
      const now = new Date();
      const expiredJobs = await this.db
        .select()
        .from(backgroundJobs)
        .where(
          and(
            eq(backgroundJobs.jobType, 'CONVERSION'),
            eq(backgroundJobs.status, 'PROCESSING'),
            lt(backgroundJobs.leaseExpiresAt, now)
          )
        );

      let recoveredCount = 0;

      for (const job of expiredJobs) {
        if (job.attempts >= job.maxAttempts) {
          // Excedió el límite de reintentos: marcar definitivamente como FAILED
          await this.db
            .update(backgroundJobs)
            .set({
              status: 'FAILED',
              progress: 100,
              errorCode: 'LEASE_EXPIRED_MAX_ATTEMPTS',
              errorDetails: {
                code: 'LEASE_EXPIRED_MAX_ATTEMPTS',
                message: `El trabajo excedió el límite máximo de reintentos (${job.maxAttempts}) tras expiración de arrendamiento.`,
                previousDetails: job.errorDetails,
              },
              completedAt: new Date(),
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(backgroundJobs.id, job.id),
                eq(backgroundJobs.status, 'PROCESSING'),
                lt(backgroundJobs.leaseExpiresAt, now)
              )
            );
          recoveredCount++;
        } else {
          // Reclamo atómico de recuperación con testigo y tiempo acotado
          const recoveryToken = crypto.randomUUID();
          const recoveryLeaseExpires = new Date(Date.now() + 30_000); // 30s de ventana

          const [claimed] = await this.db
            .update(backgroundJobs)
            .set({
              leaseOwner: `recovery_${this.workerId}`,
              leaseToken: recoveryToken,
              leaseExpiresAt: recoveryLeaseExpires,
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(backgroundJobs.id, job.id),
                eq(backgroundJobs.status, 'PROCESSING'),
                lt(backgroundJobs.leaseExpiresAt, now)
              )
            )
            .returning();

          if (claimed) {
            const details = job.errorDetails as any;
            if (details?.storageKey && details?.checksumSha256) {
              try {
                await enqueueConversionJob({
                  jobId: job.id,
                  userId: job.userId ?? 'system',
                  tenantId: job.tenantId,
                  storageKey: details.storageKey,
                  checksumSha256: details.checksumSha256,
                  filename: job.inputRef,
                  targetFormat: details.targetFormat ?? 'CHORD_PRO',
                  options: details.options,
                });

                // Reencolado exitoso: resetear a PENDING y liberar arrendamiento
                await this.db
                  .update(backgroundJobs)
                  .set({
                    status: 'PENDING',
                    leaseOwner: null,
                    leaseToken: null,
                    leaseExpiresAt: null,
                    heartbeatAt: null,
                    progress: 0,
                    updatedAt: new Date(),
                  })
                  .where(
                    and(
                      eq(backgroundJobs.id, job.id),
                      eq(backgroundJobs.leaseToken, recoveryToken)
                    )
                  );
                recoveredCount++;
              } catch (reEnqueueErr) {
                console.warn(`[ConversionWorker] Fallo al reencolar trabajo ${job.id}, liberando arrendamiento:`, reEnqueueErr);
                // Si falla el reencolado, expirar de inmediato el arrendamiento para reintentarlo en el próximo ciclo
                await this.db
                  .update(backgroundJobs)
                  .set({
                    leaseOwner: null,
                    leaseToken: null,
                    leaseExpiresAt: new Date(Date.now() - 10_000),
                    updatedAt: new Date(),
                  })
                  .where(
                    and(
                      eq(backgroundJobs.id, job.id),
                      eq(backgroundJobs.leaseToken, recoveryToken)
                    )
                  );
              }
            } else {
              // Metadatos insuficientes para reencolado
              await this.db
                .update(backgroundJobs)
                .set({
                  status: 'FAILED',
                  progress: 100,
                  errorCode: 'RECOVERY_MISSING_METADATA',
                  errorDetails: {
                    code: 'RECOVERY_MISSING_METADATA',
                    message: 'El trabajo no cuenta con storageKey o checksumSha256 para ser reencolado.',
                  },
                  completedAt: new Date(),
                  updatedAt: new Date(),
                })
                .where(
                  and(
                    eq(backgroundJobs.id, job.id),
                    eq(backgroundJobs.leaseToken, recoveryToken)
                  )
                );
              recoveredCount++;
            }
          }
        }
      }

      return recoveredCount;
    } finally {
      this.isRecovering = false;
    }
  }

  /**
   * Adquisición atómica de procesamiento y arrendamiento (CR-02).
   */
  public async acquireJob(
    jobId: string,
    executionToken: string
  ): Promise<BackgroundJobRow | null> {
    const leaseExpiresAt = new Date(Date.now() + ConversionWorker.LEASE_DURATION_MS);
    const now = new Date();

    const [acquiredJob] = await this.db
      .update(backgroundJobs)
      .set({
        status: 'PROCESSING',
        leaseOwner: this.workerId,
        leaseToken: executionToken,
        leaseExpiresAt,
        heartbeatAt: now,
        attempts: sql`${backgroundJobs.attempts} + 1`,
        progress: 10,
        startedAt: sql`COALESCE(${backgroundJobs.startedAt}, NOW())`,
        updatedAt: now,
      })
      .where(
        and(
          eq(backgroundJobs.id, jobId),
          or(
            eq(backgroundJobs.status, 'PENDING'),
            and(
              eq(backgroundJobs.status, 'PROCESSING'),
              lt(backgroundJobs.leaseExpiresAt, now)
            )
          )
        )
      )
      .returning();

    return acquiredJob ?? null;
  }

  /**
   * Renueva el latido de arrendamiento de un trabajo en ejecución (CR-02).
   */
  public async renewHeartbeat(
    jobId: string,
    executionToken: string
  ): Promise<boolean> {
    const [renewed] = await this.db
      .update(backgroundJobs)
      .set({
        leaseExpiresAt: new Date(Date.now() + ConversionWorker.LEASE_DURATION_MS),
        heartbeatAt: new Date(),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(backgroundJobs.id, jobId),
          eq(backgroundJobs.leaseToken, executionToken),
          eq(backgroundJobs.status, 'PROCESSING')
        )
      )
      .returning({ id: backgroundJobs.id });

    return !!renewed;
  }

  /**
   * Verifica que el worker aún mantenga la propiedad activa del trabajo (CR-02 & CR-03).
   */
  public async verifyOwnershipAndActive(jobId: string, executionToken: string): Promise<boolean> {
    const [row] = await this.db
      .select({
        status: backgroundJobs.status,
        leaseToken: backgroundJobs.leaseToken,
      })
      .from(backgroundJobs)
      .where(eq(backgroundJobs.id, jobId));

    if (!row) return false;
    if (row.status !== 'PROCESSING') return false;
    if (row.leaseToken !== executionToken) return false;
    return true;
  }

  /**
   * Actualiza el progreso de forma vallada (fenced) verificando testigo y estado activo (CR-02).
   */
  public async updateProgressFenced(
    jobId: string,
    executionToken: string,
    progress: number
  ): Promise<boolean> {
    const [updated] = await this.db
      .update(backgroundJobs)
      .set({
        progress,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(backgroundJobs.id, jobId),
          eq(backgroundJobs.leaseToken, executionToken),
          eq(backgroundJobs.status, 'PROCESSING')
        )
      )
      .returning({ id: backgroundJobs.id });

    return !!updated;
  }

  private async failJobFenced(
    jobId: string,
    executionToken: string,
    errorCode: string,
    message: string,
    extra?: Record<string, unknown>
  ): Promise<void> {
    await this.db
      .update(backgroundJobs)
      .set({
        status: 'FAILED',
        progress: 100,
        errorCode,
        errorDetails: {
          code: errorCode,
          message,
          ...(extra ?? {}),
        },
        completedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(backgroundJobs.id, jobId),
          eq(backgroundJobs.leaseToken, executionToken),
          eq(backgroundJobs.status, 'PROCESSING')
        )
      );
  }

  private abortDueToCancellation(
    targetFormat: any,
    filename: string,
    jobId: string
  ): ConversionExportResult {
    return {
      success: false,
      targetFormat,
      filename,
      mimeType: 'text/plain',
      content: '',
      diagnostics: [
        {
          code: 'JOB_CANCELLED_OR_LEASE_LOST',
          severity: 'WARNING',
          message: `El procesamiento del trabajo ${jobId} fue abortado de forma segura debido a cancelación o pérdida de arrendamiento.`,
        },
      ],
    };
  }
}
