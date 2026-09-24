/**
 * @file SongSelector.tsx
 * @description Selector de canciones canónicas disponibles para el Workspace (Fase 1G).
 * Permite alternar entre canciones con notación completa, formato ChordPro sin melodía o casos de borde vacíos.
 */

import React from 'react';
import { type CanonicalMusicPayload } from '../../core/canonical-model/canonical-music-payload.ts';
import { WORKSPACE_SONG_CATALOG } from '../../core/workspace/presets.ts';

export interface SongSelectorProps {
  readonly activeSongTitle: string;
  readonly onSelectSong: (song: CanonicalMusicPayload) => void;
}

export const SongSelector: React.FC<SongSelectorProps> = ({
  activeSongTitle,
  onSelectSong,
}) => {
  return (
    <div className="song-selector-container" role="region" aria-label="Catálogo de Canciones Canónicas">
      <span className="control-card-label">Canción Canónica Activa:</span>
      <div className="song-catalog-pills" role="radiogroup" aria-label="Seleccionar Canción">
        {WORKSPACE_SONG_CATALOG.map((item) => {
          const isSelected = activeSongTitle.includes(item.title.split(' ')[0]!) &&
            (item.id === 'song_empty'
              ? activeSongTitle.includes('Vacía')
              : item.id === 'song_g_major_chordpro'
              ? activeSongTitle.includes('ChordPro')
              : !activeSongTitle.includes('ChordPro') && !activeSongTitle.includes('Vacía'));

          return (
            <button
              key={item.id}
              type="button"
              role="radio"
              aria-checked={isSelected}
              className={`pill-btn ${isSelected ? 'active' : ''}`}
              onClick={() => onSelectSong(item.factory())}
            >
              {item.title}
            </button>
          );
        })}
      </div>
    </div>
  );
};
