/**
 * @file musical-completeness-remediation.test.ts
 * @description Pruebas unitarias enfocadas para los defectos de completitud musical,
 * reconstrucción de sílabas MusicXML, exactitud de tablatura, consistencia de metadatos
 * y retiro de reproducción de audio en la interfaz.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MusicXmlImporter } from '../../ingestion/musicxml/musicxml-importer.ts';
import { LeadSheetDomAdapter } from '../../rendering/adapters/leadsheet-dom-adapter.ts';
import { AlphaTabAdapter } from '../../rendering/adapters/alphatab-adapter.ts';
import { AlphaTexGenerator } from '../../rendering/utils/alphatex-generator.ts';
import { ProjectionService } from '../../projection/projection-service.ts';
import { InstrumentRegistry } from '../../projection/instrument-profile.ts';
import { TablatureCalculator } from '../../projection/tablature-calculator.ts';
import { ViewPreference } from '../../projection/view-preference.ts';
import { Pitch } from '../../music-theory/pitch.ts';
import { NoteName } from '../../music-theory/note-name.ts';
import { CanonicalMusicPayload } from '../../canonical-model/canonical-music-payload.ts';
import { ChordEvent } from '../../canonical-model/chord-event.ts';
import { LyricSyllable } from '../../canonical-model/lyric-syllable.ts';
import { Measure } from '../../canonical-model/measure.ts';
import { Note, Voice } from '../../canonical-model/musical-event.ts';
import { TempoEvent, TempoMap } from '../../canonical-model/tempo-map.ts';
import { Timeline } from '../../canonical-model/timeline.ts';
import { Chord } from '../../music-theory/chord.ts';
import { extractAuthoritativeSongMetadata } from '../canonical-metadata-projection.ts';
import { StandFormatCapabilityResolver } from '../stand-format-capabilities.ts';
import { AudioPlayerBar } from '../../../components/workspace/AudioPlayerBar.tsx';

describe('Musical Content Completeness Remediation & Playback Removal Suite', () => {
  const registry = new InstrumentRegistry();
  const guitar = registry.getOrThrow('acoustic_guitar');
  const bass = registry.getOrThrow('bass');

  it('1. MusicXML importer should ignore non-section <words> (e.g. Moderato), parse <metronome>, and reconstruct syllables in LYRICS_ONLY without chords', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <work><work-title>Tu Luz Me Guía</work-title></work>
  <part-list><score-part id="P1"><part-name>Voz</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>480</divisions>
        <key><fifths>-2</fifths><mode>major</mode></key>
        <time><beats>4</beats><beat-type>4</beat-type></time>
      </attributes>
      <direction><direction-type><words>Moderato</words></direction-type></direction>
      <direction><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>143</per-minute></metronome></direction-type></direction>
      <direction><direction-type><rehearsal>Verso 1</rehearsal></direction-type></direction>
      <harmony><root><root-step>B</root-step><root-alter>-1</root-alter></root><kind>major</kind></harmony>
      <note><pitch><step>F</step><octave>4</octave></pitch><duration>480</duration><voice>1</voice><lyric number="1"><syllabic>single</syllabic><text>Tu</text></lyric></note>
      <note><pitch><step>G</step><octave>4</octave></pitch><duration>480</duration><voice>1</voice><lyric number="1"><syllabic>begin</syllabic><text>gui</text></lyric></note>
      <note><pitch><step>A</step><octave>4</octave></pitch><duration>480</duration><voice>1</voice><lyric number="1"><syllabic>middle</syllabic><text>a</text></lyric></note>
      <note><pitch><step>B</step><alter>-1</alter><octave>4</octave></pitch><duration>480</duration><voice>1</voice><lyric number="1"><syllabic>end</syllabic><text>rás</text></lyric></note>
    </measure>
  </part>
</score-partwise>`;

    const importer = new MusicXmlImporter();
    const res = importer.import(xml, { sourceName: 'Tu_Luz.musicxml' });
    assert.ok(res.payload);
    assert.equal(res.payload.sections.length, 1);
    assert.equal(res.payload.sections[0]?.label, 'Verso 1', 'Moderato no debe convertirse en sección');
    assert.equal(res.payload.timeline.tempoMap.events[0]?.bpm, 143);

    // Proyectar en modo LYRICS_ONLY
    const proj = ProjectionService.project(
      res.payload,
      guitar,
      new ViewPreference({
        instrumentId: guitar.id,
        primaryRepresentation: 'LYRICS',
        secondaryRepresentations: ['SECTION_MARKERS'],
      })
    );
    assert.equal(proj.status, 'SUCCESS');
    assert.ok(proj.view);

    const adapter = new LeadSheetDomAdapter();
    adapter.initialize({ container: {} as unknown as HTMLElement });
    const renderOut = adapter.render(proj.view);
    const data = renderOut.data;
    assert.ok(data);
    assert.equal(data.includeChords, false);
    assert.equal(data.sections[0]?.measures[0]?.chords.length, 0, 'LYRICS_ONLY no debe emitir acordes');
    assert.equal(
      data.sections[0]?.measures[0]?.tokens.every((t) => !t.chord),
      true
    );

    // AlphaTexGenerator debe usar el tempo autoritativo 143, jamás 120 hardcoded
    const tabProj = ProjectionService.project(
      res.payload,
      guitar,
      new ViewPreference({ instrumentId: guitar.id, primaryRepresentation: 'TABLATURE' })
    );
    assert.ok(tabProj.view);
    const tex = AlphaTexGenerator.generate(tabProj.view);
    assert.ok(tex.includes('\\tempo 143'), 'AlphaTex debe usar el tempo autoritativo 143');
    assert.equal(tex.includes('\\tempo 120'), false);
  });

  it('2. TablatureCalculator should maintain neck continuity, avoid simultaneous string collisions, respect bass/guitar limits, and never invent 0.1 for out-of-range notes', () => {
    // E4 (MIDI 64): en posición abierta prefiera cuerda 1 traste 0; pero desde traste 9 (zona media/alta) prefiera cuerda 3 traste 9 o cuerda 2 traste 5 en lugar de saltar a 0
    const e4 = new Pitch(NoteName.E, 4);
    const posFromMidNeck = TablatureCalculator.calculatePosition(e4, guitar.tuning!, 0, 480, 1, {
      previousFret: 9,
      previousString: 2,
    });
    assert.ok(posFromMidNeck);
    assert.notEqual(posFromMidNeck.fret, 0, 'No debe saltar a cuerda al aire 0 desde traste 9');

    // Nota fuera de rango para Bajo (C6 = MIDI 84) -> debe retornar null y NO fabricar 0.1 en AlphaTex/AlphaTab
    const highSong = new CanonicalMusicPayload({
      title: 'Fuera de Rango Bajo',
      timeline: new Timeline({ tpqn: 480, tempoMap: new TempoMap([new TempoEvent(0, 100)]), measureCount: 1, totalDurationTicks: 1920 }),
      measures: [
        new Measure({
          number: 1,
          startTick: 0,
          durationTicks: 1920,
          voices: [
            new Voice(1, [
              new Note({ id: 'out-1', pitch: new Pitch(NoteName.C, 6), startTick: 0, durationTicks: 480, voice: 1 }),
            ]),
          ],
        }),
      ],
    });

    const bassProj = ProjectionService.project(
      highSong,
      bass,
      new ViewPreference({ instrumentId: bass.id, primaryRepresentation: 'TABLATURE' })
    );
    assert.equal(bassProj.status, 'SUCCESS');
    assert.equal(bassProj.view?.measures[0]?.tablature.length, 0);
    assert.ok(bassProj.diagnostics.some((d) => d.code === 'NOTE_OUT_OF_TAB_RANGE'));

    const tex = AlphaTexGenerator.generate(bassProj.view!);
    assert.equal(tex.includes('0.1'), false, 'AlphaTex nunca debe fabricar 0.1 para nota fuera de rango');

    const alphaAdapter = new AlphaTabAdapter();
    alphaAdapter.initialize({ container: {} as unknown as HTMLElement });
    alphaAdapter.render(bassProj.view!);
    assert.ok(alphaAdapter.getDiagnostics().some((d) => d.code === 'TABLATURE_NOTE_OUT_OF_RANGE'));
  });

  it('3. Authoritative metadata projection and PARTIAL lyric coverage gate should never report APPROVED/COMPLETE for sparse lyrics', () => {
    const measures: Measure[] = [];
    for (let i = 1; i <= 20; i++) {
      measures.push(
        new Measure({
          number: i,
          startTick: (i - 1) * 1920,
          durationTicks: 1920,
          chords: [new ChordEvent({ id: `c_${i}`, chord: Chord.parse('Bb'), startTick: (i - 1) * 1920, measureNumber: i })],
          lyrics:
            i <= 2
              ? [new LyricSyllable({ id: `l_${i}`, text: 'Verso', measureNumber: i, tickOffset: 0, sequenceNumber: i })]
              : [],
        })
      );
    }

    const sparseSong = new CanonicalMusicPayload({
      title: 'Cobertura Parcial',
      timeline: new Timeline({ tpqn: 480, tempoMap: new TempoMap([new TempoEvent(0, 143)]), measureCount: 20, totalDurationTicks: 38400 }),
      measures,
      metadata: { isAudioDerived: true, approvalStatus: 'APPROVED' },
    });

    const meta = extractAuthoritativeSongMetadata(sparseSong);
    assert.equal(meta.tempoBpm, 143);
    assert.equal(meta.tempoOrigin, 'AUDIO_DERIVED');
    assert.equal(meta.measuresWithLyrics, 2);

    const caps = StandFormatCapabilityResolver.evaluateAll(sparseSong, guitar, { songStatus: 'APPROVED' });
    assert.equal(caps.CHORD_CHART.availabilityStatus, 'PARTIAL');
    assert.equal(caps.LYRICS_ONLY.availabilityStatus, 'PARTIAL');
  });

  it('4. Audio playback & streaming UI should be removed from user-facing components', () => {
    const renderedBar = renderToStaticMarkup(React.createElement(AudioPlayerBar, { songId: '123e4567-e89b-12d3-a456-426614174000', songTitle: 'Test' }));
    assert.equal(renderedBar, '');

    const rootDir = path.resolve(import.meta.dirname, '../../../components');
    const workspaceSrc = fs.readFileSync(path.join(rootDir, 'workspace/MusicalWorkspace.tsx'), 'utf8');
    const convSrc = fs.readFileSync(path.join(rootDir, 'conversion/ConversionCenterWorkspace.tsx'), 'utf8');
    const offlineSrc = fs.readFileSync(path.join(rootDir, 'offline/OfflineInventoryModal.tsx'), 'utf8');

    assert.equal(workspaceSrc.includes('<AudioPlayerBar'), false);
    assert.equal(workspaceSrc.includes('<DiagnosticPanel'), false, 'DiagnosticPanel no debe renderizarse en la vista de lectura del músico');
    assert.equal(convSrc.includes('<DiagnosticPanel'), true, 'DiagnosticPanel debe permanecer accesible en el centro técnico/administrativo');
    assert.equal(convSrc.includes('<audio'), false);
    assert.equal(offlineSrc.includes('<audio'), false);
  });
});
