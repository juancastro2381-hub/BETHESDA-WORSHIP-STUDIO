/**
 * @file chordpro-adapter.ts
 * @description Adaptador universal para ingesta de archivos ChordPro hacia CanonicalMusicPayload (Fase 1B-R).
 *
 * Principios:
 * 1. Integración con ChordProImporter preservando acordes y texto lírico.
 * 2. Invariante LeadSheet: totalNotes === 0 (CERO notas melódicas inventadas).
 * 3. CERO tonalidad, métrica o tempo inventados si no están declarados en el archivo.
 * 4. Extracción formal de directivas {key}, {time}, {tempo} con valores no resueltos (null) si faltan.
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
  public readonly name = 'Bethesda Universal ChordPro Importer';
  public readonly version = '1.1.0';

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

  public detectMimeType(_buffer: Buffer): string {
    return 'application/x-chordpro';
  }

  public async ingest(input: IngestionInput, _user: AuthenticatedUser): Promise<IngestionOutput> {
    const rawContent = input.rawText || (input.buffer ? input.buffer.toString('utf8') : '');
    if (!rawContent || rawContent.trim().length === 0) {
      throw new ValidationError('El contenido de la canción ChordPro está vacío.');
    }

    const sourceHash = crypto.createHash('sha256').update(rawContent).digest('hex');
    const diagnostics: IngestionDiagnostic[] = [];

    // Parsear sin asumir 'C' por defecto
    const result = this.importer.import(rawContent, {
      sourceName: input.filename,
    });

    if (result.status === 'FAILED' || !result.payload) {
      const errorDiag = (result.diagnostics as IngestionDiagnostic[]).find((d) => d.severity === 'ERROR');
      throw new ValidationError(
        errorDiag?.message || 'Fallo durante el análisis sintáctico del cifrado ChordPro.'
      );
    }

    const payload = result.payload;
    const firstMeasure = payload.measures[0];

    const hasExplicitKey = /\{(?:key|k):\s*([^}]+)\}/i.test(rawContent);
    const hasExplicitTime = /\{(?:time|meter):\s*([^}]+)\}/i.test(rawContent);
    const hasExplicitTempo = /\{(?:tempo|bpm):\s*([^}]+)\}/i.test(rawContent);

    let defaultKey: string | null = null;
    if (hasExplicitKey && firstMeasure?.keySignature) {
      try {
        defaultKey = firstMeasure.keySignature.toMusicalKey().toString();
      } catch {
        defaultKey = null;
      }
    }
    if (!defaultKey) {
      diagnostics.push({
        code: 'MISSING_KEY_SIGNATURE',
        severity: 'INFO',
        message: 'El archivo ChordPro no declara directiva {key:...}; la tonalidad permanece no resuelta (null) para revisión humana.',
      });
    }

    let timeSignature: string | null = null;
    if (hasExplicitTime && firstMeasure?.timeSignature) {
      timeSignature = `${firstMeasure.timeSignature.numerator}/${firstMeasure.timeSignature.denominator}`;
    } else {
      diagnostics.push({
        code: 'MISSING_TIME_SIGNATURE',
        severity: 'INFO',
        message: 'El archivo ChordPro no declara directiva {time:...}; la métrica permanece no resuelta (null) para revisión humana.',
      });
    }

    let defaultBpm: number | null = null;
    if (hasExplicitTempo && payload.timeline.tempoMap.events.length > 0) {
      defaultBpm = payload.timeline.tempoMap.events[0].bpm;
    } else {
      diagnostics.push({
        code: 'MISSING_TEMPO',
        severity: 'INFO',
        message: 'El archivo ChordPro no declara directiva {tempo:...}; el tempo permanece no resuelto (null) para revisión humana.',
      });
    }

    for (const d of (result.diagnostics as IngestionDiagnostic[])) {
      diagnostics.push({
        code: d.code,
        severity: d.severity,
        message: d.message,
        location: d.location,
        context: d.context,
      });
    }

    const isFullyResolved = defaultKey !== null && timeSignature !== null && defaultBpm !== null;
    const status = isFullyResolved ? 'CONVERTED' : 'PARTIALLY_CONVERTED';

    return {
      status,
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
