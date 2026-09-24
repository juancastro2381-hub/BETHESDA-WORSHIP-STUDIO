/**
 * @file RendererStatus.tsx
 * @description Indicador de estado y motor de renderizado activo en el Workspace (Fase 1G).
 * Muestra el motor seleccionado por capacidades (o forzado), así como su estado operativo.
 */

import React from 'react';
import { type RendererId } from '../../core/rendering/types.ts';

export interface RendererStatusProps {
  readonly activeRendererId: RendererId | null;
  readonly forcedRendererId?: RendererId | undefined;
  readonly onSetForcedRenderer: (id: RendererId | undefined) => void;
}

const RENDERER_METADATA: Record<RendererId, { name: string; engine: string; color: string }> = {
  ALPHATAB: {
    name: 'AlphaTab',
    engine: 'SVG Vector Score & Tablature Engine',
    color: 'var(--amber-gold)',
  },
  OSMD: {
    name: 'OpenSheetMusicDisplay',
    engine: 'MusicXML 4.0 Standard & Grand Staff Engine',
    color: 'var(--cyan-accent)',
  },
  LEADSHEET_DOM: {
    name: 'LeadSheetDOM',
    engine: 'Semantic XSS-Safe DOM Lead Sheet Engine',
    color: '#10b981',
  },
};

export const RendererStatus: React.FC<RendererStatusProps> = ({
  activeRendererId,
  forcedRendererId,
  onSetForcedRenderer,
}) => {
  const current = activeRendererId ? RENDERER_METADATA[activeRendererId] : null;

  return (
    <div className="renderer-status-container" role="region" aria-label="Estado del Motor de Renderizado">
      <div className="renderer-info-group">
        <span className="control-card-label">Motor de Renderizado Activo:</span>
        <div className="renderer-badge-row">
          <span
            className="active-renderer-badge"
            style={{
              borderColor: current?.color ?? 'var(--border-subtle)',
              color: current?.color ?? 'var(--text-primary)',
            }}
          >
            ● {current?.name ?? 'Sin renderizador compatible'}
          </span>
          <span className="renderer-engine-desc">{current?.engine}</span>
        </div>
      </div>

      <div className="renderer-override-group">
        <span className="override-label">Modo de Selección:</span>
        <button
          type="button"
          className={`pill-btn ${forcedRendererId === undefined ? 'active' : ''}`}
          onClick={() => onSetForcedRenderer(undefined)}
          title="Selección automática dirigida por capacidades de la vista"
        >
          Auto (Capacidades)
        </button>
        {(['ALPHATAB', 'OSMD', 'LEADSHEET_DOM'] as const).map((id) => (
          <button
            key={id}
            type="button"
            className={`pill-btn ${forcedRendererId === id ? 'active' : ''}`}
            onClick={() => onSetForcedRenderer(id)}
          >
            {RENDERER_METADATA[id].name}
          </button>
        ))}
      </div>
    </div>
  );
};
