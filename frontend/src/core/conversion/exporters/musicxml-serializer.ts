/**
 * @file musicxml-serializer.ts
 * @description Serializador fidedigno de CanonicalMusicPayload hacia MusicXML 4.0 (Fase 2A).
 *
 * Principios:
 * 1. CERO invención de notas, métricas, armaduras o tempos inexistentes en el modelo canónico.
 * 2. Mapeo exacto de divisiones canónicas: 480 TPQN = 1 negra (divisions = 480).
 * 3. Preservación estricta de alturas, octavas, alteraciones, duraciones, silencios, ligaduras, acordes y lírica.
 * 4. Soporte para compases sin armadura o sin métrica (omite tags <key> o <time> sin inventar Do Mayor o 4/4).
 */

import { type CanonicalMusicPayload } from '../../canonical-model/canonical-music-payload.ts';
import { type Measure } from '../../canonical-model/measure.ts';
import { type Note, type Rest } from '../../canonical-model/musical-event.ts';
import { type ChordEvent } from '../../canonical-model/chord-event.ts';
import { type LyricSyllable } from '../../canonical-model/lyric-syllable.ts';
import { CANONICAL_TPQN } from '../../canonical-model/types.ts';
import {
  type ConversionDiagnostic,
  type ConversionExportResult,
} from '../types.ts';

export interface MusicXmlExportOptions {
  softwareName?: string;
  encodingDate?: string;
  includeHarmonies?: boolean;
  includeLyrics?: boolean;
}

