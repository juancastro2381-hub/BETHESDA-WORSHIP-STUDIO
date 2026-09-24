/**
 * @file alphatab-adapter.ts
 * @description Adaptador aislado para AlphaTab (Fase 1E & 1F).
 *
 * Responsabilidades:
 * - Recibir DerivedMusicalView
 * - Convertir los datos proyectados en el modelo de partitura/tablatura de AlphaTab (AlphaTabScoreData)
 * - Renderizado en navegador real utilizando AlphaTabApi sobre contenedor DOM
 * - Preservar semántica de tono canónico y tono escrito
 * - Preservar proyección de cejilla (Capo) y coordenadas de tablatura
 * - Preservar proyección por instrumento
 * - Manejo de ciclo de vida (initialize, render, update, resize, dispose)
 * - Cero mutación de CanonicalMusicPayload
 */

import * as alphaTab from '@coderline/alphatab';
import { type ClefType, type TieType } from '../../canonical-model/types.ts';
import { type DerivedMusicalView } from '../../projection/derived-musical-view.ts';
import { type ViewRepresentation } from '../../projection/types.ts';
import { BaseMusicRenderer } from '../renderer-contract.ts';
import { type RendererCapabilities, type RendererId } from '../types.ts';
import { AlphaTexGenerator } from '../utils/alphatex-generator.ts';

export interface AlphaTabNoteData {
  string: number;
  fret: number;
  pitchMidi: number;
  canonicalPitch: string;
  writtenPitch: string;
  tie: TieType;
  durationTicks: number;
}

export interface AlphaTabBeatData {
  startTick: number;
  durationTicks: number;
  notes: AlphaTabNoteData[];
  chord?: {
    name: string;
    fingeringName: string;
    soundingName: string;
  } | undefined;
  lyrics?: string[] | undefined;
}

export interface AlphaTabVoiceData {
  voiceId: number;
  beats: AlphaTabBeatData[];
}

export interface AlphaTabBarData {
  barNumber: number;
  timeSignature: string;
  keySignatureAccidentals: number;
  voices: AlphaTabVoiceData[];
}

export interface AlphaTabStaffData {
  isStandardNotation: boolean;
  isTablature: boolean;
  clef: ClefType;
  bars: AlphaTabBarData[];
}

export interface AlphaTabTrackData {
  id: string;
  name: string;
  capo: number;
  tuning: string[];
  staves: AlphaTabStaffData[];
}

export interface AlphaTabScoreData {
  title: string;
  concertKey: string;
  writtenKey: string;
  capo: number;
  tracks: AlphaTabTrackData[];
}

export class AlphaTabAdapter extends BaseMusicRenderer<AlphaTabScoreData> {
  public readonly id: RendererId = 'ALPHATAB';
  public readonly name = 'AlphaTab Engine Adapter';

  private alphaTabApi?: alphaTab.AlphaTabApi | undefined;
  private resizeObserver?: ResizeObserver | undefined;

  public readonly capabilities: RendererCapabilities = {
    rendererId: 'ALPHATAB',
    name: 'AlphaTab',
    supportedRepresentations: [
      'STANDARD_NOTATION',
      'TABLATURE',
      'CHORDS',
      'LYRICS',
      'SECTION_MARKERS',
      'PERCUSSION_NOTATION',
    ],
    supportsPolyphony: true,
    supportsTablature: true,
    supportsGrandStaff: false,
    supportsLyrics: true,
    supportsChords: true,
    supportsPercussion: true,
    canRender: (requested: readonly ViewRepresentation[]): boolean => {
      if (requested.includes('GRAND_STAFF')) {
        return false;
      }
      return requested.every((rep) =>
        [
          'STANDARD_NOTATION',
          'TABLATURE',
          'CHORDS',
          'LYRICS',
          'SECTION_MARKERS',
          'PERCUSSION_NOTATION',
        ].includes(rep)
      );
    },
  };

