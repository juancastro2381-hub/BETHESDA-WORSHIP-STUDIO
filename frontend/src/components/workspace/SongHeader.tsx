/**
 * @file SongHeader.tsx
 * @description Cabecera de contexto de la canción activa en el Workspace (Fase 1G).
 * Expone metadatos canónicos reales: título, tonalidad de referencia, tempo, métrica, secciones.
 * Invariante: NO inventa metadatos inexistentes en el modelo canónico.
 */

import React from 'react';
import { type CanonicalMusicPayload } from '../../core/canonical-model/canonical-music-payload.ts';
import { type BackendVersionItem } from '../../core/api/api-client.ts';
import { extractAuthoritativeSongMetadata } from '../../core/workspace/canonical-metadata-projection.ts';
import { DownloadActionButton } from '../offline/DownloadActionButton.tsx';

export interface SongHeaderProps {
  readonly song: CanonicalMusicPayload;
  readonly concertKey: string;
  readonly isImported?: boolean;
  readonly importedFormat?: string | undefined;
  readonly isPersisted?: boolean;
  readonly versionNumber?: number | undefined;
  readonly persistedSongId?: string | undefined;
  readonly isVisualDocument?: boolean | undefined;
  readonly activeReadingFormatLabel?: string | undefined;
  readonly songStatus?: 'DRAFT' | 'APPROVED' | 'ARCHIVED' | undefined;
  readonly availableVersions?: readonly BackendVersionItem[] | undefined;
  readonly activeVersionId?: string | undefined;
  readonly onSelectVersion?: ((versionId: string) => void) | undefined;
}

export const SongHeader: React.FC<SongHeaderProps> = ({
  song,
  concertKey,
  isImported,
  importedFormat,
  isPersisted,
  versionNumber,
  persistedSongId,
  isVisualDocument,
  activeReadingFormatLabel,
  songStatus,
  availableVersions,
  activeVersionId,
  onSelectVersion,
}) => {
  const authMeta = extractAuthoritativeSongMetadata(song, {
    concertKeyOverride: concertKey,
    songStatus,
    versionNumber,
  });
  const tempoBpm = authMeta.tempoBpm;
  const tempoSuffix =
    authMeta.tempoOrigin === 'AUDIO_DERIVED'
      ? ' (Audio)'
      : authMeta.tempoOrigin === 'MANUAL_OVERRIDE'
      ? ' (Manual)'
      : '';
  const timeSig = authMeta.timeSignature ?? '—';
  const totalMeasures = authMeta.measureCount;
  const totalSections = authMeta.sectionCount;
  const totalChords = authMeta.chordCount;
  const totalNotes = authMeta.noteCount;

  const audioFilename = authMeta.audioFilename;
  const isAudioDerived = authMeta.isAudioDerived;
  const approvalStatus = authMeta.approvalStatus ?? (isPersisted ? 'APPROVED' : undefined);

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
        {isPersisted && availableVersions && availableVersions.length > 1 && onSelectVersion && (
          <div className="song-version-selector" style={{ marginLeft: '8px' }}>
            <label htmlFor="stand-version-select" style={{ fontSize: '0.75rem', marginRight: '6px', color: '#94a3b8' }}>
              Versión:
            </label>
            <select
              id="stand-version-select"
              value={activeVersionId ?? ''}
              onChange={(e) => onSelectVersion(e.target.value)}
              style={{
                background: 'rgba(15, 23, 42, 0.85)',
                color: '#f8fafc',
                border: '1px solid rgba(148, 163, 184, 0.35)',
                borderRadius: '4px',
                padding: '3px 8px',
                fontSize: '0.78rem',
              }}
              aria-label="Seleccionar versión de la canción en el Atril Digital"
            >
              {availableVersions.map((v) => (
                <option key={v.id} value={v.id}>
                  v{v.versionNumber} — {v.name} {v.isCurrent ? '(Actual)' : ''}
                </option>
              ))}
            </select>
          </div>
        )}
        <div className="song-badges" role="group" aria-label="Atributos canónicos">
          {isPersisted && (
            <span className="badge-meta badge-persisted" title="Canción persistida en PostgreSQL">
              💾 PostgreSQL (v{versionNumber ?? 1})
            </span>
          )}
          {approvalStatus && (
            <span
              className="badge-meta"
              style={{
                background:
                  approvalStatus === 'APPROVED'
                    ? 'rgba(34, 197, 94, 0.2)'
                    : 'rgba(245, 158, 11, 0.2)',
                color: approvalStatus === 'APPROVED' ? '#86efac' : '#fde68a',
                border:
                  approvalStatus === 'APPROVED'
                    ? '1px solid rgba(34, 197, 94, 0.4)'
                    : '1px solid rgba(245, 158, 11, 0.4)',
              }}
              title="Estado de aprobación y gobernanza"
            >
              {approvalStatus === 'APPROVED' ? '✅ APROBADO' : `⚠️ ${approvalStatus}`}
            </span>
          )}
          {activeReadingFormatLabel && (
            <span className="badge-meta" title="Formato de lectura activo en el Atril Digital">
              📖 Formato: {activeReadingFormatLabel}
            </span>
          )}
          {audioFilename && (
            <span
              className="badge-meta"
              style={{
                background: 'rgba(59, 130, 246, 0.2)',
                color: '#93c5fd',
                border: '1px solid rgba(59, 130, 246, 0.4)',
              }}
              title="Activo de audio asociado a esta versión"
            >
              🎧 Audio: {audioFilename} {isAudioDerived ? '(Transcripción Aprobada)' : ''}
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
          <span className="badge-meta badge-tempo" title="Tempo autoritativo de la versión activa">
            ♩ = {tempoBpm ? `${tempoBpm} BPM${tempoSuffix}` : 'No esp.'}
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
          {isVisualDocument ? (
            <span className="badge-meta badge-visual-doc" title="Documento visual presentado en Atril Digital">
              📄 Atril Visual ({importedFormat ?? 'PDF / Imagen'})
            </span>
          ) : totalNotes === 0 ? (
            <span className="badge-meta badge-lead-pure" title="Fuente Lead Sheet pura (CERO notas de melodía)">
              Lead Sheet Armónico ({totalChords} acordes / 0 notas melódicas)
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
