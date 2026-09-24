/**
 * @file password-reset-repository.ts
 * @description Repositorio para tokens criptográficos de un solo uso de recuperación de contraseña (Fase 2B).
 */

import { eq } from 'drizzle-orm';
import { db as defaultDb, type Database } from '../db/index.ts';
import { passwordResetTokens } from '../db/schema.ts';
import type { PasswordResetTokenEntity } from '../domain/auth-types.ts';

export interface CreatePasswordResetInput {
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  ipAddress?: string | null;
}

export interface IPasswordResetTokenRepository {
  create(input: CreatePasswordResetInput): Promise<PasswordResetTokenEntity>;
  findByTokenHash(tokenHash: string): Promise<PasswordResetTokenEntity | null>;
  markUsed(id: string): Promise<void>;
  invalidateExistingForUser(userId: string): Promise<void>;
}

export class DrizzlePasswordResetTokenRepository implements IPasswordResetTokenRepository {
  public constructor(private readonly db: Database = defaultDb) {}

  public async create(input: CreatePasswordResetInput): Promise<PasswordResetTokenEntity> {
    // Invalida tokens previos no utilizados del mismo usuario
    await this.invalidateExistingForUser(input.userId);

    const [created] = await this.db
      .insert(passwordResetTokens)
      .values({
        userId: input.userId,
        tokenHash: input.tokenHash,
        expiresAt: input.expiresAt,
        ipAddress: input.ipAddress ?? null,
        isUsed: false,
      })
      .returning();

    return this.mapToEntity(created);
  }

  public async findByTokenHash(tokenHash: string): Promise<PasswordResetTokenEntity | null> {
    const [found] = await this.db
      .select()
      .from(passwordResetTokens)
      .where(eq(passwordResetTokens.tokenHash, tokenHash))
      .limit(1);

    return found ? this.mapToEntity(found) : null;
  }

  public async markUsed(id: string): Promise<void> {
    await this.db
      .update(passwordResetTokens)
      .set({ isUsed: true })
      .where(eq(passwordResetTokens.id, id));
  }

  public async invalidateExistingForUser(userId: string): Promise<void> {
    await this.db
      .update(passwordResetTokens)
      .set({ isUsed: true })
      .where(eq(passwordResetTokens.userId, userId));
  }

  private mapToEntity(row: typeof passwordResetTokens.$inferSelect): PasswordResetTokenEntity {
    return {
      id: row.id,
      userId: row.userId,
      tokenHash: row.tokenHash,
      expiresAt: new Date(row.expiresAt),
      isUsed: row.isUsed,
      ipAddress: row.ipAddress,
      createdAt: new Date(row.createdAt),
    };
  }
}
