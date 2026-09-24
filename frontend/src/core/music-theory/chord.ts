/**
 * @file chord.ts
 * @description Modela acordes estructurados con fundamental, cualidad armónica,
 * extensiones (9, 11, 13), alteraciones (b5, #5, b9, #9, etc.), notas añadidas y bajo de inversión (slash chords).
 */

import { CHORD_QUALITIES, type ChordQualityType } from './chord-quality.ts';
import { NoteName } from './note-name.ts';
import { PitchClass } from './pitch-class.ts';

export type ChordExtension = 9 | 11 | 13;
export type ChordAlteration = 'b5' | '#5' | 'b9' | '#9' | '#11' | 'b13';
export type ChordAddedTone = 'add9' | 'add11' | 'add2' | 'add4';

export interface ChordInit {
  root: NoteName;
  quality?: ChordQualityType;
  extensions?: ChordExtension[];
  alterations?: ChordAlteration[];
  addedTones?: ChordAddedTone[];
  suspended?: 2 | 4 | null;
  bass?: NoteName | null;
}

export class Chord {
  public readonly root: NoteName;
  public readonly quality: ChordQualityType;
  public readonly extensions: readonly ChordExtension[];
  public readonly alterations: readonly ChordAlteration[];
  public readonly addedTones: readonly ChordAddedTone[];
  public readonly suspended: 2 | 4 | null;
  public readonly bass: NoteName | null;

  public constructor(init: ChordInit) {
    this.root = init.root;
    this.quality = init.quality ?? 'MAJOR';
    this.extensions = Object.freeze(init.extensions ? [...init.extensions] : []);
    this.alterations = Object.freeze(init.alterations ? [...init.alterations] : []);
    this.addedTones = Object.freeze(init.addedTones ? [...init.addedTones] : []);
    this.suspended = init.suspended ?? null;
    this.bass = init.bass ?? null;
  }

  /**
   * Indica si es un acorde con bajo alterado / inversión (ej. D/F#).
   */
  public get isSlashChord(): boolean {
    return this.bass !== null && !this.bass.equals(this.root);
  }

  /**
   * Obtiene la colección completa de PitchClasses que componen el acorde.
   */
  public getPitchClasses(): PitchClass[] {
    const rootPc = this.root.toPitchClass().value;
    const offsets = new Set<number>();

    // 1. Semitonos base según la cualidad
    const baseOffsets = CHORD_QUALITIES[this.quality].semitoneOffsets;
    for (const offset of baseOffsets) {
      offsets.add(offset);
    }

    // 2. Manejo de suspendidos
    if (this.suspended === 2) {
      offsets.delete(3);
      offsets.delete(4);
      offsets.add(2);
    } else if (this.suspended === 4) {
      offsets.delete(3);
      offsets.delete(4);
      offsets.add(5);
    }

    // 3. Extensiones (9 = +14 -> 2, 11 = +17 -> 5, 13 = +21 -> 9)
    for (const ext of this.extensions) {
      if (ext === 9) offsets.add(2);
      if (ext === 11) offsets.add(5);
      if (ext === 13) offsets.add(9);
    }

    // 4. Notas añadidas (add9 = 2, add11 = 5, add2 = 2, add4 = 5)
    for (const add of this.addedTones) {
      if (add === 'add9' || add === 'add2') offsets.add(2);
      if (add === 'add11' || add === 'add4') offsets.add(5);
    }

    // 5. Alteraciones (b5 = 6, #5 = 8, b9 = 1, #9 = 3, #11 = 6, b13 = 8)
    for (const alt of this.alterations) {
      if (alt === 'b5') {
        offsets.delete(7);
        offsets.add(6);
      } else if (alt === '#5') {
        offsets.delete(7);
        offsets.add(8);
      } else if (alt === 'b9') {
        offsets.add(1);
      } else if (alt === '#9') {
        offsets.add(3);
      } else if (alt === '#11') {
        offsets.add(6);
      } else if (alt === 'b13') {
        offsets.add(8);
      }
    }

    const result: PitchClass[] = [];
    for (const offset of offsets) {
      result.push(PitchClass.from(rootPc + offset));
    }

    // Si tiene bajo de inversión que no esté en la tríada, incluirlo
    if (this.bass) {
      const bassPc = this.bass.toPitchClass();
      if (!result.some((p) => p.equals(bassPc))) {
        result.unshift(bassPc);
      }
    }

    return result;
  }

