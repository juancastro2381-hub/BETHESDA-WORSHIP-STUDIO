/**
 * @file App.tsx
 * @description Aplicación principal de Bethesda Worship Studio con MusicalWorkspace (Fases 1G y 2B).
 * Orquestación de vistas musicales, proyección canónica, autenticación en memoria y RBAC.
 */

import React from 'react';
import { MusicalWorkspace } from './components/workspace/index.ts';
import { ThemeProvider } from './core/theme/index.ts';
import { AuthProvider } from './core/auth/auth-context.tsx';
import { OfflineProvider } from './core/offline/index.ts';
import { UserProfileBadge } from './components/auth/UserProfileBadge.tsx';
import { ThemeToggle } from './components/theme/index.ts';
import { OfflineStatusBar } from './components/offline/index.ts';

export const App: React.FC = () => {
  return (
    <ThemeProvider>
      <AuthProvider>
        <OfflineProvider>
          <div className="app-root">
            {/* Cabecera Principal */}
            <header className="app-header" role="banner">
              <div className="brand-section">
                <img
                  src="/worship_studio_saxophone_emblem.png"
                  alt="Worship Studio"
                  className="brand-emblem-img"
                  width={48}
                  height={48}
                />
                <div>
                  <h1 className="brand-title">WORSHIP STUDIO</h1>
                </div>
              </div>
              <div className="header-actions">
                <ThemeToggle />
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
    </ThemeProvider>
  );
};

