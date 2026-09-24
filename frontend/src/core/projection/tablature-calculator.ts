/**
 * @file tablature-calculator.ts
 * @description Calculador de proyección de tablatura para instrumentos de cuerda (Guitarra, Bajo).
 * Mapea alturas musicales canónicas a coordenadas de cuerda y traste de manera determinista,
 * respetando la afinación y el traste de cejilla (Capo).
 */

import { type Pitch } from '../music-theory/pitch.ts';
import { type TabPosition, type TuningDefinition } from './types.ts';

export interface TabCandidate {
  stringNumber: number; // 1 a N
  fret: number;
}

export class TablatureCalculator {
  /**
   * Calcula la posición óptima de tablatura (cuerda y traste) para una altura dada,
   * afinación y traste de cejilla.
   *
   * @param pitch Altura musical canónica que se desea emitir.
   * @param tuning Definición de la afinación del instrumento.
   * @param capoFret Traste de cejilla (0 = sin cejilla).
   * @param durationTicks Duración en ticks del evento.
   * @param voice Voz polifónica.
   * @returns TabPosition si la nota es reproducible en el instrumento, o null si está fuera de registro.
   */
  public static calculatePosition(
    pitch: Pitch,
    tuning: TuningDefinition,
    capoFret = 0,
    durationTicks = 480,
    voice = 1
  ): TabPosition | null {
    const candidates = TablatureCalculator.findCandidates(pitch, tuning, capoFret);

    if (candidates.length === 0) {
      return null;
    }

    // Heurística ergonómica:
    // 1. Si existe traste 0 (cuerda al aire con/sin capo), es de altísima prioridad.
    // 2. Priorizar posiciones entre traste 0 y 12.
    // 3. Dentro de posiciones cómodas (0-5), elegir la de menor traste.
    const best = TablatureCalculator.selectBestCandidate(candidates);

    return {
      stringNumber: best.stringNumber,
      fret: best.fret,
      canonicalPitch: pitch,
      durationTicks,
      voice,
      tuningReference: tuning.name,
    };
  }

  /**
   * Encuentra todas las cuerdas y trastes físicos donde la altura puede ejecutarse.
   */
  public static findCandidates(
    pitch: Pitch,
    tuning: TuningDefinition,
    capoFret = 0
  ): TabCandidate[] {
    const targetMidi = pitch.midiNumber;
    const candidates: TabCandidate[] = [];

    // tuning.stringPitches está ordenado de cuerda 1 (más aguda) a cuerda N (más grave)
    for (let i = 0; i < tuning.stringPitches.length; i++) {
      const stringNumber = i + 1;
      const openPitch = tuning.stringPitches[i]!;
      // El sonido base de la cuerda es el sonido al aire más el desplazamiento del capo
      const effectiveOpenMidi = openPitch.midiNumber + capoFret;

      const fret = targetMidi - effectiveOpenMidi;

      // El traste debe ser no-negativo y estar dentro del diapasón (típicamente hasta 24)
      if (fret >= 0 && fret <= 24) {
        candidates.push({ stringNumber, fret });
      }
    }

    return candidates;
  }

  /**
   * Selecciona el candidato más natural y ergonómico.
   */
  private static selectBestCandidate(candidates: TabCandidate[]): TabCandidate {
    // Si hay una cuerda al aire (fret 0), preferirla
    const openCandidate = candidates.find((c) => c.fret === 0);
    if (openCandidate) {
      return openCandidate;
    }

    // Filtrar candidatos en la primera posición cómoda (trastes 1 a 5)
    const firstPosition = candidates.filter((c) => c.fret >= 1 && c.fret <= 5);
    if (firstPosition.length > 0) {
      // Ordenar por menor traste
      firstPosition.sort((a, b) => a.fret - b.fret);
      return firstPosition[0]!;
    }

    // Filtrar candidatos en rango medio (trastes 6 a 12)
    const midPosition = candidates.filter((c) => c.fret <= 12);
    if (midPosition.length > 0) {
      midPosition.sort((a, b) => a.fret - b.fret);
      return midPosition[0]!;
    }

    // Si solo hay trastes altos (> 12), elegir el de menor traste
    candidates.sort((a, b) => a.fret - b.fret);
    return candidates[0]!;
  }
}
