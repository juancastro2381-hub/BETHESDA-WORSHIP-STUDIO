/**
 * @file real-ingestion-scenarios.test.ts
 * @description Suite completa de pruebas automatizadas para Fase 1H — Real Music Ingestion & Normalization.
 *
 * Categorías requeridas (Paso 14):
 * A. MusicXML parser tests (carga real de disco)
 * B. ChordPro parser tests (carga real de disco)
 * C. Validation tests (códigos estructurados de diagnóstico)
 * D. Normalization tests (resolución a 480 TPQN canónico)
 * E. Canonical payload integrity tests (CanonicalModelValidator)
 * F. Zero invented melody tests (ChordPro produce estrictamente totalMelodyNotes === 0)
 * G. Malformed input tests (detección y reporte sin excepciones no controladas)
 * H. Unsupported feature tests (degradación elegante con avisos de diagnóstico)
 * I. Security/sanitization tests (bloqueo XXE y límite de 5MB)
 * J. Ingestion Scenarios A, B, C, D (flujo completo hasta ProjectionService)
 * K. Import -> Renderer contract tests (AlphaTab, OSMD, LeadSheetDOM)
 * L. Workspace recovery tests (retorno sin fuga de estado a Escenarios Dorados)
 * M. Inmutabilidad canónica estricta (snapshot A === snapshot B)
 */

import assert from 'node:assert';
import { describe, it } from 'node:test';
import { CanonicalModelValidator } from '../../canonical-model/validator.ts';
import { InstrumentRegistry } from '../../projection/instrument-profile.ts';
import { ProjectionService } from '../../projection/projection-service.ts';
import { ViewPreference } from '../../projection/view-preference.ts';
import { AlphaTabAdapter } from '../../rendering/adapters/alphatab-adapter.ts';
import { LeadSheetDomAdapter } from '../../rendering/adapters/leadsheet-dom-adapter.ts';
import { OsmdAdapter } from '../../rendering/adapters/osmd-adapter.ts';
import { RendererRegistry } from '../../rendering/renderer-registry.ts';
import { orchestrateWorkspaceView, transitionApplyPreset } from '../../workspace/workspace-orchestrator.ts';
import { GOLDEN_SCENARIO_PRESETS } from '../../workspace/presets.ts';
import { REAL_FIXTURE_PATHS, loadRealFixture } from '../fixtures/real-files.ts';
import { IngestionService } from '../ingestion-service.ts';
import { IngestionValidator, MAX_SAFE_FILE_SIZE_BYTES } from '../validation.ts';

