/**
 * @file DownloadActionButton.tsx
 * @description Botón interactivo de descarga con reflejo fiel del estado local en IndexedDB (WP-04).
 */

import React, { useState } from 'react';
import { useOffline } from '../../core/offline/use-offline.ts';
import type { OfflineResourceType } from '../../core/offline/types.ts';

export interface DownloadActionButtonProps {
  readonly resourceId: string;
  readonly resourceType: OfflineResourceType;
  readonly title: string;
  readonly audioUrl?: string;
  readonly onDownloaded?: () => void;
  readonly className?: string;
  readonly compact?: boolean;
}

export const DownloadActionButton: React.FC<DownloadActionButtonProps> = ({
  resourceId,
  resourceType,
  title,
  audioUrl,
  onDownloaded,
  className = '',
  compact = false,
}) => {
  const {
    isOnline,
    getResourceStatus,
    downloadSong,
    downloadSetlist,
    downloadAudio,
    deleteLocalResource,
  } = useOffline();

  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const status = getResourceStatus(resourceId);

  const handleAction = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setErrorMsg(null);

    // Si ya está descargado y el usuario hace clic, ofrecer eliminar la copia local
    if (status === 'AVAILABLE_OFFLINE') {
      const confirmDelete = window.confirm(
        `¿Desea eliminar la copia local de "${title}"?\n\n(Esta acción solo libera espacio en este dispositivo; el contenido original permanece seguro en el servidor).`
      );
      if (confirmDelete) {
        setLoading(true);
        try {
          await deleteLocalResource(resourceId);
        } finally {
          setLoading(false);
        }
      }
      return;
    }

    if (!isOnline) {
      alert('Se requiere conexión a internet para descargar este recurso por primera vez.');
      return;
    }

    setLoading(true);
    try {
      if (resourceType === 'SONG') {
        const res = await downloadSong(resourceId);
        if (!res.success) {
          setErrorMsg(res.error ?? 'Fallo al descargar canción.');
        }
      } else if (resourceType === 'SETLIST') {
        const res = await downloadSetlist(resourceId, { includeSongs: true });
        if (!res.success) {
          setErrorMsg(res.error ?? 'Fallo al descargar repertorio.');
        }
      } else if (resourceType === 'AUDIO' && audioUrl) {
        const res = await downloadAudio(resourceId, audioUrl, title);
        if (!res.success) {
          setErrorMsg(res.error ?? 'Fallo al descargar audio.');
        }
      }

      if (onDownloaded) {
        onDownloaded();
      }
    } catch (err: any) {
      setErrorMsg(err?.message ?? 'Error inesperado durante la descarga.');
    } finally {
      setLoading(false);
    }
  };

  // Renderizado según estado verificado
  if (loading) {
    return (
      <button
        type="button"
        className={`btn-offline-action downloading ${className}`}
        disabled
        aria-busy="true"
        title="Descargando y verificando integridad..."
      >
        <span className="auth-spinner" aria-hidden="true" />
        {!compact && ' Descargando...'}
      </button>
    );
  }

  if (status === 'AVAILABLE_OFFLINE') {
    return (
      <button
        type="button"
        className={`btn-offline-action available ${className}`}
        onClick={handleAction}
        title="Disponible sin conexión. Haga clic para gestionar o liberar espacio local."
        id={`btn-offline-${resourceId}`}
      >
        <span aria-hidden="true">✅</span>
        {!compact && ' Disponible Offline'}
      </button>
    );
  }

  if (status === 'UPDATE_AVAILABLE') {
    return (
      <button
        type="button"
        className={`btn-offline-action update-available ${className}`}
        onClick={handleAction}
        title="Hay una versión más reciente en el servidor. Haga clic para actualizar."
        id={`btn-offline-${resourceId}`}
      >
        <span aria-hidden="true">🔄</span>
        {!compact && ' Actualizar Copia'}
      </button>
    );
  }

  if (status === 'FAILED') {
    return (
      <button
        type="button"
        className={`btn-offline-action failed ${className}`}
        onClick={handleAction}
        title={errorMsg ?? 'La descarga previa falló. Haga clic para reintentar.'}
        id={`btn-offline-${resourceId}`}
      >
        <span aria-hidden="true">⚠️</span>
        {!compact && ' Reintentar'}
      </button>
    );
  }

  // Por defecto: NOT_DOWNLOADED o REMOVED
  return (
    <button
      type="button"
      className={`btn-offline-action not-downloaded ${className}`}
      onClick={handleAction}
      title={isOnline ? 'Descargar para usar sin conexión' : 'Requiere conexión para descargar'}
      disabled={!isOnline}
      id={`btn-offline-${resourceId}`}
    >
      <span aria-hidden="true">📥</span>
      {!compact && ' Guardar Offline'}
    </button>
  );
};
