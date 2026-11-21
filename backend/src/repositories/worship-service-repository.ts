/**
 * @file worship-service-repository.ts
 * @description Repositorio e interfaz de persistencia para Servicios y Cultos Litúrgicos (Fase 2C) con PostgreSQL y Drizzle.
 */

import { and, desc, eq, gte, lt, sql } from 'drizzle-orm';
import { db as defaultDb, type Database } from '../db/index.ts';
import { setlistItems, setlists, users, worshipServices } from '../db/schema.ts';
import type {
  CreateWorshipServiceDTO,
  UpdateWorshipServiceDTO,
  WorshipServiceFilterOptions,
  WorshipServiceWithSetlistEntity,
} from '../domain/worship-service-types.ts';
import { AppError, NotFoundError, PersistenceError } from '../domain/errors.ts';

export interface IWorshipServiceRepository {
  list(filter?: WorshipServiceFilterOptions): Promise<{ items: WorshipServiceWithSetlistEntity[]; total: number }>;
  findById(id: string): Promise<WorshipServiceWithSetlistEntity | null>;
  create(dto: CreateWorshipServiceDTO): Promise<WorshipServiceWithSetlistEntity>;
  update(id: string, dto: UpdateWorshipServiceDTO): Promise<WorshipServiceWithSetlistEntity | null>;
  delete(id: string): Promise<boolean>;
}

export class DrizzleWorshipServiceRepository implements IWorshipServiceRepository {
  public constructor(private readonly db: Database = defaultDb) {}

  public async list(filter?: WorshipServiceFilterOptions): Promise<{ items: WorshipServiceWithSetlistEntity[]; total: number }> {
    try {
      const limit = Math.max(1, Math.min(100, filter?.limit ?? 20));
      const offset = Math.max(0, filter?.offset ?? 0);

      const conditions = [];

      if (filter?.status) {
        conditions.push(eq(worshipServices.status, filter.status));
      }

      if (filter?.serviceType) {
        conditions.push(eq(worshipServices.serviceType, filter.serviceType));
      }

      if (filter?.worshipLeaderId) {
        conditions.push(eq(worshipServices.worshipLeaderId, filter.worshipLeaderId));
      }

      if (filter?.timeframe === 'upcoming') {
        conditions.push(gte(worshipServices.scheduledAt, sql`NOW()`));
      } else if (filter?.timeframe === 'completed') {
        conditions.push(lt(worshipServices.scheduledAt, sql`NOW()`));
      }

      const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

      const [countResult, rows] = await Promise.all([
        this.db
          .select({ count: sql<number>`count(*)::int` })
          .from(worshipServices)
          .where(whereClause),
        this.db
          .select({
            service: worshipServices,
            leaderFirstName: users.firstName,
            leaderLastName: users.lastName,
            setlistId: setlists.id,
            setlistTitle: setlists.title,
            setlistStatus: setlists.status,
            setlistTotalItems: sql<number>`(SELECT count(*)::int FROM ${setlistItems} WHERE ${setlistItems.setlistId} = ${setlists.id})`,
          })
          .from(worshipServices)
          .leftJoin(users, eq(worshipServices.worshipLeaderId, users.id))
          .leftJoin(setlists, eq(worshipServices.setlistId, setlists.id))
          .where(whereClause)
          .orderBy(desc(worshipServices.scheduledAt), desc(worshipServices.createdAt))
          .limit(limit)
          .offset(offset),
      ]);

      const total = countResult[0]?.count ?? 0;

      const items: WorshipServiceWithSetlistEntity[] = rows.map((r) => {
        const leaderName =
          r.leaderFirstName || r.leaderLastName
            ? `${r.leaderFirstName ?? ''} ${r.leaderLastName ?? ''}`.trim()
            : null;

        return {
          id: r.service.id,
          name: r.service.name,
          description: r.service.description,
          serviceType: r.service.serviceType,
          scheduledAt: r.service.scheduledAt,
          worshipLeaderId: r.service.worshipLeaderId,
          worshipLeaderName: leaderName || undefined,
          notes: r.service.notes,
          status: r.service.status,
          setlistId: r.service.setlistId,
          setlist: r.setlistId
            ? {
                id: r.setlistId,
                title: r.setlistTitle!,
                status: r.setlistStatus!,
                totalItems: Number(r.setlistTotalItems ?? 0),
              }
            : null,
          createdAt: r.service.createdAt,
          updatedAt: r.service.updatedAt,
        };
      });

      return { items, total };
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new PersistenceError(`Error al listar servicios litúrgicos: ${error instanceof Error ? error.message : String(error)}`, error);
    }
  }

