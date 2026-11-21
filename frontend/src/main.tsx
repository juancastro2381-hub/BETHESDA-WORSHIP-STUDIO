import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App.tsx';
import { swLifecycleManager } from './core/offline/sw-lifecycle-manager.ts';
import './index.css';

const rootElement = document.getElementById('root');
if (rootElement) {
  ReactDOM.createRoot(rootElement).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
}

// Registro controlado del Service Worker v2 con protección de escenario en vivo y precalentamiento de assets (WS-2D-01)
if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js')
      .then((registration) => {
        swLifecycleManager.attachRegistration(registration, {
          doc: typeof document !== 'undefined' ? document : null,
          baseOrigin: window.location.origin,
        });

        if (registration.installing) {
          console.info('🚀 Service Worker v2 de Bethesda Worship Studio instalándose.');
        } else if (registration.active) {
          console.info('✅ Service Worker v2 de Bethesda Worship Studio activo.');
        }
      })
      .catch((err) => {
        console.warn('⚠️ No se pudo registrar el Service Worker:', err);
      });

    navigator.serviceWorker.addEventListener('controllerchange', () => {
      swLifecycleManager.markUpdateApplied(navigator.serviceWorker.controller ?? null);
    });
  });
}
