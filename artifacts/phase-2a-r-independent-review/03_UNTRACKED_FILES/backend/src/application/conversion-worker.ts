/**
 * @file conversion-worker.ts
 * @description Worker en segundo plano para el procesamiento asíncrono de conversiones musicales (Fase 2A-R).
 *
 * Consume trabajos de pg-boss ('music-conversion'), lee archivos físicos desde LocalFileSystemSourceStorageProvider,
 * valida su integridad SHA-256, invoca la ingesta canónica, aplica opciones de transposición (CR-04),
 * serializa al formato objetivo (CR-05) y actualiza el estado y progreso en background_jobs.
 */

import crypto from 'node:crypto';
import { eq, and } from 'drizzle-orm';
import { db as defaultDb, type Database } from '../db/index.ts';
import { backgroundJobs } from '../db/schema.ts';
import {
  LocalFileSystemSourceStorageProvider,
  type ISourceStorageProvider,
} from '../domain/ingestion/source-storage-provider.ts';
import {
  CONVERSION_QUEUE_NAME,
  type ConversionJobPayload,
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
  private readonly engine: ConversionEngine;
  private readonly storage: ISourceStorageProvider;
  private isWorking = false;

  public constructor(
    private readonly db: Database = defaultDb,
    customStorage?: ISourceStorageProvider,
    customEngine?: ConversionEngine
  ) {
    this.storage = customStorage ?? new LocalFileSystemSourceStorageProvider();
    this.engine = customEngine ?? new ConversionEngine();
  }

  /**
   * Inicia el worker y se suscribe a la cola de pg-boss.
   * Ejecuta además la recuperación de trabajos que hayan quedado estancados en PROCESSING por reinicios previos.
   */
  public async start(): Promise<void> {
    if (this.isWorking) return;

    // 1. Recuperación de trabajos interrumpidos (CR-02 & CR-09)
    await this.recoverStaleJobs();

    // 2. Iniciar pg-boss y registrar handler de trabajo
    const boss = await startConversionQueue();
    await boss.work<ConversionJobPayload>(CONVERSION_QUEUE_NAME, async (jobs) => {
      for (const job of jobs) {
        await this.processJob(job.data);
      }
    });

    this.isWorking = true;
  }

  /**
   * Procesa un trabajo de conversión de forma aislada, actualizando la base de datos de forma granular.
   */
  public async processJob(payload: ConversionJobPayload): Promise<ConversionExportResult> {
    const { jobId, storageKey, checksumSha256, filename, targetFormat, options } = payload;

    try {
      // Hito 1 (10%): Inicio de procesamiento en el worker
      await this.updateJobStatus(jobId, 'PROCESSING', 10);

      // Hito 2 (30%): Lectura de almacenamiento físico y verificación de integridad criptográfica (CR-03)
      const sourceBuffer = await this.storage.getBuffer(storageKey);
      const computedHash = crypto.createHash('sha256').update(sourceBuffer).digest('hex');

      if (computedHash !== checksumSha256) {
        throw new Error(
          `Violación de Integridad Criptográfica: El hash del archivo en disco (${computedHash}) no coincide con el registrado (${checksumSha256}).`
        );
      }

      await this.updateJobStatus(jobId, 'PROCESSING', 30);

      // Hito 3 (50%): Detección e ingesta hacia CanonicalMusicPayload
      const sourceCategory = FormatCapabilitiesEvaluator.detectSourceCategory(filename, sourceBuffer);

      if (
        sourceCategory === 'AUDIO_RECORDING' ||
        sourceCategory === 'VIDEO_REFERENCE' ||
        sourceCategory === 'PDF_SCORE' ||
        sourceCategory === 'IMAGE_SCORE'
      ) {
        const deferredError = `La fuente "${filename}" (${sourceCategory}) requiere transcripción o digitalización óptica diferida para Fase 2B.`;
        await this.failJob(jobId, 'SOURCE_CATEGORY_DEFERRED_PHASE', deferredError);
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

      // Convertir buffer a texto UTF-8 o mantener binario según el tipo
      const contentString = new TextDecoder('utf-8', { fatal: false }).decode(sourceBuffer);

      await this.updateJobStatus(jobId, 'PROCESSING', 70);

      // Hito 4 (70% - 90%): Ejecutar transpilación y aplicar opciones musicales (CR-04 & CR-05)
      const exportResult = this.engine.convertSource(contentString, filename, {
        targetFormat,
        transposeSemitones: options?.transposeSemitones,
        keyOverride: options?.keyOverride,
        bpmOverride: options?.bpmOverride,
        timeSignatureOverride: options?.timeSignatureOverride,
      });

      await this.updateJobStatus(jobId, 'PROCESSING', 90);

      // Hito 5 (100%): Evaluar resultado y finalizar trabajo
      if (!exportResult.success) {
        await this.failJob(jobId, 'CONVERSION_FAILED', 'Error durante la serialización al formato destino', {
          diagnostics: exportResult.diagnostics,
        });
        return exportResult;
      }

      // Determinar si hay advertencias que requieran revisión humana
      const hasWarnings = exportResult.diagnostics.some((d) => d.severity === 'WARNING');
      const finalStatus = hasWarnings ? 'REVIEW_REQUIRED' : 'COMPLETED';

      const isBinary = exportResult.content instanceof Uint8Array;
      const dataStr = isBinary
        ? Buffer.from(exportResult.content as Uint8Array).toString('base64')
        : (exportResult.content as string);

      // Extraer payload canónico serializado para persistencia fidedigna al catálogo (CR-06)
      const canonicalPayloadJSON = exportResult.canonicalPayload
        ? CanonicalSerializer.serialize(exportResult.canonicalPayload)
        : null;

      await this.db
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
            storageKey,                           // CR-03
            checksumSha256,                       // CR-03
            options: options ?? {},
          },
          completedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(backgroundJobs.id, jobId));

      return exportResult;
    } catch (err: any) {
      await this.failJob(jobId, 'WORKER_PROCESSING_EXCEPTION', err.message);
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
    }
  }

  /**
   * Recupera trabajos que hayan quedado en estado PROCESSING tras un reinicio inesperado del proceso.
   */
  public async recoverStaleJobs(): Promise<number> {
    const staleJobs = await this.db
      .select()
      .from(backgroundJobs)
      .where(
        and(
          eq(backgroundJobs.jobType, 'CONVERSION'),
          eq(backgroundJobs.status, 'PROCESSING')
        )
      );

    for (const job of staleJobs) {
      await this.db
        .update(backgroundJobs)
        .set({
          status: 'FAILED',
          progress: 100,
          errorDetails: {
            code: 'INTERRUPTED_ON_SHUTDOWN',
            message: 'El trabajo fue interrumpido abruptamente por el reinicio del servidor.',
            originalDetails: job.errorDetails,
          },
          completedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(backgroundJobs.id, job.id));
    }

    return staleJobs.length;
  }

  private async updateJobStatus(
    jobId: string,
    status: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'REVIEW_REQUIRED' | 'FAILED',
    progress: number
  ): Promise<void> {
    await this.db
      .update(backgroundJobs)
      .set({
        status,
        progress,
        updatedAt: new Date(),
      })
      .where(eq(backgroundJobs.id, jobId));
  }

  private async failJob(
    jobId: string,
    errorCode: string,
    message: string,
    extra?: Record<string, unknown>
  ): Promise<void> {
    await this.db
      .update(backgroundJobs)
      .set({
        status: 'FAILED',
        progress: 100,
        errorDetails: {
          code: errorCode,
          message,
          ...(extra ?? {}),
        },
        completedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(backgroundJobs.id, jobId));
  }
}
