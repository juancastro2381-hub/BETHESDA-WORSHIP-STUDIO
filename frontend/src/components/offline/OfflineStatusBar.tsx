/**
 * @file OfflineStatusBar.tsx
 * @description Barra de estado de conectividad, indicador de modo offline (WP-04) y
 * notificación controlada de actualización de Service Worker fuera del escenario activo (Fase 2D — WS-2D-01).
 */

import React, { useState, useEffect } from 'react';
import { useOffline } from '../../core/offline/use-offline.ts';
import {
  swLifecycleManager,
  type SwLifecycleSnapshot,
} from '../../core/offline/sw-lifecycle-manager.ts';
import { OfflineInventoryModal } from './OfflineInventoryModal.tsx';

export interface OfflineStatusBarProps {
  readonly onSelectSong?: ((songId: string) => void) | undefined;
  readonly onSelectSetlist?: ((setlistId: string) => void) | undefined;
}

export const OfflineStatusBar: React.FC<OfflineStatusBarProps> = ({
  onSelectSong,
  onSelectSetlist,
}) => {
  const { isOnline, summary } = useOffline();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [swSnapshot, setSwSnapshot] = useState<SwLifecycleSnapshot>(() =>
    swLifecycleManager.getSnapshot()
  );

  useEffect(() => {
    const unsubscribe = swLifecycleManager.subscribe((next) => {
      setSwSnapshot(next);
    });
    return () => {
      unsubscribe();
    };
  }, []);

  return (
    <>
      <div
        className={`offline-status-bar ${isOnline ? 'online-bar' : 'offline-bar'}`}
        role="status"
        aria-live="polite"
        id="offline-status-bar"
      >
        <div className="status-indicator-group">
          <span
            className={`status-dot ${isOnline ? 'dot-online' : 'dot-offline'}`}
            aria-hidden="true"
          />
          <span className="status-text">
            {isOnline ? (
              'En Línea — Servidor Sincronizado'
            ) : (
              <strong>Modo Sin Conexión — Solo Lectura (Atril Offline Activo)</strong>
            )}
          </span>
        </div>

        <div className="status-actions-group">
          {swSnapshot.isUpdateReadyToApply && (
            <button
              type="button"
              className="btn-open-inventory sw-update-ready-button"
              onClick={() => {
                swLifecycleManager.requestSafeUpdateActivation();
              }}
              title="Nueva versión del App Shell lista para activar de forma segura (sin ejecución activa en escenario)"
              id="btn-apply-sw-update"
            >
              <span aria-hidden="true">🔄</span>
              <span className="inventory-label">Actualizar App Shell</span>
            </button>
          )}

          <button
            type="button"
            className="btn-open-inventory"
            onClick={() => setIsModalOpen(true)}
            title="Abrir inventario de partituras y audios descargados"
            id="btn-open-offline-inventory"
          >
            <span aria-hidden="true">📦</span>
            <span className="inventory-label">
              Inventario Offline ({summary.totalItems})
            </span>
          </button>
        </div>
      </div>

      <OfflineInventoryModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSelectSong={onSelectSong}
        onSelectSetlist={onSelectSetlist}
      />
    </>
  );
};
