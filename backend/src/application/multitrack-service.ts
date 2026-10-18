/**
 * @file multitrack-service.ts
 * @description Servicio de gestión de sesiones y pistas multipista (Fase 3C — D1 / R1).
 *
 * Aplica:
 * - Vinculación obligatoria a AudioAssets autorizados de Workstream A (no duplica ni burla autorización).
 * - Validación estricta de pertenencia: cada AudioAsset debe pertenecer a la misma canción (prevención de IDOR / contaminación cruzada).
 * - Persistencia duradera en PostgreSQL a través de IMultitrackRepository.
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
import {
  type IMultitrackRepository,
  DrizzleMultitrackRepository,
} from '../repositories/multitrack-repository.ts';
import { NotFoundError, ValidationError } from '../domain/errors.ts';

export class MultitrackService {
  private sessions: Map<string, MultitrackSession>;
  private audioRepo: IAudioRepository;
  private songRepo: ISongRepository;
  private multitrackRepo: IMultitrackRepository;

  constructor(
    audioRepo: IAudioRepository,
    songRepo: ISongRepository,
    multitrackRepo?: IMultitrackRepository
  ) {
    this.sessions = new Map();
    this.audioRepo = audioRepo;
    this.songRepo = songRepo;
    this.multitrackRepo = multitrackRepo ?? new DrizzleMultitrackRepository();
  }

  /**
   * Crea una sesión multipista vinculada a una canción canónica y a recursos de audio autorizados.
   * Persiste la sesión y pistas en PostgreSQL mediante transacción atómica.
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

      // Verificar existencia del AudioAsset en Workstream A
      const asset = await this.audioRepo.findById(t.audioAssetId);
      if (!asset) {
        throw new NotFoundError('Recurso de audio (stem)', t.audioAssetId);
      }

      // Validar pertenencia estricta a la canción de la sesión (prevención IDOR / contaminación cruzada)
      if (asset.songId !== dto.songId) {
        throw new ValidationError(
          `El recurso de audio '${t.name}' (${t.audioAssetId}) no pertenece a la canción de la sesión (${dto.songId}).`
        );
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

    let session: MultitrackSession;
    if (this.multitrackRepo) {
      session = await this.multitrackRepo.createSession(
        {
          id: sessionId,
          songId: dto.songId,
          title: dto.title,
          durationSeconds: Math.max(0, dto.durationSeconds),
          bpm: dto.bpm,
          createdByUserId: _userId,
        },
        tracks.map((tr) => ({
          id: tr.id,
          sessionId,
          name: tr.name,
          trackType: tr.trackType,
          audioAssetId: tr.audioAssetId,
          volume: tr.volume,
          pan: tr.pan,
          isMuted: tr.isMuted,
          isSolo: tr.isSolo,
          offsetMs: tr.offsetMs,
          sortOrder: tr.sortOrder,
        }))
      );
    } else {
      session = {
        id: sessionId,
        songId: dto.songId,
        title: dto.title,
        durationSeconds: Math.max(0, dto.durationSeconds),
        bpm: dto.bpm,
        tracks,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
    }

    this.sessions.set(sessionId, session);
    return session;
  }

  /**
   * Obtiene una sesión multipista por ID, consultando la caché o la base de datos PostgreSQL.
   */
  public async getSession(sessionId: string): Promise<MultitrackSession> {
    let session = this.sessions.get(sessionId);
    if (!session && this.multitrackRepo) {
      const persisted = await this.multitrackRepo.findById(sessionId);
      if (persisted) {
        session = persisted;
        this.sessions.set(sessionId, session);
      }
    }
    if (!session) {
      throw new NotFoundError('Sesión multipista', sessionId);
    }
    return session;
  }

  /**
   * Actualiza parámetros de mezcla de una pista (volumen, pan, mute, solo) de forma persistente.
   */
  public async updateTrackMix(
    sessionId: string,
    trackId: string,
    updates: { volume?: number; pan?: number; isMuted?: boolean; isSolo?: boolean }
  ): Promise<MultitrackTrack> {
    const session = await this.getSession(sessionId);
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

    if (this.multitrackRepo) {
      await this.multitrackRepo.updateTrackMix(sessionId, trackId, updates);
    }

    return track;
  }

  /**
   * Valida la completitud para reproducción offline.
   * Exige que TODOS los stems estén descargados y autorizados localmente.
   */
  public async checkOfflineCompleteness(
    sessionId: string,
    availableLocalAssetIds: string[]
  ): Promise<MultitrackOfflineStatus> {
    const session = await this.getSession(sessionId);
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
