/**
 * @file validation.ts
 * @description Módulo de validación previa y seguridad para la ingesta musical (Fase 1H).
 *
 * Aplica:
 * - Protección contra fuentes sobredimensionadas (límite por defecto: 5MB).
 * - Detección estricta de formato por extensión y firmas de contenido.
 * - Prevención de ataques XML (XXE, entidades externas, bombas de expansión).
 * - Códigos estructurados de diagnóstico de ingesta.
 */

import { type Diagnostic, type ImportFormat } from './types.ts';

export const MAX_SAFE_FILE_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB para archivos estructurados (MusicXML, ChordPro)
export const MAX_DOCUMENT_FILE_SIZE_BYTES = 15 * 1024 * 1024; // 15 MB para documentos visuales (PDF, imágenes)

export interface SourceValidationResult {
  readonly valid: boolean;
  readonly format?: ImportFormat | undefined;
  readonly diagnostic?: Diagnostic | undefined;
}

export class IngestionValidator {
  /**
   * Detecta el formato del archivo o contenido provisto.
   */
  public static detectFormat(source: string, filename?: string): ImportFormat | 'UNKNOWN' {
    if (filename) {
      const lower = filename.toLowerCase();
      if (lower.endsWith('.xml') || lower.endsWith('.musicxml')) {
        return 'MUSIC_XML';
      }
      if (
        lower.endsWith('.chordpro') ||
        lower.endsWith('.chopro') ||
        lower.endsWith('.pro') ||
        lower.endsWith('.crd')
      ) {
        return 'CHORD_PRO';
      }
      if (lower.endsWith('.pdf')) {
        return 'PDF';
      }
      if (
        lower.endsWith('.png') ||
        lower.endsWith('.jpg') ||
        lower.endsWith('.jpeg') ||
        lower.endsWith('.webp') ||
        lower.endsWith('.tiff') ||
        lower.endsWith('.tif')
      ) {
        return 'IMAGE';
      }
    }

    const trimmed = source.trim();

    // Detección por contenido MusicXML
    if (
      trimmed.includes('<score-partwise') ||
      trimmed.includes('<score-timewise') ||
      (trimmed.includes('<?xml') && trimmed.includes('<part-list'))
    ) {
      return 'MUSIC_XML';
    }

    // Detección por contenido ChordPro: directivas o acordes entre corchetes
    const hasChordProDirectives = /\{(title|t|subtitle|st|c|comment|key|tempo|capo|soc|eoc|sov|eov|sob|eob):/i.test(trimmed);
    const hasBracketChords = /\[[A-G][b#]?[^\]]*\]/.test(trimmed);
    if (hasChordProDirectives || hasBracketChords) {
      return 'CHORD_PRO';
    }

    return 'UNKNOWN';
  }

  /**
   * Valida la fuente antes de procesarla para garantizar seguridad, tamaño y estructura básica.
   */
  public static validateSource(
    source: string,
    filename?: string,
    sizeBytes?: number
  ): SourceValidationResult {
    // 1. Verificación de formato y tamaño seguro
    const detected = IngestionValidator.detectFormat(source, filename);
    const maxAllowed =
      detected === 'PDF' || detected === 'IMAGE'
        ? MAX_DOCUMENT_FILE_SIZE_BYTES
        : MAX_SAFE_FILE_SIZE_BYTES;

    const effectiveSize = sizeBytes ?? new TextEncoder().encode(source).length;
    if (effectiveSize > maxAllowed) {
      const maxMb = (maxAllowed / (1024 * 1024)).toFixed(0);
      return {
        valid: false,
        format: detected !== 'UNKNOWN' ? detected : undefined,
        diagnostic: {
          code: 'INVALID_SOURCE',
          severity: 'ERROR',
          message: `El archivo excede el tamaño máximo permitido de ${maxMb} MB (tamaño recibido: ${(effectiveSize / (1024 * 1024)).toFixed(2)} MB).`,
          context: { effectiveSize, maxAllowed, filename },
        },
      };
    }

    // 2. Verificación de contenido vacío
    const trimmed = source.trim();
    if (!trimmed) {
      return {
        valid: false,
        diagnostic: {
          code: 'EMPTY_MUSIC_DOCUMENT',
          severity: 'ERROR',
          message: 'El archivo o contenido musical seleccionado está vacío.',
          context: { filename },
        },
      };
    }

    // 3. Verificación de seguridad XML / XXE
    if (/<!ENTITY/i.test(trimmed) || /SYSTEM\s+["']/i.test(trimmed)) {
      return {
        valid: false,
        diagnostic: {
          code: 'INVALID_SOURCE',
          severity: 'ERROR',
          message: 'Seguridad: Se rechazó el archivo por contener definiciones de entidades externas XML (XXE prohibido).',
          context: { filename },
        },
      };
    }

    // 4. Detección de formato
    const format = IngestionValidator.detectFormat(trimmed, filename);
    if (format === 'UNKNOWN') {
      return {
        valid: false,
        diagnostic: {
          code: 'UNSUPPORTED_FORMAT',
          severity: 'ERROR',
          message: `Formato de archivo no soportado para "${filename ?? 'archivo'}". Formatos válidos: MusicXML (.musicxml, .xml) y ChordPro (.chordpro, .pro, .crd).`,
          context: { filename },
        },
      };
    }

    return {
      valid: true,
      format,
    };
  }
}
