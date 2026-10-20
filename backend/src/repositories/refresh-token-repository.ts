/**
 * @file refresh-token-repository.ts
 * @description Repositorio para la gestión segura de Refresh Tokens y Familias de Tokens (Fase 2B).
 */

import { eq, and, lt, desc } from 'drizzle-orm';
import { db as defaultDb, type Database } from '../db/index.ts';
import { refreshTokens } from '../db/schema.ts';
import type { RefreshTokenEntity } from '../domain/auth-types.ts';

export interface CreateRefreshTokenInput {
  userId: string;
  tokenHash: string;
  familyId: string;
  expiresAt: Date;
  userAgent?: string | null;
  ipAddress?: string | null;
}

export interface IRefreshTokenRepository {
  create(input: CreateRefreshTokenInput): Promise<RefreshTokenEntity>;
  findByTokenHash(tokenHash: string): Promise<RefreshTokenEntity | null>;
  findActiveByFamily(familyId: string): Promise<RefreshTokenEntity | null>;
  revokeToken(id: string): Promise<void>;
  revokeFamily(familyId: string): Promise<void>;
  revokeAllForUser(userId: string): Promise<void>;
  updateLastUsed(id: string): Promise<void>;
  pruneExpired(): Promise<number>;
}

export class DrizzleRefreshTokenRepository implements IRefreshTokenRepository {
  public constructor(private readonly db: Database = defaultDb) {}

  public async create(input: CreateRefreshTokenInput): Promise<RefreshTokenEntity> {
    const [created] = await this.db
      .insert(refreshTokens)
      .values({
        userId: input.userId,
        tokenHash: input.tokenHash,
        familyId: input.familyId,
        expiresAt: input.expiresAt,
        userAgent: input.userAgent ?? null,
        ipAddress: input.ipAddress ?? null,
        isRevoked: false,
      })
      .returning();

    return this.mapToEntity(created);
  }

  public async findByTokenHash(tokenHash: string): Promise<RefreshTokenEntity | null> {
    const [found] = await this.db
      .select()
      .from(refreshTokens)
      .where(eq(refreshTokens.tokenHash, tokenHash))
      .limit(1);

    return found ? this.mapToEntity(found) : null;
  }

  public async findActiveByFamily(familyId: string): Promise<RefreshTokenEntity | null> {
    const [found] = await this.db
      .select()
      .from(refreshTokens)
      .where(and(eq(refreshTokens.familyId, familyId), eq(refreshTokens.isRevoked, false)))
      .orderBy(desc(refreshTokens.createdAt))
      .limit(1);

    return found ? this.mapToEntity(found) : null;
  }

  public async revokeToken(id: string): Promise<void> {
    await this.db
      .update(refreshTokens)
      .set({
        isRevoked: true,
        lastUsedAt: new Date(),
      })
      .where(eq(refreshTokens.id, id));
  }

  /**
   * Revoca inmediatamente toda la familia de tokens asociada a una cadena de refresco.
   * Mandatorio para mitigación de robo o reutilización de tokens (Token Replay Attack).
   */
  public async revokeFamily(familyId: string): Promise<void> {
    await this.db
      .update(refreshTokens)
      .set({
        isRevoked: true,
        lastUsedAt: new Date(),
      })
      .where(eq(refreshTokens.familyId, familyId));
  }

  public async revokeAllForUser(userId: string): Promise<void> {
    await this.db
      .update(refreshTokens)
      .set({
        isRevoked: true,
        lastUsedAt: new Date(),
      })
      .where(eq(refreshTokens.userId, userId));
  }

  public async updateLastUsed(id: string): Promise<void> {
    await this.db
      .update(refreshTokens)
      .set({
        lastUsedAt: new Date(),
      })
      .where(eq(refreshTokens.id, id));
  }

  public async pruneExpired(): Promise<number> {
    const deleted = await this.db
      .delete(refreshTokens)
      .where(lt(refreshTokens.expiresAt, new Date()))
      .returning({ id: refreshTokens.id });

    return deleted.length;
  }

  private mapToEntity(row: typeof refreshTokens.$inferSelect): RefreshTokenEntity {
    return {
      id: row.id,
      userId: row.userId,
      tokenHash: row.tokenHash,
      familyId: row.familyId,
      isRevoked: row.isRevoked,
      expiresAt: new Date(row.expiresAt),
      userAgent: row.userAgent,
      ipAddress: row.ipAddress,
      createdAt: new Date(row.createdAt),
      lastUsedAt: row.lastUsedAt ? new Date(row.lastUsedAt) : null,
    };
  }
}
