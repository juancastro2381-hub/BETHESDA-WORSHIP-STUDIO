/**
 * @file song-service.ts
 * @description Servicio de aplicación que orquesta casos de uso para canciones y versiones musicales (Fase 2A).
 */

import type {
  CreateSongDTO,
  CreateVersionDTO,
  SongEntity,
  SongReviewStatus,
  SongVersionEntity,
} from '../domain/types.ts';
import {
  type ISongRepository,
  type ListSongsParams,
  type SongWithVersion,
} from '../repositories/song-repository.ts';
import {
  type ISongVersionRepository,
} from '../repositories/version-repository.ts';
import { NotFoundError } from '../domain/errors.ts';

export class SongService {
  public constructor(
    private readonly songRepo: ISongRepository,
    private readonly versionRepo: ISongVersionRepository
  ) {}

  public async createSong(dto: CreateSongDTO): Promise<SongWithVersion> {
    return await this.songRepo.create(dto);
  }

  public async getSong(id: string): Promise<SongWithVersion> {
    const found = await this.songRepo.findWithCurrentVersion(id);
    if (!found) {
      throw new NotFoundError('Canción', id);
    }
    return found;
  }

  public async listSongs(params?: ListSongsParams): Promise<{ items: SongEntity[]; total: number }> {
    return await this.songRepo.list(params);
  }

  public async updateSongStatus(id: string, status: SongReviewStatus): Promise<SongEntity> {
    const updated = await this.songRepo.updateStatus(id, status);
    if (!updated) {
      throw new NotFoundError('Canción', id);
    }
    return updated;
  }

  public async deleteSong(id: string): Promise<void> {
    const deleted = await this.songRepo.delete(id);
    if (!deleted) {
      throw new NotFoundError('Canción', id);
    }
  }

  public async createVersion(dto: CreateVersionDTO): Promise<SongVersionEntity> {
    return await this.versionRepo.createVersion(dto);
  }

  public async listVersions(songId: string): Promise<SongVersionEntity[]> {
    // Verificar existencia de la canción
    const song = await this.songRepo.findById(songId);
    if (!song) {
      throw new NotFoundError('Canción', songId);
    }
    return await this.versionRepo.findBySongId(songId);
  }

  public async getVersion(versionId: string): Promise<SongVersionEntity> {
    const version = await this.versionRepo.findById(versionId);
    if (!version) {
      throw new NotFoundError('Versión de canción', versionId);
    }
    return version;
  }

  public async setCurrentVersion(songId: string, versionId: string): Promise<void> {
    await this.versionRepo.setCurrentVersion(songId, versionId);
  }
}
