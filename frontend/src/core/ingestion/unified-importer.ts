/**
 * @file unified-importer.ts
 * @description Fachada unificada de ingesta musical (UnifiedMusicImporter).
 * Detecta automáticamente el formato (MusicXML, ChordPro) y orquesta la normalización
 * hacia CanonicalMusicPayload preservando la independencia total del resto de la aplicación.
 */

import { ChordProImporter } from './chordpro/chordpro-importer.ts';
import { IngestionResult, type MusicImporter } from './importer-contract.ts';
import { MusicXmlImporter } from './musicxml/musicxml-importer.ts';
import { AsciiTabImporter } from '../tablature/ascii-tab-importer.ts';
import { ProvenanceManager } from './provenance.ts';
import { type ImportFormat, type ImportOptions } from './types.ts';

export class UnifiedMusicImporter {
  private readonly _importers: MusicImporter[];

  public constructor(customImporters?: MusicImporter[]) {
    this._importers =
      customImporters ?? [
        new MusicXmlImporter(),
        new ChordProImporter(),
        new AsciiTabImporter(),
      ];
  }

  /**
   * Importa cualquier formato soportado detectándolo de forma automática.
   */
  public import(
    source: string,
    filenameOrOptions?: string | ImportOptions,
    options?: ImportOptions
  ): IngestionResult {
    let filename: string | undefined;
    let effectiveOptions: ImportOptions | undefined;

    if (typeof filenameOrOptions === 'string') {
      filename = filenameOrOptions;
      effectiveOptions = options;
    } else if (filenameOrOptions && typeof filenameOrOptions === 'object') {
      effectiveOptions = filenameOrOptions;
      filename = filenameOrOptions.sourceName;
    }

    if (!source || !source.trim()) {
      return new IngestionResult({
        status: 'FAILED',
        provenance: ProvenanceManager.create({
          sourceFormat: 'CHORD_PRO',
          sourceName: filename,
          importer: 'UnifiedMusicImporter',
          importerVersion: '1.0.0',
        }),
        diagnostics: [
          {
            code: 'EMPTY_SOURCE',
            severity: 'ERROR',
            message: 'El contenido musical proporcionado está vacío.',
          },
        ],
      });
    }

    // Buscar importador compatible
    for (const importer of this._importers) {
      if (importer.canHandle(source, filename)) {
        const opts: ImportOptions = {
          sourceName: filename,
          ...effectiveOptions,
        };
        return importer.import(source, opts);
      }
    }

    // Ningún importador pudo procesarlo
    return new IngestionResult({
      status: 'FAILED',
      provenance: ProvenanceManager.create({
        sourceFormat: 'CHORD_PRO',
        sourceName: filename,
        importer: 'UnifiedMusicImporter',
        importerVersion: '1.0.0',
      }),
      diagnostics: [
        {
          code: 'UNSUPPORTED_FORMAT',
          severity: 'ERROR',
          message: `Formato no soportado para el archivo "${filename ?? 'sin_nombre'}". Se admiten partituras MusicXML 4.0, cifrados ChordPro, documentos PDF e imágenes (PNG, JPG, WEBP, TIFF).`,
        },
      ],
    });
  }

  /**
   * Obtiene un importador específico por su formato.
   */
  public getImporter(format: ImportFormat): MusicImporter | undefined {
    return this._importers.find((imp) => imp.format === format);
  }
}
