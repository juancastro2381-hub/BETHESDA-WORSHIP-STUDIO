/**
 * @file musicxml-importer.ts
 * @description Importador determinista de MusicXML 4.0 hacia CanonicalMusicPayload.
 * Normaliza divisions a 480 TPQN, preserva polifonía de voces, acordes, ligaduras y sílabas líricas.
 */

import { CanonicalMusicPayload } from '../../canonical-model/canonical-music-payload.ts';
import { ChordEvent } from '../../canonical-model/chord-event.ts';
import { InstrumentTrack } from '../../canonical-model/instrument-track.ts';
import { KeySignatureReference } from '../../canonical-model/key-signature-reference.ts';
import { LyricSyllable } from '../../canonical-model/lyric-syllable.ts';
import { Measure } from '../../canonical-model/measure.ts';
import { Note, Rest, Voice } from '../../canonical-model/musical-event.ts';
import { Section } from '../../canonical-model/section.ts';
import { TempoEvent, TempoMap } from '../../canonical-model/tempo-map.ts';
import { Timeline } from '../../canonical-model/timeline.ts';
import { TimeSignature } from '../../canonical-model/time-signature.ts';
import {
  type ArticulationType,
  CANONICAL_TPQN,
  type ClefType,
  type DynamicMarking,
  type InstrumentFamily,
  type SectionType,
  type StemDirection,
  type TieType,
} from '../../canonical-model/types.ts';
import { CanonicalModelValidator } from '../../canonical-model/validator.ts';
import { Accidental } from '../../music-theory/accidental.ts';
import { Chord } from '../../music-theory/chord.ts';
import { KeySignature } from '../../music-theory/key-signature.ts';
import { type BaseNoteLetter, NoteName } from '../../music-theory/note-name.ts';
import { Pitch } from '../../music-theory/pitch.ts';
import { DiagnosticCollector } from '../diagnostics.ts';
import { IngestionResult, type MusicImporter } from '../importer-contract.ts';
import { ProvenanceManager } from '../provenance.ts';
import { type ImportOptions } from '../types.ts';
import { XmlElement, XmlParser } from '../xml/xml-parser.ts';

export class MusicXmlImporter implements MusicImporter {
  public readonly format = 'MUSIC_XML' as const;
  public readonly name = 'Bethesda MusicXML 4.0 Importer';
  public readonly version = '1.0.0';

  public canHandle(source: string, filename?: string): boolean {
    if (filename) {
      const lower = filename.toLowerCase();
      if (lower.endsWith('.xml') || lower.endsWith('.musicxml')) {
        return true;
      }
    }
    const trimmed = source.trim();
    return (
      trimmed.includes('<score-partwise') ||
      trimmed.includes('<score-timewise') ||
      (trimmed.includes('<?xml') && trimmed.includes('<part-list'))
    );
  }

