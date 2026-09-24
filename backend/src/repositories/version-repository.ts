/**
 * @file version-repository.ts
 * @description Interfaz e implementación de persistencia para `SongVersion` usando Drizzle ORM.
 */

import { and, desc, eq } from 'drizzle-orm';
import { db, type Database } from '../db/index.ts';
import { songs, songSources, songVersions } from '../db/schema.ts';
import type { CreateVersionDTO, SongVersionEntity } from '../domain/types.ts';
import { CanonicalDeserializer, CanonicalSerializer } from '../domain/canonical-serializer.ts';
import { InvalidMusicPayloadError, NotFoundError, PersistenceError } from '../domain/errors.ts';

export interface ISongVersionRepository {
  findById(versionId: string): Promise<SongVersionEntity | null>;
  findBySongId(songId: string): Promise<SongVersionEntity[]>;
  createVersion(dto: CreateVersionDTO): Promise<SongVersionEntity>;
  setCurrentVersion(songId: string, versionId: string): Promise<void>;
}

export class DrizzleSongVersionRepository implements ISongVersionRepository {
  public constructor(private readonly database: Database = db) {}

  public async findById(versionId: string): Promise<SongVersionEntity | null> {
    try {
      const rows = await this.database
        .select()
        .from(songVersions)
        .where(eq(songVersions.id, versionId))
        .limit(1);

      const row = rows[0];
      return row ? this.mapToVersionEntity(row) : null;
    } catch (error) {
      throw new PersistenceError(`Error al consultar versión '${versionId}': ${error instanceof Error ? error.message : String(error)}`, error);
    }
  }

  public async findBySongId(songId: string): Promise<SongVersionEntity[]> {
    try {
      const rows = await this.database
        .select()
        .from(songVersions)
        .where(eq(songVersions.songId, songId))
        .orderBy(desc(songVersions.versionNumber));

      return rows.map((r) => this.mapToVersionEntity(r));
    } catch (error) {
      throw new PersistenceError(`Error al listar versiones para canción '${songId}': ${error instanceof Error ? error.message : String(error)}`, error);
    }
  }

  public async createVersion(dto: CreateVersionDTO): Promise<SongVersionEntity> {
    try {
      return await this.database.transaction(async (tx) => {
        // 1. Verificar que la canción existe
        const [existingSong] = await tx
          .select()
          .from(songs)
          .where(eq(songs.id, dto.songId))
          .limit(1);

        if (!existingSong) {
          throw new NotFoundError('Canción', dto.songId);
        }

        // 2. Determinar el siguiente número de versión
        const [latest] = await tx
          .select({ versionNumber: songVersions.versionNumber })
          .from(songVersions)
          .where(eq(songVersions.songId, dto.songId))
          .orderBy(desc(songVersions.versionNumber))
          .limit(1);

        const nextVersionNumber = (latest?.versionNumber ?? 0) + 1;

        // 3. Deserializar y validar payload canónico
        const deserializedPayload = CanonicalDeserializer.deserialize(dto.canonicalPayload);
        const canonicalJSON = CanonicalSerializer.serialize(deserializedPayload);
        const stats = CanonicalSerializer.extractStatistics(deserializedPayload);

        const shouldSetCurrent = dto.setAsCurrent ?? true;

        // 4. Si se define como versión actual, desmarcar versiones previas
        if (shouldSetCurrent) {
          await tx
            .update(songVersions)
            .set({ isCurrent: false })
            .where(eq(songVersions.songId, dto.songId));
        }

        // 5. Insertar la nueva versión
        const [newVersion] = await tx
          .insert(songVersions)
          .values({
            songId: dto.songId,
            versionNumber: nextVersionNumber,
            name: dto.name ?? `Versión ${nextVersionNumber}`,
            description: dto.description ?? null,
            sourceFormat: dto.sourceFormat,
            canonicalPayload: canonicalJSON,
            totalMeasures: stats.totalMeasures,
            totalNotes: stats.totalNotes,
            totalChords: stats.totalChords,
            isCurrent: shouldSetCurrent,
          })
          .returning();

        if (!newVersion) {
          throw new PersistenceError('No se pudo insertar la nueva versión.');
        }

        // 6. Actualizar la canción si es versión actual
        if (shouldSetCurrent) {
          await tx
            .update(songs)
            .set({
              currentVersionId: newVersion.id,
              updatedAt: new Date(),
            })
            .where(eq(songs.id, dto.songId));
        }

        // 7. Si hay registro de fuente, guardarlo
        if (dto.sourceRecord) {
          await tx.insert(songSources).values({
            songId: dto.songId,
            versionId: newVersion.id,
            sourceType: dto.sourceFormat === 'CHORD_PRO' ? 'CHORD_PRO' : 'MUSIC_XML',
            filename: dto.sourceRecord.filename ?? null,
            rawContent: dto.sourceRecord.rawContent ?? null,
            importerName: dto.sourceRecord.importerName,
            importerVersion: dto.sourceRecord.importerVersion,
          });
        }

        return this.mapToVersionEntity(newVersion);
      });
    } catch (error) {
      if (error instanceof NotFoundError || error instanceof InvalidMusicPayloadError || error instanceof PersistenceError) throw error;
      throw new PersistenceError(`Fallo al crear versión musical: ${error instanceof Error ? error.message : String(error)}`, error);
    }
  }

  public async setCurrentVersion(songId: string, versionId: string): Promise<void> {
    try {
      await this.database.transaction(async (tx) => {
        const [vRow] = await tx
          .select()
          .from(songVersions)
          .where(and(eq(songVersions.id, versionId), eq(songVersions.songId, songId)))
          .limit(1);

        if (!vRow) {
          throw new NotFoundError('Versión de canción', versionId);
        }

        await tx
          .update(songVersions)
          .set({ isCurrent: false })
          .where(eq(songVersions.songId, songId));

        await tx
          .update(songVersions)
          .set({ isCurrent: true })
          .where(eq(songVersions.id, versionId));

        await tx
          .update(songs)
          .set({ currentVersionId: versionId, updatedAt: new Date() })
          .where(eq(songs.id, songId));
      });
    } catch (error) {
      if (error instanceof NotFoundError) throw error;
      throw new PersistenceError(`Error al establecer versión actual: ${error instanceof Error ? error.message : String(error)}`, error);
    }
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
}
