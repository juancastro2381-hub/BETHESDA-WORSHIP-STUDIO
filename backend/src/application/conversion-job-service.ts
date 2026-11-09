/**
 * @file conversion-job-service.ts
 * @description Servicio de aplicación para el Centro de Conversión Musical de Bethesda Worship Studio (Fase 2A-R).
 *
 * Administra el ciclo de vida de los trabajos de conversión, validación de capacidades de formato,
 * almacenamiento físico inmutable con cálculo de hash SHA-256 (CR-03), encolado asíncrono con pg-boss (CR-02),
 * transposición armónica (CR-04), integridad musical sin fabricación (CR-05), persistencia fidedigna al catálogo (CR-06)
 * y aislamiento estricto multi-inquilino / anti-IDOR (CR-08).
 */

import crypto from 'node:crypto';
import { and, eq, or, lt } from 'drizzle-orm';
import { db as defaultDb, type Database } from '../db/index.ts';
import { backgroundJobs, songSources, type BackgroundJobRow } from '../db/schema.ts';
import {
  ForbiddenError,
  NotFoundError,
  PersistenceError,
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
import {
  LocalFileSystemSourceStorageProvider,
  type ISourceStorageProvider,
} from '../domain/ingestion/source-storage-provider.ts';
import {
  enqueueConversionJob,
  type ConversionJobPayload,
} from '../infrastructure/queue/conversion-queue.ts';
import { ConversionWorker } from './conversion-worker.ts';
import { CanonicalDeserializer } from '../domain/canonical-serializer.ts';

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
  private readonly storage: ISourceStorageProvider;
  private readonly worker: ConversionWorker;

  public constructor(
    private readonly songService?: SongService,
    jobRepository?: IBackgroundJobRepository,
    private readonly db: Database = defaultDb,
    customStorage?: ISourceStorageProvider,
    customWorker?: ConversionWorker
  ) {
    this.engine = new ConversionEngine();
    this.jobRepo = jobRepository ?? new DrizzleBackgroundJobRepository(this.db);
    this.storage = customStorage ?? new LocalFileSystemSourceStorageProvider();
    this.worker = customWorker ?? new ConversionWorker(this.db, this.storage, this.engine);
  }

  /**
   * Valida la compatibilidad de una fuente musical y retorna su matriz de formatos viables (CR-07).
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
        : new TextDecoder('utf-8', { fatal: false }).decode(rawContent);

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
   * Crea, preserva físicamente y encola un trabajo de conversión persistente con pg-boss (CR-02 & CR-03).
   */
  public async createJob(
    user: AuthenticatedUser,
    input: TranspileInputDTO
  ): Promise<BackgroundJobRow> {
    if (!user || !user.id) {
      throw new ValidationError('Usuario no autenticado para crear trabajo de conversión.');
    }

    // 1. Extraer y validar el buffer físico del archivo suministrado
    const rawContent = this.extractContent(input);
    const buffer =
      typeof rawContent === 'string' ? Buffer.from(rawContent, 'utf-8') : Buffer.from(rawContent);

    // 1.1 Validación estricta de viabilidad de capacidades (Prevenir creación de trabajos inviables)
    const detectedCategory = FormatCapabilitiesEvaluator.detectSourceCategory(input.filename, buffer);
    const capabilities = FormatCapabilitiesEvaluator.getFormatCapabilities(detectedCategory);
    const requestedCap = capabilities.find((c) => c.format === input.targetFormat);

    if (!requestedCap || !requestedCap.isAvailable) {
      if (requestedCap?.statusBadge === 'BLOCKED_ZERO_FABRICATION') {
        throw new ValidationError(
          `Conversión bloqueada por el Principio de CERO Fabricación: ${requestedCap.blockingReason ?? 'La fuente musical carece de la información requerida para este formato.'}`
        );
      }
      if (
        requestedCap?.statusBadge === 'DEFERRED_PHASE' ||
        requestedCap?.capabilityState === 'PLANNED_PHASE_2B'
      ) {
        throw new ValidationError(
          `Conversión no disponible en Fase 2A: ${requestedCap.blockingReason ?? 'Esta capacidad está planificada para la Fase 2B.'}`
        );
      }
      throw new ValidationError(
        `El formato objetivo "${input.targetFormat}" no es compatible con el archivo de origen "${input.filename}" (${detectedCategory}).`
      );
    }

    // 2. Preservar duraderamente el archivo en almacenamiento físico (CR-03)
    const storageResult = await this.storage.save(input.filename, buffer);

    // 3. Registrar el trabajo en background_jobs con estado inicial PENDING
    const job = await this.jobRepo.createJob({
      jobType: 'CONVERSION',
      status: 'PENDING',
      progress: 0,
      userId: user.id,
      tenantId: 'bethesda-default',
      inputRef: input.filename,
      outputRef: null,
      errorDetails: {
        storageKey: storageResult.storageKey,
        checksumSha256: storageResult.checksumSha256,
        fileSizeBytes: storageResult.fileSizeBytes,
        targetFormat: input.targetFormat,
        options: input.options ?? {},
      },
      startedAt: new Date(),
    });

    // 4. Registrar en song_sources la trazabilidad inmutable de la fuente original (CR-03)
    await this.db.insert(songSources).values({
      userId: user.id,
      sourceType: detectedCategory,
      filename: input.filename,
      storagePath: storageResult.storageKey,
      mimeType: this.resolveMimeType(input.filename, input.targetFormat),
      fileSizeBytes: storageResult.fileSizeBytes,
      checksumSha256: storageResult.checksumSha256,
      jobId: job.id,
      rawContent: input.rawText ?? null,
      importerName: 'ConversionJobService',
      importerVersion: '2.0.0',
    });

    // 5. Encolar autoritativamente en pg-boss (CR-01)
    const jobPayload: ConversionJobPayload = {
      jobId: job.id,
      userId: user.id,
      tenantId: 'bethesda-default',
      storageKey: storageResult.storageKey,
      checksumSha256: storageResult.checksumSha256,
      filename: input.filename,
      targetFormat: input.targetFormat,
      options: input.options,
    };

    try {
      await enqueueConversionJob(jobPayload);
    } catch (err: any) {
      await this.jobRepo.failJob(job.id, 'QUEUE_UNAVAILABLE', {
        message: err.message,
      });
      throw new PersistenceError(`No se pudo encolar el trabajo de conversión en el servicio persistente: ${err.message}`);
    }

    // Zero direct setImmediate() processing! pg-boss es el mecanismo autoritativo exclusivo (CR-01).

    const createdJob = await this.jobRepo.findJobById(job.id);
    return createdJob!;
  }

  /**
   * Obtiene el detalle de un trabajo de conversión verificando propiedad del usuario (anti-IDOR, CR-08).
   */
  public async getJob(jobId: string, user: AuthenticatedUser): Promise<BackgroundJobRow> {
    const job = await this.jobRepo.findJobById(jobId);
    if (!job) {
      throw new NotFoundError('Trabajo de conversión', jobId);
    }
    const isOwner = job.userId === user.id;
    const isPrivileged = user.role === 'ADMIN' || user.role === 'SUPER_ADMIN';
    if (!isOwner && !isPrivileged) {
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
   * Cancela un trabajo en ejecución o pendiente de forma atómica y coordinada (CR-03).
   * Los estados terminales (COMPLETED, REVIEW_REQUIRED, FAILED) son inmutables.
   */
  public async cancelJob(jobId: string, user: AuthenticatedUser): Promise<BackgroundJobRow> {
    const job = await this.getJob(jobId, user);
    if (job.status === 'CANCELLED') {
      throw new ValidationError('El trabajo ya se encuentra cancelado.');
    }
    if (job.status === 'COMPLETED' || job.status === 'REVIEW_REQUIRED' || job.status === 'FAILED') {
      throw new ValidationError('No se puede cancelar un trabajo que ya se encuentra en estado terminal.');
    }

    const [cancelled] = await this.db
      .update(backgroundJobs)
      .set({
        status: 'CANCELLED',
        completedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(backgroundJobs.id, jobId),
          or(
            eq(backgroundJobs.status, 'PENDING'),
            eq(backgroundJobs.status, 'PROCESSING')
          )
        )
      )
      .returning();

    if (!cancelled) {
      const current = await this.jobRepo.findJobById(jobId);
      if (current && (current.status === 'COMPLETED' || current.status === 'REVIEW_REQUIRED')) {
        throw new ValidationError('El trabajo acaba de completarse y ya no puede ser cancelado.');
      }
      return current!;
    }

    return cancelled;
  }

  /**
   * Reintenta un trabajo fallido o cancelado utilizando la fuente física inmutable y verificación criptográfica (CR-03).
   */
  public async retryJob(jobId: string, user: AuthenticatedUser): Promise<BackgroundJobRow> {
    const job = await this.getJob(jobId, user);
    if (job.status !== 'FAILED' && job.status !== 'CANCELLED') {
      throw new ValidationError('Solo se pueden reintentar trabajos que se encuentren en estado FAILED o CANCELLED.');
    }

    const details = job.errorDetails as any;
    const storageKey = details?.storageKey;
    const checksumSha256 = details?.checksumSha256;
    const targetFormat = details?.targetFormat || 'CHORD_PRO';
    const options = details?.options;

    if (!storageKey || !checksumSha256) {
      throw new ValidationError('El trabajo no cuenta con referencia física duradera para reintento.');
    }

    // Verificar que el archivo en disco existe y conserva su integridad
    const buffer = await this.storage.getBuffer(storageKey);
    const currentHash = crypto.createHash('sha256').update(buffer).digest('hex');
    if (currentHash !== checksumSha256) {
      throw new Error('Violación de Integridad Criptográfica: El archivo físico fue alterado.');
    }

    // Reiniciar trabajo a PENDING, progreso 0, y limpiar arrendamientos anteriores
    await this.db
      .update(backgroundJobs)
      .set({
        status: 'PENDING',
        progress: 0,
        leaseOwner: null,
        leaseToken: null,
        leaseExpiresAt: null,
        heartbeatAt: null,
        completedAt: null,
        updatedAt: new Date(),
      })
      .where(eq(backgroundJobs.id, jobId));

    const jobPayload: ConversionJobPayload = {
      jobId,
      userId: user.id,
      tenantId: 'bethesda-default',
      storageKey,
      checksumSha256,
      filename: job.inputRef,
      targetFormat,
      options,
    };

    try {
      await enqueueConversionJob(jobPayload);
    } catch (err: any) {
      throw new PersistenceError(`No se pudo reencolar el trabajo en pg-boss: ${err.message}`);
    }

    // Zero direct setImmediate() processing!

    return (await this.jobRepo.findJobById(jobId))!;
  }

  /**
   * Guarda el resultado convertido directamente en el catálogo de canciones de Bethesda (CR-05).
   * Ejecuta dentro de una transacción serializable con bloqueo FOR UPDATE e idempotencia estricta.
   */
  public async commitJobToCatalog(
    jobId: string,
    user: AuthenticatedUser,
    overrides?: { title?: string; artist?: string }
  ): Promise<any> {
    if (!this.songService) {
      throw new ValidationError('SongService no disponible para persistir al catálogo.');
    }
    const songService = this.songService;

    return await this.db.transaction(async (tx) => {
      // 1. Bloqueo pesimista de fila en background_jobs con FOR UPDATE (CR-05)
      const [job] = await tx
        .select()
        .from(backgroundJobs)
        .where(eq(backgroundJobs.id, jobId))
        .for('update');

      if (!job) {
        throw new NotFoundError('Trabajo de conversión', jobId);
      }

      // Verificación de autorización anti-IDOR
      const isOwner = job.userId === user.id;
      const isPrivileged = user.role === 'ADMIN' || user.role === 'SUPER_ADMIN';
      if (!isOwner && !isPrivileged) {
        throw new ForbiddenError('No tienes autorización para consultar este trabajo de conversión.');
      }

      // Verificación de estado terminal válido
      if (job.status !== 'COMPLETED' && job.status !== 'REVIEW_REQUIRED') {
        throw new ValidationError('Solo se pueden agregar al catálogo trabajos completados o revisados.');
      }

      // 2. Idempotencia Nivel 1: Si ya fue comprometido previamente en background_jobs
      if (job.committedSongId) {
        return await songService.getSong(job.committedSongId);
      }

      // 3. Idempotencia Nivel 2: Verificar si ya existe una fuente asociada con song_id
      const sources = await tx
        .select()
        .from(songSources)
        .where(eq(songSources.jobId, jobId));

      const existingLinkedSource = sources.find((s) => s.songId !== null);
      if (existingLinkedSource && existingLinkedSource.songId) {
        await tx
          .update(backgroundJobs)
          .set({ committedSongId: existingLinkedSource.songId })
          .where(eq(backgroundJobs.id, jobId));
        return await songService.getSong(existingLinkedSource.songId);
      }

      // 4. Extraer el grafo canónico real serializado durante la conversión
      const details = job.errorDetails as any;
      const rawCanonicalJson = details?.canonicalPayload;

      if (!rawCanonicalJson) {
        throw new ValidationError(
          'El trabajo de conversión no generó un CanonicalMusicPayload válido para persistencia en catálogo.'
        );
      }

      const canonicalPayload = CanonicalDeserializer.deserialize(rawCanonicalJson);

      const title =
        overrides?.title ||
        canonicalPayload.title ||
        job.inputRef.replace(/\.[^.]+$/, '') ||
        'Canción Convertida';

      const artist =
        overrides?.artist ||
        (typeof canonicalPayload.metadata?.artist === 'string'
          ? canonicalPayload.metadata.artist
          : 'Autor Desconocido');

      // 5. Persistir en el catálogo canónico mediante SongService
      const song = await songService.createSong({
        title,
        artist,
        sourceFormat: this.mapCategoryToFormat(details.targetFormat),
        canonicalPayload: rawCanonicalJson,
        sourceRecord: {
          userId: user.id,
          sourceType: this.mapCategoryToFormat(details.targetFormat),
          filename: job.outputRef || job.inputRef,
          rawContent: details?.data ? (details.isBinary ? null : details.data) : null,
          importerName: 'ConversionJobService',
          importerVersion: '2.0.0',
        },
      });

      // 6. Registrar atómicamente el song_id comprometido en background_jobs
      await tx
        .update(backgroundJobs)
        .set({ committedSongId: song.song.id })
        .where(eq(backgroundJobs.id, jobId));

      // 7. Vincular o insertar el registro de song_sources al song_id recién creado
      if (sources.length > 0 && sources[0]) {
        await tx
          .update(songSources)
          .set({
            songId: song.song.id,
            versionId: song.version.id,
          })
          .where(eq(songSources.id, sources[0].id));
      } else {
        await tx.insert(songSources).values({
          userId: user.id,
          sourceType: this.mapCategoryToFormat(details.targetFormat),
          filename: job.outputRef || job.inputRef,
          storagePath: details?.storageKey || 'conversion-result',
          mimeType: details?.mimeType || 'text/plain',
          fileSizeBytes: Buffer.byteLength(details?.data || ''),
          checksumSha256: crypto.createHash('sha256').update(details?.data || '').digest('hex'),
          jobId: job.id,
          songId: song.song.id,
          versionId: song.version.id,
          importerName: 'ConversionJobService',
          importerVersion: '2.0.0',
        });
      }

      return song;
    });
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

  private resolveMimeType(filename: string, targetFormat: ConversionTargetFormat): string {
    const lower = filename.toLowerCase();
    if (lower.endsWith('.mid') || lower.endsWith('.midi')) return 'audio/midi';
    if (lower.endsWith('.musicxml') || lower.endsWith('.xml')) return 'application/vnd.recordare.musicxml+xml';
    if (lower.endsWith('.cho') || lower.endsWith('.crd')) return 'text/plain';
    if (lower.endsWith('.pdf')) return 'application/pdf';
    return 'text/plain';
  }

  private mapCategoryToFormat(targetFormat: string): 'MUSIC_XML' | 'CHORD_PRO' | 'INTERNAL' | 'PDF' | 'IMAGE' {
    if (targetFormat === 'MUSIC_XML') return 'MUSIC_XML';
    if (targetFormat === 'CHORD_PRO' || targetFormat === 'LYRICS_ONLY') return 'CHORD_PRO';
    return 'INTERNAL';
  }
}