  public import(source: string, options?: ImportOptions): IngestionResult {
    const diagnostics = new DiagnosticCollector();
    const provenance = ProvenanceManager.create({
      sourceFormat: this.format,
      sourceName: options?.sourceName,
      importer: this.name,
      importerVersion: this.version,
      rawContent: source,
    });

    try {
      const root = XmlParser.parse(source);
      if (root.name !== 'score-partwise' && root.name !== 'score-timewise') {
        diagnostics.addError(
          'INVALID_ROOT_ELEMENT',
          `Elemento raíz no reconocido: <${root.name}>. Se esperaba <score-partwise> o <score-timewise>.`
        );
        return new IngestionResult({
          status: 'FAILED',
          provenance,
          diagnostics: [...diagnostics.diagnostics],
        });
      }

      // 1. Extraer Título y Metadatos de la Obra
      let title =
        root.child('work')?.childText('work-title') ??
        root.childText('movement-title') ??
        options?.sourceName?.replace(/\.[^.]+$/, '') ??
        'Sin Título';

      // 2. Extraer Pistas Instrumentales desde <part-list>
      const partListEl = root.child('part-list');
      const instrumentTracks: InstrumentTrack[] = [];
      const partMap = new Map<string, { name: string; trackId: string }>();

      if (partListEl) {
        let trackIdx = 1;
        for (const sp of partListEl.childrenNamed('score-part')) {
          const partId = sp.attr('id') ?? `P${trackIdx}`;
          const partName = sp.childText('part-name') ?? `Instrumento ${trackIdx}`;
          const trackId = `track_${partId.toLowerCase().replace(/[^a-z0-9_]/g, '_')}`;

          partMap.set(partId, { name: partName, trackId });

          instrumentTracks.push(
            new InstrumentTrack({
              id: trackId,
              name: partName,
              family: this.deduceFamilyFromName(partName),
              voiceIds: [trackIdx], // Por defecto voz correspondiente
            })
          );
          trackIdx++;
        }
      }

      if (instrumentTracks.length === 0) {
        instrumentTracks.push(
          new InstrumentTrack({
            id: 'track_default',
            name: 'Pista Principal',
            family: 'OTHER',
            voiceIds: [1],
          })
        );
      }

      // 3. Procesar Partes y Compases
      // MusicXML normalmente tiene <part id="..."> con <measure number="...">
      const parts = root.childrenNamed('part');
      if (parts.length === 0) {
        diagnostics.addError('MISSING_PARTS', 'No se encontraron elementos <part> en el documento MusicXML.');
        return new IngestionResult({
          status: 'FAILED',
          provenance,
          diagnostics: [...diagnostics.diagnostics],
        });
      }

      // Usamos la primera parte para establecer la estructura primaria de compases y métrica
      const primaryPart = parts[0]!;
      const rawMeasures = primaryPart.childrenNamed('measure');
      if (rawMeasures.length === 0) {
        diagnostics.addError('MISSING_MEASURES', 'La parte principal no contiene elementos <measure>.');
        return new IngestionResult({
          status: 'FAILED',
          provenance,
          diagnostics: [...diagnostics.diagnostics],
        });
      }

      let activeDivisions = 1;
      let activeTimeSignature = TimeSignature.FOUR_FOUR;
      let activeKeySigRef = new KeySignatureReference(NoteName.C, 'MAJOR', new KeySignature(0));
      const tempoEvents: TempoEvent[] = [];
      const sections: Section[] = [];
      const canonicalMeasures: Measure[] = [];

      let currentMeasureStartTick = 0;
      let lyricSequence = 1;

      for (let mIdx = 0; mIdx < rawMeasures.length; mIdx++) {
        const mEl = rawMeasures[mIdx]!;
        const measureNum = mIdx + 1; // Forzar secuencia 1..N

        // Leer <attributes> si existen
        const attrsEl = mEl.child('attributes');
        if (attrsEl) {
          // divisions
          const div = attrsEl.childInt('divisions');
          if (div !== undefined && div > 0) {
            activeDivisions = div;
          }

          // time
          const timeEl = attrsEl.child('time');
          if (timeEl) {
            const beats = timeEl.childInt('beats');
            const beatType = timeEl.childInt('beat-type');
            if (beats && beatType) {
              try {
                activeTimeSignature = new TimeSignature(beats, beatType);
              } catch (err) {
                diagnostics.addWarning(
                  'INVALID_TIME_SIGNATURE',
                  `Métrica inválida en compás ${measureNum}: ${beats}/${beatType}`,
                  { measureNumber: measureNum }
                );
              }
            }
          }

          // key
          const keyEl = attrsEl.child('key');
          if (keyEl) {
            const fifths = keyEl.childInt('fifths') ?? 0;
            const mode = keyEl.childText('mode')?.toLowerCase() === 'minor' ? 'NATURAL_MINOR' : 'MAJOR';
            try {
              const keySig = new KeySignature(fifths);
              const tonic = this.deduceTonicFromFifths(fifths, mode === 'MAJOR');
              activeKeySigRef = new KeySignatureReference(tonic, mode, keySig);
            } catch (err) {
              diagnostics.addWarning(
                'INVALID_KEY_SIGNATURE',
                `Armadura inválida en compás ${measureNum} (fifths: ${fifths})`,
                { measureNumber: measureNum }
              );
            }
          }
        }

        // Leer <direction> para tempos y secciones
        for (const dir of mEl.childrenNamed('direction')) {
          // Tempo
          const soundEl = dir.child('sound');
          if (soundEl) {
            const tempoAttr = soundEl.attr('tempo');
            if (tempoAttr) {
              const parsedBpm = parseFloat(tempoAttr);
              if (parsedBpm > 0) {
                tempoEvents.push(new TempoEvent(currentMeasureStartTick, parsedBpm));
              }
            }
          }

          // Marcadores de ensayo / secciones (rehearsal)
          const dirType = dir.child('direction-type');
          const rehearsalText = dirType?.childText('rehearsal') ?? dirType?.childText('words');
          if (rehearsalText) {
            const sectionType = this.deduceSectionType(rehearsalText);
            sections.push(
              new Section({
                id: `sec_${measureNum}_${sectionType.toLowerCase()}`,
                type: sectionType,
                label: rehearsalText,
                startMeasure: measureNum,
                measureCount: 1, // Se actualizará al final
                startTick: currentMeasureStartTick,
                durationTicks: activeTimeSignature.calculateMeasureDurationTicks(),
              })
            );
          }
        }

        // Calcular duración canónica del compás
        const measureDurationTicks = activeTimeSignature.calculateMeasureDurationTicks();

        // Procesar Voces, Notas, Silencios, Acordes y Lírica
        const voiceEventsMap = new Map<number, (Note | Rest)[]>();
        const chordEvents: ChordEvent[] = [];
        const lyricSyllables: LyricSyllable[] = [];

        let currentTickInMeasure = 0;
        let lastNoteTick = 0;
        let noteCounterInMeasure = 1;

        for (const child of mEl.children) {
          if (child.name === 'note') {
            const isRest = child.child('rest') !== undefined;
            const isChord = child.child('chord') !== undefined;
            const durationDiv = child.childInt('duration') ?? 0;
            const durationTicks = Math.round((durationDiv * CANONICAL_TPQN) / activeDivisions);

            const voiceId = child.childInt('voice') ?? 1;
            const staffId = child.childInt('staff') ?? 1;

            const noteStartTick = isChord ? lastNoteTick : currentMeasureStartTick + currentTickInMeasure;

            if (isRest) {
              const restId = `r_m${measureNum}_v${voiceId}_${noteCounterInMeasure++}`;
              const rest = new Rest({
                id: restId,
                startTick: noteStartTick,
                durationTicks: Math.max(1, durationTicks),
                voice: voiceId,
                staff: staffId,
              });

              if (!voiceEventsMap.has(voiceId)) voiceEventsMap.set(voiceId, []);
              voiceEventsMap.get(voiceId)?.push(rest);
            } else {
              // Es una Nota
              const pitchEl = child.child('pitch');
              const step = (pitchEl?.childText('step') ?? 'C') as BaseNoteLetter;
              const alter = pitchEl?.childInt('alter') ?? 0;
              const octave = pitchEl?.childInt('octave') ?? 4;

              const accidental = Accidental.fromSemitones(alter);
              const noteName = new NoteName(step, accidental);
              const pitch = new Pitch(noteName, octave);

              const noteId = `n_m${measureNum}_v${voiceId}_${noteCounterInMeasure++}`;

              // Dinámicas y Articulaciones
              const notationsEl = child.child('notations');
              const articulations: ArticulationType[] = [];
              let dynamic: DynamicMarking | undefined = undefined;

              if (notationsEl) {
                const articEl = notationsEl.child('articulations');
                if (articEl) {
                  if (articEl.child('accent')) articulations.push('accent');
                  if (articEl.child('staccato')) articulations.push('staccato');
                  if (articEl.child('tenuto')) articulations.push('tenuto');
                  if (articEl.child('fermata')) articulations.push('fermata');
                }
              }

              // Ligadura (tie)
              let tie: TieType = 'NONE';
              const tieEl = child.child('tie');
              if (tieEl) {
                const tieTypeAttr = tieEl.attr('type');
                if (tieTypeAttr === 'start') tie = 'START';
                else if (tieTypeAttr === 'stop') tie = 'STOP';
              }

              const noteInit: {
                id: string;
                pitch: Pitch;
                startTick: number;
                durationTicks: number;
                voice: number;
                staff: number;
                velocity: number;
                dynamic?: DynamicMarking;
                articulations: ArticulationType[];
                tie: TieType;
              } = {
                id: noteId,
                pitch,
                startTick: noteStartTick,
                durationTicks: Math.max(1, durationTicks),
                voice: voiceId,
                staff: staffId,
                velocity: 80,
                articulations,
                tie,
              };
              if (dynamic) noteInit.dynamic = dynamic;
              const note = new Note(noteInit);

              if (!voiceEventsMap.has(voiceId)) voiceEventsMap.set(voiceId, []);
              voiceEventsMap.get(voiceId)?.push(note);

              // Sílaba Lírica vinculada a la nota
              const lyricEl = child.child('lyric');
              if (lyricEl) {
                const text = lyricEl.childText('text') ?? '';
                const syllabic = lyricEl.childText('syllabic');
                const isHyphenated = syllabic === 'begin' || syllabic === 'middle';

                lyricSyllables.push(
                  new LyricSyllable({
                    id: `syl_m${measureNum}_${lyricSequence}`,
                    text,
                    isHyphenated,
                    boundNoteId: noteId,
                    measureNumber: measureNum,
                    tickOffset: currentTickInMeasure,
                    sequenceNumber: lyricSequence++,
                  })
                );
              }
            }

            if (!isChord) {
              lastNoteTick = noteStartTick;
              currentTickInMeasure += durationTicks;
            }
          } else if (child.name === 'backup') {
            const dur = child.childInt('duration') ?? 0;
            const backupTicks = Math.round((dur * CANONICAL_TPQN) / activeDivisions);
            currentTickInMeasure = Math.max(0, currentTickInMeasure - backupTicks);
          } else if (child.name === 'forward') {
            const dur = child.childInt('duration') ?? 0;
            const fwdTicks = Math.round((dur * CANONICAL_TPQN) / activeDivisions);
            currentTickInMeasure += fwdTicks;
          } else if (child.name === 'harmony') {
            // Símbolo de acorde
            const chord = this.parseHarmonyElement(child);
            if (chord) {
              chordEvents.push(
                new ChordEvent({
                  id: `ch_m${measureNum}_${chordEvents.length + 1}`,
                  chord,
                  startTick: currentMeasureStartTick + currentTickInMeasure,
                  durationTicks: measureDurationTicks - currentTickInMeasure,
                  measureNumber: measureNum,
                })
              );
            }
          }
        }

        // Repeticiones y Casillas
        let repeatStart = false;
        let repeatEnd = false;
        let endingNumber: number | undefined;

        for (const barline of mEl.childrenNamed('barline')) {
          const repeat = barline.child('repeat');
          if (repeat) {
            const dir = repeat.attr('direction');
            if (dir === 'forward') repeatStart = true;
            if (dir === 'backward') repeatEnd = true;
          }
          const ending = barline.child('ending');
          if (ending) {
            const endNum = parseInt(ending.attr('number') ?? '1', 10);
            if (!isNaN(endNum)) endingNumber = endNum;
          }
        }

        // Construir Voces
        const voices: Voice[] = [];
        if (voiceEventsMap.size === 0) {
          // Si no hubo eventos en voces, crear voz con silencio de compás completo
          voices.push(
            new Voice(1, [
              new Rest({
                id: `r_empty_m${measureNum}`,
                startTick: currentMeasureStartTick,
                durationTicks: measureDurationTicks,
                voice: 1,
              }),
            ])
          );
        } else {
          for (const [voiceId, events] of voiceEventsMap.entries()) {
            voices.push(new Voice(voiceId, events));
          }
        }

        const measureInit: {
          number: number;
          timeSignature: TimeSignature;
          keySignature: KeySignatureReference;
          startTick: number;
          durationTicks: number;
          voices: Voice[];
          chords: ChordEvent[];
          lyrics: LyricSyllable[];
          repeatStart?: boolean;
          repeatEnd?: boolean;
          endingNumber?: number;
        } = {
          number: measureNum,
          timeSignature: activeTimeSignature,
          keySignature: activeKeySigRef,
          startTick: currentMeasureStartTick,
          durationTicks: measureDurationTicks,
          voices,
          chords: chordEvents,
          lyrics: lyricSyllables,
        };
        if (repeatStart) measureInit.repeatStart = true;
        if (repeatEnd) measureInit.repeatEnd = true;
        if (endingNumber !== undefined) measureInit.endingNumber = endingNumber;

        canonicalMeasures.push(new Measure(measureInit));
        currentMeasureStartTick += measureDurationTicks;
      }

      // Consolidar Secciones contiguas
      const consolidatedSections = this.consolidateSections(sections, canonicalMeasures.length);

      // Línea de tiempo
      const totalTicks = currentMeasureStartTick;
      const timeline = new Timeline({
        tpqn: CANONICAL_TPQN,
        totalDurationTicks: totalTicks,
        measureCount: canonicalMeasures.length,
        tempoMap: new TempoMap(tempoEvents.length > 0 ? tempoEvents : [new TempoEvent(0, options?.defaultBpm ?? 120)]),
      });

      const payload = new CanonicalMusicPayload({
        title,
        timeline,
        sections: consolidatedSections,
        measures: canonicalMeasures,
        instrumentTracks,
      });

      // Validación con CanonicalModelValidator
      const validation = CanonicalModelValidator.validate(payload);
      if (!validation.isValid) {
        for (const err of validation.errors) {
          diagnostics.addWarning('VALIDATION_ISSUE', err.message, undefined, err.context);
        }
      }

      const status = diagnostics.determineStatus();
      const stats = IngestionResult.computeStatistics(payload);

      return new IngestionResult({
        status,
        payload,
        provenance,
        diagnostics: [...diagnostics.diagnostics],
        statistics: stats,
      });
    } catch (error) {
      diagnostics.addError(
        'MUSICXML_PARSING_FAILED',
        error instanceof Error ? error.message : 'Error desconocido durante parseo de MusicXML'
      );
      return new IngestionResult({
        status: 'FAILED',
        provenance,
        diagnostics: [...diagnostics.diagnostics],
      });
    }
  }

