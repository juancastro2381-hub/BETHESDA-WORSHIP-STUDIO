/**
 * @file DiagnosticPanel.tsx
 * @description Panel estructurado y colapsable de diagnósticos del Workspace (Fase 1G).
 * Muestra advertencias, información y errores de proyección o renderizado sin enmascaramiento.
 */

import React, { useState } from 'react';
import { type WorkspaceDiagnostic } from '../../core/workspace/types.ts';

export interface DiagnosticPanelProps {
  readonly diagnostics: readonly WorkspaceDiagnostic[];
}

export const DiagnosticPanel: React.FC<DiagnosticPanelProps> = ({ diagnostics }) => {
  const [isOpen, setIsOpen] = useState<boolean>(false);

  const errorCount = diagnostics.filter((d) => d.severity === 'ERROR').length;
  const warningCount = diagnostics.filter((d) => d.severity === 'WARNING').length;
  const infoCount = diagnostics.filter((d) => d.severity === 'INFO').length;

  return (
    <div className="workspace-diagnostic-panel" aria-label="Panel de Diagnósticos">
      <button
        type="button"
        className="diagnostic-toggle-header"
        onClick={() => setIsOpen((prev) => !prev)}
        aria-expanded={isOpen}
      >
        <span className="toggle-title">
          {isOpen ? '▼' : '▶'} Diagnósticos del Sistema ({diagnostics.length})
        </span>
        <div className="diagnostic-counts">
          {errorCount > 0 && <span className="count-tag error">{errorCount} Errores</span>}
          {warningCount > 0 && <span className="count-tag warning">{warningCount} Avisos</span>}
          {infoCount > 0 && <span className="count-tag info">{infoCount} Info</span>}
          {diagnostics.length === 0 && <span className="count-tag ok">Sistema Saludable</span>}
        </div>
      </button>

      {isOpen && (
        <div className="diagnostic-list" role="region" aria-label="Lista detallada de diagnósticos">
          {diagnostics.length === 0 ? (
            <p className="empty-diagnostics">No hay advertencias ni errores activos.</p>
          ) : (
            diagnostics.map((diag, idx) => (
              <div key={`${diag.code}-${idx}`} className={`diagnostic-entry ${diag.severity.toLowerCase()}`}>
                <span className="diag-source">[{diag.source}]</span>
                <span className="diag-code">{diag.code}</span>
                <span className="diag-message">{diag.message}</span>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
};
