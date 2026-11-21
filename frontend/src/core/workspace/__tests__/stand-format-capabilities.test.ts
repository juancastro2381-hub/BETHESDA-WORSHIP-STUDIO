/**
 * @file stand-format-capabilities.test.ts
 * @description Suite unitaria de completitud musical y disponibilidad inteligente para los 4 formatos del Atril Digital.
 * Cubre los 10 escenarios obligatorios de la Sección 10 bajo el principio de Cero Fabricación.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { CanonicalMusicPayload } from '../../canonical-model/canonical-music-payload.ts';
import { ChordEvent } from '../../canonical-model/chord-event.ts';
import { LyricSyllable } from '../../canonical-model/lyric-syllable.ts';
import { Measure } from '../../canonical-model/measure.ts';
import { Note, Rest, Voice } from '../../canonical-model/musical-event.ts';
import { TempoEvent, TempoMap } from '../../canonical-model/tempo-map.ts';
import { TimeSignature } from '../../canonical-model/time-signature.ts';
import { Timeline } from '../../canonical-model/timeline.ts';
import { Chord } from '../../music-theory/chord.ts';
import { NoteName } from '../../music-theory/note-name.ts';
import { Pitch } from '../../music-theory/pitch.ts';
import { InstrumentRegistry } from '../../projection/instrument-profile.ts';
import { ProjectionService } from '../../projection/projection-service.ts';
import { ViewPreference } from '../../projection/view-preference.ts';
import { UnifiedMusicImporter } from '../../ingestion/unified-importer.ts';
import { ReadingFormatSelector } from '../../../components/workspace/reading-format-selector-component.ts';
import { StandFormatCapabilityResolver } from '../stand-format-capabilities.ts';
import { resolveEffectiveViewRepresentation } from '../workspace-orchestrator.ts';

function createBaseTimeline(measuresCount: number, tempoBpm = 80): Timeline {
  return new Timeline({
    tpqn: 480,
    tempoMap: new TempoMap([new TempoEvent(0, tempoBpm)]),
    measureCount: measuresCount,
    totalDurationTicks: measuresCount * 1920,
  });
}

describe('Stand Format Capabilities & Zero-Fabrication Completion Rules', () => {
  const registry = new InstrumentRegistry();
  const guitar = registry.getOrThrow('acoustic_guitar');
  const piano = registry.getOrThrow('acoustic_piano');
  const vocal = registry.getOrThrow('lead_vocal');

  it('Scenario 1: Song containing chords only (no lyrics, no melody) keeps all 4 reading formats disabled with CHORDS_AVAILABLE_LYRICS_MISSING', () => {
    const chordOnly = new CanonicalMusicPayload({
      title: 'Solo Progresión Armónica',
      timeline: createBaseTimeline(1),
      measures: [
        new Measure({
          number: 1,
          startTick: 0,
          durationTicks: 1920,
          timeSignature: new TimeSignature(4, 4),
          chords: [
            new ChordEvent({
              id: 'c-1',
              chord: Chord.parse('Em'),
              startTick: 0,
              measureNumber: 1,
              evidenceStatus: 'DETECTED',
            }),
          ],
        }),
      ],
    });

    const evals = StandFormatCapabilityResolver.evaluateAll(chordOnly, guitar, {
      songStatus: 'APPROVED',
    });

    assert.equal(evals.STAFF_NOTATION.isAvailable, false);
    assert.equal(evals.STAFF_NOTATION.availabilityStatus, 'MISSING_CONTENT');
    assert.ok(evals.STAFF_NOTATION.shortRestrictionExplanation.includes('notas melódicas'));

    assert.equal(evals.CHORD_CHART.isAvailable, false);
    assert.equal(evals.CHORD_CHART.availabilityStatus, 'MISSING_CONTENT');
    assert.equal(evals.CHORD_CHART.leadSheetState, 'CHORDS_AVAILABLE_LYRICS_MISSING');
    assert.ok(evals.CHORD_CHART.blockingReason.includes('Faltan las letras'));

    assert.equal(evals.LYRICS_ONLY.isAvailable, false);
    assert.equal(evals.LYRICS_ONLY.availabilityStatus, 'MISSING_CONTENT');

    assert.equal(evals.TABLATURE.isAvailable, false);
    assert.equal(evals.TABLATURE.availabilityStatus, 'MISSING_CONTENT');
    assert.ok(evals.TABLATURE.blockingReason.includes('símbolo de acorde por sí solo no determina'));
  });

  it('Scenario 2: Verified lyrics enable LYRICS_ONLY without enabling PARTITURE/TABLATURE, and distinguish unaligned vs aligned Lead Sheet states', () => {
    const unalignedChordsAndRawLyrics = new CanonicalMusicPayload({
      title: 'Letra Sin Alinear',
      timeline: createBaseTimeline(1),
      measures: [
        new Measure({
          number: 1,
          startTick: 0,
          durationTicks: 1920,
          chords: [new ChordEvent({ id: 'c1', chord: Chord.parse('G'), startTick: 0, measureNumber: 1 })],
        }),
      ],
      metadata: {
        unalignedLyrics: ['Santo es el Señor'],
        lyricAlignmentStatus: 'UNALIGNED',
        lyricsVerifiedByHuman: true,
      },
    });

    const unalignedEvals = StandFormatCapabilityResolver.evaluateAll(unalignedChordsAndRawLyrics, guitar);
    assert.equal(unalignedEvals.CHORD_CHART.isAvailable, false);
    assert.equal(unalignedEvals.CHORD_CHART.availabilityStatus, 'INCOMPLETE');
    assert.equal(unalignedEvals.CHORD_CHART.leadSheetState, 'LYRICS_AVAILABLE_NOT_ALIGNED');
    assert.equal(unalignedEvals.STAFF_NOTATION.isAvailable, false);
    assert.equal(unalignedEvals.TABLATURE.isAvailable, false);

    const lyricsOnlySong = new CanonicalMusicPayload({
      title: 'Letra Verificada Sin Melodía',
      timeline: createBaseTimeline(1),
      measures: [
        new Measure({
          number: 1,
          startTick: 0,
          durationTicks: 1920,
          lyrics: [
            new LyricSyllable({
              id: 'l-1',
              text: 'Digno',
              measureNumber: 1,
              tickOffset: 0,
              sequenceNumber: 1,
            }),
          ],
        }),
      ],
      metadata: { lyricsVerifiedByHuman: true },
    });

    const lyricsEvals = StandFormatCapabilityResolver.evaluateAll(lyricsOnlySong, guitar, {
      songStatus: 'APPROVED',
    });
    assert.equal(lyricsEvals.LYRICS_ONLY.isAvailable, true);
    assert.equal(lyricsEvals.LYRICS_ONLY.availabilityStatus, 'APPROVED');
    assert.equal(lyricsEvals.LYRICS_ONLY.evidenceStatus, 'HUMAN_VERIFIED');
    assert.equal(lyricsEvals.STAFF_NOTATION.isAvailable, false);
    assert.equal(lyricsEvals.TABLATURE.isAvailable, false);
    assert.equal(lyricsEvals.CHORD_CHART.leadSheetState, 'LYRICS_AVAILABLE_CHORDS_MISSING');
  });

  it('Scenario 3: Valid MusicXML score enables PARTITURE and TABLATURE on guitar', () => {
    const validMusicXml = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <work><work-title>Melodía Válida</work-title></work>
  <part-list><score-part id="P1"><part-name>Voz</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>480</divisions>
        <time><beats>4</beats><beat-type>4</beat-type></time>
      </attributes>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>480</duration><type>quarter</type></note>
      <note><pitch><step>E</step><octave>4</octave></pitch><duration>480</duration><type>quarter</type></note>
      <note><pitch><step>G</step><octave>4</octave></pitch><duration>960</duration><type>half</type></note>
    </measure>
  </part>
</score-partwise>`;

    const importer = new UnifiedMusicImporter();
    const res = importer.import(validMusicXml, 'melodia.musicxml');
    assert.ok(res.payload);

    const evals = StandFormatCapabilityResolver.evaluateAll(res.payload, guitar);
    assert.equal(evals.STAFF_NOTATION.isAvailable, true);
    assert.equal(evals.STAFF_NOTATION.availabilityStatus, 'AVAILABLE');
    assert.equal(evals.TABLATURE.isAvailable, true);
    assert.ok((evals.TABLATURE.tablatureSummary?.totalNotes ?? 0) === 3);
    assert.equal(evals.LYRICS_ONLY.isAvailable, false);
  });

  it('Scenario 4: Song with valid MIDI note events enables PARTITURE and TABLATURE while keeping lyric formats disabled when lyrics=0', () => {
    const midiDerived = new CanonicalMusicPayload({
      title: 'Secuencia MIDI Con Notas',
      timeline: createBaseTimeline(1, 100),
      measures: [
        new Measure({
          number: 1,
          startTick: 0,
          durationTicks: 1920,
          timeSignature: new TimeSignature(4, 4),
          voices: [
            new Voice(1, [
              new Note({
                id: 'midi-1',
                pitch: new Pitch(NoteName.E, 4),
                startTick: 0,
                durationTicks: 960,
                voice: 1,
              }),
              new Note({
                id: 'midi-2',
                pitch: new Pitch(NoteName.G, 4),
                startTick: 960,
                durationTicks: 960,
                voice: 1,
              }),
            ]),
          ],
        }),
      ],
      metadata: { contentOrigin: 'IMPORTED' },
    });

    const evals = StandFormatCapabilityResolver.evaluateAll(midiDerived, guitar);
    assert.equal(evals.STAFF_NOTATION.isAvailable, true);
    assert.equal(evals.TABLATURE.isAvailable, true);
    assert.equal(evals.LYRICS_ONLY.isAvailable, false);
    assert.equal(evals.CHORD_CHART.isAvailable, false);
  });

  it('Scenario 5: Song with ambiguous musical evidence enforces REVIEW_REQUIRED without auto-enabling', () => {
    const ambiguous = new CanonicalMusicPayload({
      title: 'Evidencia Ambigua',
      timeline: createBaseTimeline(1),
      measures: [
        new Measure({
          number: 1,
          startTick: 0,
          durationTicks: 1920,
          voices: [
            new Voice(1, [
              new Note({
                id: 'amb-n1',
                pitch: new Pitch(NoteName.A, 3),
                startTick: 0,
                durationTicks: 960,
                voice: 1,
              }),
            ]),
          ],
          chords: [
            new ChordEvent({
              id: 'amb-c1',
              chord: Chord.parse('Am'),
              startTick: 0,
              measureNumber: 1,
              evidenceStatus: 'AMBIGUOUS',
              alternativeSymbol: 'C',
            }),
          ],
          lyrics: [
            new LyricSyllable({
              id: 'amb-l1',
              text: 'Aleluya',
              measureNumber: 1,
              tickOffset: 0,
              sequenceNumber: 1,
            }),
          ],
        }),
      ],
      metadata: {
        noteExtractionStatus: 'AMBIGUOUS',
        lyricsSource: 'UNVERIFIED_AUDIO_SPEECH',
        lyricsVerifiedByHuman: false,
      },
    });

    const evals = StandFormatCapabilityResolver.evaluateAll(ambiguous, guitar, {
      songStatus: 'DRAFT',
    });
    assert.equal(evals.STAFF_NOTATION.isAvailable, false);
    assert.equal(evals.STAFF_NOTATION.availabilityStatus, 'REVIEW_REQUIRED');
    assert.equal(evals.STAFF_NOTATION.evidenceStatus, 'AMBIGUOUS');
    assert.equal(evals.LYRICS_ONLY.isAvailable, false);
    assert.equal(evals.LYRICS_ONLY.availabilityStatus, 'REVIEW_REQUIRED');
    assert.equal(evals.CHORD_CHART.isAvailable, false);
    assert.equal(evals.CHORD_CHART.reviewRequired, true);
  });

  it('Scenario 6: Notes present without instrument tuning disable TABLATURE cleanly', () => {
    const score = new CanonicalMusicPayload({
      title: 'Melodía Para Piano',
      timeline: createBaseTimeline(1),
      measures: [
        new Measure({
          number: 1,
          startTick: 0,
          durationTicks: 1920,
          voices: [
            new Voice(1, [
              new Note({
                id: 'pn-1',
                pitch: new Pitch(NoteName.C, 4),
                startTick: 0,
                durationTicks: 480,
                voice: 1,
              }),
            ]),
          ],
        }),
      ],
    });

    const pianoEvals = StandFormatCapabilityResolver.evaluateAll(score, piano);
    assert.equal(pianoEvals.STAFF_NOTATION.isAvailable, true);
    assert.equal(pianoEvals.TABLATURE.isAvailable, false);
    assert.equal(pianoEvals.TABLATURE.availabilityStatus, 'MISSING_CONTENT');
    assert.ok(pianoEvals.TABLATURE.missingContent.some((m) => m.includes('afinación')));

    const vocalEvals = StandFormatCapabilityResolver.evaluateAll(score, vocal);
    assert.equal(vocalEvals.TABLATURE.isAvailable, false);
  });

  it('Scenario 7: Complete content in DRAFT awaiting human approval reports REVIEW_REQUIRED / PENDING_REVIEW', () => {
    const completeDraft = new CanonicalMusicPayload({
      title: 'Borrador Completo',
      timeline: createBaseTimeline(1),
      measures: [
        new Measure({
          number: 1,
          startTick: 0,
          durationTicks: 1920,
          voices: [
            new Voice(1, [
              new Note({
                id: 'dr-1',
                pitch: new Pitch(NoteName.E, 4),
                startTick: 0,
                durationTicks: 1920,
                voice: 1,
              }),
            ]),
          ],
          chords: [new ChordEvent({ id: 'dc-1', chord: Chord.parse('E'), startTick: 0, measureNumber: 1 })],
          lyrics: [
            new LyricSyllable({
              id: 'dl-1',
              text: 'Gloria',
              measureNumber: 1,
              tickOffset: 0,
              sequenceNumber: 1,
            }),
          ],
        }),
      ],
      metadata: { approvalStatus: 'DRAFT_REVIEW_REQUIRED' },
    });

    const evals = StandFormatCapabilityResolver.evaluateAll(completeDraft, guitar, {
      songStatus: 'DRAFT',
      pendingProposalFormats: ['STAFF_NOTATION', 'TABLATURE'],
    });
    assert.equal(evals.STAFF_NOTATION.availabilityStatus, 'REVIEW_REQUIRED');
    assert.equal(evals.STAFF_NOTATION.approvalStatus, 'PENDING_REVIEW');
    assert.equal(evals.STAFF_NOTATION.reviewRequired, true);
    assert.equal(evals.CHORD_CHART.leadSheetState, 'LYRICS_ALIGNED_AWAITING_REVIEW');
  });

  it('Scenario 8: Approved song unlocks formats AND ProjectionService honors verified note-to-tablature position overrides', () => {
    // E4 (MIDI 64): en Guitarra estándar es Cuerda 1 Traste 0, o Cuerda 2 Traste 5
    const approvedWithOverride = new CanonicalMusicPayload({
      title: 'Obra Aprobada Con Digitación',
      timeline: createBaseTimeline(1),
      measures: [
        new Measure({
          number: 1,
          startTick: 0,
          durationTicks: 1920,
          voices: [
            new Voice(1, [
              new Note({
                id: 'ov-1',
                pitch: new Pitch(NoteName.E, 4),
                startTick: 0,
                durationTicks: 1920,
                voice: 1,
                notationMetadata: {
                  tablature: {
                    stringNumber: 2,
                    fret: 5,
                    isHumanOverride: true,
                  },
                },
              }),
            ]),
          ],
        }),
      ],
      metadata: { approvalStatus: 'APPROVED', tablatureVerified: true },
    });

    const evals = StandFormatCapabilityResolver.evaluateAll(approvedWithOverride, guitar, {
      songStatus: 'APPROVED',
    });
    assert.equal(evals.STAFF_NOTATION.availabilityStatus, 'APPROVED');
    assert.equal(evals.TABLATURE.availabilityStatus, 'APPROVED');
    assert.equal(evals.TABLATURE.evidenceStatus, 'HUMAN_VERIFIED');
    assert.equal(evals.TABLATURE.tablatureSummary?.humanVerifiedPositionsCount, 1);

    const proj = ProjectionService.project(
      approvedWithOverride,
      guitar,
      new ViewPreference({
        instrumentId: guitar.id,
        primaryRepresentation: 'TABLATURE',
      })
    );
    assert.equal(proj.status, 'SUCCESS');
    const tabPos = proj.view?.measures[0]?.tablature[0];
    assert.ok(tabPos);
    assert.equal(tabPos.stringNumber, 2, 'Debe respetar la cuerda 2 verificada en notationMetadata');
    assert.equal(tabPos.fret, 5, 'Debe respetar el traste 5 verificado en notationMetadata');
  });

  it('Scenario 9: Saved preferred format stays preserved when unavailable and renders clear explanation without bypassing restrictions', () => {
    const chordOnly = new CanonicalMusicPayload({
      title: 'Canción Sin Partitura',
      timeline: createBaseTimeline(1),
      measures: [
        new Measure({
          number: 1,
          startTick: 0,
          durationTicks: 1920,
          chords: [new ChordEvent({ id: 'p-c1', chord: Chord.parse('C'), startTick: 0, measureNumber: 1 })],
          lyrics: [
            new LyricSyllable({
              id: 'p-l1',
              text: 'Santo',
              measureNumber: 1,
              tickOffset: 0,
              sequenceNumber: 1,
            }),
          ],
        }),
      ],
    });

    const effective = resolveEffectiveViewRepresentation(chordOnly, guitar, 'STANDARD_NOTATION', []);
    assert.equal(effective.isFallbackApplied, true);
    assert.equal(effective.primaryRepresentation, 'CHORDS');

    const html = renderToStaticMarkup(
      React.createElement(ReadingFormatSelector, {
        song: chordOnly,
        instrumentProfile: guitar,
        primaryRepresentation: effective.primaryRepresentation,
        secondaryRepresentations: effective.secondaryRepresentations,
        userPreferences: {
          userId: 'u1',
          instrumentId: 'acoustic_guitar',
          primaryRepresentation: 'STANDARD_NOTATION',
          secondaryRepresentations: [],
          chordNotationSystem: 'STANDARD',
          transpositionSemitones: 0,
          capoFret: 0,
          clefOverride: null,
          preferFlats: false,
        },
        isAuthenticated: true,
        onSelectFormat: () => {},
        onOpenCompletionWorkflow: () => {},
      })
    );

    assert.ok(html.includes('preferred-vs-available-banner'));
    assert.ok(html.includes('Formato preferido conservado'));
    assert.ok(html.includes('reading-format-completion-actions'));
  });

  it('Scenario 10: Rejects malformed XML and rests-only / chord-only notation from enabling PARTITURE', () => {
    const importer = new UnifiedMusicImporter();
    const malformedRes = importer.import('<not-musicxml><foo/></not-musicxml>', 'invalid.xml');
    assert.equal(malformedRes.status, 'FAILED');

    const restsOnly = new CanonicalMusicPayload({
      title: 'Solo Silencios',
      timeline: createBaseTimeline(1),
      measures: [
        new Measure({
          number: 1,
          startTick: 0,
          durationTicks: 1920,
          voices: [new Voice(1, [new Rest({ id: 'r-1', startTick: 0, durationTicks: 1920, voice: 1 })])],
        }),
      ],
    });

    const evals = StandFormatCapabilityResolver.evaluateAll(restsOnly, guitar);
    assert.equal(evals.STAFF_NOTATION.isAvailable, false);
    assert.equal(evals.TABLATURE.isAvailable, false);
  });
});
