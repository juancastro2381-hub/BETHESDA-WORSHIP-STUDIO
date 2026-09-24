/**
 * @file index.ts
 * @description Exportación unificada del subsistema de ingesta musical (Phase 1C).
 */

export * from './types.ts';
export * from './diagnostics.ts';
export * from './provenance.ts';
export * from './importer-contract.ts';
export * from './xml/xml-parser.ts';
export * from './musicxml/musicxml-importer.ts';
export * from './chordpro/chordpro-importer.ts';
export * from './unified-importer.ts';
export * from './validation.ts';
export * from './ingestion-service.ts';
export * from './fixtures/golden-fixtures.ts';