describe('Phase 1H — Real Music Ingestion & Normalization Tests', () => {
  const service = new IngestionService();
  const instruments = new InstrumentRegistry();
  const renderers = new RendererRegistry();

  // =========================================================================
  // A & D & E. MusicXML Real File Ingestion & Normalization
  // =========================================================================
  it('A & D & E. should parse real MusicXML file, normalize to 480 TPQN and validate canonical model', () => {
    const rawXml = loadRealFixture(REAL_FIXTURE_PATHS.VALID_FULL_SCORE_MUSICXML);
    const result = service.importSource(rawXml, 'valid_full_score.musicxml');

    assert.strictEqual(result.isSuccess, true, 'Import should succeed');
    assert.ok(result.payload, 'Payload must be produced');

    const song = result.payload;
    assert.strictEqual(song.title, 'Sublime Gracia - Himno Canónico');
    assert.strictEqual(song.timeline.tpqn, 480, 'Must normalize to exactly 480 TPQN');
    assert.strictEqual(song.measures.length, 2, 'Must extract exactly 2 measures');

    // Medida 1: Compás 4/4, tonalidad Sol Mayor (G)
    const m1 = song.measures[0]!;
    assert.strictEqual(m1.timeSignature.numerator, 4);
    assert.strictEqual(m1.timeSignature.denominator, 4);
    assert.strictEqual(m1.keySignature.toMusicalKey().tonic.toString(), 'G');

    // Notas de compás 1: G4 (480 ticks = negra), B4 (480 ticks = negra), D5 (960 ticks = blanca)
    const notesM1 = m1.getAllNotes();
    assert.strictEqual(notesM1.length, 3);
    assert.strictEqual(notesM1[0]!.durationTicks, 480);
    assert.strictEqual(notesM1[1]!.durationTicks, 480);
    assert.strictEqual(notesM1[2]!.durationTicks, 960);

    // Letras asociadas al compás 1
    assert.strictEqual(m1.lyrics.length, 3);
    assert.strictEqual(m1.lyrics[0]!.text, 'Sub');
    assert.strictEqual(m1.lyrics[1]!.text, 'li');
    assert.strictEqual(m1.lyrics[2]!.text, 'me');

    // Acordes en compás 1
    assert.strictEqual(m1.chords.length, 2);
    assert.strictEqual(m1.chords[0]!.chord.root.toString(), 'G');
    assert.strictEqual(m1.chords[1]!.chord.root.toString(), 'C');

    // Medida 2: Re 5 (1920 ticks = redonda) con acorde D
    const m2 = song.measures[1]!;
    const notesM2 = m2.getAllNotes();
    assert.strictEqual(notesM2.length, 1);
    assert.strictEqual(notesM2[0]!.durationTicks, 1920);
    assert.strictEqual(m2.lyrics[0]!.text, 'gracia');
    assert.strictEqual(m2.chords[0]!.chord.root.toString(), 'D');

    // Validación exhaustiva de integridad canónica
    const modelValidation = CanonicalModelValidator.validate(song);
    assert.strictEqual(modelValidation.isValid, true);
    assert.strictEqual(modelValidation.errors.length, 0);
  });

  // =========================================================================
  // B & F. ChordPro Real File Ingestion & Zero Invented Melody Invariant
  // =========================================================================
  it('B & F. should parse real ChordPro file and strictly maintain totalMelodyNotes === 0', () => {
    const rawChordPro = loadRealFixture(REAL_FIXTURE_PATHS.VALID_LEAD_SHEET_CHORDPRO);
    const result = service.importSource(rawChordPro, 'valid_lead_sheet.chordpro');

    assert.strictEqual(result.isSuccess, true);
    assert.ok(result.payload);

    const song = result.payload;
    assert.strictEqual(song.title, 'Cuan Grande es Dios');

    // Invariante de oro número 1: CERO notas melódicas inventadas
    const allNotes = song.getAllNotes();
    assert.strictEqual(allNotes.length, 0, 'Must have strictly 0 notes in canonical model');

    // Compases, acordes y secciones presentes
    assert.ok(song.measures.length > 0, 'Must generate valid measure structure');
    const allChords = song.getAllChords();
    assert.ok(allChords.length >= 8, 'Must extract chords');
    assert.ok(song.sections.length >= 2, 'Must parse sections (Estrofa 1, Coro)');

    // Invariante de oro número 2: Al proyectar para Lead Vocal, el totalMelodyNotes permanece 0
    const vocalProfile = instruments.getOrThrow('lead_vocal');
    const vocalPref = new ViewPreference({
      instrumentId: 'lead_vocal',
      primaryRepresentation: 'LYRICS',
      secondaryRepresentations: ['CHORDS'],
    });

    const projection = ProjectionService.project(song, vocalProfile, vocalPref);
    assert.strictEqual(projection.status, 'SUCCESS');
    assert.ok(projection.view);
    assert.strictEqual(projection.view.getAllNotes().length, 0);

    // Paso por el adaptador LeadSheetDOM
    const adapter = new LeadSheetDomAdapter();
    const renderOutput = adapter.render(projection.view);
    assert.strictEqual(renderOutput.success, true);
    assert.strictEqual(renderOutput.data.totalMelodyNotes, 0);
  });

  // =========================================================================
  // G. Malformed Input Tests & Error Reporting
  // =========================================================================
  it('G. should reject malformed MusicXML and report MALFORMED_MUSICXML without throwing uncaught errors', () => {
    const malformedXml = loadRealFixture(REAL_FIXTURE_PATHS.MALFORMED_SYNTAX_MUSICXML);
    const result = service.importSource(malformedXml, 'malformed_syntax.musicxml');

    assert.strictEqual(result.status, 'FAILED');
    assert.strictEqual(result.payload, undefined);
    assert.ok(result.hasErrors);

    const err = result.diagnostics.find((d) => d.code === 'MALFORMED_MUSICXML');
    assert.ok(err, 'Should report MALFORMED_MUSICXML diagnostic');
    assert.strictEqual(err.severity, 'ERROR');
  });

  it('G. should reject malformed ChordPro and report MALFORMED_CHORDPRO or parse warnings gracefully', () => {
    const malformedChordPro = loadRealFixture(REAL_FIXTURE_PATHS.MALFORMED_SYNTAX_CHORDPRO);
    const result = service.importSource(malformedChordPro, 'malformed_syntax.chordpro');

    // Debe o bien fallar con diagnóstico o reportar advertencias de acordes inválidos sin romper
    assert.ok(result.diagnostics.length > 0, 'Must record diagnostic events for broken lines');
    const hasIssues = result.diagnostics.some((d) => d.severity === 'ERROR' || d.severity === 'WARNING');
    assert.strictEqual(hasIssues, true);
  });

  // =========================================================================
  // H. Unsupported Features Tests (Graceful Degradation)
  // =========================================================================
  it('H. should process MusicXML with unsupported elements gracefully without crashing', () => {
    const unsupportedXml = loadRealFixture(REAL_FIXTURE_PATHS.UNSUPPORTED_FEATURES_MUSICXML);
    const result = service.importSource(unsupportedXml, 'unsupported_features.musicxml');

    // El archivo tiene una nota válida D y un bend microtonal; debe procesar las notas soportadas
    assert.strictEqual(result.isSuccess, true);
    assert.ok(result.payload);
    assert.strictEqual(result.payload.measures.length, 1);
  });

  // =========================================================================
  // I. Security Tests: File Size Protection & XXE Entity Injection
  // =========================================================================
  it('I. should reject files exceeding the 5MB safety limit', () => {
    const oversizedString = 'A'.repeat(MAX_SAFE_FILE_SIZE_BYTES + 1024);
    const result = service.importSource(oversizedString, 'huge_file.xml');

    assert.strictEqual(result.status, 'FAILED');
    const err = result.diagnostics.find((d) => d.code === 'INVALID_SOURCE');
    assert.ok(err, 'Must reject oversized file with INVALID_SOURCE');
    assert.ok(err.message.includes('5 MB'));
  });

  it('I. should reject XML containing external entity injection (XXE)', () => {
    const maliciousXml = `<?xml version="1.0"?>
<!DOCTYPE score SYSTEM "file:///etc/passwd" [
  <!ENTITY xxe SYSTEM "file:///etc/shadow">
]>
<score-partwise><work><work-title>&xxe;</work-title></work></score-partwise>`;

    const result = service.importSource(maliciousXml, 'malicious_xxe.xml');
    assert.strictEqual(result.status, 'FAILED');
    const err = result.diagnostics.find((d) => d.code === 'INVALID_SOURCE');
    assert.ok(err);
    assert.ok(err.message.includes('XXE'));
  });

  it('I. should reject empty files with EMPTY_MUSIC_DOCUMENT', () => {
    const emptyResult = service.importSource('   ', 'empty.xml');
    assert.strictEqual(emptyResult.status, 'FAILED');
    const err = emptyResult.diagnostics.find((d) => d.code === 'EMPTY_MUSIC_DOCUMENT');
    assert.ok(err);
  });

  it('I. should reject unsupported file extensions with UNSUPPORTED_FORMAT', () => {
    const binaryPdf = '%PDF-1.4 binary stream...';
    const result = service.importSource(binaryPdf, 'score.pdf');
    assert.strictEqual(result.status, 'FAILED');
    const err = result.diagnostics.find((d) => d.code === 'UNSUPPORTED_FORMAT');
    assert.ok(err);
  });

  // =========================================================================
  // J & K. Ingestion Scenarios A, B, C, D (End-to-End Ingestion -> Renderers)
  // =========================================================================
  it('Ingestion Scenario A: MusicXML -> CanonicalMusicPayload -> Guitar / AlphaTab with Capo 2', () => {
    const rawXml = loadRealFixture(REAL_FIXTURE_PATHS.VALID_FULL_SCORE_MUSICXML);
    const importResult = service.importSource(rawXml, 'valid_full_score.musicxml');
    assert.strictEqual(importResult.isSuccess, true);
    const song = importResult.payload!;

    const guitar = instruments.getOrThrow('acoustic_guitar');
    const prefA = new ViewPreference({
      instrumentId: 'acoustic_guitar',
      primaryRepresentation: 'TABLATURE',
      secondaryRepresentations: ['CHORDS'],
      capoFret: 2,
    });

    const projection = ProjectionService.project(song, guitar, prefA);
    assert.strictEqual(projection.status, 'SUCCESS');
    assert.ok(projection.view);

    // AlphaTab render adapter
    const adapter = new AlphaTabAdapter();
    const renderResult = adapter.render(projection.view);
    assert.strictEqual(renderResult.success, true);
    assert.strictEqual(renderResult.data.capo, 2);
    assert.ok(renderResult.data.tracks.length > 0);
  });

  it('Ingestion Scenario B: MusicXML -> CanonicalMusicPayload -> Piano / OSMD Grand Staff', () => {
    const rawXml = loadRealFixture(REAL_FIXTURE_PATHS.VALID_FULL_SCORE_MUSICXML);
    const importResult = service.importSource(rawXml, 'valid_full_score.musicxml');
    const song = importResult.payload!;

    const piano = instruments.getOrThrow('acoustic_piano');
    const prefB = new ViewPreference({
      instrumentId: 'acoustic_piano',
      primaryRepresentation: 'GRAND_STAFF',
      secondaryRepresentations: ['CHORDS'],
    });

    const projection = ProjectionService.project(song, piano, prefB);
    assert.strictEqual(projection.status, 'SUCCESS');
    assert.ok(projection.view);

    // OSMD render adapter
    const adapter = new OsmdAdapter();
    const renderResult = adapter.render(projection.view);
    assert.strictEqual(renderResult.success, true);
    assert.strictEqual(renderResult.data.stavesCount, 2);
  });

  it('Ingestion Scenario C: MusicXML -> CanonicalMusicPayload -> Alto Sax Eb / OSMD Written Key', () => {
    const rawXml = loadRealFixture(REAL_FIXTURE_PATHS.VALID_FULL_SCORE_MUSICXML);
    const importResult = service.importSource(rawXml, 'valid_full_score.musicxml');
    const song = importResult.payload!;

    const sax = instruments.getOrThrow('alto_sax');
    const prefC = new ViewPreference({
      instrumentId: 'alto_sax',
      primaryRepresentation: 'STANDARD_NOTATION',
    });

    const projection = ProjectionService.project(song, sax, prefC);
    assert.strictEqual(projection.status, 'SUCCESS');
    assert.ok(projection.view);

    // Sol Mayor sonante proyectado a Mi Mayor escrito (+9 semitonos)
    assert.strictEqual(projection.view.concertKey.tonic.toString(), 'G');
    assert.strictEqual(projection.view.writtenKey.tonic.toString(), 'E');

    const adapter = new OsmdAdapter();
    const renderResult = adapter.render(projection.view);
    assert.strictEqual(renderResult.success, true);
    assert.strictEqual(renderResult.data.writtenKeySignature.tonic, 'E');
  });

  it('Ingestion Scenario D: ChordPro -> CanonicalMusicPayload -> Lead Vocal / LeadSheetDOM', () => {
    const rawChordPro = loadRealFixture(REAL_FIXTURE_PATHS.VALID_LEAD_SHEET_CHORDPRO);
    const importResult = service.importSource(rawChordPro, 'valid_lead_sheet.chordpro');
    const song = importResult.payload!;

    const vocal = instruments.getOrThrow('lead_vocal');
    const prefD = new ViewPreference({
      instrumentId: 'lead_vocal',
      primaryRepresentation: 'LYRICS',
      secondaryRepresentations: ['CHORDS'],
    });

    const projection = ProjectionService.project(song, vocal, prefD);
    assert.strictEqual(projection.status, 'SUCCESS');
    assert.ok(projection.view);

    const adapter = new LeadSheetDomAdapter();
    const renderResult = adapter.render(projection.view);
    assert.strictEqual(renderResult.success, true);
    assert.strictEqual(renderResult.data.totalMelodyNotes, 0);
  });

  // =========================================================================
  // M. Strict Canonical Immutability (Snapshot A === Snapshot B)
  // =========================================================================
  it('M. should guarantee CanonicalMusicPayload immutability through multiple projections and renders', () => {
    const rawXml = loadRealFixture(REAL_FIXTURE_PATHS.VALID_FULL_SCORE_MUSICXML);
    const importResult = service.importSource(rawXml, 'valid_full_score.musicxml');
    const song = importResult.payload!;
    const snapshotBefore = JSON.stringify(song);

    // Multi-proyecciones y renderizados repetidos
    const guitar = instruments.getOrThrow('acoustic_guitar');
    const sax = instruments.getOrThrow('alto_sax');
    const piano = instruments.getOrThrow('acoustic_piano');

    const prefGuitar = new ViewPreference({ instrumentId: 'acoustic_guitar', primaryRepresentation: 'TABLATURE', capoFret: 3 });
    const prefSax = new ViewPreference({ instrumentId: 'alto_sax', primaryRepresentation: 'STANDARD_NOTATION', transpositionSemitones: 2 });
    const prefPiano = new ViewPreference({ instrumentId: 'acoustic_piano', primaryRepresentation: 'GRAND_STAFF' });

    const viewGuitar = ProjectionService.project(song, guitar, prefGuitar).view!;
    const viewSax = ProjectionService.project(song, sax, prefSax).view!;
    const viewPiano = ProjectionService.project(song, piano, prefPiano).view!;

    new AlphaTabAdapter().render(viewGuitar);
    new OsmdAdapter().render(viewSax);
    new OsmdAdapter().render(viewPiano);

    const snapshotAfter = JSON.stringify(song);
    assert.strictEqual(snapshotAfter, snapshotBefore, 'CanonicalMusicPayload must remain 100% immutable');
  });

  // =========================================================================
  // L. Workspace Recovery Tests
  // =========================================================================
  it('L. should recover cleanly back to Golden Scenario A after an ingestion failure without side effects', () => {
    // 1. Intento fallido de importar archivo roto
    const brokenXml = loadRealFixture(REAL_FIXTURE_PATHS.MALFORMED_SYNTAX_MUSICXML);
    const failedResult = service.importSource(brokenXml, 'broken.xml');
    assert.strictEqual(failedResult.status, 'FAILED');

    // 2. Restaurar inmediatamente al Escenario Dorado A
    const presetA = GOLDEN_SCENARIO_PRESETS.SCENARIO_A;
    const songA = presetA.canonicalSongFactory();
    const stateA = transitionApplyPreset(presetA);

    const workspaceResult = orchestrateWorkspaceView(songA, stateA, instruments, renderers);
    assert.strictEqual(workspaceResult.isProjectionValid, true);
    assert.strictEqual(workspaceResult.activeRendererId, 'ALPHATAB');
    assert.strictEqual(workspaceResult.state.capoFret, 2);
    assert.strictEqual(workspaceResult.instrumentProfile.id, 'acoustic_guitar');
  });
});
