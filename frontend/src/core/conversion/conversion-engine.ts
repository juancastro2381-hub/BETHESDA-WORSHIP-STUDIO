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
import { ConversionTransformer } from './conversion-transformer.ts';
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

    // 1. Fail-closed: Formatos no soportados o desconocidos
    if (sourceCategory === 'UNKNOWN_UNSUPPORTED') {
      return {
        success: false,
        targetFormat: options.targetFormat,
        filename: this.buildOutputFilename(filename, options.targetFormat),
        mimeType: 'text/plain',
        content: '',
        diagnostics: [
          {
            code: 'UNKNOWN_OR_UNSUPPORTED_FORMAT',
            severity: 'ERROR',
            message: `El archivo "${filename}" no es un formato musical soportado o su contenido no contiene datos de notación musical válidos. Se rechaza por fail-closed format validation.`,
          },
        ],
      };
    }

    // 2. Verificar si la fuente corresponde a categorías diferidas para Fase 2B o no soportadas
    if (
      sourceCategory === 'AUDIO_RECORDING' ||
      sourceCategory === 'VIDEO_REFERENCE' ||
      sourceCategory === 'PDF_SCORE' ||
      sourceCategory === 'IMAGE_SCORE' ||
      sourceCategory === 'TABLATURE_ASCII'
    ) {
      const isTab = sourceCategory === 'TABLATURE_ASCII';
      return {
        success: false,
        targetFormat: options.targetFormat,
        filename: this.buildOutputFilename(filename, options.targetFormat),
        mimeType: 'text/plain',
        content: '',
        diagnostics: [
          {
            code: isTab ? 'TABLATURE_INGESTION_UNSUPPORTED' : 'SOURCE_CATEGORY_DEFERRED_PHASE',
            severity: 'ERROR',
            message: isTab
              ? 'La ingesta y conversión directa de tablaturas ASCII (.tab) no está soportada en esta versión. El motor de tablatura está planificado para la Fase 2B.'
              : `La fuente de tipo "${sourceCategory}" requiere transcripción de audio (Demucs/Basic Pitch) u OMR (Audiveris) diferidos formalmente para Fase 2B.`,
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
   * Serializa directamente un CanonicalMusicPayload hacia el formato objetivo solicitado,
   * aplicando de forma fidedigna opciones de transposición y anulaciones (CR-04 & CR-05).
   */
  public convertPayload(
    payload: CanonicalMusicPayload,
    options: ConversionOptions
  ): ConversionExportResult {
    const target = options.targetFormat;

    // Aplicar opciones de transposición y anulación armónica (CR-04)
    const { payload: transformedPayload, diagnostics: transformDiagnostics } =
      ConversionTransformer.applyOptions(payload, options);

    // Si la transformación produjo errores críticos (ej. nota transpuesta fuera de rango MIDI 0-127), fallar con diagnósticos
    const hasTransformErrors = transformDiagnostics.some((d) => d.severity === 'ERROR');
    if (hasTransformErrors) {
      return {
        success: false,
        targetFormat: target,
        filename: this.buildOutputFilename(payload.title, target),
        mimeType: 'text/plain',
        content: '',
        canonicalPayload: payload,
        diagnostics: transformDiagnostics,
      };
    }

    let result: ConversionExportResult;

    switch (target) {
      case 'MUSIC_XML':
        result = CanonicalToMusicXmlSerializer.serialize(transformedPayload);
        break;

      case 'MIDI':
        result = CanonicalToMidiSerializer.serialize(transformedPayload);
        break;

      case 'CHORD_PRO':
        result = CanonicalToChordProSerializer.serialize(transformedPayload);
        break;

      case 'LYRICS_ONLY':
        result = CanonicalToLyricsSerializer.serialize(transformedPayload);
        break;

      case 'ENGRAVED_PDF':
        result = {
          success: false,
          targetFormat: 'ENGRAVED_PDF',
          filename: `${this.sanitizeFilename(transformedPayload.title)}.pdf`,
          mimeType: 'application/pdf',
          content: new Uint8Array(0),
          canonicalPayload: transformedPayload,
          diagnostics: [
            {
              code: 'ENGRAVED_PDF_DEFERRED_PHASE',
              severity: 'ERROR',
              message:
                'El grabado visual a PDF mediante headless Chromium o VexFlow server-side está programado para Fase 2B. En Fase 2A utilice exportación MusicXML para abrir e imprimir en software de notación.',
            },
          ],
        };
        break;

      case 'TABLATURE':
        result = {
          success: false,
          targetFormat: 'TABLATURE',
          filename: `${this.sanitizeFilename(transformedPayload.title)}.tab`,
          mimeType: 'text/plain',
          content: '',
          canonicalPayload: transformedPayload,
          diagnostics: [
            {
              code: 'TABLATURE_DEFERRED_PHASE',
              severity: 'ERROR',
              message:
                'El cálculo polifónico de digitaciones óptimas de tablatura está programado para Fase 2B.',
            },
          ],
        };
        break;

      default:
        result = {
          success: false,
          targetFormat: target,
          filename: 'conversion_error.txt',
          mimeType: 'text/plain',
          content: '',
          canonicalPayload: transformedPayload,
          diagnostics: [
            {
              code: 'UNSUPPORTED_TARGET_FORMAT',
              severity: 'ERROR',
              message: `El formato de destino solicitado "${target}" no está soportado.`,
            },
          ],
        };
        break;
    }

    return {
      canonicalPayload: transformedPayload,
      ...result,
      diagnostics: [...transformDiagnostics, ...result.diagnostics],
    };
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
