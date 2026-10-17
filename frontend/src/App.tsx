/**
 * @file App.tsx
 * @description Aplicación principal de Bethesda Worship Studio con MusicalWorkspace (Fases 1G y 2B).
 * Orquestación de vistas musicales, proyección canónica, autenticación en memoria y RBAC.
 */

import React from 'react';
import { MusicalWorkspace } from './components/workspace/index.ts';
import { AuthProvider } from './core/auth/auth-context.tsx';
import { OfflineProvider } from './core/offline/index.ts';
import { UserProfileBadge } from './components/auth/UserProfileBadge.tsx';
import { OfflineStatusBar } from './components/offline/index.ts';

export const App: React.FC = () => {
  return (
    <AuthProvider>
      <OfflineProvider>
        <div className="app-root">
          {/* Cabecera Principal */}
          <header className="app-header" role="banner">
            <div className="brand-section">
              <img
                src="/worship_studio_saxophone_emblem.png"
                alt="Bethesda Worship Studio"
                className="brand-emblem-img"
                width={44}
                height={44}
              />
              <div>
                <h1 className="brand-title">BETHESDA WORSHIP STUDIO</h1>
                <p className="brand-subtitle">Iglesia Cristiana Bethesda — Madrid, Cundinamarca</p>
              </div>
            </div>
            <div className="header-actions">
              <UserProfileBadge />
            </div>
          </header>

          {/* Barra de Estado de Conectividad y Modo Offline (WP-04) */}
          <OfflineStatusBar />

          {/* Espacio de Trabajo Musical de Producción */}
          <div className="app-container">
            <MusicalWorkspace />
          </div>
        </div>
      </OfflineProvider>
    </AuthProvider>
  );
};

