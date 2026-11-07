/**
 * @file conversion-engine.ts
 * @description Orquestador unificado de conversiones de Bethesda Worship Studio (Fase 2A).
 *
 * Coordina la ingesta de fuentes heterogéneas hacia el modelo canónico (CanonicalMusicPayload),
 * la validación de compatibilidad (FormatCapabilitiesEvaluator) y la serialización hacia
 * formatos de salida estándar (MusicXML, MIDI, ChordPro, Solo Letra).
 */

import { CanonicalMusicPayload } from '../canonical-model/canonical-music-payload.ts';
import { UnifiedMusicImporter } from '../ingestion/unified-importer.ts';
import { FormatCapabilitiesEvaluator } from './format-capabilities.ts';
import {
  CanonicalToChordProSerializer,
  CanonicalToLyricsSerializer,
  CanonicalToMidiSerializer,
  CanonicalToMusicXmlSerializer,
} from './exporters/index.ts';
import {
  type ConversionDiagnostic,
  type ConversionExportResult,
  type ConversionOptions,
} from './types.ts';

export class ConversionEngine {
  private readonly _importer: UnifiedMusicImporter;

  public constructor(customImporter?: UnifiedMusicImporter) {
    this._importer = customImporter ?? new UnifiedMusicImporter();
  }

  /**
   * Convierte un archivo musical en crudo (texto o buffer) hacia el formato objetivo solicitado.
   */
  public convertSource(
    source: string,
    filename: string,
    options: ConversionOptions
  ): ConversionExportResult {
    const sourceCategory = FormatCapabilitiesEvaluator.detectSourceCategory(filename, source);

    // 1. Verificar si la fuente corresponde a categorías diferidas para Fase 2B
    if (
      sourceCategory === 'AUDIO_RECORDING' ||
      sourceCategory === 'VIDEO_REFERENCE' ||
      sourceCategory === 'PDF_SCORE' ||
      sourceCategory === 'IMAGE_SCORE'
    ) {
      return {
        success: false,
        targetFormat: options.targetFormat,
        filename: this.buildOutputFilename(filename, options.targetFormat),
        mimeType: 'text/plain',
        content: '',
        diagnostics: [
          {
            code: 'SOURCE_CATEGORY_DEFERRED_PHASE',
            severity: 'ERROR',
            message: `La fuente de tipo "${sourceCategory}" requiere transcripción de audio (Demucs/Basic Pitch) u OMR (Audiveris) diferidos formalmente para Fase 2B.`,
          },
        ],
      };
    }

    // 2. Ingesta hacia CanonicalMusicPayload
    const ingestionResult = this._importer.import(source, filename);

    if (ingestionResult.status === 'FAILED' || !ingestionResult.payload) {
      return {
        success: false,
        targetFormat: options.targetFormat,
        filename: this.buildOutputFilename(filename, options.targetFormat),
        mimeType: 'text/plain',
        content: '',
        diagnostics: ingestionResult.diagnostics.map((d) => ({
          code: d.code,
          severity: d.severity,
          message: d.message,
        })),
      };
    }

    // 3. Serializar desde el CanonicalMusicPayload
    const exportResult = this.convertPayload(ingestionResult.payload, options);

    // Agregar diagnósticos de ingesta a los de exportación
    const combinedDiagnostics: ConversionDiagnostic[] = [
      ...ingestionResult.diagnostics.map((d) => ({
        code: d.code,
        severity: d.severity,
        message: d.message,
      })),
      ...exportResult.diagnostics,
    ];

    return {
      ...exportResult,
      diagnostics: combinedDiagnostics,
    };
  }

  /**
   * Serializa directamente un CanonicalMusicPayload hacia el formato objetivo solicitado.
   */
  public convertPayload(
    payload: CanonicalMusicPayload,
    options: ConversionOptions
  ): ConversionExportResult {
    const target = options.targetFormat;

    switch (target) {
      case 'MUSIC_XML':
        return CanonicalToMusicXmlSerializer.serialize(payload);

      case 'MIDI':
        return CanonicalToMidiSerializer.serialize(payload);

      case 'CHORD_PRO':
        return CanonicalToChordProSerializer.serialize(payload);

      case 'LYRICS_ONLY':
        return CanonicalToLyricsSerializer.serialize(payload);

      case 'ENGRAVED_PDF':
        return {
          success: false,
          targetFormat: 'ENGRAVED_PDF',
          filename: `${this.sanitizeFilename(payload.title)}.pdf`,
          mimeType: 'application/pdf',
          content: new Uint8Array(0),
          canonicalPayload: payload,
          diagnostics: [
            {
              code: 'ENGRAVED_PDF_DEFERRED_PHASE',
              severity: 'ERROR',
              message:
                'El grabado visual a PDF mediante headless Chromium o VexFlow server-side está programado para Fase 2B. En Fase 2A utilice exportación MusicXML para abrir e imprimir en software de notación.',
            },
          ],
        };

      case 'TABLATURE':
        return {
          success: false,
          targetFormat: 'TABLATURE',
          filename: `${this.sanitizeFilename(payload.title)}.tab`,
          mimeType: 'text/plain',
          content: '',
          canonicalPayload: payload,
          diagnostics: [
            {
              code: 'TABLATURE_DEFERRED_PHASE',
              severity: 'ERROR',
              message:
                'El cálculo polifónico de digitaciones óptimas de tablatura está programado para Fase 2B.',
            },
          ],
        };

      default:
        return {
          success: false,
          targetFormat: target,
          filename: 'conversion_error.txt',
          mimeType: 'text/plain',
          content: '',
          canonicalPayload: payload,
          diagnostics: [
            {
              code: 'UNSUPPORTED_TARGET_FORMAT',
              severity: 'ERROR',
              message: `El formato de destino solicitado "${target}" no está soportado.`,
            },
          ],
        };
    }
  }

  private buildOutputFilename(inputFilename: string, targetFormat: ConversionOptions['targetFormat']): string {
    const base = inputFilename.replace(/\.[^.]+$/, '') || 'conversion';
    const extMap: Record<string, string> = {
      MUSIC_XML: '.musicxml',
      MIDI: '.mid',
      CHORD_PRO: '.cho',
      LYRICS_ONLY: '_letra.txt',
      ENGRAVED_PDF: '.pdf',
      TABLATURE: '.tab',
    };
    return `${base}${extMap[targetFormat] ?? '.txt'}`;
  }

  private sanitizeFilename(title: string): string {
    return title.toLowerCase().replace(/[^a-z0-9_-]/g, '_').replace(/_+/g, '_').slice(0, 50) || 'conversion';
  }
}
