/**
 * @file types.ts
 * @description Tipos de dominio para Sesiones y Pistas Multipista (Fase 3C — D1).
 */

export type MultitrackTrackType =
  | 'CLICK'
  | 'CUES'
  | 'DRUMS'
  | 'BASS'
  | 'GUITAR'
  | 'KEYS'
  | 'VOCALS'
  | 'OTHER';

export interface MultitrackTrack {
  id: string;
  sessionId: string;
  name: string;
  trackType: MultitrackTrackType;
  audioAssetId: string; // Vinculado a AudioAsset (Workstream A)
  volume: number; // 0.0 a 1.0
  pan: number; // -1.0 a 1.0
  isMuted: boolean;
  isSolo: boolean;
  offsetMs: number; // Offset de sincronización en milisegundos (-5000 a 5000)
  sortOrder: number;
}

export interface MultitrackSession {
  id: string;
  songId: string;
  title: string;
  durationSeconds: number;
  bpm: number;
  tracks: MultitrackTrack[];
  createdAt: string;
  updatedAt: string;
}

export interface CreateMultitrackSessionDTO {
  songId: string;
  title: string;
  durationSeconds: number;
  bpm: number;
  tracks: Array<{
    name: string;
    trackType: MultitrackTrackType;
    audioAssetId: string;
    volume?: number;
    pan?: number;
    isMuted?: boolean;
    isSolo?: boolean;
    offsetMs?: number;
    sortOrder?: number;
  }>;
}

export interface MultitrackOfflineStatus {
  sessionId: string;
  isFullyAvailableOffline: boolean;
  totalTracks: number;
  downloadedTracks: number;
  missingAssetIds: string[];
}