  private parseHarmonyElement(harmonyEl: XmlElement): Chord | null {
    try {
      const rootEl = harmonyEl.child('root');
      if (!rootEl) return null;

      const step = (rootEl.childText('root-step') ?? 'C') as BaseNoteLetter;
      const alter = rootEl.childInt('root-alter') ?? 0;
      const rootNote = new NoteName(step, Accidental.fromSemitones(alter));

      const kindEl = harmonyEl.child('kind');
      const kindText = kindEl?.text.toLowerCase() ?? '';
      const kindAttr = kindEl?.attr('text') ?? '';

      // Mapear kind a cualidad
      let chordStr = rootNote.toString();
      if (kindText.includes('minor-seventh') || kindAttr === 'm7') {
        chordStr += 'm7';
      } else if (kindText.includes('major-seventh') || kindAttr === 'maj7') {
        chordStr += 'maj7';
      } else if (kindText.includes('minor') || kindAttr === 'm') {
        chordStr += 'm';
      } else if (kindText.includes('dominant') || kindAttr === '7') {
        chordStr += '7';
      } else if (kindText.includes('suspended-fourth') || kindAttr === 'sus4') {
        chordStr += 'sus4';
      } else if (kindText.includes('half-diminished') || kindAttr.includes('m7b5')) {
        chordStr += 'm7b5';
      }

      const bassEl = harmonyEl.child('bass');
      if (bassEl) {
        const bassStep = (bassEl.childText('bass-step') ?? '') as BaseNoteLetter;
        const bassAlter = bassEl.childInt('bass-alter') ?? 0;
        if (bassStep) {
          const bassNote = new NoteName(bassStep, Accidental.fromSemitones(bassAlter));
          chordStr += `/${bassNote.toString()}`;
        }
      }

      return Chord.parse(chordStr);
    } catch {
      return null;
    }
  }

