/**
 * @file user-repository.ts
 * @description Repositorio para la entidad de Usuarios (Fase 2B) utilizando Drizzle ORM y PostgreSQL.
 */

import { eq, and, sql } from 'drizzle-orm';
import { db as defaultDb, type Database } from '../db/index.ts';
import { users } from '../db/schema.ts';
import type { UserEntity, UserRole, AccountStatus } from '../domain/auth-types.ts';

export interface CreateUserInput {
  email: string;
  passwordHash: string;
  firstName: string;
  lastName: string;
  role?: UserRole;
  accountStatus?: AccountStatus;
  emailVerified?: boolean;
}

export interface IUserRepository {
  create(input: CreateUserInput): Promise<UserEntity>;
  findById(id: string): Promise<UserEntity | null>;
  findByEmail(email: string): Promise<UserEntity | null>;
  updateRole(id: string, newRole: UserRole): Promise<UserEntity>;
  updateStatus(id: string, newStatus: AccountStatus): Promise<UserEntity>;
  updatePassword(id: string, newPasswordHash: string): Promise<UserEntity>;
  update(id: string, updates: Partial<UserEntity>): Promise<UserEntity>;
  recordSuccessfulLogin(id: string): Promise<void>;
  recordFailedLogin(id: string, lockoutDurationMinutes?: number): Promise<{ failedAttempts: number; isLocked: boolean; lockoutUntil: Date | null }>;
  incrementTokenVersion(id: string): Promise<number>;
  countActiveSuperAdmins(): Promise<number>;
  list(options?: { role?: UserRole; status?: AccountStatus; search?: string; limit?: number; offset?: number }): Promise<{ items: UserEntity[]; total: number }>;
  listUsers(options?: { role?: UserRole; status?: AccountStatus; search?: string; limit?: number; offset?: number }): Promise<{ items: UserEntity[]; total: number }>;
}

export class DrizzleUserRepository implements IUserRepository {
  public constructor(private readonly db: Database = defaultDb) {}

  public async create(input: CreateUserInput): Promise<UserEntity> {
    const normalizedEmail = input.email.trim().toLowerCase();
    const [created] = await this.db
      .insert(users)
      .values({
        email: normalizedEmail,
        passwordHash: input.passwordHash,
        firstName: input.firstName.trim(),
        lastName: input.lastName.trim(),
        role: input.role ?? 'MUSICIAN',
        accountStatus: input.accountStatus ?? 'ACTIVE',
        emailVerified: input.emailVerified ?? false,
      })
      .returning();

    return this.mapToEntity(created);
  }

  public async findById(id: string): Promise<UserEntity | null> {
    const [found] = await this.db
      .select()
      .from(users)
      .where(eq(users.id, id))
      .limit(1);

    return found ? this.mapToEntity(found) : null;
  }

  public async findByEmail(email: string): Promise<UserEntity | null> {
    const normalizedEmail = email.trim().toLowerCase();
    const [found] = await this.db
      .select()
      .from(users)
      .where(eq(users.email, normalizedEmail))
      .limit(1);

    return found ? this.mapToEntity(found) : null;
  }

