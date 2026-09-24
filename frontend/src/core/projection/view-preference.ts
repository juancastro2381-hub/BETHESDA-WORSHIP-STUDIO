/**
 * @file view-preference.ts
 * @description Modelo de dominio para las preferencias de visualización del músico (Fase 1D).
 * Totalmente desacoplado de React, renderizadores visuales y estado efímero de UI.
 */

import { type ClefType } from '../canonical-model/types.ts';
import { type ChordNotationSystem, type ViewRepresentation } from './types.ts';

export interface ViewPreferenceInit {
  instrumentId: string;
  primaryRepresentation: ViewRepresentation;
  secondaryRepresentations?: ViewRepresentation[] | undefined;
  chordNotationSystem?: ChordNotationSystem | undefined;
  transpositionSemitones?: number | undefined;
  capoFret?: number | undefined;
  clefOverride?: ClefType | undefined;
  preferFlats?: boolean | undefined;
}

export class ViewPreference {
  public readonly instrumentId: string;
  public readonly primaryRepresentation: ViewRepresentation;
  public readonly secondaryRepresentations: readonly ViewRepresentation[];
  public readonly chordNotationSystem: ChordNotationSystem;
  public readonly transpositionSemitones: number;
  public readonly capoFret: number;
  public readonly clefOverride?: ClefType | undefined;
  public readonly preferFlats: boolean;

  public constructor(init: ViewPreferenceInit) {
    if (!init.instrumentId || typeof init.instrumentId !== 'string') {
      throw new Error(`ID de instrumento requerido en ViewPreference: ${init.instrumentId}`);
    }
    if (!init.primaryRepresentation) {
      throw new Error(`primaryRepresentation requerida en ViewPreference`);
    }

    this.instrumentId = init.instrumentId.trim();
    this.primaryRepresentation = init.primaryRepresentation;
    this.secondaryRepresentations = Object.freeze([
      ...(init.secondaryRepresentations ?? []).filter((r) => r !== init.primaryRepresentation),
    ]);
    this.chordNotationSystem = init.chordNotationSystem ?? 'STANDARD';
    this.transpositionSemitones = init.transpositionSemitones ?? 0;

    const capo = init.capoFret ?? 0;
    if (!Number.isInteger(capo) || capo < 0 || capo > 12) {
      throw new Error(`Capo fuera de rango válido (0 a 12): ${capo}`);
    }
    this.capoFret = capo;

    if (init.clefOverride) {
      this.clefOverride = init.clefOverride;
    }
    this.preferFlats = init.preferFlats ?? false;
  }

  /**
   * Obtiene la lista completa y unificada de representaciones solicitadas por el músico.
   */
  public getAllRequestedRepresentations(): ViewRepresentation[] {
    const list: ViewRepresentation[] = [this.primaryRepresentation];
    for (const sec of this.secondaryRepresentations) {
      if (!list.includes(sec)) {
        list.push(sec);
      }
    }
    return list;
  }

  public withTransposition(semitones: number): ViewPreference {
    return new ViewPreference({
      instrumentId: this.instrumentId,
      primaryRepresentation: this.primaryRepresentation,
      secondaryRepresentations: [...this.secondaryRepresentations],
      chordNotationSystem: this.chordNotationSystem,
      transpositionSemitones: semitones,
      capoFret: this.capoFret,
      clefOverride: this.clefOverride,
      preferFlats: this.preferFlats,
    });
  }

  public withCapo(fret: number): ViewPreference {
    return new ViewPreference({
      instrumentId: this.instrumentId,
      primaryRepresentation: this.primaryRepresentation,
      secondaryRepresentations: [...this.secondaryRepresentations],
      chordNotationSystem: this.chordNotationSystem,
      transpositionSemitones: this.transpositionSemitones,
      capoFret: fret,
      clefOverride: this.clefOverride,
      preferFlats: this.preferFlats,
    });
  }

  public withChordNotationSystem(system: ChordNotationSystem): ViewPreference {
    return new ViewPreference({
      instrumentId: this.instrumentId,
      primaryRepresentation: this.primaryRepresentation,
      secondaryRepresentations: [...this.secondaryRepresentations],
      chordNotationSystem: system,
      transpositionSemitones: this.transpositionSemitones,
      capoFret: this.capoFret,
      clefOverride: this.clefOverride,
      preferFlats: this.preferFlats,
    });
  }
}
