/**
 * @file chordpro-importer.ts
 * @description Importador determinista de ChordPro hacia CanonicalMusicPayload.
 * Parsea directivas ({title}, {key}, {tempo}, {capo}, {soc}), acordes estructurados y lírica
 * respetando estrictamente el invariante de NO inventar notas melódicas cuando no existan.
 */

import { CanonicalMusicPayload } from '../../canonical-model/canonical-music-payload.ts';
import { ChordEvent } from '../../canonical-model/chord-event.ts';
import { InstrumentTrack } from '../../canonical-model/instrument-track.ts';
import { KeySignatureReference } from '../../canonical-model/key-signature-reference.ts';
import { LyricSyllable } from '../../canonical-model/lyric-syllable.ts';
import { Measure } from '../../canonical-model/measure.ts';
import { Section } from '../../canonical-model/section.ts';
import { TempoEvent, TempoMap } from '../../canonical-model/tempo-map.ts';
import { Timeline } from '../../canonical-model/timeline.ts';
import { TimeSignature } from '../../canonical-model/time-signature.ts';
import { CANONICAL_TPQN, type SectionType } from '../../canonical-model/types.ts';
import { CanonicalModelValidator } from '../../canonical-model/validator.ts';
import { Chord } from '../../music-theory/chord.ts';
import { KeySignature } from '../../music-theory/key-signature.ts';
import { NoteName } from '../../music-theory/note-name.ts';
import { DiagnosticCollector } from '../diagnostics.ts';
import { IngestionResult, type MusicImporter } from '../importer-contract.ts';
import { ProvenanceManager } from '../provenance.ts';
import { type ImportOptions } from '../types.ts';

export class ChordProImporter implements MusicImporter {
  public readonly format = 'CHORD_PRO' as const;
  public readonly name = 'Bethesda ChordPro Importer';
  public readonly version = '1.0.0';