  public async updateRole(id: string, newRole: UserRole): Promise<UserEntity> {
    const [updated] = await this.db
      .update(users)
      .set({
        role: newRole,
        tokenVersion: sql`${users.tokenVersion} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(users.id, id))
      .returning();

    if (!updated) throw new Error(`Usuario con ID '${id}' no encontrado para actualizar rol.`);
    return this.mapToEntity(updated);
  }

  public async updateStatus(id: string, newStatus: AccountStatus): Promise<UserEntity> {
    const [updated] = await this.db
      .update(users)
      .set({
        accountStatus: newStatus,
        tokenVersion: sql`${users.tokenVersion} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(users.id, id))
      .returning();

    if (!updated) throw new Error(`Usuario con ID '${id}' no encontrado para actualizar estado.`);
    return this.mapToEntity(updated);
  }

  public async updatePassword(id: string, newPasswordHash: string): Promise<UserEntity> {
    const [updated] = await this.db
      .update(users)
      .set({
        passwordHash: newPasswordHash,
        tokenVersion: sql`${users.tokenVersion} + 1`,
        failedLoginAttempts: 0,
        lockoutUntil: null,
        accountStatus: 'ACTIVE',
        emailVerified: true,
        updatedAt: new Date(),
      })
      .where(eq(users.id, id))
      .returning();

    if (!updated) throw new Error(`Usuario con ID '${id}' no encontrado para actualizar contraseña.`);
    return this.mapToEntity(updated);
  }

  public async update(id: string, updates: Partial<UserEntity>): Promise<UserEntity> {
    const updateValues: Record<string, any> = {
      updatedAt: new Date(),
    };

    if (updates.role !== undefined) updateValues.role = updates.role;
    if (updates.accountStatus !== undefined) updateValues.accountStatus = updates.accountStatus;
    if (updates.passwordHash !== undefined) updateValues.passwordHash = updates.passwordHash;
    if (updates.firstName !== undefined) updateValues.firstName = updates.firstName;
    if (updates.lastName !== undefined) updateValues.lastName = updates.lastName;
    if (updates.emailVerified !== undefined) updateValues.emailVerified = updates.emailVerified;
    if (updates.tokenVersion !== undefined) updateValues.tokenVersion = updates.tokenVersion;
    if (updates.failedLoginAttempts !== undefined) updateValues.failedLoginAttempts = updates.failedLoginAttempts;
    if (updates.lockoutUntil !== undefined) updateValues.lockoutUntil = updates.lockoutUntil;

    const [updated] = await this.db
      .update(users)
      .set(updateValues)
      .where(eq(users.id, id))
      .returning();

    if (!updated) throw new Error(`Usuario con ID '${id}' no encontrado para actualizar.`);
    return this.mapToEntity(updated);
  }

  public async recordSuccessfulLogin(id: string): Promise<void> {
    await this.db
      .update(users)
      .set({
        failedLoginAttempts: 0,
        lockoutUntil: null,
        lastLoginAt: new Date(),
      })
      .where(eq(users.id, id));
  }

  public async recordFailedLogin(
    id: string,
    lockoutDurationMinutes = 15
  ): Promise<{ failedAttempts: number; isLocked: boolean; lockoutUntil: Date | null }> {
    const user = await this.findById(id);
    if (!user) return { failedAttempts: 0, isLocked: false, lockoutUntil: null };

    const newAttempts = user.failedLoginAttempts + 1;
    let lockoutUntil: Date | null = null;
    let isLocked = false;

    // Bloqueo temporal tras 5 intentos fallidos
    if (newAttempts >= 5) {
      lockoutUntil = new Date(Date.now() + lockoutDurationMinutes * 60 * 1000);
      isLocked = true;
    }

    await this.db
      .update(users)
      .set({
        failedLoginAttempts: newAttempts,
        lockoutUntil: lockoutUntil ?? user.lockoutUntil,
      })
      .where(eq(users.id, id));

    return { failedAttempts: newAttempts, isLocked, lockoutUntil };
  }

  public async incrementTokenVersion(id: string): Promise<number> {
    const [updated] = await this.db
      .update(users)
      .set({
        tokenVersion: sql`${users.tokenVersion} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(users.id, id))
      .returning({ tokenVersion: users.tokenVersion });

    return updated ? updated.tokenVersion : 1;
  }

  public async countActiveSuperAdmins(): Promise<number> {
    const [result] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(users)
      .where(and(eq(users.role, 'SUPER_ADMIN'), eq(users.accountStatus, 'ACTIVE')));

    return Number(result?.count ?? 0);
  }

  public async list(options?: {
    role?: UserRole;
    status?: AccountStatus;
    search?: string;
    limit?: number;
    offset?: number;
  }): Promise<{ items: UserEntity[]; total: number }> {
    const limit = options?.limit ?? 50;
    const offset = options?.offset ?? 0;

    const conditions = [];
    if (options?.role) conditions.push(eq(users.role, options.role));
    if (options?.status) conditions.push(eq(users.accountStatus, options.status));
    if (options?.search && options.search.trim()) {
      const term = `%${options.search.trim().toLowerCase()}%`;
      conditions.push(
        sql`(${users.email} ILIKE ${term} OR ${users.firstName} ILIKE ${term} OR ${users.lastName} ILIKE ${term})`
      );
    }

    const whereClause = conditions.length > 0 ? sql.join(conditions, sql` AND `) : undefined;

    const [totalResult] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(users)
      .where(whereClause);

    const query = this.db.select().from(users);
    const rows = whereClause
      ? await query.where(whereClause).limit(limit).offset(offset)
      : await query.limit(limit).offset(offset);

    return {
      items: rows.map(this.mapToEntity),
      total: Number(totalResult?.count ?? rows.length),
    };
  }

  public async listUsers(options?: {
    role?: UserRole;
    status?: AccountStatus;
    search?: string;
    limit?: number;
    offset?: number;
  }): Promise<{ items: UserEntity[]; total: number }> {
    return this.list(options);
  }

  private mapToEntity(row: typeof users.$inferSelect): UserEntity {
    return {
      id: row.id,
      email: row.email,
      passwordHash: row.passwordHash,
      firstName: row.firstName,
      lastName: row.lastName,
      role: row.role as UserRole,
      accountStatus: row.accountStatus as AccountStatus,
      emailVerified: row.emailVerified,
      mfaEnabled: row.mfaEnabled,
      failedLoginAttempts: row.failedLoginAttempts,
      lockoutUntil: row.lockoutUntil ? new Date(row.lockoutUntil) : null,
      lastLoginAt: row.lastLoginAt ? new Date(row.lastLoginAt) : null,
      tokenVersion: row.tokenVersion,
      createdAt: new Date(row.createdAt),
      updatedAt: new Date(row.updatedAt),
    };
  }
}
