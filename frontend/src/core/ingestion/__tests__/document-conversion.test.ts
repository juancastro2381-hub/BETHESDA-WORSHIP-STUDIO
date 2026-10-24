/**
 * @file document-conversion.test.ts
 * @description Suite de pruebas automatizadas para el pipeline de conversión de documentos visuales
 * (cancioneros de texto, PDFs e imágenes) hacia los 4 formatos de atril digital de Bethesda Worship Studio.
 *
 * Principios y restricciones verificadas:
 * 1. Conversión determinista de texto Chord-over-Text hacia formato canónico ChordPro.
 * 2. CERO invención de compases o notas melódicas: Si el documento no posee pentagramas o notas,
 *    la Partitura Completa (SHEET_MUSIC) debe ser declarada BLOQUEADA con explicación transparente.
 * 3. Habilitación de Cifrado con Letra (CHORDS_WITH_LYRICS) y Letra Sola (LYRICS_ONLY).
 * 4. Detección y discriminación de tablaturas ASCII y diagramas de acordes (chord voicings).
 * 5. Detección de acordes, tonalidad y filtrado de ruido institucional.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  ChordSheetConverter,
  GUITAR_CHORD_VOICINGS,
} from '../conversion/chord-sheet-converter.ts';
import {
  FormatEvaluator,
  type DocumentSourceAnalysis,
} from '../conversion/format-evaluator.ts';
import {
  isChordToken,
  isChordLine,
  isTabLine,
  isNoiseLine,
  parseSongsFromRawText,
} from '../conversion/pdf-chord-extractor.ts';

describe('Document Conversion & Format Evaluator Suite (Phase B Ingestion -> Digital Stand)', () => {
  const sampleChordOverText = [
    'RENUEVAME (Marcos Witt)',
    'Tono: D',
    '',
    'Intro: D  G  A  D',
    '',
    'D         G    A         D',
    'Renuévame Señor Jesús',
    'G          Em          A',
    'Ya no quiero ser igual',
    'D         G    A         D',
    'Renuévame Señor Jesús',
    'G          Em          A',
    'Pon en mí tu corazón',
    '',
    'Coro:',
    '       D          F#m       Bm    A',
    'Porque todo lo que hay dentro de mí',
    'G        Em        A',
    'Necesita ser cambiado Señor',
    '       D          F#m       Bm    A',
    'Porque todo lo que hay dentro de mi corazón',
    'G        A         D',
    'Necesita más de Ti',
  ];

  it('1. should detect chord tokens, chord lines, and noise lines accurately', () => {
    // Tokens
    assert.strictEqual(isChordToken('D'), true);
    assert.strictEqual(isChordToken('F#m'), true);
    assert.strictEqual(isChordToken('Bb7'), true);
    assert.strictEqual(isChordToken('Cadd9'), true);
    assert.strictEqual(isChordToken('G/B'), true);
    assert.strictEqual(isChordToken('Renuévame'), false);
    assert.strictEqual(isChordToken('Señor'), false);

    // Chord lines
    assert.strictEqual(isChordLine('D         G    A         D'), true);
    assert.strictEqual(isChordLine('       D          F#m       Bm    A'), true);
    assert.strictEqual(isChordLine('Renuévame Señor Jesús'), false);

    // Tablature line
    assert.strictEqual(isTabLine('e|---0-2-3---|'), true);
    assert.strictEqual(isTabLine('G---2-4-5---|'), true);
    assert.strictEqual(isTabLine('Renuévame Señor Jesús'), false);

    // Noise lines
    assert.strictEqual(isNoiseLine('CENTRO MISIONERO BETHESDA'), true);
    assert.strictEqual(isNoiseLine('MINISTERIO DE ALABANZA'), true);
    assert.strictEqual(isNoiseLine('42'), true);
    assert.strictEqual(isNoiseLine('RENUEVAME'), false);
  });

  it('2. should convert Chord-over-Text to valid ChordPro format deterministically', () => {
    const result = ChordSheetConverter.convert(sampleChordOverText);

    assert.strictEqual(result.title, 'RENUEVAME');
    assert.strictEqual(result.artist, 'Marcos Witt');
    assert.strictEqual(result.key, 'D');

    // ChordPro output should embed chords within brackets inline with lyrics
    assert.ok(result.chordPro.includes('{title: RENUEVAME}'));
    assert.ok(result.chordPro.includes('{artist: Marcos Witt}'));
    assert.ok(result.chordPro.includes('[D]'));
    assert.ok(result.chordPro.includes('[G]'));
    assert.ok(result.chordPro.includes('[A]'));
    assert.ok(result.chordPro.includes('[F#m]'));

    // Unique chords should include D, G, A, Em, F#m, Bm
    assert.ok(result.uniqueChords.includes('D'));
    assert.ok(result.uniqueChords.includes('G'));
    assert.ok(result.uniqueChords.includes('A'));
    assert.ok(result.uniqueChords.includes('Em'));
    assert.ok(result.uniqueChords.includes('F#m'));
    assert.ok(result.uniqueChords.includes('Bm'));

    // Guitar voicings should have fret patterns for detected chords
    assert.ok(result.chordVoicings.length >= 4);
    const dVoicing = result.chordVoicings.find((v) => v.chord === 'D');
    assert.ok(dVoicing);
    assert.strictEqual(dVoicing?.fretPattern, GUITAR_CHORD_VOICINGS.D?.fretPattern);

    // Lyrics-only output should NOT contain chord brackets or chord lines
    assert.ok(!result.lyricsOnly.includes('[D]'));
    assert.ok(!result.lyricsOnly.includes('[G]'));
    assert.ok(result.lyricsOnly.includes('Renuévame Señor Jesús'));
    assert.ok(result.lyricsOnly.includes('Necesita más de Ti'));

    // Warnings should be empty on valid conversion
    assert.strictEqual(result.warnings.length, 0);
  });

  it('3. should enforce Musical Truth Invariants in FormatEvaluator (Zero fake melodic notes/staves)', () => {
    // Caso: Documento tipo cancionero (texto o PDF raster con acordes y letra, pero sin pentagramas)
    const chordSheetSource: DocumentSourceAnalysis = {
      sourceFormat: 'PDF',
      hasStavesAndNotes: false,
      hasChords: true,
      hasLyrics: true,
      hasAsciiTablature: false,
    };

    const evaluation = FormatEvaluator.evaluateAll(chordSheetSource);

    // 1. Partitura tradicional DEBE estar BLOQUEADA
    assert.strictEqual(evaluation.SHEET_MUSIC.status, 'BLOCKED_INSUFFICIENT_DATA');
    assert.strictEqual(evaluation.SHEET_MUSIC.isSelectable, false);
    assert.ok(
      evaluation.SHEET_MUSIC.explanation.includes('pentagramas') ||
      evaluation.SHEET_MUSIC.explanation.includes('notas melódicas'),
      'Must explain why sheet music is blocked'
    );

    // 2. Cifrado con Letra DEBE estar DISPONIBLE
    assert.strictEqual(evaluation.CHORDS_WITH_LYRICS.status, 'AVAILABLE');
    assert.strictEqual(evaluation.CHORDS_WITH_LYRICS.isSelectable, true);

    // 3. Letra Sola DEBE estar DISPONIBLE
    assert.strictEqual(evaluation.LYRICS_ONLY.status, 'AVAILABLE');
    assert.strictEqual(evaluation.LYRICS_ONLY.isSelectable, true);

    // 4. Tablatura: disponible con aviso de diagramas o bloqueada para transcripción nota a nota
    assert.ok(
      evaluation.TABLATURE.status === 'AVAILABLE_WITH_NOTICE' ||
      evaluation.TABLATURE.status === 'BLOCKED_INSUFFICIENT_DATA'
    );
  });

  it('4. should enable SHEET_MUSIC when document source possesses melodic staves and notes', () => {
    const fullScoreSource: DocumentSourceAnalysis = {
      sourceFormat: 'MUSIC_XML',
      hasStavesAndNotes: true,
      hasChords: true,
      hasLyrics: true,
      hasAsciiTablature: false,
    };

    const evaluation = FormatEvaluator.evaluateAll(fullScoreSource);

    assert.strictEqual(evaluation.SHEET_MUSIC.status, 'AVAILABLE');
    assert.strictEqual(evaluation.SHEET_MUSIC.isSelectable, true);
    assert.strictEqual(evaluation.CHORDS_WITH_LYRICS.status, 'AVAILABLE');
    assert.strictEqual(evaluation.LYRICS_ONLY.status, 'AVAILABLE');
  });

  it('5. should segment raw text into multiple song candidates with parseSongsFromRawText', () => {
    const multiSongRaw = `
DIOS INCOMPARABLE (Generación 12)
Tono: G

G        D
Dios de mi corazón
Em       C
En ti encontré mi salvación

CUAN GRANDE ES DIOS (Chris Tomlin)
Tono: C

C        Am
El esplendor de un Rey
F        G
Vestido en Majestad
`;

    const songs = parseSongsFromRawText(multiSongRaw, 'Cancionero');

    assert.ok(songs.length >= 2, 'Should detect at least 2 distinct songs');
    const song1 = songs[0]!;
    const song2 = songs[1]!;

    assert.ok(song1.title.includes('DIOS INCOMPARABLE'));
    assert.strictEqual(song1.detectedKey, 'G');
    assert.strictEqual(song1.hasChords, true);

    assert.ok(song2.title.includes('CUAN GRANDE ES DIOS'));
    assert.strictEqual(song2.detectedKey, 'C');
    assert.strictEqual(song2.hasChords, true);
  });

  it('6. should handle empty document lines safely and yield non-crashing fallback structure', () => {
    const emptyResult = ChordSheetConverter.convert([]);

    assert.strictEqual(emptyResult.title, 'Canción Vacía');
    assert.strictEqual(emptyResult.key, 'C');
    assert.strictEqual(emptyResult.uniqueChords.length, 0);
    assert.strictEqual(emptyResult.chordVoicings.length, 0);
    assert.strictEqual(emptyResult.warnings.length, 1);
  });
});
