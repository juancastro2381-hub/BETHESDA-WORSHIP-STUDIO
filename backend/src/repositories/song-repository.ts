/**
 * @file song-repository.ts
 * @description Interfaz e implementación de persistencia para la entidad `Song` usando Drizzle ORM.
 */

import { and, desc, eq, ilike, or, sql } from 'drizzle-orm';
import { db, type Database } from '../db/index.ts';
import { songMetadata, songs, songSources, songVersions } from '../db/schema.ts';
import type {
  CreateSongDTO,
  SongEntity,
  SongMetadataEntity,
  SongReviewStatus,
  SongVersionEntity,
} from '../domain/types.ts';
import { CanonicalDeserializer, CanonicalSerializer } from '../domain/canonical-serializer.ts';
import { InvalidMusicPayloadError, PersistenceError } from '../domain/errors.ts';

export interface ListSongsParams {
  search?: string | undefined;
  status?: SongReviewStatus | undefined;
  limit?: number | undefined;
  offset?: number | undefined;
}

export interface SongWithVersion {
  song: SongEntity;
  version: SongVersionEntity;
  metadata?: SongMetadataEntity | undefined;
}

export interface ISongRepository {
  findById(id: string): Promise<SongEntity | null>;
  findWithCurrentVersion(id: string): Promise<SongWithVersion | null>;
  list(params?: ListSongsParams): Promise<{ items: SongEntity[]; total: number }>;
  create(dto: CreateSongDTO): Promise<SongWithVersion>;
  updateStatus(id: string, status: SongReviewStatus): Promise<SongEntity | null>;
  delete(id: string): Promise<boolean>;
}

export class DrizzleSongRepository implements ISongRepository {
  public constructor(private readonly database: Database = db) {}

  public async findById(id: string): Promise<SongEntity | null> {
    try {
      const rows = await this.database.select().from(songs).where(eq(songs.id, id)).limit(1);
      const row = rows[0];
      if (!row) return null;
      return this.mapToSongEntity(row);
    } catch (error) {
      throw new PersistenceError(`Error al consultar canción por id '${id}': ${error instanceof Error ? error.message : String(error)}`, error);
    }
  }

  public async findWithCurrentVersion(id: string): Promise<SongWithVersion | null> {
    try {
      const songRows = await this.database.select().from(songs).where(eq(songs.id, id)).limit(1);
      const songRow = songRows[0];
      if (!songRow) return null;

      const song = this.mapToSongEntity(songRow);

      let versionRow;
      if (song.currentVersionId) {
        const vRows = await this.database
          .select()
          .from(songVersions)
          .where(eq(songVersions.id, song.currentVersionId))
          .limit(1);
        versionRow = vRows[0];
      }

      if (!versionRow) {
        const fallbackRows = await this.database
          .select()
          .from(songVersions)
          .where(eq(songVersions.songId, id))
          .orderBy(desc(songVersions.versionNumber))
          .limit(1);
        versionRow = fallbackRows[0];
      }

      if (!versionRow) {
        throw new PersistenceError(`Inconsistencia en persistencia: la canción '${id}' no posee versiones musicales.`);
      }

      const version = this.mapToVersionEntity(versionRow);

      // Metadata opcional
      const metaRows = await this.database
        .select()
        .from(songMetadata)
        .where(eq(songMetadata.songId, id))
        .limit(1);
      const metaRow = metaRows[0];

      return {
        song,
        version,
        metadata: metaRow ? this.mapToMetadataEntity(metaRow) : undefined,
      };
    } catch (error) {
      if (error instanceof PersistenceError) throw error;
      throw new PersistenceError(`Error al consultar canción y versión actual '${id}': ${error instanceof Error ? error.message : String(error)}`, error);
    }
  }

  public async list(params?: ListSongsParams): Promise<{ items: SongEntity[]; total: number }> {
    try {
      const limit = Math.max(1, Math.min(100, params?.limit ?? 20));
      const offset = Math.max(0, params?.offset ?? 0);

      const conditions = [];

      if (params?.status) {
        conditions.push(eq(songs.status, params.status));
      }

      if (params?.search && params.search.trim()) {
        const term = `%${params.search.trim()}%`;
        conditions.push(or(ilike(songs.title, term), ilike(songs.artist, term)));
      }

      const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

      const [countResult, rows] = await Promise.all([
        this.database
          .select({ count: sql<number>`count(*)::int` })
          .from(songs)
          .where(whereClause),
        this.database
          .select()
          .from(songs)
          .where(whereClause)
          .orderBy(desc(songs.updatedAt))
          .limit(limit)
          .offset(offset),
      ]);

      const total = countResult[0]?.count ?? 0;
      const items = rows.map((r) => this.mapToSongEntity(r));

      return { items, total };
    } catch (error) {
      throw new PersistenceError(`Error al listar canciones: ${error instanceof Error ? error.message : String(error)}`, error);
    }
  }

