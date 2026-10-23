/**
 * @file SetlistsModal.tsx
 * @description Modal interactivo para explorar, seleccionar y administrar repertorios litúrgicos (Setlists) (Fase 2C — WS7 y WS-2C-REMED).
 *
 * Responsabilidades:
 * - Cargar y listar los setlists del backend mediante BethesdaApiClient.
 * - Proveer pestañas de filtrado: Todos, Activo / En Curso, En Planificación, Historial (Completados / Archivados).
 * - Discriminar estados litúrgicos con badges semánticos (ACTIVE con brillo, PLANNING, COMPLETED, ARCHIVED).
 * - Permitir la selección y carga directa en atril invocando useSetlistExecution.
 * - WS-2C-REMED GAP-01, GAP-02, GAP-03:
 *   - Alternar entre vista de catálogo y SetlistDetailEditor.
 *   - Botón "+ Nuevo Repertorio" para programar servicios.
 *   - Botón "⚙️ Administrar / 👁️ Ver Ítems" para entrar a la autoría y reordenamiento de canciones y momentos.
 *   - Botón "🗑️ Eliminar" con confirmación explícita exclusivo para SUPER_ADMIN y ADMIN (oculto para WORSHIP_LEADER).
 * - Respetar la matriz RBAC de la congregación y la máquina de estados litúrgica.
 * - Proveer accesibilidad WCAG 2.1 AA (role="dialog", aria-modal, foco, Escape multinivel).
 * - Manejo robusto de errores mediante ApiError sin fugar detalles técnicos.
 */

import React, { useEffect, useState, useCallback, useId } from 'react';
import { BethesdaApiClient } from '../../core/api/api-client.ts';
import { ApiError } from '../../core/api/api-error.ts';
import type {
  FrontendSetlistSummary,
  FrontendSetlistStatus,
} from '../../core/api/setlist-types.ts';
import { useAuth } from '../../core/auth/use-auth.ts';
import { SetlistDetailEditor } from './SetlistDetailEditor.tsx';
import { offlineStorage } from '../../core/offline/storage/indexeddb-storage.ts';
import { DownloadActionButton } from '../offline/DownloadActionButton.tsx';
import { ModalCloseButton, SetlistIcon, TrashIcon } from '../common/Icons.tsx';

export type SetlistTab = 'ALL' | 'ACTIVE' | 'PLANNING' | 'HISTORY';

export interface SetlistsModalProps {
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly onLoadSetlist: (setlistId: string) => Promise<void>;
  readonly activeSetlistId?: string | null | undefined;
  readonly apiClient?: BethesdaApiClient | undefined;
}

