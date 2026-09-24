/**
 * @file InstrumentSelector.tsx
 * @description Selector accesible de instrumento basado en el catálogo del InstrumentRegistry (Fase 1G).
 * No codifica reglas fijas en React; consulta el perfil de instrumento.
 */

import React from 'react';
import { type InstrumentProfile } from '../../core/projection/instrument-profile.ts';
import { type InstrumentId } from '../../core/workspace/types.ts';

export interface InstrumentSelectorProps {
  readonly selectedInstrumentId: InstrumentId;
  readonly availableInstruments: readonly InstrumentProfile[];
  readonly onSelectInstrument: (id: InstrumentId) => void;
}

export const InstrumentSelector: React.FC<InstrumentSelectorProps> = ({
  selectedInstrumentId,
  availableInstruments,
  onSelectInstrument,
}) => {
  return (
    <div className="control-card instrument-selector-card">
      <label htmlFor="instrument-select" className="control-card-label">
        Instrumento de Atril:
      </label>
      <div className="instrument-select-wrapper">
        <select
          id="instrument-select"
          className="workspace-select"
          value={selectedInstrumentId}
          onChange={(e) => onSelectInstrument(e.target.value as InstrumentId)}
          aria-label="Seleccionar Instrumento para Visualización"
        >
          {availableInstruments.map((inst) => (
            <option key={inst.id} value={inst.id}>
              {inst.name} ({inst.family}) {inst.transpositionOffsetSemitones !== 0 ? `[Transp: ${inst.transpositionOffsetSemitones > 0 ? '+' : ''}${inst.transpositionOffsetSemitones}st]` : ''}
            </option>
          ))}
        </select>
      </div>

      {/* Selector rápido por pastillas para los instrumentos más comunes */}
      <div className="instrument-quick-pills" role="radiogroup" aria-label="Acceso rápido a instrumentos">
        {[
          'acoustic_guitar',
          'acoustic_piano',
          'alto_sax',
          'lead_vocal',
          'electric_bass',
          'drum_kit',
        ].map((id) => {
          const inst = availableInstruments.find((i) => i.id === id);
          if (!inst) return null;
          const isSelected = selectedInstrumentId === id;
          return (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={isSelected}
              className={`pill-btn ${isSelected ? 'active' : ''}`}
              onClick={() => onSelectInstrument(inst.id)}
            >
              {inst.name}
            </button>
          );
        })}
      </div>
    </div>
  );
};