  /**
   * Parsea cadenas de acordes estándar de alabanza y música sacra.
   * Ejemplos: "C", "Cm", "C7", "Cmaj7", "Cm7", "Csus4", "Cadd9", "C7(b9)", "C#m7(b5)/G", "D/F#".
   */
  public static parse(chordText: string): Chord {
    const trimmed = chordText.trim();
    if (!trimmed) {
      throw new Error('Cadena de acorde vacía');
    }

    // 1. Separar posible bajo en slash chords (ej. "D/F#")
    let mainPart = trimmed;
    let bassNote: NoteName | null = null;

    const slashIndex = trimmed.indexOf('/');
    if (slashIndex > 0) {
      mainPart = trimmed.substring(0, slashIndex).trim();
      const bassStr = trimmed.substring(slashIndex + 1).trim();
      bassNote = NoteName.parse(bassStr);
    }

    // 2. Extraer Fundamental (Root)
    // Puede ser anglosajona ("C#", "Bb") o latina ("Sol#", "Fa")
    let rootNote: NoteName;
    let suffix = '';

    const latinPrefixes = ['sol', 'do', 're', 'mi', 'fa', 'la', 'si'];
    const lowerMain = mainPart.toLowerCase();
    const foundLatin = latinPrefixes.find((p) => lowerMain.startsWith(p));

    if (foundLatin) {
      // Determinar si hay alteración en la fundamental latina (ej. "Sol#m7")
      let rootLen = foundLatin.length;
      if (mainPart[rootLen] === '#' || mainPart[rootLen] === 'b') {
        rootLen++;
        if (mainPart[rootLen] === '#' || mainPart[rootLen] === 'b') {
          rootLen++;
        }
      }
      rootNote = NoteName.parse(mainPart.substring(0, rootLen));
      suffix = mainPart.substring(rootLen).trim();
    } else {
      // Anglosajona: primera letra A-G, más posibles alteraciones
      let rootLen = 1;
      if (mainPart[1] === '#' || mainPart[1] === 'b') {
        rootLen = 2;
        if (mainPart[2] === '#' || mainPart[2] === 'b') {
          rootLen = 3;
        }
      }
      rootNote = NoteName.parse(mainPart.substring(0, rootLen));
      suffix = mainPart.substring(rootLen).trim();
    }

    // 3. Parsear Sufijo (Cualidad, Extensiones, Alteraciones, Suspendidos)
    let quality: ChordQualityType = 'MAJOR';
    const extensions: ChordExtension[] = [];
    const alterations: ChordAlteration[] = [];
    const addedTones: ChordAddedTone[] = [];
    let suspended: 2 | 4 | null = null;

    // Normalizar sufijo para inspección
    let s = suffix;

    // Detectar alteraciones entre paréntesis, ej. "(b9)", "(b5)", "(#9)"
    const parenMatches = s.match(/\(([^)]+)\)/g);
    if (parenMatches) {
      for (const paren of parenMatches) {
        const inner = paren.replace(/[()]/g, '').trim();
        if (['b5', '#5', 'b9', '#9', '#11', 'b13'].includes(inner)) {
          alterations.push(inner as ChordAlteration);
        }
        s = s.replace(paren, '').trim();
      }
    }

