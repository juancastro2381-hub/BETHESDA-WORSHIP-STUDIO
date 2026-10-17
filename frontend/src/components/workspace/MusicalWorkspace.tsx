/**
 * @file MusicalWorkspace.tsx
 * @description Componente principal de orquestación del Espacio de Trabajo Musical e Integración de Atril Litúrgico (Fases 1G, 2A/2B y 2C — WS7).
 *
 * Estructura arquitectónica:
 * MusicalWorkspace
 * ├── SetlistNavigationToolbar (WS7: activo cuando loadedSetlist !== null)
 * ├── ScenarioPresets (Fase 1G)
 * ├── CatalogAndImportBar (Fases 1H, 2A y 2C con SetlistsModal)
 * ├── DatabaseSongsModal (Fase 2A)
 * ├── SetlistsModal (WS7)
 * ├── SourceFileUploader (Fase 1H)
 * ├── SongHeader (cuando isSong === true)
 * ├── MusicalControls (cuando isSong === true)
 * ├── RendererStatus (cuando isSong === true)
 * ├── Viewport Principal:
 * │   ├── ServiceMomentCard (WS7: cuando isServiceMoment === true)
 * │   └── MusicalScoreRenderer (cuando isSong === true)
 * └── DiagnosticPanel
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useMusicalWorkspace } from '../../core/workspace/use-musical-workspace.ts';
import { useSetlistExecution } from '../../core/workspace/use-setlist-execution.ts';
import { useAuth } from '../../core/auth/use-auth.ts';
import { BethesdaApiClient } from '../../core/api/api-client.ts';
import { type UserViewPreferenceData } from '../../core/api/preference-types.ts';
import { type ViewRepresentation } from '../../core/projection/types.ts';
import { CanonicalMusicPayload } from '../../core/canonical-model/index.ts';
import { MusicalScoreRenderer } from '../../core/rendering/react/musical-score-renderer.tsx';
import { DiagnosticPanel } from './DiagnosticPanel.tsx';
import { MusicalControls } from './MusicalControls.tsx';
import { RendererStatus } from './RendererStatus.tsx';
import { ScenarioPresets } from './ScenarioPresets.tsx';
import { SongHeader } from './SongHeader.tsx';
import { SongSelector } from './SongSelector.tsx';
import { SourceFileUploader } from './SourceFileUploader.tsx';
import { DatabaseSongsModal } from './DatabaseSongsModal.tsx';
import { SetlistsModal } from './SetlistsModal.tsx';
import { SetlistNavigationToolbar } from './SetlistNavigationToolbar.tsx';
import { ServiceMomentCard } from './ServiceMomentCard.tsx';
import { offlineStorage } from '../../core/offline/storage/indexeddb-storage.ts';

export interface MusicalWorkspaceProps {
  readonly initialSetlistId?: string | undefined;
  readonly apiClient?: BethesdaApiClient | undefined;
}

export const MusicalWorkspace: React.FC<MusicalWorkspaceProps> = ({
  initialSetlistId,
  apiClient,
}) => {
  const client = apiClient ?? BethesdaApiClient.getInstance();
  const { user } = useAuth();

  // Modales y paneles emergentes
  const [showUploader, setShowUploader] = useState<boolean>(false);
  const [showDbModal, setShowDbModal] = useState<boolean>(false);
  const [showSetlistsModal, setShowSetlistsModal] = useState<boolean>(false);

  // Hook del Espacio de Trabajo Musical (Fase 1G)
  const {
    viewResult,
    availableInstruments,
    importedMeta,
    persistedMeta,
    applyPreset,
    selectSong,
    importSong,
    selectPersistedSong,
    selectInstrument,
    setPrimaryRepresentation,
    toggleSecondaryRepresentation,
    setReadingFormat,
    applyUserPreference,
    setCapo,
    setTransposition,
    setChordNotation,
    setForcedRenderer,
    resetToOriginal,
  } = useMusicalWorkspace();

  // Estado de preferencias de visualización del usuario autenticado (Fase 3A — WP-02)
  const [userPreferences, setUserPreferences] = useState<UserViewPreferenceData | null>(null);

  // Cargar preferencias del usuario al autenticarse y aplicarlas por defecto
  useEffect(() => {
    if (!user) {
      setUserPreferences(null);
      return;
    }

    let isMounted = true;
    client
      .getUserPreferences()
      .then((prefs) => {
        if (!isMounted) return;
        setUserPreferences(prefs);
        applyUserPreference(prefs);
      })
      .catch((err) => {
        console.warn('No se pudieron obtener preferencias de vista del usuario:', err);
      });

    return () => {
      isMounted = false;
    };
  }, [user, client, applyUserPreference]);

  // Hook de Ejecución de Setlist de Atril Litúrgico (WS6)
  const setlistExecution = useSetlistExecution({
    initialSetlistId,
    apiClient: client,
  });

  // Decisión 2 (Opción A): Memoria volátil de sesión para caché de canciones canónicas
  const songCacheRef = useRef<Map<string, CanonicalMusicPayload>>(new Map());
  const [songLoading, setSongLoading] = useState<boolean>(false);

  const {
    activeSong,
    state,
    instrumentProfile,
    derivedView,
    activeRendererId,
    diagnostics,
    supportedRepresentations,
  } = viewResult;

  // Manejador para persistir la preferencia en PostgreSQL mediante PUT /api/v1/users/me/preferences
  const handleSavePreference = useCallback(
    async (primary: ViewRepresentation, secondary: ViewRepresentation[]) => {
      if (!user) return;
      const payload = {
        instrumentId: state.selectedInstrumentId,
        primaryRepresentation: primary,
        secondaryRepresentations: secondary,
        chordNotationSystem: state.chordNotationSystem,
        transpositionSemitones: state.transpositionSemitones,
        capoFret: state.capoFret,
        clefOverride: null,
        preferFlats: false,
      };

      const updated = await client.updateUserPreferences(payload);
      setUserPreferences(updated);
    },
    [user, client, state]
  );

  // Sincronización del ítem de Setlist activo con el Espacio de Trabajo Musical
  useEffect(() => {
    // Si no hay setlist o estamos viendo una canción fuera del setlist (off-setlist), no forzar cambio
    if (!setlistExecution.loadedSetlist || setlistExecution.isOffSetlistSongActive) {
      return;
    }

    const item = setlistExecution.currentItem;

    if (item && item.itemType === 'SONG' && item.songId) {
      const songId: string = item.songId;

      // 1. Verificar si la canción ya está en la caché en memoria volátil
      if (songCacheRef.current.has(songId)) {
        const cached = songCacheRef.current.get(songId)!;
        selectPersistedSong(cached, {
          isPersisted: true,
          songId,
          versionNumber: 1,
        });
        setTransposition(setlistExecution.transpositionSemitones);
      } else {
        // 2. Cargar bajo demanda: consultar primero el almacenamiento offline local en IndexedDB (WP-04)
        setSongLoading(true);
        offlineStorage
          .getSongPayload(songId)
          .then((localPayload) => {
            if (localPayload) {
              const canonical = CanonicalMusicPayload.fromJSON(localPayload.canonicalPayload);
              songCacheRef.current.set(songId, canonical);
              selectPersistedSong(canonical, {
                isPersisted: true,
                songId: localPayload.id,
                versionNumber: localPayload.metadata.versionNumber,
              });
              setTransposition(setlistExecution.transpositionSemitones);
              setSongLoading(false);
              return;
            }

            // Si no está en local, cargar desde el servidor
            return client.getSong(songId).then((response) => {
              const canonical = BethesdaApiClient.toCanonicalPayload(response);
              songCacheRef.current.set(songId, canonical);
              selectPersistedSong(canonical, {
                isPersisted: true,
                songId: response.song.id,
                versionNumber: response.version.versionNumber,
              });
              setTransposition(setlistExecution.transpositionSemitones);
            });
          })
          .catch((err) => {
            console.error('Error al cargar la partitura del setlist:', err);
          })
          .finally(() => {
            setSongLoading(false);
          });
      }

      // 3. Decisión 2 (Opción A): Precarga no bloqueante de N+1 (Best-effort)
      if (setlistExecution.nextItem?.itemType === 'SONG' && setlistExecution.nextItem.songId) {
        const nextSongId: string = setlistExecution.nextItem.songId;
        if (!songCacheRef.current.has(nextSongId)) {
          client
            .getSong(nextSongId)
            .then((res) => {
              const canonical = BethesdaApiClient.toCanonicalPayload(res);
              songCacheRef.current.set(nextSongId, canonical);
            })
            .catch(() => {
              // Falla de precarga no bloqueante: seguro, fallback transparente a carga bajo demanda
            });
        }
      }
    }
  }, [
    setlistExecution.loadedSetlist,
    setlistExecution.currentIndex,
    setlistExecution.currentItem,
    setlistExecution.nextItem,
    setlistExecution.isOffSetlistSongActive,
    setlistExecution.transpositionSemitones,
    selectPersistedSong,
    setTransposition,
    client,
  ]);

  // Manejador de Retorno al Culto desde canción independiente (Off-Setlist)
  const handleReturnToSetlist = useCallback(() => {
    setlistExecution.returnToCurrentSetlistItem();
    if (setlistExecution.currentItem?.itemType === 'SONG' && setlistExecution.currentItem.songId) {
      const songId: string = setlistExecution.currentItem.songId;
      if (songCacheRef.current.has(songId)) {
        const cached = songCacheRef.current.get(songId)!;
        selectPersistedSong(cached, {
          isPersisted: true,
          songId,
          versionNumber: 1,
        });
        setTransposition(setlistExecution.transpositionSemitones);
      }
    }
  }, [setlistExecution, selectPersistedSong, setTransposition]);

  // Manejador de Descarga de Setlist
  const handleUnloadSetlist = useCallback(() => {
    setlistExecution.unloadSetlist();
    resetToOriginal();
  }, [setlistExecution, resetToOriginal]);

  const concertKeyStr = derivedView?.concertKey.toString() ?? 'Sol Mayor';

  return (
    <div className="musical-workspace-root">
      {/* 0. Barra de Navegación de Atril Litúrgico (WS7: Decisión 1 Aprobada: Top en Desktop/Tablet, Bottom en Mobile) */}
      {setlistExecution.loadedSetlist && (
        <SetlistNavigationToolbar
          loadedSetlist={setlistExecution.loadedSetlist}
          currentIndex={setlistExecution.currentIndex}
          totalItems={setlistExecution.totalItems}
          currentItem={setlistExecution.currentItem}
          hasNext={setlistExecution.hasNext}
          hasPrevious={setlistExecution.hasPrevious}
          isSong={setlistExecution.isSong}
          isServiceMoment={setlistExecution.isServiceMoment}
          isOffSetlistSongActive={setlistExecution.isOffSetlistSongActive}
          offSetlistSongTitle={setlistExecution.offSetlistSongTitle}
          transpositionSemitones={setlistExecution.transpositionSemitones}
          effectiveTargetKey={setlistExecution.effectiveTargetKey}
          isLoading={songLoading || setlistExecution.isLoading}
          onGoToNext={setlistExecution.goToNext}
          onGoToPrevious={setlistExecution.goToPrevious}
          onReturnToSetlist={handleReturnToSetlist}
          onOpenSetlistsModal={() => setShowSetlistsModal(true)}
          onUnloadSetlist={handleUnloadSetlist}
        />
      )}

      {/* 1. Selector de Escenarios Dorados Oficiales (Cobertura de Regresión) */}
      <ScenarioPresets
        activePresetId={state.activePresetId}
        onApplyPreset={(id) => {
          applyPreset(id);
          setShowUploader(false);
          setShowDbModal(false);
          setShowSetlistsModal(false);
          if (setlistExecution.loadedSetlist) {
            setlistExecution.notifyOffSetlistSongSelected(`Escenario ${id}`);
          }
        }}
      />

      {/* 2. Barra de Selección de Canción e Importación Real / Base de Datos / Setlists */}
      <div className="catalog-and-import-bar">
        <SongSelector
          activeSongTitle={activeSong.title}
          onSelectSong={(song) => {
            selectSong(song);
            setShowUploader(false);
            setShowDbModal(false);
            setShowSetlistsModal(false);
            if (setlistExecution.loadedSetlist) {
              setlistExecution.notifyOffSetlistSongSelected(song.title);
            }
          }}
        />

        {/* Decisión 3 (Opción B): Ocultar 'Repertorios de Culto' para usuarios no autenticados */}
        {user !== null && (
          <button
            type="button"
            className={`btn-toggle-setlists-modal ${showSetlistsModal ? 'active' : ''}`}
            onClick={() => {
              setShowSetlistsModal((prev) => !prev);
              setShowDbModal(false);
              setShowUploader(false);
            }}
            id="btn-toggle-setlists-modal"
            aria-expanded={showSetlistsModal}
          >
            {showSetlistsModal ? '✕ Cerrar Repertorios' : '📋 Repertorios de Culto (Setlists)'}
          </button>
        )}

        <button
          type="button"
          className={`btn-toggle-db-modal ${showDbModal ? 'active' : ''}`}
          onClick={() => {
            setShowDbModal((prev) => !prev);
            setShowUploader(false);
            setShowSetlistsModal(false);
          }}
          id="btn-toggle-db-modal"
          aria-expanded={showDbModal}
        >
          {showDbModal ? '✕ Cerrar Catálogo BD' : '💾 Catálogo en Base de Datos'}
        </button>

        <button
          type="button"
          className={`btn-toggle-uploader ${showUploader ? 'active' : ''}`}
          onClick={() => {
            setShowUploader((prev) => !prev);
            setShowDbModal(false);
            setShowSetlistsModal(false);
          }}
          id="btn-toggle-source-uploader"
          aria-expanded={showUploader}
        >
          {showUploader ? '✕ Cerrar Importador' : '📥 Importar Archivo (MusicXML / ChordPro)'}
        </button>
      </div>

      {/* 2b. Modal de Repertorios Litúrgicos (Setlists) (Fase 2C — WS7) */}
      {showSetlistsModal && (
        <SetlistsModal
          isOpen={showSetlistsModal}
          onClose={() => setShowSetlistsModal(false)}
          onLoadSetlist={async (setlistId) => {
            await setlistExecution.loadSetlist(setlistId);
            setShowSetlistsModal(false);
          }}
          activeSetlistId={setlistExecution.loadedSetlist?.id ?? undefined}
          apiClient={client}
        />
      )}

      {/* 2c. Modal de Base de Datos PostgreSQL (Fase 2A) */}
      {showDbModal && (
        <DatabaseSongsModal
          activeSong={activeSong}
          onSelectSong={(dbSong, meta) => {
            if (meta) {
              selectPersistedSong(dbSong, meta);
            } else {
              selectSong(dbSong);
            }
            if (setlistExecution.loadedSetlist) {
              setlistExecution.notifyOffSetlistSongSelected(dbSong.title);
            }
            setShowDbModal(false);
          }}
          onClose={() => setShowDbModal(false)}
        />
      )}

      {/* 2d. Panel de Ingesta Real (Fase 1H) */}
      {showUploader && (
        <SourceFileUploader
          onSongImported={(importedSong, meta) => {
            importSong(importedSong, meta);
            if (setlistExecution.loadedSetlist) {
              setlistExecution.notifyOffSetlistSongSelected(importedSong.title);
            }
          }}
          onCancel={() => setShowUploader(false)}
        />
      )}

      {/* 3. Discriminación Litúrgica: SONG vs SERVICE_MOMENT */}
      {setlistExecution.loadedSetlist &&
      setlistExecution.isServiceMoment &&
      setlistExecution.currentItem?.itemType === 'SERVICE_MOMENT' &&
      !setlistExecution.isOffSetlistSongActive ? (
        /* Vista de Momento Litúrgico (WS7: Cero adaptadores de partitura inicializados) */
        <main className="workspace-viewport-area service-moment-viewport" role="main">
          <ServiceMomentCard
            item={setlistExecution.currentItem}
            onNext={setlistExecution.hasNext ? setlistExecution.goToNext : undefined}
            onPrevious={setlistExecution.hasPrevious ? setlistExecution.goToPrevious : undefined}
            hasNext={setlistExecution.hasNext}
            hasPrevious={setlistExecution.hasPrevious}
          />
        </main>
      ) : (
        /* Vista de Canción Canónica Normal (Fase 1G & 2C) */
        <>
          {/* 3a. SongHeader: Contexto de metadatos de la canción activa */}
          <SongHeader
            song={activeSong}
            concertKey={concertKeyStr}
            isImported={importedMeta !== null}
            importedFormat={importedMeta?.format}
            isPersisted={persistedMeta !== null}
            versionNumber={persistedMeta?.versionNumber}
            persistedSongId={persistedMeta?.songId}
          />

          {/* 4. MusicalControls: Instrumento, Representaciones, Capo, Transposición y Cifrado */}
          <MusicalControls
            selectedInstrumentId={state.selectedInstrumentId}
            availableInstruments={availableInstruments}
            instrumentProfile={instrumentProfile}
            supportedRepresentations={supportedRepresentations}
            primaryRepresentation={state.primaryRepresentation}
            secondaryRepresentations={state.secondaryRepresentations}
            capoFret={state.capoFret}
            transpositionSemitones={state.transpositionSemitones}
            chordNotationSystem={state.chordNotationSystem}
            onSelectInstrument={selectInstrument}
            onSelectPrimaryRepresentation={setPrimaryRepresentation}
            onToggleSecondaryRepresentation={toggleSecondaryRepresentation}
            onSetCapo={setCapo}
            onSetTransposition={setTransposition}
            onSetChordNotation={setChordNotation}
            activeSong={activeSong}
            userPreferences={userPreferences}
            isAuthenticated={user !== null}
            onSelectReadingFormat={setReadingFormat}
            onSavePreference={handleSavePreference}
          />

          {/* 5. RendererStatus: Estado del motor de renderizado */}
          <RendererStatus
            activeRendererId={activeRendererId}
            forcedRendererId={state.forcedRendererId}
            onSetForcedRenderer={setForcedRenderer}
          />

          {/* 6. Viewport de Renderizado Musical Real */}
          <main className="workspace-viewport-area" role="main" aria-label="Partitura y Notación Musical">
            {songLoading ? (
              <div className="workspace-loading-state" role="status">
                <span className="auth-spinner" aria-hidden="true" />
                <p>Cargando partitura del repertorio...</p>
              </div>
            ) : activeSong.measures.length === 0 ? (
              <div className="workspace-empty-state" role="alert">
                <div className="empty-icon">𝄞</div>
                <h3>Canción Sin Contenido Musical</h3>
                <p>La canción seleccionada no contiene compases ni eventos musicales canónicos.</p>
              </div>
            ) : derivedView ? (
              <MusicalScoreRenderer
                view={derivedView}
                preferredRendererId={activeRendererId ?? undefined}
              />
            ) : (
              <div className="workspace-error-state" role="alert">
                <h3>Configuración Visual Incompatible</h3>
                <p>
                  Las representaciones solicitadas no pudieron proyectarse para {instrumentProfile.name}.
                </p>
              </div>
            )}
          </main>
        </>
      )}

      {/* 7. DiagnosticPanel: Diagnósticos estructurados colapsables */}
      <DiagnosticPanel diagnostics={diagnostics} />
    </div>
  );
};
