/**
 * @file App.tsx
 * @description Aplicación principal de Bethesda Worship Studio con MusicalWorkspace (Fases 1G y 2B).
 * Orquestación de vistas musicales, proyección canónica, autenticación en memoria y RBAC.
 */

import React from 'react';
import { MusicalWorkspace } from './components/workspace/index.ts';
import { AuthProvider } from './core/auth/auth-context.tsx';
import { UserProfileBadge } from './components/auth/UserProfileBadge.tsx';

export const App: React.FC = () => {
  return (
    <AuthProvider>
      <div className="app-root">
        {/* Cabecera Principal */}
        <header className="app-header" role="banner">
          <div className="brand-section">
            <span className="brand-logo" aria-hidden="true">✝</span>
            <div>
              <h1 className="brand-title">BETHESDA WORSHIP STUDIO</h1>
              <p className="brand-subtitle">Iglesia Cristiana Bethesda — Madrid, Cundinamarca</p>
            </div>
          </div>
          <div className="header-actions">
            <div className="phase-tag" role="status">
              Fase 2B — Seguridad RBAC
            </div>
            <UserProfileBadge />
          </div>
        </header>

        {/* Espacio de Trabajo Musical de Producción */}
        <div className="app-container">
          <MusicalWorkspace />
        </div>
      </div>
    </AuthProvider>
  );
};

