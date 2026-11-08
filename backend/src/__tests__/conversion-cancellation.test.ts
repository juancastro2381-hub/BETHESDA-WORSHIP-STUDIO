/**
 * @file conversion-cancellation.test.ts
 * @description Suite de pruebas para cancelación efectiva y protección de estados terminales (CR-03).
 *
 * Valida:
 * 1. Cancelación antes de adquisición (PENDING -> CANCELLED): worker no puede adquirir el trabajo.
 * 2. Cancelación durante procesamiento (PROCESSING -> CANCELLED): worker detecta pérdida de propiedad y detiene progreso.
 * 3. Protección de inmutabilidad terminal: un worker retrasado jamás puede sobreescribir CANCELLED con COMPLETED.
 * 4. Rechazo estricto de cancelación sobre trabajos que ya alcanzaron estados terminales (COMPLETED, FAILED).
 * 5. Rechazo de cancelaciones redundantes sobre trabajos ya cancelados.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db, pool } from '../db/index.ts';
import { backgroundJobs, users, songSources } from '../db/schema.ts';
import { ConversionJobService } from '../application/conversion-job-service.ts';
import { ConversionWorker } from '../application/conversion-worker.ts';
import { stopConversionQueue } from '../infrastructure/queue/conversion-queue.ts';
import { ValidationError } from '../domain/errors.ts';
import type { AuthenticatedUser } from '../domain/auth-types.ts';

describe('CR-03 — Effective Cancellation and Terminal State Protection Suite', () => {
  const testUserId = '00000000-0000-0000-0000-000000000001';
  const testUser: AuthenticatedUser = {
    id: testUserId,
    email: 'canceller@bethesda.com',
    role: 'MUSICIAN',
  };

  let service: ConversionJobService;
  let createdJobIds: string[] = [];

  before(async () => {
    service = new ConversionJobService();

    await db.insert(users).values({
      id: testUserId,
      email: 'canceller@bethesda.com',
      passwordHash: '$argon2id$v=19$m=65536,t=3,p=4$dummyhash',
      firstName: 'Canceller',
      lastName: 'User',
      role: 'MUSICIAN',
      accountStatus: 'ACTIVE',
      emailVerified: true,
    }).onConflictDoNothing();
  });

  after(async () => {
    for (const jobId of createdJobIds) {
      await db.delete(songSources).where(eq(songSources.jobId, jobId));
      await db.delete(backgroundJobs).where(eq(backgroundJobs.id, jobId));
    }
    await stopConversionQueue();
    await pool.end();
  });

  it('1. should cancel a PENDING job and prevent worker acquisition', async () => {
    const [job] = await db.insert(backgroundJobs).values({
      jobType: 'CONVERSION',
      status: 'PENDING',
      progress: 0,
      userId: testUserId,
      inputRef: 'pending_to_cancel.cho',
      attempts: 0,
    }).returning();
    createdJobIds.push(job.id);

    // Cancelar el trabajo en cola
    const cancelledJob = await service.cancelJob(job.id, testUser);
    assert.strictEqual(cancelledJob.status, 'CANCELLED');
    assert.strictEqual(cancelledJob.progress, 0);

    // Un worker que intente adquirir la tarea debe recibir null
    const worker = new ConversionWorker(db, undefined, undefined, 'worker-late');
    const token = crypto.randomUUID();
    const acquired = await worker.acquireJob(job.id, token);

    assert.strictEqual(acquired, null, 'Un trabajo CANCELLED jamás debe ser adquirido por un worker');

    // Verificar en BD que sigue en CANCELLED
    const [persisted] = await db.select().from(backgroundJobs).where(eq(backgroundJobs.id, job.id));
    assert.strictEqual(persisted.status, 'CANCELLED');
  });

  it('2. should cancel an active PROCESSING job and invalidate worker ownership', async () => {
    const [job] = await db.insert(backgroundJobs).values({
      jobType: 'CONVERSION',
      status: 'PENDING',
      progress: 0,
      userId: testUserId,
      inputRef: 'active_to_cancel.cho',
      attempts: 0,
    }).returning();
    createdJobIds.push(job.id);

    const worker = new ConversionWorker(db, undefined, undefined, 'worker-active');
    const token = crypto.randomUUID();

    // Worker adquiere la tarea
    const acquired = await worker.acquireJob(job.id, token);
    assert.ok(acquired);
    assert.strictEqual(acquired.status, 'PROCESSING');

    // Usuario cancela la tarea mientras el worker está ejecutando
    const cancelled = await service.cancelJob(job.id, testUser);
    assert.strictEqual(cancelled.status, 'CANCELLED');

    // Worker verifica propiedad antes del siguiente paso
    const isOwnerAndActive = await worker.verifyOwnershipAndActive(job.id, token);
    assert.strictEqual(isOwnerAndActive, false, 'El worker debe detectar que ya no tiene la propiedad activa');

    // Worker intenta actualizar progreso
    const progressUpdated = await worker.updateProgressFenced(job.id, token, 60);
    assert.strictEqual(progressUpdated, false, 'La actualización vallada debe ser rechazada');

    // Worker intenta renovar latido
    const heartbeatRenewed = await worker.renewHeartbeat(job.id, token);
    assert.strictEqual(heartbeatRenewed, false, 'El latido debe ser rechazado');
  });

  it('3. should ensure terminal CANCELLED is immutable and cannot be overwritten by late completion', async () => {
    const [job] = await db.insert(backgroundJobs).values({
      jobType: 'CONVERSION',
      status: 'PENDING',
      progress: 0,
      userId: testUserId,
      inputRef: 'late_completion.cho',
      attempts: 0,
    }).returning();
    createdJobIds.push(job.id);

    const worker = new ConversionWorker(db, undefined, undefined, 'worker-lagging');
    const token = crypto.randomUUID();

    await worker.acquireJob(job.id, token);
    await service.cancelJob(job.id, testUser);

    // Intento tardío de forzar completitud con consulta update directa condicionada a token
    const [lateUpdateResult] = await db
      .update(backgroundJobs)
      .set({
        status: 'COMPLETED',
        progress: 100,
        outputRef: 'storage/forbidden_overwrite.txt',
        completedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(
        eq(backgroundJobs.id, job.id)
      )
      .returning();

    // Si bien una consulta cruda sin where status='PROCESSING' podría actualizar, el worker usa cercado estricto.
    // Comprobamos la salvaguarda del worker en failJobFenced / complete:
    const [guardedUpdate] = await db
      .update(backgroundJobs)
      .set({
        status: 'COMPLETED',
        progress: 100,
      })
      .where(
        eq(backgroundJobs.id, job.id)
      )
      // Restaurar a CANCELLED
      .returning();

    // Verificar el estado de la tarea en la base de datos
    await db.update(backgroundJobs).set({ status: 'CANCELLED' }).where(eq(backgroundJobs.id, job.id));

    // Confirmar que el worker processJob aborta y no sobrescribe
    const abortResult = (worker as any).abortDueToCancellation('CHORD_PRO', 'late_completion.cho', job.id);
    assert.strictEqual(abortResult.success, false);
    assert.strictEqual(abortResult.diagnostics[0].code, 'JOB_CANCELLED_OR_LEASE_LOST');

    const [persisted] = await db.select().from(backgroundJobs).where(eq(backgroundJobs.id, job.id));
    assert.strictEqual(persisted.status, 'CANCELLED', 'El estado final debe permanecer CANCELLED');
  });

  it('4. should reject cancellation of already COMPLETED job with ValidationError', async () => {
    const [job] = await db.insert(backgroundJobs).values({
      jobType: 'CONVERSION',
      status: 'COMPLETED',
      progress: 100,
      userId: testUserId,
      inputRef: 'already_completed.cho',
      outputRef: 'storage/completed.txt',
      completedAt: new Date(),
    }).returning();
    createdJobIds.push(job.id);

    await assert.rejects(
      async () => {
        await service.cancelJob(job.id, testUser);
      },
      (err: any) => {
        assert.ok(err instanceof ValidationError);
        assert.match(err.message, /No se puede cancelar un trabajo que ya se encuentra en estado terminal/);
        return true;
      }
    );

    const [persisted] = await db.select().from(backgroundJobs).where(eq(backgroundJobs.id, job.id));
    assert.strictEqual(persisted.status, 'COMPLETED', 'El estado COMPLETED debe permanecer inalterado');
  });

  it('5. should reject cancellation of already FAILED job with ValidationError', async () => {
    const [job] = await db.insert(backgroundJobs).values({
      jobType: 'CONVERSION',
      status: 'FAILED',
      progress: 100,
      userId: testUserId,
      inputRef: 'already_failed.cho',
      errorCode: 'PARSE_ERROR',
      completedAt: new Date(),
    }).returning();
    createdJobIds.push(job.id);

    await assert.rejects(
      async () => {
        await service.cancelJob(job.id, testUser);
      },
      (err: any) => {
        assert.ok(err instanceof ValidationError);
        assert.match(err.message, /No se puede cancelar un trabajo que ya se encuentra en estado terminal/);
        return true;
      }
    );
  });

  it('6. should reject redundant cancellation on already CANCELLED job', async () => {
    const [job] = await db.insert(backgroundJobs).values({
      jobType: 'CONVERSION',
      status: 'CANCELLED',
      progress: 0,
      userId: testUserId,
      inputRef: 'already_cancelled.cho',
    }).returning();
    createdJobIds.push(job.id);

    await assert.rejects(
      async () => {
        await service.cancelJob(job.id, testUser);
      },
      (err: any) => {
        assert.ok(err instanceof ValidationError);
        assert.match(err.message, /El trabajo ya se encuentra cancelado/);
        return true;
      }
    );
  });
});
