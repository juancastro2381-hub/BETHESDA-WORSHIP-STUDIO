/**
 * @file ScenarioPresets.tsx
 * @description Tarjetas contextuales y no destructivas de previsualización de escenarios sobre la canción activa.
 * Permiten explorar configuraciones de instrumento, capo, transposición y formato sin reemplazar la canción
 * ni sobrescribir la configuración persistida del músico.
 */

import React, { useMemo } from 'react';
import { type CanonicalMusicPayload } from '../../core/canonical-model/canonical-music-payload.ts';
import { InstrumentRegistry } from '../../core/projection/instrument-profile.ts';
import { GOLDEN_SCENARIO_PRESETS } from '../../core/workspace/presets.ts';
import { StandFormatCapabilityResolver } from '../../core/workspace/stand-format-capabilities.ts';
import { type GoldenScenarioId } from '../../core/workspace/types.ts';

export interface ScenarioPresetsProps {
  readonly activePresetId: GoldenScenarioId | 'CUSTOM';
  readonly activeSong?: CanonicalMusicPayload | undefined;
  readonly activeScenarioPreview?: GoldenScenarioId | null | undefined;
  readonly onApplyPreset: (presetId: GoldenScenarioId) => void;
  readonly onExitPreview?: (() => void) | undefined;
}

type ScenarioSupportState = 'READY' | 'PARTIAL' | 'UNAVAILABLE';

interface ScenarioSupportBadge {
  readonly state: ScenarioSupportState;
  readonly label: string;
  readonly detail: string;
}

const instrumentRegistry = new InstrumentRegistry();

function evaluateScenarioSupport(
  presetId: GoldenScenarioId,
  song?: CanonicalMusicPayload
): ScenarioSupportBadge {
  if (!song) {
    return {
      state: 'READY',
      label: 'Vista previa',
      detail: 'Previsualización contextual sobre la canción activa.',
    };
  }

  const preset = GOLDEN_SCENARIO_PRESETS[presetId];
  const profile = instrumentRegistry.getOrThrow(preset.instrumentId);
  const summary = StandFormatCapabilityResolver.summarizeContent(song);
  const evals = StandFormatCapabilityResolver.evaluateAll(song, profile, {
    capoFret: preset.capoFret,
  });

  if (presetId === 'SCENARIO_A') {
    if (evals.TABLATURE.isAvailable) {
      return {
        state: 'READY',
        label: 'Compatible',
        detail: 'Tablatura con Capo 2 y cifrado disponibles para esta obra.',
      };
    }
    if (summary.chordCount > 0) {
      return {
        state: 'PARTIAL',
        label: 'Solo cifrado',
        detail: 'La obra no tiene notas melódicas; se mostrará cifrado con Capo 2 sin inventar tablatura.',
      };
    }
    return {
      state: 'UNAVAILABLE',
      label: 'Sin notas ni acordes',
      detail: 'Esta obra no contiene notas melódicas ni cifrado armónico.',
    };
  }

  if (presetId === 'SCENARIO_B' || presetId === 'SCENARIO_C') {
    if (evals.STAFF_NOTATION.isAvailable) {
      return {
        state: 'READY',
        label: 'Compatible',
        detail:
          presetId === 'SCENARIO_C'
            ? 'Notación melódica disponible para proyección transpuesta en Eb.'
            : 'Notación melódica disponible para Gran Pentagrama.',
      };
    }
    if (summary.chordCount > 0) {
      return {
        state: 'PARTIAL',
        label: 'Sin melodía',
        detail: 'La obra solo contiene cifrado; no se inventarán notas de pentagrama.',
      };
    }
    return {
      state: 'UNAVAILABLE',
      label: 'No disponible',
      detail: 'Requiere notas melódicas reales para proyectar pentagrama.',
    };
  }

  // SCENARIO_D (Lead Sheet: Cifrado + Letra)
  if (evals.CHORD_CHART.isAvailable) {
    return {
      state: 'READY',
      label: 'Compatible',
      detail: 'Cifrado armónico y letra disponibles.',
    };
  }
  if (summary.chordCount > 0 || summary.lyricSyllableCount > 0 || summary.hasUnalignedLyrics) {
    return {
      state: 'PARTIAL',
      label: 'Parcial',
      detail: evals.CHORD_CHART.shortRestrictionExplanation || 'Contenido parcial de acordes o letra.',
    };
  }
  return {
    state: 'UNAVAILABLE',
    label: 'Sin acordes ni letra',
    detail: 'Esta obra no contiene cifrado armónico ni letra verificada.',
  };
}

export const ScenarioPresets: React.FC<ScenarioPresetsProps> = ({
  activePresetId,
  activeSong,
  activeScenarioPreview = null,
  onApplyPreset,
  onExitPreview,
}) => {
  const presetList = Object.values(GOLDEN_SCENARIO_PRESETS);

  const supportMap = useMemo(() => {
    const map = new Map<GoldenScenarioId, ScenarioSupportBadge>();
    for (const preset of presetList) {
      map.set(preset.id, evaluateScenarioSupport(preset.id, activeSong));
    }
    return map;
  }, [presetList, activeSong]);

  const activePreviewPreset = activeScenarioPreview
    ? GOLDEN_SCENARIO_PRESETS[activeScenarioPreview]
    : null;

  return (
    <section
      className="scenario-presets-wrapper"
      aria-label="Modos de Previsualización Contextual"
    >
      <div className="scenario-section-header">
        <span className="scenario-section-title">
          👁️ Modos de Previsualización Contextual (no reemplaza la canción activa)
        </span>
      </div>

      {activePreviewPreset && (
        <div className="scenario-preview-banner" role="status">
          <div className="scenario-preview-banner-text">
            <strong>Vista previa temporal activa:</strong> {activePreviewPreset.name}
            {activeSong ? ` sobre «${activeSong.title}»` : ''} — La canción y tu configuración original permanecen protegidas.
          </div>
          {onExitPreview && (
            <button
              type="button"
              className="btn-exit-scenario-preview"
              onClick={onExitPreview}
            >
              ↩️ Volver a mi vista original
            </button>
          )}
        </div>
      )}

      <div className="scenario-presets-grid">
        {presetList.map((preset) => {
          const isPreviewActive =
            activeScenarioPreview !== null
              ? activeScenarioPreview === preset.id
              : activePresetId === preset.id;
          const support = supportMap.get(preset.id)!;
          return (
            <div
              key={preset.id}
              id={`preset-card-${preset.id.toLowerCase()}`}
              role="button"
              tabIndex={0}
              aria-pressed={isPreviewActive}
              title={support.detail}
              className={`preset-card ${isPreviewActive ? 'active' : ''} ${
                support.state === 'UNAVAILABLE' ? 'is-unavailable' : ''
              }`}
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
                <div className="preset-status-pills">
                  <span
                    className={`scenario-compat-badge is-${support.state.toLowerCase()}`}
                  >
                    {support.label}
                  </span>
                  {isPreviewActive && <span className="active-indicator">VISTA PREVIA</span>}
                </div>
              </div>
              <h3 className="preset-title">{preset.name}</h3>
              <p className="preset-desc">
                {support.state === 'READY' ? preset.description : support.detail}
              </p>
            </div>
          );
        })}
      </div>
    </section>
  );
};
