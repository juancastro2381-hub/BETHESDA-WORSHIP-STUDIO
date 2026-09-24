/**
 * @file ChordNotationControl.tsx
 * @description Control accesible de sistema de notación armónica (Fase 1G).
 * Permite alternar reactivamente entre Cifrado Americano Estándar y Cifrado Latino / Solfeo.
 */

import React from 'react';
import { type ChordNotationSystem } from '../../core/projection/types.ts';

export interface ChordNotationControlProps {
  readonly chordNotationSystem: ChordNotationSystem;
  readonly onSetChordNotation: (system: ChordNotationSystem) => void;
}

export const ChordNotationControl: React.FC<ChordNotationControlProps> = ({
  chordNotationSystem,
  onSetChordNotation,
}) => {
  return (
    <div className="control-card chord-notation-card">
      <label className="control-card-label" id="chord-system-label">
        Sistema de Cifrado:
      </label>
      <div className="chord-toggle-group" role="radiogroup" aria-labelledby="chord-system-label">
        <button
          type="button"
          id="btn-notation-standard"
          role="radio"
          aria-checked={chordNotationSystem === 'STANDARD'}
          className={`btn-toggle ${chordNotationSystem === 'STANDARD' ? 'active' : ''}`}
          onClick={() => onSetChordNotation('STANDARD')}
        >
          Americano (C, D, G)
        </button>
        <button
          type="button"
          id="btn-notation-latin"
          role="radio"
          aria-checked={chordNotationSystem === 'LATIN'}
          className={`btn-toggle ${chordNotationSystem === 'LATIN' ? 'active' : ''}`}
          onClick={() => onSetChordNotation('LATIN')}
        >
          Latino (Do, Re, Sol)
        </button>
      </div>
    </div>
  );
};
