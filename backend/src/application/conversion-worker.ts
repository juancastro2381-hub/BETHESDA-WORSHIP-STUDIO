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

export class ConversionWorker {
  public static readonly LEASE_DURATION_MS = 60_000; // 60 segundos de validez de arrendamiento
  public static readonly HEARTBEAT_INTERVAL_MS = 15_000; // 15 segundos entre renovaciones de latido

  public readonly workerId: string;
  private readonly engine: ConversionEngine;
  private readonly storage: ISourceStorageProvider;
  private isWorking = false;
  private isStarted = false;

  public constructor(
    private readonly db: Database = defaultDb,
    customStorage?: ISourceStorageProvider,
    customEngine?: ConversionEngine,
    customWorkerId?: string
  ) {
    this.workerId =
      customWorkerId ??
      `worker_${process.pid}_${os.hostname()}_${crypto.randomUUID().slice(0, 8)}`;
    this.storage = customStorage ?? new LocalFileSystemSourceStorageProvider();
    this.engine = customEngine ?? new ConversionEngine();
  }

  public isActive(): boolean {
    return this.isStarted && this.isWorking;
  }

  /**
   * Inicia el worker y se suscribe autoritativamente a la cola pg-boss (CR-01).
   * Ejecuta además la recuperación segura y consciente de arrendamientos expirados (CR-04).
   * Idempotente ante llamadas repetidas de inicio.
   */
  public async start(): Promise<void> {
    if (this.isStarted) return;

    // 1. Recuperar únicamente trabajos con arrendamiento expirado (CR-04)
    await this.recoverStaleJobs();

    // 2. Iniciar pg-boss y registrar handler de trabajo
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
   * Detiene el worker de forma segura y desactiva suscripciones activas.
   */
  public async stop(): Promise<void> {
    this.isWorking = false;
    this.isStarted = false;
  }

  /**
   * Procesa un trabajo de conversión con control de arrendamiento, testigo de ejecución (fencing)
   * y verificación de cancelación en cada etapa crítica (CR-02 & CR-03).
   */
  public async processJob(payload: ConversionJobPayload): Promise<ConversionExportResult> {
    const { jobId, storageKey, checksumSha256, filename, targetFormat, options } = payload;
    const executionToken = crypto.randomUUID(); // Testigo de ejecución único (fencing token)

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
    const heartbeatTimer = setInterval(async () => {
      try {
        const renewed = await this.renewHeartbeat(jobId, executionToken);
        if (!renewed) {
          isCancelledOrSuperseded = true;
        }
      } catch {
        // Ignorar fallas transitorias de red en latidos individuales
      }
    }, ConversionWorker.HEARTBEAT_INTERVAL_MS);

    try {
      // -----------------------------------------------------------------------
      // Etapa A (30%): Verificación de propiedad activa y lectura de fuente
      // -----------------------------------------------------------------------
      if (isCancelledOrSuperseded || !(await this.verifyOwnershipAndActive(jobId, executionToken))) {
        return this.abortDueToCancellation(targetFormat, filename, jobId);
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

      const sourceCategory = FormatCapabilitiesEvaluator.detectSourceCategory(filename, sourceBuffer);

      if (
        sourceCategory === 'AUDIO_RECORDING' ||
        sourceCategory === 'VIDEO_REFERENCE' ||
        sourceCategory === 'PDF_SCORE' ||
        sourceCategory === 'IMAGE_SCORE'
      ) {
        const deferredError = `La fuente "${filename}" (${sourceCategory}) requiere transcripción o digitalización óptica diferida para Fase 2B.`;
        await this.failJobFenced(jobId, executionToken, 'SOURCE_CATEGORY_DEFERRED_PHASE', deferredError);
        return {
          success: false,
          targetFormat,
          filename,
          mimeType: 'text/plain',
          content: '',
          diagnostics: [
            {
              code: 'SOURCE_CATEGORY_DEFERRED_PHASE',
              severity: 'ERROR',
              message: deferredError,
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
      await this.failJobFenced(jobId, executionToken, 'WORKER_PROCESSING_EXCEPTION', err.message);
      return {
        success: false,
        targetFormat,
        filename,
        mimeType: 'text/plain',
        content: '',
        diagnostics: [
          {
            code: 'WORKER_PROCESSING_EXCEPTION',
            severity: 'ERROR',
            message: err.message,
          },
        ],
      };
    } finally {
      clearInterval(heartbeatTimer);
    }
  }

  /**
   * Recupera trabajos que hayan quedado en estado PROCESSING con arrendamiento genuinamente expirado (CR-04).
   * Nunca toca trabajos con arrendamiento activo.
   */
  public async recoverStaleJobs(): Promise<number> {
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
        // Arrendamiento expirado reintentable: resetear a PENDING y reencolar en pg-boss
        const [reset] = await this.db
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
              eq(backgroundJobs.status, 'PROCESSING'),
              lt(backgroundJobs.leaseExpiresAt, now)
            )
          )
          .returning();

        if (reset) {
          const details = job.errorDetails as any;
          if (details?.storageKey && details?.checksumSha256) {
            await enqueueConversionJob({
              jobId: job.id,
              userId: job.userId ?? 'system',
              tenantId: job.tenantId,
              storageKey: details.storageKey,
              checksumSha256: details.checksumSha256,
              filename: job.inputRef,
              targetFormat: details.targetFormat ?? 'CHORD_PRO',
              options: details.options,
            }).catch(() => {});
          }
          recoveredCount++;
        }
      }
    }

    return recoveredCount;
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
