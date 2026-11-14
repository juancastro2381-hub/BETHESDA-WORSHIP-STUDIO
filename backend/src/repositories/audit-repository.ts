/**
 * @file audit-repository.ts
 * @description Repositorio inmutable ("application-level append-only") para eventos de seguridad y gobernanza (Fase 2B).
 */

import { asc, desc, inArray } from 'drizzle-orm';
import { db as defaultDb, type Database } from '../db/index.ts';
import { auditLogs } from '../db/schema.ts';
import type { AuditLogEntity, SecurityEventType } from '../domain/auth-types.ts';
import { sanitizeAuditMetadata } from '../domain/audit/audit-sanitizer.ts';

export interface CreateAuditLogInput {
  eventType: SecurityEventType | string;
  userId?: string | null;
  resource?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  metadata?: Record<string, unknown>;
}

export interface ListAuditLogsOptions {
  limit?: number;
  offset?: number;
  eventTypes?: string[];
  orderDirection?: 'asc' | 'desc';
}

export interface IAuditLogRepository {
  create(input: CreateAuditLogInput): Promise<AuditLogEntity>;
  list(options?: ListAuditLogsOptions): Promise<AuditLogEntity[]>;
}

export class DrizzleAuditLogRepository implements IAuditLogRepository {
  public constructor(private readonly db: Database = defaultDb) {}

  /**
   * Registra un evento de seguridad de forma estrictamente incremental (append-only).
   * Aplica sanitización mandatoria para garantizar que ningún secreto o credencial se persista.
   */
  public async create(input: CreateAuditLogInput): Promise<AuditLogEntity> {
    const cleanMetadata = sanitizeAuditMetadata(input.metadata);

    const [created] = await this.db
      .insert(auditLogs)
      .values({
        eventType: input.eventType,
        userId: input.userId ?? null,
        resource: input.resource ?? null,
        ipAddress: input.ipAddress ?? null,
        userAgent: input.userAgent ?? null,
        metadata: cleanMetadata,
      })
      .returning();

    return this.mapToEntity(created);
  }

  public async list(options?: ListAuditLogsOptions): Promise<AuditLogEntity[]> {
    const limit = options?.limit ?? 50;
    const offset = options?.offset ?? 0;

    const baseQuery = this.db.select().from(auditLogs);
    const filteredQuery =
      options?.eventTypes && options.eventTypes.length > 0
        ? baseQuery.where(inArray(auditLogs.eventType, options.eventTypes))
        : baseQuery;

    const orderedQuery =
      options?.orderDirection === 'desc'
        ? filteredQuery.orderBy(desc(auditLogs.createdAt), desc(auditLogs.id))
        : options?.orderDirection === 'asc'
          ? filteredQuery.orderBy(asc(auditLogs.createdAt), asc(auditLogs.id))
          : filteredQuery;

    const rows = await orderedQuery.limit(limit).offset(offset);

    return rows.map(this.mapToEntity);
  }

  private mapToEntity(row: typeof auditLogs.$inferSelect): AuditLogEntity {
    return {
      id: row.id,
      eventType: row.eventType,
      userId: row.userId,
      resource: row.resource,
      ipAddress: row.ipAddress,
      userAgent: row.userAgent,
      metadata: row.metadata as Record<string, unknown>,
      createdAt: new Date(row.createdAt),
    };
  }
}
