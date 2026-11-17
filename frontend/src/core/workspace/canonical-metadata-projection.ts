/**
 * @file canonical-metadata-projection.ts
 * @description Proyección única y autoritativa de metadatos musicales para una versión de canción.
 * Garantiza que SongHeader, renderizadores (AlphaTex/MusicXML/LeadSheetDOM), modales de catálogo
 * y evaluadores de disponibilidad consuman exactamente los mismos valores versionados,
 * distinguiendo origen declarado, derivado de audio, ajuste manual o no resuelto.
 */

import { type CanonicalMusicPayload } from '../canonical-model/canonical-music-payload.ts';

export type TempoOriginType =
  | 'SOURCE_DECLARED'
  | 'AUDIO_DERIVED'
  | 'MANUAL_OVERRIDE'
  | 'UNRESOLVED';

export interface AuthoritativeSongMetadata {
  readonly title: string;
  readonly concertKey: string;
  readonly tempoBpm: number | null;
  readonly tempoOrigin: TempoOriginType;
  readonly timeSignature: string | null;
  readonly measureCount: number;
  readonly noteCount: number;
  readonly chordCount: number;
  readonly lyricSyllableCount: number;
  readonly measuresWithLyrics: number;
  readonly lyricCoverageRatio: number;
  readonly sectionCount: number;
  readonly versionNumber: number | null;
  readonly approvalStatus: string | null;
  readonly isAudioDerived: boolean;
  readonly audioFilename: string | null;
}

export function extractAuthoritativeSongMetadata(
  song: CanonicalMusicPayload,
  options?: {
    readonly concertKeyOverride?: string | undefined;
    readonly songStatus?: string | undefined;
    readonly versionNumber?: number | undefined;
  }
): AuthoritativeSongMetadata {
  const meta = (song.metadata ?? {}) as Record<string, unknown>;
  const isAudioDerived = Boolean(meta['isAudioDerived']);
  const timelineBpm = song.timeline.tempoMap.events[0]?.bpm ?? null;
  const metaBpm = typeof meta['bpm'] === 'number' && meta['bpm'] > 0 ? meta['bpm'] : null;
  const tempoBpm = timelineBpm ?? metaBpm;

  let tempoOrigin: TempoOriginType = 'UNRESOLVED';
  if (tempoBpm !== null) {
    if (meta['tempoOverrideByHuman'] === true) {
      tempoOrigin = 'MANUAL_OVERRIDE';
    } else if (isAudioDerived) {
      tempoOrigin = 'AUDIO_DERIVED';
    } else {
      tempoOrigin = 'SOURCE_DECLARED';
    }
  }

  const firstMeasure = song.measures[0];
  const timeSignature = firstMeasure?.timeSignature
    ? `${firstMeasure.timeSignature.numerator}/${firstMeasure.timeSignature.denominator}`
    : typeof meta['timeSignature'] === 'string' && meta['timeSignature'].trim().length > 0
    ? meta['timeSignature'].trim()
    : null;

  const concertKey =
    options?.concertKeyOverride ??
    (firstMeasure?.keySignature
      ? firstMeasure.keySignature.toMusicalKey().toString()
      : typeof meta['key'] === 'string' && meta['key'].trim().length > 0
      ? meta['key'].trim()
      : 'No esp.');

  const measureCount = song.measures.length;
  const noteCount = song.measures.reduce((acc, m) => acc + m.getAllNotes().length, 0);
  const chordCount = song.measures.reduce((acc, m) => acc + m.chords.length, 0);
  const lyricSyllableCount = song.measures.reduce((acc, m) => acc + m.lyrics.length, 0);
  const measuresWithLyrics = song.measures.filter((m) => m.lyrics.length > 0).length;
  const lyricCoverageRatio = measureCount > 0 ? measuresWithLyrics / measureCount : 0;

  const approvalStatus =
    typeof meta['approvalStatus'] === 'string'
      ? meta['approvalStatus']
      : options?.songStatus ?? null;

  return {
    title: song.title,
    concertKey,
    tempoBpm,
    tempoOrigin,
    timeSignature,
    measureCount,
    noteCount,
    chordCount,
    lyricSyllableCount,
    measuresWithLyrics,
    lyricCoverageRatio,
    sectionCount: song.sections.length,
    versionNumber: options?.versionNumber ?? null,
    approvalStatus,
    isAudioDerived,
    audioFilename: typeof meta['audioFilename'] === 'string' ? meta['audioFilename'] : null,
  };
}
