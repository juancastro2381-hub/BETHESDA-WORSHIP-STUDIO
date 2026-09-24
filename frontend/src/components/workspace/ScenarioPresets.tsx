/**
 * @file ScenarioPresets.tsx
 * @description Tarjetas de selección rápida para los 4 Escenarios Dorados oficiales (Fase 1G).
 * Garantiza cobertura de regresión para Scenarios A, B, C y D.
 */

import React from 'react';
import { GOLDEN_SCENARIO_PRESETS } from '../../core/workspace/presets.ts';
import { type GoldenScenarioId } from '../../core/workspace/types.ts';

export interface ScenarioPresetsProps {
  readonly activePresetId: GoldenScenarioId | 'CUSTOM';
  readonly onApplyPreset: (presetId: GoldenScenarioId) => void;
}

export const ScenarioPresets: React.FC<ScenarioPresetsProps> = ({
  activePresetId,
  onApplyPreset,
}) => {
  const presetList = Object.values(GOLDEN_SCENARIO_PRESETS);

  return (
    <section className="scenario-presets-grid" aria-label="Escenarios Dorados de Referencia">
      {presetList.map((preset) => {
        const isActive = activePresetId === preset.id;
        return (
          <div
            key={preset.id}
            id={`preset-card-${preset.id.toLowerCase()}`}
            role="button"
            tabIndex={0}
            aria-pressed={isActive}
            className={`preset-card ${isActive ? 'active' : ''}`}
            onClick={() => onApplyPreset(preset.id)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onApplyPreset(preset.id);
              }
            }}
          >
            <div className="preset-header">
              <span className="preset-badge">{preset.subtitle}</span>
              {isActive && <span className="active-indicator">ACTIVO</span>}
            </div>
            <h3 className="preset-title">{preset.name}</h3>
            <p className="preset-desc">{preset.description}</p>
          </div>
        );
      })}
    </section>
  );
};
