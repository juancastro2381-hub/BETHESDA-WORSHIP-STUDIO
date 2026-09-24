/**
 * @file setlist-repository.ts
 * @description Repositorio e interfaz de persistencia para Setlists y Momentos Litúrgicos (Fase 2C — WS3) usando Drizzle ORM y PostgreSQL.
 */

import { and, asc, desc, eq, gt, gte, sql } from 'drizzle-orm';
import { db as defaultDb, type Database } from '../db/index.ts';
import { setlistItems, setlists, songs, users } from '../db/schema.ts';
import type {
  CreateSetlistDTO,
  CreateSetlistItemDTO,
  SetlistEntity,
  SetlistFilterOptions,
  SetlistItemEntity,
  SetlistItemWithSongEntity,
  SetlistStatus,
  SetlistSummaryEntity,
  SetlistWithItemsEntity,
  UpdateSetlistDTO,
  UpdateSetlistItemDTO,
} from '../domain/setlist-types.ts';
import { AppError, ConflictError, NotFoundError, PersistenceError, ValidationError } from '../domain/errors.ts';

export interface ISetlistRepository {
  // Setlist CRUD
  list(filter?: SetlistFilterOptions): Promise<{ items: SetlistSummaryEntity[]; total: number }>;
  findById(id: string): Promise<SetlistWithItemsEntity | null>;
  create(dto: CreateSetlistDTO): Promise<SetlistEntity>;
  update(id: string, dto: UpdateSetlistDTO): Promise<SetlistEntity | null>;
  updateStatus(id: string, status: SetlistStatus): Promise<SetlistEntity | null>;
  delete(id: string): Promise<boolean>;

  // Setlist Items CRUD
  listItemsBySetlist(setlistId: string): Promise<SetlistItemWithSongEntity[]>;
  findItemById(itemId: string): Promise<SetlistItemWithSongEntity | null>;
  createItem(setlistId: string, dto: CreateSetlistItemDTO): Promise<SetlistItemWithSongEntity>;
  updateItem(setlistId: string, itemId: string, dto: UpdateSetlistItemDTO): Promise<SetlistItemWithSongEntity | null>;
  deleteItem(setlistId: string, itemId: string): Promise<boolean>;

  // Atomic Reordering
  reorderItems(setlistId: string, itemIds: string[]): Promise<SetlistItemWithSongEntity[]>;
}

export class DrizzleSetlistRepository implements ISetlistRepository {
  public constructor(private readonly db: Database = defaultDb) {}

  // ==========================================================================
  // SETLIST CRUD
  // ==========================================================================

  public async list(filter?: SetlistFilterOptions): Promise<{ items: SetlistSummaryEntity[]; total: number }> {
    try {
      const limit = Math.max(1, Math.min(100, filter?.limit ?? 20));
      const offset = Math.max(0, filter?.offset ?? 0);

      const conditions = [];

      if (filter?.status) {
        conditions.push(eq(setlists.status, filter.status));
      }

      if (filter?.upcoming) {
        conditions.push(
          and(
            sql`${setlists.scheduledDateTime} IS NOT NULL`,
            gte(setlists.scheduledDateTime, sql`NOW()`)
          )
        );
      }

      const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

      const [countResult, rows] = await Promise.all([
        this.db
          .select({ count: sql<number>`count(*)::int` })
          .from(setlists)
          .where(whereClause),
        this.db
          .select({
            id: setlists.id,
            title: setlists.title,
            scheduledDateTime: setlists.scheduledDateTime,
            status: setlists.status,
            directorUserId: setlists.directorUserId,
            directorFirstName: users.firstName,
            directorLastName: users.lastName,
            totalItems: sql<number>`(SELECT count(*)::int FROM ${setlistItems} WHERE ${setlistItems.setlistId} = ${setlists.id})`,
            totalSongs: sql<number>`(SELECT count(*)::int FROM ${setlistItems} WHERE ${setlistItems.setlistId} = ${setlists.id} AND ${setlistItems.itemType} = 'SONG')`,
            createdAt: setlists.createdAt,
            updatedAt: setlists.updatedAt,
          })
          .from(setlists)
          .leftJoin(users, eq(setlists.directorUserId, users.id))
          .where(whereClause)
          .orderBy(desc(setlists.scheduledDateTime), desc(setlists.createdAt))
          .limit(limit)
          .offset(offset),
      ]);

      const total = countResult[0]?.count ?? 0;

      const items: SetlistSummaryEntity[] = rows.map((r) => {
        const directorName =
          r.directorFirstName || r.directorLastName
            ? `${r.directorFirstName ?? ''} ${r.directorLastName ?? ''}`.trim()
            : null;

        return {
          id: r.id,
          title: r.title,
          scheduledDateTime: r.scheduledDateTime,
          status: r.status,
          directorUserId: r.directorUserId,
          directorName: directorName || undefined,
          totalItems: Number(r.totalItems),
          totalSongs: Number(r.totalSongs),
          createdAt: r.createdAt,
          updatedAt: r.updatedAt,
        };
      });

      return { items, total };
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new PersistenceError(`Error al listar setlists: ${error instanceof Error ? error.message : String(error)}`, error);
    }
  }