export class CanonicalToMusicXmlSerializer {
  /**
   * Serializa un objeto CanonicalMusicPayload a una cadena XML compatible con MusicXML 4.0.
   */
  public static serialize(
    payload: CanonicalMusicPayload,
    options?: MusicXmlExportOptions
  ): ConversionExportResult {
    const diagnostics: ConversionDiagnostic[] = [];

    if (!payload || !payload.title) {
      throw new Error('No se puede serializar un CanonicalMusicPayload inválido o sin título.');
    }

    const totalNotes = payload.getAllNotes().length;
    if (totalNotes === 0) {
      diagnostics.push({
        code: 'MUSICXML_NO_MELODIC_NOTES',
        severity: 'WARNING',
        message:
          'El documento canónico no contiene notas melódicas (ej. origen ChordPro o cancionero de texto). Se generarán compases estructurales con armonías y texto lírico, sin notas inventadas.',
      });
    }

    const encodingDate = options?.encodingDate ?? new Date().toISOString().split('T')[0];
    const softwareName = options?.softwareName ?? 'Bethesda Worship Studio (v2.0)';
    const includeHarmonies = options?.includeHarmonies ?? true;
    const includeLyrics = options?.includeLyrics ?? true;

    const xmlLines: string[] = [];

    // 1. Declaración XML y DOCTYPE de MusicXML 4.0
    xmlLines.push('<?xml version="1.0" encoding="UTF-8"?>');
    xmlLines.push(
      '<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">'
    );
    xmlLines.push('<score-partwise version="4.0">');

    // 2. Metadatos de la Obra
    xmlLines.push('  <work>');
    xmlLines.push(`    <work-title>${this.escapeXml(payload.title)}</work-title>`);
    xmlLines.push('  </work>');

    // 3. Identificación y Créditos
    const artist = typeof payload.metadata?.artist === 'string' ? payload.metadata.artist : null;
    xmlLines.push('  <identification>');
    if (artist) {
      xmlLines.push(`    <creator type="composer">${this.escapeXml(artist)}</creator>`);
    }
    xmlLines.push('    <encoding>');
    xmlLines.push(`      <software>${this.escapeXml(softwareName)}</software>`);
    xmlLines.push(`      <encoding-date>${encodingDate}</encoding-date>`);
    xmlLines.push('    </encoding>');
    xmlLines.push('  </identification>');

    // 4. Lista de Partes
    xmlLines.push('  <part-list>');
    xmlLines.push('    <score-part id="P1">');
    xmlLines.push(`      <part-name>${this.escapeXml(payload.title)}</part-name>`);
    xmlLines.push('    </score-part>');
    xmlLines.push('  </part-list>');

    // 5. Contenido de la Parte (Compases)
    xmlLines.push('  <part id="P1">');

    let previousKeySignature: string | null = null;
    let previousTimeSignature: string | null = null;

    // Si no hay compases en el payload, crear al menos un compás vacío para cumplir esquema MusicXML
    const measures = payload.measures.length > 0 ? payload.measures : [null];

    for (let i = 0; i < measures.length; i++) {
      const measure = measures[i];
      const measureNumber = measure ? measure.number : i + 1;

      xmlLines.push(`    <measure number="${measureNumber}">`);

      // Determinar si debemos emitir atributos (en el compás 1 o si cambian)
      const isFirstMeasure = i === 0;
      const currentKeySig = measure?.keySignature ? `${measure.keySignature.tonic.toString()}_${measure.keySignature.mode}` : null;
      const currentTimeSig = measure?.timeSignature ? `${measure.timeSignature.numerator}/${measure.timeSignature.denominator}` : null;

      const keyChanged = currentKeySig !== null && currentKeySig !== previousKeySignature;
      const timeChanged = currentTimeSig !== null && currentTimeSig !== previousTimeSignature;

      if (isFirstMeasure || keyChanged || timeChanged) {
        xmlLines.push('      <attributes>');
        if (isFirstMeasure) {
          xmlLines.push(`        <divisions>${CANONICAL_TPQN}</divisions>`);
        }

        // Armadura de clave (solo si se conoce en el compás, CERO Do Mayor inventado)
        if (measure?.keySignature && (isFirstMeasure || keyChanged)) {
          const fifths = measure.keySignature.keySignature.accidentalCount;
          const mode = measure.keySignature.mode.toLowerCase();
          xmlLines.push('        <key>');
          xmlLines.push(`          <fifths>${fifths}</fifths>`);
          xmlLines.push(`          <mode>${mode}</mode>`);
          xmlLines.push('        </key>');
          previousKeySignature = currentKeySig;
        }

        // Métrica (solo si se conoce en el compás, CERO 4/4 inventado)
        if (measure?.timeSignature && (isFirstMeasure || timeChanged)) {
          xmlLines.push('        <time>');
          xmlLines.push(`          <beats>${measure.timeSignature.numerator}</beats>`);
          xmlLines.push(`          <beat-type>${measure.timeSignature.denominator}</beat-type>`);
          xmlLines.push('        </time>');
          previousTimeSignature = currentTimeSig;
        }

        if (isFirstMeasure) {
          xmlLines.push('        <clef>');
          xmlLines.push('          <sign>G</sign>');
          xmlLines.push('          <line>2</line>');
          xmlLines.push('        </clef>');
        }

        xmlLines.push('      </attributes>');
      }

      // Tempo Map (si el primer compás tiene tempo explícito en timeline)
      if (isFirstMeasure && !payload.timeline.tempoMap.isUnresolved && payload.timeline.tempoMap.events.length > 0) {
        const firstTempo = payload.timeline.tempoMap.events[0];
        if (firstTempo) {
          xmlLines.push('      <direction placement="above">');
          xmlLines.push('        <direction-type>');
          xmlLines.push(`          <metronome parentheses="no"><beat-unit>quarter</beat-unit><per-minute>${firstTempo.bpm}</per-minute></metronome>`);
          xmlLines.push('        </direction-type>');
          xmlLines.push(`        <sound tempo="${firstTempo.bpm}"/>`);
          xmlLines.push('      </direction>');
        }
      }

      if (measure) {
        // Armonías / Acordes en el compás
        if (includeHarmonies && measure.chords.length > 0) {
          for (const chordEvent of measure.chords) {
            xmlLines.push(...this.serializeHarmony(chordEvent));
          }
        }

        // Eventos musicales: Notas y Silencios ordenados por voz y por tick
        const notesAndRests = this.collectMeasureEvents(measure);
        const boundLyricIds = new Set<string>();

        if (notesAndRests.length > 0) {
          for (const event of notesAndRests) {
            if (event.isRest) {
              xmlLines.push(...this.serializeRest(event));
            } else {
              let boundLyric: LyricSyllable | undefined = undefined;
              if (includeLyrics) {
                boundLyric = this.findLyricForNote(event, measure);
                if (boundLyric) {
                  boundLyricIds.add(boundLyric.id);
                }
              }
              xmlLines.push(...this.serializeNote(event, boundLyric));
            }
          }

          // Emitir cualquier sílaba lírica no ligada a notas como palabras de dirección
          if (includeLyrics) {
            for (const lyric of measure.lyrics) {
              if (!boundLyricIds.has(lyric.id)) {
                xmlLines.push('      <direction placement="below">');
                xmlLines.push('        <direction-type>');
                xmlLines.push(`          <words font-style="italic">${this.escapeXml(lyric.text)}</words>`);
                xmlLines.push('        </direction-type>');
                xmlLines.push('      </direction>');
              }
            }
          }
        } else if (measure.lyrics.length > 0) {
          // Si hay lírica sin notas melódicas (ej. cancionero de texto), emitir como palabras de dirección
          for (const lyric of measure.lyrics) {
            xmlLines.push('      <direction placement="below">');
            xmlLines.push('        <direction-type>');
            xmlLines.push(`          <words font-style="italic">${this.escapeXml(lyric.text)}</words>`);
            xmlLines.push('        </direction-type>');
            xmlLines.push('      </direction>');
          }
        }
      }

      xmlLines.push('    </measure>');
    }

    xmlLines.push('  </part>');
    xmlLines.push('</score-partwise>');

    const content = xmlLines.join('\n');
    const safeTitle = payload.title.replace(/[^a-zA-Z0-9_\-]/g, '_').toLowerCase();

    return {
      success: true,
      targetFormat: 'MUSIC_XML',
      filename: `${safeTitle}.musicxml`,
      mimeType: 'application/vnd.recordare.musicxml+xml',
      content,
      canonicalPayload: payload,
      diagnostics,
    };
  }