  public canHandle(source: string, filename?: string): boolean {
    if (filename) {
      const lower = filename.toLowerCase();
      if (
        lower.endsWith('.pro') ||
        lower.endsWith('.chopro') ||
        lower.endsWith('.chordpro') ||
        lower.endsWith('.crd')
      ) {
        return true;
      }
    }
    // Heurística de contenido: directivas {title}, {t}, {c}, o acordes entre corchetes [C], [G]
    const hasDirectives = /\{(title|t|subtitle|st|c|comment|key|tempo|capo|soc|sov|sob):/i.test(source);
    const hasBracketChords = /\[[A-G][b#]?[^\]]*\]/.test(source);
    return hasDirectives || hasBracketChords;
  }

  public import(source: string, options?: ImportOptions): IngestionResult {
    const diagnostics = new DiagnosticCollector();
    let capoFret: number | undefined = undefined;

    let title = options?.sourceName?.replace(/\.[^.]+$/, '') ?? 'Canción sin Título';
    let rawKey = options?.defaultKey ?? 'C';
    let rawTimeSig = options?.defaultTimeSignature ?? '4/4';
    let bpm = options?.defaultBpm ?? 120;

    const lines = source.split(/\r?\n/);

    interface ParsedSectionData {
      type: SectionType;
      label: string;
      lines: { chordTokens: { chord: Chord; tickFraction: number }[]; lyricTokens: string[] }[];
    }

    const sectionsData: ParsedSectionData[] = [];
    let currentSection: ParsedSectionData = {
      type: 'CUSTOM',
      label: 'Cuerpo Principal',
      lines: [],
    };

    // 1. Parsear Líneas y Directivas
    for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
      const lineNum = lineIdx + 1;
      const rawLine = lines[lineIdx]?.trim() ?? '';
      if (!rawLine) continue;

      // Directivas {directive: value}
      if (rawLine.startsWith('{') && rawLine.endsWith('}')) {
        const inner = rawLine.substring(1, rawLine.length - 1).trim();
        const colonIdx = inner.indexOf(':');
        const dirName = (colonIdx >= 0 ? inner.substring(0, colonIdx) : inner).toLowerCase().trim();
        const dirVal = colonIdx >= 0 ? inner.substring(colonIdx + 1).trim() : '';

        switch (dirName) {
          case 'title':
          case 't':
            if (dirVal) title = dirVal;
            break;
          case 'key':
            if (dirVal) rawKey = dirVal;
            break;
          case 'tempo':
          case 'bpm': {
            const parsed = parseFloat(dirVal);
            if (parsed > 0) bpm = parsed;
            break;
          }
          case 'time':
            if (dirVal) rawTimeSig = dirVal;
            break;
          case 'capo': {
            const parsedCapo = parseInt(dirVal, 10);
            if (!isNaN(parsedCapo) && parsedCapo >= 0 && parsedCapo <= 12) {
              capoFret = parsedCapo;
              diagnostics.addInfo(
                'CAPO_DETECTED',
                `Cejilla detectada en traste ${capoFret}. Se preserva la tonalidad canónica sin transposición forzada.`,
                { lineNumber: lineNum }
              );
            } else {
              diagnostics.addWarning('INVALID_CAPO_VALUE', `Valor de cejilla inválido: ${dirVal}`, {
                lineNumber: lineNum,
              });
            }
            break;
          }
          case 'start_of_verse':
          case 'sov':
            if (currentSection.lines.length > 0) sectionsData.push(currentSection);
            currentSection = { type: 'VERSE', label: dirVal || 'Estrofa', lines: [] };
            break;
          case 'end_of_verse':
          case 'eov':
            sectionsData.push(currentSection);
            currentSection = { type: 'CUSTOM', label: '', lines: [] };
            break;
          case 'start_of_chorus':
          case 'soc':
            if (currentSection.lines.length > 0) sectionsData.push(currentSection);
            currentSection = { type: 'CHORUS', label: dirVal || 'Coro', lines: [] };
            break;
          case 'end_of_chorus':
          case 'eoc':
            sectionsData.push(currentSection);
            currentSection = { type: 'CUSTOM', label: '', lines: [] };
            break;
          case 'start_of_bridge':
          case 'sob':
            if (currentSection.lines.length > 0) sectionsData.push(currentSection);
            currentSection = { type: 'BRIDGE', label: dirVal || 'Puente', lines: [] };
            break;
          case 'end_of_bridge':
          case 'eob':
            sectionsData.push(currentSection);
            currentSection = { type: 'CUSTOM', label: '', lines: [] };
            break;
          case 'comment':
          case 'c': {
            const deduced = this.deduceSectionFromComment(dirVal);
            if (deduced) {
              if (currentSection.lines.length > 0) sectionsData.push(currentSection);
              currentSection = { type: deduced.type, label: deduced.label, lines: [] };
            }
            break;
          }
          default:
            diagnostics.addInfo('UNSUPPORTED_DIRECTIVE', `Directiva no interpretada: {${dirName}}`, {
              lineNumber: lineNum,
            });
            break;
        }
        continue;
      }

      // Línea de acordes y texto
      const parsedLine = this.parseChordProLine(rawLine, lineNum, diagnostics);
      if (parsedLine.chordTokens.length > 0 || parsedLine.lyricTokens.length > 0) {
        currentSection.lines.push(parsedLine);
      }
    }

    if (currentSection.lines.length > 0) {
      sectionsData.push(currentSection);
    }

    // 2. Establecer Métrica y Armadura Inicial
    let timeSignature: TimeSignature;
    try {
      timeSignature = TimeSignature.parse(rawTimeSig);
    } catch {
      diagnostics.addWarning('DEFAULTING_TIME_SIGNATURE', `Métrica no válida: "${rawTimeSig}". Usando 4/4.`);
      timeSignature = TimeSignature.FOUR_FOUR;
    }

    const keySigRef = this.resolveKeySignatureRef(rawKey, diagnostics);
    const measureDuration = timeSignature.calculateMeasureDurationTicks();

    // 3. Generar Compases y Secciones
    const canonicalMeasures: Measure[] = [];
    const canonicalSections: Section[] = [];
    let currentMeasureNum = 1;
    let currentStartTick = 0;
    let syllableSequence = 1;

    for (const secData of sectionsData) {
      const sectionStartMeasure = currentMeasureNum;
      const sectionStartTick = currentStartTick;

      for (const line of secData.lines) {
        // Asignamos los acordes y lírica a compases
        // Si hay más de 2 acordes en la línea, se reparten entre compases (ej. 2 acordes por compás)
        const chords = line.chordTokens;
        const lyrics = line.lyricTokens;

        const chordsPerMeasure = timeSignature.isCompound ? 2 : 2;
        const measuresNeeded = Math.max(1, Math.ceil(Math.max(chords.length / chordsPerMeasure, 1)));

        for (let mOffset = 0; mOffset < measuresNeeded; mOffset++) {
          const mNum = currentMeasureNum++;
          const mTick = currentStartTick;
          const measureChords: ChordEvent[] = [];
          const measureLyrics: LyricSyllable[] = [];

          // Acordes de este compás
          const chordSlice = chords.slice(mOffset * chordsPerMeasure, (mOffset + 1) * chordsPerMeasure);
          if (chordSlice.length > 0) {
            const slotDuration = Math.floor(measureDuration / chordSlice.length);
            for (let cIdx = 0; cIdx < chordSlice.length; cIdx++) {
              const ch = chordSlice[cIdx]!;
              measureChords.push(
                new ChordEvent({
                  id: `ch_m${mNum}_${cIdx + 1}`,
                  chord: ch.chord,
                  startTick: mTick + cIdx * slotDuration,
                  durationTicks: slotDuration,
                  measureNumber: mNum,
                })
              );
            }
          }

          // Sílabas líricas de este compás (repartidas si aplica)
          if (mOffset === 0 && lyrics.length > 0) {
            const lyricText = lyrics.join(' ').trim();
            if (lyricText) {
              // Dividir en palabras / sílabas estructuradas
              const words = lyricText.split(/\s+/);
              const slotTicks = Math.floor(measureDuration / Math.max(1, words.length));

              for (let wIdx = 0; wIdx < words.length; wIdx++) {
                const word = words[wIdx]!;
                const firstChord = measureChords[0]?.chord ?? null;

                measureLyrics.push(
                  new LyricSyllable({
                    id: `syl_m${mNum}_${wIdx + 1}`,
                    text: word,
                    isHyphenated: word.endsWith('-'),
                    boundNoteId: null, // ¡Invariante: Sin nota melódica inventada!
                    measureNumber: mNum,
                    tickOffset: Math.min(measureDuration - 1, wIdx * slotTicks),
                    sequenceNumber: syllableSequence++,
                    chordAbove: wIdx === 0 ? firstChord : null,
                  })
                );
              }
            }
          }

          canonicalMeasures.push(
            new Measure({
              number: mNum,
              timeSignature,
              keySignature: keySigRef,
              startTick: mTick,
              durationTicks: measureDuration,
              voices: [], // ¡Invariante: Sin notas inventadas para ChordPro!
              chords: measureChords,
              lyrics: measureLyrics,
            })
          );

          currentStartTick += measureDuration;
        }
      }

      const sectionMeasureCount = currentMeasureNum - sectionStartMeasure;
      if (sectionMeasureCount > 0) {
        canonicalSections.push(
          new Section({
            id: `sec_${sectionStartMeasure}_${secData.type.toLowerCase()}`,
            type: secData.type,
            label: secData.label || secData.type,
            startMeasure: sectionStartMeasure,
            measureCount: sectionMeasureCount,
            startTick: sectionStartTick,
            durationTicks: sectionMeasureCount * measureDuration,
          })
        );
      }
    }

    // Si no se generaron compases (ej. entrada vacía), crear al menos un compás vacío
    if (canonicalMeasures.length === 0) {
      canonicalMeasures.push(
        new Measure({
          number: 1,
          timeSignature,
          keySignature: keySigRef,
          startTick: 0,
          durationTicks: measureDuration,
        })
      );
      canonicalSections.push(
        new Section({
          id: 'sec_1_custom',
          type: 'CUSTOM',
          label: 'Cuerpo',
          startMeasure: 1,
          measureCount: 1,
          startTick: 0,
          durationTicks: measureDuration,
        })
      );
      currentStartTick = measureDuration;
    }

    // Pista instrumental estándar para Lead Sheet / Cifrado
    const instrumentTracks: InstrumentTrack[] = [
      new InstrumentTrack({
        id: 'track_leadsheet',
        name: 'Guía Armónica / Cifrado',
        family: 'GUITAR',
        clef: 'TREBLE',
        transpositionOffsetSemitones: 0,
        voiceIds: [], // Sin voces de pentagrama
      }),
    ];

    const timeline = new Timeline({
      tpqn: CANONICAL_TPQN,
      totalDurationTicks: currentStartTick,
      measureCount: canonicalMeasures.length,
      tempoMap: new TempoMap([new TempoEvent(0, bpm)]),
    });

    const payload = new CanonicalMusicPayload({
      title,
      timeline,
      sections: canonicalSections,
      measures: canonicalMeasures,
      instrumentTracks,
    });

    const provenance = ProvenanceManager.create({
      sourceFormat: this.format,
      sourceName: options?.sourceName,
      importer: this.name,
      importerVersion: this.version,
      rawContent: source,
      capoFret,
    });

    // Validación de dominio
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
  }

  private parseChordProLine(
    line: string,
    lineNum: number,
    diagnostics: DiagnosticCollector
  ): { chordTokens: { chord: Chord; tickFraction: number }[]; lyricTokens: string[] } {
    const chordTokens: { chord: Chord; tickFraction: number }[] = [];
    const lyricTokens: string[] = [];

    // Formato: [G]Sublime [C]gracia
    const regex = /\[([^\]]+)\]|([^[]+)/g;
    let match: RegExpExecArray | null;
    let tokenIdx = 0;

    while ((match = regex.exec(line)) !== null) {
      if (match[1]) {
        // Acorde
        const chordStr = match[1].trim();
        if (chordStr && chordStr !== '|' && chordStr !== '/') {
          try {
            const chord = Chord.parse(chordStr);
            chordTokens.push({ chord, tickFraction: tokenIdx });
          } catch {
            diagnostics.addWarning('UNRECOGNIZED_CHORD', `Acorde no reconocido en ChordPro: "[${chordStr}]"`, {
              lineNumber: lineNum,
              token: chordStr,
            });
          }
        }
      } else if (match[2]) {
        // Texto lírico
        const text = match[2].trim();
        if (text && text !== '|') {
          lyricTokens.push(text);
        }
      }
      tokenIdx++;
    }

    return { chordTokens, lyricTokens };
  }

  private deduceSectionFromComment(comment: string): { type: SectionType; label: string } | null {
    const c = comment.toUpperCase().trim();
    if (c.includes('INTRO')) return { type: 'INTRO', label: comment };
    if (c.includes('VERS') || c.includes('ESTROFA')) return { type: 'VERSE', label: comment };
    if (c.includes('PRE') && c.includes('CHOR')) return { type: 'PRE_CHORUS', label: comment };
    if (c.includes('CHOR') || c.includes('CORO')) return { type: 'CHORUS', label: comment };
    if (c.includes('BRIDG') || c.includes('PUENTE')) return { type: 'BRIDGE', label: comment };
    if (c.includes('INTER')) return { type: 'INTERLUDE', label: comment };
    if (c.includes('SOLO')) return { type: 'SOLO', label: comment };
    if (c.includes('INSTR')) return { type: 'INSTRUMENTAL', label: comment };
    if (c.includes('OUTRO') || c.includes('FINAL')) return { type: 'OUTRO', label: comment };
    if (c.includes('TAG')) return { type: 'TAG', label: comment };
    if (c.includes('VAMP')) return { type: 'VAMP', label: comment };
    return null;
  }

  private resolveKeySignatureRef(keyStr: string, diagnostics: DiagnosticCollector): KeySignatureReference {
    try {
      const isMinor = keyStr.toLowerCase().endsWith('m') && !keyStr.toLowerCase().endsWith('maj');
      const cleanTonic = isMinor ? keyStr.slice(0, -1) : keyStr;
      const tonic = NoteName.parse(cleanTonic);

      // Mapear tónicas comunes a quintas
      const keyMap: Record<string, number> = {
        C: 0,
        G: 1,
        D: 2,
        A: 3,
        E: 4,
        B: 5,
        'F#': 6,
        'C#': 7,
        F: -1,
        Bb: -2,
        Eb: -3,
        Ab: -4,
        Db: -5,
        Gb: -6,
        Cb: -7,
      };

      const fifths = keyMap[tonic.toString()] ?? 0;
      return new KeySignatureReference(
        tonic,
        isMinor ? 'NATURAL_MINOR' : 'MAJOR',
        new KeySignature(fifths)
      );
    } catch {
      diagnostics.addWarning('DEFAULTING_KEY', `Tonalidad no reconocida: "${keyStr}". Usando Do Mayor.`);
      return new KeySignatureReference(NoteName.C, 'MAJOR', new KeySignature(0));
    }
  }
}
