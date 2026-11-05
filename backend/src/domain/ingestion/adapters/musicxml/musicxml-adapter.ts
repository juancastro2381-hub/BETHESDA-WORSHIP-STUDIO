/**
 * @file musicxml-adapter.ts
 * @description Adaptador universal para ingesta de archivos y partituras MusicXML 4.0 hacia CanonicalMusicPayload (Fase 1B).
 */

import crypto from 'node:crypto';
import path from 'node:path';
import { MusicXmlImporter } from '../../../../../../frontend/src/core/ingestion/musicxml/musicxml-importer.ts';
import { XmlParser } from '../../../../../../frontend/src/core/ingestion/xml/xml-parser.ts';
import { ValidationError } from '../../../errors.ts';
import type { AuthenticatedUser } from '../../../auth-types.ts';
import type {
  IIngestionAdapter,
  IngestionDiagnostic,
  IngestionInput,
  IngestionOutput,
} from '../../types.ts';

export class MusicXmlIngestionAdapter implements IIngestionAdapter {
  public readonly sourceType = 'MUSICXML' as const;
  public readonly name = 'Bethesda Universal MusicXML 4.0 Adapter';
  public readonly version = '1.0.0';

  private readonly importer: MusicXmlImporter;

  public constructor() {
    this.importer = new MusicXmlImporter();
  }

  public canHandle(input: IngestionInput): boolean {
    if (input.sourceType === 'MUSICXML') return true;
    if (input.filename) {
      const ext = path.extname(input.filename).toLowerCase();
      if (ext === '.xml' || ext === '.musicxml') return true;
    }

    const content = input.rawText || (input.buffer ? input.buffer.toString('utf8', 0, 500) : '');
    if (content) {
      return (
        content.includes('<score-partwise') ||
        content.includes('<score-timewise') ||
        (content.includes('<?xml') && content.includes('<part-list'))
      );
    }
    return false;
  }

  public detectMimeType(_buffer: Buffer): string {
    return 'application/vnd.recordare.musicxml+xml';
  }

  public async ingest(input: IngestionInput, _user: AuthenticatedUser): Promise<IngestionOutput> {
    const rawContent = input.rawText || (input.buffer ? input.buffer.toString('utf8') : '');
    if (!rawContent || rawContent.trim().length === 0) {
      throw new ValidationError('El contenido de la partitura MusicXML está vacío.');
    }

    // 1. Verificación y rechazo estricto de ataques XXE
    if (/<!ENTITY/i.test(rawContent) || /SYSTEM\s+["']/i.test(rawContent)) {
      throw new ValidationError(
        'Inyección XXE detectada: Bethesda Worship Studio prohíbe el uso de entidades externas en partituras MusicXML.'
      );
    }

    const sourceHash = crypto.createHash('sha256').update(rawContent).digest('hex');
    const diagnostics: IngestionDiagnostic[] = [];

    // 2. Ejecutar importador MusicXML
    const result = this.importer.import(rawContent, {
      sourceName: input.filename,
    });

    if (result.status === 'FAILED' || !result.payload) {
      const errorDiag = (result.diagnostics as IngestionDiagnostic[]).find((d) => d.severity === 'ERROR');
      throw new ValidationError(
        errorDiag?.message || 'Fallo durante el análisis sintáctico de la partitura MusicXML.'
      );
    }

    const payload = result.payload;
    const firstMeasure = payload.measures[0];

    const hasExplicitKey = /<key\b[^>]*>/i.test(rawContent);
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
        message: 'La partitura MusicXML no declara tonalidad explícita; el campo permanece no resuelto (null) para revisión humana.',
      });
    }

    const hasExplicitTime = /<time\b[^>]*>/i.test(rawContent);
    let timeSignature: string | null = null;
    if (hasExplicitTime && firstMeasure?.timeSignature) {
      timeSignature = `${firstMeasure.timeSignature.numerator}/${firstMeasure.timeSignature.denominator}`;
    } else {
      diagnostics.push({
        code: 'MISSING_TIME_SIGNATURE',
        severity: 'INFO',
        message: 'La partitura MusicXML no declara métrica de compás explícita; el campo permanece no resuelto (null) para revisión humana.',
      });
    }

    const hasExplicitTempo =
      /<sound\b[^>]*tempo=/i.test(rawContent) ||
      /<per-minute/i.test(rawContent) ||
      /<metronome/i.test(rawContent);

    const defaultBpm: number | null = hasExplicitTempo
      ? payload.timeline.tempoMap.events[0]?.bpm ?? null
      : null;
    if (defaultBpm === null) {
      diagnostics.push({
        code: 'MISSING_TEMPO',
        severity: 'INFO',
        message: 'La partitura MusicXML no declara marca de tempo BPM; el campo permanece no resuelto (null) para revisión humana.',
      });
    }

    const isFullyResolved = defaultKey !== null && timeSignature !== null && defaultBpm !== null;
    const status = isFullyResolved ? 'CONVERTED' : 'PARTIALLY_CONVERTED';

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
      status,
      sourceType: 'MUSICXML',
      sourceHash,
      filename: input.filename,
      title: payload.title || input.title || 'Partitura MusicXML',
      artist: input.artist || null,
      defaultKey,
      defaultBpm,
      timeSignature,
      canonicalPayload: payload.toJSON(),
      diagnostics,
    };
  }
}
