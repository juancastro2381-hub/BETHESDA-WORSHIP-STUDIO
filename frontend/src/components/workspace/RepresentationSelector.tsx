/**
 * @file RepresentationSelector.tsx
 * @description Selector de representaciones visuales derivado de las capacidades del instrumento (Fase 1G).
 * Solo permite seleccionar representaciones compatibles declaradas en el modelo del instrumento.
 */

import React from 'react';
import { type ViewRepresentation } from '../../core/projection/types.ts';

export interface RepresentationSelectorProps {
  readonly supportedRepresentations: readonly ViewRepresentation[];
  readonly primaryRepresentation: ViewRepresentation;
  readonly secondaryRepresentations: readonly ViewRepresentation[];
  readonly onSelectPrimary: (representation: ViewRepresentation) => void;
  readonly onToggleSecondary: (representation: ViewRepresentation) => void;
}

const REPRESENTATION_LABELS: Record<ViewRepresentation, { label: string; desc: string }> = {
  STANDARD_NOTATION: { label: 'Pentagrama Estándar', desc: 'Notación tradicional en claves de Sol o Fa' },
  GRAND_STAFF: { label: 'Gran Pentagrama', desc: 'Claves combinadas de Sol y Fa para teclados' },
  TABLATURE: { label: 'Tablatura', desc: 'Diagrama con cuerdas y trastes reales' },
  CHORDS: { label: 'Cifrado Armónico', desc: 'Acordes de digitación o sonantes' },
  LYRICS: { label: 'Letra Silábica', desc: 'Texto lírico alineado métricamente' },
  SECTION_MARKERS: { label: 'Marcadores de Sección', desc: 'Verso, Coro, Puente, Intro, Salida' },
  PERCUSSION_NOTATION: { label: 'Notación Percusión', desc: 'Mapeo de batería y caja/platillos' },
};

export const RepresentationSelector: React.FC<RepresentationSelectorProps> = ({
  supportedRepresentations,
  primaryRepresentation,
  secondaryRepresentations,
  onSelectPrimary,
  onToggleSecondary,
}) => {
  return (
    <div className="control-card representation-selector-card">
      <div className="rep-section">
        <label className="control-card-label" id="primary-rep-label">
          Representación Principal (Exclusiva):
        </label>
        <div className="representation-group" role="radiogroup" aria-labelledby="primary-rep-label">
          {supportedRepresentations.map((rep) => {
            const isSelected = primaryRepresentation === rep;
            const meta = REPRESENTATION_LABELS[rep];
            return (
              <button
                key={`primary-${rep}`}
                type="button"
                role="radio"
                aria-checked={isSelected}
                className={`btn-toggle rep-btn ${isSelected ? 'active' : ''}`}
                onClick={() => onSelectPrimary(rep)}
                title={meta?.desc}
              >
                {meta?.label ?? rep}
              </button>
            );
          })}
        </div>
      </div>

      <div className="rep-section">
        <label className="control-card-label" id="secondary-rep-label">
          Capas Secundarias Adicionales:
        </label>
        <div className="representation-group" role="group" aria-labelledby="secondary-rep-label">
          {supportedRepresentations
            .filter((rep) => rep !== primaryRepresentation)
            .map((rep) => {
              const isSelected = secondaryRepresentations.includes(rep);
              const meta = REPRESENTATION_LABELS[rep];
              return (
                <button
                  key={`secondary-${rep}`}
                  type="button"
                  aria-pressed={isSelected}
                  className={`btn-toggle rep-secondary-btn ${isSelected ? 'active' : ''}`}
                  onClick={() => onToggleSecondary(rep)}
                  title={meta?.desc}
                >
                  {isSelected ? '✓ ' : '+ '}
                  {meta?.label ?? rep}
                </button>
              );
            })}
        </div>
      </div>
    </div>
  );
};
