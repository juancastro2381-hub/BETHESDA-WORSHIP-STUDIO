/**
 * @file SetlistDetailEditor.tsx
 * @description Editor interactivo de detalle de repertorio (SetlistDetailEditor) (Fase 2C — WS-2C-REMED).
 *
 * Responsabilidades:
 * - GAP-01: Incorporación de canciones canónicas mediante combobox con búsqueda en tiempo real
 *   y autoría de momentos litúrgicos de servicio (oración, ofrenda, prédica).
 * - GAP-02: Reordenamiento visual de ítems con botones táctiles accesibles [ ▲ ] y [ ▼ ] (mínimo 48x48px).
 * - GAP-03: Edición de metadatos (título, fecha programada, notas) y respeto de inmutabilidad en estados COMPLETED/ARCHIVED.
 * - RBAC: Acciones de mutación reservadas para SUPER_ADMIN, ADMIN y WORSHIP_LEADER.
 * - Accesibilidad WCAG 2.1 AA: aria-labels descriptivos, feedback de carga/error y navegación por teclado.
 */

import React, { useState, useEffect, useCallback, useId } from 'react';
import { BethesdaApiClient, type BackendSongItem } from '../../core/api/api-client.ts';
import { ApiError } from '../../core/api/api-error.ts';
import type {
  FrontendSetlistDetail,
  FrontendSetlistItem,
  FrontendTransitionType,
} from '../../core/api/setlist-types.ts';
import { useAuth } from '../../core/auth/use-auth.ts';

export interface SetlistDetailEditorProps {
  readonly setlistId: string;
  readonly onBack: () => void;
  readonly onSetlistUpdated?: () => void;
  readonly onLoadInAtril?: (setlistId: string) => Promise<void>;
  readonly apiClient?: BethesdaApiClient | undefined;
}

type AuthoringMode = 'NONE' | 'ADD_SONG' | 'ADD_MOMENT';

