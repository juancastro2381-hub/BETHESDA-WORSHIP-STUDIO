/**
 * @file conversion-cancellation.test.ts
 * @description Suite de pruebas para cancelación efectiva y protección de estados terminales (CR-03).
 *
 * Cubre exhaustivamente los escenarios de auditoría A a I con concurrencia real y
 * actualización atómica condicional sin trucos manuales de sobreescritura SQL:
 * - Escenario A: Cancelación antes de adquisición (PENDING -> CANCELLED): worker no puede adquirir el trabajo.
 * - Escenario B: Cancelación en Etapa A (lectura/hash): verifyOwnershipAndActive retorna false.
 * - Escenario C: Cancelación en Etapa B (detección de formato): updateProgressFenced retorna false.
 * - Escenario D: Cancelación en Etapa C (transpilación): renewHeartbeat retorna false.
 * - Escenario E: Cancelación antes de finalización: la actualización terminal vallada falla en BD y el estado permanece CANCELLED.
 * - Escenario F: Protección terminal: trabajo COMPLETED no puede ser cancelado (ValidationError).
 * - Escenario G: Protección terminal: trabajo FAILED no puede ser cancelado (ValidationError).
 * - Escenario H: Cancelación redundante rechazada (ValidationError).
 * - Escenario I: Condición de carrera real: cancelación concurrente vs finalización del worker converge a un único estado terminal válido.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { and, eq } from 'drizzle-orm';
import { db, pool } from '../db/index.ts';
import { backgroundJobs, users, songSources } from '../db/schema.ts';
import { ConversionJobService } from '../application/conversion-job-service.ts';
import { ConversionWorker } from '../application/conversion-worker.ts';
import { stopConversionQueue, type ConversionJobPayload } from '../infrastructure/queue/conversion-queue.ts';
import { LocalFileSystemSourceStorageProvider } from '../domain/ingestion/source-storage-provider.ts';
import { ValidationError } from '../domain/errors.ts';
import type { AuthenticatedUser } from '../domain/auth-types.ts';

describe('CR-03 — Effective Cancellation and Terminal State Protection Suite (Scenarios A-I)', () => {
  const testUserId = '00000000-0000-0000-0000-000000000001';
  const testUser: AuthenticatedUser = {
    id: testUserId,
    email: 'canceller@bethesda.com',
    role: 'MUSICIAN',
  };

  let service: ConversionJobService;
  let storage: LocalFileSystemSourceStorageProvider;
  let testStorageDir: string;
  const createdJobIds: string[] = [];

  before(async () => {
    testStorageDir = path.resolve(process.cwd(), 'storage/test-cancellation');
    if (!fs.existsSync(testStorageDir)) {
      fs.mkdirSync(testStorageDir, { recursive: true });
    }
    storage = new LocalFileSystemSourceStorageProvider('storage/test-cancellation');
    service = new ConversionJobService(undefined, undefined, db, storage);

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
    if (fs.existsSync(testStorageDir)) {
      fs.rmSync(testStorageDir, { recursive: true, force: true });
    }
    await pool.end();
  });

  // Scenario A: Cancelación antes de adquisición
  it('Scenario A: should cancel a PENDING job and prevent worker acquisition', async () => {
    const [job] = await db.insert(backgroundJobs).values({
      jobType: 'CONVERSION',
      status: 'PENDING',
      progress: 0,
      userId: testUserId,
      inputRef: 'scenario_a.cho',
      attempts: 0,
    }).returning();
    createdJobIds.push(job.id);

    // Usuario cancela la tarea en cola antes de que cualquier worker la tome
    const cancelledJob = await service.cancelJob(job.id, testUser);
    assert.strictEqual(cancelledJob.status, 'CANCELLED');
    assert.strictEqual(cancelledJob.progress, 0);

    // Un worker que intente adquirir la tarea recibe null
    const worker = new ConversionWorker(db, undefined, undefined, 'worker-scenario-a');
    const token = crypto.randomUUID();
    const acquired = await worker.acquireJob(job.id, token);

    assert.strictEqual(acquired, null, 'Un trabajo CANCELLED jamás debe ser adquirido por un worker');

    // Verificar en BD que continúa en CANCELLED
    const [persisted] = await db.select().from(backgroundJobs).where(eq(backgroundJobs.id, job.id));
    assert.strictEqual(persisted.status, 'CANCELLED');
  });

  // Scenario B: Cancelación en Etapa A (lectura/hash)
  it('Scenario B: should detect cancellation during Stage A (ownership check fails)', async () => {
    const [job] = await db.insert(backgroundJobs).values({
      jobType: 'CONVERSION',
      status: 'PENDING',
      progress: 0,
      userId: testUserId,
      inputRef: 'scenario_b.cho',
      attempts: 0,
    }).returning();
    createdJobIds.push(job.id);

    const worker = new ConversionWorker(db, undefined, undefined, 'worker-scenario-b');
    const token = crypto.randomUUID();

    const acquired = await worker.acquireJob(job.id, token);
    assert.ok(acquired);
    assert.strictEqual(acquired.status, 'PROCESSING');

    // Cancelar concurrentemente
    await service.cancelJob(job.id, testUser);

    // En Etapa A, worker verifica propiedad
    const isOwnerAndActive = await worker.verifyOwnershipAndActive(job.id, token);
    assert.strictEqual(isOwnerAndActive, false, 'verifyOwnershipAndActive debe retornar false tras cancelación');
  });

  // Scenario C: Cancelación en Etapa B (detección de formato)
  it('Scenario C: should reject progress update during Stage B when cancelled', async () => {
    const [job] = await db.insert(backgroundJobs).values({
      jobType: 'CONVERSION',
      status: 'PENDING',
      progress: 0,
      userId: testUserId,
      inputRef: 'scenario_c.cho',
      attempts: 0,
    }).returning();
    createdJobIds.push(job.id);

    const worker = new ConversionWorker(db, undefined, undefined, 'worker-scenario-c');
    const token = crypto.randomUUID();

    await worker.acquireJob(job.id, token);
    await service.cancelJob(job.id, testUser);

    // Intento de actualizar progreso cercado
    const updated = await worker.updateProgressFenced(job.id, token, 50);
    assert.strictEqual(updated, false, 'updateProgressFenced debe retornar false porque el estado ya no es PROCESSING');
  });

  // Scenario D: Cancelación en Etapa C (transpilación musical)
  it('Scenario D: should reject heartbeat renewal during Stage C when cancelled', async () => {
    const [job] = await db.insert(backgroundJobs).values({
      jobType: 'CONVERSION',
      status: 'PENDING',
      progress: 0,
      userId: testUserId,
      inputRef: 'scenario_d.cho',
      attempts: 0,
    }).returning();
    createdJobIds.push(job.id);

    const worker = new ConversionWorker(db, undefined, undefined, 'worker-scenario-d');
    const token = crypto.randomUUID();

    await worker.acquireJob(job.id, token);
    await service.cancelJob(job.id, testUser);

    // Intento de renovar latido
    const renewed = await worker.renewHeartbeat(job.id, token);
    assert.strictEqual(renewed, false, 'renewHeartbeat debe retornar false tras cancelación');
  });

  // Scenario E: Cancelación antes de finalización (100% update)
  it('Scenario E: should fail atomic terminal update and preserve CANCELLED status when cancelled before finalization', async () => {
    const [job] = await db.insert(backgroundJobs).values({
      jobType: 'CONVERSION',
      status: 'PENDING',
      progress: 0,
      userId: testUserId,
      inputRef: 'scenario_e.cho',
      attempts: 0,
    }).returning();
    createdJobIds.push(job.id);

    const worker = new ConversionWorker(db, undefined, undefined, 'worker-scenario-e');
    const token = crypto.randomUUID();

    await worker.acquireJob(job.id, token);
    await service.cancelJob(job.id, testUser);

    // El worker intenta la actualización terminal atómica condicional a status = 'PROCESSING'
    const [finalizedJob] = await db
      .update(backgroundJobs)
      .set({
        status: 'COMPLETED',
        progress: 100,
        outputRef: 'storage/forbidden_overwrite.txt',
        completedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(backgroundJobs.id, job.id),
          eq(backgroundJobs.leaseToken, token),
          eq(backgroundJobs.status, 'PROCESSING')
        )
      )
      .returning({ id: backgroundJobs.id });

    assert.strictEqual(finalizedJob, undefined, 'La actualización terminal condicional DEBE fallar en PostgreSQL');

    // Confirmar que en base de datos el estado sigue siendo CANCELLED de forma inmutable
    const [persisted] = await db.select().from(backgroundJobs).where(eq(backgroundJobs.id, job.id));
    assert.strictEqual(persisted.status, 'CANCELLED');
    assert.notStrictEqual(persisted.progress, 100, 'El progreso jamás debe alcanzar 100 en un trabajo cancelado');
  });

  // Scenario F: Protección de estado terminal COMPLETED
  it('Scenario F: should reject cancellation of already COMPLETED job with ValidationError', async () => {
    const [job] = await db.insert(backgroundJobs).values({
      jobType: 'CONVERSION',
      status: 'COMPLETED',
      progress: 100,
      userId: testUserId,
      inputRef: 'scenario_f.cho',
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
    assert.strictEqual(persisted.status, 'COMPLETED');
  });

  // Scenario G: Protección de estado terminal FAILED
  it('Scenario G: should reject cancellation of already FAILED job with ValidationError', async () => {
    const [job] = await db.insert(backgroundJobs).values({
      jobType: 'CONVERSION',
      status: 'FAILED',
      progress: 100,
      userId: testUserId,
      inputRef: 'scenario_g.cho',
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

    const [persisted] = await db.select().from(backgroundJobs).where(eq(backgroundJobs.id, job.id));
    assert.strictEqual(persisted.status, 'FAILED');
  });

  // Scenario H: Cancelación redundante rechazada
  it('Scenario H: should reject redundant cancellation on already CANCELLED job', async () => {
    const [job] = await db.insert(backgroundJobs).values({
      jobType: 'CONVERSION',
      status: 'CANCELLED',
      progress: 0,
      userId: testUserId,
      inputRef: 'scenario_h.cho',
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

  // Scenario I: Condición de carrera real concurrente con barrera de sincronización en processJob (WS01)
  it('Scenario I: should safely resolve race condition between concurrent cancellation and worker finalization using real processJob and conditional SQL', async () => {
    const testContent = Buffer.from('{title: Concurrency Real Test}\n[G]Dios es [D]bueno\n[Em]para [C]siempre\n');
    const storageResult = await storage.save('scenario_i_real.cho', testContent);

    const [job] = await db.insert(backgroundJobs).values({
      jobType: 'CONVERSION',
      status: 'PENDING',
      progress: 0,
      userId: testUserId,
      inputRef: 'scenario_i_real.cho',
      attempts: 0,
      errorDetails: {
        storageKey: storageResult.storageKey,
        checksumSha256: storageResult.checksumSha256,
        targetFormat: 'LYRICS_ONLY',
      },
    }).returning();
    createdJobIds.push(job.id);

    let stageReachedCalled = false;
    let cancelJobResultStatus: string | null = null;

    // Configurar worker real con hook de sincronización en Stage D (justo antes de la actualización terminal en PostgreSQL)
    const worker = new ConversionWorker(db, storage, undefined, 'worker-scenario-i-real', {
      onStageReached: async (stage, reachedJobId) => {
        if (stage === 'STAGE_D' && reachedJobId === job.id) {
          stageReachedCalled = true;
          // Disparar concurrentemente la cancelación real en PostgreSQL a través de ConversionJobService
          const cancelled = await service.cancelJob(job.id, testUser);
          cancelJobResultStatus = cancelled.status;
        }
      },
    });

    const payload: ConversionJobPayload = {
      jobId: job.id,
      userId: testUserId,
      tenantId: 'bethesda-default',
      storageKey: storageResult.storageKey,
      checksumSha256: storageResult.checksumSha256,
      filename: 'scenario_i_real.cho',
      targetFormat: 'LYRICS_ONLY',
    };

    // Ejecutar el procesamiento real del worker
    const exportResult = await worker.processJob(payload);

    // 1. Verificar que el hook determinista fue activado
    assert.strictEqual(stageReachedCalled, true, 'El hook STAGE_D debió ser alcanzado antes de la finalización');
    assert.strictEqual(cancelJobResultStatus, 'CANCELLED', 'cancelJob debió haber transicionado exitosamente a CANCELLED');

    // 2. Verificar que processJob detectó la cancelación y abortó de forma segura
    assert.strictEqual(exportResult.success, false, 'processJob debió reportar aborto seguro');
    assert.strictEqual(
      exportResult.diagnostics[0]?.code,
      'JOB_CANCELLED_OR_LEASE_LOST',
      'El diagnóstico debe reflejar cancelación o pérdida de arrendamiento'
    );

    // 3. Verificar en la base de datos PostgreSQL real que el estado final permanece CANCELLED
    const [persisted] = await db.select().from(backgroundJobs).where(eq(backgroundJobs.id, job.id));
    assert.strictEqual(
      persisted.status,
      'CANCELLED',
      'El estado en PostgreSQL debe permanecer inmutablemente CANCELLED (no sobreescrito por COMPLETED)'
    );
    assert.notStrictEqual(
      persisted.progress,
      100,
      'El progreso jamás debe alcanzar el 100% en un trabajo cancelado'
    );
  });
});
