/**
 * @file osmd-adapter.ts
 * @description Adaptador aislado para OpenSheetMusicDisplay (OSMD) (Fase 1E & 1F).
 *
 * Responsabilidades:
 * - Consumir DerivedMusicalView
 * - Proveer soporte de notación estándar y Gran Pentagrama (Grand Staff)
 * - Renderizado visual real en navegador montando sobre contenedor DOM vía OpenSheetMusicDisplay
 * - Preservar tono escrito para instrumentos transpositores (ej. Eb, Bb, F)
 * - Preservar estructura de compases, polifonía de voces y letras
 * - Manejo de ciclo de vida (initialize, render, update, resize, dispose)
 * - OSMD jamás se convierte en dependencia del dominio ni muta el modelo canónico
 */

import osmdModule from 'opensheetmusicdisplay';
import { type ClefType } from '../../canonical-model/types.ts';
import { type DerivedMusicalView } from '../../projection/derived-musical-view.ts';
import { type ViewRepresentation } from '../../projection/types.ts';
import { BaseMusicRenderer } from '../renderer-contract.ts';
import { type RendererCapabilities, type RendererId } from '../types.ts';
import { MusicXmlGenerator } from '../utils/musicxml-generator.ts';

export interface OsmdEntryData {
  type: 'NOTE' | 'REST';
  startTick: number;
  durationTicks: number;
  step: string;
  octave: number;
  alter: number;
  midi: number;
  canonicalPitch: string;
  writtenPitch: string;
  lyrics: string[];
  chord: string | null;
}

export interface OsmdVoiceData {
  voiceId: number;
  entries: OsmdEntryData[];
}

export interface OsmdStaffData {
  staffNumber: number;
  clef: ClefType;
  voices: OsmdVoiceData[];
}

export interface OsmdMeasureData {
  measureNumber: number;
  timeSignature: {
    beats: number;
    beatType: number;
  };
  staves: OsmdStaffData[];
}

export interface OsmdScoreData {
  workTitle: string;
  partName: string;
  stavesCount: number;
  clefs: ClefType[];
  writtenKeySignature: {
    tonic: string;
    mode: string;
    fifths: number;
  };
  concertKeySignature: {
    tonic: string;
    mode: string;
  };
  measures: OsmdMeasureData[];
}

export class OsmdAdapter extends BaseMusicRenderer<OsmdScoreData> {
  public readonly id: RendererId = 'OSMD';
  public readonly name = 'OpenSheetMusicDisplay Engine Adapter';

  private osmdInstance?: unknown | undefined;
  private resizeObserver?: ResizeObserver | undefined;

  public readonly capabilities: RendererCapabilities = {
    rendererId: 'OSMD',
    name: 'OpenSheetMusicDisplay',
    supportedRepresentations: [
      'STANDARD_NOTATION',
      'GRAND_STAFF',
      'CHORDS',
      'LYRICS',
      'SECTION_MARKERS',
    ],
    supportsPolyphony: true,
    supportsTablature: false,
    supportsGrandStaff: true,
    supportsLyrics: true,
    supportsChords: true,
    supportsPercussion: false,
    canRender: (requested: readonly ViewRepresentation[]): boolean => {
      if (requested.includes('TABLATURE') || requested.includes('PERCUSSION_NOTATION')) {
        return false;
      }
      return requested.every((rep) =>
        [
          'STANDARD_NOTATION',
          'GRAND_STAFF',
          'CHORDS',
          'LYRICS',
          'SECTION_MARKERS',
        ].includes(rep)
      );
    },
  };

