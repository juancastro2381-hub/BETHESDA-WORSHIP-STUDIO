/**
 * @file user-invitation-repository.ts
 * @description Repositorio para la gestión de invitaciones administrativas y tokens de onboarding (Fase 2B).
 */

import { eq, and } from 'drizzle-orm';
import { db as defaultDb, type Database } from '../db/index.ts';
import { userInvitations } from '../db/schema.ts';
import type { UserInvitationEntity, UserRole } from '../domain/auth-types.ts';

export interface CreateInvitationInput {
  email: string;
  tokenHash: string;
  role: UserRole;
  invitedByUserId: string;
  expiresAt: Date;
}

export interface IUserInvitationRepository {
  create(input: CreateInvitationInput): Promise<UserInvitationEntity>;
  findByTokenHash(tokenHash: string): Promise<UserInvitationEntity | null>;
  findByEmail(email: string): Promise<UserInvitationEntity | null>;
  markAccepted(id: string): Promise<void>;
  revokePendingByEmail(email: string): Promise<void>;
}

export class DrizzleUserInvitationRepository implements IUserInvitationRepository {
  public constructor(private readonly db: Database = defaultDb) {}

  public async create(input: CreateInvitationInput): Promise<UserInvitationEntity> {
    const normalizedEmail = input.email.trim().toLowerCase();

    const [created] = await this.db
      .insert(userInvitations)
      .values({
        email: normalizedEmail,
        tokenHash: input.tokenHash,
        role: input.role,
        invitedByUserId: input.invitedByUserId,
        expiresAt: input.expiresAt,
        isAccepted: false,
      })
      .returning();

    return this.mapToEntity(created);
  }

  public async findByTokenHash(tokenHash: string): Promise<UserInvitationEntity | null> {
    const [found] = await this.db
      .select()
      .from(userInvitations)
      .where(eq(userInvitations.tokenHash, tokenHash))
      .limit(1);

    return found ? this.mapToEntity(found) : null;
  }

  public async findByEmail(email: string): Promise<UserInvitationEntity | null> {
    const normalizedEmail = email.trim().toLowerCase();
    const [found] = await this.db
      .select()
      .from(userInvitations)
      .where(and(eq(userInvitations.email, normalizedEmail), eq(userInvitations.isAccepted, false)))
      .limit(1);

    return found ? this.mapToEntity(found) : null;
  }

  public async markAccepted(id: string): Promise<void> {
    await this.db
      .update(userInvitations)
      .set({ isAccepted: true })
      .where(eq(userInvitations.id, id));
  }

  public async revokePendingByEmail(email: string): Promise<void> {
    const normalizedEmail = email.trim().toLowerCase();
    await this.db
      .update(userInvitations)
      .set({ isAccepted: true })
      .where(and(eq(userInvitations.email, normalizedEmail), eq(userInvitations.isAccepted, false)));
  }

  private mapToEntity(row: typeof userInvitations.$inferSelect): UserInvitationEntity {
    return {
      id: row.id,
      email: row.email,
      tokenHash: row.tokenHash,
      role: row.role as UserRole,
      invitedByUserId: row.invitedByUserId,
      expiresAt: new Date(row.expiresAt),
      isAccepted: row.isAccepted,
      createdAt: new Date(row.createdAt),
    };
  }
}