export const SetlistDetailEditor: React.FC<SetlistDetailEditorProps> = ({
  setlistId,
  onBack,
  onSetlistUpdated,
  onLoadInAtril,
  apiClient,
}) => {
  const client = apiClient ?? BethesdaApiClient.getInstance();
  const { user } = useAuth();
  const titleId = useId();

  // Estado del setlist y carga
  const [detail, setDetail] = useState<FrontendSetlistDetail | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [actionInProgress, setActionInProgress] = useState<boolean>(false);
  const [reorderingItemId, setReorderingItemId] = useState<string | null>(null);

  // Modo de autoría
  const [authoringMode, setAuthoringMode] = useState<AuthoringMode>('NONE');

  // Estado para edición de metadatos
  const [isEditingMetadata, setIsEditingMetadata] = useState<boolean>(false);
  const [editTitle, setEditTitle] = useState<string>('');
  const [editScheduledDate, setEditScheduledDate] = useState<string>('');
  const [editNotes, setEditNotes] = useState<string>('');
  const [savingMetadata, setSavingMetadata] = useState<boolean>(false);

  // Estado para GAP-01: Agregar Canción (Song Search Combobox)
  const [songSearchQuery, setSongSearchQuery] = useState<string>('');
  const [songSearchResults, setSongSearchResults] = useState<BackendSongItem[]>([]);
  const [songSearchLoading, setSongSearchLoading] = useState<boolean>(false);
  const [selectedSong, setSelectedSong] = useState<BackendSongItem | null>(null);
  const [songTargetKey, setSongTargetKey] = useState<string>('');
  const [songTargetBpm, setSongTargetBpm] = useState<string>('');
  const [songTransitionType, setSongTransitionType] = useState<FrontendTransitionType>('STOP');
  const [songNotesForTeam, setSongNotesForTeam] = useState<string>('');
  const [addingSong, setAddingSong] = useState<boolean>(false);

  // Estado para GAP-01: Agregar Momento Litúrgico
  const [momentTitle, setMomentTitle] = useState<string>('');
  const [momentDurationMinutes, setMomentDurationMinutes] = useState<string>('');
  const [momentMusicalKey, setMomentMusicalKey] = useState<string>('');
  const [momentNotesForTeam, setMomentNotesForTeam] = useState<string>('');
  const [addingMoment, setAddingMoment] = useState<boolean>(false);

  // Verificación RBAC
  const canManage =
    user?.role === 'SUPER_ADMIN' ||
    user?.role === 'ADMIN' ||
    user?.role === 'WORSHIP_LEADER';

  // Verificación de Máquina de Estados (Rule C: COMPLETED y ARCHIVED son de solo lectura)
  const isReadOnly = detail?.status === 'COMPLETED' || detail?.status === 'ARCHIVED';

  // Carga del detalle del setlist
  const loadDetail = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await client.getSetlist(setlistId);
      setDetail(data);
      setEditTitle(data.title);
      setEditScheduledDate(
        data.scheduledDateTime ? data.scheduledDateTime.split('T')[0] ?? '' : ''
      );
      setEditNotes(data.notes ?? '');
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.statusCode === 404) {
          setError('El repertorio solicitado no existe o fue eliminado.');
        } else if (err.statusCode === 403) {
          setError('No cuenta con permisos para ver este repertorio.');
        } else {
          setError(err.message);
        }
      } else {
        setError(err instanceof Error ? err.message : 'Error al cargar los detalles del repertorio.');
      }
    } finally {
      setLoading(false);
    }
  }, [client, setlistId]);

  useEffect(() => {
    loadDetail();
  }, [loadDetail]);

  // Búsqueda en catálogo de canciones canónicas (GAP-01)
  useEffect(() => {
    if (authoringMode !== 'ADD_SONG' || selectedSong) return;

    let active = true;
    const searchTimer = setTimeout(async () => {
      setSongSearchLoading(true);
      try {
        const queryParams: { search?: string; limit?: number } = { limit: 15 };
        const trimmed = songSearchQuery.trim();
        if (trimmed) {
          queryParams.search = trimmed;
        }
        const res = await client.listSongs(queryParams);
        if (active) {
          setSongSearchResults(res.items);
        }
      } catch {
        if (active) setSongSearchResults([]);
      } finally {
        if (active) setSongSearchLoading(false);
      }
    }, 250);

    return () => {
      active = false;
      clearTimeout(searchTimer);
    };
  }, [authoringMode, client, songSearchQuery, selectedSong]);

  // Manejo de selección de canción
  const handleSelectSong = (song: BackendSongItem) => {
    setSelectedSong(song);
    setSongTargetKey(song.defaultKey);
    setSongTargetBpm(String(song.defaultBpm));
    setSongTransitionType('STOP');
    setSongNotesForTeam('');
  };

  const handleClearSelectedSong = () => {
    setSelectedSong(null);
    setSongTargetKey('');
    setSongTargetBpm('');
    setSongNotesForTeam('');
  };

  // GAP-01: Guardar ítem Canción
  const handleAddSongSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedSong) return;

    setAddingSong(true);
    setError(null);
    setSuccessMessage(null);
    try {
      await client.addSetlistItem(setlistId, {
        itemType: 'SONG',
        songId: selectedSong.id,
        targetKey: songTargetKey.trim() || selectedSong.defaultKey,
        targetBpm: songTargetBpm ? Number(songTargetBpm) : selectedSong.defaultBpm,
        transitionType: songTransitionType,
        notesForTeam: songNotesForTeam.trim() || null,
      });

      setSuccessMessage(`Canción "${selectedSong.title}" agregada al repertorio.`);
      handleClearSelectedSong();
      setAuthoringMode('NONE');
      await loadDetail();
      onSetlistUpdated?.();
    } catch (err) {
      if (err instanceof ApiError && err.statusCode === 409) {
        setError('No es posible agregar canciones: el repertorio ya fue finalizado o archivado.');
      } else {
        setError(err instanceof Error ? err.message : 'Error al agregar canción.');
      }
    } finally {
      setAddingSong(false);
    }
  };

  // GAP-01: Guardar ítem Momento Litúrgico
  const handleAddMomentSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!momentTitle.trim()) return;

    setAddingMoment(true);
    setError(null);
    setSuccessMessage(null);
    try {
      await client.addSetlistItem(setlistId, {
        itemType: 'SERVICE_MOMENT',
        momentTitle: momentTitle.trim(),
        durationMinutes: momentDurationMinutes ? Number(momentDurationMinutes) : null,
        musicalKey: momentMusicalKey.trim() || null,
        notesForTeam: momentNotesForTeam.trim() || null,
      });

      setSuccessMessage(`Momento litúrgico "${momentTitle.trim()}" agregado al repertorio.`);
      setMomentTitle('');
      setMomentDurationMinutes('');
      setMomentMusicalKey('');
      setMomentNotesForTeam('');
      setAuthoringMode('NONE');
      await loadDetail();
      onSetlistUpdated?.();
    } catch (err) {
      if (err instanceof ApiError && err.statusCode === 409) {
        setError('No es posible agregar momentos: el repertorio ya fue finalizado o archivado.');
      } else {
        setError(err instanceof Error ? err.message : 'Error al agregar momento litúrgico.');
      }
    } finally {
      setAddingMoment(false);
    }
  };

  // GAP-02: Reordenamiento mediante botones [ ▲ ] y [ ▼ ]
  const handleMoveItem = async (index: number, direction: 'UP' | 'DOWN') => {
    if (!detail || isReadOnly || !canManage) return;

    const items = [...detail.items];
    const targetIndex = direction === 'UP' ? index - 1 : index + 1;

    if (targetIndex < 0 || targetIndex >= items.length) return;

    const currentItem = items[index];
    const targetItem = items[targetIndex];
    if (!currentItem || !targetItem) return;

    // Intercambio
    items[index] = targetItem;
    items[targetIndex] = currentItem;

    const reorderedIds = items.map((it) => it.id);

    setReorderingItemId(currentItem.id);
    setActionInProgress(true);
    setError(null);
    setSuccessMessage(null);

    try {
      const updatedItems = await client.reorderSetlist(setlistId, reorderedIds);
      setDetail((prev) => (prev ? { ...prev, items: updatedItems } : null));
      setSuccessMessage('Secuencia del repertorio actualizada con éxito.');
      onSetlistUpdated?.();
    } catch (err) {
      if (err instanceof ApiError && err.statusCode === 409) {
        setError('Conflicto al reordenar: el estado del repertorio fue modificado. Recargando...');
        await loadDetail();
      } else {
        setError(err instanceof Error ? err.message : 'Error al reordenar ítems.');
      }
    } finally {
      setReorderingItemId(null);
      setActionInProgress(false);
    }
  };

  // GAP-03: Eliminar ítem individual
  const handleDeleteItem = async (item: FrontendSetlistItem) => {
    if (isReadOnly || !canManage) return;

    const itemLabel = item.itemType === 'SONG' ? item.song?.title ?? 'Canción' : item.momentTitle ?? 'Momento';
    const confirmed = window.confirm(`¿Está seguro de eliminar "${itemLabel}" de este repertorio?`);
    if (!confirmed) return;

    setActionInProgress(true);
    setError(null);
    setSuccessMessage(null);
    try {
      await client.deleteSetlistItem(setlistId, item.id);
      setSuccessMessage(`"${itemLabel}" eliminado del repertorio.`);
      await loadDetail();
      onSetlistUpdated?.();
    } catch (err) {
      if (err instanceof ApiError && err.statusCode === 409) {
        setError('No se puede eliminar ítems de un repertorio completado o archivado.');
      } else {
        setError(err instanceof Error ? err.message : 'Error al eliminar ítem.');
      }
    } finally {
      setActionInProgress(false);
    }
  };

  // GAP-03: Guardar metadatos modificados
  const handleSaveMetadataSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editTitle.trim()) return;

    setSavingMetadata(true);
    setError(null);
    setSuccessMessage(null);
    try {
      const updated = await client.updateSetlist(setlistId, {
        title: editTitle.trim(),
        scheduledDateTime: editScheduledDate ? new Date(editScheduledDate).toISOString() : null,
        notes: editNotes.trim() || null,
      });

      setDetail((prev) =>
        prev
          ? {
              ...prev,
              title: updated.title,
              scheduledDateTime: updated.scheduledDateTime,
              notes: updated.notes,
            }
          : null
      );
      setSuccessMessage('Metadatos del repertorio actualizados.');
      setIsEditingMetadata(false);
      onSetlistUpdated?.();
    } catch (err) {
      if (err instanceof ApiError && err.statusCode === 409) {
        setError('No se pueden editar metadatos de un repertorio completado o archivado.');
      } else {
        setError(err instanceof Error ? err.message : 'Error al guardar metadatos.');
      }
    } finally {
      setSavingMetadata(false);
    }
  };

  if (loading) {
    return (
      <div className="setlist-editor-loading" role="status">
        <span className="auth-spinner" aria-hidden="true" />
        <p>Cargando detalle del repertorio litúrgico...</p>
      </div>
    );
  }

  if (!detail) {
    return (
      <div className="setlist-editor-error" role="alert">
        <p>No se pudo cargar la información del repertorio.</p>
        <button type="button" className="action-button secondary" onClick={onBack}>
          ← Volver a Repertorios
        </button>
      </div>
    );
  }

  return (
    <div className="setlist-detail-editor" aria-labelledby={titleId}>
      {/* Barra superior de navegación y acciones generales */}
      <div className="editor-nav-bar">
        <button
          type="button"
          className="btn-back-to-catalog"
          onClick={onBack}
          aria-label="Volver a la lista de repertorios"
        >
          ← Volver a Repertorios
        </button>

        <div className="editor-header-actions">
          {onLoadInAtril && (
            <button
              type="button"
              className="btn-load-atril"
              onClick={() => onLoadInAtril(setlistId)}
              disabled={actionInProgress}
            >
              Cargar en Atril
            </button>
          )}
        </div>
      </div>

      {/* Alertas de Error y Éxito */}
      {error && (
        <div className="uploader-alert alert-error" role="alert">
          <span aria-hidden="true">⚠️</span>
          <span>{error}</span>
        </div>
      )}

      {successMessage && (
        <div className="uploader-alert alert-success" role="status">
          <span aria-hidden="true">✓</span>
          <span>{successMessage}</span>
        </div>
      )}

      {/* Banner de Solo Lectura si está COMPLETED o ARCHIVED */}
      {isReadOnly && (
        <div className="setlist-readonly-banner" role="note">
          <span aria-hidden="true">🔒</span>
          <span>
            <strong>Repertorio finalizado ({detail.status === 'COMPLETED' ? 'COMPLETADO' : 'ARCHIVADO'}):</strong> Modo de
            solo lectura. La secuencia litúrgica y los elementos no pueden ser modificados.
          </span>
        </div>
      )}

      {/* Cabecera del Repertorio & Edición de Metadatos (GAP-03) */}
      <div className="setlist-detail-header-card">
        {!isEditingMetadata ? (
          <div className="header-view-mode">
            <div className="header-title-row">
              <div className="title-and-badges">
                <h3 id={titleId} className="setlist-detail-title">
                  {detail.title}
                </h3>
                <span className={`setlist-status-badge ${detail.status.toLowerCase()}`}>
                  {detail.status === 'ACTIVE' && '● EN CULTO / ACTIVO'}
                  {detail.status === 'PLANNING' && 'EN PLANIFICACIÓN'}
                  {detail.status === 'COMPLETED' && 'COMPLETADO'}
                  {detail.status === 'ARCHIVED' && 'ARCHIVADO'}
                </span>
                {detail.scheduledDateTime && (
                  <span className="setlist-date-badge">
                    📅 {new Date(detail.scheduledDateTime).toLocaleDateString()}
                  </span>
                )}
              </div>

              {canManage && !isReadOnly && (
                <button
                  type="button"
                  className="btn-edit-metadata"
                  onClick={() => setIsEditingMetadata(true)}
                  aria-label="Editar metadatos del repertorio"
                >
                  ✏️ Editar Metadatos
                </button>
              )}
            </div>

            {detail.notes && <p className="setlist-detail-notes">{detail.notes}</p>}

            <div className="setlist-summary-stats">
              <span>Total de elementos: <strong>{detail.items.length}</strong></span>
              <span>•</span>
              <span>Canciones: <strong>{detail.items.filter((i) => i.itemType === 'SONG').length}</strong></span>
              <span>•</span>
              <span>Momentos: <strong>{detail.items.filter((i) => i.itemType === 'SERVICE_MOMENT').length}</strong></span>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSaveMetadataSubmit} className="setlist-edit-metadata-form" aria-label="Editar metadatos">
            <h4 className="metadata-form-heading">Editar Metadatos del Repertorio</h4>
            <div className="create-form-grid">
              <div className="form-group">
                <label htmlFor="edit-title-input">Título del Servicio *</label>
                <input
                  id="edit-title-input"
                  type="text"
                  required
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  className="auth-input"
                  disabled={savingMetadata}
                />
              </div>
              <div className="form-group">
                <label htmlFor="edit-date-input">Fecha del Servicio</label>
                <input
                  id="edit-date-input"
                  type="date"
                  value={editScheduledDate}
                  onChange={(e) => setEditScheduledDate(e.target.value)}
                  className="auth-input"
                  disabled={savingMetadata}
                />
              </div>
            </div>
            <div className="form-group">
              <label htmlFor="edit-notes-input">Notas / Indicaciones</label>
              <textarea
                id="edit-notes-input"
                rows={2}
                value={editNotes}
                onChange={(e) => setEditNotes(e.target.value)}
                className="auth-input setlist-textarea"
                disabled={savingMetadata}
              />
            </div>
            <div className="metadata-form-actions">
              <button
                type="button"
                className="action-button secondary"
                onClick={() => setIsEditingMetadata(false)}
                disabled={savingMetadata}
              >
                Cancelar
              </button>
              <button
                type="submit"
                className="action-button primary"
                disabled={savingMetadata || !editTitle.trim()}
              >
                {savingMetadata ? 'Guardando...' : 'Guardar Cambios'}
              </button>
            </div>
          </form>
        )}
      </div>

      {/* Panel de Autoría de Ítems (GAP-01) — Solo si no es de solo lectura y rol autorizado */}
      {canManage && !isReadOnly && (
        <div className="setlist-authoring-panel">
          <div className="authoring-trigger-bar">
            <span className="authoring-bar-label">Agregar al orden del culto:</span>
            <div className="authoring-buttons-group">
              <button
                type="button"
                className={`btn-authoring-tab ${authoringMode === 'ADD_SONG' ? 'active' : ''}`}
                onClick={() => setAuthoringMode(authoringMode === 'ADD_SONG' ? 'NONE' : 'ADD_SONG')}
                aria-expanded={authoringMode === 'ADD_SONG'}
              >
                🎵 + Canción Canónica
              </button>
              <button
                type="button"
                className={`btn-authoring-tab ${authoringMode === 'ADD_MOMENT' ? 'active' : ''}`}
                onClick={() => setAuthoringMode(authoringMode === 'ADD_MOMENT' ? 'NONE' : 'ADD_MOMENT')}
                aria-expanded={authoringMode === 'ADD_MOMENT'}
              >
                🕊️ + Momento Litúrgico
              </button>
            </div>
          </div>

          {/* Formulario GAP-01: Agregar Canción */}
          {authoringMode === 'ADD_SONG' && (
            <div className="authoring-subform-box" role="region" aria-label="Agregar canción al repertorio">
              <h4 className="subform-title">Seleccionar Canción del Cancionero Canónico</h4>

              {!selectedSong ? (
                <div className="song-search-combobox">
                  <div className="form-group">
                    <label htmlFor="song-search-input">Buscar Canción</label>
                    <input
                      id="song-search-input"
                      type="text"
                      className="auth-input"
                      placeholder="Escriba el título o artista para filtrar..."
                      value={songSearchQuery}
                      onChange={(e) => setSongSearchQuery(e.target.value)}
                      autoFocus
                    />
                  </div>

                  {songSearchLoading && (
                    <div className="combobox-loading">
                      <span className="auth-spinner" aria-hidden="true" />
                      <span>Buscando en el cancionario...</span>
                    </div>
                  )}

                  {!songSearchLoading && songSearchResults.length > 0 && (
                    <ul className="combobox-results-list" role="listbox" aria-label="Resultados de búsqueda de canciones">
                      {songSearchResults.map((song) => (
                        <li
                          key={song.id}
                          className="combobox-result-item"
                          onClick={() => handleSelectSong(song)}
                          role="option"
                          aria-selected={false}
                          tabIndex={0}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              handleSelectSong(song);
                            }
                          }}
                        >
                          <div className="result-song-info">
                            <strong className="result-song-title">{song.title}</strong>
                            {song.artist && <span className="result-song-artist"> — {song.artist}</span>}
                          </div>
                          <div className="result-song-meta">
                            <span className="key-pill">Tono: {song.defaultKey}</span>
                            <span className="bpm-pill">{song.defaultBpm} BPM</span>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}

                  {!songSearchLoading && songSearchResults.length === 0 && songSearchQuery.trim().length > 0 && (
                    <p className="combobox-empty-hint">No se encontraron canciones que coincidan con la búsqueda.</p>
                  )}
                </div>
              ) : (
                <form onSubmit={handleAddSongSubmit} className="selected-song-form" aria-label="Configurar canción seleccionada">
                  <div className="selected-song-card">
                    <div className="selected-song-details">
                      <span className="badge-selected">Canción seleccionada:</span>
                      <h5 className="selected-title">{selectedSong.title}</h5>
                      {selectedSong.artist && <span className="selected-artist">{selectedSong.artist}</span>}
                    </div>
                    <button
                      type="button"
                      className="btn-clear-selection"
                      onClick={handleClearSelectedSong}
                      aria-label="Cambiar canción seleccionada"
                    >
                      ✕ Cambiar
                    </button>
                  </div>

                  <div className="song-override-grid">
                    <div className="form-group">
                      <label htmlFor="song-target-key">Tono para este Culto</label>
                      <input
                        id="song-target-key"
                        type="text"
                        className="auth-input"
                        placeholder="Ej. G, D, Bb"
                        value={songTargetKey}
                        onChange={(e) => setSongTargetKey(e.target.value)}
                        maxLength={16}
                      />
                    </div>

                    <div className="form-group">
                      <label htmlFor="song-target-bpm">Tempo (BPM)</label>
                      <input
                        id="song-target-bpm"
                        type="number"
                        min={20}
                        max={300}
                        className="auth-input"
                        placeholder="BPM"
                        value={songTargetBpm}
                        onChange={(e) => setSongTargetBpm(e.target.value)}
                      />
                    </div>

                    <div className="form-group">
                      <label htmlFor="song-transition-type">Tipo de Transición</label>
                      <select
                        id="song-transition-type"
                        className="auth-input"
                        value={songTransitionType}
                        onChange={(e) => setSongTransitionType(e.target.value as FrontendTransitionType)}
                      >
                        <option value="STOP">STOP — Parada / Espacio</option>
                        <option value="SEGUE">SEGUE — Continuo directo</option>
                        <option value="CROSSFADE">CROSSFADE — Empalme suave</option>
                        <option value="MEDLEY">MEDLEY — Unión en Popurrí</option>
                      </select>
                    </div>
                  </div>

                  <div className="form-group">
                    <label htmlFor="song-notes-input">Indicaciones para Alabanza / Músicos</label>
                    <textarea
                      id="song-notes-input"
                      rows={2}
                      className="auth-input setlist-textarea"
                      placeholder="Ej. Entrada con piano solo, coro suave al final..."
                      value={songNotesForTeam}
                      onChange={(e) => setSongNotesForTeam(e.target.value)}
                    />
                  </div>

                  <div className="subform-actions">
                    <button
                      type="button"
                      className="action-button secondary"
                      onClick={() => {
                        handleClearSelectedSong();
                        setAuthoringMode('NONE');
                      }}
                      disabled={addingSong}
                    >
                      Cancelar
                    </button>
                    <button type="submit" className="action-button primary" disabled={addingSong}>
                      {addingSong ? 'Agregando...' : '+ Agregar al Repertorio'}
                    </button>
                  </div>
                </form>
              )}
            </div>
          )}

          {/* Formulario GAP-01: Agregar Momento Litúrgico */}
          {authoringMode === 'ADD_MOMENT' && (
            <form onSubmit={handleAddMomentSubmit} className="authoring-subform-box" aria-label="Crear momento litúrgico">
              <h4 className="subform-title">Definir Momento Litúrgico</h4>

              <div className="form-group">
                <label htmlFor="moment-title-input">Título o Descripción del Momento *</label>
                <input
                  id="moment-title-input"
                  type="text"
                  required
                  maxLength={255}
                  className="auth-input"
                  placeholder="Ej. Bienvenida y Oración Inicial, Momento de Diezmos y Ofrendas, Mensaje de la Palabra"
                  value={momentTitle}
                  onChange={(e) => setMomentTitle(e.target.value)}
                  autoFocus
                />
              </div>

              <div className="create-form-grid">
                <div className="form-group">
                  <label htmlFor="moment-duration-input">Duración Estimada (Minutos)</label>
                  <input
                    id="moment-duration-input"
                    type="number"
                    min={1}
                    max={180}
                    className="auth-input"
                    placeholder="Ej. 10"
                    value={momentDurationMinutes}
                    onChange={(e) => setMomentDurationMinutes(e.target.value)}
                  />
                </div>

                <div className="form-group">
                  <label htmlFor="moment-key-input">Tonalidad Pad / Fondo Musical</label>
                  <input
                    id="moment-key-input"
                    type="text"
                    maxLength={16}
                    className="auth-input"
                    placeholder="Ej. Re Mayor (D)"
                    value={momentMusicalKey}
                    onChange={(e) => setMomentMusicalKey(e.target.value)}
                  />
                </div>
              </div>

              <div className="form-group">
                <label htmlFor="moment-notes-input">Indicaciones Ministeriales</label>
                <textarea
                  id="moment-notes-input"
                  rows={2}
                  className="auth-input setlist-textarea"
                  placeholder="Instrucciones para el director y la congregación..."
                  value={momentNotesForTeam}
                  onChange={(e) => setMomentNotesForTeam(e.target.value)}
                />
              </div>

              <div className="subform-actions">
                <button
                  type="button"
                  className="action-button secondary"
                  onClick={() => setAuthoringMode('NONE')}
                  disabled={addingMoment}
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="action-button primary"
                  disabled={addingMoment || !momentTitle.trim()}
                >
                  {addingMoment ? 'Agregando...' : '+ Agregar Momento Litúrgico'}
                </button>
              </div>
            </form>
          )}
        </div>
      )}

      {/* Listado de Ítems y Reordenamiento GAP-02 */}
      <div className="setlist-items-section">
        <h4 className="items-section-title">
          Secuencia Litúrgica ({detail.items.length} {detail.items.length === 1 ? 'elemento' : 'elementos'})
        </h4>

        {detail.items.length === 0 ? (
          <div className="setlist-items-empty" role="status">
            <p className="empty-title">Este repertorio no contiene elementos aún.</p>
            <p className="empty-hint">
              {canManage && !isReadOnly
                ? 'Utilice los botones superiores para agregar canciones del cancionario o momentos litúrgicos.'
                : 'No se han configurado elementos para este servicio.'}
            </p>
          </div>
        ) : (
          <ol className="setlist-items-ordered-list" aria-label="Lista ordenada de elementos del culto">
            {detail.items.map((item, index) => {
              const isFirst = index === 0;
              const isLast = index === detail.items.length - 1;
              const isReorderingThis = reorderingItemId === item.id;

              const title =
                item.itemType === 'SONG'
                  ? item.song?.title ?? 'Canción Canónica'
                  : item.momentTitle ?? 'Momento de Culto';

              return (
                <li
                  key={item.id}
                  className={`setlist-item-row ${item.itemType === 'SONG' ? 'type-song' : 'type-moment'} ${
                    isReorderingThis ? 'reordering' : ''
                  }`}
                >
                  {/* Número de secuencia */}
                  <div className="item-sequence-index" aria-label={`Posición ${index + 1}`}>
                    <span className="sequence-number">{index + 1}</span>
                  </div>

                  {/* Controles de reordenamiento GAP-02 (Botones táctiles >= 48px) */}
                  {canManage && !isReadOnly && (
                    <div className="item-reorder-controls" role="group" aria-label={`Reordenar ${title}`}>
                      <button
                        type="button"
                        className="btn-reorder btn-move-up"
                        onClick={() => handleMoveItem(index, 'UP')}
                        disabled={isFirst || actionInProgress}
                        aria-label={`Mover "${title}" hacia arriba`}
                        title={isFirst ? 'Primer elemento en la secuencia' : 'Mover hacia arriba'}
                      >
                        ▲
                      </button>
                      <button
                        type="button"
                        className="btn-reorder btn-move-down"
                        onClick={() => handleMoveItem(index, 'DOWN')}
                        disabled={isLast || actionInProgress}
                        aria-label={`Mover "${title}" hacia abajo`}
                        title={isLast ? 'Último elemento en la secuencia' : 'Mover hacia abajo'}
                      >
                        ▼
                      </button>
                    </div>
                  )}

                  {/* Contenido descriptivo del ítem */}
                  <div className="item-body">
                    <div className="item-title-meta-row">
                      <span className={`item-type-pill ${item.itemType.toLowerCase()}`}>
                        {item.itemType === 'SONG' ? '🎵 CANCIÓN' : '🕊️ MOMENTO'}
                      </span>
                      <h5 className="item-title-text">{title}</h5>
                      {item.itemType === 'SONG' && item.song?.artist && (
                        <span className="item-artist-text">({item.song.artist})</span>
                      )}
                    </div>

                    <div className="item-musical-details">
                      {item.itemType === 'SONG' ? (
                        <>
                          <span className="detail-tag">Tono: <strong>{item.targetKey ?? item.song?.defaultKey ?? '—'}</strong></span>
                          <span className="detail-tag">BPM: <strong>{item.targetBpm ?? item.song?.defaultBpm ?? '—'}</strong></span>
                        </>
                      ) : (
                        <>
                          {item.durationMinutes && (
                            <span className="detail-tag">⏱️ {item.durationMinutes} min</span>
                          )}
                          {item.musicalKey && (
                            <span className="detail-tag">🎹 Pad: {item.musicalKey}</span>
                          )}
                        </>
                      )}
                      {item.transitionType && item.transitionType !== 'STOP' && (
                        <span className="transition-badge">{item.transitionType}</span>
                      )}
                    </div>

                    {item.notesForTeam && (
                      <p className="item-team-notes">💬 {item.notesForTeam}</p>
                    )}
                  </div>

                  {/* Botón de eliminar ítem individual GAP-03 */}
                  {canManage && !isReadOnly && (
                    <div className="item-actions">
                      <button
                        type="button"
                        className="btn-delete-item"
                        onClick={() => handleDeleteItem(item)}
                        disabled={actionInProgress}
                        aria-label={`Eliminar "${title}" del repertorio`}
                        title="Eliminar este elemento del repertorio"
                      >
                        🗑️
                      </button>
                    </div>
                  )}
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </div>
  );
};