  private deduceTonicFromFifths(fifths: number, isMajor: boolean): NoteName {
    // 0 = C / Am, +1 = G / Em, +2 = D / Bm, -1 = F / Dm, etc.
    const majorFifthsMap: Record<number, NoteName> = {
      0: NoteName.C,
      1: NoteName.G,
      2: NoteName.D,
      3: NoteName.A,
      4: NoteName.E,
      5: NoteName.B,
      6: new NoteName('F', Accidental.SHARP),
      7: new NoteName('C', Accidental.SHARP),
      '-1': new NoteName('F', Accidental.NATURAL),
      '-2': new NoteName('B', Accidental.FLAT),
      '-3': new NoteName('E', Accidental.FLAT),
      '-4': new NoteName('A', Accidental.FLAT),
      '-5': new NoteName('D', Accidental.FLAT),
      '-6': new NoteName('G', Accidental.FLAT),
      '-7': new NoteName('C', Accidental.FLAT),
    };

    const minorFifthsMap: Record<number, NoteName> = {
      0: NoteName.A,
      1: NoteName.E,
      2: NoteName.B,
      3: new NoteName('F', Accidental.SHARP),
      4: new NoteName('C', Accidental.SHARP),
      5: new NoteName('G', Accidental.SHARP),
      6: new NoteName('D', Accidental.SHARP),
      7: new NoteName('A', Accidental.SHARP),
      '-1': NoteName.D,
      '-2': NoteName.G,
      '-3': NoteName.C,
      '-4': new NoteName('F', Accidental.NATURAL),
      '-5': new NoteName('B', Accidental.FLAT),
      '-6': new NoteName('E', Accidental.FLAT),
      '-7': new NoteName('A', Accidental.FLAT),
    };

    return isMajor ? majorFifthsMap[fifths] ?? NoteName.C : minorFifthsMap[fifths] ?? NoteName.A;
  }

