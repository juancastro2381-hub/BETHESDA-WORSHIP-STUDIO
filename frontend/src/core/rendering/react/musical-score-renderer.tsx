/**
 * @file musical-score-renderer.tsx
 * @description Componente React límite para montaje y renderizado visual (Fase 1F).
 * Desacoplado: No contiene lógica musical, solo gestiona el contenedor DOM y el estado de la vista.
 */

import React from 'react';
import { type DerivedMusicalView } from '../../projection/derived-musical-view.ts';
import { type RendererDiagnostic, type RendererId } from '../types.ts';
import { useMusicRenderer } from './use-music-renderer.ts';

export interface MusicalScoreRendererProps {
  view: DerivedMusicalView | null;
  preferredRendererId?: RendererId | undefined;
  className?: string | undefined;
  onDiagnostic?: ((diagnostic: RendererDiagnostic) => void) | undefined;
  onError?: ((error: RendererDiagnostic) => void) | undefined;
}

export const MusicalScoreRenderer: React.FC<MusicalScoreRendererProps> = ({
  view,
  preferredRendererId,
  className = '',
  onDiagnostic,
  onError,
}) => {
  const { containerRef, activeRendererId, status, error } = useMusicRenderer({
    view,
    preferredRendererId,
    onDiagnostic,
    onError,
  });

  return (
    <div className={`bethesda-renderer-viewport ${className}`}>
      {status === 'ERROR' && error && (
        <div className="bethesda-renderer-error-banner" role="alert">
          <span className="error-title">Error de Renderizado [{error.code}]:</span>
          <span className="error-message">{error.message}</span>
        </div>
      )}

      {/* Contenedor DOM para montaje de AlphaTab, OSMD o LeadSheetDOM */}
      <div
        ref={containerRef}
        className="bethesda-music-render-container"
        data-renderer={activeRendererId ?? 'none'}
        data-status={status}
      />
    </div>
  );
};
