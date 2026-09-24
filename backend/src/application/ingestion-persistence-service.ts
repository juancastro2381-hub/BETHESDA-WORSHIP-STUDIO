/**
 * @file ingestion-persistence-service.ts
 * @description Servicio de orquestación de ingesta y persistencia directa (Fase 2A).
 *
 * Reutiliza la arquitectura de IngestionService desarrollada en la Fase 1H sin duplicar parsers.
 */

import { IngestionService } from '../../../frontend/src/core/ingestion/index.ts';
import type { SongWithVersion } from '../repositories/song-repository.ts';
import { SongService } from './song-service.ts';
import { CanonicalSerializer } from '../domain/canonical-serializer.ts';
import { InvalidMusicPayloadError, UnsupportedSourceError } from '../domain/errors.ts';

export interface ImportAndPersistOptions {
  source: string;
  filename?: string | undefined;
  artist?: string | undefined;
  versionName?: string | undefined;
  tags?: string[] | undefined;
}

export class IngestionPersistenceService {
  private readonly ingestionService: IngestionService;

  public constructor(private readonly songService: SongService) {
    this.ingestionService = new IngestionService();
  }

  public async importAndPersist(options: ImportAndPersistOptions): Promise<SongWithVersion> {
    const result = this.ingestionService.importSource(options.source, options.filename);

    if (result.status === 'FAILED' || !result.payload) {
      const errorDiag = result.diagnostics.find((d) => d.severity === 'ERROR');
      if (errorDiag?.code === 'UNSUPPORTED_FORMAT') {
        throw new UnsupportedSourceError(errorDiag.message, result.diagnostics);
      }
      throw new InvalidMusicPayloadError(
        errorDiag?.message ?? 'Fallo durante la ingesta y validación de la fuente musical.',
        result.diagnostics
      );
    }

    const payload = result.payload;
    const format = result.provenance.sourceFormat;

    // Obtener tonalidad por defecto del primer compás si existe
    const firstMeasure = payload.measures[0];
    const defaultKey = firstMeasure
      ? firstMeasure.keySignature.toMusicalKey().toString()
      : 'C Major';

    const timeSig = firstMeasure
      ? `${firstMeasure.timeSignature.numerator}/${firstMeasure.timeSignature.denominator}`
      : '4/4';

    const defaultBpm = payload.timeline.tempoMap.events[0]?.bpm ?? 120;

    const canonicalJSON = CanonicalSerializer.serialize(payload);

    return await this.songService.createSong({
      title: payload.title || options.filename || 'Canción Sin Título',
      artist: options.artist ?? null,
      defaultKey,
      defaultBpm,
      timeSignature: timeSig,
      status: 'APPROVED',
      versionName: options.versionName ?? 'Importación Original',
      versionDescription: `Importado mediante ${result.provenance.importer} v${result.provenance.importerVersion}`,
      sourceFormat: format,
      canonicalPayload: canonicalJSON,
      sourceRecord: {
        filename: options.filename,
        rawContent: options.source,
        importerName: result.provenance.importer,
        importerVersion: result.provenance.importerVersion,
      },
      metadata: options.tags ? { tags: options.tags } : undefined,
    });
  }
}