export const SetlistsModal: React.FC<SetlistsModalProps> = ({
  isOpen,
  onClose,
  onLoadSetlist,
  activeSetlistId,
  apiClient,
}) => {
  const client = apiClient ?? BethesdaApiClient.getInstance();
  const { user } = useAuth();
  const titleId = useId();

  const [setlists, setSetlists] = useState<FrontendSetlistSummary[]>([]);
  const [missingDepsMap, setMissingDepsMap] = useState<Map<string, string[]>>(new Map());
  const [isOfflineMode, setIsOfflineMode] = useState<boolean>(
    typeof navigator !== 'undefined' ? !navigator.onLine : false
  );
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<SetlistTab>('ALL');
  const [actionInProgressId, setActionInProgressId] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Navegación interna: 'CATALOG' (listado) vs 'DETAIL' (SetlistDetailEditor)
  const [activeView, setActiveView] = useState<'CATALOG' | 'DETAIL'>('CATALOG');
  const [selectedSetlistIdForDetail, setSelectedSetlistIdForDetail] = useState<string | null>(null);

  // Formulario para creación rápida de setlist (solo roles autorizados)
  const [showCreateForm, setShowCreateForm] = useState<boolean>(false);
  const [newTitle, setNewTitle] = useState<string>('');
  const [newScheduledDate, setNewScheduledDate] = useState<string>('');
  const [newNotes, setNewNotes] = useState<string>('');
  const [creating, setCreating] = useState<boolean>(false);

  // Estado para confirmación de eliminación (GAP-03: solo SUPER_ADMIN y ADMIN)
  const [setlistToDelete, setSetlistToDelete] = useState<FrontendSetlistSummary | null>(null);
  const [deletingSetlist, setDeletingSetlist] = useState<boolean>(false);

  // Permisos según RBAC
  const canManageSetlists =
    user?.role === 'SUPER_ADMIN' ||
    user?.role === 'ADMIN' ||
    user?.role === 'WORSHIP_LEADER';

  // Solo ADMIN y SUPER_ADMIN pueden eliminar repertorios (WORSHIP_LEADER = false)
  const canDeleteSetlists =
    user?.role === 'SUPER_ADMIN' ||
    user?.role === 'ADMIN';

  // Carga de datos
  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        throw new Error('Sin conexión al servidor.');
      }

      const result = await client.listSetlists({ limit: 50 });
      setSetlists(result.items);
      setIsOfflineMode(false);

      // Cargar metadatos locales de dependencias faltantes
      const localMeta = await offlineStorage.listMetadata();
      const depMap = new Map<string, string[]>();
      for (const m of localMeta) {
        if (m.resourceType === 'SETLIST' && m.missingSongIds && m.missingSongIds.length > 0) {
          depMap.set(m.id, [...m.missingSongIds]);
        }
      }
      setMissingDepsMap(depMap);
    } catch (err) {
      // Fallback a setlists descargados localmente en IndexedDB (WP-04)
      setIsOfflineMode(true);
      try {
        const localMeta = (await offlineStorage.listMetadata()).filter((m) => m.resourceType === 'SETLIST');
        const depMap = new Map<string, string[]>();
        const fallbackSetlists: FrontendSetlistSummary[] = [];

        for (const m of localMeta) {
          if (m.missingSongIds && m.missingSongIds.length > 0) {
            depMap.set(m.id, [...m.missingSongIds]);
          }
          const payload = await offlineStorage.getSetlistPayload(m.id);
          if (payload) {
            fallbackSetlists.push({
              id: payload.setlistDetail.id,
              title: payload.setlistDetail.title,
              scheduledDateTime: payload.setlistDetail.scheduledDateTime,
              status: payload.setlistDetail.status,
              directorUserId: payload.setlistDetail.directorUserId,
              directorName: payload.setlistDetail.directorName ?? null,
              totalItems: payload.setlistDetail.items.length,
              totalSongs: payload.setlistDetail.items.filter((i) => i.itemType === 'SONG').length,
              createdAt: payload.setlistDetail.createdAt,
              updatedAt: payload.setlistDetail.updatedAt,
            });
          }
        }
        setMissingDepsMap(depMap);
        setSetlists(fallbackSetlists);

        if (fallbackSetlists.length === 0) {
          setError('Sin conexión con el servidor y no hay repertorios guardados en la memoria local.');
        }
      } catch (localErr) {
        if (err instanceof ApiError) {
          if (err.statusCode === 401) {
            setError('Sesión expirada. Por favor vuelva a iniciar sesión.');
          } else if (err.statusCode === 403) {
            setError('No cuenta con privilegios para consultar los repertorios.');
          } else {
            setError(err.message);
          }
        } else {
          setError(err instanceof Error ? err.message : 'Error al conectar con el servidor.');
        }
      }
    } finally {
      setLoading(false);
    }
  }, [client]);

  useEffect(() => {
    if (isOpen) {
      loadData();
    }
  }, [isOpen, loadData]);

  // Manejo de tecla Escape
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (setlistToDelete) {
          setSetlistToDelete(null);
        } else if (activeView === 'DETAIL') {
          setActiveView('CATALOG');
          setSelectedSetlistIdForDetail(null);
          loadData();
        } else {
          onClose();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose, setlistToDelete, activeView, loadData]);

  // Acciones de ciclo de vida
  const handleSelectSetlist = async (setlistId: string) => {
    setActionInProgressId(setlistId);
    setError(null);
    try {
      await onLoadSetlist(setlistId);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al cargar el setlist en atril.');
    } finally {
      setActionInProgressId(null);
    }
  };

  const handleStatusTransition = async (
    setlistId: string,
    targetStatus: FrontendSetlistStatus
  ) => {
    setActionInProgressId(setlistId);
    setError(null);
    setSuccessMessage(null);
    try {
      await client.updateSetlistStatus(setlistId, targetStatus);
      const actionName =
        targetStatus === 'ACTIVE'
          ? 'activado para culto'
          : targetStatus === 'COMPLETED'
          ? 'finalizado'
          : 'archivado';
      setSuccessMessage(`Repertorio ${actionName} exitosamente.`);
      await loadData();
    } catch (err) {
      if (err instanceof ApiError && err.statusCode === 409) {
        setError(
          'Conflicto litúrgico: Ya existe otro repertorio actualmente ACTIVO en la congregación. Finalícelo o desactívelo antes de activar este.'
        );
      } else {
        setError(err instanceof Error ? err.message : 'Error al actualizar el estado del repertorio.');
      }
    } finally {
      setActionInProgressId(null);
    }
  };

  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim()) return;

    setCreating(true);
    setError(null);
    setSuccessMessage(null);
    try {
      const created = await client.createSetlist({
        title: newTitle.trim(),
        scheduledDateTime: newScheduledDate ? new Date(newScheduledDate).toISOString() : null,
        notes: newNotes.trim() || null,
      });
      setSuccessMessage(`Repertorio "${newTitle.trim()}" creado exitosamente.`);
      setNewTitle('');
      setNewScheduledDate('');
      setNewNotes('');
      setShowCreateForm(false);
      await loadData();
      // Abrir inmediatamente en modo detalle para que el líder pueda agregar canciones y momentos
      setSelectedSetlistIdForDetail(created.id);
      setActiveView('DETAIL');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al crear el repertorio.');
    } finally {
      setCreating(false);
    }
  };

  // Confirmación de eliminación de setlist (GAP-03)
  const handleConfirmDeleteSetlist = async () => {
    if (!setlistToDelete) return;

    setDeletingSetlist(true);
    setError(null);
    setSuccessMessage(null);
    try {
      await client.deleteSetlist(setlistToDelete.id);
      setSuccessMessage(`Repertorio "${setlistToDelete.title}" eliminado exitosamente.`);
      setSetlistToDelete(null);
      await loadData();
    } catch (err) {
      if (err instanceof ApiError && err.statusCode === 403) {
        setError('No cuenta con privilegios de Administrador para eliminar repertorios.');
      } else {
        setError(err instanceof Error ? err.message : 'Error al eliminar el repertorio.');
      }
    } finally {
      setDeletingSetlist(false);
    }
  };

  if (!isOpen) return null;

  // Filtrado reactivo de setlists
  const filteredSetlists = setlists.filter((s) => {
    if (activeTab === 'ACTIVE') return s.status === 'ACTIVE';
    if (activeTab === 'PLANNING') return s.status === 'PLANNING';
    if (activeTab === 'HISTORY') return s.status === 'COMPLETED' || s.status === 'ARCHIVED';
    return true;
  });

  return (
    <div
      className="modal-backdrop setlists-modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
    >
      <div className={`modal-content setlists-modal-card ${activeView === 'DETAIL' ? 'expanded-editor-view' : ''}`}>
        {/* Cabecera del Modal */}
        <div className="modal-header">
          <div className="setlists-modal-title-group">
            <span className="setlists-modal-icon" aria-hidden="true">
              <SetlistIcon size={24} />
            </span>
            <div>
              <h2 id={titleId} className="modal-title">
                {activeView === 'DETAIL' ? 'Administrador de Repertorio' : 'Repertorios de Culto (Setlists)'}
              </h2>
              <p className="setlists-modal-subtitle">
                {activeView === 'DETAIL'
                  ? 'Autoría de canciones, momentos de alabanza y orden litúrgico — Iglesia Bethesda'
                  : 'Planificación litúrgica y ejecución en atril — Iglesia Bethesda'}
              </p>
            </div>
          </div>
          <ModalCloseButton
            onClick={onClose}
            label="Cerrar ventana de repertorios"
            id="btn-close-setlists-modal"
          />
        </div>

        {/* Mensajes de Alerta y Éxito en vista de catálogo */}
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

        {/* Sub-vista 1: Editor de Detalle (SetlistDetailEditor) */}
        {activeView === 'DETAIL' && selectedSetlistIdForDetail ? (
          <SetlistDetailEditor
            setlistId={selectedSetlistIdForDetail}
            onBack={() => {
              setActiveView('CATALOG');
              setSelectedSetlistIdForDetail(null);
              loadData();
            }}
            onSetlistUpdated={loadData}
            onLoadInAtril={async (id) => {
              await handleSelectSetlist(id);
            }}
            apiClient={client}
          />
        ) : (
          /* Sub-vista 2: Catálogo de Repertorios */
          <>
            {/* Pestañas de Filtrado y Botón Crear */}
            <div className="setlists-toolbar-row">
              <div className="setlists-tabs" role="tablist" aria-label="Filtrar repertorios por estado">
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeTab === 'ALL'}
                  className={`setlists-tab ${activeTab === 'ALL' ? 'active' : ''}`}
                  onClick={() => setActiveTab('ALL')}
                >
                  Todos ({setlists.length})
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeTab === 'ACTIVE'}
                  className={`setlists-tab ${activeTab === 'ACTIVE' ? 'active' : ''}`}
                  onClick={() => setActiveTab('ACTIVE')}
                >
                  Activo ({setlists.filter((s) => s.status === 'ACTIVE').length})
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeTab === 'PLANNING'}
                  className={`setlists-tab ${activeTab === 'PLANNING' ? 'active' : ''}`}
                  onClick={() => setActiveTab('PLANNING')}
                >
                  En Planificación ({setlists.filter((s) => s.status === 'PLANNING').length})
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeTab === 'HISTORY'}
                  className={`setlists-tab ${activeTab === 'HISTORY' ? 'active' : ''}`}
                  onClick={() => setActiveTab('HISTORY')}
                >
                  Historial ({setlists.filter((s) => s.status === 'COMPLETED' || s.status === 'ARCHIVED').length})
                </button>
              </div>

              {canManageSetlists && (
                <button
                  type="button"
                  className={`btn-action-create ${showCreateForm ? 'cancel' : ''}`}
                  onClick={() => setShowCreateForm((prev) => !prev)}
                  aria-expanded={showCreateForm}
                >
                  {showCreateForm ? '✕ Cancelar' : '+ Nuevo Repertorio'}
                </button>
              )}
            </div>

            {/* Formulario de Creación Rápida */}
            {showCreateForm && (
              <form onSubmit={handleCreateSubmit} className="setlist-create-form" aria-label="Crear nuevo repertorio">
                <h3 className="create-form-title">Crear Nuevo Repertorio de Culto</h3>
                <div className="create-form-grid">
                  <div className="form-group">
                    <label htmlFor="setlist-title-input">Título del Servicio *</label>
                    <input
                      id="setlist-title-input"
                      type="text"
                      required
                      placeholder="Ej. Culto Dominical — 28 de Septiembre"
                      value={newTitle}
                      onChange={(e) => setNewTitle(e.target.value)}
                      className="auth-input"
                      disabled={creating}
                    />
                  </div>
                  <div className="form-group">
                    <label htmlFor="setlist-date-input">Fecha del Servicio</label>
                    <input
                      id="setlist-date-input"
                      type="date"
                      value={newScheduledDate}
                      onChange={(e) => setNewScheduledDate(e.target.value)}
                      className="auth-input"
                      disabled={creating}
                    />
                  </div>
                </div>
                <div className="form-group">
                  <label htmlFor="setlist-notes-input">Notas / Indicaciones Litúrgicas</label>
                  <textarea
                    id="setlist-notes-input"
                    rows={2}
                    placeholder="Observaciones generales para el equipo de alabanza..."
                    value={newNotes}
                    onChange={(e) => setNewNotes(e.target.value)}
                    className="auth-input setlist-textarea"
                    disabled={creating}
                  />
                </div>
                <div className="create-form-actions">
                  <button
                    type="submit"
                    className="action-button primary"
                    disabled={creating || !newTitle.trim()}
                  >
                    {creating ? 'Guardando...' : 'Crear y Administrar Ítems'}
                  </button>
                </div>
              </form>
            )}

            {/* Lista de Repertorios */}
            <div className="setlists-list-container">
              {loading ? (
                <div className="setlists-loading-state" role="status">
                  <span className="auth-spinner" aria-hidden="true" />
                  <p>Cargando repertorios litúrgicos desde el servidor...</p>
                </div>
              ) : filteredSetlists.length === 0 ? (
                <div className="setlists-empty-state" role="status">
                  <p className="empty-title">No hay repertorios disponibles en esta categoría.</p>
                  <p className="empty-hint">
                    {canManageSetlists
                      ? 'Utilice el botón "+ Nuevo Repertorio" para programar el orden del culto.'
                      : 'Los directores de alabanza programarán los repertorios de los próximos servicios.'}
                  </p>
                </div>
              ) : (
                <ul className="setlists-list" role="list">
                  {filteredSetlists.map((s) => {
                    const isActive = s.id === activeSetlistId;
                    const isOperating = actionInProgressId === s.id;

                    return (
                      <li
                        key={s.id}
                        className={`setlist-card-item ${s.status === 'ACTIVE' ? 'status-active' : ''} ${
                          isActive ? 'currently-loaded' : ''
                        }`}
                      >
                        <div className="setlist-card-header">
                          <div className="setlist-card-meta-row">
                            <span className={`setlist-status-badge ${s.status.toLowerCase()}`}>
                              {s.status === 'ACTIVE' && '● EN CULTO / ACTIVO'}
                              {s.status === 'PLANNING' && 'EN PLANIFICACIÓN'}
                              {s.status === 'COMPLETED' && 'COMPLETADO'}
                              {s.status === 'ARCHIVED' && 'ARCHIVADO'}
                            </span>
                            {missingDepsMap.has(s.id) && (
                              <span
                                className="setlist-missing-dep-badge"
                                role="alert"
                                title={`Repertorio incompleto: Faltan ${missingDepsMap.get(s.id)?.length} canciones por descargar para poder ejecutarlo sin conexión`}
                              >
                                ⚠️ Incompleto ({missingDepsMap.get(s.id)?.length} faltantes)
                              </span>
                            )}
                            {s.scheduledDateTime && (
                              <span className="setlist-date-badge">
                                📅 {new Date(s.scheduledDateTime).toLocaleDateString()}
                              </span>
                            )}
                            {isActive && (
                              <span className="setlist-loaded-tag" title="Este repertorio está actualmente activo en el atril">
                                ✓ En Atril
                              </span>
                            )}
                          </div>
                          <h4 className="setlist-card-title">{s.title}</h4>
                          <div className="setlist-card-footer-info">
                            <span>Director: {s.directorName ?? 'Equipo Pastoral'}</span>
                            <span>•</span>
                            <span>{s.totalItems} {s.totalItems === 1 ? 'ítem' : 'ítems'}</span>
                          </div>
                        </div>

                        <div className="setlist-card-actions">
                          {/* Guardar / Gestionar Copia Local Offline (WP-04) */}
                          <DownloadActionButton
                            resourceId={s.id}
                            resourceType="SETLIST"
                            title={s.title}
                            compact={true}
                          />

                          {/* Administrar Ítems (GAP-01, GAP-02, GAP-03) */}
                          <button
                            type="button"
                            className="btn-setlist-action manage"
                            onClick={() => {
                              setSelectedSetlistIdForDetail(s.id);
                              setActiveView('DETAIL');
                            }}
                            disabled={isOperating}
                            title="Ver secuencia y administrar elementos del repertorio"
                            aria-label={`Administrar elementos de ${s.title}`}
                          >
                            {canManageSetlists && s.status !== 'COMPLETED' && s.status !== 'ARCHIVED'
                              ? '⚙️ Administrar'
                              : '👁️ Ver Ítems'}
                          </button>

                          {/* Cargar en atril */}
                          <button
                            type="button"
                            className="btn-load-atril"
                            onClick={() => handleSelectSetlist(s.id)}
                            disabled={isOperating}
                            aria-label={`Cargar repertorio ${s.title} en atril`}
                          >
                            {isOperating ? 'Cargando...' : isActive ? 'Ver en Atril' : 'Cargar en Atril'}
                          </button>

                          {/* Acciones de estado para Worship Leader / Admin */}
                          {canManageSetlists && (
                            <>
                              {s.status === 'PLANNING' && (
                                <button
                                  type="button"
                                  className="btn-setlist-action activate"
                                  onClick={() => handleStatusTransition(s.id, 'ACTIVE')}
                                  disabled={isOperating}
                                  title="Activar este repertorio para el culto de la congregación"
                                  aria-label={`Activar repertorio ${s.title}`}
                                >
                                  Activar
                                </button>
                              )}
                              {s.status === 'ACTIVE' && (
                                <button
                                  type="button"
                                  className="btn-setlist-action complete"
                                  onClick={() => handleStatusTransition(s.id, 'COMPLETED')}
                                  disabled={isOperating}
                                  title="Finalizar el culto activo"
                                  aria-label={`Finalizar repertorio ${s.title}`}
                                >
                                  Finalizar
                                </button>
                              )}
                            </>
                          )}

                          {/* GAP-03: Eliminar repertorio (EXCLUSIVO para SUPER_ADMIN y ADMIN; HIDDEN para Worship Leader) */}
                          {canDeleteSetlists && (
                            <button
                              type="button"
                              className="btn-setlist-action delete"
                              onClick={() => setSetlistToDelete(s)}
                              disabled={isOperating}
                              title="Eliminar este repertorio"
                              aria-label={`Eliminar repertorio ${s.title}`}
                            >
                              <TrashIcon size={16} />
                            </button>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            {/* Pie del Modal */}
            <div className="modal-actions setlists-modal-footer">
              <button type="button" className="action-button secondary" onClick={onClose}>
                Cerrar
              </button>
            </div>
          </>
        )}

        {/* Modal de Confirmación de Eliminación Destructiva GAP-03 */}
        {setlistToDelete && (
          <div
            className="delete-confirmation-backdrop"
            role="dialog"
            aria-modal="true"
            aria-label="Confirmar eliminación de repertorio"
          >
            <div className="delete-confirmation-card">
              <div className="delete-confirmation-header">
                <span className="danger-icon" aria-hidden="true">⚠️</span>
                <h3 className="delete-confirmation-title">¿Eliminar este repertorio de culto?</h3>
              </div>
              <p className="delete-confirmation-text">
                Está a punto de eliminar permanentemente el repertorio:
                <br />
                <strong className="delete-target-title">{setlistToDelete.title}</strong>
              </p>
              <div className="delete-confirmation-warning-box">
                <p>
                  <strong>Advertencia:</strong> Esta acción eliminará permanentemente la secuencia litúrgica y todas las
                  asignaciones de este servicio.
                </p>
                <p className="songs-safe-note">
                  ✓ Las canciones registradas en el cancionario general <strong>NO</strong> se verán afectadas.
                </p>
              </div>
              <div className="delete-confirmation-actions">
                <button
                  type="button"
                  className="action-button secondary"
                  onClick={() => setSetlistToDelete(null)}
                  disabled={deletingSetlist}
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  className="action-button danger"
                  onClick={handleConfirmDeleteSetlist}
                  disabled={deletingSetlist}
                >
                  {deletingSetlist ? 'Eliminando...' : 'Sí, eliminar permanentemente'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
