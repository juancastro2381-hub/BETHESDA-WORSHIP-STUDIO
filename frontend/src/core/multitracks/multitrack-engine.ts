/**
 * @file multitrack-engine.ts
 * @description Motor de sincronización y mezcla de pistas multipista (Fase 3C — D1).
 *
 * Principios:
 * - Base de tiempo unificada para sincronización de búsqueda y reproducción.
 * - Lógica de mezcla estricta con precedencia de Solo/Mute y acotamiento de ganancia.
 * - Validación exhaustiva de completitud offline: si falta un stem, se bloquea la reproducción.
 * - EXCLUSIÓN TOTAL: Solo controles táctiles y de interfaz gráfica estándar.
 */

import type { MultitrackSession, MultitrackTrack } from './types.ts';

export class MultitrackEngine {
  public session: MultitrackSession;
  public isPlaying = false;
  public currentTime = 0;
  public playbackRate = 1.0;

  constructor(session: MultitrackSession) {
    this.session = JSON.parse(JSON.stringify(session)); // Copia profunda
  }

  /**
   * Calcula la ganancia efectiva (volumen resultante) de una pista aplicando la lógica de Mute y Solo.
   *
   * Reglas de la consola:
   * 1. Si al menos una pista tiene `isSolo === true`:
   *    - Cualquier pista sin solo tiene ganancia 0.0.
   *    - Las pistas con solo y sin mute tienen su ganancia original.
   * 2. Si ninguna pista tiene solo:
   *    - Las pistas con `isMuted === true` tienen ganancia 0.0.
   *    - Las demás tienen su ganancia configurada.
   */
  public getEffectiveGain(trackId: string): number {
    const track = this.session.tracks.find((t) => t.id === trackId);
    if (!track) return 0.0;

    const hasAnySolo = this.session.tracks.some((t) => t.isSolo);

    if (hasAnySolo) {
      if (!track.isSolo || track.isMuted) {
        return 0.0;
      }
      return Math.max(0.0, Math.min(1.0, track.volume));
    }

    if (track.isMuted) {
      return 0.0;
    }

    return Math.max(0.0, Math.min(1.0, track.volume));
  }

  /**
   * Actualiza el volumen de una pista garantizando límites [0.0, 1.0].
   */
  public setTrackVolume(trackId: string, volume: number): void {
    const track = this.session.tracks.find((t) => t.id === trackId);
    if (track) {
      track.volume = Math.max(0.0, Math.min(1.0, volume));
    }
  }

  /**
   * Actualiza el balance estéreo garantizando límites [-1.0, 1.0].
   */
  public setTrackPan(trackId: string, pan: number): void {
    const track = this.session.tracks.find((t) => t.id === trackId);
    if (track) {
      track.pan = Math.max(-1.0, Math.min(1.0, pan));
    }
  }

  public toggleMute(trackId: string): void {
    const track = this.session.tracks.find((t) => t.id === trackId);
    if (track) {
      track.isMuted = !track.isMuted;
    }
  }

  public toggleSolo(trackId: string): void {
    const track = this.session.tracks.find((t) => t.id === trackId);
    if (track) {
      track.isSolo = !track.isSolo;
    }
  }

  /**
   * Sincroniza la posición de búsqueda en todas las pistas.
   */
  public seek(timeSeconds: number): void {
    this.currentTime = Math.max(0, Math.min(this.session.durationSeconds, timeSeconds));
  }

  public play(): void {
    this.isPlaying = true;
  }

  public pause(): void {
    this.isPlaying = false;
  }

  public stop(): void {
    this.isPlaying = false;
    this.currentTime = 0;
  }

  /**
   * Valida si la sesión multipista está completa y autorizada para ejecución offline.
   * Devuelve false si tan solo un stem falta en la caché local.
   */
  public static isFullyAvailableOffline(
    session: MultitrackSession,
    availableAudioAssetIds: Set<string>
  ): { isReady: boolean; missingCount: number; missingIds: string[] } {
    const missingIds: string[] = [];

    for (const track of session.tracks) {
      if (!availableAudioAssetIds.has(track.audioAssetId)) {
        missingIds.push(track.audioAssetId);
      }
    }

    return {
      isReady: missingIds.length === 0,
      missingCount: missingIds.length,
      missingIds,
    };
  }
}
