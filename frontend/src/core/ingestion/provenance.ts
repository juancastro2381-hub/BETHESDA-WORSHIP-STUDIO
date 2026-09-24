/**
 * @file provenance.ts
 * @description Gestión y construcción de procedencia de importación (SourceProvenance).
 * Rastrea formato de entrada, versión del importador, hash determinista y metadatos sin
 * contaminar la carga canónica musical.
 */

import { type ImportFormat, type SourceProvenance } from './types.ts';

export class ProvenanceManager {
  /**
   * Genera un hash determinista rápido de 32 bits (FNV-1a / DJB2 extendido en hexadecimal)
   * totalmente reproducible en cualquier entorno (Node.js, navegador, Web Worker).
   */
  public static computeHash(content: string): string {
    let hash = 2166136261;
    for (let i = 0; i < content.length; i++) {
      hash ^= content.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
  }

  public static create(params: {
    sourceFormat: ImportFormat;
    sourceName?: string | undefined;
    importer: string;
    importerVersion: string;
    rawContent?: string | undefined;
    inputMetadata?: Record<string, unknown> | undefined;
    capoFret?: number | undefined;
    timestamp?: string | undefined;
  }): SourceProvenance {
    const prov: SourceProvenance = {
      sourceFormat: params.sourceFormat,
      importer: params.importer,
      importerVersion: params.importerVersion,
      importTimestamp: params.timestamp ?? '2026-09-19T00:00:00.000Z',
    };
    if (params.sourceName) prov.sourceName = params.sourceName;
    if (params.rawContent !== undefined) {
      prov.sourceHash = ProvenanceManager.computeHash(params.rawContent);
    }
    if (params.inputMetadata) prov.inputMetadata = { ...params.inputMetadata };
    if (params.capoFret !== undefined) prov.capoFret = params.capoFret;
    return prov;
  }
}
