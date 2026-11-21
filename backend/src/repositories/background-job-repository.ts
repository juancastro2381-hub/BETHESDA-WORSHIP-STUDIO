/**
 * @file background-job-repository.ts
 * @description Repositorio persistente para la orquestación y trazabilidad de tareas en segundo plano (Fase 1A).
 */

import { eq, desc } from 'drizzle-orm';
import { db as defaultDb, type Database } from '../db/index.ts';
import {
  backgroundJobs,
  type BackgroundJobRow,
  type NewBackgroundJobRow,
} from '../db/schema.ts';

export interface IBackgroundJobRepository {
  createJob(data: NewBackgroundJobRow): Promise<BackgroundJobRow>;
  findJobById(id: string): Promise<BackgroundJobRow | null>;
  findJobsByUserId(userId: string, limit?: number): Promise<BackgroundJobRow[]>;
  updateJobProgress(
    id: string,
    progress: number,
    status?: 'PENDING' | 'PROCESSING' | 'REVIEW_REQUIRED' | 'COMPLETED' | 'FAILED' | 'CANCELLED'
  ): Promise<void>;
  completeJob(id: string, outputRef?: string): Promise<void>;
  failJob(id: string, errorCode: string, details?: any): Promise<void>;
}

export class DrizzleBackgroundJobRepository implements IBackgroundJobRepository {
  public constructor(private readonly db: Database = defaultDb) {}

  public async createJob(data: NewBackgroundJobRow): Promise<BackgroundJobRow> {
    const [inserted] = await this.db.insert(backgroundJobs).values(data).returning();
    if (!inserted) {
      throw new Error('Fallo al registrar la tarea en segundo plano en la base de datos.');
    }
    return inserted;
  }

  public async findJobById(id: string): Promise<BackgroundJobRow | null> {
    const [found] = await this.db
      .select()
      .from(backgroundJobs)
      .where(eq(backgroundJobs.id, id))
      .limit(1);

    return found ?? null;
  }

  public async findJobsByUserId(userId: string, limit: number = 50): Promise<BackgroundJobRow[]> {
    return await this.db
      .select()
      .from(backgroundJobs)
      .where(eq(backgroundJobs.userId, userId))
      .orderBy(desc(backgroundJobs.createdAt))
      .limit(Math.min(100, Math.max(1, limit)));
  }

  public async updateJobProgress(
    id: string,
    progress: number,
    status?: 'PENDING' | 'PROCESSING' | 'REVIEW_REQUIRED' | 'COMPLETED' | 'FAILED' | 'CANCELLED'
  ): Promise<void> {
    const updates: Partial<NewBackgroundJobRow> = {
      progress: Math.min(100, Math.max(0, progress)),
      updatedAt: new Date(),
    };
    if (status) {
      updates.status = status;
      if (status === 'PROCESSING') {
        updates.startedAt = new Date();
      }
    }

    await this.db.update(backgroundJobs).set(updates).where(eq(backgroundJobs.id, id));
  }

  public async completeJob(id: string, outputRef?: string): Promise<void> {
    const now = new Date();
    await this.db
      .update(backgroundJobs)
      .set({
        status: 'COMPLETED',
        progress: 100,
        outputRef: outputRef ?? null,
        completedAt: now,
        updatedAt: now,
      })
      .where(eq(backgroundJobs.id, id));
  }

  public async failJob(id: string, errorCode: string, details?: any): Promise<void> {
    const now = new Date();
    await this.db
      .update(backgroundJobs)
      .set({
        status: 'FAILED',
        errorCode,
        errorDetails: details ?? {},
        completedAt: now,
        updatedAt: now,
      })
      .where(eq(backgroundJobs.id, id));
  }
}

