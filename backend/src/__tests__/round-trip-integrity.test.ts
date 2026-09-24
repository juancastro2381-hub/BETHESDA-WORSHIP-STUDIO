/**
 * @file round-trip-integrity.test.ts
 * @description Prueba arquitectónica obligatoria de integridad Round-Trip (Fase 2A, Paso 20).
 *
 * Verifica el ciclo completo:
 * Archivo Real (MusicXML / ChordPro)
 *   ↓
 * IngestionService (Fase 1H)
 *   ↓
 * CanonicalMusicPayload A
 *   ↓
 * Persistencia en PostgreSQL (Drizzle)
 *   ↓
 * Carga desde Base de Datos
 *   ↓
 * CanonicalDeserializer
 *   ↓
 * CanonicalMusicPayload B
 *   ↓
 * ProjectionService (Fase 1D)
 *   ↓
 * DerivedMusicalView
 *
 * Invariantes verificados:
 * 1. A y B son semánticamente idénticos (título, tonalidad, métrica, compases, notas, acordes, letras, secciones).
 * 2. Para ChordPro: totalMelodyNotes se mantiene ESTRICTAMENTE en 0 en el modelo, en la base de datos y tras la proyección.
 * 3. Proyección exitosa para diversos instrumentos desde el modelo recuperado de persistencia.
 */

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert';
import { pool } from '../db/index.ts';
import { runMigrations } from '../db/migrate.ts';
import { DrizzleSongRepository } from '../repositories/song-repository.ts';
import { DrizzleSongVersionRepository } from '../repositories/version-repository.ts';
import { SongService } from '../application/song-service.ts';
import { IngestionPersistenceService } from '../application/ingestion-persistence-service.ts';
import { CanonicalDeserializer } from '../domain/canonical-serializer.ts';
import {
  loadRealFixture,
  REAL_FIXTURE_PATHS,
} from '../../../frontend/src/core/ingestion/fixtures/real-files.ts';
import {
  ProjectionService,
  InstrumentRegistry,
  ViewPreference,
} from '../../../frontend/src/core/projection/index.ts';
import { CanonicalMusicPayload } from '../../../frontend/src/core/canonical-model/index.ts';