  private static collectMeasureEvents(measure: Measure): (Note | Rest)[] {
    const events: (Note | Rest)[] = [];
    for (const voice of measure.voices) {
      events.push(...voice.events);
    }
    // Ordenar de forma determinista por startTick y luego por número de voz
    events.sort((a, b) => {
      if (a.startTick !== b.startTick) return a.startTick - b.startTick;
      return a.voice - b.voice;
    });
    return events;
  }

  private static findLyricForNote(note: Note, measure: Measure): LyricSyllable | undefined {
    // 1. Por boundNoteId explícito
    const byId = measure.lyrics.find((l) => l.boundNoteId === note.id);
    if (byId) return byId;

    // 2. Por coincidencia exacta de tickOffset si existe
    if (measure.startTick !== null) {
      const noteRelTick = note.startTick - measure.startTick;
      const byTick = measure.lyrics.find((l) => l.tickOffset === noteRelTick);
      if (byTick) return byTick;
    }

    return undefined;
  }

  private static serializeNote(note: Note, lyric?: LyricSyllable): string[] {
    const lines: string[] = [];
    lines.push('      <note>');

    // Altura (Pitch)
    const baseLetter = note.pitch.noteName.letter;
    const alter = note.pitch.noteName.accidental.semitoneOffset;
    const octave = note.pitch.octave;

    lines.push('        <pitch>');
    lines.push(`          <step>${baseLetter}</step>`);
    if (alter !== 0) {
      lines.push(`          <alter>${alter}</alter>`);
    }
    lines.push(`          <octave>${octave}</octave>`);
    lines.push('        </pitch>');

    // Duración en ticks (divisions = 480)
    lines.push(`        <duration>${note.durationTicks}</duration>`);
    lines.push(`        <voice>${note.voice}</voice>`);

    const noteType = this.ticksToNoteType(note.durationTicks);
    if (noteType) {
      lines.push(`        <type>${noteType}</type>`);
    }

    // Ligaduras (Ties)
    if (note.tie === 'START') {
      lines.push('        <tie type="start"/>');
    } else if (note.tie === 'STOP') {
      lines.push('        <tie type="stop"/>');
    } else if (note.tie === 'CONTINUE') {
      lines.push('        <tie type="stop"/>');
      lines.push('        <tie type="start"/>');
    }

    // Notaciones ligadas
    if (note.tie !== 'NONE') {
      lines.push('        <notations>');
      if (note.tie === 'STOP') {
        lines.push('          <tied type="stop"/>');
      } else if (note.tie === 'START') {
        lines.push('          <tied type="start"/>');
      } else if (note.tie === 'CONTINUE') {
        lines.push('          <tied type="stop"/>');
        lines.push('          <tied type="start"/>');
      }
      lines.push('        </notations>');
    }

    // Lírica
    if (lyric) {
      lines.push('        <lyric>');
      lines.push(`          <syllabic>${lyric.isHyphenated ? 'begin' : 'single'}</syllabic>`);
      lines.push(`          <text>${this.escapeXml(lyric.text)}</text>`);
      lines.push('        </lyric>');
    }

    lines.push('      </note>');
    return lines;
  }

