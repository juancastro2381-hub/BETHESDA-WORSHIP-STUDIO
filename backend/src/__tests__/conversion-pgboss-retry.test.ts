/**
 * @file conversion-pgboss-retry.test.ts
 * @description Suite de verificación de integración End-to-End para el ciclo de vida de reintentos
 * en pg-boss real y persistencia en PostgreSQL real (WS02).
 *
 * Valida:
 * 1. Adquisición autoritativa por worker real desde la cola pg-boss.
 * 2. Propagación de error transitorio (TransientWorkerError) hacia pg-boss y reset de arrendamiento en PostgreSQL.
 * 3. Reprogramación y redelivery automático gestionado por pg-boss según retryDelay y retryLimit.
 * 4. Segundo intento exitoso con incremento duradero de attempts y finalización a COMPLETED (100%).
 * 5. Agotamiento de reintentos cuando attempts >= maxAttempts, transición duradera a FAILED con código RETRIES_EXHAUSTED.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { db, pool } from '../db/index.ts';
import { backgroundJobs, users, songSources } from '../db/schema.ts';
import {
  ConversionWorker,
  TransientWorkerError,
} from '../application/conversion-worker.ts';
import {
  startConversionQueue,
  stopConversionQueue,
  enqueueConversionJob,
  type ConversionJobPayload,
} from '../infrastructure/queue/conversion-queue.ts';
import { LocalFileSystemSourceStorageProvider } from '../domain/ingestion/source-storage-provider.ts';
import type { AuthenticatedUser } from '../domain/auth-types.ts';

describe('WS02 — End-to-End pg-boss Real Retry & Lifecycle Verification Suite', { concurrency: 1 }, () => {
  const testUserId = '00000000-0000-0000-0000-000000000002';
  const testUser: AuthenticatedUser = {
    id: testUserId,
    email: 'pgboss-retry@bethesda.com',
    role: 'MUSICIAN',
  };

  let storage: LocalFileSystemSourceStorageProvider;
  let testStorageDir: string;
  const createdJobIds: string[] = [];

  before(async () => {
    testStorageDir = path.resolve(process.cwd(), 'storage/test-pgboss-retry');
    if (!fs.existsSync(testStorageDir)) {
      fs.mkdirSync(testStorageDir, { recursive: true });
    }
    storage = new LocalFileSystemSourceStorageProvider('storage/test-pgboss-retry');

    await db.insert(users).values({
      id: testUserId,
      email: 'pgboss-retry@bethesda.com',
      passwordHash: '$argon2id$v=19$m=65536,t=3,p=4$dummyhashpgboss',
      firstName: 'PGBoss',
      lastName: 'RetryTester',
      role: 'MUSICIAN',
      accountStatus: 'ACTIVE',
      emailVerified: true,
    }).onConflictDoNothing();

    // Iniciar la cola de pg-boss real
    await startConversionQueue();
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

  // Test 1: Falla transitoria en intento 1 -> pg-boss reintenta -> éxito en intento 2
  it('1. should acquire job from real pg-boss, handle transient failure, retry automatically, and succeed on attempt 2', async () => {
    const testContent = Buffer.from('{title: E2E Retry Test Song}\n[D]Alabanza y [A]gloria\n');
    const storageResult = await storage.save('retry_e2e_test.cho', testContent);

    // Crear trabajo en background_jobs con maxAttempts: 3
    const [job] = await db.insert(backgroundJobs).values({
      jobType: 'CONVERSION',
      status: 'PENDING',
      progress: 0,
      userId: testUserId,
      inputRef: 'retry_e2e_test.cho',
      attempts: 0,
      maxAttempts: 3,
      errorDetails: {
        storageKey: storageResult.storageKey,
        checksumSha256: storageResult.checksumSha256,
        targetFormat: 'LYRICS_ONLY',
      },
    }).returning();
    createdJobIds.push(job.id);

    let stageHits = 0;

    // Configurar worker real que falla intencionalmente de forma transitoria en intento 1
    const worker = new ConversionWorker(db, storage, undefined, 'worker-retry-test-1', {
      onStageReached: async (stage, reachedJobId) => {
        if (stage === 'STAGE_C' && reachedJobId === job.id) {
          stageHits++;
          if (stageHits === 1) {
            throw new TransientWorkerError('Simulación controlada: error transitorio de red en intento 1');
          }
        }
      },
    });

    await worker.start();

    const payload: ConversionJobPayload = {
      jobId: job.id,
      userId: testUserId,
      tenantId: 'bethesda-default',
      storageKey: storageResult.storageKey,
      checksumSha256: storageResult.checksumSha256,
      filename: 'retry_e2e_test.cho',
      targetFormat: 'LYRICS_ONLY',
    };

    // Encolar trabajo en pg-boss con retryDelay de 1 segundo
    await enqueueConversionJob(payload, {
      retryLimit: 2,
      retryDelay: 1,
      expireInSeconds: 30,
    });

    // Esperar a que pg-boss reintente y el worker procese hasta estado terminal (máx 12s)
    const startTime = Date.now();
    let finalJob: any = null;

    while (Date.now() - startTime < 12_000) {
      const [current] = await db.select().from(backgroundJobs).where(eq(backgroundJobs.id, job.id));
      if (current && (current.status === 'COMPLETED' || current.status === 'FAILED')) {
        finalJob = current;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    await worker.stop();

    assert.ok(finalJob, 'El trabajo debió alcanzar un estado terminal dentro del tiempo esperado');
    assert.strictEqual(finalJob.status, 'COMPLETED', 'El trabajo debió finalizar como COMPLETED tras el reintento exitoso');
    assert.strictEqual(finalJob.progress, 100, 'El progreso final debe ser 100');
    assert.strictEqual(finalJob.attempts, 2, 'Debe registrar exactamente 2 intentos');
    assert.strictEqual(stageHits, 2, 'La etapa C debió ser alcanzada dos veces (falla en intento 1, éxito en intento 2)');
    assert.strictEqual(finalJob.errorCode, null, 'No debe haber código de error tras finalización exitosa');
  });

  // Test 2: Falla transitoria repetida -> reintentos agotados -> estado duradero FAILED con RETRIES_EXHAUSTED
  it('2. should exhaust retries in real pg-boss and transition to durable FAILED state with RETRIES_EXHAUSTED', async () => {
    const testContent = Buffer.from('{title: E2E Exhaustion Test Song}\n[G]Santo [C]Dios\n');
    const storageResult = await storage.save('exhaust_e2e_test.cho', testContent);

    // Crear trabajo en background_jobs con maxAttempts: 2
    const [job] = await db.insert(backgroundJobs).values({
      jobType: 'CONVERSION',
      status: 'PENDING',
      progress: 0,
      userId: testUserId,
      inputRef: 'exhaust_e2e_test.cho',
      attempts: 0,
      maxAttempts: 2,
      errorDetails: {
        storageKey: storageResult.storageKey,
        checksumSha256: storageResult.checksumSha256,
        targetFormat: 'LYRICS_ONLY',
      },
    }).returning();
    createdJobIds.push(job.id);

    let stageHits = 0;

    // Configurar worker real que falla en todos los intentos
    const worker = new ConversionWorker(db, storage, undefined, 'worker-retry-exhaust-2', {
      onStageReached: async (stage, reachedJobId) => {
        if (stage === 'STAGE_C' && reachedJobId === job.id) {
          stageHits++;
          throw new TransientWorkerError(`Simulación controlada: error transitorio persistente en intento ${stageHits}`);
        }
      },
    });

    await worker.start();

    const payload: ConversionJobPayload = {
      jobId: job.id,
      userId: testUserId,
      tenantId: 'bethesda-default',
      storageKey: storageResult.storageKey,
      checksumSha256: storageResult.checksumSha256,
      filename: 'exhaust_e2e_test.cho',
      targetFormat: 'LYRICS_ONLY',
    };

    // Encolar con retryLimit: 2, retryDelay: 1s
    await enqueueConversionJob(payload, {
      retryLimit: 2,
      retryDelay: 1,
      expireInSeconds: 30,
    });

    // Esperar a que se agoten los intentos y alcance FAILED (máx 12s)
    const startTime = Date.now();
    let finalJob: any = null;

    while (Date.now() - startTime < 12_000) {
      const [current] = await db.select().from(backgroundJobs).where(eq(backgroundJobs.id, job.id));
      if (current && (current.status === 'COMPLETED' || current.status === 'FAILED')) {
        finalJob = current;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }

    await worker.stop();

    assert.ok(finalJob, 'El trabajo debió alcanzar un estado terminal dentro del tiempo esperado');
    assert.strictEqual(finalJob.status, 'FAILED', 'El trabajo debe transicionar a FAILED al agotar los intentos');
    assert.strictEqual(finalJob.errorCode, 'RETRIES_EXHAUSTED', 'El código de error debe ser RETRIES_EXHAUSTED');
    assert.strictEqual(finalJob.attempts, 2, 'Debe registrar 2 intentos ejecutados');
    assert.strictEqual(finalJob.progress, 100, 'El progreso terminal debe ser 100');
    assert.strictEqual(stageHits, 2, 'La etapa C debió ser alcanzada dos veces');
  });
});
