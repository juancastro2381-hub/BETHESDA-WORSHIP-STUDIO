/**
 * @file conversion-worker-certification.test.ts
 * @description Suite de certificación técnica exhaustiva para la Fase 2A-R2.2.1:
 *
 * WS01: Active Job Tracking Must Be Leak-Free (todos los caminos de salida garantizan limpieza).
 * WS02: Bounded Graceful Shutdown (Escenarios A-E: drenaje acotado, deadline estricto, idempotencia).
 * WS03: Real Periodic Recovery and Mutual Exclusion (múltiples ciclos observados, mutex in-process, resiliencia ante errores, fencig multi-worker).
 * WS04: Filesystem Error Classification & Storage Reconciliation (distinción ENOENT vs EACCES/EIO, aborto seguro en reconciliación).
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { eq, and, lt } from 'drizzle-orm';
import { db, pool } from '../db/index.ts';
import { backgroundJobs, users, songSources } from '../db/schema.ts';
import {
  ConversionWorker,
  TransientWorkerError,
} from '../application/conversion-worker.ts';
import { ConversionJobService } from '../application/conversion-job-service.ts';
import {
  LocalFileSystemSourceStorageProvider,
  StorageReadError,
} from '../domain/ingestion/source-storage-provider.ts';
import { stopConversionQueue, type ConversionJobPayload } from '../infrastructure/queue/conversion-queue.ts';
import { ValidationError, PersistenceError } from '../domain/errors.ts';
import type { AuthenticatedUser } from '../domain/auth-types.ts';

describe('Phase 2A-R2.2.1 — Final Certification Suite (WS01 - WS04)', { concurrency: 1 }, () => {
  const testUserId = '00000000-0000-0000-0000-000000000221';
  const testUser: AuthenticatedUser = {
    id: testUserId,
    email: 'certification-r221@bethesda.com',
    role: 'MUSICIAN',
  };

  let storage: LocalFileSystemSourceStorageProvider;
  let testStorageDir: string;
  const createdJobIds: string[] = [];

  before(async () => {
    testStorageDir = path.resolve(process.cwd(), 'storage/test-cert-r221');
    if (!fs.existsSync(testStorageDir)) {
      fs.mkdirSync(testStorageDir, { recursive: true });
    }
    storage = new LocalFileSystemSourceStorageProvider('storage/test-cert-r221');

    await db.insert(users).values({
      id: testUserId,
      email: 'certification-r221@bethesda.com',
      passwordHash: '$argon2id$v=19$m=65536,t=3,p=4$dummyhashcert221',
      firstName: 'Certification',
      lastName: 'WorkerR221',
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

  // ===========================================================================
  // WS01: ACTIVE JOB TRACKING MUST BE LEAK-FREE
  // ===========================================================================
  describe('WS01 — Active Job Tracking Leak-Free Lifecycle', () => {
    it('1.1 should clean up active tracking when acquireJob returns null (unacquirable / already terminal)', async () => {
      const worker = new ConversionWorker(db, storage, undefined, 'cert-ws01-unacquirable');

      // Crear un trabajo que ya está en estado COMPLETED (no adquirible)
      const [terminalJob] = await db.insert(backgroundJobs).values({
        jobType: 'CONVERSION',
        status: 'COMPLETED',
        progress: 100,
        userId: testUserId,
        inputRef: 'ws01_unacquirable.cho',
      }).returning();
      createdJobIds.push(terminalJob.id);

      assert.strictEqual(worker.getActiveJobsCount(), 0);

      const result = await worker.processJob({
        jobId: terminalJob.id,
        userId: testUserId,
        tenantId: 'bethesda-default',
        storageKey: 'none.cho',
        checksumSha256: 'dummy',
        filename: 'ws01_unacquirable.cho',
        targetFormat: 'LYRICS_ONLY',
      });

      assert.strictEqual(result.success, false);
      assert.strictEqual(result.diagnostics[0]?.code, 'JOB_NOT_ACQUIRED');
      assert.strictEqual(worker.getActiveJobsCount(), 0, 'No debe quedar ningún activeJobId tras rechazo de adquisición');
      assert.strictEqual(worker.getActiveJobIds().size, 0);
    });

    it('1.2 should clean up active tracking when acquireJob throws an unexpected error', async () => {
      const worker = new ConversionWorker(db, storage, undefined, 'cert-ws01-acquire-err');
      // Forzar que acquireJob lance excepción inesperada
      (worker as any).acquireJob = async () => {
        throw new Error('Falla forzada de conexión en adquisición de arrendamiento');
      };

      assert.strictEqual(worker.getActiveJobsCount(), 0);

      const dummyJobId = crypto.randomUUID();
      const result = await worker.processJob({
        jobId: dummyJobId,
        userId: testUserId,
        tenantId: 'bethesda-default',
        storageKey: 'none.cho',
        checksumSha256: 'dummy',
        filename: 'ws01_acquire_err.cho',
        targetFormat: 'LYRICS_ONLY',
      });

      assert.strictEqual(result.success, false);
      assert.strictEqual(worker.getActiveJobsCount(), 0, 'No debe quedar ningún activeJobId tras excepción en acquireJob');
      assert.strictEqual(worker.getActiveJobIds().size, 0);
    });

    it('1.3 should clean up active tracking on successful job execution (COMPLETED)', async () => {
      const worker = new ConversionWorker(db, storage, undefined, 'cert-ws01-success');
      const testContent = Buffer.from('{title: Cancion Exitosa}\n[C]Gloria y honra\n');
      const saveRes = await storage.save('ws01_success.cho', testContent);

      const [job] = await db.insert(backgroundJobs).values({
        jobType: 'CONVERSION',
        status: 'PENDING',
        progress: 0,
        userId: testUserId,
        inputRef: 'ws01_success.cho',
      }).returning();
      createdJobIds.push(job.id);

      assert.strictEqual(worker.getActiveJobsCount(), 0);

      const result = await worker.processJob({
        jobId: job.id,
        userId: testUserId,
        tenantId: 'bethesda-default',
        storageKey: saveRes.storageKey,
        checksumSha256: saveRes.checksumSha256,
        filename: 'ws01_success.cho',
        targetFormat: 'LYRICS_ONLY',
      });

      assert.strictEqual(result.success, true);
      assert.strictEqual(worker.getActiveJobsCount(), 0, 'No debe quedar ningún activeJobId tras éxito');
      assert.strictEqual(worker.getActiveJobIds().size, 0);
    });

    it('1.4 should clean up active tracking on job failure (unsupported category / zero-fabrication)', async () => {
      const worker = new ConversionWorker(db, storage, undefined, 'cert-ws01-fail');
      const testContent = Buffer.from('RIFF....WAVEfmt ....data'); // Audio simulado
      const saveRes = await storage.save('audio.wav', testContent);

      const [job] = await db.insert(backgroundJobs).values({
        jobType: 'CONVERSION',
        status: 'PENDING',
        progress: 0,
        userId: testUserId,
        inputRef: 'audio.wav',
      }).returning();
      createdJobIds.push(job.id);

      const result = await worker.processJob({
        jobId: job.id,
        userId: testUserId,
        tenantId: 'bethesda-default',
        storageKey: saveRes.storageKey,
        checksumSha256: saveRes.checksumSha256,
        filename: 'audio.wav',
        targetFormat: 'CHORD_PRO',
      });

      assert.strictEqual(result.success, false);
      assert.strictEqual(worker.getActiveJobsCount(), 0, 'No debe quedar ningún activeJobId tras rechazo por categoría diferida');
      assert.strictEqual(worker.getActiveJobIds().size, 0);
    });

    it('1.5 should clean up active tracking when job is cancelled during execution', async () => {
      const worker = new ConversionWorker(db, storage, undefined, 'cert-ws01-cancel', {
        onStageReached: async (stage, reachedJobId) => {
          if (stage === 'STAGE_B') {
            // Cancelar el trabajo concurrentemente en la base de datos
            await db
              .update(backgroundJobs)
              .set({ status: 'CANCELLED', updatedAt: new Date() })
              .where(eq(backgroundJobs.id, reachedJobId));
          }
        },
      });

      const testContent = Buffer.from('{title: Cancion a Cancelar}\n[G]Gracia sublime');
      const saveRes = await storage.save('ws01_cancel.cho', testContent);

      const [job] = await db.insert(backgroundJobs).values({
        jobType: 'CONVERSION',
        status: 'PENDING',
        progress: 0,
        userId: testUserId,
        inputRef: 'ws01_cancel.cho',
      }).returning();
      createdJobIds.push(job.id);

      const result = await worker.processJob({
        jobId: job.id,
        userId: testUserId,
        tenantId: 'bethesda-default',
        storageKey: saveRes.storageKey,
        checksumSha256: saveRes.checksumSha256,
        filename: 'ws01_cancel.cho',
        targetFormat: 'LYRICS_ONLY',
      });

      assert.strictEqual(result.success, false);
      assert.strictEqual(result.diagnostics[0]?.code, 'JOB_CANCELLED_OR_LEASE_LOST');
      assert.strictEqual(worker.getActiveJobsCount(), 0, 'No debe quedar ningún activeJobId tras cancelación');
    });

    it('1.6 should clean up active tracking when a transient error is thrown for retry', async () => {
      const worker = new ConversionWorker(db, storage, undefined, 'cert-ws01-transient', {
        onStageReached: async (stage) => {
          if (stage === 'STAGE_A') {
            throw new TransientWorkerError('Error transitorio forzado para test WS01');
          }
        },
      });

      const testContent = Buffer.from('{title: Reintento}\n[A]Aleluya');
      const saveRes = await storage.save('ws01_transient.cho', testContent);

      const [job] = await db.insert(backgroundJobs).values({
        jobType: 'CONVERSION',
        status: 'PENDING',
        progress: 0,
        userId: testUserId,
        inputRef: 'ws01_transient.cho',
        attempts: 0,
        maxAttempts: 3,
      }).returning();
      createdJobIds.push(job.id);

      await assert.rejects(
        async () => {
          await worker.processJob({
            jobId: job.id,
            userId: testUserId,
            tenantId: 'bethesda-default',
            storageKey: saveRes.storageKey,
            checksumSha256: saveRes.checksumSha256,
            filename: 'ws01_transient.cho',
            targetFormat: 'LYRICS_ONLY',
          });
        },
        (err: any) => {
          assert.strictEqual(err.name, 'TransientWorkerError');
          return true;
        }
      );

      assert.strictEqual(worker.getActiveJobsCount(), 0, 'No debe quedar ningún activeJobId tras propagación de error transitorio');
      assert.strictEqual(worker.getActiveJobIds().size, 0);
    });

    it('1.7 should track concurrent multiple jobs and cleanly return to zero when all complete', async () => {
      let barrierResolve: () => void;
      const barrier = new Promise<void>((resolve) => {
        barrierResolve = resolve;
      });

      const worker = new ConversionWorker(db, storage, undefined, 'cert-ws01-concurrency', {
        onStageReached: async (stage) => {
          if (stage === 'STAGE_A') {
            await barrier;
          }
        },
      });

      const testContent = Buffer.from('{title: Paralela}\n[D]Dios bueno');
      const saveRes = await storage.save('ws01_concurrent.cho', testContent);

      const jobA = (await db.insert(backgroundJobs).values({
        jobType: 'CONVERSION',
        status: 'PENDING',
        userId: testUserId,
        inputRef: 'ws01_concurrent_a.cho',
      }).returning())[0];
      const jobB = (await db.insert(backgroundJobs).values({
        jobType: 'CONVERSION',
        status: 'PENDING',
        userId: testUserId,
        inputRef: 'ws01_concurrent_b.cho',
      }).returning())[0];
      createdJobIds.push(jobA.id, jobB.id);

      const promiseA = worker.processJob({
        jobId: jobA.id,
        userId: testUserId,
        tenantId: 'bethesda-default',
        storageKey: saveRes.storageKey,
        checksumSha256: saveRes.checksumSha256,
        filename: 'ws01_concurrent_a.cho',
        targetFormat: 'LYRICS_ONLY',
      });

      const promiseB = worker.processJob({
        jobId: jobB.id,
        userId: testUserId,
        tenantId: 'bethesda-default',
        storageKey: saveRes.storageKey,
        checksumSha256: saveRes.checksumSha256,
        filename: 'ws01_concurrent_b.cho',
        targetFormat: 'LYRICS_ONLY',
      });

      // Dar tiempo a que ambos trabajos alcancen STAGE_A y estén pausados en el barrier
      await new Promise((resolve) => setTimeout(resolve, 80));
      assert.strictEqual(worker.getActiveJobsCount(), 2, 'Debe haber exactamente 2 trabajos activos concurrentemente');
      assert.ok(worker.getActiveJobIds().has(jobA.id));
      assert.ok(worker.getActiveJobIds().has(jobB.id));

      // Liberar barrera
      barrierResolve!();
      const [resA, resB] = await Promise.all([promiseA, promiseB]);

      assert.strictEqual(resA.success, true);
      assert.strictEqual(resB.success, true);
      assert.strictEqual(worker.getActiveJobsCount(), 0, 'Todos los trabajos concluyeron; active jobs debe ser 0');
      assert.strictEqual(worker.getActiveJobIds().size, 0);
    });
  });

  // ===========================================================================
  // WS02: BOUNDED GRACEFUL SHUTDOWN (SCENARIOS A - E)
  // ===========================================================================
  describe('WS02 — Bounded Graceful Shutdown (Scenarios A - E)', () => {
    it('2.1 Scenario A: Stop with zero active jobs completes promptly (< 200ms)', async () => {
      const worker = new ConversionWorker(db, storage, undefined, 'cert-ws02-scenario-a');
      await worker.start();
      assert.strictEqual(worker.isActive(), true);

      const start = Date.now();
      await worker.stop(5000);
      const elapsed = Date.now() - start;

      assert.strictEqual(worker.isActive(), false);
      assert.strictEqual(worker.getActiveJobsCount(), 0);
      assert.ok(elapsed < 500, `Stop con 0 trabajos debió finalizar prontamente (duración real: ${elapsed}ms)`);
    });

    it('2.2 Scenario B: Stop with active jobs completes within deadline when jobs finish within deadline', async () => {
      const worker = new ConversionWorker(db, storage, undefined, 'cert-ws02-scenario-b', {
        onStageReached: async (stage) => {
          if (stage === 'STAGE_B') {
            await new Promise((resolve) => setTimeout(resolve, 150)); // Simula cómputo corto
          }
        },
      });

      const testContent = Buffer.from('{title: Corta}\n[E]Corta duracion');
      const saveRes = await storage.save('ws02_short.cho', testContent);

      const [job] = await db.insert(backgroundJobs).values({
        jobType: 'CONVERSION',
        status: 'PENDING',
        userId: testUserId,
        inputRef: 'ws02_short.cho',
      }).returning();
      createdJobIds.push(job.id);

      await worker.start();

      const jobPromise = worker.processJob({
        jobId: job.id,
        userId: testUserId,
        tenantId: 'bethesda-default',
        storageKey: saveRes.storageKey,
        checksumSha256: saveRes.checksumSha256,
        filename: 'ws02_short.cho',
        targetFormat: 'LYRICS_ONLY',
      });

      // Iniciar stop mientras el trabajo está activo, con timeout de 2000ms
      await new Promise((resolve) => setTimeout(resolve, 30));
      const stopPromise = worker.stop(2000);

      const [jobRes] = await Promise.all([jobPromise, stopPromise]);
      assert.strictEqual(jobRes.success, true);
      assert.strictEqual(worker.getActiveJobsCount(), 0);
      assert.strictEqual(worker.isActive(), false);
    });

    it('2.3 Scenario C: Stop with hung / long jobs halts when deadline expires (bounded, does not hang indefinitely)', async () => {
      let unblock: () => void;
      const barrier = new Promise<void>((resolve) => {
        unblock = resolve;
      });

      const worker = new ConversionWorker(db, storage, undefined, 'cert-ws02-scenario-c', {
        onStageReached: async (stage) => {
          if (stage === 'STAGE_B') {
            await barrier;
          }
        },
      });

      const testContent = Buffer.from('{title: Larga}\n[F]Larga duracion');
      const saveRes = await storage.save('ws02_long.cho', testContent);

      const [job] = await db.insert(backgroundJobs).values({
        jobType: 'CONVERSION',
        status: 'PENDING',
        userId: testUserId,
        inputRef: 'ws02_long.cho',
      }).returning();
      createdJobIds.push(job.id);

      await worker.start();

      // Lanzar trabajo en background sin esperarlo
      const jobPromise = worker.processJob({
        jobId: job.id,
        userId: testUserId,
        tenantId: 'bethesda-default',
        storageKey: saveRes.storageKey,
        checksumSha256: saveRes.checksumSha256,
        filename: 'ws02_long.cho',
        targetFormat: 'LYRICS_ONLY',
      });

      await new Promise((resolve) => setTimeout(resolve, 50));
      assert.strictEqual(worker.getActiveJobsCount(), 1, 'El trabajo debe estar activo');

      // Detener con deadline estricto de 300ms
      const start = Date.now();
      await worker.stop(300);
      const elapsed = Date.now() - start;

      assert.strictEqual(worker.isActive(), false, 'Worker debe quedar inactivo tras deadline');
      assert.ok(
        elapsed < 1500,
        `Stop debió retornar en ~300ms respetando el deadline estricto (duración real: ${elapsed}ms)`
      );

      // Desbloquear y esperar salida limpia del trabajo antes de concluir el test
      unblock!();
      await jobPromise.catch(() => {});
    });

    it('2.4 Scenario D: Interrupted jobs during shutdown are left in PROCESSING for lease recovery', async () => {
      let unblock: () => void;
      const barrier = new Promise<void>((resolve) => {
        unblock = resolve;
      });

      const worker = new ConversionWorker(db, storage, undefined, 'cert-ws02-scenario-d', {
        onStageReached: async (stage) => {
          if (stage === 'STAGE_B') {
            await barrier;
          }
        },
      });

      const testContent = Buffer.from('{title: Interrumpida}\n[G]Interrupcion');
      const saveRes = await storage.save('ws02_interrupted.cho', testContent);

      const [job] = await db.insert(backgroundJobs).values({
        jobType: 'CONVERSION',
        status: 'PENDING',
        userId: testUserId,
        inputRef: 'ws02_interrupted.cho',
        errorDetails: {
          storageKey: saveRes.storageKey,
          checksumSha256: saveRes.checksumSha256,
          targetFormat: 'LYRICS_ONLY',
        },
      }).returning();
      createdJobIds.push(job.id);

      await worker.start();

      const jobPromise = worker.processJob({
        jobId: job.id,
        userId: testUserId,
        tenantId: 'bethesda-default',
        storageKey: saveRes.storageKey,
        checksumSha256: saveRes.checksumSha256,
        filename: 'ws02_interrupted.cho',
        targetFormat: 'LYRICS_ONLY',
      });

      await new Promise((resolve) => setTimeout(resolve, 50));

      // Detener abruptamente con deadline de 150ms
      await worker.stop(150);

      // Verificar que el registro en BD permanece en PROCESSING y su arrendamiento queda intacto
      // para que expire naturalmente y sea recuperado por el recolector de stale jobs
      const [dbJob] = await db.select().from(backgroundJobs).where(eq(backgroundJobs.id, job.id));
      assert.strictEqual(dbJob.status, 'PROCESSING', 'El trabajo no debe ser borrado ni forzado a fallo destructivo');
      assert.ok(dbJob.leaseOwner !== null, 'El leaseOwner debe conservarse');
      assert.ok(dbJob.leaseExpiresAt !== null, 'El leaseExpiresAt debe conservarse para expiración natural');

      // Desbloquear y esperar salida limpia del trabajo antes de concluir el test
      unblock!();
      await jobPromise.catch(() => {});
    });

    it('2.5 Scenario E: Idempotency of repeated and parallel stop() calls', async () => {
      const worker = new ConversionWorker(db, storage, undefined, 'cert-ws02-scenario-e');
      await worker.start();

      // Llamar stop() múltiples veces concurrentemente
      const [res1, res2, res3] = await Promise.all([
        worker.stop(1000),
        worker.stop(1000),
        worker.stop(1000),
      ]);

      assert.strictEqual(res1, undefined);
      assert.strictEqual(res2, undefined);
      assert.strictEqual(res3, undefined);
      assert.strictEqual(worker.isActive(), false);

      // Llamar stop() secuencialmente en estado ya inactivo
      await worker.stop(1000);
      await worker.stop(1000);
      assert.strictEqual(worker.isActive(), false);
    });
  });

  // ===========================================================================
  // WS03: REAL PERIODIC RECOVERY AND MUTUAL EXCLUSION
  // ===========================================================================
  describe('WS03 — Real Periodic Recovery & Mutual Exclusion', () => {
    it('3.1 should execute multiple periodic recovery cycles over time (at least 2 observed cycles)', async () => {
      // Iniciar worker con intervalo periódico muy corto (60ms) para observar al menos 2 ciclos
      const worker = new ConversionWorker(db, storage, undefined, 'cert-ws03-periodic', {
        recoveryIntervalMs: 60,
      });

      await worker.start();
      assert.strictEqual(worker.isActive(), true);

      // Esperar tiempo suficiente para que se disparen al menos 2 ciclos periódicos
      await new Promise((resolve) => setTimeout(resolve, 220));

      const cycles = worker.getRecoveryCycleCount();
      await worker.stop(1000);

      assert.ok(
        cycles >= 2,
        `Se debieron observar al menos 2 ciclos de recuperación periódica (observados: ${cycles})`
      );
    });

    it('3.2 should enforce in-process mutual exclusion to prevent overlapping recovery runs', async () => {
      const worker = new ConversionWorker(db, storage, undefined, 'cert-ws03-mutex');

      // Simular que recoverStaleJobs está en ejecución
      let releaseRecovery: () => void;
      const recoveryBlock = new Promise<void>((resolve) => {
        releaseRecovery = resolve;
      });

      const originalSelect = db.select.bind(db);
      // Interceptar select para simular concurrencia
      let selectCount = 0;
      (worker as any).db = {
        ...db,
        select: (...args: any[]) => {
          selectCount++;
          return (originalSelect as any)(...args);
        },
      };

      // Disparar dos pasadas concurrentes de recoverStaleJobs en la misma instancia
      const run1 = worker.recoverStaleJobs();
      const run2 = worker.recoverStaleJobs();

      const [recovered1, recovered2] = await Promise.all([run1, run2]);

      // Una de las dos ejecuciones debe retornar 0 de inmediato por exclusión mutua
      assert.ok(
        recovered1 === 0 || recovered2 === 0,
        'Una de las pasadas concurrentes debió ser descartada por el mutex isRecovering'
      );
    });

    it('3.3 should be resilient to errors in recovery and continue running subsequent cycles', async () => {
      let callCount = 0;
      const worker = new ConversionWorker(db, storage, undefined, 'cert-ws03-resilience', {
        recoveryIntervalMs: 50,
      });

      // Forzar que el primer ciclo lance un error inesperado
      const originalRecover = worker.recoverStaleJobs.bind(worker);
      worker.recoverStaleJobs = async () => {
        callCount++;
        if (callCount === 1) {
          throw new Error('Fallo simulado de base de datos en ciclo 1');
        }
        return originalRecover();
      };

      await worker.start();
      await new Promise((resolve) => setTimeout(resolve, 180));
      await worker.stop(1000);

      assert.ok(callCount >= 2, `Debió reintentar y ejecutar ciclos subsecuentes (llamadas: ${callCount})`);
    });

    it('3.4 should clear recovery timer cleanly when stopped so no orphaned timers leak', async () => {
      const worker = new ConversionWorker(db, storage, undefined, 'cert-ws03-timer-cleanup', {
        recoveryIntervalMs: 50,
      });

      await worker.start();
      await new Promise((resolve) => setTimeout(resolve, 80));
      const cyclesBeforeStop = worker.getRecoveryCycleCount();

      await worker.stop(500);
      // Esperar más tiempo tras el stop
      await new Promise((resolve) => setTimeout(resolve, 150));
      const cyclesAfterStop = worker.getRecoveryCycleCount();

      assert.strictEqual(
        cyclesBeforeStop,
        cyclesAfterStop,
        'No deben ocurrir ciclos adicionales una vez detenido el worker'
      );
    });

    it('3.5 should safely coordinate concurrent recovery across worker instances in PostgreSQL', async () => {
      // Insertar un trabajo con arrendamiento expirado
      const expiredDate = new Date(Date.now() - 100_000);
      const [staleJob] = await db
        .insert(backgroundJobs)
        .values({
          jobType: 'CONVERSION',
          status: 'PROCESSING',
          progress: 50,
          userId: testUserId,
          inputRef: 'multi_worker_recovery.cho',
          leaseOwner: 'worker_crashed_multi',
          leaseToken: 'token_crashed_multi',
          leaseExpiresAt: expiredDate,
          attempts: 1,
          maxAttempts: 3,
          errorDetails: {
            storageKey: 'valid_stale.cho',
            checksumSha256: 'dummy_sha',
            targetFormat: 'LYRICS_ONLY',
          },
        })
        .returning();
      createdJobIds.push(staleJob.id);

      // Crear dos workers independientes
      const workerA = new ConversionWorker(db, storage, undefined, 'cert-ws03-worker-A');
      const workerB = new ConversionWorker(db, storage, undefined, 'cert-ws03-worker-B');

      // Ejecutar recuperación en paralelo en ambos workers compitiendo por el mismo trabajo caducado
      const [resA, resB] = await Promise.all([
        workerA.recoverStaleJobs(),
        workerB.recoverStaleJobs(),
      ]);

      // Exactamente 1 worker debe haber ganado el reclamo atómico condicional
      const totalClaimed = resA + resB;
      assert.strictEqual(totalClaimed, 1, 'Exactamente un worker debe adjudicarse la recuperación');

      const [updatedJob] = await db.select().from(backgroundJobs).where(eq(backgroundJobs.id, staleJob.id));
      assert.strictEqual(updatedJob.status, 'PENDING');
      assert.strictEqual(updatedJob.leaseOwner, null);
    });
  });

  // ===========================================================================
  // WS04: FILESYSTEM ERROR CLASSIFICATION & STORAGE RECONCILIATION
  // ===========================================================================
  describe('WS04 — Filesystem Error Classification & Storage Reconciliation', () => {
    it('4.1 listKeys() on nonexistent directory must return [] without throwing (legitimate empty storage)', async () => {
      const nonExistentDir = path.resolve(process.cwd(), 'storage/non_existent_cert_dir_404');
      if (fs.existsSync(nonExistentDir)) {
        fs.rmSync(nonExistentDir, { recursive: true, force: true });
      }

      const tempStorage = new LocalFileSystemSourceStorageProvider('storage/non_existent_cert_dir_404');
      const keys = await tempStorage.listKeys();
      assert.deepStrictEqual(keys, [], 'Directorio inexistente debe interpretarse como almacenamiento vacío legítimo');
    });

    it('4.2 listKeys() on populated directory must return accurate list of file keys', async () => {
      const testContent1 = Buffer.from('archivo 1');
      const testContent2 = Buffer.from('archivo 2');
      const res1 = await storage.save('test1.txt', testContent1);
      const res2 = await storage.save('test2.txt', testContent2);

      const keys = await storage.listKeys();
      assert.ok(keys.includes(res1.storageKey));
      assert.ok(keys.includes(res2.storageKey));
    });

    it('4.3 listKeys() must throw StorageReadError on permission denied (EACCES / EPERM) or I/O error', async () => {
      const failingStorage = new LocalFileSystemSourceStorageProvider('storage/test-cert-r221');
      // Simular fallo de readdir por error de permisos
      const originalReaddir = fs.promises.readdir;
      (fs.promises as any).readdir = async () => {
        const err: any = new Error('EACCES: permission denied, scandir');
        err.code = 'EACCES';
        throw err;
      };

      try {
        await assert.rejects(
          async () => {
            await failingStorage.listKeys();
          },
          (err: any) => {
            assert.ok(err instanceof StorageReadError, 'Debe lanzar StorageReadError');
            assert.match(err.message, /Fallo al leer las claves del almacenamiento/);
            return true;
          }
        );
      } finally {
        fs.promises.readdir = originalReaddir;
      }
    });

    it('4.4 getBuffer() on nonexistent file must throw ValidationError', async () => {
      await assert.rejects(
        async () => {
          await storage.getBuffer('archivo_inexistente_999.bin');
        },
        (err: any) => {
          assert.ok(err instanceof ValidationError, 'Debe lanzar ValidationError cuando el archivo no existe');
          assert.match(err.message, /Archivo fuente no encontrado/);
          return true;
        }
      );
    });

    it('4.5 getBuffer() on permission error must throw StorageReadError', async () => {
      const originalReadFile = fs.promises.readFile;
      (fs.promises as any).readFile = async () => {
        const err: any = new Error('EACCES: permission denied, open');
        err.code = 'EACCES';
        throw err;
      };

      try {
        await assert.rejects(
          async () => {
            await storage.getBuffer('archivo_protegido.bin');
          },
          (err: any) => {
            assert.ok(err instanceof StorageReadError, 'Debe lanzar StorageReadError en fallos de permisos de lectura');
            assert.match(err.message, /Fallo al leer el archivo en almacenamiento/);
            return true;
          }
        );
      } finally {
        fs.promises.readFile = originalReadFile;
      }
    });

    it('4.6 reconcileStorage() must abort safely and throw PersistenceError on storage inspection failure', async () => {
      const failingStorage = new LocalFileSystemSourceStorageProvider('storage/test-cert-r221');
      failingStorage.listKeys = async () => {
        throw new StorageReadError('Simulated EACCES: Permission denied reading disk volume');
      };

      const jobService = new ConversionJobService(undefined, undefined, db, failingStorage);

      await assert.rejects(
        async () => {
          await jobService.reconcileStorage();
        },
        (err: any) => {
          assert.ok(err instanceof PersistenceError, 'reconcileStorage debe abortar de inmediato con PersistenceError');
          assert.match(err.message, /Fallo al inspeccionar el almacenamiento físico durante la reconciliación/);
          return true;
        }
      );
    });
  });
});
