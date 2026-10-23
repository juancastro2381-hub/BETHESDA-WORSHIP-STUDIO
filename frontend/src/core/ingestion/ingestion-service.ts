/**
 * @file ingestion-service.ts
 * @description Fachada de alto nivel para el subsistema de ingesta y normalización musical (Fase 1H).
 *
 * Responsabilidades:
 * 1. Validación previa de seguridad y límites de archivo mediante IngestionValidator.
 * 2. Ingesta determinista y delegación a importadores especializados (MusicXML, ChordPro).
 * 3. Normalización estricta hacia CanonicalMusicPayload a 480 TPQN.
 * 4. Mapeo estructurado de diagnósticos (MALFORMED_MUSICXML, MALFORMED_CHORDPRO, EMPTY_MUSIC_DOCUMENT, etc.).
 * 5. Soporte de ingesta de archivos desde el navegador (File API).
 * 6. Garantizar que el modelo canónico producido es la única fuente de verdad y permanece inmutable.
 */

import { CanonicalMusicPayload } from '../canonical-model/canonical-music-payload.ts';
import { Timeline } from '../canonical-model/timeline.ts';
import { CanonicalModelValidator } from '../canonical-model/validator.ts';
import { IngestionResult } from './importer-contract.ts';
import { ProvenanceManager } from './provenance.ts';
import { type ImportOptions, type IngestionStatus } from './types.ts';
import { UnifiedMusicImporter } from './unified-importer.ts';
import { IngestionValidator, MAX_SAFE_FILE_SIZE_BYTES, MAX_DOCUMENT_FILE_SIZE_BYTES } from './validation.ts';

export class IngestionService {
  private readonly unifiedImporter: UnifiedMusicImporter;

  public constructor(customImporter?: UnifiedMusicImporter) {
    this.unifiedImporter = customImporter ?? new UnifiedMusicImporter();
  }

  /**
   * Importa contenido musical desde una cadena de texto o contenido de archivo.
   */
  public importSource(source: string, filename?: string, options?: ImportOptions): IngestionResult {
    // 1. Validación previa de seguridad, tamaño y formato
    const validation = IngestionValidator.validateSource(source, filename);
    if (!validation.valid && validation.diagnostic) {
      return new IngestionResult({
        status: 'FAILED',
        provenance: ProvenanceManager.create({
          sourceFormat: validation.format ?? 'CHORD_PRO',
          sourceName: filename,
          importer: 'IngestionService',
          importerVersion: '1.0.0',
        }),
        diagnostics: [validation.diagnostic],
      });
    }

    try {
      // 2. Delegar a UnifiedMusicImporter
      const result = this.unifiedImporter.import(source, filename, options);

      // Si falló el parser, revisar si fue error de sintaxis XML o ChordPro para asegurar diagnósticos canónicos
      if (result.status === 'FAILED') {
        const diagnostics = result.diagnostics.map((d) => {
          if (
            validation.format === 'MUSIC_XML' &&
            (d.code === 'XML_PARSE_ERROR' ||
              d.code === 'INVALID_ROOT_ELEMENT' ||
              d.code === 'MUSICXML_PARSING_FAILED')
          ) {
            return {
              ...d,
              code: 'MALFORMED_MUSICXML',
            };
          }
          if (
            validation.format === 'CHORD_PRO' &&
            (d.code === 'CHORDPRO_PARSE_ERROR' ||
              d.code === 'INVALID_DIRECTIVE' ||
              d.code === 'CHORDPRO_PARSING_FAILED')
          ) {
            return {
              ...d,
              code: 'MALFORMED_CHORDPRO',
            };
          }
          return d;
        });

        return new IngestionResult({
          status: 'FAILED',
          provenance: result.provenance,
          diagnostics,
        });
      }

      // 3. Si produjo un payload, validar que el documento no esté completamente vacío de compases
      if (result.payload) {
        if (result.payload.measures.length === 0) {
          return new IngestionResult({
            status: 'FAILED',
            provenance: result.provenance,
            diagnostics: [
              ...result.diagnostics,
              {
                code: 'EMPTY_MUSIC_DOCUMENT',
                severity: 'ERROR',
                message: 'El documento musical importado no contiene compases válidos.',
              },
            ],
          });
        }

        // 4. Validación de integridad del modelo canónico
        const modelValidation = CanonicalModelValidator.validate(result.payload);
        if (!modelValidation.isValid) {
          const validationDiagnostics = modelValidation.errors.map((err) => ({
            code: 'NORMALIZATION_FAILED',
            severity: 'ERROR' as const,
            message: `Error de integridad en el modelo canónico normalizado: ${err}`,
          }));

          return new IngestionResult({
            status: 'FAILED',
            provenance: result.provenance,
            diagnostics: [...result.diagnostics, ...validationDiagnostics],
          });
        }
      }

      return result;
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      const isXml = validation.format === 'MUSIC_XML';

      return new IngestionResult({
        status: 'FAILED',
        provenance: ProvenanceManager.create({
          sourceFormat: validation.format ?? 'CHORD_PRO',
          sourceName: filename,
          importer: 'IngestionService',
          importerVersion: '1.0.0',
        }),
        diagnostics: [
          {
            code: isXml ? 'MALFORMED_MUSICXML' : 'MALFORMED_CHORDPRO',
            severity: 'ERROR',
            message: `Fallo durante el procesamiento del archivo: ${errorMsg}`,
          },
        ],
      });
    }
  }

