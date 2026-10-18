/**
 * @file AudioPlayerBar.tsx
 * @description Barra de reproducción y descarga de audio para el atril digital (Workstream A).
 * Soporta reproducción híbrida: streaming online autenticado con soporte Range (HTTP 206)
 * o reproducción local offline desde IndexedDB mediante Object URLs seguros con revocación.
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { BethesdaApiClient, type AudioAssetDTO } from '../../core/api/api-client.ts';
import { offlineManager } from '../../core/offline/offline-manager.ts';
import { useOffline } from '../../core/offline/use-offline.ts';

export interface AudioPlayerBarProps {
  readonly songId?: string | undefined;
  readonly songTitle?: string | undefined;
  readonly onClose?: (() => void) | undefined;
}

export const AudioPlayerBar: React.FC<AudioPlayerBarProps> = ({
  songId,
  songTitle = 'Canción Actual',
  onClose,
}) => {
  const { isOnline } = useOffline();
  const [audioAssets, setAudioAssets] = useState<AudioAssetDTO[]>([]);
  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(null);
  const [audioSrc, setAudioSrc] = useState<string | null>(null);
  const [isLocalOffline, setIsLocalOffline] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [downloading, setDownloading] = useState<boolean>(false);
  const [isSavedOffline, setIsSavedOffline] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const currentObjectUrlRef = useRef<string | null>(null);

  // Cargar pistas de audio disponibles para la canción
  useEffect(() => {
    let isCancelled = false;

    async function loadAudioTracks() {
      if (!songId) {
        setAudioAssets([]);
        setSelectedAssetId(null);
        return;
      }

      setIsLoading(true);
      setError(null);

      try {
        const client = BethesdaApiClient.getInstance();
        const tracks = await client.getSongAudioAssets(songId);
        if (!isCancelled) {
          setAudioAssets(tracks);
          if (tracks.length > 0 && tracks[0]) {
            setSelectedAssetId(tracks[0].id);
          }
        }
      } catch (err: any) {
        if (!isCancelled) {
          // Si estamos offline o falló la red, verificar en almacenamiento local IndexedDB
          try {
            const inventory = await offlineManager.getInventory();
            const audioItems = inventory.filter((item) => item.resourceType === 'AUDIO');
            if (audioItems.length > 0 && audioItems[0]) {
              const matched: AudioAssetDTO[] = audioItems.map((r) => ({
                id: r.id,
                songId: songId,
                title: r.title,
                filename: r.audioFilename ?? 'audio.mp3',
                mimeType: r.audioMimeType ?? 'audio/mpeg',
                fileSizeBytes: r.byteSize,
                checksumSha256: r.checksumSha256,
                durationSeconds: null,
                createdAt: r.downloadedAt,
              }));
              setAudioAssets(matched);
              setSelectedAssetId(matched[0]?.id ?? null);
            } else {
              setAudioAssets([]);
            }
          } catch {
            setAudioAssets([]);
          }
        }
      } finally {
        if (!isCancelled) setIsLoading(false);
      }
    }

    loadAudioTracks();

    return () => {
      isCancelled = true;
    };
  }, [songId]);

  // Resolver la fuente de audio (local IndexedDB vs streaming online)
  useEffect(() => {
    let isCancelled = false;

    async function resolveAudioSource() {
      if (!selectedAssetId) {
        setAudioSrc(null);
        setIsLocalOffline(false);
        setIsSavedOffline(false);
        return;
      }

      // Limpiar URL previa de objeto si existía
      if (currentObjectUrlRef.current) {
        URL.revokeObjectURL(currentObjectUrlRef.current);
        currentObjectUrlRef.current = null;
      }

      try {
        // 1. Intentar cargar desde IndexedDB local primero
        const localUrl = await offlineManager.getAudioObjectUrl(selectedAssetId);
        if (localUrl && !isCancelled) {
          currentObjectUrlRef.current = localUrl;
          setAudioSrc(localUrl);
          setIsLocalOffline(true);
          setIsSavedOffline(true);
          return;
        }

        // 2. Si no está en local y estamos online, usar streaming autenticado
        if (isOnline) {
          const client = BethesdaApiClient.getInstance();
          const streamUrl = client.getAudioStreamUrl(selectedAssetId);
          if (!isCancelled) {
            setAudioSrc(streamUrl);
            setIsLocalOffline(false);
            setIsSavedOffline(false);
          }
        } else {
          if (!isCancelled) {
            setAudioSrc(null);
            setError('Pista de audio no disponible sin conexión. Descárguela cuando tenga internet.');
          }
        }
      } catch (err: any) {
        if (!isCancelled) {
          setError(err?.message ?? 'No se pudo cargar la pista de audio.');
          setAudioSrc(null);
        }
      }
    }

    resolveAudioSource();

    return () => {
      isCancelled = true;
      if (currentObjectUrlRef.current) {
        URL.revokeObjectURL(currentObjectUrlRef.current);
        currentObjectUrlRef.current = null;
      }
    };
  }, [selectedAssetId, isOnline]);

  // Manejador para descargar pista y guardarla en IndexedDB para uso offline
  const handleDownloadForOffline = useCallback(async () => {
    if (!selectedAssetId) return;

    setDownloading(true);
    setError(null);

    try {
      const selectedTrack = audioAssets.find((a) => a.id === selectedAssetId);
      const title = selectedTrack?.title ?? songTitle;

      const result = await offlineManager.downloadAudio(selectedAssetId, undefined, title);

      if (result.success) {
        setIsSavedOffline(true);
        // Recargar como fuente local para usar IndexedDB
        const localUrl = await offlineManager.getAudioObjectUrl(selectedAssetId);
        if (localUrl) {
          if (currentObjectUrlRef.current) {
            URL.revokeObjectURL(currentObjectUrlRef.current);
          }
          currentObjectUrlRef.current = localUrl;
          setAudioSrc(localUrl);
          setIsLocalOffline(true);
        }
      } else {
        setError(result.error ?? 'Fallo al guardar el audio localmente.');
      }
    } catch (err: any) {
      setError(err?.message ?? 'Error durante la descarga de audio para uso offline.');
    } finally {
      setDownloading(false);
    }
  }, [selectedAssetId, audioAssets, songTitle]);

  if (!songId || (audioAssets.length === 0 && !isLoading)) {
    return null;
  }

  return (
    <aside className="offline-audio-player-bar" aria-label="Reproductor de Audio de Referencia">
      <div className="audio-track-info">
        <span className="audio-song-title">🎵 {songTitle}</span>
        {audioAssets.length > 1 && (
          <select
            className="audio-track-select"
            value={selectedAssetId ?? ''}
            onChange={(e) => setSelectedAssetId(e.target.value)}
            aria-label="Seleccionar pista de audio"
          >
            {audioAssets.map((track) => (
              <option key={track.id} value={track.id}>
                {track.title}
              </option>
            ))}
          </select>
        )}
      </div>

      {audioSrc ? (
        <audio
          ref={audioRef}
          className="html5-audio-element"
          controls
          src={audioSrc}
          preload="metadata"
          aria-label={`Reproduciendo audio: ${songTitle}`}
        >
          Su navegador no soporta el elemento de audio HTML5.
        </audio>
      ) : (
        <div className="audio-placeholder-status">
          {isLoading ? 'Cargando pistas de audio...' : error || 'Audio no disponible'}
        </div>
      )}

      <div className="audio-badges-and-actions">
        {isLocalOffline ? (
          <span className="badge-offline-mode" title="Reproduciendo desde almacenamiento local en este dispositivo">
            🟢 Local Offline (IndexedDB)
          </span>
        ) : isOnline ? (
          <span className="badge-online-stream" title="Reproduciendo mediante streaming seguro HTTP 206">
            🔵 Servidor Online (Streaming)
          </span>
        ) : (
          <span className="badge-offline-disabled">⚪ Sin Conexión</span>
        )}

        {isOnline && !isSavedOffline && (
          <button
            type="button"
            className="btn-download-audio-offline"
            onClick={handleDownloadForOffline}
            disabled={downloading}
            aria-label="Descargar audio para uso offline"
          >
            {downloading ? 'Descargando...' : '📥 Guardar Offline'}
          </button>
        )}

        {isSavedOffline && (
          <span className="badge-saved-offline" title="Pista guardada para uso sin conexión">
            ✓ Guardado
          </span>
        )}

        {onClose && (
          <button
            type="button"
            className="btn-close-player"
            onClick={onClose}
            aria-label="Cerrar reproductor de audio"
          >
            ✕
          </button>
        )}
      </div>
    </aside>
  );
};
