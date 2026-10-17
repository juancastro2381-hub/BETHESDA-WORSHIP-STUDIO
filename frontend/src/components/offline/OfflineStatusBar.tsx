/**
 * @file OfflineStatusBar.tsx
 * @description Barra de estado de conectividad e indicador de modo offline (WP-04).
 */

import React, { useState } from 'react';
import { useOffline } from '../../core/offline/use-offline.ts';
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
