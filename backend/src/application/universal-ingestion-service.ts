/**
 * @file universal-ingestion-service.ts
 * @description Orquestador central de ingesta musical universal (Fase 1B).
 *
 * Responsabilidades:
 * 1. Registro extensible de adaptadores por formato (MusicXML, MIDI, ChordPro, Notas Escritas, PDF/Imagen, Audio, Video URL).
 * 2. Validación de seguridad previa, cálculo de hash criptográfico SHA-256 y detección de idempotencia.
 * 3. Ejecución segura del adaptador correspondiente.
 * 4. Persistencia relacional de canciones y versiones canónicas sin pérdida de información ni invención de notas.
 * 5. Trazabilidad completa mediante tareas en segundo plano (background_jobs) y auditoría inmutable.
 */

import crypto from 'node:crypto';
import { and, eq, or } from 'drizzle-orm';
import { db as defaultDb, type Database } from '../db/index.ts';
import { songSources, backgroundJobs } from '../db/schema.ts';
import { ForbiddenError, NotFoundError, ValidationError } from '../domain/errors.ts';
import type { AuthenticatedUser } from '../domain/auth-types.ts';
import type { SongSourceFormat } from '../domain/types.ts';
import type { SongService } from './song-service.ts';
import type { IBackgroundJobRepository } from '../repositories/background-job-repository.ts';
import { DrizzleBackgroundJobRepository } from '../repositories/background-job-repository.ts';
import type { ISourceStorageProvider } from '../domain/ingestion/source-storage-provider.ts';
import { LocalFileSystemSourceStorageProvider } from '../domain/ingestion/source-storage-provider.ts';
import type {
  IIngestionAdapter,
  IngestionInput,
  IngestionOutput,
  IngestionSourceType,
} from '../domain/ingestion/types.ts';
import { MusicXmlIngestionAdapter } from '../domain/ingestion/adapters/musicxml/musicxml-adapter.ts';
import { MidiIngestionAdapter } from '../domain/ingestion/adapters/midi/midi-adapter.ts';
import { ChordProIngestionAdapter } from '../domain/ingestion/adapters/chordpro/chordpro-adapter.ts';
import { WrittenNotesIngestionAdapter } from '../domain/ingestion/adapters/written-notes/written-notes-adapter.ts';
import { VisualScoreIngestionAdapter } from '../domain/ingestion/adapters/visual-score/visual-score-adapter.ts';
import { AudioIngestionAdapter } from '../domain/ingestion/adapters/audio/audio-adapter.ts';
import { VideoUrlIngestionAdapter } from '../domain/ingestion/adapters/video/video-url-adapter.ts';

export class UniversalIngestionService {
  private readonly adapters: IIngestionAdapter[] = [];
  private readonly storageProvider: ISourceStorageProvider;
  private readonly jobRepository: IBackgroundJobRepository;

  public constructor(
    private readonly songService: SongService,
    storageProvider?: ISourceStorageProvider,
    jobRepository?: IBackgroundJobRepository,
    private readonly database: Database = defaultDb
  ) {
    this.storageProvider = storageProvider ?? new LocalFileSystemSourceStorageProvider();
    this.jobRepository = jobRepository ?? new DrizzleBackgroundJobRepository(this.database);

    // Registro predeterminado de adaptadores de formato
    this.registerAdapter(new MusicXmlIngestionAdapter());
    this.registerAdapter(new MidiIngestionAdapter());
    this.registerAdapter(new ChordProIngestionAdapter());
    this.registerAdapter(new WrittenNotesIngestionAdapter());
    this.registerAdapter(new VisualScoreIngestionAdapter(this.storageProvider));
    this.registerAdapter(new AudioIngestionAdapter(this.storageProvider));
    this.registerAdapter(new VideoUrlIngestionAdapter());
  }

  public registerAdapter(adapter: IIngestionAdapter): void {
    this.adapters.push(adapter);
  }

  public getAdapters(): readonly IIngestionAdapter[] {
    return this.adapters;
  }

  /**
   * Resuelve el adaptador idóneo para la entrada suministrada.
   */
  public resolveAdapter(input: IngestionInput): IIngestionAdapter {
    for (const adapter of this.adapters) {
      if (adapter.canHandle(input)) {
        return adapter;
      }
    }

    throw new ValidationError(
      `No se encontró un adaptador compatible para la fuente musical suministrada (${input.sourceType ?? input.filename ?? 'desconocida'}). Se admiten MusicXML, MIDI, ChordPro, Notas Escritas, PDF, Imágenes, Audio y URLs de video.`
    );
  }

  /**
   * Calcula el hash criptográfico SHA-256 de la entrada para verificación de integridad e idempotencia.
   */
  public static calculateSourceHash(input: IngestionInput): string {
    const hasher = crypto.createHash('sha256');
    if (input.buffer) {
      hasher.update(input.buffer);
    } else if (input.rawText) {
      hasher.update(input.rawText);
    } else if (input.videoUrl) {
      hasher.update(input.videoUrl);
    } else if (input.writtenNotes) {
      hasher.update(JSON.stringify(input.writtenNotes));
    } else {
      hasher.update(crypto.randomUUID());
    }
    return hasher.digest('hex');
  }

