/**
 * @file tablature-calculator.ts
 * @description Calculador ergonómico y determinista de tablatura para instrumentos de cuerda (Guitarra, Bajo).
 * Mapea alturas musicales canónicas a coordenadas (cuerda, traste) respetando afinación, cejilla (Capo),
 * límite físico del diapasón, colisiones de notas simultáneas y continuidad de posición en el mástil.
 */

import { type Pitch } from '../music-theory/pitch.ts';
import { type TabPosition, type TuningDefinition } from './types.ts';

export interface TabCandidate {
  stringNumber: number; // 1 a N
  fret: number;
}

export interface TablatureSelectionContext {
  readonly previousFret?: number | null | undefined;
  readonly previousString?: number | null | undefined;
  readonly usedStringsAtTick?: ReadonlySet<number> | undefined;
}

const DEFAULT_MAX_FRET = 20;

export class TablatureCalculator {
  /**
   * Calcula la posición óptima de tablatura (cuerda y traste) para una altura dada,
   * afinación, traste de cejilla y contexto ergonómico opcional.
   *
   * Retorna null si la nota excede el rango físico del instrumento (NUNCA inventa 0 ni trastes fuera de rango).
   */
  public static calculatePosition(
    pitch: Pitch,
    tuning: TuningDefinition,
    capoFret = 0,
    durationTicks: number | null = 480,
    voice = 1,
    context?: TablatureSelectionContext
  ): TabPosition | null {
    const candidates = TablatureCalculator.findCandidates(pitch, tuning, capoFret);

    if (candidates.length === 0) {
      return null;
    }

    const available = context?.usedStringsAtTick
      ? candidates.filter((c) => !context.usedStringsAtTick!.has(c.stringNumber))
      : candidates;

    if (available.length === 0) {
      // Todas las cuerdas válidas para esta altura ya están ocupadas en el mismo tick simultáneo
      return null;
    }

    const best = TablatureCalculator.selectBestCandidate(available, context);

    return {
      stringNumber: best.stringNumber,
      fret: best.fret,
      canonicalPitch: pitch,
      durationTicks,
      voice,
      tuningReference: tuning.name,
      isExplicitSource: false,
    };
  }

  /**
   * Encuentra todas las cuerdas y trastes físicos donde la altura puede ejecutarse
   * respetando el límite físico de trastes del instrumento (con capo aplicado).
   */
  public static findCandidates(
    pitch: Pitch,
    tuning: TuningDefinition,
    capoFret = 0
  ): TabCandidate[] {
    const targetMidi = pitch.midiNumber;
    const maxFretAbsolute = tuning.maxFret ?? DEFAULT_MAX_FRET;
    const effectiveMaxFret = Math.max(0, maxFretAbsolute - capoFret);
    const candidates: TabCandidate[] = [];

    // tuning.stringPitches está ordenado de cuerda 1 (más aguda) a cuerda N (más grave)
    for (let i = 0; i < tuning.stringPitches.length; i++) {
      const stringNumber = i + 1;
      const openPitch = tuning.stringPitches[i]!;
      const effectiveOpenMidi = openPitch.midiNumber + capoFret;
      const fret = targetMidi - effectiveOpenMidi;

      if (fret >= 0 && fret <= effectiveMaxFret) {
        candidates.push({ stringNumber, fret });
      }
    }

    return candidates;
  }

  /**
   * Estrategia determinista de selección ergonómica:
   * 1. Si el ejecutante ya está en una zona del mástil (previousFret > 4) y existe un candidato
   *    digitado dentro de una ventana cómoda (<= 4 trastes de distancia), prioriza continuidad
   *    en esa zona sobre cuerdas al aire (0) o saltos bruscos.
   * 2. En primera posición (previousFret === null o <= 4), permite cuerdas al aire (fret 0)
   *    o trastes 1..5 de menor traste.
   * 3. Penaliza trastes altos (> 12) cuando existen alternativas equivalentes en rango medio (1..12).
   */
  private static selectBestCandidate(
    candidates: TabCandidate[],
    context?: TablatureSelectionContext
  ): TabCandidate {
    const prevFret = context?.previousFret ?? null;
    const prevString = context?.previousString ?? null;

    const scored = candidates.map((c) => {
      let cost = 0;

      if (prevFret !== null && prevFret > 7) {
        // En posición media/alta (> traste 7), evitar forzar fret 0 si hay posición cercana al traste actual
        if (c.fret === 0) {
          cost += 12;
        } else {
          cost += Math.abs(c.fret - prevFret) * 2.2;
        }
      } else {
        // En primera posición (o inicio de pasaje)
        if (c.fret === 0) {
          cost += 0.5;
        } else if (c.fret <= 5) {
          cost += 1.0 + c.fret * 0.4;
        } else if (c.fret <= 12) {
          cost += 6.0 + (c.fret - 5) * 1.1;
        } else {
          cost += 20.0 + (c.fret - 12) * 2.5;
        }
        if (prevFret !== null && c.fret > 0) {
          cost += Math.abs(c.fret - prevFret) * 0.8;
        }
      }

      if (c.fret > 12) {
        cost += 10;
      }

      if (prevString !== null) {
        cost += Math.abs(c.stringNumber - prevString) * 0.25;
      }

      return { candidate: c, cost };
    });

    scored.sort((a, b) => {
      if (Math.abs(a.cost - b.cost) > 1e-6) {
        return a.cost - b.cost;
      }
      if (a.candidate.fret !== b.candidate.fret) {
        return a.candidate.fret - b.candidate.fret;
      }
      return a.candidate.stringNumber - b.candidate.stringNumber;
    });

    return scored[0]!.candidate;
  }
}
