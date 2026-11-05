/**
 * @file chordpro-adapter.ts
 * @description Adaptador universal para ingesta de cancioneros y cifrados ChordPro hacia CanonicalMusicPayload (Fase 1B).
 */

import crypto from 'node:crypto';
import path from 'node:path';
import { ChordProImporter } from '../../../../../../frontend/src/core/ingestion/chordpro/chordpro-importer.ts';
import { ValidationError } from '../../../errors.ts';
import type { AuthenticatedUser } from '../../../auth-types.ts';
import type {
  IIngestionAdapter,
  IngestionDiagnostic,
  IngestionInput,
  IngestionOutput,
} from '../../types.ts';

export class ChordProIngestionAdapter implements IIngestionAdapter {
  public readonly sourceType = 'CHORDPRO' as const;
  public readonly name = 'Bethesda Universal ChordPro Adapter';
  public readonly version = '1.0.0';

  private readonly importer: ChordProImporter;

  public constructor() {
    this.importer = new ChordProImporter();
  }

  public canHandle(input: IngestionInput): boolean {
    if (input.sourceType === 'CHORDPRO') return true;
    if (input.filename) {
      const ext = path.extname(input.filename).toLowerCase();
      if (['.cho', '.chopro', '.chordpro', '.pro', '.crd'].includes(ext)) return true;
    }

    const content = input.rawText || (input.buffer ? input.buffer.toString('utf8', 0, 500) : '');
    if (content) {
      return (
        content.includes('{title:') ||
        content.includes('{t:') ||
        content.includes('{artist:') ||
        content.includes('{key:') ||
        content.includes('{soc}') ||
        /\[[A-G][b#]?[^\]]*\]/.test(content)
      );
    }
    return false;
  }

  public async ingest(input: IngestionInput, _user: AuthenticatedUser): Promise<IngestionOutput> {
    const rawContent = input.rawText || (input.buffer ? input.buffer.toString('utf8') : '');
    if (!rawContent || rawContent.trim().length === 0) {
      throw new ValidationError('El contenido de la canción ChordPro está vacío.');
    }

    const sourceHash = crypto.createHash('sha256').update(rawContent).digest('hex');
    const diagnostics: IngestionDiagnostic[] = [];

    const result = this.importer.import(rawContent, {
      sourceName: input.filename,
      defaultKey: input.title ? undefined : 'C',
    });

    if (result.status === 'FAILED' || !result.payload) {
      const errorDiag = (result.diagnostics as IngestionDiagnostic[]).find((d) => d.severity === 'ERROR');
      throw new ValidationError(
        errorDiag?.message || 'Fallo durante el análisis sintáctico del cifrado ChordPro.'
      );
    }

    const payload = result.payload;
    const firstMeasure = payload.measures[0];

    const defaultKey = firstMeasure
      ? firstMeasure.keySignature.toMusicalKey().toString()
      : 'C Major';

    const timeSignature = firstMeasure
      ? `${firstMeasure.timeSignature.numerator}/${firstMeasure.timeSignature.denominator}`
      : '4/4';

    const defaultBpm = payload.timeline.tempoMap.events[0]?.bpm ?? 120;

    for (const d of (result.diagnostics as IngestionDiagnostic[])) {
      diagnostics.push({
        code: d.code,
        severity: d.severity,
        message: d.message,
        location: d.location,
        context: d.context,
      });
    }

    return {
      status: 'PARSED',
      sourceType: 'CHORDPRO',
      sourceHash,
      filename: input.filename,
      title: payload.title || input.title || 'Canción Cifrada ChordPro',
      artist: input.artist || null,
      defaultKey,
      defaultBpm,
      timeSignature,
      canonicalPayload: payload.toJSON(),
      diagnostics,
    };
  }
}
