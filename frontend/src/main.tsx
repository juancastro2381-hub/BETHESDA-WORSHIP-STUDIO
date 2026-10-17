import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App.tsx';
import './index.css';

const rootElement = document.getElementById('root');
if (rootElement) {
  ReactDOM.createRoot(rootElement).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
}

// Registro seguro del Service Worker en navegadores compatibles (WP-04)
if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js')
      .then((registration) => {
        // SW registrado exitosamente para cacheo de App Shell
        if (registration.installing) {
          console.info('🚀 Service Worker de Bethesda Worship Studio instalándose.');
        } else if (registration.active) {
          console.info('✅ Service Worker de Bethesda Worship Studio activo.');
        }
      })
      .catch((err) => {
        console.warn('⚠️ No se pudo registrar el Service Worker:', err);
      });
  });
}

