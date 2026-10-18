/**
 * @file audio-repository.ts
 * @description Repositorio para la persistencia y consulta de activos de audio (Workstream A).
 */

import { eq, desc } from 'drizzle-orm';
import { db as defaultDb, type Database } from '../db/index.ts';
import { audioAssets, type AudioAsset, type NewAudioAsset } from '../db/schema.ts';

export interface IAudioRepository {
  create(data: NewAudioAsset): Promise<AudioAsset>;
  findById(id: string): Promise<AudioAsset | null>;
  findBySongId(songId: string): Promise<AudioAsset[]>;
  delete(id: string): Promise<boolean>;
}

export class DrizzleAudioRepository implements IAudioRepository {
  public constructor(private readonly db: Database = defaultDb) {}

  public async create(data: NewAudioAsset): Promise<AudioAsset> {
    const [inserted] = await this.db.insert(audioAssets).values(data).returning();
    if (!inserted) {
      throw new Error('Fallo al registrar el activo de audio en la base de datos.');
    }
    return inserted;
  }

  public async findById(id: string): Promise<AudioAsset | null> {
    const [found] = await this.db
      .select()
      .from(audioAssets)
      .where(eq(audioAssets.id, id))
      .limit(1);

    return found ?? null;
  }

  public async findBySongId(songId: string): Promise<AudioAsset[]> {
    return await this.db
      .select()
      .from(audioAssets)
      .where(eq(audioAssets.songId, songId))
      .orderBy(desc(audioAssets.createdAt));
  }

  public async delete(id: string): Promise<boolean> {
    const deleted = await this.db
      .delete(audioAssets)
      .where(eq(audioAssets.id, id))
      .returning({ id: audioAssets.id });

    return deleted.length > 0;
  }
}
