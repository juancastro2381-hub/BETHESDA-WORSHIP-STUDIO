/**
 * @file canonical-music-payload.ts
 * @description Raíz de agregación canónica (CanonicalMusicPayload).
 * Representa la verdad musical completa de un Arreglo (ARRANGEMENT.canonical_music_payload)
 * y es la única fuente de verdad para notas, acordes, compases y lírica.
 */

import { ChordEvent } from './chord-event.ts';
import { InstrumentTrack, type InstrumentTrackJSON } from './instrument-track.ts';
import { LyricSyllable } from './lyric-syllable.ts';
import { Measure, type MeasureJSON } from './measure.ts';
import { Note, Rest } from './musical-event.ts';
import { Section, type SectionJSON } from './section.ts';
import { Timeline, type TimelineJSON } from './timeline.ts';

export interface CanonicalMusicPayloadJSON {
  version: string;
  title: string;
  timeline: TimelineJSON;
  sections: SectionJSON[];
  measures: MeasureJSON[];
  instrumentTracks: InstrumentTrackJSON[];
}

export class CanonicalMusicPayload {
  public static readonly CURRENT_VERSION = '1.0.0';

  public readonly version: string;
  public readonly title: string;
  public readonly timeline: Timeline;
  public readonly sections: readonly Section[];
  public readonly measures: readonly Measure[];
  public readonly instrumentTracks: readonly InstrumentTrack[];

  public constructor(init: {
    version?: string;
    title: string;
    timeline: Timeline;
    sections?: Section[];
    measures?: Measure[];
    instrumentTracks?: InstrumentTrack[];
  }) {
    if (!init.title || typeof init.title !== 'string') {
      throw new Error(`Título de obra requerido e inválido: ${init.title}`);
    }
    if (!init.timeline || !(init.timeline instanceof Timeline)) {
      throw new Error(`Timeline inválido en CanonicalMusicPayload`);
    }

    this.version = init.version ?? CanonicalMusicPayload.CURRENT_VERSION;
    this.title = init.title.trim();
    this.timeline = init.timeline;
    this.sections = Object.freeze([...(init.sections ?? [])]);
    this.measures = Object.freeze([...(init.measures ?? [])]);
    this.instrumentTracks = Object.freeze([...(init.instrumentTracks ?? [])]);
  }

  public getMeasure(measureNumber: number): Measure | undefined {
    return this.measures.find((m) => m.number === measureNumber);
  }

  public getSectionForMeasure(measureNumber: number): Section | undefined {
    return this.sections.find((s) => s.containsMeasure(measureNumber));
  }

  public getAllNotes(): Note[] {
    return this.measures.flatMap((m) => m.getAllNotes());
  }

  public getAllRests(): Rest[] {
    return this.measures.flatMap((m) => m.getAllRests());
  }

  public getAllChords(): ChordEvent[] {
    return this.measures.flatMap((m) => m.chords);
  }

  public getAllLyrics(): LyricSyllable[] {
    return this.measures.flatMap((m) => m.lyrics);
  }

  public getTrack(trackId: string): InstrumentTrack | undefined {
    return this.instrumentTracks.find((t) => t.id === trackId);
  }

  /**
   * Obtiene los eventos proyectados para una pista instrumental específica
   * filtrando las voces canónicas referenciadas por la pista, sin duplicar notas.
   */
  public getTrackEvents(
    trackId: string
  ): { measureNumber: number; notes: Note[]; rests: Rest[] }[] {
    const track = this.getTrack(trackId);
    if (!track) {
      throw new Error(`Pista instrumental no encontrada: ${trackId}`);
    }

    const voiceSet = new Set(track.voiceIds);
    return this.measures.map((m) => {
      const notes: Note[] = [];
      const rests: Rest[] = [];
      for (const voice of m.voices) {
        if (voiceSet.has(voice.id)) {
          notes.push(...voice.getNotes());
          rests.push(...voice.getRests());
        }
      }
      return {
        measureNumber: m.number,
        notes,
        rests,
      };
    });
  }

  public toJSON(): CanonicalMusicPayloadJSON {
    return {
      version: this.version,
      title: this.title,
      timeline: this.timeline.toJSON(),
      sections: this.sections.map((s) => s.toJSON()),
      measures: this.measures.map((m) => m.toJSON()),
      instrumentTracks: this.instrumentTracks.map((t) => t.toJSON()),
    };
  }

  public static fromJSON(
    input: CanonicalMusicPayloadJSON | string
  ): CanonicalMusicPayload {
    const json: CanonicalMusicPayloadJSON =
      typeof input === 'string' ? JSON.parse(input) : input;

    const timeline = Timeline.fromJSON(json.timeline);
    const sections = (json.sections || []).map((s) => Section.fromJSON(s));
    const measures = (json.measures || []).map((m) => Measure.fromJSON(m));
    const instrumentTracks = (json.instrumentTracks || []).map((t) =>
      InstrumentTrack.fromJSON(t)
    );

    return new CanonicalMusicPayload({
      version: json.version,
      title: json.title,
      timeline,
      sections,
      measures,
      instrumentTracks,
    });
  }
}
