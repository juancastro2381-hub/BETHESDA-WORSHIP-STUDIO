import React, { useEffect, useState } from 'react';
import { BethesdaApiClient, type BackendSongItem } from '../../core/api/api-client.ts';
import { CanonicalMusicPayload } from '../../core/canonical-model/index.ts';
import { offlineStorage } from '../../core/offline/storage/indexeddb-storage.ts';
import { DownloadActionButton } from '../offline/DownloadActionButton.tsx';

export interface DatabaseSongsModalProps {
  readonly activeSong: CanonicalMusicPayload;
  readonly onSelectSong: (song: CanonicalMusicPayload, meta?: { isPersisted: boolean; songId: string; versionNumber: number }) => void;
  readonly onClose: () => void;
}

export const DatabaseSongsModal: React.FC<DatabaseSongsModalProps> = ({
  activeSong,
  onSelectSong,
  onClose,
}) => {
  const [client] = useState(() => new BethesdaApiClient());
  const [health, setHealth] = useState<{ status: string; database: string } | null>(null);
  const [songs, setSongs] = useState<BackendSongItem[]>([]);
  const [isOfflineMode, setIsOfflineMode] = useState<boolean>(
    typeof navigator !== 'undefined' ? !navigator.onLine : false
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [persisting, setPersisting] = useState(false);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        throw new Error('Sin conexión al servidor.');
      }

      const h = await client.checkHealth();
      setHealth(h);
      setIsOfflineMode(false);

      const list = await client.listSongs({ limit: 50 });
      setSongs(list.items);
    } catch (err) {
      // Fallback a canciones guardadas en almacenamiento offline IndexedDB (WP-04)
      setIsOfflineMode(true);
      try {
        const localMeta = (await offlineStorage.listMetadata()).filter((m) => m.resourceType === 'SONG');
        const fallbackItems: BackendSongItem[] = localMeta.map((m) => ({
          id: m.id,
          title: m.title,
          artist: null,
          ccliNumber: null,
          defaultKey: 'Canónico',
          defaultBpm: 120,
          timeSignature: '4/4',
          status: 'APPROVED',
          currentVersionId: null,
          createdAt: m.downloadedAt,
          updatedAt: m.lastValidatedAt,
        }));
        setSongs(fallbackItems);
        if (fallbackItems.length === 0) {
          setError('Sin conexión con el servidor y no hay canciones descargadas en la memoria local.');
        }
      } catch (localErr) {
        setError(err instanceof Error ? err.message : 'No se pudo conectar con el servidor backend.');
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleSelectSong = async (songId: string) => {
    setLoading(true);
    setError(null);
    try {
      // 1. Verificar primero si existe en IndexedDB local
      const localSong = await offlineStorage.getSongPayload(songId);
      if (localSong) {
        const canonical = CanonicalMusicPayload.fromJSON(localSong.canonicalPayload);
        onSelectSong(canonical, {
          isPersisted: true,
          songId: localSong.id,
          versionNumber: localSong.metadata.versionNumber,
        });
        onClose();
        return;
      }

      // 2. Si no está en local y estamos sin conexión, rechazar con mensaje claro
      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        throw new Error('Esta canción no ha sido descargada para uso sin conexión.');
      }

      // 3. Cargar desde el servidor si estamos en línea
      const response = await client.getSong(songId);
      const canonical = BethesdaApiClient.toCanonicalPayload(response);
      onSelectSong(canonical, {
        isPersisted: true,
        songId: response.song.id,
        versionNumber: response.version.versionNumber,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al cargar la canción.');
      setLoading(false);
    }
  };

  const handlePersistCurrent = async () => {
    setPersisting(true);
    setError(null);
    setSuccessMsg(null);
    try {
      const firstMeasure = activeSong.measures[0];
      const defaultKey = firstMeasure ? firstMeasure.keySignature.toMusicalKey().toString() : 'C Major';
      const timeSignature = firstMeasure
        ? `${firstMeasure.timeSignature.numerator}/${firstMeasure.timeSignature.denominator}`
        : '4/4';
      const defaultBpm = activeSong.timeline.tempoMap.events[0]?.bpm ?? 120;

      const res = await fetch('http://localhost:3001/api/v1/songs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: activeSong.title,
          defaultKey,
          defaultBpm,
          timeSignature,
          status: 'APPROVED',
          sourceFormat: activeSong.getAllNotes().length === 0 ? 'CHORD_PRO' : 'MUSIC_XML',
          canonicalPayload: activeSong.toJSON(),
        }),
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson?.error?.message ?? `HTTP ${res.status}`);
      }

      setSuccessMsg(`¡Canción "${activeSong.title}" guardada exitosamente en PostgreSQL!`);
      await loadData();
    } catch (err) {
      setError(`Fallo al persistir: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setPersisting(false);
    }
  };

  return (
    <div className="source-uploader-overlay" role="dialog" aria-modal="true" aria-labelledby="db-modal-title">
      <div className="source-uploader-card db-modal-card">
        <div className="uploader-header">
          <h3 id="db-modal-title">💾 Catálogo en Base de Datos (PostgreSQL)</h3>
          <button type="button" className="btn-close-uploader" onClick={onClose} aria-label="Cerrar ventana">
            ✕
          </button>
        </div>

        <div className="db-health-banner">
          {health?.database === 'connected' ? (
            <span className="db-status-badge db-connected">
              🟢 PostgreSQL: Conectado y Operativo
            </span>
          ) : (
            <span className="db-status-badge db-disconnected">
              🔴 PostgreSQL: No Conectado ({health?.database ?? 'Verificando...'})
            </span>
          )}
          <button
            type="button"
            className="btn-save-current"
            onClick={handlePersistCurrent}
            disabled={persisting || loading}
          >
            {persisting ? '⏳ Guardando...' : '💾 Guardar Canción Actual en BD'}
          </button>
        </div>

        {successMsg && (
          <div className="uploader-alert alert-success" role="status">
            {successMsg}
          </div>
        )}

        {error && (
          <div className="uploader-alert alert-error" role="alert">
            {error}
          </div>
        )}

        <div className="db-songs-list-container">
          {loading ? (
            <p className="db-loading-text">Cargando canciones desde PostgreSQL...</p>
          ) : songs.length === 0 ? (
            <div className="db-empty-list">
              <p>No hay canciones guardadas aún en la base de datos.</p>
              <p>Puedes guardar la canción activa usando el botón de arriba.</p>
            </div>
          ) : (
            <ul className="db-songs-list" role="list">
              {songs.map((s) => (
                <li key={s.id} className="db-song-item">
                  <div className="db-song-info">
                    <strong className="db-song-title">{s.title}</strong>
                    <span className="db-song-meta">
                      {s.artist ? `${s.artist} • ` : ''}Tono: {s.defaultKey} • ♩ = {s.defaultBpm} BPM • {s.timeSignature}
                    </span>
                  </div>
                  <div className="db-song-actions">
                    <DownloadActionButton
                      resourceId={s.id}
                      resourceType="SONG"
                      title={s.title}
                      compact={true}
                    />
                    <button
                      type="button"
                      className="btn-load-db-song"
                      onClick={() => handleSelectSong(s.id)}
                    >
                      Abrir en Atril
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="uploader-actions">
          <button type="button" className="btn-uploader-cancel" onClick={onClose}>
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
};