  private static serializeRest(rest: Rest): string[] {
    const lines: string[] = [];
    lines.push('      <note>');
    lines.push('        <rest/>');
    lines.push(`        <duration>${rest.durationTicks}</duration>`);
    lines.push(`        <voice>${rest.voice}</voice>`);
    const noteType = this.ticksToNoteType(rest.durationTicks);
    if (noteType) {
      lines.push(`        <type>${noteType}</type>`);
    }
    lines.push('      </note>');
    return lines;
  }

  private static serializeHarmony(chordEvent: ChordEvent): string[] {
    const lines: string[] = [];
    const rootName = chordEvent.chord.root;
    const baseLetter = rootName.letter;
    const alter = rootName.accidental.semitoneOffset;
    const quality = chordEvent.chord.quality;

    let kindXml = 'major';
    if (quality === 'MINOR') kindXml = 'minor';
    else if (quality === 'DOMINANT_7') kindXml = 'dominant';
    else if (quality === 'MAJOR_7') kindXml = 'major-seventh';
    else if (quality === 'MINOR_7') kindXml = 'minor-seventh';
    else if (quality === 'DIMINISHED') kindXml = 'diminished';
    else if (quality === 'DIMINISHED_7') kindXml = 'diminished-seventh';
    else if (quality === 'HALF_DIMINISHED_7') kindXml = 'half-diminished';
    else if (quality === 'AUGMENTED') kindXml = 'augmented';
    else if (quality === 'AUGMENTED_7') kindXml = 'augmented-seventh';
    else if (quality === 'SUSPENDED_4') kindXml = 'suspended-fourth';
    else if (quality === 'SUSPENDED_2') kindXml = 'suspended-second';
    else if (quality === 'MAJOR_6') kindXml = 'major-sixth';
    else if (quality === 'MINOR_6') kindXml = 'minor-sixth';
    else if (quality === 'POWER_5') kindXml = 'power';

    lines.push('      <harmony>');
    lines.push('        <root>');
    lines.push(`          <root-step>${baseLetter}</root-step>`);
    if (alter !== 0) {
      lines.push(`          <root-alter>${alter}</root-alter>`);
    }
    lines.push('        </root>');
    lines.push(`        <kind text="${this.escapeXml(chordEvent.chord.toString())}">${kindXml}</kind>`);

    if (chordEvent.chord.bass) {
      const bassLetter = chordEvent.chord.bass.letter;
      const bassAlter = chordEvent.chord.bass.accidental.semitoneOffset;
      lines.push('        <bass>');
      lines.push(`          <bass-step>${bassLetter}</bass-step>`);
      if (bassAlter !== 0) {
        lines.push(`          <bass-alter>${bassAlter}</bass-alter>`);
      }
      lines.push('        </bass>');
    }

    lines.push('      </harmony>');
    return lines;
  }

  private static ticksToNoteType(ticks: number): string | null {
    // Basado en divisions = 480 TPQN
    if (ticks >= 1920) return 'whole';
    if (ticks >= 960) return 'half';
    if (ticks >= 480) return 'quarter';
    if (ticks >= 240) return 'eighth';
    if (ticks >= 120) return '16th';
    if (ticks >= 60) return '32nd';
    return null;
  }

  private static escapeXml(unsafe: string): string {
    return unsafe
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }
}
