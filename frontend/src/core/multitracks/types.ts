/**
 * @file types.ts
 * @description Tipos de datos para el motor de Multipistas (Fase 3C — D1) en el cliente frontend.
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
  audioAssetId: string;
  volume: number; // 0.0 - 1.0
  pan: number; // -1.0 - 1.0
  isMuted: boolean;
  isSolo: boolean;
  offsetMs: number;
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

export interface MultitrackEngineState {
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  tracks: MultitrackTrack[];
}