    // Detectar m7b5 o half-diminished
    if (s.startsWith('m7b5') || s.startsWith('min7b5') || s.startsWith('ø')) {
      quality = 'HALF_DIMINISHED_7';
      s = s.replace(/^(m7b5|min7b5|ø)/, '');
    } else if (s.startsWith('maj7') || s.startsWith('M7') || s.startsWith('Δ')) {
      quality = 'MAJOR_7';
      s = s.replace(/^(maj7|M7|Δ)/, '');
    } else if (s.startsWith('maj9') || s.startsWith('M9')) {
      quality = 'MAJOR_7';
      extensions.push(9);
      s = s.replace(/^(maj9|M9)/, '');
    } else if (s.startsWith('m7') || s.startsWith('min7')) {
      quality = 'MINOR_7';
      s = s.replace(/^(m7|min7)/, '');
    } else if (s.startsWith('m9') || s.startsWith('min9')) {
      quality = 'MINOR_7';
      extensions.push(9);
      s = s.replace(/^(m9|min9)/, '');
    } else if (s.startsWith('m6') || s.startsWith('min6')) {
      quality = 'MINOR_6';
      s = s.replace(/^(m6|min6)/, '');
    } else if (s.startsWith('m') || s.startsWith('min') || s.startsWith('-')) {
      quality = 'MINOR';
      s = s.replace(/^(min|m|-)/, '');
    } else if (s.startsWith('dim7') || s.startsWith('o7')) {
      quality = 'DIMINISHED_7';
      s = s.replace(/^(dim7|o7)/, '');
    } else if (s.startsWith('dim') || s.startsWith('o')) {
      quality = 'DIMINISHED';
      s = s.replace(/^(dim|o)/, '');
    } else if (s.startsWith('aug7') || s.startsWith('+7')) {
      quality = 'AUGMENTED_7';
      s = s.replace(/^(aug7|\+7)/, '');
    } else if (s.startsWith('aug') || s.startsWith('+')) {
      quality = 'AUGMENTED';
      s = s.replace(/^(aug|\+)/, '');
    } else if (s.startsWith('sus4') || s.startsWith('sus')) {
      suspended = 4;
      s = s.replace(/^(sus4|sus)/, '');
    } else if (s.startsWith('sus2')) {
      suspended = 2;
      s = s.replace(/^sus2/, '');
    } else if (s.startsWith('6')) {
      quality = 'MAJOR_6';
      s = s.replace(/^6/, '');
    } else if (s.startsWith('7')) {
      quality = 'DOMINANT_7';
      s = s.replace(/^7/, '');
    } else if (s.startsWith('9')) {
      quality = 'DOMINANT_7';
      extensions.push(9);
      s = s.replace(/^9/, '');
    } else if (s.startsWith('5')) {
      quality = 'POWER_5';
      s = s.replace(/^5/, '');
    }

    // Chequeo de sufijos secundarios como add9, add11, sus4
    if (s.includes('add9')) {
      addedTones.push('add9');
      s = s.replace('add9', '');
    }
    if (s.includes('add11')) {
      addedTones.push('add11');
      s = s.replace('add11', '');
    }
    if (s.includes('sus4') || s.includes('sus')) {
      suspended = 4;
      s = s.replace(/sus4|sus/, '');
    }
    if (s.includes('sus2')) {
      suspended = 2;
      s = s.replace('sus2', '');
    }

    // Chequeo de alteraciones directas no parentizadas (ej. b5 en m7b5 restante)
    if (s.includes('b5')) {
      alterations.push('b5');
      s = s.replace('b5', '');
    }
    if (s.includes('#5')) {
      alterations.push('#5');
      s = s.replace('#5', '');
    }

    // Si la cualidad es MINOR_7 y tiene una alteración b5 (ej. C#m7(b5)),
    // representa la entidad armónica canónica HALF_DIMINISHED_7
    if (quality === 'MINOR_7' && alterations.includes('b5')) {
      quality = 'HALF_DIMINISHED_7';
      const b5Idx = alterations.indexOf('b5');
      if (b5Idx >= 0) {
        alterations.splice(b5Idx, 1);
      }
    }

    return new Chord({
      root: rootNote,
      quality,
      extensions,
      alterations,
      addedTones,
      suspended,
      bass: bassNote,
    });
  }

  public toString(notationSystem: 'STANDARD' | 'LATIN' = 'STANDARD'): string {
    const rootStr = this.root.toString(notationSystem);
    let sym = '';

    if (this.quality === 'HALF_DIMINISHED_7') {
      sym = 'm7(b5)';
    } else {
      sym = CHORD_QUALITIES[this.quality].standardSymbol;
    }

    if (this.suspended) {
      sym += `sus${this.suspended}`;
    }

    for (const ext of this.extensions) {
      if (this.quality !== 'MAJOR_7' && this.quality !== 'MINOR_7') {
        sym += ext;
      }
    }

    for (const add of this.addedTones) {
      sym += add;
    }

    for (const alt of this.alterations) {
      sym += `(${alt})`;
    }

    let result = `${rootStr}${sym}`;
    if (this.bass) {
      result += `/${this.bass.toString(notationSystem)}`;
    }
    return result;
  }
}
