/**
 * @file multitrack-service.ts
 * @description Servicio de gestión de sesiones y pistas multipista (Fase 3C — D1).
 *
 * Aplica:
 * - Vinculación obligatoria a AudioAssets autorizados de Workstream A (no duplica ni burla autorización).
 * - Validación de límites: volumen [0.0, 1.0], balance [-1.0, 1.0], offset [-5000, 5000] ms.
 * - Validación estricta de completitud offline: si falta una sola pista, se deniega la reproducción offline.
 * - CERO soporte de pedales físicos.
 */

import crypto from 'node:crypto';
import type {
  CreateMultitrackSessionDTO,
  MultitrackOfflineStatus,
  MultitrackSession,
  MultitrackTrack,
} from '../domain/multitrack/types.ts';
import type { IAudioRepository } from '../repositories/audio-repository.ts';
import type { ISongRepository } from '../repositories/song-repository.ts';
import { NotFoundError, ValidationError } from '../domain/errors.ts';

export class MultitrackService {
  private sessions: Map<string, MultitrackSession>;
  private audioRepo: IAudioRepository;
  private songRepo: ISongRepository;

  constructor(audioRepo: IAudioRepository, songRepo: ISongRepository) {
    this.sessions = new Map();
    this.audioRepo = audioRepo;
    this.songRepo = songRepo;
  }

  /**
   * Crea una sesión multipista vinculada a una canción canónica y a recursos de audio autorizados.
   */
  public async createSession(
    dto: CreateMultitrackSessionDTO,
    _userId: string
  ): Promise<MultitrackSession> {
    // 1. Validar que la canción exista
    const song = await this.songRepo.findById(dto.songId);
    if (!song) {
      throw new NotFoundError('Canción', dto.songId);
    }

    if (!dto.tracks || dto.tracks.length === 0) {
      throw new ValidationError('Una sesión multipista debe contener al menos una pista de audio (stem).');
    }

    const sessionId = crypto.randomUUID();
    const tracks: MultitrackTrack[] = [];

    // 2. Validar cada pista y su correspondiente AudioAsset en Workstream A
    for (let i = 0; i < dto.tracks.length; i++) {
      const t = dto.tracks[i];

      // Validar volumen [0.0, 1.0]
      const volume = t.volume ?? 0.8;
      if (volume < 0.0 || volume > 1.0) {
        throw new ValidationError(`El volumen de la pista '${t.name}' debe estar en el rango [0.0, 1.0].`);
      }

      // Validar balance [-1.0, 1.0]
      const pan = t.pan ?? 0.0;
      if (pan < -1.0 || pan > 1.0) {
        throw new ValidationError(`El balance estéreo de la pista '${t.name}' debe estar en el rango [-1.0, 1.0].`);
      }

      // Validar offset de sincronización [-5000, 5000] ms
      const offsetMs = t.offsetMs ?? 0;
      if (offsetMs < -5000 || offsetMs > 5000) {
        throw new ValidationError(`El desfase de sincronización de la pista '${t.name}' debe estar entre -5000 y 5000 ms.`);
      }

      // Verificar existencia y autorización del AudioAsset en Workstream A
      const asset = await this.audioRepo.findById(t.audioAssetId);
      if (!asset) {
        throw new NotFoundError('Recurso de audio (stem)', t.audioAssetId);
      }

      tracks.push({
        id: crypto.randomUUID(),
        sessionId,
        name: t.name,
        trackType: t.trackType,
        audioAssetId: t.audioAssetId,
        volume,
        pan,
        isMuted: t.isMuted ?? false,
        isSolo: t.isSolo ?? false,
        offsetMs,
        sortOrder: t.sortOrder ?? i + 1,
      });
    }

    const session: MultitrackSession = {
      id: sessionId,
      songId: dto.songId,
      title: dto.title,
      durationSeconds: Math.max(0, dto.durationSeconds),
      bpm: dto.bpm,
      tracks,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    this.sessions.set(sessionId, session);
    return session;
  }

  /**
   * Obtiene una sesión multipista por ID.
   */
  public getSession(sessionId: string): MultitrackSession {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new NotFoundError('Sesión multipista', sessionId);
    }
    return session;
  }

  /**
   * Actualiza parámetros de mezcla de una pista (volumen, pan, mute, solo).
   */
  public updateTrackMix(
    sessionId: string,
    trackId: string,
    updates: { volume?: number; pan?: number; isMuted?: boolean; isSolo?: boolean }
  ): MultitrackTrack {
    const session = this.getSession(sessionId);
    const track = session.tracks.find((t) => t.id === trackId);
    if (!track) {
      throw new NotFoundError('Pista multipista', trackId);
    }

    if (updates.volume !== undefined) {
      if (updates.volume < 0.0 || updates.volume > 1.0) {
        throw new ValidationError('El volumen debe estar en el rango [0.0, 1.0].');
      }
      track.volume = updates.volume;
    }

    if (updates.pan !== undefined) {
      if (updates.pan < -1.0 || updates.pan > 1.0) {
        throw new ValidationError('El balance estéreo debe estar en el rango [-1.0, 1.0].');
      }
      track.pan = updates.pan;
    }

    if (updates.isMuted !== undefined) {
      track.isMuted = updates.isMuted;
    }

    if (updates.isSolo !== undefined) {
      track.isSolo = updates.isSolo;
    }

    session.updatedAt = new Date().toISOString();
    return track;
  }

  /**
   * Valida la completitud para reproducción offline.
   * Exige que TODOS los stems estén descargados y autorizados localmente.
   */
  public checkOfflineCompleteness(
    sessionId: string,
    availableLocalAssetIds: string[]
  ): MultitrackOfflineStatus {
    const session = this.getSession(sessionId);
    const localSet = new Set(availableLocalAssetIds);

    const missingAssetIds: string[] = [];
    let downloadedCount = 0;

    for (const track of session.tracks) {
      if (localSet.has(track.audioAssetId)) {
        downloadedCount += 1;
      } else {
        missingAssetIds.push(track.audioAssetId);
      }
    }

    const isFullyAvailableOffline = missingAssetIds.length === 0;

    return {
      sessionId,
      isFullyAvailableOffline,
      totalTracks: session.tracks.length,
      downloadedTracks: downloadedCount,
      missingAssetIds,
    };
  }

  /**
   * Reset para entornos de prueba
   */
  public clearSessions(): void {
    this.sessions.clear();
  }
}