  public override dispose(): void {
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = undefined;
    }
    if (this.osmdInstance && typeof (this.osmdInstance as { clear?: () => void }).clear === 'function') {
      try {
        (this.osmdInstance as { clear: () => void }).clear();
      } catch {
        // Ignorar fallos de limpieza
      }
      this.osmdInstance = undefined;
    }
    const container = this.getContainerElement();
    if (container) {
      container.replaceChildren();
    }
    super.dispose();
  }

  protected convertViewToData(view: DerivedMusicalView): OsmdScoreData {
    this.clearDiagnostics();

    const isGrandStaff =
      view.activeRepresentations.includes('GRAND_STAFF') ||
      view.instrumentProfile.staffCount === 2;

    const stavesCount = isGrandStaff ? 2 : 1;
    const defaultClefs: ClefType[] = isGrandStaff
      ? ['TREBLE', 'BASS']
      : [view.measures[0]?.clefs[0] ?? view.instrumentProfile.clef];

    const osmdMeasures: OsmdMeasureData[] = view.measures.map((measure) => {
      const beats = measure.timeSignature.numerator;
      const beatType = measure.timeSignature.denominator;

      const staves: OsmdStaffData[] = [];

      for (let staffIdx = 0; staffIdx < stavesCount; staffIdx++) {
        const staffNumber = staffIdx + 1;
        const clef = defaultClefs[staffIdx] ?? 'TREBLE';

        const staffNotes = measure.notes.filter((n) => n.staff === staffNumber);
        const voiceMap = new Map<number, OsmdEntryData[]>();

        for (const note of staffNotes) {
          let entries = voiceMap.get(note.voice);
          if (!entries) {
            entries = [];
            voiceMap.set(note.voice, entries);
          }

          const lyrics = measure.lyrics
            .filter((l) => l.tickOffset === note.startTick || l.boundNoteId === note.id)
            .map((l) => l.text);

          const chordEvent = measure.chords.find((c) => c.startTick === note.startTick);

          entries.push({
            type: 'NOTE',
            startTick: note.startTick,
            durationTicks: note.durationTicks,
            step: note.writtenPitch.noteName.letter,
            octave: note.writtenPitch.octave,
            alter: note.writtenPitch.noteName.accidental.semitoneOffset,
            midi: note.writtenPitch.midiNumber,
            canonicalPitch: note.canonicalPitch.toString(),
            writtenPitch: note.writtenPitch.toString(),
            lyrics,
            chord: chordEvent ? chordEvent.displayString : null,
          });
        }

        const voices: OsmdVoiceData[] = Array.from(voiceMap.entries()).map(
          ([voiceId, entries]) => ({
            voiceId,
            entries: entries.sort((a, b) => a.startTick - b.startTick),
          })
        );

        staves.push({
          staffNumber,
          clef,
          voices,
        });
      }

      return {
        measureNumber: measure.measureNumber,
        timeSignature: { beats, beatType },
        staves,
      };
    });

    const scoreData: OsmdScoreData = {
      workTitle: view.songTitle,
      partName: view.instrumentProfile.name,
      stavesCount,
      clefs: defaultClefs,
      writtenKeySignature: {
        tonic: view.writtenKey.tonic.toString(),
        mode: view.writtenKey.mode,
        fifths: view.writtenKey.keySignature.accidentalCount,
      },
      concertKeySignature: {
        tonic: view.concertKey.tonic.toString(),
        mode: view.concertKey.mode,
      },
      measures: osmdMeasures,
    };

    // Renderizado en navegador real si el contenedor y DOM están disponibles
    const container = this.getContainerElement();
    if (container && typeof window !== 'undefined' && typeof document !== 'undefined') {
      this.renderToBrowser(container, view);
    }

    return scoreData;
  }

  private renderToBrowser(container: HTMLElement, view: DerivedMusicalView): void {
    const rawOsmd = (osmdModule as unknown as { OpenSheetMusicDisplay?: unknown; default?: { OpenSheetMusicDisplay?: unknown } });
    const OSMDConstructor = (rawOsmd.OpenSheetMusicDisplay ?? rawOsmd.default?.OpenSheetMusicDisplay) as
      | (new (target: HTMLElement, options?: Record<string, unknown>) => {
          load(xml: string): Promise<void>;
          render(): void;
          clear(): void;
        })
      | undefined;

    if (!OSMDConstructor) {
      this.addDiagnostic('WARNING', 'OSMD_CONSTRUCTOR_NOT_FOUND', 'Constructor OpenSheetMusicDisplay no localizado.');
      return;
    }

    const xml = MusicXmlGenerator.generate(view);

    if (!this.osmdInstance) {
      container.replaceChildren();
      this.osmdInstance = new OSMDConstructor(container, {
        autoResize: true,
        drawTitle: true,
        drawSubtitle: false,
        drawComposer: false,
        backend: 'svg',
      });

      if (typeof ResizeObserver !== 'undefined' && !this.resizeObserver) {
        this.resizeObserver = new ResizeObserver(() => {
          if (this.osmdInstance && typeof (this.osmdInstance as { render?: () => void }).render === 'function') {
            (this.osmdInstance as { render: () => void }).render();
          }
        });
        this.resizeObserver.observe(container);
      }
    }

    const instance = this.osmdInstance as { load(xml: string): Promise<void>; render(): void };
    instance.load(xml).then(() => {
      instance.render();
    }).catch((err: unknown) => {
      this.addDiagnostic(
        'ERROR',
        'OSMD_RENDER_FAILED',
        `Fallo al cargar MusicXML en OSMD: ${err instanceof Error ? err.message : String(err)}`
      );
    });
  }

  private getContainerElement(): HTMLElement | null {
    if (!this._target?.container) return null;
    if (typeof HTMLElement !== 'undefined' && this._target.container instanceof HTMLElement) {
      return this._target.container;
    }
    return null;
  }
}
