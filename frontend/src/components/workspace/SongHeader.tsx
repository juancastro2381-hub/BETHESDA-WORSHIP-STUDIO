/**
 * @file SongHeader.tsx
 * @description Cabecera de contexto de la canción activa en el Workspace (Fase 1G).
 * Expone metadatos canónicos reales: título, tonalidad de referencia, tempo, métrica, secciones.
 * Invariante: NO inventa metadatos inexistentes en el modelo canónico.
 */

import React from 'react';
import { type CanonicalMusicPayload } from '../../core/canonical-model/canonical-music-payload.ts';
import { DownloadActionButton } from '../offline/DownloadActionButton.tsx';

export interface SongHeaderProps {
  readonly song: CanonicalMusicPayload;
  readonly concertKey: string;
  readonly isImported?: boolean;
  readonly importedFormat?: string | undefined;
  readonly isPersisted?: boolean;
  readonly versionNumber?: number | undefined;
  readonly persistedSongId?: string | undefined;
}

export const SongHeader: React.FC<SongHeaderProps> = ({
  song,
  concertKey,
  isImported,
  importedFormat,
  isPersisted,
  versionNumber,
  persistedSongId,
}) => {
  const tempoBpm = song.timeline.tempoMap.events[0]?.bpm ?? 120;
  const firstMeasure = song.measures[0];
  const timeSig = firstMeasure
    ? `${firstMeasure.timeSignature.numerator}/${firstMeasure.timeSignature.denominator}`
    : '4/4';
  const totalMeasures = song.measures.length;
  const totalSections = song.sections.length;
  const totalChords = song.measures.reduce((acc, m) => acc + m.chords.length, 0);
  const totalNotes = song.measures.reduce((acc, m) => acc + m.voices.reduce((vAcc, v) => vAcc + v.events.length, 0), 0);

  return (
    <header className="workspace-song-header" aria-label="Metadatos de la Canción Activa">
      <div className="song-title-row">
        <h2 className="song-title" id="active-song-title">{song.title}</h2>
        {isPersisted && persistedSongId && (
          <div className="song-offline-action">
            <DownloadActionButton
              resourceId={persistedSongId}
              resourceType="SONG"
              title={song.title}
              compact={false}
            />
          </div>
        )}
        <div className="song-badges" role="group" aria-label="Atributos canónicos">
          {isPersisted && (
            <span className="badge-meta badge-persisted" title="Canción persistida en PostgreSQL">
              💾 PostgreSQL (v{versionNumber ?? 1})
            </span>
          )}
          {isImported && (
            <span className="badge-meta badge-imported" title="Partitura cargada desde archivo real">
              📥 Fuente Importada ({importedFormat ?? 'Archivo Real'})
            </span>
          )}
          <span className="badge-meta badge-key" title="Tonalidad canónica de concierto">
            Tono: {concertKey}
          </span>
          <span className="badge-meta badge-tempo" title="Tempo constante">
            ♩ = {tempoBpm} BPM
          </span>
          <span className="badge-meta badge-meter" title="Métrica de compás">
            {timeSig}
          </span>
          <span className="badge-meta badge-measures" title="Total de compases">
            {totalMeasures} compases
          </span>
          {totalSections > 0 && (
            <span className="badge-meta badge-sections" title="Total de secciones canónicas">
              {totalSections} secciones
            </span>
          )}
          {totalNotes === 0 ? (
            <span className="badge-meta badge-lead-pure" title="Fuente Lead Sheet pura (CERO notas de melodía)">
              Lead Sheet Puro (0 notas melódicas)
            </span>
          ) : (
            <span className="badge-meta badge-notes" title="Contenido melódico canónico">
              {totalNotes} notas / {totalChords} acordes
            </span>
          )}
        </div>
      </div>
    </header>
  );
};