  /**
   * Importa un archivo File provisto por la API del navegador (drag-and-drop o input file).
   */
  public async importBrowserFile(file: File, options?: ImportOptions): Promise<IngestionResult> {
    const detectedFormat = IngestionValidator.detectFormat('', file.name);
    const isVisualDoc = detectedFormat === 'PDF' || detectedFormat === 'IMAGE';
    const maxLimit = isVisualDoc ? MAX_DOCUMENT_FILE_SIZE_BYTES : MAX_SAFE_FILE_SIZE_BYTES;

    if (file.size > maxLimit) {
      const maxMb = (maxLimit / (1024 * 1024)).toFixed(0);
      return new IngestionResult({
        status: 'FAILED',
        provenance: ProvenanceManager.create({
          sourceFormat: detectedFormat !== 'UNKNOWN' ? detectedFormat : 'CHORD_PRO',
          sourceName: file.name,
          importer: 'IngestionService',
          importerVersion: '1.0.0',
        }),
        diagnostics: [
          {
            code: 'INVALID_SOURCE',
            severity: 'ERROR',
            message: `El archivo "${file.name}" excede el límite máximo permitido de ${maxMb} MB (${(file.size / (1024 * 1024)).toFixed(2)} MB).`,
            context: { filename: file.name, size: file.size, limit: maxLimit },
          },
        ],
      });
    }

    // Si es un documento visual (PDF o imagen raster), generar resultado de atril visual sin fabricar notas
    if (isVisualDoc) {
      const baseName = file.name.replace(/\.[^/.]+$/, '');
      const timeline = new Timeline({
        totalDurationTicks: 0,
        measureCount: 0,
      });

      const payload = new CanonicalMusicPayload({
        title: baseName || 'Partitura Visual',
        timeline,
        measures: [],
        sections: [],
        instrumentTracks: [],
        metadata: {
          isVisualOnly: true,
          sourceFormat: detectedFormat,
          filename: file.name,
          mimeType: file.type || (detectedFormat === 'PDF' ? 'application/pdf' : 'image/png'),
        },
      });

      return new IngestionResult({
        status: 'SUCCESS',
        provenance: ProvenanceManager.create({
          sourceFormat: detectedFormat,
          sourceName: file.name,
          importer: 'IngestionService',
          importerVersion: '1.0.0',
          inputMetadata: {
            isVisualOnly: true,
            fileSize: file.size,
            mimeType: file.type || (detectedFormat === 'PDF' ? 'application/pdf' : 'image/png'),
          },
        }),
        diagnostics: [],
        payload,
      });
    }

    try {
      const content = await file.text();
      return this.importSource(content, file.name, options);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return new IngestionResult({
        status: 'FAILED',
        provenance: ProvenanceManager.create({
          sourceFormat: 'CHORD_PRO',
          sourceName: file.name,
          importer: 'IngestionService',
          importerVersion: '1.0.0',
        }),
        diagnostics: [
          {
            code: 'INVALID_SOURCE',
            severity: 'ERROR',
            message: `No se pudo leer el archivo "${file.name}": ${msg}`,
          },
        ],
      });
    }
  }
}