  public async findById(id: string): Promise<SetlistWithItemsEntity | null> {
    try {
      const setlistRows = await this.db
        .select({
          setlist: setlists,
          directorFirstName: users.firstName,
          directorLastName: users.lastName,
        })
        .from(setlists)
        .leftJoin(users, eq(setlists.directorUserId, users.id))
        .where(eq(setlists.id, id))
        .limit(1);

      const row = setlistRows[0];
      if (!row) return null;

      const directorName =
        row.directorFirstName || row.directorLastName
          ? `${row.directorFirstName ?? ''} ${row.directorLastName ?? ''}`.trim()
          : null;

      const items = await this.fetchItemsWithSong(this.db, id);

      return {
        id: row.setlist.id,
        title: row.setlist.title,
        scheduledDateTime: row.setlist.scheduledDateTime,
        status: row.setlist.status,
        directorUserId: row.setlist.directorUserId,
        directorName,
        notes: row.setlist.notes,
        createdAt: row.setlist.createdAt,
        updatedAt: row.setlist.updatedAt,
        items,
      };
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new PersistenceError(`Error al consultar setlist '${id}': ${error instanceof Error ? error.message : String(error)}`, error);
    }
  }

  public async create(dto: CreateSetlistDTO): Promise<SetlistEntity> {
    try {
      const scheduledDateTime = dto.scheduledDateTime
        ? (dto.scheduledDateTime instanceof Date ? dto.scheduledDateTime : new Date(dto.scheduledDateTime))
        : null;

      const [created] = await this.db
        .insert(setlists)
        .values({
          title: dto.title.trim(),
          scheduledDateTime,
          status: dto.status ?? 'PLANNING',
          directorUserId: dto.directorUserId ?? null,
          notes: dto.notes ?? null,
        })
        .returning();

      if (!created) {
        throw new PersistenceError('No se pudo insertar el registro del setlist.');
      }

      return this.mapToSetlistEntity(created);
    } catch (error) {
      return await this.handleUniqueActiveConflict(error, `Error al crear setlist: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  public async update(id: string, dto: UpdateSetlistDTO): Promise<SetlistEntity | null> {
    try {
      const updateData: Record<string, unknown> = {
        updatedAt: new Date(),
      };

      if (dto.title !== undefined) {
        updateData.title = dto.title.trim();
      }
      if (dto.scheduledDateTime !== undefined) {
        updateData.scheduledDateTime = dto.scheduledDateTime
          ? (dto.scheduledDateTime instanceof Date ? dto.scheduledDateTime : new Date(dto.scheduledDateTime))
          : null;
      }
      if (dto.directorUserId !== undefined) {
        updateData.directorUserId = dto.directorUserId;
      }
      if (dto.notes !== undefined) {
        updateData.notes = dto.notes;
      }

      const [updated] = await this.db
        .update(setlists)
        .set(updateData)
        .where(eq(setlists.id, id))
        .returning();

      return updated ? this.mapToSetlistEntity(updated) : null;
    } catch (error) {
      return await this.handleUniqueActiveConflict(error, `Error al actualizar setlist '${id}': ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  public async updateStatus(id: string, status: SetlistStatus): Promise<SetlistEntity | null> {
    try {
      const [updated] = await this.db
        .update(setlists)
        .set({
          status,
          updatedAt: new Date(),
        })
        .where(eq(setlists.id, id))
        .returning();

      return updated ? this.mapToSetlistEntity(updated) : null;
    } catch (error) {
      return await this.handleUniqueActiveConflict(error, `Error al actualizar estado del setlist '${id}': ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async handleUniqueActiveConflict(error: unknown, fallbackMessage?: string): Promise<never> {
    const pgErr = error as { code?: string; constraint?: string; message?: string };
    if (
      pgErr?.code === '23505' &&
      (pgErr.constraint === 'idx_setlists_single_active' || pgErr.message?.includes('idx_setlists_single_active'))
    ) {
      const [existingActive] = await this.db
        .select({ title: setlists.title })
        .from(setlists)
        .where(eq(setlists.status, 'ACTIVE'))
        .limit(1);

      const title = existingActive?.title ?? 'En curso';
      throw new ConflictError(
        `Ya existe un setlist en estado ACTIVE ('${title}'). Debe finalizar o cambiar su estado antes de activar un nuevo culto.`
      );
    }
    if (error instanceof AppError) throw error;
    throw new PersistenceError(
      fallbackMessage ?? `Error de persistencia: ${error instanceof Error ? error.message : String(error)}`,
      error
    );
  }

  public async delete(id: string): Promise<boolean> {
    try {
      const result = await this.db
        .delete(setlists)
        .where(eq(setlists.id, id))
        .returning({ id: setlists.id });

      return result.length > 0;
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new PersistenceError(`Error al eliminar setlist '${id}': ${error instanceof Error ? error.message : String(error)}`, error);
    }
  }

  // ==========================================================================
  // SETLIST ITEMS CRUD
  // ==========================================================================

  public async listItemsBySetlist(setlistId: string): Promise<SetlistItemWithSongEntity[]> {
    try {
      return await this.fetchItemsWithSong(this.db, setlistId);
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new PersistenceError(`Error al listar ítems del setlist '${setlistId}': ${error instanceof Error ? error.message : String(error)}`, error);
    }
  }

  public async findItemById(itemId: string): Promise<SetlistItemWithSongEntity | null> {
    try {
      const rows = await this.db
        .select({
          item: setlistItems,
          songId: songs.id,
          songTitle: songs.title,
          songArtist: songs.artist,
          songDefaultKey: songs.defaultKey,
          songDefaultBpm: songs.defaultBpm,
          songTimeSignature: songs.timeSignature,
          songStatus: songs.status,
        })
        .from(setlistItems)
        .leftJoin(songs, eq(setlistItems.songId, songs.id))
        .where(eq(setlistItems.id, itemId))
        .limit(1);

      const r = rows[0];
      if (!r) return null;

      return {
        id: r.item.id,
        setlistId: r.item.setlistId,
        sequenceOrder: r.item.sequenceOrder,
        itemType: r.item.itemType,
        songId: r.item.songId,
        targetKey: r.item.targetKey,
        targetBpm: r.item.targetBpm,
        transitionType: r.item.transitionType,
        momentTitle: r.item.momentTitle,
        durationMinutes: r.item.durationMinutes,
        musicalKey: r.item.musicalKey,
        notesForTeam: r.item.notesForTeam,
        createdAt: r.item.createdAt,
        updatedAt: r.item.updatedAt,
        song: r.songId
          ? {
              id: r.songId,
              title: r.songTitle!,
              artist: r.songArtist,
              defaultKey: r.songDefaultKey!,
              defaultBpm: r.songDefaultBpm!,
              timeSignature: r.songTimeSignature!,
              status: r.songStatus!,
            }
          : null,
      };
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new PersistenceError(`Error al consultar ítem '${itemId}': ${error instanceof Error ? error.message : String(error)}`, error);
    }
  }

  public async createItem(setlistId: string, dto: CreateSetlistItemDTO): Promise<SetlistItemWithSongEntity> {
    try {
      return await this.db.transaction(async (tx) => {
        // 1. Verificar que el setlist existe
        const [setlist] = await tx
          .select({ id: setlists.id })
          .from(setlists)
          .where(eq(setlists.id, setlistId))
          .limit(1);

        if (!setlist) {
          throw new NotFoundError('Setlist', setlistId);
        }

        // 2. Si es SONG, verificar que la canción existe
        if (dto.itemType === 'SONG') {
          if (!dto.songId) {
            throw new ValidationError('songId es obligatorio para ítems de tipo SONG.');
          }

          const [song] = await tx
            .select({ id: songs.id })
            .from(songs)
            .where(eq(songs.id, dto.songId))
            .limit(1);

          if (!song) {
            throw new NotFoundError('Song', dto.songId);
          }
        }

        // 3. Calcular número de secuencia
        const maxSeqRes = await tx
          .select({ maxSeq: sql<number>`coalesce(max(${setlistItems.sequenceOrder}), 0)::int` })
          .from(setlistItems)
          .where(eq(setlistItems.setlistId, setlistId));

        const currentMax = maxSeqRes[0]?.maxSeq ?? 0;
        let targetSeq = dto.sequenceOrder;

        if (!targetSeq || targetSeq <= 0 || targetSeq > currentMax + 1) {
          targetSeq = currentMax + 1;
        } else {
          // Desplazar elementos existentes hacia arriba para hacer espacio
          await tx
            .update(setlistItems)
            .set({
              sequenceOrder: sql`${setlistItems.sequenceOrder} + 1`,
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(setlistItems.setlistId, setlistId),
                gte(setlistItems.sequenceOrder, targetSeq)
              )
            );
        }

        // 4. Insertar el ítem
        const [createdItem] = await tx
          .insert(setlistItems)
          .values({
            setlistId,
            sequenceOrder: targetSeq,
            itemType: dto.itemType,
            songId: dto.itemType === 'SONG' ? dto.songId : null,
            targetKey: dto.targetKey ?? null,
            targetBpm: dto.targetBpm ?? null,
            transitionType: dto.transitionType ?? 'STOP',
            momentTitle: dto.itemType === 'SERVICE_MOMENT' ? dto.momentTitle : null,
            durationMinutes: dto.itemType === 'SERVICE_MOMENT' ? dto.durationMinutes : null,
            musicalKey: dto.itemType === 'SERVICE_MOMENT' ? dto.musicalKey : null,
            notesForTeam: dto.notesForTeam ?? null,
          })
          .returning();

        if (!createdItem) {
          throw new PersistenceError('No se pudo insertar el elemento en setlist_items.');
        }

        // 5. Actualizar timestamp del setlist padre
        await tx
          .update(setlists)
          .set({ updatedAt: new Date() })
          .where(eq(setlists.id, setlistId));

        // 6. Consultar y devolver el ítem creado con metadatos de canción
        const items = await this.fetchItemsWithSong(tx, setlistId, createdItem.id);
        const itemWithSong = items[0];
        if (!itemWithSong) {
          throw new PersistenceError('No se pudo recuperar el ítem recién insertado.');
        }

        return itemWithSong;
      });
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new PersistenceError(`Error al crear ítem en setlist '${setlistId}': ${error instanceof Error ? error.message : String(error)}`, error);
    }
  }

  public async updateItem(setlistId: string, itemId: string, dto: UpdateSetlistItemDTO): Promise<SetlistItemWithSongEntity | null> {
    try {
      return await this.db.transaction(async (tx) => {
        // Verificar que el ítem pertenece a este setlist
        const [existing] = await tx
          .select({ id: setlistItems.id })
          .from(setlistItems)
          .where(and(eq(setlistItems.id, itemId), eq(setlistItems.setlistId, setlistId)))
          .limit(1);

        if (!existing) return null;

        const updateData: Record<string, unknown> = {
          updatedAt: new Date(),
        };

        if (dto.targetKey !== undefined) updateData.targetKey = dto.targetKey;
        if (dto.targetBpm !== undefined) updateData.targetBpm = dto.targetBpm;
        if (dto.transitionType !== undefined) updateData.transitionType = dto.transitionType;
        if (dto.momentTitle !== undefined) updateData.momentTitle = dto.momentTitle;
        if (dto.durationMinutes !== undefined) updateData.durationMinutes = dto.durationMinutes;
        if (dto.musicalKey !== undefined) updateData.musicalKey = dto.musicalKey;
        if (dto.notesForTeam !== undefined) updateData.notesForTeam = dto.notesForTeam;

        await tx
          .update(setlistItems)
          .set(updateData)
          .where(eq(setlistItems.id, itemId));

        await tx
          .update(setlists)
          .set({ updatedAt: new Date() })
          .where(eq(setlists.id, setlistId));

        const items = await this.fetchItemsWithSong(tx, setlistId, itemId);
        return items[0] ?? null;
      });
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new PersistenceError(`Error al actualizar ítem '${itemId}' en setlist '${setlistId}': ${error instanceof Error ? error.message : String(error)}`, error);
    }
  }

  public async deleteItem(setlistId: string, itemId: string): Promise<boolean> {
    try {
      return await this.db.transaction(async (tx) => {
        // Verificar existencia y orden
        const [existing] = await tx
          .select({ id: setlistItems.id, sequenceOrder: setlistItems.sequenceOrder })
          .from(setlistItems)
          .where(and(eq(setlistItems.id, itemId), eq(setlistItems.setlistId, setlistId)))
          .limit(1);

        if (!existing) return false;

        // Eliminar ítem
        await tx
          .delete(setlistItems)
          .where(eq(setlistItems.id, itemId));

        // Recompactar secuencia de elementos posteriores
        await tx
          .update(setlistItems)
          .set({
            sequenceOrder: sql`${setlistItems.sequenceOrder} - 1`,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(setlistItems.setlistId, setlistId),
              gt(setlistItems.sequenceOrder, existing.sequenceOrder)
            )
          );

        // Actualizar timestamp del setlist padre
        await tx
          .update(setlists)
          .set({ updatedAt: new Date() })
          .where(eq(setlists.id, setlistId));

        return true;
      });
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new PersistenceError(`Error al eliminar ítem '${itemId}' del setlist '${setlistId}': ${error instanceof Error ? error.message : String(error)}`, error);
    }
  }

  // ==========================================================================
  // ATOMIC REORDER TRANSACTIONS (WS3 CRITICAL REQUIREMENT)
  // ==========================================================================

  public async reorderItems(setlistId: string, itemIds: string[]): Promise<SetlistItemWithSongEntity[]> {
    if (!itemIds || itemIds.length === 0) {
      throw new ValidationError('La lista de itemIds no puede estar vacía.');
    }

    if (new Set(itemIds).size !== itemIds.length) {
      throw new ValidationError('La lista de itemIds no puede contener identificadores duplicados.');
    }

    try {
      return await this.db.transaction(async (tx) => {
        // 1. Bloqueo pesimista sobre el setlist padre para prevenir carreras concurrentes
        const setlistLock = await tx.execute(
          sql`SELECT id FROM setlists WHERE id = ${setlistId} FOR UPDATE`
        );

        if (!setlistLock.rows || setlistLock.rows.length === 0) {
          throw new NotFoundError('Setlist', setlistId);
        }

        // 2. Obtener los ítems existentes en base de datos para este setlist
        const existingItems = await tx
          .select({ id: setlistItems.id })
          .from(setlistItems)
          .where(eq(setlistItems.setlistId, setlistId));

        // 3. Validar correspondencia estricta de cantidad
        if (existingItems.length !== itemIds.length) {
          throw new ValidationError(
            `La lista de reordenamiento suministró ${itemIds.length} ítems pero el setlist contiene ${existingItems.length} ítems.`
          );
        }

        // 4. Validar pertenencia: todos los IDs suministrados deben pertenecer a este setlist
        const existingIdSet = new Set(existingItems.map((item) => item.id));
        for (const id of itemIds) {
          if (!existingIdSet.has(id)) {
            throw new ValidationError(
              `El ítem con identificador '${id}' no pertenece al setlist '${setlistId}'.`
            );
          }
        }

        // 5. Aplicar la nueva secuencia atómicamente dentro de la transacción
        for (let i = 0; i < itemIds.length; i++) {
          const itemId = itemIds[i]!;
          await tx
            .update(setlistItems)
            .set({
              sequenceOrder: i + 1,
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(setlistItems.id, itemId),
                eq(setlistItems.setlistId, setlistId)
              )
            );
        }

        // 6. Actualizar timestamp del setlist padre
        await tx
          .update(setlists)
          .set({ updatedAt: new Date() })
          .where(eq(setlists.id, setlistId));

        // 7. Retornar todos los ítems ordenados con metadatos musicales
        return await this.fetchItemsWithSong(tx, setlistId);
      });
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new PersistenceError(`Fallo en la transacción atómica de reordenamiento: ${error instanceof Error ? error.message : String(error)}`, error);
    }
  }

  // ==========================================================================
  // HELPERS PRIVADOS
  // ==========================================================================

  private async fetchItemsWithSong(
    executor: Database | Parameters<Parameters<Database['transaction']>[0]>[0],
    setlistId: string,
    specificItemId?: string
  ): Promise<SetlistItemWithSongEntity[]> {
    const conditions = [eq(setlistItems.setlistId, setlistId)];
    if (specificItemId) {
      conditions.push(eq(setlistItems.id, specificItemId));
    }

    const rows = await (executor as any)
      .select({
        item: setlistItems,
        songId: songs.id,
        songTitle: songs.title,
        songArtist: songs.artist,
        songDefaultKey: songs.defaultKey,
        songDefaultBpm: songs.defaultBpm,
        songTimeSignature: songs.timeSignature,
        songStatus: songs.status,
      })
      .from(setlistItems)
      .leftJoin(songs, eq(setlistItems.songId, songs.id))
      .where(and(...conditions))
      .orderBy(asc(setlistItems.sequenceOrder));

    return rows.map((r: any) => ({
      id: r.item.id,
      setlistId: r.item.setlistId,
      sequenceOrder: r.item.sequenceOrder,
      itemType: r.item.itemType,
      songId: r.item.songId,
      targetKey: r.item.targetKey,
      targetBpm: r.item.targetBpm,
      transitionType: r.item.transitionType,
      momentTitle: r.item.momentTitle,
      durationMinutes: r.item.durationMinutes,
      musicalKey: r.item.musicalKey,
      notesForTeam: r.item.notesForTeam,
      createdAt: r.item.createdAt,
      updatedAt: r.item.updatedAt,
      song: r.songId
        ? {
            id: r.songId,
            title: r.songTitle,
            artist: r.songArtist,
            defaultKey: r.songDefaultKey,
            defaultBpm: r.songDefaultBpm,
            timeSignature: r.songTimeSignature,
            status: r.songStatus,
          }
        : null,
    }));
  }

  private mapToSetlistEntity(row: typeof setlists.$inferSelect): SetlistEntity {
    return {
      id: row.id,
      title: row.title,
      scheduledDateTime: row.scheduledDateTime,
      status: row.status,
      directorUserId: row.directorUserId,
      notes: row.notes,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
