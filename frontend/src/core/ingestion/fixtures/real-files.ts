/**
 * @file real-files.ts
 * @description Exportador de rutas absolutas y contenidos de los fixtures reales de disco (Fase 1H).
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FILES_DIR = path.join(__dirname, 'files');

export const REAL_FIXTURE_PATHS = {
  VALID_FULL_SCORE_MUSICXML: path.join(FILES_DIR, 'valid_full_score.musicxml'),
  VALID_LEAD_SHEET_CHORDPRO: path.join(FILES_DIR, 'valid_lead_sheet.chordpro'),
  MALFORMED_SYNTAX_MUSICXML: path.join(FILES_DIR, 'malformed_syntax.musicxml'),
  MALFORMED_SYNTAX_CHORDPRO: path.join(FILES_DIR, 'malformed_syntax.chordpro'),
  EMPTY_DOCUMENT_MUSICXML: path.join(FILES_DIR, 'empty_document.musicxml'),
  UNSUPPORTED_FEATURES_MUSICXML: path.join(FILES_DIR, 'unsupported_features.musicxml'),
};

export function loadRealFixture(filepath: string): string {
  return fs.readFileSync(filepath, 'utf-8');
}
