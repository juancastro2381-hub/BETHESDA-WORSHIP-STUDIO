/**
 * @file universal-ingestion-service.ts
 * @description Orquestador central de ingesta musical universal (Fase 1B-R).
 *
 * Responsabilidades:
 * 1. Preservación incondicional previa: todo archivo, texto, especificación JSON o referencia de video
 *    se guarda físicamente en el storage provider y se registra en `song_sources` ANTES de parsear.
 * 2. Idempotencia multi-inquilino estricta: la reutilización de fuentes se delimita estrictamente
 *    al mismo usuario (`userId = $1 AND checksum_sha256 = $2`), neutralizando fugas cross-tenant (IDOR).
 * 3. Ejecución segura del adaptador especializado sin invención musical.
 * 4. Persistencia relacional de canciones únicamente si existe un payload canónico válido.
 * 5. Trazabilidad completa y transparente en `background_jobs`.
 * 6. Recuperación segura de fuentes originales con validación estricta de autorización de propietario.
 */

import crypto from 'node:crypto';
import path from 'node:path';
import { and, eq } from 'drizzle-orm';
import { db as defaultDb, type Database } from '../db/index.ts';
import { songSources, backgroundJobs } from '../db/schema.ts';
import {
  ForbiddenError,
  NotFoundError,
  PersistenceError,
  SourceIntegrityError,
  ValidationError,
} from '../domain/errors.ts';
import type { AuthenticatedUser } from '../domain/auth-types.ts';
import type { SongSourceFormat } from '../domain/types.ts';
import type { SongService } from './song-service.ts';
import type { IBackgroundJobRepository } from '../repositories/background-job-repository.ts';
import { DrizzleBackgroundJobRepository } from '../repositories/background-job-repository.ts';
import type {
  ISourceStorageProvider,
  SourceStorageSaveResult,
} from '../domain/ingestion/source-storage-provider.ts';
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
   * Serialización determinista canónica JSON (claves ordenadas) para preservar
   * invariancia criptográfica exacta: SHA256(original) === SHA256(stored) === SHA256(retrieved).
   */
  public static canonicalJsonStringify(obj: unknown): string {
    if (obj === null || typeof obj !== 'object') {
      return JSON.stringify(obj);
    }
    if (Array.isArray(obj)) {
      return '[' + obj.map(UniversalIngestionService.canonicalJsonStringify).join(',') + ']';
    }
    const keys = Object.keys(obj as Record<string, unknown>).sort();
    const pairs = keys.map(
      (k) => `${JSON.stringify(k)}:${UniversalIngestionService.canonicalJsonStringify((obj as Record<string, unknown>)[k])}`
    );
    return '{' + pairs.join(',') + '}';
  }

  /**
   * Discrimina si un buffer o nombre de archivo corresponde a un formato de imagen visual (PNG, JPEG, TIFF).
   */
  public static isImageSource(buffer?: Buffer, filename?: string): boolean {
    if (buffer && buffer.length >= 4) {
      if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) return true; // PNG
      if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return true; // JPEG
      if ((buffer[0] === 0x49 && buffer[1] === 0x49) || (buffer[0] === 0x4d && buffer[1] === 0x4d)) return true; // TIFF
    }
    if (filename) {
      const ext = path.extname(filename).toLowerCase();
      if (['.png', '.jpg', '.jpeg', '.tiff', '.tif', '.webp'].includes(ext)) return true;
    }
    return false;
  }

  /**
   * Calcula el hash criptográfico SHA-256 de la entrada para verificación de integridad e idempotencia.
   */
  public static calculateSourceHash(input: IngestionInput): string {
    const hasher = crypto.createHash('sha256');
    if (input.buffer) {
      hasher.update(input.buffer);
    } else if (input.rawText !== undefined) {
      hasher.update(Buffer.from(input.rawText, 'utf-8'));
    } else if (input.videoUrl !== undefined) {
      hasher.update(
        Buffer.from(
          UniversalIngestionService.canonicalJsonStringify({
            sourceKind: 'VIDEO_REFERENCE',
            videoUrl: input.videoUrl.trim(),
            title: input.title || null,
            artist: input.artist || null,
          }),
          'utf-8'
        )
      );
    } else if (input.writtenNotes !== undefined) {
      hasher.update(Buffer.from(UniversalIngestionService.canonicalJsonStringify(input.writtenNotes), 'utf-8'));
    } else {
      hasher.update(crypto.randomUUID());
    }
    return hasher.digest('hex');
  }

  /**
   * Mapea el tipo de fuente de ingesta al formato de persistencia de SongSourceFormat.
   */
  public static mapSourceTypeToFormat(type: IngestionSourceType): SongSourceFormat {
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
      case 'TABLATURE':
        return 'TABLATURE';
      default:
        return 'INTERNAL';
    }
  }

  /**
   * Determina el buffer y el MIME type adecuado para la preservación física y calcula el SHA-256
   * de forma determinista y como única fuente de verdad criptográfica.
   */
  private prepareBufferAndMime(
    input: IngestionInput,
    adapter: IIngestionAdapter
  ): {
    bufferToSave: Buffer;
    detectedMime: string;
    filename: string;
    sourceHash: string;
    effectiveSourceType: IngestionSourceType;
  } {
    let effectiveSourceType: IngestionSourceType = input.sourceType || adapter.sourceType;
    if (adapter.sourceType === 'PDF_SCORE' && UniversalIngestionService.isImageSource(input.buffer, input.filename)) {
      effectiveSourceType = 'IMAGE_SCORE';
    }

    let bufferToSave: Buffer;
    let detectedMime = input.mimeType || 'application/octet-stream';
    let filename = input.filename;

    if (input.buffer) {
      bufferToSave = input.buffer;
      if (adapter.detectMimeType) {
        detectedMime = adapter.detectMimeType(input.buffer) || detectedMime;
      }
    } else if (input.rawText !== undefined) {
      bufferToSave = Buffer.from(input.rawText, 'utf-8');
      if (effectiveSourceType === 'CHORDPRO') {
        detectedMime = 'text/x-chordpro';
      } else if (effectiveSourceType === 'MUSICXML') {
        detectedMime = 'application/vnd.recordare.musicxml+xml';
      } else {
        detectedMime = 'text/plain';
      }
    } else if (input.writtenNotes !== undefined) {
      bufferToSave = Buffer.from(UniversalIngestionService.canonicalJsonStringify(input.writtenNotes), 'utf-8');
      detectedMime = 'application/json';
    } else if (input.videoUrl !== undefined) {
      bufferToSave = Buffer.from(
        UniversalIngestionService.canonicalJsonStringify({
          sourceKind: 'VIDEO_REFERENCE',
          videoUrl: input.videoUrl.trim(),
          title: input.title || null,
          artist: input.artist || null,
        }),
        'utf-8'
      );
      detectedMime = 'application/json';
    } else {
      bufferToSave = Buffer.alloc(0);
    }

    const sourceHash = crypto.createHash('sha256').update(bufferToSave).digest('hex');

    if (!filename) {
      switch (effectiveSourceType) {
        case 'MUSICXML':
          filename = `source_${sourceHash.slice(0, 8)}.musicxml`;
          break;
        case 'MIDI':
          filename = `source_${sourceHash.slice(0, 8)}.mid`;
          break;
        case 'CHORDPRO':
          filename = `source_${sourceHash.slice(0, 8)}.cho`;
          break;
        case 'WRITTEN_NOTES':
          filename = `notes_${sourceHash.slice(0, 8)}.json`;
          break;
        case 'VIDEO_URL':
          filename = `video_${sourceHash.slice(0, 8)}.json`;
          break;
        case 'PDF_SCORE':
          filename = `score_${sourceHash.slice(0, 8)}.pdf`;
          break;
        case 'IMAGE_SCORE':
          filename = `image_${sourceHash.slice(0, 8)}.png`;
          break;
        case 'AUDIO':
          filename = `audio_${sourceHash.slice(0, 8)}.wav`;
          break;
        default:
          filename = `source_${sourceHash.slice(0, 8)}.bin`;
      }
    }

    return { bufferToSave, detectedMime, filename, sourceHash, effectiveSourceType };
  }

  /**
   * Orquesta la ingesta universal completa:
   * 1. Preservación física de la fuente original en disco/storage.
   * 2. Creación del registro en `song_sources` ANTES del parseo.
   * 3. Idempotencia acotada estrictamente al usuario (`userId = $1 AND checksum_sha256 = $2`).
   * 4. Ejecución del adaptador especializado.
   * 5. Persistencia canónica relacional únicamente si hay partitura válida.
   */
  public async ingest(input: IngestionInput, user: AuthenticatedUser): Promise<IngestionOutput> {
    if (!user || !user.id) {
      throw new ValidationError('Se requiere un usuario autenticado para realizar la ingesta musical.');
    }

    // 1. Resolver adaptador y preparar buffer canónico con hash como única fuente de verdad
    const adapter = this.resolveAdapter(input);
    const { bufferToSave, detectedMime, filename, sourceHash, effectiveSourceType } = this.prepareBufferAndMime(input, adapter);

    // 2. Comprobar Idempotencia multi-inquilino: acotada estrictamente al usuario actual
    const existingSource = await this.database
      .select({
        id: songSources.id,
        songId: songSources.songId,
        versionId: songSources.versionId,
        sourceType: songSources.sourceType,
        filename: songSources.filename,
        storagePath: songSources.storagePath,
        mimeType: songSources.mimeType,
      })
      .from(songSources)
      .where(
        and(
          eq(songSources.userId, user.id),
          eq(songSources.checksumSha256, sourceHash)
        )
      )
      .limit(1);

    if (existingSource.length > 0) {
      const match = existingSource[0];
      if (match.songId) {
        const existing = await this.songService.getSong(match.songId);
        if (existing) {
          return {
            status: 'CONVERTED',
            sourceType: adapter.sourceType,
            sourceHash,
            sourceId: match.id,
            filename: match.filename || input.filename,
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
                message: 'El archivo ya había sido importado previamente por su usuario; se retornó la canción canónica existente.',
              },
            ],
          };
        }
      } else {
        // Fuente previamente preservada (ej. video, audio o partitura visual sin canción asociada)
        return {
          status: 'SOURCE_PRESERVED',
          sourceType: adapter.sourceType,
          sourceHash,
          sourceId: match.id,
          filename: match.filename || input.filename,
          title: input.title || 'Fuente musical preservada',
          artist: input.artist || null,
          defaultKey: null,
          defaultBpm: null,
          timeSignature: null,
          canonicalPayload: null,
          diagnostics: [
            {
              code: 'IDEMPOTENT_SOURCE_REUSED',
              severity: 'INFO',
              message: 'Esta fuente original ya se encuentra preservada para este usuario.',
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
      inputRef: filename,
      startedAt: new Date(),
    });

    // 4. Preservación física incondicional en almacenamiento seguro
    let saveResult: SourceStorageSaveResult;
    try {
      saveResult = await this.storageProvider.save(filename, bufferToSave);
    } catch (storageErr) {
      const errMessage = storageErr instanceof Error ? storageErr.message : String(storageErr);
      await this.jobRepository.failJob(job.id, 'STORAGE_FAILED', {
        message: errMessage,
        adapter: adapter.name,
      });
      throw new PersistenceError(
        `Error crítico al almacenar el archivo fuente original en disco/storage: ${errMessage}`,
        storageErr
      );
    }

    // 5. Registrar fila inmutable en `song_sources` ANTES de parsear
    const sourceFormat = UniversalIngestionService.mapSourceTypeToFormat(effectiveSourceType);
    let sourceRecordId: string;

    try {
      const [sourceRow] = await this.database
        .insert(songSources)
        .values({
          userId: user.id,
          songId: null,
          versionId: null,
          sourceType: sourceFormat,
          filename,
          storagePath: saveResult.storageKey,
          mimeType: detectedMime,
          fileSizeBytes: bufferToSave.length,
          checksumSha256: sourceHash,
          jobId: job.id,
          rawContent: input.rawText || sourceHash,
          importerName: adapter.name,
          importerVersion: adapter.version,
        })
        .returning({ id: songSources.id });

      sourceRecordId = sourceRow.id;
    } catch (dbErr) {
      const errMessage = dbErr instanceof Error ? dbErr.message : String(dbErr);
      await this.jobRepository.failJob(job.id, 'SOURCE_RECORD_FAILED', {
        message: errMessage,
      });
      throw new PersistenceError(`Error al crear el registro de procedencia song_sources: ${errMessage}`, dbErr);
    }

    try {
      // 7. Ejecutar adaptador especializado
      const output = await adapter.ingest(input, user);
      output.sourceId = sourceRecordId;
      output.sourceHash = sourceHash;
      output.sourceChecksumSha256 = sourceHash;

      // 8. Si produjo un payload canónico válido, persistir en base de datos
      if (
        output.canonicalPayload &&
        (output.status === 'PARSED' || output.status === 'CONVERTED' || output.status === 'PARTIALLY_CONVERTED')
      ) {
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
          metadata: {
            notes: `Fuente original preservada mediante ${adapter.name}. Checksum SHA-256: ${sourceHash}.`,
            tags: ['universal-ingestion', adapter.sourceType.toLowerCase()],
          },
        });

        // Enlazar song_sources con la canción y versión generada
        await this.database
          .update(songSources)
          .set({
            songId: created.song.id,
            versionId: created.version.id,
          })
          .where(eq(songSources.id, sourceRecordId));

        output.songId = created.song.id;
        output.versionId = created.version.id;
        output.status = output.status === 'PARTIALLY_CONVERTED' ? 'PARTIALLY_CONVERTED' : 'CONVERTED';

        // Completar tarea asociando el ID de la canción
        await this.jobRepository.completeJob(job.id, created.song.id);
      } else {
        // Fuente sin partitura canónica (PDF/Imagen/Audio sin OMR, o Video URL registrado)
        // Completar tarea asociando el ID de la fuente preservada
        await this.jobRepository.completeJob(job.id, sourceRecordId);
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
   * Consulta los metadatos de una fuente preservada verificando autorización multi-inquilino.
   */
  public async getSource(sourceId: string, user: AuthenticatedUser) {
    const [source] = await this.database
      .select()
      .from(songSources)
      .where(eq(songSources.id, sourceId))
      .limit(1);

    if (!source) {
      throw new NotFoundError('Fuente musical', sourceId);
    }

    const isOwner = Boolean(source.userId && source.userId === user.id);
    const isPrivileged = user.role === 'ADMIN' || user.role === 'SUPER_ADMIN';

    if (!isOwner && !isPrivileged) {
      throw new ForbiddenError('No tiene autorización para acceder a esta fuente musical.');
    }

    return source;
  }

  /**
   * Obtiene el flujo de bytes original de una fuente preservada verificando autorización multi-inquilino
   * e integridad criptográfica estricta (SHA256(retrievedBytes) === SHA256(storedBytes)).
   */
  public async getSourceFile(sourceId: string, user: AuthenticatedUser) {
    const source = await this.getSource(sourceId, user);

    if (!source.storagePath) {
      throw new NotFoundError('Archivo físico de fuente', sourceId);
    }

    const buffer = await this.storageProvider.getBuffer(source.storagePath);
    const retrievedChecksum = crypto.createHash('sha256').update(buffer).digest('hex');

    if (source.checksumSha256 && retrievedChecksum !== source.checksumSha256) {
      throw new SourceIntegrityError(
        `Fallo de verificación de integridad criptográfica: el hash SHA-256 de los bytes recuperados (${retrievedChecksum}) no coincide con el hash canónico registrado (${source.checksumSha256}). El archivo no puede ser entregado.`,
        {
          sourceId,
          expectedChecksum: source.checksumSha256,
          actualChecksum: retrievedChecksum,
        }
      );
    }

    return {
      source,
      buffer,
    };
  }

  /**
   * Consulta el estado de una tarea de ingesta en segundo plano verificando autorización de usuario.
   */
  public async getJobStatus(jobId: string, user: AuthenticatedUser) {
    const job = await this.jobRepository.findJobById(jobId);
    if (!job) {
      throw new NotFoundError('Tarea de ingesta', jobId);
    }

    const isOwner = Boolean(job.userId && job.userId === user.id);
    const isPrivileged = user.role === 'ADMIN' || user.role === 'SUPER_ADMIN';

    if (!isOwner && !isPrivileged) {
      throw new ForbiddenError('No tiene autorización para consultar tareas de otro usuario.');
    }

    return job;
  }
}
