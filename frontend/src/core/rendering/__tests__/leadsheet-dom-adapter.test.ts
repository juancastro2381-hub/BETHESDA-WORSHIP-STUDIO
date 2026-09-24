/**
 * @file leadsheet-dom-adapter.test.ts
 * @description Pruebas unitarias para el adaptador aislado de LeadSheetDOM.
 */

import assert from 'node:assert';
import { describe, it } from 'node:test';
import { InstrumentRegistry } from '../../projection/instrument-profile.ts';
import { ProjectionService } from '../../projection/projection-service.ts';
import { ViewPreference } from '../../projection/view-preference.ts';
import {
  createCanonicalSongGMajorChordsAndLyricsOnly,
  createCanonicalSongGMajorWithNotes,
} from '../../projection/fixtures/golden-scenarios.ts';
import { LeadSheetDomAdapter } from '../adapters/leadsheet-dom-adapter.ts';

describe('LeadSheetDOM Adapter Tests', () => {
  const instruments = new InstrumentRegistry();

  it('7. should convert DerivedMusicalView to LeadSheetData preserving chord symbols, lyrics and sections', () => {
    const canonicalSong = createCanonicalSongGMajorWithNotes();
    const vocal = instruments.getOrThrow('lead_vocal');

    const pref = new ViewPreference({
      instrumentId: 'lead_vocal',
      primaryRepresentation: 'LYRICS',
      secondaryRepresentations: ['CHORDS', 'SECTION_MARKERS'],
    });

    const derivedView = ProjectionService.project(canonicalSong, vocal, pref).view!;
    const adapter = new LeadSheetDomAdapter();

    const result = adapter.render(derivedView);
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.rendererId, 'LEADSHEET_DOM');

    const leadSheet = result.data;
    assert.strictEqual(leadSheet.title, 'Sublime Gracia (Golden G Major)');
    assert.strictEqual(leadSheet.concertKey, 'G Mayor');
    assert.strictEqual(leadSheet.sections.length, 1);

    const section = leadSheet.sections[0]!;
    assert.strictEqual(section.label, 'Verso 1');
    assert.strictEqual(section.type, 'VERSE');
    assert.strictEqual(section.measures.length, 2);

    // Compás 1 debe tener acordes G y Em con tokens alineados
    const m1 = section.measures[0]!;
    assert.strictEqual(m1.measureNumber, 1);
    assert.strictEqual(m1.chords.length, 2);
    assert.strictEqual(m1.chords[0]!.symbol, 'G');
    assert.strictEqual(m1.chords[1]!.symbol, 'Em');

    const subToken = m1.tokens.find((t) => t.syllable === 'Sub');
    assert.ok(subToken);
    assert.strictEqual(subToken.chord, 'G');
  });

  it('15. should strictly enforce the invariant: ZERO MELODY NOTES REMAIN ZERO MELODY NOTES', () => {
    // Canción proveniente de ChordPro: acordes y letras, sin notas melódicas
    const canonicalLeadSheet = createCanonicalSongGMajorChordsAndLyricsOnly();
    const vocal = instruments.getOrThrow('lead_vocal');

    const pref = new ViewPreference({
      instrumentId: 'lead_vocal',
      primaryRepresentation: 'LYRICS',
      secondaryRepresentations: ['CHORDS'],
    });

    const derivedView = ProjectionService.project(canonicalLeadSheet, vocal, pref).view!;
    const adapter = new LeadSheetDomAdapter();

    const result = adapter.render(derivedView);
    assert.strictEqual(result.success, true);

    // Verificación estricta: totalMelodyNotes = 0
    assert.strictEqual(result.data.totalMelodyNotes, 0);

    // Diagnóstico informativo de preservación sin invención
    const zeroNotesDiag = result.diagnostics.find(
      (d) => d.code === 'ZERO_MELODY_NOTES_PRESERVED'
    );
    assert.ok(zeroNotesDiag, 'Debe emitir diagnóstico confirmando cero notas inventadas');
  });

  it('should support Latin chord notation system in LeadSheetData', () => {
    const canonicalSong = createCanonicalSongGMajorWithNotes();
    const vocal = instruments.getOrThrow('lead_vocal');

    const prefLatin = new ViewPreference({
      instrumentId: 'lead_vocal',
      primaryRepresentation: 'LYRICS',
      secondaryRepresentations: ['CHORDS'],
      chordNotationSystem: 'LATIN',
    });

    const derivedView = ProjectionService.project(canonicalSong, vocal, prefLatin).view!;
    const adapter = new LeadSheetDomAdapter();

    const result = adapter.render(derivedView);
    assert.strictEqual(result.success, true);

    const m1 = result.data.sections[0]!.measures[0]!;
    assert.strictEqual(m1.chords[0]!.symbol, 'Sol');
    assert.strictEqual(m1.chords[1]!.symbol, 'Mim');
  });
});