  public async findById(id: string): Promise<WorshipServiceWithSetlistEntity | null> {
    try {
      const rows = await this.db
        .select({
          service: worshipServices,
          leaderFirstName: users.firstName,
          leaderLastName: users.lastName,
          setlistId: setlists.id,
          setlistTitle: setlists.title,
          setlistStatus: setlists.status,
          setlistTotalItems: sql<number>`(SELECT count(*)::int FROM ${setlistItems} WHERE ${setlistItems.setlistId} = ${setlists.id})`,
        })
        .from(worshipServices)
        .leftJoin(users, eq(worshipServices.worshipLeaderId, users.id))
        .leftJoin(setlists, eq(worshipServices.setlistId, setlists.id))
        .where(eq(worshipServices.id, id))
        .limit(1);

      const r = rows[0];
      if (!r) return null;

      const leaderName =
        r.leaderFirstName || r.leaderLastName
          ? `${r.leaderFirstName ?? ''} ${r.leaderLastName ?? ''}`.trim()
          : null;

      return {
        id: r.service.id,
        name: r.service.name,
        description: r.service.description,
        serviceType: r.service.serviceType,
        scheduledAt: r.service.scheduledAt,
        worshipLeaderId: r.service.worshipLeaderId,
        worshipLeaderName: leaderName || undefined,
        notes: r.service.notes,
        status: r.service.status,
        setlistId: r.service.setlistId,
        setlist: r.setlistId
          ? {
              id: r.setlistId,
              title: r.setlistTitle!,
              status: r.setlistStatus!,
              totalItems: Number(r.setlistTotalItems ?? 0),
            }
          : null,
        createdAt: r.service.createdAt,
        updatedAt: r.service.updatedAt,
      };
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new PersistenceError(`Error al consultar servicio litúrgico '${id}': ${error instanceof Error ? error.message : String(error)}`, error);
    }
  }

  public async create(dto: CreateWorshipServiceDTO): Promise<WorshipServiceWithSetlistEntity> {
    try {
      const scheduledAt =
        dto.scheduledAt instanceof Date ? dto.scheduledAt : new Date(dto.scheduledAt);

      const [created] = await this.db
        .insert(worshipServices)
        .values({
          name: dto.name.trim(),
          description: dto.description?.trim() || null,
          serviceType: dto.serviceType?.trim() || 'Culto General',
          scheduledAt,
          worshipLeaderId: dto.worshipLeaderId || null,
          notes: dto.notes?.trim() || null,
          status: dto.status ?? 'DRAFT',
          setlistId: dto.setlistId || null,
        })
        .returning();

      if (!created) {
        throw new PersistenceError('No se pudo crear el servicio litúrgico.');
      }

      const entity = await this.findById(created.id);
      if (!entity) {
        throw new PersistenceError('No se pudo recuperar el servicio litúrgico recién creado.');
      }
      return entity;
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new PersistenceError(`Error al crear servicio litúrgico: ${error instanceof Error ? error.message : String(error)}`, error);
    }
  }

  public async update(id: string, dto: UpdateWorshipServiceDTO): Promise<WorshipServiceWithSetlistEntity | null> {
    try {
      const updateData: Record<string, unknown> = {
        updatedAt: new Date(),
      };

      if (dto.name !== undefined) updateData.name = dto.name.trim();
      if (dto.description !== undefined) updateData.description = dto.description?.trim() || null;
      if (dto.serviceType !== undefined) updateData.serviceType = dto.serviceType?.trim() || 'Culto General';
      if (dto.scheduledAt !== undefined) {
        updateData.scheduledAt = dto.scheduledAt instanceof Date ? dto.scheduledAt : new Date(dto.scheduledAt);
      }
      if (dto.worshipLeaderId !== undefined) updateData.worshipLeaderId = dto.worshipLeaderId || null;
      if (dto.notes !== undefined) updateData.notes = dto.notes?.trim() || null;
      if (dto.status !== undefined) updateData.status = dto.status;
      if (dto.setlistId !== undefined) updateData.setlistId = dto.setlistId || null;

      const [updated] = await this.db
        .update(worshipServices)
        .set(updateData)
        .where(eq(worshipServices.id, id))
        .returning({ id: worshipServices.id });

      if (!updated) return null;

      return await this.findById(id);
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new PersistenceError(`Error al actualizar servicio litúrgico '${id}': ${error instanceof Error ? error.message : String(error)}`, error);
    }
  }

  public async delete(id: string): Promise<boolean> {
    try {
      const result = await this.db
        .delete(worshipServices)
        .where(eq(worshipServices.id, id))
        .returning({ id: worshipServices.id });

      return result.length > 0;
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new PersistenceError(`Error al eliminar servicio litúrgico '${id}': ${error instanceof Error ? error.message : String(error)}`, error);
    }
  }
}