  public async create(dto: CreateSongDTO): Promise<SongWithVersion> {
    try {
      return await this.database.transaction(async (tx) => {
        // 1. Extraer y validar el payload canónico
        const deserializedPayload = CanonicalDeserializer.deserialize(dto.canonicalPayload);
        const canonicalJSON = CanonicalSerializer.serialize(deserializedPayload);
        const stats = CanonicalSerializer.extractStatistics(deserializedPayload);

        // 2. Insertar canción maestra
        const [newSong] = await tx
          .insert(songs)
          .values({
            title: dto.title.trim(),
            artist: dto.artist ? dto.artist.trim() : null,
            ccliNumber: dto.ccliNumber ? dto.ccliNumber.trim() : null,
            defaultKey: dto.defaultKey.trim(),
            defaultBpm: dto.defaultBpm ?? 120,
            timeSignature: dto.timeSignature ?? '4/4',
            status: dto.status ?? 'DRAFT',
          })
          .returning();

        if (!newSong) {
          throw new PersistenceError('No se pudo insertar el registro maestro de la canción.');
        }

        // 3. Insertar versión inicial (v1)
        const [newVersion] = await tx
          .insert(songVersions)
          .values({
            songId: newSong.id,
            versionNumber: 1,
            name: dto.versionName ?? 'Versión Inicial',
            description: dto.versionDescription ?? 'Importación inicial del arreglo canónico',
            sourceFormat: dto.sourceFormat,
            canonicalPayload: canonicalJSON,
            totalMeasures: stats.totalMeasures,
            totalNotes: stats.totalNotes,
            totalChords: stats.totalChords,
            isCurrent: true,
          })
          .returning();

        if (!newVersion) {
          throw new PersistenceError('No se pudo insertar la versión inicial de la canción.');
        }

        // 4. Actualizar puntero de versión actual en la canción
        await tx
          .update(songs)
          .set({ currentVersionId: newVersion.id, updatedAt: new Date() })
          .where(eq(songs.id, newSong.id));

        newSong.currentVersionId = newVersion.id;

        // 5. Registrar procedencia si se proporcionó
        if (dto.sourceRecord) {
          await tx.insert(songSources).values({
            songId: newSong.id,
            versionId: newVersion.id,
            sourceType: dto.sourceFormat === 'CHORD_PRO' ? 'CHORD_PRO' : 'MUSIC_XML',
            filename: dto.sourceRecord.filename ?? null,
            rawContent: dto.sourceRecord.rawContent ?? null,
            importerName: dto.sourceRecord.importerName,
            importerVersion: dto.sourceRecord.importerVersion,
          });
        }

        // 6. Registrar metadatos opcionales
        let metadataEntity: SongMetadataEntity | undefined;
        if (dto.metadata) {
          const [newMeta] = await tx
            .insert(songMetadata)
            .values({
              songId: newSong.id,
              tags: dto.metadata.tags ?? [],
              themes: dto.metadata.themes ?? [],
              copyright: dto.metadata.copyright ?? null,
              notes: dto.metadata.notes ?? null,
            })
            .returning();
          if (newMeta) {
            metadataEntity = this.mapToMetadataEntity(newMeta);
          }
        }

        return {
          song: this.mapToSongEntity(newSong),
          version: this.mapToVersionEntity(newVersion),
          metadata: metadataEntity,
        };
      });
    } catch (error) {
      if (error instanceof InvalidMusicPayloadError) throw error;
      if (error instanceof PersistenceError) throw error;
      throw new PersistenceError(`Fallo en la transacción de creación de canción: ${error instanceof Error ? error.message : String(error)}`, error);
    }
  }

  public async updateStatus(id: string, status: SongReviewStatus): Promise<SongEntity | null> {
    try {
      const [updated] = await this.database
        .update(songs)
        .set({ status, updatedAt: new Date() })
        .where(eq(songs.id, id))
        .returning();
      return updated ? this.mapToSongEntity(updated) : null;
    } catch (error) {
      throw new PersistenceError(`Error al actualizar estado de canción '${id}': ${error instanceof Error ? error.message : String(error)}`, error);
    }
  }

  public async delete(id: string): Promise<boolean> {
    try {
      const result = await this.database.delete(songs).where(eq(songs.id, id)).returning({ id: songs.id });
      return result.length > 0;
    } catch (error) {
      throw new PersistenceError(`Error al eliminar canción '${id}': ${error instanceof Error ? error.message : String(error)}`, error);
    }
  }

  private mapToSongEntity(row: typeof songs.$inferSelect): SongEntity {
    return {
      id: row.id,
      title: row.title,
      artist: row.artist,
      ccliNumber: row.ccliNumber,
      defaultKey: row.defaultKey,
      defaultBpm: row.defaultBpm,
      timeSignature: row.timeSignature,
      status: row.status as SongReviewStatus,
      currentVersionId: row.currentVersionId,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  private mapToVersionEntity(row: typeof songVersions.$inferSelect): SongVersionEntity {
    return {
      id: row.id,
      songId: row.songId,
      versionNumber: row.versionNumber,
      name: row.name,
      description: row.description,
      sourceFormat: row.sourceFormat as any,
      canonicalPayload: row.canonicalPayload as any,
      totalMeasures: row.totalMeasures,
      totalNotes: row.totalNotes,
      totalChords: row.totalChords,
      isCurrent: row.isCurrent,
      createdAt: row.createdAt,
    };
  }

  private mapToMetadataEntity(row: typeof songMetadata.$inferSelect): SongMetadataEntity {
    return {
      id: row.id,
      songId: row.songId,
      tags: (row.tags as string[]) ?? [],
      themes: (row.themes as string[]) ?? [],
      copyright: row.copyright,
      notes: row.notes,
      updatedAt: row.updatedAt,
    };
  }
}