  /**
   * Mapea el tipo de fuente de ingesta al formato de persistencia de SongSourceFormat.
   */
  private static mapSourceTypeToFormat(type: IngestionSourceType): SongSourceFormat {
    switch (type) {
      case 'MUSICXML':
        return 'MUSIC_XML';
      case 'MIDI':
        return 'MIDI';
      case 'CHORDPRO':
        return 'CHORD_PRO';
      case 'WRITTEN_NOTES':
        return 'INTERNAL';
      case 'PDF_SCORE':
        return 'PDF';
      case 'IMAGE_SCORE':
        return 'IMAGE';
      case 'AUDIO':
        return 'AUDIO';
      case 'VIDEO_URL':
        return 'VIDEO_URL';
      default:
        return 'INTERNAL';
    }
  }

  /**
   * Orquesta la ingesta universal completa, verificación de idempotencia y persistencia canónica.
   */
  public async ingest(input: IngestionInput, user: AuthenticatedUser): Promise<IngestionOutput> {
    if (!user || !user.id) {
      throw new ValidationError('Se requiere un usuario autenticado para realizar la ingesta musical.');
    }

    // 1. Resolver adaptador
    const adapter = this.resolveAdapter(input);
    const sourceHash = UniversalIngestionService.calculateSourceHash(input);

    // 2. Comprobar Idempotencia: Verificar si esta misma fuente ya fue importada
    const matchCriteria = [eq(songSources.filename, input.filename ?? '')];
    if (input.rawText) {
      matchCriteria.push(
        or(eq(songSources.rawContent, sourceHash), eq(songSources.rawContent, input.rawText))!
      );
    } else {
      matchCriteria.push(eq(songSources.rawContent, sourceHash));
    }

    const existingSource = await this.database
      .select({
        songId: songSources.songId,
        versionId: songSources.versionId,
      })
      .from(songSources)
      .where(and(...matchCriteria))
      .limit(1);

    if (existingSource.length > 0 && existingSource[0].songId) {
      const existing = await this.songService.getSong(existingSource[0].songId);
      if (existing) {
        return {
          status: 'CONVERTED',
          sourceType: adapter.sourceType,
          sourceHash,
          filename: input.filename,
          title: existing.song.title,
          artist: existing.song.artist,
          defaultKey: existing.song.defaultKey,
          defaultBpm: existing.song.defaultBpm,
          timeSignature: existing.song.timeSignature,
          canonicalPayload: existing.version.canonicalPayload,
          songId: existing.song.id,
          versionId: existing.version.id,
          diagnostics: [
            {
              code: 'IDEMPOTENT_IMPORT_REUSED',
              severity: 'INFO',
              message: 'El archivo ya había sido importado previamente; se retornó la canción canónica existente.',
            },
          ],
        };
      }
    }

    // 3. Registrar tarea de procesamiento en background_jobs
    const job = await this.jobRepository.createJob({
      jobType: 'IMPORT_COMMIT',
      status: 'PROCESSING',
      userId: user.id,
      inputRef: input.filename || input.videoUrl || 'notas-escritas',
      startedAt: new Date(),
    });

    try {
      // 4. Ejecutar adaptador especializado
      const output = await adapter.ingest(input, user);

      // 5. Si produjo un payload canónico válido, persistir en base de datos
      if (output.canonicalPayload && (output.status === 'PARSED' || output.status === 'CONVERTED')) {
        const sourceFormat = UniversalIngestionService.mapSourceTypeToFormat(output.sourceType);

        const created = await this.songService.createSong({
          title: output.title,
          artist: output.artist,
          defaultKey: output.defaultKey,
          defaultBpm: output.defaultBpm,
          timeSignature: output.timeSignature,
          status: 'APPROVED',
          versionName: `Importación ${adapter.name}`,
          versionDescription: `Importado automáticamente mediante ${adapter.name} v${adapter.version}`,
          sourceFormat,
          canonicalPayload: output.canonicalPayload,
          sourceRecord: {
            filename: output.filename,
            rawContent: input.rawText || sourceHash,
            importerName: adapter.name,
            importerVersion: adapter.version,
          },
          metadata: {
            notes: `Fuente original procesada mediante ${adapter.name}. Checksum SHA-256: ${sourceHash}.`,
            tags: ['universal-ingestion', adapter.sourceType.toLowerCase()],
          },
        });

        output.songId = created.song.id;
        output.versionId = created.version.id;
        output.status = 'CONVERTED';

        // Completar tarea
        await this.jobRepository.completeJob(job.id, created.song.id);
      } else {
        // Formato no estructurado o reconocimiento pendiente
        await this.jobRepository.updateJobProgress(job.id, 100, 'COMPLETED');
      }

      return output;
    } catch (error) {
      const errMessage = error instanceof Error ? error.message : String(error);
      await this.jobRepository.failJob(job.id, 'INGESTION_FAILED', {
        message: errMessage,
        adapter: adapter.name,
      });
      throw error;
    }
  }

  /**
   * Consulta el estado de una tarea de ingesta en segundo plano verificando autorización de usuario.
   */
  public async getJobStatus(jobId: string, user: AuthenticatedUser) {
    const job = await this.jobRepository.findJobById(jobId);
    if (!job) {
      throw new NotFoundError('Tarea de ingesta', jobId);
    }

    const isOwner = job.userId === user.id;
    const isPrivileged = user.role === 'ADMIN' || user.role === 'SUPER_ADMIN';

    if (!isOwner && !isPrivileged) {
      throw new ForbiddenError('No tiene autorización para consultar tareas de otro usuario.');
    }

    return job;
  }
}