  private deduceSectionType(text: string): SectionType {
    const t = text.toUpperCase().trim();
    if (t.includes('INTRO')) return 'INTRO';
    if (t.includes('VERS') || t.includes('ESTROFA')) return 'VERSE';
    if (t.includes('PRE') && t.includes('CHOR')) return 'PRE_CHORUS';
    if (t.includes('CHOR') || t.includes('CORO')) return 'CHORUS';
    if (t.includes('BRIDG') || t.includes('PUENTE')) return 'BRIDGE';
    if (t.includes('INTER')) return 'INTERLUDE';
    if (t.includes('SOLO')) return 'SOLO';
    if (t.includes('INSTR')) return 'INSTRUMENTAL';
    if (t.includes('OUTRO') || t.includes('FINAL')) return 'OUTRO';
    if (t.includes('TAG')) return 'TAG';
    if (t.includes('VAMP')) return 'VAMP';
    return 'CUSTOM';
  }

  private consolidateSections(sections: Section[], totalMeasures: number): Section[] {
    if (sections.length === 0) {
      // Crear sección por defecto abarcando toda la obra
      return [
        new Section({
          id: 'sec_main',
          type: 'CUSTOM',
          label: 'Cuerpo Principal',
          startMeasure: 1,
          measureCount: totalMeasures,
          startTick: 0,
          durationTicks: totalMeasures * 1920,
        }),
      ];
    }

    const consolidated: Section[] = [];
    for (let i = 0; i < sections.length; i++) {
      const current = sections[i]!;
      const next = sections[i + 1];
      const endM = next ? next.startMeasure - 1 : totalMeasures;
      const measureCount = Math.max(1, endM - current.startMeasure + 1);

      consolidated.push(
        new Section({
          id: current.id,
          type: current.type,
          label: current.label,
          startMeasure: current.startMeasure,
          measureCount,
          startTick: current.startTick,
          durationTicks: measureCount * 1920,
        })
      );
    }
    return consolidated;
  }

  private deduceFamilyFromName(name: string): InstrumentFamily {
    const n = name.toLowerCase();
    if (n.includes('piano') || n.includes('key') || n.includes('organ') || n.includes('teclado')) return 'KEYS';
    if (n.includes('guitar') || n.includes('acústica') || n.includes('eléctrica')) return 'GUITAR';
    if (n.includes('bass') || n.includes('bajo')) return 'BASS';
    if (n.includes('drum') || n.includes('batería') || n.includes('perc')) return 'DRUMS';
    if (n.includes('vocal') || n.includes('voice') || n.includes('voz') || n.includes('coro')) return 'VOCALS';
    if (n.includes('sax') || n.includes('flute') || n.includes('flauta') || n.includes('clarinet')) return 'WOODWINDS';
    if (n.includes('trumpet') || n.includes('trompeta') || n.includes('horn') || n.includes('trombone')) return 'BRASS';
    if (n.includes('violin') || n.includes('cello') || n.includes('strings') || n.includes('cuerdas')) return 'STRINGS';
    return 'OTHER';
  }
}
