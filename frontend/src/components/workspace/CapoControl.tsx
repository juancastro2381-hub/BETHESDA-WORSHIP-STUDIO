/**
 * @file CapoControl.tsx
 * @description Control accesible de Cejilla (Capo) con validación por instrumento (Fase 1G).
 * Se desactiva y resetea determinísticamente si el instrumento no soporta cejilla.
 */

import React from 'react';

export interface CapoControlProps {
  readonly capoFret: number;
  readonly instrumentSupportsCapo: boolean;
  readonly instrumentName: string;
  readonly onSetCapo: (fret: number) => void;
}

export const CapoControl: React.FC<CapoControlProps> = ({
  capoFret,
  instrumentSupportsCapo,
  instrumentName,
  onSetCapo,
}) => {
  if (!instrumentSupportsCapo) {
    return (
      <div className="control-card capo-control-card disabled" aria-disabled="true">
        <label className="control-card-label">Cejilla (Capo):</label>
        <span className="control-card-hint">
          No aplicable a {instrumentName}.
        </span>
      </div>
    );
  }

  return (
    <div className="control-card capo-control-card">
      <label className="control-card-label" id="capo-control-label">
        Cejilla (Capo):
      </label>
      <div
        className="capo-btn-group"
        role="radiogroup"
        aria-labelledby="capo-control-label"
      >
        {[0, 1, 2, 3, 4, 5, 7].map((fret) => {
          const isSelected = capoFret === fret;
          return (
            <button
              key={fret}
              type="button"
              role="radio"
              aria-checked={isSelected}
              className={`btn-toggle capo-btn ${isSelected ? 'active' : ''}`}
              onClick={() => onSetCapo(fret)}
              id={`capo-fret-${fret}`}
            >
              {fret === 0 ? 'Sin Capo' : `Capo ${fret}`}
            </button>
          );
        })}
      </div>
      {capoFret > 0 && (
        <span className="control-card-hint">
          Traste {capoFret}: Las digitaciones se calcularán relativas al traste {capoFret}.
        </span>
      )}
    </div>
  );
};
