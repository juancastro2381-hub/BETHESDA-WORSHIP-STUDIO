/**
 * @file TranspositionControl.tsx
 * @description Control accesible de transposición de banda en semitonos (Fase 1G).
 * Invariante: La transposición global es estrictamente independiente de la cejilla (Capo).
 */

import React from 'react';

export interface TranspositionControlProps {
  readonly transpositionSemitones: number;
  readonly onSetTransposition: (semitones: number) => void;
}

export const TranspositionControl: React.FC<TranspositionControlProps> = ({
  transpositionSemitones,
  onSetTransposition,
}) => {
  return (
    <div className="control-card transposition-control-card">
      <label className="control-card-label" id="transp-control-label">
        Transposición de Banda:
      </label>
      <div className="transposition-actions" role="group" aria-labelledby="transp-control-label">
        <button
          type="button"
          className="btn-toggle step-btn"
          onClick={() => onSetTransposition(transpositionSemitones - 1)}
          title="Bajar 1 semitono"
          aria-label="Bajar un semitono"
        >
          −1 st
        </button>

        <span className="transposition-display" aria-live="polite">
          {transpositionSemitones === 0
            ? 'Original (0 st)'
            : `${transpositionSemitones > 0 ? '+' : ''}${transpositionSemitones} semitonos`}
        </span>

        <button
          type="button"
          className="btn-toggle step-btn"
          onClick={() => onSetTransposition(transpositionSemitones + 1)}
          title="Subir 1 semitono"
          aria-label="Subir un semitono"
        >
          +1 st
        </button>

        {transpositionSemitones !== 0 && (
          <button
            type="button"
            className="btn-toggle reset-btn"
            onClick={() => onSetTransposition(0)}
            title="Restablecer a tono original"
          >
            Reset
          </button>
        )}
      </div>

      <div className="quick-transposition-presets">
        {[-3, -2, -1, 0, 1, 2, 3].map((st) => (
          <button
            key={st}
            type="button"
            className={`pill-btn ${transpositionSemitones === st ? 'active' : ''}`}
            onClick={() => onSetTransposition(st)}
          >
            {st === 0 ? 'Orig' : `${st > 0 ? '+' : ''}${st}`}
          </button>
        ))}
      </div>
    </div>
  );
};
