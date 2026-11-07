/**
 * @file conversion-job-service.ts
 * @description Servicio de aplicación para el Centro de Conversión Musical (Fase 2A).
 *
 * Administra el ciclo de vida de los trabajos de conversión, validación de capacidades de formato,
 * ejecución de serializadores, almacenamiento de resultados, reintentos y persistencia al catálogo de canciones.
 */

import { and, eq } from 'drizzle-orm';
import { db as defaultDb, type Database } from '../db/index.ts';
import { backgroundJobs, type BackgroundJobRow } from '../db/schema.ts';
import {
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '../domain/errors.ts';
import type { AuthenticatedUser } from '../domain/auth-types.ts';
import type { SongService } from './song-service.ts';
import {
  type IBackgroundJobRepository,
  DrizzleBackgroundJobRepository,
} from '../repositories/background-job-repository.ts';
import {
  ConversionEngine,
  FormatCapabilitiesEvaluator,
  type ConversionExportResult,
  type ConversionOptions,
  type ConversionSourceCategory,
  type ConversionTargetFormat,
  type FormatCapabilityInfo,
} from '../../../frontend/src/core/conversion/index.ts';
import { CanonicalMusicPayload } from '../../../frontend/src/core/canonical-model/canonical-music-payload.ts';

export interface TranspileInputDTO {
  filename: string;
  targetFormat: ConversionTargetFormat;
  rawText?: string | undefined;
  dataBase64?: string | undefined;
  options?: {
    transposeSemitones?: number | undefined;
    keyOverride?: string | undefined;
    bpmOverride?: number | undefined;
    timeSignatureOverride?: string | undefined;
  } | undefined;
}

export interface TranspileResponseDTO {
  success: boolean;
  targetFormat: ConversionTargetFormat;
  filename: string;
  mimeType: string;
  isBinary: boolean;
  data: string; // Texto plano o Base64 si es binario
  diagnostics: Array<{
    code: string;
    severity: 'INFO' | 'WARNING' | 'ERROR';
    message: string;
  }>;
}

export interface ValidateInputDTO {
  filename: string;
  rawText?: string | undefined;
  dataBase64?: string | undefined;
}

export interface ValidateResponseDTO {
  detectedCategory: ConversionSourceCategory;
  capabilities: FormatCapabilityInfo[];
  canConvert: boolean;
}

export class ConversionJobService {
  private readonly engine: ConversionEngine;
  private readonly jobRepo: IBackgroundJobRepository;

  public constructor(
    private readonly songService?: SongService,
    jobRepository?: IBackgroundJobRepository,
    private readonly db: Database = defaultDb
  ) {
    this.engine = new ConversionEngine();
    this.jobRepo = jobRepository ?? new DrizzleBackgroundJobRepository(this.db);
  }

  /**
   * Valida la compatibilidad de una fuente musical y retorna su matriz de formatos viables.
   */
  public async validateSource(input: ValidateInputDTO): Promise<ValidateResponseDTO> {
    const rawContent = this.extractContent(input);
    const category = FormatCapabilitiesEvaluator.detectSourceCategory(input.filename, rawContent);
    const capabilities = FormatCapabilitiesEvaluator.getFormatCapabilities(category);
    const canConvert = capabilities.some((c) => c.isAvailable);

    return {
      detectedCategory: category,
      capabilities,
      canConvert,
    };
  }

  /**
   * Transpila inmediatamente en memoria una fuente hacia el formato objetivo (síncrono/directo).
   */
  public async transpileDirect(input: TranspileInputDTO): Promise<TranspileResponseDTO> {
    const rawContent = this.extractContent(input);
    const contentString =
      typeof rawContent === 'string'
        ? rawContent
        : new TextDecoder().decode(rawContent);

    const conversionOpts: ConversionOptions = {
      targetFormat: input.targetFormat,
      transposeSemitones: input.options?.transposeSemitones,
      keyOverride: input.options?.keyOverride,
      bpmOverride: input.options?.bpmOverride,
      timeSignatureOverride: input.options?.timeSignatureOverride,
    };

    const result = this.engine.convertSource(contentString, input.filename, conversionOpts);

    const isBinary = result.content instanceof Uint8Array;
    let data = '';
    if (isBinary) {
      data = Buffer.from(result.content as Uint8Array).toString('base64');
    } else {
      data = result.content as string;
    }

    return {
      success: result.success,
      targetFormat: result.targetFormat,
      filename: result.filename,
      mimeType: result.mimeType,
      isBinary,
      data,
      diagnostics: result.diagnostics.map((d) => ({
        code: d.code,
        severity: d.severity,
        message: d.message,
      })),
    };
  }

  /**
   * Crea y encola un trabajo de conversión en `background_jobs` con persistencia relacional.
   */
  public async createJob(
    user: AuthenticatedUser,
    input: TranspileInputDTO
  ): Promise<BackgroundJobRow> {
    if (!user || !user.id) {
      throw new ValidationError('Usuario no autenticado para crear trabajo de conversión.');
    }

    // 1. Registrar trabajo inicial en PENDING
    const job = await this.jobRepo.createJob({
      jobType: 'CONVERSION',
      status: 'PROCESSING',
      progress: 20,
      userId: user.id,
      tenantId: 'bethesda-default',
      inputRef: input.filename,
      outputRef: null,
      errorDetails: {
        targetFormat: input.targetFormat,
        options: input.options ?? {},
      },
      startedAt: new Date(),
    });

    try {
      // 2. Ejecutar la conversión
      await this.jobRepo.updateJobProgress(job.id, 50, 'PROCESSING');
      const transpiled = await this.transpileDirect(input);

      if (!transpiled.success) {
        await this.jobRepo.failJob(job.id, 'CONVERSION_FAILED', {
          diagnostics: transpiled.diagnostics,
        });
        const failedJob = await this.jobRepo.findJobById(job.id);
        return failedJob!;
      }

      // 3. Completar con éxito
      const hasWarnings = transpiled.diagnostics.some((d) => d.severity === 'WARNING');
      const finalStatus = hasWarnings ? 'REVIEW_REQUIRED' : 'COMPLETED';

      await this.db
        .update(backgroundJobs)
        .set({
          status: finalStatus,
          progress: 100,
          outputRef: transpiled.filename,
          errorDetails: {
            targetFormat: transpiled.targetFormat,
            mimeType: transpiled.mimeType,
            isBinary: transpiled.isBinary,
            data: transpiled.data,
            diagnostics: transpiled.diagnostics,
          },
          completedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(backgroundJobs.id, job.id));

      const finishedJob = await this.jobRepo.findJobById(job.id);
      return finishedJob!;
    } catch (err: any) {
      await this.jobRepo.failJob(job.id, 'CONVERSION_EXCEPTION', {
        message: err.message,
      });
      const failedJob = await this.jobRepo.findJobById(job.id);
      return failedJob!;
    }
  }

  /**
   * Obtiene el detalle de un trabajo de conversión verificando propiedad del usuario (anti-IDOR).
   */
  public async getJob(jobId: string, user: AuthenticatedUser): Promise<BackgroundJobRow> {
    const job = await this.jobRepo.findJobById(jobId);
    if (!job) {
      throw new NotFoundError('Trabajo de conversión', jobId);
    }
    if (job.userId !== user.id) {
      throw new ForbiddenError('No tienes autorización para consultar este trabajo de conversión.');
    }
    return job;
  }

  /**
   * Lista los trabajos de conversión del usuario autenticado.
   */
  public async listUserJobs(user: AuthenticatedUser, limit: number = 50): Promise<BackgroundJobRow[]> {
    return await this.jobRepo.findJobsByUserId(user.id, limit);
  }

  /**
   * Cancela un trabajo en ejecución o pendiente.
   */
  public async cancelJob(jobId: string, user: AuthenticatedUser): Promise<BackgroundJobRow> {
    const job = await this.getJob(jobId, user);
    if (job.status === 'COMPLETED') {
      throw new ValidationError('No se puede cancelar un trabajo que ya ha sido completado.');
    }
    await this.jobRepo.updateJobProgress(jobId, job.progress, 'CANCELLED');
    return (await this.jobRepo.findJobById(jobId))!;
  }

  /**
   * Reintenta un trabajo fallido o cancelado.
   */
  public async retryJob(jobId: string, user: AuthenticatedUser): Promise<BackgroundJobRow> {
    const job = await this.getJob(jobId, user);
    const details = job.errorDetails as any;
    const targetFormat = details?.targetFormat || 'CHORD_PRO';

    const input: TranspileInputDTO = {
      filename: job.inputRef,
      targetFormat,
      options: details?.options,
      rawText: details?.rawText,
      dataBase64: details?.dataBase64,
    };

    await this.jobRepo.updateJobProgress(jobId, 10, 'PROCESSING');
    try {
      const transpiled = await this.transpileDirect(input);
      if (!transpiled.success) {
        await this.jobRepo.failJob(jobId, 'RETRY_CONVERSION_FAILED', {
          diagnostics: transpiled.diagnostics,
        });
      } else {
        await this.db
          .update(backgroundJobs)
          .set({
            status: 'COMPLETED',
            progress: 100,
            outputRef: transpiled.filename,
            errorDetails: {
              targetFormat: transpiled.targetFormat,
              mimeType: transpiled.mimeType,
              isBinary: transpiled.isBinary,
              data: transpiled.data,
              diagnostics: transpiled.diagnostics,
            },
            completedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(backgroundJobs.id, jobId));
      }
    } catch (err: any) {
      await this.jobRepo.failJob(jobId, 'RETRY_EXCEPTION', { message: err.message });
    }

    return (await this.jobRepo.findJobById(jobId))!;
  }

  /**
   * Guarda el resultado convertido directamente en el catálogo de canciones de Bethesda.
   */
  public async commitJobToCatalog(
    jobId: string,
    user: AuthenticatedUser,
    overrides?: { title?: string; artist?: string }
  ): Promise<any> {
    if (!this.songService) {
      throw new ValidationError('SongService no disponible para persistir al catálogo.');
    }

    const job = await this.getJob(jobId, user);
    if (job.status !== 'COMPLETED' && job.status !== 'REVIEW_REQUIRED') {
      throw new ValidationError('Solo se pueden agregar al catálogo trabajos completados o revisados.');
    }

    const details = job.errorDetails as any;
    const title = overrides?.title || job.inputRef.replace(/\.[^.]+$/, '') || 'Canción Convertida';
    const artist = overrides?.artist || 'Autor Desconocido';

    // Crear la canción canónica en el catálogo
    const song = await this.songService.createSong({
      title,
      artist,
      sourceFormat: 'CHORD_PRO',
      canonicalPayload: {
        version: '1.0.0',
        title,
        timeline: {
          tpqn: 480,
          totalDurationTicks: null,
          measureCount: 0,
          tempoMap: { events: [], isUnresolved: true },
          isUnmetered: true,
        },
        sections: [],
        measures: [],
        instrumentTracks: [],
        metadata: {
          artist,
          sourceJobId: job.id,
          convertedFrom: job.inputRef,
        },
      },
      sourceRecord: {
        userId: user.id,
        sourceType: 'CHORD_PRO',
        filename: job.inputRef,
        rawContent: details?.data ? (details.isBinary ? null : details.data) : null,
        importerName: 'ConversionJobService',
        importerVersion: '1.0.0',
      },
    });

    return song;
  }

  private extractContent(input: { rawText?: string | undefined; dataBase64?: string | undefined }): string | Uint8Array {
    if (input.rawText && input.rawText.trim().length > 0) {
      return input.rawText;
    }
    if (input.dataBase64 && input.dataBase64.trim().length > 0) {
      return Buffer.from(input.dataBase64, 'base64');
    }
    throw new ValidationError('Debe proporcionar el contenido musical en rawText o dataBase64.');
  }
}
