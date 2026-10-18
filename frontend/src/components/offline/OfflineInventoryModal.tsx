/**
 * @file OfflineInventoryModal.tsx
 * @description Modal interactivo para inspeccionar el inventario local en IndexedDB,
 * escuchar audio descargado, detectar dependencias faltantes y eliminar copias locales (WP-04).
 */

import React, { useState, useEffect, useId } from 'react';
import { useOffline } from '../../core/offline/use-offline.ts';
import { offlineManager } from '../../core/offline/offline-manager.ts';
import type { OfflineResourceMetadata, OfflineResourceType } from '../../core/offline/types.ts';

export interface OfflineInventoryModalProps {
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly onSelectSong?: ((songId: string) => void) | undefined;
  readonly onSelectSetlist?: ((setlistId: string) => void) | undefined;
}

export const OfflineInventoryModal: React.FC<OfflineInventoryModalProps> = ({
  isOpen,
  onClose,
  onSelectSong,
  onSelectSetlist,
}) => {
  const titleId = useId();
  const {
    inventory,
    summary,
    storageUsage,
    deleteLocalResource,
    getAudioUrl,
    refreshInventory,
    isOnline,
  } = useOffline();

  const [activeTab, setActiveTab] = useState<'ALL' | OfflineResourceType>('ALL');
  const [playingAudioId, setPlayingAudioId] = useState<string | null>(null);
  const [playingAudioUrl, setPlayingAudioUrl] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Escuchar tecla Escape
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // Al abrir el modal, refrescar el inventario
  useEffect(() => {
    if (isOpen) {
      refreshInventory();
    }
  }, [isOpen, refreshInventory]);

  if (!isOpen) return null;

  const filteredItems = inventory.filter((item) => {
    if (activeTab === 'ALL') return true;
    return item.resourceType === activeTab;
  });

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
  };

  const handlePlayAudio = async (audioId: string) => {
    if (playingAudioId === audioId) {
      setPlayingAudioId(null);
      setPlayingAudioUrl(null);
      return;
    }

    try {
      const url = await getAudioUrl(audioId);
      if (url) {
        setPlayingAudioId(audioId);
        setPlayingAudioUrl(url);
      } else {
        alert('No se pudo cargar el audio local. El archivo podría estar corrupto.');
      }
    } catch (err: any) {
      alert(err.message || 'Error al reproducir audio local.');
    }
  };

  const handleDeleteItem = async (item: OfflineResourceMetadata) => {
    const confirmDelete = window.confirm(
      `¿Eliminar la copia local de "${item.title}"?\n\nEsta acción solo libera espacio en este dispositivo. No altera la base de datos del servidor.`
    );
    if (!confirmDelete) return;

    setDeletingId(item.id);
    try {
      if (playingAudioId === item.id) {
        setPlayingAudioId(null);
        setPlayingAudioUrl(null);
      }
      await deleteLocalResource(item.id);
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="offline-modal-overlay" role="presentation" onClick={onClose}>
      <div
        className="offline-modal-container"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Cabecera del Modal */}
        <div className="offline-modal-header">
          <div className="header-title-group">
            <span className="header-icon" aria-hidden="true">📦</span>
            <div>
              <h2 id={titleId} className="modal-title">Inventario Offline y Gestión de Almacenamiento</h2>
              <p className="modal-subtitle">
                Material descargado disponible para atril litúrgico y lectura sin conexión
              </p>
            </div>
          </div>
          <button
            type="button"
            className="btn-modal-close"
            onClick={onClose}
            aria-label="Cerrar inventario"
          >
            ✕
          </button>
        </div>

        {/* Resumen de Almacenamiento */}
        <div className="storage-summary-banner">
          <div className="summary-metric">
            <span className="metric-label">Espacio Ocupado:</span>
            <span className="metric-value">{formatBytes(storageUsage.usedBytes)}</span>
          </div>
          <div className="summary-metric">
            <span className="metric-label">Canciones:</span>
            <span className="metric-value">{summary.songsCount}</span>
          </div>
          <div className="summary-metric">
            <span className="metric-label">Repertorios:</span>
            <span className="metric-value">{summary.setlistsCount}</span>
          </div>
          <div className="summary-metric">
            <span className="metric-label">Audios:</span>
            <span className="metric-value">{summary.audioCount}</span>
          </div>
          <div className="summary-metric">
            <span className="metric-label">Estado de Red:</span>
            <span className={`network-badge ${isOnline ? 'online' : 'offline'}`}>
              {isOnline ? '🟢 En Línea' : '🟡 Sin Conexión'}
            </span>
          </div>
        </div>

        {/* Pestañas de Filtrado */}
        <div className="offline-modal-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'ALL'}
            className={`tab-btn ${activeTab === 'ALL' ? 'active' : ''}`}
            onClick={() => setActiveTab('ALL')}
          >
            Todos ({inventory.length})
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'SONG'}
            className={`tab-btn ${activeTab === 'SONG' ? 'active' : ''}`}
            onClick={() => setActiveTab('SONG')}
          >
            🎼 Canciones ({summary.songsCount})
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'SETLIST'}
            className={`tab-btn ${activeTab === 'SETLIST' ? 'active' : ''}`}
            onClick={() => setActiveTab('SETLIST')}
          >
            📋 Repertorios ({summary.setlistsCount})
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'AUDIO'}
            className={`tab-btn ${activeTab === 'AUDIO' ? 'active' : ''}`}
            onClick={() => setActiveTab('AUDIO')}
          >
            🎧 Pistas de Audio ({summary.audioCount})
          </button>
        </div>

        {/* Notificación informativa si se selecciona Pistas de Audio (Resultado C de auditoría) */}
        {activeTab === 'AUDIO' && (
          <div
            className="audio-blocked-banner"
            role="status"
            style={{
              margin: '12px 16px',
              padding: '10px 14px',
              background: '#3b2505',
              border: '1px solid #d97706',
              borderRadius: '6px',
              color: '#fef3c7',
              fontSize: '0.85rem',
            }}
          >
            ⚠️ <strong>Pistas de Audio: Bloqueado (Resultado C de auditoría)</strong>
            <p style={{ margin: '4px 0 0 0' }}>
              El backend actual no cuenta con modelos, tablas, endpoints de streaming ni almacenamiento de audio.
              La funcionalidad se activará cuando se implemente la infraestructura de audio correspondiente.
            </p>
          </div>
        )}

        {/* Reproductor de Audio Activo si hay uno seleccionado */}
        {playingAudioUrl && (
          <div className="offline-audio-player-bar" role="region" aria-label="Reproductor de audio offline">
            <span className="player-icon" aria-hidden="true">🎵</span>
            <div className="player-controls">
              <audio src={playingAudioUrl} controls autoPlay className="html5-audio-element" />
            </div>
            <button
              type="button"
              className="btn-close-player"
              onClick={() => {
                setPlayingAudioId(null);
                setPlayingAudioUrl(null);
              }}
              title="Cerrar reproductor"
            >
              ✕
            </button>
          </div>
        )}

        {/* Lista de Recursos */}
        <div className="offline-items-list" role="region" aria-label="Lista de recursos guardados">
          {filteredItems.length === 0 ? (
            <div className="offline-empty-state">
              <span className="empty-icon" aria-hidden="true">📭</span>
              <h3>No hay recursos guardados en esta categoría</h3>
              <p>
                {isOnline
                  ? 'Explore el catálogo de canciones o repertorios y pulse "Guardar Offline" para consultarlos sin internet.'
                  : 'No se encontraron recursos locales para consultar sin conexión.'}
              </p>
            </div>
          ) : (
            filteredItems.map((item) => (
              <div key={item.id} className="offline-item-row">
                <div className="item-main-info">
                  <div className="item-title-row">
                    <span className="type-icon" aria-hidden="true">
                      {item.resourceType === 'SONG'
                        ? '🎼'
                        : item.resourceType === 'SETLIST'
                        ? '📋'
                        : '🎧'}
                    </span>
                    <strong className="item-title">{item.title}</strong>
                    {offlineManager.isAuthorizationExpired(item) ? (
                      <span className="status-pill expired" style={{ background: '#7f1d1d', color: '#fca5a5' }}>
                        Expirado (7 días)
                      </span>
                    ) : (
                      <span className={`status-pill ${item.status.toLowerCase()}`}>
                        {item.status === 'AVAILABLE_OFFLINE'
                          ? 'Disponible'
                          : item.status === 'UPDATE_AVAILABLE'
                          ? 'Actualización'
                          : item.status}
                      </span>
                    )}
                  </div>

                  <div className="item-meta-row">
                    <span>Tamaño: {formatBytes(item.byteSize)}</span>
                    <span>•</span>
                    <span>Descargado: {new Date(item.downloadedAt).toLocaleDateString()}</span>
                    {item.resourceType === 'SETLIST' && item.associatedSongIds && (
                      <>
                        <span>•</span>
                        <span>{item.associatedSongIds.length} canciones asociadas</span>
                      </>
                    )}
                  </div>

                  {/* Advertencia de dependencias faltantes en setlist (Requisito 4.2) */}
                  {item.resourceType === 'SETLIST' &&
                    item.missingSongIds &&
                    item.missingSongIds.length > 0 && (
                      <div className="missing-dependencies-alert" role="alert">
                        ⚠️ <strong>Repertorio Incompleto:</strong> Faltan{' '}
                        {item.missingSongIds.length} canciones por descargar para poder ejecutar
                        este culto completamente sin conexión.
                      </div>
                    )}
                </div>

                <div className="item-actions">
                  {/* Botón de reproducción de audio si es AUDIO */}
                  {item.resourceType === 'AUDIO' && (
                    <button
                      type="button"
                      className="btn-item-action play"
                      disabled={offlineManager.isAuthorizationExpired(item) && !isOnline}
                      onClick={() => handlePlayAudio(item.id)}
                      title={
                        offlineManager.isAuthorizationExpired(item) && !isOnline
                          ? 'Autorización offline expirada. Conéctese a internet para renovar.'
                          : playingAudioId === item.id
                          ? 'Detener'
                          : 'Reproducir'
                      }
                    >
                      {playingAudioId === item.id ? '⏹️ Detener' : '▶️ Reproducir'}
                    </button>
                  )}

                  {/* Botón de abrir en atril si es CANCIÓN */}
                  {item.resourceType === 'SONG' && onSelectSong && (
                    <button
                      type="button"
                      className="btn-item-action open"
                      disabled={offlineManager.isAuthorizationExpired(item) && !isOnline}
                      onClick={() => {
                        onSelectSong(item.id);
                        onClose();
                      }}
                      title={
                        offlineManager.isAuthorizationExpired(item) && !isOnline
                          ? 'Autorización offline expirada (7 días). Conéctese a internet para revalidar.'
                          : 'Abrir en Atril Digital'
                      }
                    >
                      📖 Abrir
                    </button>
                  )}

                  {/* Botón de cargar repertorio si es SETLIST */}
                  {item.resourceType === 'SETLIST' && onSelectSetlist && (
                    <button
                      type="button"
                      className="btn-item-action open"
                      disabled={offlineManager.isAuthorizationExpired(item) && !isOnline}
                      onClick={() => {
                        onSelectSetlist(item.id);
                        onClose();
                      }}
                      title={
                        offlineManager.isAuthorizationExpired(item) && !isOnline
                          ? 'Autorización offline expirada (7 días). Conéctese a internet para revalidar.'
                          : 'Cargar Repertorio en Atril'
                      }
                    >
                      📋 Cargar
                    </button>
                  )}

                  {/* Botón de eliminar copia local (Requisito 4.2) */}
                  <button
                    type="button"
                    className="btn-item-action delete"
                    disabled={deletingId === item.id}
                    onClick={() => handleDeleteItem(item)}
                    title="Eliminar solo de este dispositivo"
                    id={`btn-delete-offline-${item.id}`}
                  >
                    {deletingId === item.id ? '...' : '🗑️ Eliminar'}
                  </button>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Pie del Modal */}
        <div className="offline-modal-footer">
          <p className="footer-notice">
            🔒 Los datos locales están estrictamente aislados por usuario y se limpian
            automáticamente al cerrar sesión.
          </p>
          <button type="button" className="btn-modal-close-action" onClick={onClose}>
            Entendido
          </button>
        </div>
      </div>
    </div>
  );
};