  public override dispose(): void {
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = undefined;
    }
    if (this.alphaTabApi) {
      try {
        this.alphaTabApi.destroy();
      } catch {
        // Ignorar fallos de limpieza en destrucción de canvas/svg
      }
      this.alphaTabApi = undefined;
    }
    const container = this.getContainerElement();
    if (container) {
      container.replaceChildren();
    }
    super.dispose();
  }

  protected convertViewToData(view: DerivedMusicalView): AlphaTabScoreData {
    this.clearDiagnostics();

    const isTabRequested = view.activeRepresentations.includes('TABLATURE');
    const isNotationRequested = view.activeRepresentations.includes('STANDARD_NOTATION');

    // Mapear afinación
    const tuningPitches = view.instrumentProfile.tuning
      ? view.instrumentProfile.tuning.stringPitches.map((p) => p.toString())
      : [];

    const trackStaves: AlphaTabStaffData[] = [];
    const staffClef = view.measures[0]?.clefs[0] ?? view.instrumentProfile.clef;

    const bars: AlphaTabBarData[] = view.measures.map((measure) => {
      const timeSigStr = `${measure.timeSignature.numerator}/${measure.timeSignature.denominator}`;
      const keyAccidentals = measure.writtenKeySignature.keySignature.accidentalCount;

      const voiceBeatsMap = new Map<number, AlphaTabBeatData[]>();

      for (const note of measure.notes) {
        let beats = voiceBeatsMap.get(note.voice);
        if (!beats) {
          beats = [];
          voiceBeatsMap.set(note.voice, beats);
        }

        const tabCoord = measure.tablature.find(
          (t) =>
            t.canonicalPitch.midiNumber === note.canonicalPitch.midiNumber &&
            t.durationTicks === note.durationTicks
        );

        const noteData: AlphaTabNoteData = {
          string: tabCoord ? tabCoord.stringNumber : 1,
          fret: tabCoord ? tabCoord.fret : 0,
          pitchMidi: note.writtenPitch.midiNumber,
          canonicalPitch: note.canonicalPitch.toString(),
          writtenPitch: note.writtenPitch.toString(),
          tie: note.tie,
          durationTicks: note.durationTicks,
        };

        let existingBeat = beats.find((b) => b.startTick === note.startTick);
        if (!existingBeat) {
          existingBeat = {
            startTick: note.startTick,
            durationTicks: note.durationTicks,
            notes: [],
          };
          beats.push(existingBeat);
        }
        existingBeat.notes.push(noteData);
      }

      if (measure.notes.length === 0 && measure.chords.length > 0) {
        const defaultBeats: AlphaTabBeatData[] = measure.chords.map((ch) => ({
          startTick: ch.startTick,
          durationTicks: ch.durationTicks ?? 480,
          notes: [],
          chord: {
            name: ch.displayString,
            fingeringName: ch.fingeringChord.toString(),
            soundingName: ch.soundingDisplayString,
          },
        }));
        voiceBeatsMap.set(1, defaultBeats);
      } else {
        const v1Beats = voiceBeatsMap.get(1) ?? [];
        for (const ch of measure.chords) {
          const beat = v1Beats.find((b) => b.startTick === ch.startTick);
          if (beat) {
            beat.chord = {
              name: ch.displayString,
              fingeringName: ch.fingeringChord.toString(),
              soundingName: ch.soundingDisplayString,
            };
          }
        }
        for (const lyr of measure.lyrics) {
          const beat = v1Beats.find((b) => b.startTick === lyr.tickOffset);
          if (beat) {
            if (!beat.lyrics) beat.lyrics = [];
            beat.lyrics.push(lyr.text);
          }
        }
      }

      const voicesData: AlphaTabVoiceData[] = Array.from(voiceBeatsMap.entries()).map(
        ([voiceId, beats]) => ({
          voiceId,
          beats: beats.sort((a, b) => a.startTick - b.startTick),
        })
      );

      return {
        barNumber: measure.measureNumber,
        timeSignature: timeSigStr,
        keySignatureAccidentals: keyAccidentals,
        voices: voicesData,
      };
    });

    trackStaves.push({
      isStandardNotation: isNotationRequested,
      isTablature: isTabRequested,
      clef: staffClef,
      bars,
    });

    const track: AlphaTabTrackData = {
      id: `track-${view.instrumentProfile.id}`,
      name: view.instrumentProfile.name,
      capo: view.capoFret,
      tuning: tuningPitches,
      staves: trackStaves,
    };

    const scoreData: AlphaTabScoreData = {
      title: view.songTitle,
      concertKey: view.concertKey.toString(),
      writtenKey: view.writtenKey.toString(),
      capo: view.capoFret,
      tracks: [track],
    };

    // Renderizado en navegador real si el contenedor y DOM están disponibles
    const container = this.getContainerElement();
    if (container && typeof window !== 'undefined' && typeof document !== 'undefined') {
      this.renderToBrowser(container, view);
    }

    return scoreData;
  }

  private renderToBrowser(container: HTMLElement, view: DerivedMusicalView): void {
    const isTabOnly = view.activeRepresentations.includes('TABLATURE') && !view.activeRepresentations.includes('STANDARD_NOTATION');
    const isNotationOnly = view.activeRepresentations.includes('STANDARD_NOTATION') && !view.activeRepresentations.includes('TABLATURE');

    let staveProfile = alphaTab.StaveProfile.ScoreTab;
    if (isTabOnly) {
      staveProfile = alphaTab.StaveProfile.Tab;
    } else if (isNotationOnly) {
      staveProfile = alphaTab.StaveProfile.Score;
    }

    if (!this.alphaTabApi) {
      container.replaceChildren();
      this.alphaTabApi = new alphaTab.AlphaTabApi(container, {
        core: {
          tex: true,
          engine: 'svg',
          logLevel: alphaTab.LogLevel.None,
          useWorkers: false,
        },
        display: {
          staveProfile,
        },
      });

      if (typeof ResizeObserver !== 'undefined' && !this.resizeObserver) {
        this.resizeObserver = new ResizeObserver(() => {
          if (this.alphaTabApi) {
            this.alphaTabApi.render();
          }
        });
        this.resizeObserver.observe(container);
      }
    }

    const tex = AlphaTexGenerator.generate(view);
    this.alphaTabApi.tex(tex);
  }

  private getContainerElement(): HTMLElement | null {
    if (!this._target?.container) return null;
    if (typeof HTMLElement !== 'undefined' && this._target.container instanceof HTMLElement) {
      return this._target.container;
    }
    return null;
  }
}