describe('Phase 2A — Round-Trip Persistence & Invariant Integrity Tests', () => {
  const songRepo = new DrizzleSongRepository();
  const versionRepo = new DrizzleSongVersionRepository();
  const songService = new SongService(songRepo, versionRepo);
  const ingestionPersistence = new IngestionPersistenceService(songService);
  const instruments = new InstrumentRegistry();

  before(async () => {
    await runMigrations();
  });

  after(async () => {
    await pool.end();
  });

  // =========================================================================
  // 1. Round-Trip MusicXML Real File
  // =========================================================================
  it('should guarantee 100% Round-Trip fidelity for real MusicXML file', async () => {
    const rawXml = loadRealFixture(REAL_FIXTURE_PATHS.VALID_FULL_SCORE_MUSICXML);

    // 1. Ingestar y persistir directamente en PostgreSQL
    const persisted = await ingestionPersistence.importAndPersist({
      source: rawXml,
      filename: 'valid_full_score.musicxml',
      artist: 'John Newton',
      tags: ['himno', 'clasico'],
    });

    assert.ok(persisted.song.id);
    assert.ok(persisted.version.id);

    // 2. Recuperar desde la base de datos
    const loaded = await songService.getSong(persisted.song.id);
    assert.ok(loaded);
    assert.strictEqual(loaded.song.id, persisted.song.id);

    // 3. Deserializar hacia el modelo de dominio CanonicalMusicPayload
    const payloadB = CanonicalDeserializer.deserialize(loaded.version.canonicalPayload);
    assert.ok(payloadB instanceof CanonicalMusicPayload);

    // 4. Verificación de equivalencia semántica estricta
    assert.strictEqual(payloadB.title, 'Sublime Gracia - Himno Canónico');
    assert.strictEqual(payloadB.timeline.tpqn, 480);
    assert.strictEqual(payloadB.measures.length, 2);

    // Compás 1
    const m1 = payloadB.measures[0]!;
    assert.strictEqual(m1.timeSignature.numerator, 4);
    assert.strictEqual(m1.timeSignature.denominator, 4);
    assert.strictEqual(m1.keySignature.toMusicalKey().tonic.toString(), 'G');

    const notesM1 = m1.getAllNotes();
    assert.strictEqual(notesM1.length, 3);
    assert.strictEqual(notesM1[0]!.durationTicks, 480);
    assert.strictEqual(notesM1[1]!.durationTicks, 480);
    assert.strictEqual(notesM1[2]!.durationTicks, 960);

    assert.strictEqual(m1.lyrics.length, 3);
    assert.strictEqual(m1.lyrics[0]!.text, 'Sub');
    assert.strictEqual(m1.lyrics[1]!.text, 'li');
    assert.strictEqual(m1.lyrics[2]!.text, 'me');

    assert.strictEqual(m1.chords.length, 2);
    assert.strictEqual(m1.chords[0]!.chord.root.toString(), 'G');
    assert.strictEqual(m1.chords[1]!.chord.root.toString(), 'C');

    // Compás 2
    const m2 = payloadB.measures[1]!;
    const notesM2 = m2.getAllNotes();
    assert.strictEqual(notesM2.length, 1);
    assert.strictEqual(notesM2[0]!.durationTicks, 1920);
    assert.strictEqual(m2.lyrics[0]!.text, 'gracia');
    assert.strictEqual(m2.chords[0]!.chord.root.toString(), 'D');

    // 5. Verificación de Proyección desde el modelo recuperado de PostgreSQL:
    // Proyección a Piano (Grand Staff)
    const pianoProfile = instruments.getOrThrow('acoustic_piano');
    const pianoPref = new ViewPreference({
      instrumentId: 'acoustic_piano',
      primaryRepresentation: 'GRAND_STAFF',
    });
    const pianoProjection = ProjectionService.project(payloadB, pianoProfile, pianoPref);
    assert.strictEqual(pianoProjection.status, 'SUCCESS');
    assert.ok(pianoProjection.view);

    // Proyección a Saxofón Alto (Eb) con transposición de 9 semitonos
    const saxProfile = instruments.getOrThrow('alto_sax');
    const saxPref = new ViewPreference({
      instrumentId: 'alto_sax',
      primaryRepresentation: 'STANDARD_NOTATION',
    });
    const saxProjection = ProjectionService.project(payloadB, saxProfile, saxPref);
    assert.strictEqual(saxProjection.status, 'SUCCESS');
    assert.ok(saxProjection.view);
  });

  // =========================================================================
  // 2. Round-Trip ChordPro Real File & Zero Invented Melody Invariant
  // =========================================================================
  it('should guarantee 100% Round-Trip fidelity for ChordPro and maintain totalMelodyNotes === 0', async () => {
    const rawChordPro = loadRealFixture(REAL_FIXTURE_PATHS.VALID_LEAD_SHEET_CHORDPRO);

    // 1. Ingestar y persistir en PostgreSQL
    const persisted = await ingestionPersistence.importAndPersist({
      source: rawChordPro,
      filename: 'valid_lead_sheet.chordpro',
      artist: 'Chris Tomlin',
    });

    assert.strictEqual(persisted.version.sourceFormat, 'CHORD_PRO');
    assert.strictEqual(persisted.version.totalNotes, 0, 'Relational totalNotes must be exactly 0');

    // 2. Cargar desde PostgreSQL
    const loaded = await songService.getSong(persisted.song.id);
    const payloadB = CanonicalDeserializer.deserialize(loaded.version.canonicalPayload);

    // 3. INVARIANTE FUNDAMENTAL: totalMelodyNotes permanece ESTRICTAMENTE en 0
    const allNotes = payloadB.getAllNotes();
    assert.strictEqual(allNotes.length, 0, 'Canonical model recovered from database must have exactly 0 notes');

    // Compases, acordes y secciones preservadas
    assert.ok(payloadB.measures.length > 0);
    assert.ok(payloadB.getAllChords().length >= 8);
    assert.ok(payloadB.sections.length >= 2);

    // 4. Proyección a Voz Principal (Lead Vocal) desde el modelo recuperado de BD
    const vocalProfile = instruments.getOrThrow('lead_vocal');
    const vocalPref = new ViewPreference({
      instrumentId: 'lead_vocal',
      primaryRepresentation: 'LYRICS',
      secondaryRepresentations: ['CHORDS'],
    });

    const projection = ProjectionService.project(payloadB, vocalProfile, vocalPref);
    assert.strictEqual(projection.status, 'SUCCESS');
    assert.ok(projection.view);
    assert.strictEqual(
      projection.view.getAllNotes().length,
      0,
      'Projected view from persisted ChordPro must have exactly 0 notes'
    );
  });
});
