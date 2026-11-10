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
  WorkerLifecycleError,
  WorkerShutdownError,
  type WorkerStopResult,
} from '../application/conversion-worker.ts';
import { ConversionJobService } from '../application/conversion-job-service.ts';
import {
  LocalFileSystemSourceStorageProvider,
  StorageReadError,
  StorageWriteError,
  StorageDeleteError,
} from '../domain/ingestion/source-storage-provider.ts';
import {
  stopConversionQueue,
  getConversionQueue,
  CONVERSION_QUEUE_NAME,
  type ConversionJobPayload,
} from '../infrastructure/queue/conversion-queue.ts';
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
  // WS02: DETERMINISTIC SHUTDOWN, RESTART & LIFECYCLE CERTIFICATION (R3.2 SUITE)
  // ===========================================================================
  describe('WS02 — Deterministic Shutdown, Subscription Isolation & Lifecycle Certification', () => {
    it('2.1 R33-01: Invalid registration response (null, undefined, empty string, whitespace, malformed object) enters ERROR and prevents false STOPPED', async () => {
      const boss = getConversionQueue();
      const originalWork = boss.work.bind(boss);
      const originalOffWork = boss.offWork.bind(boss);

      let offWorkCalled = false;
      (boss as any).offWork = async (...args: any[]) => {
        offWorkCalled = true;
        return (originalOffWork as any)(...args);
      };

      const invalidValues: any[] = [null, undefined, '', '   ', { malformedResponse: 999 }];

      try {
        for (const invalidVal of invalidValues) {
          (boss as any).work = async () => invalidVal;
          const worker = new ConversionWorker(db, storage, undefined, `cert-r33-01-${String(invalidVal)}`);

          await assert.rejects(
            async () => {
              await worker.start();
            },
            (err: any) => {
              assert.strictEqual(err.name, 'WorkerLifecycleError');
              assert.ok(err.message.includes('identificador de suscripción válido') || err.message.includes('UNCERTAIN'));
              return true;
            }
          );

          assert.strictEqual(worker.getLifecycleState(), 'ERROR');
          assert.strictEqual(worker.getRegistrationState(), 'UNCERTAIN');
          assert.strictEqual(worker.hasUnresolvedRegistration(), true);
          assert.strictEqual(worker.isSubscribed(), false);
          assert.strictEqual(worker.getSubscriptionId(), null);

          // R33-01 / Blocker R33-01: stop() MUST NOT report STOPPED or success: true!
          const stopRes = await worker.stop(1000);
          assert.strictEqual(stopRes.success, false, 'stop() debe retornar success: false ante registro incierto');
          assert.strictEqual(stopRes.state, 'ERROR', 'stop() debe preservar estado ERROR ante registro incierto');
          assert.strictEqual(worker.getLifecycleState(), 'ERROR');
          assert.strictEqual(worker.getRegistrationState(), 'UNRESOLVED_ERROR');
          assert.strictEqual(worker.hasUnresolvedRegistration(), true);

          // resetLifecycle() no debe eludir el estado incierto
          assert.throws(
            () => {
              worker.resetLifecycle();
            },
            (err: any) => {
              assert.strictEqual(err.name, 'WorkerLifecycleError');
              assert.ok(err.message.includes('UNCERTAIN') || err.message.includes('ERROR NO RESUELTO'));
              return true;
            }
          );
        }
        assert.strictEqual(offWorkCalled, false, 'offWork() NUNCA debió ser invocado durante registros inválidos');
      } finally {
        (boss as any).work = originalWork;
        (boss as any).offWork = originalOffWork;
      }
    });

    it('2.2 R33-02: Registration uncertainty prevents false STOPPED, global offWork, and duplicate restart [Controlled Contract-Level Test]', async () => {
      const boss = getConversionQueue();
      const originalWork = boss.work.bind(boss);
      const originalOffWork = boss.offWork.bind(boss);

      let offWorkCalls: any[] = [];
      (boss as any).offWork = async (...args: any[]) => {
        offWorkCalls.push(args);
        return (originalOffWork as any)(...args);
      };

      (boss as any).work = async () => null;

      const worker = new ConversionWorker(db, storage, undefined, 'cert-r33-02-uncertainty');
      try {
        await assert.rejects(
          async () => {
            await worker.start();
          },
          (err: any) => {
            assert.strictEqual(err.name, 'WorkerLifecycleError');
            return true;
          }
        );

        assert.strictEqual(worker.getLifecycleState(), 'ERROR');
        assert.strictEqual(worker.getRegistrationState(), 'UNCERTAIN');

        // Intento de stop() con throwOnError: true debe lanzar WorkerShutdownError fail-closed
        await assert.rejects(
          async () => {
            await worker.stop({ timeoutMs: 1000, throwOnError: true });
          },
          (err: any) => {
            assert.strictEqual(err.name, 'WorkerShutdownError');
            assert.ok(err.message.includes('UNCERTAIN') || err.message.includes('ERROR NO RESUELTO'));
            return true;
          }
        );

        // offWork NUNCA debe ser invocado
        assert.strictEqual(offWorkCalls.length, 0, 'No debe invocarse offWork() de forma global');

        // Intento de start() posterior debe ser bloqueado estrictamente
        await assert.rejects(
          async () => {
            await worker.start();
          },
          (err: any) => {
            assert.strictEqual(err.name, 'WorkerLifecycleError');
            assert.ok(err.message.includes('UNCERTAIN') || err.message.includes('ERROR NO RESUELTO') || err.message.includes('estado ERROR'));
            return true;
          }
        );
      } finally {
        (boss as any).work = originalWork;
        (boss as any).offWork = originalOffWork;
      }
    });

    it('2.3 R331-REAL-01 [INTEGRATION]: Real pg-boss registration identity loss safely detects residual consumer, recovers exact identity without fabrication, and settles cleanly to STOPPED', async () => {
      const boss = getConversionQueue();
      const originalWork = boss.work.bind(boss);

      let realGeneratedSubId: string | null = null;
      // Interceptar ÚNICAMENTE en el boundary de la aplicación el resultado retornado
      // permitiendo que pg-boss registre el worker real en PostgreSQL y en su Manager interno
      (boss as any).work = async (...args: any[]) => {
        realGeneratedSubId = await (originalWork as any)(...args);
        return null; // El boundary de la aplicación recibe null a pesar de que pg-boss registró el consumidor
      };

      const worker = new ConversionWorker(db, storage, undefined, 'cert-r331-real-01');

      try {
        // 1. Iniciar worker: boss.work real se ejecuta, pero la respuesta interceptada es null
        await assert.rejects(
          async () => {
            await worker.start();
          },
          (err: any) => {
            assert.strictEqual(err.name, 'WorkerLifecycleError');
            return true;
          }
        );

        assert.strictEqual(worker.getLifecycleState(), 'ERROR');
        assert.strictEqual(worker.getRegistrationState(), 'UNCERTAIN');
        assert.strictEqual(worker.isSubscribed(), false);
        assert.strictEqual(worker.getSubscriptionId(), null);

        // 2. Inspeccionar el getWipData() REAL de pg-boss (sin ningún mock)
        const realWip = (boss as any).getWipData();
        const residual = realWip.find((w: any) => (w.options as any)?.workerInstanceId === worker.workerId);
        assert.ok(residual !== undefined, 'El consumidor residual real DEBE existir en getWipData() de pg-boss');
        assert.strictEqual(residual.workId, realGeneratedSubId, 'El workId en pg-boss debe coincidir con el generado internamente');

        // 3. stop() ordinario no debe reportar éxito ni transition a STOPPED mientras siga UNCERTAIN
        const stopRes = await worker.stop(1000);
        assert.strictEqual(stopRes.success, false);
        assert.strictEqual(stopRes.state, 'ERROR');
        assert.strictEqual(worker.getRegistrationState(), 'UNRESOLVED_ERROR');

        // 4. Disparar el mecanismo de producción (recover()) sin proveer ID fabricado
        const recoverRes = await worker.recover(2000);
        assert.strictEqual(recoverRes.success, true);
        assert.strictEqual(recoverRes.state, 'STOPPED');
        assert.strictEqual(worker.getLifecycleState(), 'STOPPED');
        assert.strictEqual(worker.getRegistrationState(), 'REMOVAL_CONFIRMED');
        assert.strictEqual(worker.isSubscribed(), false);

        // 5. Inspeccionar nuevamente el getWipData() REAL: el consumidor debe haber sido removido de forma dirigida
        const realWipAfter = (boss as any).getWipData();
        const residualAfter = realWipAfter.find((w: any) => (w.options as any)?.workerInstanceId === worker.workerId);
        assert.strictEqual(residualAfter, undefined, 'El consumidor objetivo debe haber sido removido autoritativamente de pg-boss');

        // 6. Reinicio limpio posterior permitido tras recuperación verificada
        (boss as any).work = originalWork;
        await worker.start();
        assert.strictEqual(worker.getLifecycleState(), 'RUNNING');
        assert.strictEqual(worker.isSubscribed(), true);

        const finalStop = await worker.stop(2000);
        assert.strictEqual(finalStop.success, true);
        assert.strictEqual(worker.getLifecycleState(), 'STOPPED');
      } finally {
        (boss as any).work = originalWork;
        await worker.stop(1000).catch(() => {});
      }
    });

    it('2.4 R331-REAL-02 [INTEGRATION]: Multiple real consumers on same queue under registration uncertainty safely preserves peer consumer and avoids global offWork', async () => {
      const boss = getConversionQueue();
      const originalWork = boss.work.bind(boss);
      const originalOffWork = boss.offWork.bind(boss);

      const offWorkCalls: any[] = [];
      (boss as any).offWork = async (name: string, options: any) => {
        offWorkCalls.push({ name, options });
        return (originalOffWork as any)(name, options);
      };

      // Iniciar dos workers reales en la misma cola
      const workerPeer = new ConversionWorker(db, storage, undefined, 'cert-r331-real-02-peer');
      const workerUncertain = new ConversionWorker(db, storage, undefined, 'cert-r331-real-02-uncertain');

      try {
        // 1. workerPeer inicia normalmente y obtiene su suscripción legítima
        await workerPeer.start();
        assert.strictEqual(workerPeer.getLifecycleState(), 'RUNNING');
        const peerSubId = workerPeer.getSubscriptionId();
        assert.ok(peerSubId !== null);

        // 2. Interceptar workerUncertain en el boundary para que reciba whitespace
        (boss as any).work = async (...args: any[]) => {
          await (originalWork as any)(...args);
          return '   '; // Espacio en blanco inválido
        };

        await assert.rejects(async () => {
          await workerUncertain.start();
        });
        assert.strictEqual(workerUncertain.getLifecycleState(), 'ERROR');
        assert.strictEqual(workerUncertain.getRegistrationState(), 'UNCERTAIN');

        // 3. Inspeccionar getWipData() real: ambos consumidores existen en la cola
        const wipBefore = (boss as any).getWipData();
        const peerInWip = wipBefore.find((w: any) => w.workId === peerSubId);
        const uncertainInWip = wipBefore.find((w: any) => (w.options as any)?.workerInstanceId === workerUncertain.workerId);
        assert.ok(peerInWip !== undefined, 'workerPeer debe existir en pg-boss');
        assert.ok(uncertainInWip !== undefined, 'workerUncertain debe existir residualmente en pg-boss');

        // 4. stop() en workerUncertain falla y NO llama offWork global
        const stopRes = await workerUncertain.stop(1000);
        assert.strictEqual(stopRes.success, false);
        assert.strictEqual(stopRes.state, 'ERROR');
        assert.strictEqual(offWorkCalls.length, 0, 'No debe haberse invocado offWork()');

        // 5. Reconciliar workerUncertain mediante recover()
        const recoverRes = await workerUncertain.recover(2000);
        assert.strictEqual(recoverRes.success, true);
        assert.strictEqual(recoverRes.state, 'STOPPED');

        // 6. Verificar que offWork fue DIRIGIDO exclusivamente al workId de workerUncertain
        assert.strictEqual(offWorkCalls.length, 1);
        assert.strictEqual(offWorkCalls[0].name, CONVERSION_QUEUE_NAME);
        assert.strictEqual(offWorkCalls[0].options?.id, uncertainInWip.workId);
        assert.strictEqual(offWorkCalls[0].options?.wait, true);

        // 7. workerPeer DEBE continuar 100% activo en pg-boss y en memoria
        assert.strictEqual(workerPeer.getLifecycleState(), 'RUNNING');
        assert.strictEqual(workerPeer.isSubscribed(), true);
        const wipAfter = (boss as any).getWipData();
        const peerStillInWip = wipAfter.find((w: any) => w.workId === peerSubId);
        const uncertainGone = wipAfter.find((w: any) => (w.options as any)?.workerInstanceId === workerUncertain.workerId);
        assert.ok(peerStillInWip !== undefined, 'workerPeer debe seguir activo y sin perturbación en pg-boss');
        assert.strictEqual(uncertainGone, undefined, 'workerUncertain debe haber sido removido');

        // 8. Detener workerPeer limpiamente
        const stopPeer = await workerPeer.stop(2000);
        assert.strictEqual(stopPeer.success, true);
        assert.strictEqual(workerPeer.getLifecycleState(), 'STOPPED');
      } finally {
        (boss as any).work = originalWork;
        (boss as any).offWork = originalOffWork;
        await workerPeer.stop(1000).catch(() => {});
        await workerUncertain.stop(1000).catch(() => {});
      }
    });

    it('2.5 Valid subscription ID is captured on worker start and cleanly removed', async () => {
      const worker = new ConversionWorker(db, storage, undefined, 'cert-ws02-valid-start-clean-stop');
      try {
        await worker.start();
        assert.strictEqual(worker.getLifecycleState(), 'RUNNING');
        assert.strictEqual(worker.isSubscribed(), true);
        const subId = worker.getSubscriptionId();
        assert.strictEqual(typeof subId, 'string');
        assert.ok(subId !== null && subId.trim().length > 0, 'Debe capturar un subscriptionId no vacío');
        const stopRes = await worker.stop(2000);
        assert.strictEqual(stopRes.success, true);
        assert.strictEqual(worker.getLifecycleState(), 'STOPPED');
        assert.strictEqual(worker.getSubscriptionId(), null);
      } finally {
        await worker.stop(1000).catch(() => {});
      }
    });

    it('2.5 R32-05: Missing ID never triggers global offWork() on shutdown or recovery', async () => {
      const boss = getConversionQueue();
      const originalOffWork = boss.offWork.bind(boss);

      let offWorkCalls: any[] = [];
      (boss as any).offWork = async (...args: any[]) => {
        offWorkCalls.push(args);
        return (originalOffWork as any)(...args);
      };

      const worker = new ConversionWorker(db, storage, undefined, 'cert-ws02-r32-05');
      // Forzar edge case de suscripción activa con subscriptionId faltante
      (worker as any).isQueueSubscribed = true;
      (worker as any).subscriptionId = null;

      try {
        await assert.rejects(
          async () => {
            await worker.stop({ timeoutMs: 1000, throwOnError: true });
          },
          (err: any) => {
            assert.strictEqual(err.name, 'WorkerShutdownError');
            assert.ok(err.message.includes('prohíbe terminantemente la invocación de offWork() global'));
            return true;
          }
        );

        assert.strictEqual(offWorkCalls.length, 0, 'offWork() NUNCA debió ser invocado');
      } finally {
        (boss as any).offWork = originalOffWork;
        (worker as any).isQueueSubscribed = false;
      }
    });

    it('2.6 R32-06: Targeted shutdown isolates consumers and does not remove a second consumer on same queue', async () => {
      const boss = getConversionQueue();
      const originalOffWork = boss.offWork.bind(boss);

      const worker1 = new ConversionWorker(db, storage, undefined, 'cert-ws02-r32-06-w1');
      const worker2 = new ConversionWorker(db, storage, undefined, 'cert-ws02-r32-06-w2');

      const offWorkCalls: any[] = [];
      (boss as any).offWork = async (name: string, options: any) => {
        offWorkCalls.push({ name, options });
        return (originalOffWork as any)(name, options);
      };

      try {
        await worker1.start();
        await worker2.start();

        const sub1 = worker1.getSubscriptionId();
        const sub2 = worker2.getSubscriptionId();

        assert.ok(sub1 !== null && sub2 !== null);
        assert.notStrictEqual(sub1, sub2, 'Identificadores de suscripción deben ser distintos');

        // Detener worker1
        const stop1 = await worker1.stop(2000);
        assert.strictEqual(stop1.success, true);
        assert.strictEqual(worker1.getLifecycleState(), 'STOPPED');

        // Verificar que offWork fue invocado DIRIGIDO a sub1 con { id: sub1, wait: true }
        assert.strictEqual(offWorkCalls.length, 1);
        assert.strictEqual(offWorkCalls[0].name, CONVERSION_QUEUE_NAME);
        assert.strictEqual(offWorkCalls[0].options?.id, sub1);
        assert.strictEqual(offWorkCalls[0].options?.wait, true);

        // worker2 debe permanecer 100% activo y registrado
        assert.strictEqual(worker2.isActive(), true);
        assert.strictEqual(worker2.getLifecycleState(), 'RUNNING');
        assert.strictEqual(worker2.isSubscribed(), true);
        assert.strictEqual(worker2.getSubscriptionId(), sub2);

        // Detener worker2 limpiamente
        const stop2 = await worker2.stop(2000);
        assert.strictEqual(stop2.success, true);
        assert.strictEqual(worker2.getLifecycleState(), 'STOPPED');
      } finally {
        (boss as any).offWork = originalOffWork;
        await worker1.stop(1000).catch(() => {});
        await worker2.stop(1000).catch(() => {});
      }
    });

    it('2.7 R32-07: Verification checks exact subscription identity without matching unrelated workers', async () => {
      const boss = getConversionQueue();
      const originalGetWipData = (boss as any).getWipData;

      const worker1 = new ConversionWorker(db, storage, undefined, 'cert-ws02-r32-07-w1');
      const worker2 = new ConversionWorker(db, storage, undefined, 'cert-ws02-r32-07-w2');

      try {
        await worker1.start();
        await worker2.start();

        const sub1 = worker1.getSubscriptionId();
        const sub2 = worker2.getSubscriptionId();

        assert.ok(sub1 !== null && sub2 !== null);

        // getWipData() reporta que worker2 sigue activo en la cola
        (boss as any).getWipData = () => {
          return [
            {
              id: sub2,
              workId: sub2,
              name: CONVERSION_QUEUE_NAME,
              options: { workerInstanceId: worker2.workerId },
              state: 'active',
              count: 0,
              createdOn: Date.now(),
            },
          ];
        };

        // Detener worker1: debe verificar únicamente su propio sub1 sin fallar falsamente por sub2
        const stop1 = await worker1.stop(2000);
        assert.strictEqual(stop1.success, true);
        assert.strictEqual(stop1.state, 'STOPPED');
        assert.strictEqual(worker1.getLifecycleState(), 'STOPPED');
        assert.strictEqual(worker1.isSubscribed(), false);

        // worker2 continúa activo
        assert.strictEqual(worker2.getLifecycleState(), 'RUNNING');
        assert.strictEqual(worker2.isSubscribed(), true);

        // Restaurar getWipData original y detener worker2
        (boss as any).getWipData = originalGetWipData;
        const stop2 = await worker2.stop(2000);
        assert.strictEqual(stop2.success, true);
        assert.strictEqual(worker2.getLifecycleState(), 'STOPPED');
      } finally {
        (boss as any).getWipData = originalGetWipData;
        await worker1.stop(1000).catch(() => {});
        await worker2.stop(1000).catch(() => {});
      }
    });

    it('2.8 R32-08 [INTEGRATION]: Real pg-boss partial shutdown failure (Promise.allSettled absorbs worker.stop error, real getWipData detects failure, second consumer survives)', async () => {
      const { default: WorkerClass } = await import('../../node_modules/pg-boss/dist/worker.js');
      const boss = getConversionQueue();

      // Iniciar dos workers reales en la cola de conversión sobre PostgreSQL real
      const worker1 = new ConversionWorker(db, storage, undefined, 'cert-ws02-r32-08-w1');
      const worker2 = new ConversionWorker(db, storage, undefined, 'cert-ws02-r32-08-w2');

      const originalWorkerStop = (WorkerClass as any).prototype.stop;
      let failureInjected = true;
      let targetSubId: string | null = null;

      try {
        await worker1.start();
        await worker2.start();

        const sub1 = worker1.getSubscriptionId();
        const sub2 = worker2.getSubscriptionId();

        assert.ok(sub1 !== null, 'worker1 debe tener un subscriptionId');
        assert.ok(sub2 !== null, 'worker2 debe tener un subscriptionId');
        assert.notStrictEqual(sub1, sub2, 'sub1 y sub2 deben ser distintos');
        targetSubId = sub1;

        // Inyectar fallo controlado exclusivamente en la instancia interna del targetSubId
        (WorkerClass as any).prototype.stop = async function (...args: any[]) {
          if (failureInjected && (this.workId === targetSubId || this.id === targetSubId)) {
            throw new Error('Fallo interno simulado en Worker.stop() de pg-boss');
          }
          return originalWorkerStop.apply(this, args);
        };

        // Detener worker1: invoca boss.offWork({ id: sub1, wait: true }).
        // El Manager real de pg-boss atrapa la excepción vía Promise.allSettled y resuelve sin lanzar.
        // Pero el Worker real permanece en getWipData() de pg-boss!
        const stop1 = await worker1.stop(2000);

        // worker1 debe detectar el fallo autoritativo de apagado y pasar a ERROR
        assert.strictEqual(stop1.success, false);
        assert.strictEqual(stop1.state, 'ERROR');
        assert.strictEqual(worker1.getLifecycleState(), 'ERROR');
        assert.strictEqual(worker1.isSubscribed(), true);
        assert.ok(stop1.error instanceof WorkerShutdownError);

        // Inspeccionar el getWipData() REAL de pg-boss (sin ningún mock)
        const realWip = (boss as any).getWipData();
        const sub1InWip = realWip.find((w: any) => w.workId === sub1 || w.id === sub1);
        const sub2InWip = realWip.find((w: any) => w.workId === sub2 || w.id === sub2);
        assert.ok(sub1InWip !== undefined, 'El consumidor 1 falló su stop y DEBE permanecer en el getWipData real de pg-boss');
        assert.ok(sub2InWip !== undefined, 'El consumidor 2 DEBE permanecer activo y operacional en el getWipData real');

        // worker2 debe permanecer 100% activo y en RUNNING
        assert.strictEqual(worker2.getLifecycleState(), 'RUNNING');
        assert.strictEqual(worker2.isSubscribed(), true);

        // Desactivar inyección de fallo para permitir la recuperación real
        failureInjected = false;

        // recover() debe reintentar la desuscripción autoritativa y confirmar su remoción
        const recover1 = await worker1.recover(2000);
        assert.strictEqual(recover1.success, true);
        assert.strictEqual(recover1.state, 'STOPPED');
        assert.strictEqual(worker1.getLifecycleState(), 'STOPPED');
        assert.strictEqual(worker1.isSubscribed(), false);

        // Verificar con el getWipData() REAL que sub1 ya no existe pero sub2 sigue vivo
        const realWipAfter = (boss as any).getWipData();
        const sub1InWipAfter = realWipAfter.find((w: any) => w.workId === sub1 || w.id === sub1);
        const sub2InWipAfter = realWipAfter.find((w: any) => w.workId === sub2 || w.id === sub2);
        assert.strictEqual(sub1InWipAfter, undefined, 'sub1 debe haber sido removido limpiamente');
        assert.ok(sub2InWipAfter !== undefined, 'sub2 debe continuar operativo');

        // Detener worker2 limpiamente
        const stop2 = await worker2.stop(2000);
        assert.strictEqual(stop2.success, true);
        assert.strictEqual(worker2.getLifecycleState(), 'STOPPED');
      } finally {
        (WorkerClass as any).prototype.stop = originalWorkerStop;
        await worker1.stop(1000).catch(() => {});
        await worker2.stop(1000).catch(() => {});
      }
    });

    it('2.9 WS-R31-01: Missing verification capability (boss.getWipData is undefined) fails closed to ERROR and rejects restart', async () => {
      const boss = getConversionQueue();
      const originalGetWipData = (boss as any).getWipData;
      (boss as any).getWipData = undefined;

      const worker = new ConversionWorker(db, storage, undefined, 'cert-ws02-ws-r31-01');
      try {
        await worker.start();
        assert.strictEqual(worker.getLifecycleState(), 'RUNNING');

        const stopResult = await worker.stop(1000);

        assert.strictEqual(stopResult.success, false);
        assert.strictEqual(stopResult.state, 'ERROR');
        assert.strictEqual(worker.getLifecycleState(), 'ERROR');
        assert.strictEqual(worker.isSubscribed(), true, 'La suscripción no debe considerarse removida');
        assert.ok(stopResult.error instanceof WorkerShutdownError);
        assert.ok((stopResult.error as Error).message.includes('getWipData'));

        // Intentar start() debe ser rechazado inmediatamente (fail closed)
        await assert.rejects(
          async () => {
            await worker.start();
          },
          (err: any) => {
            assert.strictEqual(err.name, 'WorkerLifecycleError');
            return true;
          }
        );
      } finally {
        (boss as any).getWipData = originalGetWipData;
        await worker.recover().catch(() => {});
      }
    });

    it('2.10 WS-R31-02: Unexpected verification result (getWipData returns non-array or null) fails closed to ERROR', async () => {
      const boss = getConversionQueue();
      const originalGetWipData = (boss as any).getWipData;
      (boss as any).getWipData = () => null;

      const worker = new ConversionWorker(db, storage, undefined, 'cert-ws02-ws-r31-02');
      try {
        await worker.start();
        assert.strictEqual(worker.getLifecycleState(), 'RUNNING');

        const stopResult = await worker.stop(1000);

        assert.strictEqual(stopResult.success, false);
        assert.strictEqual(stopResult.state, 'ERROR');
        assert.strictEqual(worker.getLifecycleState(), 'ERROR');
        assert.strictEqual(worker.isSubscribed(), true);
        assert.ok(stopResult.error instanceof WorkerShutdownError);
        assert.ok((stopResult.error as Error).message.includes('no es un arreglo'));

        // start() rechazado
        await assert.rejects(
          async () => {
            await worker.start();
          },
          (err: any) => {
            assert.strictEqual(err.name, 'WorkerLifecycleError');
            return true;
          }
        );
      } finally {
        (boss as any).getWipData = originalGetWipData;
        await worker.recover().catch(() => {});
      }
    });

    it('2.11 WS-R31-03: Verification exception (getWipData throws) fails closed to ERROR and records exception', async () => {
      const boss = getConversionQueue();
      const originalGetWipData = (boss as any).getWipData;
      const thrownErr = new Error('Fallo crítico de base de datos durante inspección getWipData()');
      (boss as any).getWipData = () => {
        throw thrownErr;
      };

      const worker = new ConversionWorker(db, storage, undefined, 'cert-ws02-ws-r31-03');
      try {
        await worker.start();
        assert.strictEqual(worker.getLifecycleState(), 'RUNNING');

        const stopResult = await worker.stop(1000);

        assert.strictEqual(stopResult.success, false);
        assert.strictEqual(stopResult.state, 'ERROR');
        assert.strictEqual(worker.getLifecycleState(), 'ERROR');
        assert.strictEqual(worker.isSubscribed(), true);
        assert.strictEqual(worker.getLastShutdownError(), thrownErr);

        await assert.rejects(
          async () => {
            await worker.start();
          },
          (err: any) => {
            assert.strictEqual(err.name, 'WorkerLifecycleError');
            return true;
          }
        );
      } finally {
        (boss as any).getWipData = originalGetWipData;
        await worker.recover().catch(() => {});
      }
    });

    it('2.12 WS-R31-04 [CONTRACT]: Contract-level partial shutdown failure verification with controlled WIP reporting', async () => {
      const boss = getConversionQueue();
      const originalGetWipData = (boss as any).getWipData;
      const originalOffWork = boss.offWork.bind(boss);

      let mockActiveInWip = true;
      let targetSubId: string | null = null;

      (boss as any).offWork = async (queueName: string, ...rest: any[]) => {
        return (originalOffWork as any)(queueName, ...rest);
      };

      (boss as any).getWipData = () => {
        if (mockActiveInWip && targetSubId) {
          return [
            {
              id: targetSubId,
              workId: targetSubId,
              name: CONVERSION_QUEUE_NAME,
              options: { workerInstanceId: worker.workerId },
              state: 'active',
              count: 0,
              createdOn: Date.now(),
            },
          ];
        }
        return [];
      };

      const worker = new ConversionWorker(db, storage, undefined, 'cert-ws02-ws-r31-04-contract');
      try {
        await worker.start();
        assert.strictEqual(worker.getLifecycleState(), 'RUNNING');
        targetSubId = worker.getSubscriptionId();
        assert.ok(targetSubId !== null);

        const stopResult = await worker.stop(1000);
        assert.strictEqual(stopResult.success, false);
        assert.strictEqual(stopResult.state, 'ERROR');
        assert.strictEqual(worker.getLifecycleState(), 'ERROR');
        assert.strictEqual(worker.isSubscribed(), true);
        assert.ok(stopResult.error instanceof WorkerShutdownError);

        await assert.rejects(
          async () => {
            await worker.start();
          },
          (err: any) => {
            assert.strictEqual(err.name, 'WorkerLifecycleError');
            return true;
          }
        );

        mockActiveInWip = false;
        const recoveryResult = await worker.recover(1000);
        assert.strictEqual(recoveryResult.success, true);
        assert.strictEqual(recoveryResult.state, 'STOPPED');
        assert.strictEqual(worker.getLifecycleState(), 'STOPPED');
      } finally {
        (boss as any).getWipData = originalGetWipData;
        (boss as any).offWork = originalOffWork;
        await worker.recover().catch(() => {});
      }
    });

    it('2.13 WS-R31-05: Successful authoritative shutdown resolves, verifies removal, and permits restart', async () => {
      const worker = new ConversionWorker(db, storage, undefined, 'cert-ws02-ws-r31-05');
      await worker.start();
      assert.strictEqual(worker.isActive(), true);
      assert.strictEqual(worker.getLifecycleState(), 'RUNNING');
      assert.strictEqual(worker.isSubscribed(), true);

      const start = Date.now();
      const stopResult = await worker.stop(5000);
      const elapsed = Date.now() - start;

      assert.strictEqual(stopResult.success, true);
      assert.strictEqual(stopResult.state, 'STOPPED');
      assert.strictEqual(stopResult.offWorkSettled, true);
      assert.strictEqual(stopResult.activeJobsDrained, true);
      assert.strictEqual(stopResult.remainingJobsCount, 0);
      assert.strictEqual(stopResult.timedOut, false);
      assert.strictEqual(worker.isActive(), false);
      assert.strictEqual(worker.getLifecycleState(), 'STOPPED');
      assert.strictEqual(worker.isSubscribed(), false);
      assert.strictEqual(worker.getActiveJobsCount(), 0);
      assert.strictEqual(worker.isUnsubscribePending(), false);
      assert.strictEqual(worker.getPendingUnsubscribeOperation(), null);
      assert.ok(elapsed < 800, `Stop con 0 trabajos debió finalizar prontamente (duración real: ${elapsed}ms)`);

      // Reinicio verificado permitido
      await worker.start();
      assert.strictEqual(worker.getLifecycleState(), 'RUNNING');
      const finalStop = await worker.stop(2000);
      assert.strictEqual(finalStop.success, true);
      assert.strictEqual(worker.getLifecycleState(), 'STOPPED');
    });

    it('2.14 WS-R31-06: Concurrent start calls share a single startup promise and create exactly one subscription', async () => {
      const boss = getConversionQueue();
      const originalWork = boss.work.bind(boss);
      let workCallCount = 0;
      (boss as any).work = async (...args: any[]) => {
        workCallCount++;
        await new Promise((resolve) => setTimeout(resolve, 30));
        return (originalWork as any)(...args);
      };

      const worker = new ConversionWorker(db, storage, undefined, 'cert-ws02-ws-r31-06');
      try {
        await Promise.all([
          worker.start(),
          worker.start(),
          worker.start(),
        ]);

        assert.strictEqual(worker.getLifecycleState(), 'RUNNING');
        assert.strictEqual(worker.isActive(), true);
        assert.strictEqual(worker.isSubscribed(), true);
        assert.strictEqual(workCallCount, 1, 'Exactamente una suscripción pg-boss debe haberse creado');

        const stopRes = await worker.stop(2000);
        assert.strictEqual(stopRes.success, true);
        assert.strictEqual(worker.getLifecycleState(), 'STOPPED');
      } finally {
        (boss as any).work = originalWork;
        await worker.stop(1000).catch(() => {});
      }
    });

    it('2.15 WS-R31-07: Concurrent stop() calls share the single shutdown operation and return consistent outcome', async () => {
      const worker = new ConversionWorker(db, storage, undefined, 'cert-ws02-ws-r31-07');
      await worker.start();
      assert.strictEqual(worker.isActive(), true);

      const [res1, res2, res3] = await Promise.all([
        worker.stop(2000),
        worker.stop(2000),
        worker.stop(2000),
      ]);

      assert.strictEqual(res1.success, true);
      assert.strictEqual(res2.success, true);
      assert.strictEqual(res3.success, true);
      assert.strictEqual(res1.state, 'STOPPED');
      assert.strictEqual(res2.state, 'STOPPED');
      assert.strictEqual(res3.state, 'STOPPED');
      assert.strictEqual(worker.isActive(), false);
      assert.strictEqual(worker.getLifecycleState(), 'STOPPED');
      assert.strictEqual(worker.isSubscribed(), false);

      const seqRes = await worker.stop(1000);
      assert.strictEqual(seqRes.success, true);
      assert.strictEqual(seqRes.state, 'STOPPED');
    });

    it('2.16 WS-R31-08 / R32-Late-Success: Timeout followed by late completion and second lifecycle operation with generation token protection', async () => {
      const boss = getConversionQueue();
      const originalOffWork = boss.offWork.bind(boss);

      let unblockOffWork: () => void;
      const offWorkBarrier = new Promise<void>((resolve) => {
        unblockOffWork = resolve;
      });

      (boss as any).offWork = async (queueName: string, ...rest: any[]) => {
        await offWorkBarrier;
        return (originalOffWork as any)(queueName, ...rest);
      };

      const worker = new ConversionWorker(db, storage, undefined, 'cert-ws02-late-success');
      try {
        await worker.start();
        assert.strictEqual(worker.getLifecycleState(), 'RUNNING');

        // 1. Iniciar detención con plazo breve: debe expirar mientras offWork sigue bloqueado
        const stopResult = await worker.stop(50);
        assert.strictEqual(stopResult.timedOut, true);
        assert.strictEqual(stopResult.state, 'STOPPING');
        assert.strictEqual(worker.getLifecycleState(), 'STOPPING');
        assert.strictEqual(worker.isUnsubscribePending(), true);
        assert.strictEqual(worker.isSubscribed(), true);

        // 2. start() está estrictamente bloqueado en STOPPING
        await assert.rejects(
          async () => {
            await worker.start();
          },
          (err: any) => {
            assert.strictEqual(err.name, 'WorkerLifecycleError');
            return true;
          }
        );

        // 3. Iniciar una segunda operación de recuperación (nueva generación)
        const secondGenPromise = worker.recover(1000);

        // 4. Liberar la barrera para que la primera operación asíncrona culmine tarde
        unblockOffWork!();

        const secondRes = await secondGenPromise;
        assert.strictEqual(secondRes.success, true);
        assert.strictEqual(secondRes.state, 'STOPPED');
        assert.strictEqual(worker.getLifecycleState(), 'STOPPED');
        assert.strictEqual(worker.isSubscribed(), false);

        // 5. Reinicio posterior permitido
        await worker.start();
        assert.strictEqual(worker.getLifecycleState(), 'RUNNING');
        await worker.stop(1000);
      } finally {
        unblockOffWork!();
        (boss as any).offWork = originalOffWork;
        await worker.stop(1000).catch(() => {});
      }
    });

    it('2.17 R32-Late-Failure: Timeout followed by late error completion does not overwrite newer valid state', async () => {
      const boss = getConversionQueue();
      const originalOffWork = boss.offWork.bind(boss);

      let unblockOffWork: () => void;
      const offWorkBarrier = new Promise<void>((resolve) => {
        unblockOffWork = resolve;
      });

      let failOffWork = false;
      (boss as any).offWork = async (queueName: string, ...rest: any[]) => {
        await offWorkBarrier;
        if (failOffWork) {
          throw new Error('Fallo asíncrono tardío forzado');
        }
        return (originalOffWork as any)(queueName, ...rest);
      };

      const worker = new ConversionWorker(db, storage, undefined, 'cert-ws02-late-failure');
      try {
        await worker.start();
        assert.strictEqual(worker.getLifecycleState(), 'RUNNING');

        failOffWork = true;
        // Iniciar stop con timeout acotado
        const stopResult = await worker.stop(50);
        assert.strictEqual(stopResult.timedOut, true);
        assert.strictEqual(stopResult.state, 'STOPPING');

        // Incrementar generación ejecutando una nueva operación de recuperación mientras el fallo tardío sigue en vuelo
        failOffWork = false; // el reintento tendrá éxito
        const recoverPromise = worker.recover(1000);

        // Liberar la barrera para que el primer callback tardío falle en segundo plano
        unblockOffWork!();

        const recoverRes = await recoverPromise;
        // La generación anterior no debe corromper el estado de la nueva operación
        assert.strictEqual(recoverRes.success, true);
        assert.strictEqual(recoverRes.state, 'STOPPED');
        assert.strictEqual(worker.getLifecycleState(), 'STOPPED');
        assert.strictEqual(worker.isSubscribed(), false);
      } finally {
        unblockOffWork!();
        (boss as any).offWork = originalOffWork;
        await worker.stop(1000).catch(() => {});
      }
    });

    it('2.18 WS-R31-09: Recovery after failed shutdown retries offWork and fails closed if still bad without bypass', async () => {
      const boss = getConversionQueue();
      const originalOffWork = boss.offWork.bind(boss);

      let offWorkAttempts = 0;
      const forcedError = new Error('Fallo recurrente de conexión en pg-boss offWork()');
      (boss as any).offWork = async () => {
        offWorkAttempts++;
        throw forcedError;
      };

      const worker = new ConversionWorker(db, storage, undefined, 'cert-ws02-ws-r31-09');
      try {
        await worker.start();
        assert.strictEqual(worker.getLifecycleState(), 'RUNNING');

        // 1. Primer intento de stop falla
        const stopResult = await worker.stop(1000);
        assert.strictEqual(stopResult.state, 'ERROR');
        assert.strictEqual(worker.getLifecycleState(), 'ERROR');
        assert.strictEqual(offWorkAttempts, 1);

        // 2. resetLifecycle() NO DEBE eludir el fallo
        assert.throws(
          () => {
            worker.resetLifecycle();
          },
          (err: any) => {
            assert.strictEqual(err.name, 'WorkerLifecycleError');
            assert.ok(err.message.includes('no puede eludir'));
            return true;
          }
        );

        // 3. Intento explícito de recuperación mediante recover() mientras offWork sigue fallando
        const recoveryResult = await worker.recover(1000);
        assert.strictEqual(recoveryResult.success, false);
        assert.strictEqual(recoveryResult.state, 'ERROR');
        assert.strictEqual(recoveryResult.error, forcedError);
        assert.strictEqual(worker.getLifecycleState(), 'ERROR');
        assert.strictEqual(worker.getLastShutdownError(), forcedError);
        assert.strictEqual(worker.isSubscribed(), true);
        assert.strictEqual(offWorkAttempts, 2, 'Debe haber reintentado la desuscripción exactamente una vez más');

        // 4. start() sigue estrictamente bloqueado
        await assert.rejects(
          async () => {
            await worker.start();
          },
          (err: any) => {
            assert.strictEqual(err.name, 'WorkerLifecycleError');
            return true;
          }
        );
      } finally {
        (boss as any).offWork = originalOffWork;
        await worker.recover().catch(() => {});
      }
    });

    it('2.19 WS-R31-10: Recovery after confirmed shutdown transitions to STOPPED and permits subsequent start', async () => {
      const boss = getConversionQueue();
      const originalOffWork = boss.offWork.bind(boss);
      const originalWork = boss.work.bind(boss);

      let workCallCount = 0;
      (boss as any).work = async (...args: any[]) => {
        workCallCount++;
        return (originalWork as any)(...args);
      };

      let shouldFail = true;
      (boss as any).offWork = async (queueName: string, ...rest: any[]) => {
        if (shouldFail) {
          throw new Error('Fallo inicial transitorio en offWork');
        }
        return (originalOffWork as any)(queueName, ...rest);
      };

      const worker = new ConversionWorker(db, storage, undefined, 'cert-ws02-ws-r31-10');
      try {
        await worker.start();
        assert.strictEqual(worker.getLifecycleState(), 'RUNNING');
        assert.strictEqual(workCallCount, 1);

        // 1. Detención inicial falla
        const stopResult = await worker.stop(1000);
        assert.strictEqual(stopResult.state, 'ERROR');
        assert.strictEqual(worker.isSubscribed(), true);

        // 2. Corregir condición de fallo
        shouldFail = false;

        // 3. Ejecutar recuperación segura
        const recoveryResult = await worker.recover(1000);
        assert.strictEqual(recoveryResult.success, true);
        assert.strictEqual(recoveryResult.state, 'STOPPED');
        assert.strictEqual(worker.getLifecycleState(), 'STOPPED');
        assert.strictEqual(worker.isSubscribed(), false);
        assert.strictEqual(worker.getLastShutdownError(), null);

        // 4. Reinicio posterior debe tener éxito y establecer exactamente una nueva suscripción
        await worker.start();
        assert.strictEqual(worker.getLifecycleState(), 'RUNNING');
        assert.strictEqual(worker.isSubscribed(), true);
        assert.strictEqual(workCallCount, 2, 'Exactamente una suscripción previa y una nueva tras recuperación');

        const finalStop = await worker.stop(1000);
        assert.strictEqual(finalStop.success, true);
        assert.strictEqual(worker.getLifecycleState(), 'STOPPED');
      } finally {
        (boss as any).offWork = originalOffWork;
        (boss as any).work = originalWork;
      }
    });

    it('2.20 WS-R31-12: Shutdown failure cannot be hidden and records error truthfully', async () => {
      const boss = getConversionQueue();
      const originalOffWork = boss.offWork.bind(boss);
      const forcedError = new Error('Fallo crítico forzado para comprobación WS-R31-12');
      (boss as any).offWork = async () => {
        throw forcedError;
      };

      const worker = new ConversionWorker(db, storage, undefined, 'cert-ws02-ws-r31-12');
      try {
        await worker.start();

        // 1. Con throwOnError: true, lanza WorkerShutdownError envolviendo el error original
        await assert.rejects(
          async () => {
            await worker.stop({ timeoutMs: 1000, throwOnError: true });
          },
          (err: any) => {
            assert.strictEqual(err.name, 'WorkerShutdownError');
            assert.strictEqual(err.cause, forcedError);
            return true;
          }
        );

        // 2. Con throwOnError: false (default), retorna resultado con error exacto
        const stopResult = await worker.stop({ timeoutMs: 1000, throwOnError: false });
        assert.strictEqual(stopResult.success, false);
        assert.strictEqual(stopResult.state, 'ERROR');
        assert.strictEqual(stopResult.error, forcedError);
        assert.strictEqual(worker.getLastShutdownError(), forcedError);
        assert.strictEqual(worker.getLifecycleState(), 'ERROR');
      } finally {
        (boss as any).offWork = originalOffWork;
        await worker.recover().catch(() => {});
      }
    });

    it('2.21 Active job preservation during shutdown leaves lease intact for recovery', async () => {
      let unblock: () => void;
      const barrier = new Promise<void>((resolve) => {
        unblock = resolve;
      });

      const worker = new ConversionWorker(db, storage, undefined, 'cert-ws02-scenario-preservation', {
        onStageReached: async (stage) => {
          if (stage === 'STAGE_B') {
            await barrier;
          }
        },
      });

      const testContent = Buffer.from('{title: Preservacion}\n[G]Preservacion de lease');
      const saveRes = await storage.save('ws02_preservation.cho', testContent);

      const [job] = await db.insert(backgroundJobs).values({
        jobType: 'CONVERSION',
        status: 'PENDING',
        userId: testUserId,
        inputRef: 'ws02_preservation.cho',
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
        filename: 'ws02_preservation.cho',
        targetFormat: 'LYRICS_ONLY',
      });

      await new Promise((resolve) => setTimeout(resolve, 50));
      assert.strictEqual(worker.getActiveJobsCount(), 1);

      const stopResult = await worker.stop(150);
      assert.strictEqual(stopResult.timedOut, true);
      assert.strictEqual(stopResult.activeJobsDrained, false);
      assert.strictEqual(stopResult.remainingJobsCount, 1);

      const [dbJob] = await db.select().from(backgroundJobs).where(eq(backgroundJobs.id, job.id));
      assert.strictEqual(dbJob.status, 'PROCESSING', 'El trabajo no debe ser alterado destructivamente');
      assert.ok(dbJob.leaseOwner !== null, 'El leaseOwner debe conservarse');
      assert.ok(dbJob.leaseExpiresAt !== null, 'El leaseExpiresAt debe conservarse para expiración natural');

      unblock!();
      await jobPromise.catch(() => {});
    });

    it('2.14 Bounded drain when active jobs finish within deadline (Graceful Drain)', async () => {
      const worker = new ConversionWorker(db, storage, undefined, 'cert-ws02-graceful-drain', {
        onStageReached: async (stage) => {
          if (stage === 'STAGE_B') {
            await new Promise((resolve) => setTimeout(resolve, 150));
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

      await new Promise((resolve) => setTimeout(resolve, 30));
      const stopPromise = worker.stop(2000);

      const [jobRes, stopRes] = await Promise.all([jobPromise, stopPromise]);
      assert.strictEqual(jobRes.success, true);
      assert.strictEqual(stopRes.success, true);
      assert.strictEqual(stopRes.activeJobsDrained, true);
      assert.strictEqual(worker.getActiveJobsCount(), 0);
      assert.strictEqual(worker.isActive(), false);
    });

    it('2.15 Bounded shutdown halts without indefinite hanging when active jobs exceed deadline', async () => {
      let unblock: () => void;
      const barrier = new Promise<void>((resolve) => {
        unblock = resolve;
      });

      const worker = new ConversionWorker(db, storage, undefined, 'cert-ws02-bounded-timeout', {
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
      assert.strictEqual(worker.getActiveJobsCount(), 1);

      const start = Date.now();
      const stopRes = await worker.stop(300);
      const elapsed = Date.now() - start;

      assert.strictEqual(stopRes.timedOut, true);
      assert.strictEqual(stopRes.activeJobsDrained, false);
      assert.strictEqual(worker.isActive(), false);
      assert.ok(
        elapsed >= 250 && elapsed <= 800,
        `Stop debió retornar en tiempo acotado respetando el deadline (solicitado: 300ms, duración real: ${elapsed}ms)`
      );

      unblock!();
      await jobPromise.catch(() => {});
    });

    it('2.16 Synchronization of start() awaiting an in-progress stop()', async () => {
      const worker = new ConversionWorker(db, storage, undefined, 'cert-ws02-settling-restart');
      await worker.start();
      assert.strictEqual(worker.isActive(), true);

      const stopPromise = worker.stop(200);
      assert.strictEqual(worker.getLifecycleState(), 'STOPPING');

      const startPromise = worker.start();

      const [stopRes] = await Promise.all([stopPromise, startPromise]);

      assert.strictEqual(stopRes.success, true);
      assert.strictEqual(worker.getLifecycleState(), 'RUNNING');
      assert.strictEqual(worker.isActive(), true);

      await worker.stop(500);
      assert.strictEqual(worker.getLifecycleState(), 'STOPPED');
    });

    it('2.17 Clean lifecycle state progression (IDLE -> STARTING -> RUNNING -> STOPPING -> STOPPED)', async () => {
      const worker = new ConversionWorker(db, storage, undefined, 'cert-ws02-lifecycle-states');
      assert.strictEqual(worker.getLifecycleState(), 'IDLE');

      const startPromise = worker.start();
      await startPromise;
      assert.strictEqual(worker.getLifecycleState(), 'RUNNING');

      const stopPromise = worker.stop(500);
      await stopPromise;
      assert.strictEqual(worker.getLifecycleState(), 'STOPPED');
    });

    it('2.18 Repeated start/stop cycles transition cleanly without leaks or duplicate subscriptions', async () => {
      const boss = getConversionQueue();
      const originalWork = boss.work.bind(boss);
      let workCallCount = 0;
      (boss as any).work = async (...args: any[]) => {
        workCallCount++;
        return (originalWork as any)(...args);
      };

      const worker = new ConversionWorker(db, storage, undefined, 'cert-ws02-repeated-cycles');
      try {
        for (let cycle = 1; cycle <= 3; cycle++) {
          await worker.start();
          assert.strictEqual(worker.getLifecycleState(), 'RUNNING', `Ciclo ${cycle}: debe estar RUNNING`);
          assert.strictEqual(worker.isActive(), true);
          assert.strictEqual(worker.isSubscribed(), true);

          const stopRes = await worker.stop(1000);
          assert.strictEqual(stopRes.success, true, `Ciclo ${cycle}: stop debe ser exitoso`);
          assert.strictEqual(worker.getLifecycleState(), 'STOPPED', `Ciclo ${cycle}: debe estar STOPPED`);
          assert.strictEqual(worker.getActiveJobsCount(), 0);
          assert.strictEqual(worker.isSubscribed(), false);
          assert.strictEqual(worker.isUnsubscribePending(), false);
        }
        assert.strictEqual(workCallCount, 3, 'Exactamente una suscripción por ciclo ejecutado');
      } finally {
        (boss as any).work = originalWork;
      }
    });

    it('2.27 Authoritative absence reconciliation when queue is genuinely empty in pg-boss', async () => {
      const boss = getConversionQueue();
      const originalWork = boss.work.bind(boss);
      const originalGetWipData = (boss as any).getWipData;

      (boss as any).work = async () => null;
      (boss as any).getWipData = () => []; // Cola 100% vacía en pg-boss

      const worker = new ConversionWorker(db, storage, undefined, 'cert-ws02-empty-queue-reconcile');
      try {
        await assert.rejects(async () => {
          await worker.start();
        });

        assert.strictEqual(worker.getLifecycleState(), 'ERROR');
        assert.strictEqual(worker.getRegistrationState(), 'UNCERTAIN');

        // Reconciliación sin identificador: dado que la cola está vacía, se prueba ausencia autoritativa
        const reconcileRes = await worker.reconcileRegistration(undefined, 1000, false);
        assert.strictEqual(reconcileRes.success, true);
        assert.strictEqual(reconcileRes.state, 'STOPPED');
        assert.strictEqual(worker.getLifecycleState(), 'STOPPED');
        assert.strictEqual(worker.getRegistrationState(), 'REMOVAL_CONFIRMED');
        assert.strictEqual(worker.isSubscribed(), false);
      } finally {
        (boss as any).work = originalWork;
        (boss as any).getWipData = originalGetWipData;
      }
    });

    it('2.28 Direct verification that resetLifecycle blocks uncertain registration or unconfirmed state', async () => {
      const worker = new ConversionWorker(db, storage, undefined, 'cert-ws02-reset-blocks');
      (worker as any).registrationState = 'UNCERTAIN';
      (worker as any).lifecycleState = 'ERROR';

      assert.throws(
        () => {
          worker.resetLifecycle();
        },
        (err: any) => {
          assert.strictEqual(err.name, 'WorkerLifecycleError');
          assert.ok(err.message.includes('UNCERTAIN') || err.message.includes('ERROR NO RESUELTO'));
          return true;
        }
      );

      (worker as any).registrationState = 'UNRESOLVED_ERROR';
      assert.throws(
        () => {
          worker.resetLifecycle();
        },
        (err: any) => {
          assert.strictEqual(err.name, 'WorkerLifecycleError');
          assert.ok(err.message.includes('UNCERTAIN') || err.message.includes('ERROR NO RESUELTO'));
          return true;
        }
      );
    });

    it('2.29 R331-REAL-03 [INTEGRATION]: Real recovery failure under identity loss preserves ERROR and fail-closed state without corrupting peer consumers', async () => {
      const { default: WorkerClass } = await import('../../node_modules/pg-boss/dist/worker.js');
      const boss = getConversionQueue();
      const originalWork = boss.work.bind(boss);
      const originalWorkerStop = (WorkerClass as any).prototype.stop;

      const worker = new ConversionWorker(db, storage, undefined, 'cert-r331-real-03-fail');

      let targetSubId: string | null = null;
      let injectFailure = false;

      // Boundary interceptor para forzar pérdida de identidad en el arranque
      (boss as any).work = async (...args: any[]) => {
        targetSubId = await (originalWork as any)(...args);
        return undefined; // Respuesta indefinida
      };

      try {
        await assert.rejects(async () => {
          await worker.start();
        });
        assert.strictEqual(worker.getLifecycleState(), 'ERROR');
        assert.strictEqual(worker.getRegistrationState(), 'UNCERTAIN');

        // Confirmar que el consumidor existe en getWipData() real
        const wip = (boss as any).getWipData();
        const found = wip.find((w: any) => (w.options as any)?.workerInstanceId === worker.workerId);
        assert.ok(found !== undefined, 'Consumidor debe existir en getWipData() real');

        // Inyectar fallo interno en Worker.prototype.stop exclusivamente para este targetSubId
        injectFailure = true;
        (WorkerClass as any).prototype.stop = async function (...args: any[]) {
          if (injectFailure && (this.workId === targetSubId || this.id === targetSubId)) {
            throw new Error('Fallo simulado en Worker.stop() durante reconciliación');
          }
          return originalWorkerStop.apply(this, args);
        };

        // 1. Intento de recuperación mientras offWork falla internamente:
        // Debe fallar de forma cerrada y preservar ERROR
        const recoverFailed = await worker.recover(2000);
        assert.strictEqual(recoverFailed.success, false);
        assert.strictEqual(recoverFailed.state, 'ERROR');
        assert.strictEqual(worker.getLifecycleState(), 'ERROR');
        assert.strictEqual(worker.isSubscribed(), true);

        // 2. Intento de reinicio debe ser estrictamente rechazado
        await assert.rejects(
          async () => {
            await worker.start();
          },
          (err: any) => {
            assert.strictEqual(err.name, 'WorkerLifecycleError');
            return true;
          }
        );

        // 3. Desactivar inyección de fallo y reintentar recuperación válida
        injectFailure = false;
        const recoverSuccess = await worker.recover(2000);
        assert.strictEqual(recoverSuccess.success, true);
        assert.strictEqual(recoverSuccess.state, 'STOPPED');
        assert.strictEqual(worker.getLifecycleState(), 'STOPPED');
        assert.strictEqual(worker.isSubscribed(), false);

        // 4. Verificar ausencia en getWipData() real
        const wipAfter = (boss as any).getWipData();
        const foundAfter = wipAfter.find((w: any) => (w.options as any)?.workerInstanceId === worker.workerId);
        assert.strictEqual(foundAfter, undefined, 'El consumidor debe haber sido removido');
      } finally {
        injectFailure = false;
        (WorkerClass as any).prototype.stop = originalWorkerStop;
        (boss as any).work = originalWork;
        await worker.stop(1000).catch(() => {});
      }
    });

    it('2.30 R332-30 [INTEGRATION]: Real residual consumer detection with unrelated consumer preserves fail-closed ERROR when no match found', async () => {
      const boss = getConversionQueue();
      const workerPeer = new ConversionWorker(db, storage, undefined, 'cert-r332-unrelated-peer');
      const workerTarget = new ConversionWorker(db, storage, undefined, 'cert-r332-unrelated-target');

      const originalWork = boss.work.bind(boss);
      try {
        // Iniciar consumidor legítimo en la cola
        await workerPeer.start();
        assert.strictEqual(workerPeer.getLifecycleState(), 'RUNNING');

        // Simular intento real de inicio de workerTarget donde boss.work registra pero retorna null
        // provocando transición natural por código de producción a UNCERTAIN y ERROR
        (boss as any).work = async (name: string, options: any, handler: any) => {
          if ((options as any)?.workerInstanceId === workerTarget.workerId) {
            return null;
          }
          return (originalWork as any)(name, options, handler);
        };

        await assert.rejects(
          async () => {
            await workerTarget.start();
          },
          (err: any) => {
            assert.strictEqual(err.name, 'WorkerLifecycleError');
            return true;
          }
        );

        assert.strictEqual(workerTarget.getLifecycleState(), 'ERROR');
        assert.strictEqual(workerTarget.getRegistrationState(), 'UNCERTAIN');

        // Restaurar boss.work para consultas autoritativas
        (boss as any).work = originalWork;

        // Intentar reconciliar workerTarget:
        // En pg-boss existe workerPeer en la cola CONVERSION_QUEUE_NAME, pero ninguno coincide con workerTarget.
        // Dado que la cola NO está vacía, debe fallar de forma cerrada (ERROR, UNRESOLVED_ERROR)
        // y NUNCA asumir STOPPED ni desregistrar a workerPeer
        const reconcileRes = await workerTarget.reconcileRegistration(undefined, 1000, false);
        assert.strictEqual(reconcileRes.success, false);
        assert.strictEqual(reconcileRes.state, 'ERROR');
        assert.strictEqual(workerTarget.getLifecycleState(), 'ERROR');
        assert.strictEqual(workerTarget.getRegistrationState(), 'UNRESOLVED_ERROR');

        // workerPeer continúa 100% activo y registrado en pg-boss
        assert.strictEqual(workerPeer.getLifecycleState(), 'RUNNING');
        assert.strictEqual(workerPeer.isSubscribed(), true);
      } finally {
        (boss as any).work = originalWork;
        await workerPeer.stop(1000).catch(() => {});
        await workerTarget.recover().catch(() => {});
      }
    });

    it('2.31 R332-05 [CONTRACT]: getWipData() returning array with empty object [{}] fails closed to ERROR and prevents false STOPPED', async () => {
      const boss = getConversionQueue();
      const originalGetWipData = (boss as any).getWipData;
      (boss as any).getWipData = () => [{}];

      const worker = new ConversionWorker(db, storage, undefined, 'cert-r332-05-empty-obj');
      try {
        await worker.start();
        assert.strictEqual(worker.getLifecycleState(), 'RUNNING');

        // stop() debe fallar cerrado y no reportar éxito ni STOPPED
        const stopResult = await worker.stop(1000);
        assert.strictEqual(stopResult.success, false);
        assert.strictEqual(stopResult.state, 'ERROR');
        assert.strictEqual(worker.getLifecycleState(), 'ERROR');
        assert.strictEqual(worker.getRegistrationState(), 'UNRESOLVED_ERROR');
        assert.strictEqual(worker.isSubscribed(), true, 'isQueueSubscribed no debe reportar remoción falsamente');

        // reconcileRegistration() tampoco debe asumir cola vacía
        const reconcileRes = await worker.reconcileRegistration(undefined, 1000, false);
        assert.strictEqual(reconcileRes.success, false);
        assert.strictEqual(reconcileRes.state, 'ERROR');
        assert.strictEqual(worker.getLifecycleState(), 'ERROR');
        assert.strictEqual(worker.getRegistrationState(), 'UNRESOLVED_ERROR');
      } finally {
        (boss as any).getWipData = originalGetWipData;
        await worker.recover().catch(() => {});
      }
    });

    it('2.32 R332-06 [CONTRACT]: getWipData() returning array with null entry [null] fails closed to ERROR', async () => {
      const boss = getConversionQueue();
      const originalGetWipData = (boss as any).getWipData;
      (boss as any).getWipData = () => [null];

      const worker = new ConversionWorker(db, storage, undefined, 'cert-r332-06-null-entry');
      try {
        await worker.start();
        assert.strictEqual(worker.getLifecycleState(), 'RUNNING');

        const stopResult = await worker.stop(1000);
        assert.strictEqual(stopResult.success, false);
        assert.strictEqual(stopResult.state, 'ERROR');
        assert.strictEqual(worker.getLifecycleState(), 'ERROR');
        assert.strictEqual(worker.getRegistrationState(), 'UNRESOLVED_ERROR');
      } finally {
        (boss as any).getWipData = originalGetWipData;
        await worker.recover().catch(() => {});
      }
    });

    it('2.33 R332-07 [CONTRACT]: getWipData() with missing worker ID fails closed to ERROR', async () => {
      const boss = getConversionQueue();
      const originalGetWipData = (boss as any).getWipData;
      (boss as any).getWipData = () => [
        { workId: 'w1', name: CONVERSION_QUEUE_NAME, options: {}, state: 'active' },
      ];

      const worker = new ConversionWorker(db, storage, undefined, 'cert-r332-07-missing-id');
      try {
        await worker.start();
        assert.strictEqual(worker.getLifecycleState(), 'RUNNING');

        const stopResult = await worker.stop(1000);
        assert.strictEqual(stopResult.success, false);
        assert.strictEqual(stopResult.state, 'ERROR');
        assert.strictEqual(worker.getLifecycleState(), 'ERROR');
      } finally {
        (boss as any).getWipData = originalGetWipData;
        await worker.recover().catch(() => {});
      }
    });

    it('2.34 R332-08 [CONTRACT]: getWipData() with missing queue name fails closed to ERROR', async () => {
      const boss = getConversionQueue();
      const originalGetWipData = (boss as any).getWipData;
      (boss as any).getWipData = () => [
        { id: 'id1', workId: 'w1', options: {}, state: 'active' },
      ];

      const worker = new ConversionWorker(db, storage, undefined, 'cert-r332-08-missing-queue');
      try {
        await worker.start();
        assert.strictEqual(worker.getLifecycleState(), 'RUNNING');

        const stopResult = await worker.stop(1000);
        assert.strictEqual(stopResult.success, false);
        assert.strictEqual(stopResult.state, 'ERROR');
        assert.strictEqual(worker.getLifecycleState(), 'ERROR');
      } finally {
        (boss as any).getWipData = originalGetWipData;
        await worker.recover().catch(() => {});
      }
    });

    it('2.35 R332-09 [CONTRACT]: getWipData() with invalid worker state fails closed to ERROR', async () => {
      const boss = getConversionQueue();
      const originalGetWipData = (boss as any).getWipData;
      (boss as any).getWipData = () => [
        { id: 'id1', workId: 'w1', name: CONVERSION_QUEUE_NAME, options: {}, state: 'corrupted_state' },
      ];

      const worker = new ConversionWorker(db, storage, undefined, 'cert-r332-09-bad-state');
      try {
        await worker.start();
        assert.strictEqual(worker.getLifecycleState(), 'RUNNING');

        const stopResult = await worker.stop(1000);
        assert.strictEqual(stopResult.success, false);
        assert.strictEqual(stopResult.state, 'ERROR');
        assert.strictEqual(worker.getLifecycleState(), 'ERROR');
      } finally {
        (boss as any).getWipData = originalGetWipData;
        await worker.recover().catch(() => {});
      }
    });

    it('2.36 R332-10 [CONTRACT]: Duplicate matching worker identities with conflicting workId rejects ambiguous target and fails closed', async () => {
      const boss = getConversionQueue();
      const originalGetWipData = (boss as any).getWipData;
      const worker = new ConversionWorker(db, storage, undefined, 'cert-r332-10-duplicate-matches');

      (boss as any).getWipData = () => [
        {
          id: 'id-alpha',
          workId: 'work-alpha',
          name: CONVERSION_QUEUE_NAME,
          options: { workerInstanceId: worker.workerId },
          state: 'active',
          count: 0,
          createdOn: Date.now(),
        },
        {
          id: 'id-beta',
          workId: 'work-beta',
          name: CONVERSION_QUEUE_NAME,
          options: { workerInstanceId: worker.workerId },
          state: 'active',
          count: 0,
          createdOn: Date.now(),
        },
      ];

      try {
        const reconcileRes = await worker.reconcileRegistration(undefined, 1000, false);
        assert.strictEqual(reconcileRes.success, false);
        assert.strictEqual(reconcileRes.state, 'ERROR');
        assert.strictEqual(worker.getLifecycleState(), 'ERROR');
        assert.strictEqual(worker.getRegistrationState(), 'UNRESOLVED_ERROR');
        assert.ok((reconcileRes.error as Error).message.includes('ambigua'));
      } finally {
        (boss as any).getWipData = originalGetWipData;
      }
    });

    it('2.37 R332-11 [CONTRACT]: getWipData() with malformed options fails closed to ERROR', async () => {
      const boss = getConversionQueue();
      const originalGetWipData = (boss as any).getWipData;
      (boss as any).getWipData = () => [
        { id: 'id1', workId: 'w1', name: CONVERSION_QUEUE_NAME, options: 'invalid-options', state: 'active' },
      ];

      const worker = new ConversionWorker(db, storage, undefined, 'cert-r332-11-bad-options');
      try {
        await worker.start();
        assert.strictEqual(worker.getLifecycleState(), 'RUNNING');

        const stopResult = await worker.stop(1000);
        assert.strictEqual(stopResult.success, false);
        assert.strictEqual(stopResult.state, 'ERROR');
        assert.strictEqual(worker.getLifecycleState(), 'ERROR');
      } finally {
        (boss as any).getWipData = originalGetWipData;
        await worker.recover().catch(() => {});
      }
    });

    it('2.38 R332-12 [CONTRACT]: getWipData() with whitespace-only id or workId fails closed to ERROR', async () => {
      const boss = getConversionQueue();
      const originalGetWipData = (boss as any).getWipData;
      (boss as any).getWipData = () => [
        { id: '   ', workId: 'w1', name: CONVERSION_QUEUE_NAME, options: {}, state: 'active' },
      ];

      const worker = new ConversionWorker(db, storage, undefined, 'cert-r332-12-whitespace-id');
      try {
        await worker.start();
        assert.strictEqual(worker.getLifecycleState(), 'RUNNING');

        const stopResult = await worker.stop(1000);
        assert.strictEqual(stopResult.success, false);
        assert.strictEqual(stopResult.state, 'ERROR');
        assert.strictEqual(worker.getLifecycleState(), 'ERROR');
      } finally {
        (boss as any).getWipData = originalGetWipData;
        await worker.recover().catch(() => {});
      }
    });

    it('2.39 R332-15 [CONTRACT]: reconcileRegistration() rejects ambiguous target subscription ID with divergent workId', async () => {
      const boss = getConversionQueue();
      const originalGetWipData = (boss as any).getWipData;
      const worker = new ConversionWorker(db, storage, undefined, 'cert-r332-15-ambiguous-target');

      (boss as any).getWipData = () => [
        {
          id: 'shared-id',
          workId: 'work-1',
          name: CONVERSION_QUEUE_NAME,
          options: {},
          state: 'active',
          count: 0,
          createdOn: Date.now(),
        },
        {
          id: 'shared-id',
          workId: 'work-2',
          name: CONVERSION_QUEUE_NAME,
          options: {},
          state: 'active',
          count: 0,
          createdOn: Date.now(),
        },
      ];

      try {
        const reconcileRes = await worker.reconcileRegistration('shared-id', 1000, false);
        assert.strictEqual(reconcileRes.success, false);
        assert.strictEqual(reconcileRes.state, 'ERROR');
        assert.strictEqual(worker.getLifecycleState(), 'ERROR');
        assert.strictEqual(worker.getRegistrationState(), 'UNRESOLVED_ERROR');
        assert.ok((reconcileRes.error as Error).message.includes('ambiguo'));
      } finally {
        (boss as any).getWipData = originalGetWipData;
      }
    });

    it('2.40 R332-17 [CONTRACT]: reconcileRegistration() rejects invalid or whitespace-only reconciledSubscriptionId', async () => {
      const worker = new ConversionWorker(db, storage, undefined, 'cert-r332-17-invalid-id');

      const invalidIds = ['', '   ', '   \t  '];
      for (const badId of invalidIds) {
        const reconcileRes = await worker.reconcileRegistration(badId, 1000, false);
        assert.strictEqual(reconcileRes.success, false);
        assert.strictEqual(reconcileRes.state, 'ERROR');
        assert.strictEqual(worker.getLifecycleState(), 'ERROR');
        assert.strictEqual(worker.getRegistrationState(), 'UNRESOLVED_ERROR');
        assert.ok((reconcileRes.error as Error).message.includes('inválido o está en blanco'));
      }
    });

    // ===========================================================================
    // R3.3.3: Strict pg-boss WIP Contract Hardening & Telemetry Suite (R333-01 to R333-20)
    // ===========================================================================
    it('2.41 R333-01 [UNIT]: Missing count fails closed with WorkerShutdownError', () => {
      const base = { id: 'w1', workId: 'w1', name: CONVERSION_QUEUE_NAME, options: {}, state: 'active', createdOn: Date.now() };
      assert.throws(
        () => ConversionWorker.validateWipData([base]),
        (err: any) => {
          assert.strictEqual(err.name, 'WorkerShutdownError');
          assert.ok(err.message.includes('count'));
          return true;
        }
      );
    });

    it('2.42 R333-02 [UNIT]: Missing createdOn fails closed with WorkerShutdownError', () => {
      const base = { id: 'w1', workId: 'w1', name: CONVERSION_QUEUE_NAME, options: {}, state: 'active', count: 0 };
      assert.throws(
        () => ConversionWorker.validateWipData([base]),
        (err: any) => {
          assert.strictEqual(err.name, 'WorkerShutdownError');
          assert.ok(err.message.includes('createdOn'));
          return true;
        }
      );
    });

    it('2.43 R333-03 [UNIT]: NaN count fails closed with WorkerShutdownError', () => {
      const base = { id: 'w1', workId: 'w1', name: CONVERSION_QUEUE_NAME, options: {}, state: 'active', count: NaN, createdOn: Date.now() };
      assert.throws(
        () => ConversionWorker.validateWipData([base]),
        (err: any) => {
          assert.strictEqual(err.name, 'WorkerShutdownError');
          assert.ok(err.message.includes('count'));
          return true;
        }
      );
    });

    it('2.44 R333-04 [UNIT]: Infinity count fails closed with WorkerShutdownError', () => {
      const base = { id: 'w1', workId: 'w1', name: CONVERSION_QUEUE_NAME, options: {}, state: 'active', count: Infinity, createdOn: Date.now() };
      assert.throws(
        () => ConversionWorker.validateWipData([base]),
        (err: any) => {
          assert.strictEqual(err.name, 'WorkerShutdownError');
          assert.ok(err.message.includes('count'));
          return true;
        }
      );
    });

    it('2.45 R333-05 [UNIT]: Negative count fails closed with WorkerShutdownError', () => {
      const base = { id: 'w1', workId: 'w1', name: CONVERSION_QUEUE_NAME, options: {}, state: 'active', count: -1, createdOn: Date.now() };
      assert.throws(
        () => ConversionWorker.validateWipData([base]),
        (err: any) => {
          assert.strictEqual(err.name, 'WorkerShutdownError');
          assert.ok(err.message.includes('count'));
          return true;
        }
      );
    });

    it('2.46 R333-06 [UNIT]: Fractional count fails closed with WorkerShutdownError', () => {
      const base = { id: 'w1', workId: 'w1', name: CONVERSION_QUEUE_NAME, options: {}, state: 'active', count: 2.5, createdOn: Date.now() };
      assert.throws(
        () => ConversionWorker.validateWipData([base]),
        (err: any) => {
          assert.strictEqual(err.name, 'WorkerShutdownError');
          assert.ok(err.message.includes('count'));
          return true;
        }
      );
    });

    it('2.47 R333-07 [UNIT]: NaN createdOn fails closed with WorkerShutdownError', () => {
      const base = { id: 'w1', workId: 'w1', name: CONVERSION_QUEUE_NAME, options: {}, state: 'active', count: 0, createdOn: NaN };
      assert.throws(
        () => ConversionWorker.validateWipData([base]),
        (err: any) => {
          assert.strictEqual(err.name, 'WorkerShutdownError');
          assert.ok(err.message.includes('createdOn'));
          return true;
        }
      );
    });

    it('2.48 R333-08 [UNIT]: Infinity createdOn fails closed with WorkerShutdownError', () => {
      const base = { id: 'w1', workId: 'w1', name: CONVERSION_QUEUE_NAME, options: {}, state: 'active', count: 0, createdOn: Infinity };
      assert.throws(
        () => ConversionWorker.validateWipData([base]),
        (err: any) => {
          assert.strictEqual(err.name, 'WorkerShutdownError');
          assert.ok(err.message.includes('createdOn'));
          return true;
        }
      );
    });

    it('2.49 R333-09 [UNIT]: Invalid lastFetchedOn fails closed with WorkerShutdownError', () => {
      const invalid = ['not-a-number', NaN, Infinity, -Infinity, {}];
      for (const val of invalid) {
        const base = { id: 'w1', workId: 'w1', name: CONVERSION_QUEUE_NAME, options: {}, state: 'active', count: 0, createdOn: Date.now(), lastFetchedOn: val };
        assert.throws(
          () => ConversionWorker.validateWipData([base]),
          (err: any) => {
            assert.strictEqual(err.name, 'WorkerShutdownError');
            assert.ok(err.message.includes('lastFetchedOn'));
            return true;
          }
        );
      }
    });

    it('2.50 R333-10 [UNIT]: Invalid lastJobStartedOn fails closed with WorkerShutdownError', () => {
      const invalid = ['invalid-ts', NaN, Infinity, {}];
      for (const val of invalid) {
        const base = { id: 'w1', workId: 'w1', name: CONVERSION_QUEUE_NAME, options: {}, state: 'active', count: 0, createdOn: Date.now(), lastJobStartedOn: val };
        assert.throws(
          () => ConversionWorker.validateWipData([base]),
          (err: any) => {
            assert.strictEqual(err.name, 'WorkerShutdownError');
            assert.ok(err.message.includes('lastJobStartedOn'));
            return true;
          }
        );
      }
    });

    it('2.51 R333-11 [UNIT]: Invalid lastJobEndedOn fails closed with WorkerShutdownError', () => {
      const invalid = ['invalid-ts', NaN, Infinity, {}];
      for (const val of invalid) {
        const base = { id: 'w1', workId: 'w1', name: CONVERSION_QUEUE_NAME, options: {}, state: 'active', count: 0, createdOn: Date.now(), lastJobEndedOn: val };
        assert.throws(
          () => ConversionWorker.validateWipData([base]),
          (err: any) => {
            assert.strictEqual(err.name, 'WorkerShutdownError');
            assert.ok(err.message.includes('lastJobEndedOn'));
            return true;
          }
        );
      }
    });

    it('2.52 R333-12 [UNIT]: Invalid lastJobDuration fails closed with WorkerShutdownError', () => {
      const invalid = ['invalid-duration', NaN, Infinity, {}];
      for (const val of invalid) {
        const base = { id: 'w1', workId: 'w1', name: CONVERSION_QUEUE_NAME, options: {}, state: 'active', count: 0, createdOn: Date.now(), lastJobDuration: val };
        assert.throws(
          () => ConversionWorker.validateWipData([base]),
          (err: any) => {
            assert.strictEqual(err.name, 'WorkerShutdownError');
            assert.ok(err.message.includes('lastJobDuration'));
            return true;
          }
        );
      }
    });

    it('2.53 R333-13 [UNIT]: Invalid lastError type fails closed with WorkerShutdownError', () => {
      const invalid = ['error-string', 500, true, [1, 2]];
      for (const val of invalid) {
        const base = { id: 'w1', workId: 'w1', name: CONVERSION_QUEUE_NAME, options: {}, state: 'active', count: 0, createdOn: Date.now(), lastError: val };
        assert.throws(
          () => ConversionWorker.validateWipData([base]),
          (err: any) => {
            assert.strictEqual(err.name, 'WorkerShutdownError');
            assert.ok(err.message.includes('lastError'));
            return true;
          }
        );
      }
    });

    it('2.54 R333-14 [UNIT]: Invalid lastErrorOn fails closed with WorkerShutdownError', () => {
      const invalid = ['error-ts', NaN, Infinity, {}];
      for (const val of invalid) {
        const base = { id: 'w1', workId: 'w1', name: CONVERSION_QUEUE_NAME, options: {}, state: 'active', count: 0, createdOn: Date.now(), lastErrorOn: val };
        assert.throws(
          () => ConversionWorker.validateWipData([base]),
          (err: any) => {
            assert.strictEqual(err.name, 'WorkerShutdownError');
            assert.ok(err.message.includes('lastErrorOn'));
            return true;
          }
        );
      }
    });

    it('2.55 R333-15 [UNIT]: Valid nullable telemetry values are accepted without fabrication', () => {
      const validPopulated = {
        id: 'w1',
        workId: 'w1',
        name: CONVERSION_QUEUE_NAME,
        options: { workerInstanceId: 'inst-1' },
        state: 'active',
        count: 3,
        createdOn: 1700000000000,
        lastFetchedOn: 1700000001000,
        lastJobStartedOn: 1700000002000,
        lastJobEndedOn: 1700000003000,
        lastJobDuration: 1000,
        lastError: { message: 'db timeout', code: 'ETIMEDOUT' },
        lastErrorOn: 1700000004000,
      };
      const res1 = ConversionWorker.validateWipData([validPopulated]);
      assert.strictEqual(res1.length, 1);
      assert.strictEqual(res1[0].count, 3);
      assert.strictEqual(res1[0].createdOn, 1700000000000);
      assert.strictEqual(res1[0].lastJobDuration, 1000);
      assert.deepStrictEqual(res1[0].lastError, { message: 'db timeout', code: 'ETIMEDOUT' });

      const validNulls = {
        id: 'w2',
        workId: 'w2',
        name: CONVERSION_QUEUE_NAME,
        options: {},
        state: 'active',
        count: 0,
        createdOn: 1700000000000,
        lastFetchedOn: null,
        lastJobStartedOn: null,
        lastJobEndedOn: null,
        lastJobDuration: null,
        lastError: null,
        lastErrorOn: null,
      };
      const res2 = ConversionWorker.validateWipData([validNulls]);
      assert.strictEqual(res2.length, 1);
      assert.strictEqual(res2[0].lastFetchedOn, null);
      assert.strictEqual(res2[0].lastError, null);
    });

    it('2.56 R333-16 [UNIT]: Valid complete WIP records from pg-boss 12.38.1 are accepted', () => {
      const boss = getConversionQueue();
      const wip = (boss as any).getWipData();
      assert.ok(Array.isArray(wip));
      const validated = ConversionWorker.validateWipData(wip);
      assert.ok(Array.isArray(validated));
    });

    it('2.57 R333-17 [UNIT]: Any malformed record in a mixed array rejects the entire array', () => {
      const validRecord = {
        id: 'w-valid',
        workId: 'w-valid',
        name: CONVERSION_QUEUE_NAME,
        options: {},
        state: 'active',
        count: 0,
        createdOn: 1700000000000,
        lastFetchedOn: null,
      };
      const malformedRecord = {
        id: 'w-malformed',
        workId: 'w-malformed',
        name: CONVERSION_QUEUE_NAME,
        options: {},
        state: 'active',
        count: NaN, // Invalid!
        createdOn: 1700000000000,
      };
      assert.throws(
        () => ConversionWorker.validateWipData([validRecord, malformedRecord]),
        (err: any) => {
          assert.strictEqual(err.name, 'WorkerShutdownError');
          assert.ok(err.message.includes('count'));
          return true;
        }
      );
    });

    it('2.58 R333-18 [CONTRACT]: Malformed WIP metrics never transition worker to STOPPED', async () => {
      const boss = getConversionQueue();
      const originalGetWipData = (boss as any).getWipData;
      (boss as any).getWipData = () => [
        {
          id: 'w1',
          workId: 'w1',
          name: CONVERSION_QUEUE_NAME,
          options: {},
          state: 'active',
          count: -5, // Negative count
          createdOn: Date.now(),
        },
      ];
      const worker = new ConversionWorker(db, storage, undefined, 'cert-r333-18-stop-reject');
      try {
        await worker.start();
        const stopRes = await worker.stop(1000);
        assert.strictEqual(stopRes.success, false);
        assert.strictEqual(stopRes.state, 'ERROR');
        assert.strictEqual(worker.getLifecycleState(), 'ERROR');
      } finally {
        (boss as any).getWipData = originalGetWipData;
        await worker.recover().catch(() => {});
      }
    });

    it('2.59 R333-19 [CONTRACT]: Malformed WIP metrics never set registrationState to REMOVAL_CONFIRMED', async () => {
      const boss = getConversionQueue();
      const originalGetWipData = (boss as any).getWipData;
      (boss as any).getWipData = () => [
        {
          id: 'w1',
          workId: 'w1',
          name: CONVERSION_QUEUE_NAME,
          options: {},
          state: 'active',
          count: 0,
          createdOn: Infinity, // Infinity createdOn
        },
      ];
      const worker = new ConversionWorker(db, storage, undefined, 'cert-r333-19-removal-reject');
      try {
        await worker.start();
        await worker.stop(1000);
        assert.strictEqual(worker.getRegistrationState(), 'UNRESOLVED_ERROR');
        assert.notStrictEqual(worker.getRegistrationState(), 'REMOVAL_CONFIRMED');
      } finally {
        (boss as any).getWipData = originalGetWipData;
        await worker.recover().catch(() => {});
      }
    });

    it('2.60 R333-20 [INTEGRATION]: Valid complete WIP data preserves targeted recovery and peer isolation in real pg-boss', async () => {
      const boss = getConversionQueue();
      const workerPeer = new ConversionWorker(db, storage, undefined, 'cert-r333-20-peer');
      const workerTarget = new ConversionWorker(db, storage, undefined, 'cert-r333-20-target');

      try {
        await workerPeer.start();
        await workerTarget.start();

        assert.strictEqual(workerPeer.getLifecycleState(), 'RUNNING');
        assert.strictEqual(workerTarget.getLifecycleState(), 'RUNNING');

        // Detener targeted workerTarget: getWipData real devuelve datos completos
        const stopRes = await workerTarget.stop(2000);
        assert.strictEqual(stopRes.success, true);
        assert.strictEqual(stopRes.state, 'STOPPED');
        assert.strictEqual(workerTarget.getLifecycleState(), 'STOPPED');
        assert.strictEqual(workerTarget.getRegistrationState(), 'REMOVAL_CONFIRMED');

        // workerPeer continúa 100% activo y registrado en pg-boss
        assert.strictEqual(workerPeer.getLifecycleState(), 'RUNNING');
        assert.strictEqual(workerPeer.isSubscribed(), true);
      } finally {
        await workerPeer.stop(1000).catch(() => {});
        await workerTarget.stop(1000).catch(() => {});
      }
    });
  });

  // ===========================================================================
  // WS03: REAL PERIODIC RECOVERY AND MUTUAL EXCLUSION
  // ===========================================================================
  describe('WS03 — Real Periodic Recovery & Mutual Exclusion', () => {
    it('3.1 should execute multiple periodic recovery cycles over time (at least 2 observed periodic cycles)', async () => {
      // Iniciar worker con intervalo periódico muy corto (60ms) para observar al menos 2 ciclos periódicos reales
      const worker = new ConversionWorker(db, storage, undefined, 'cert-ws03-periodic', {
        recoveryIntervalMs: 60,
      });

      await worker.start();
      assert.strictEqual(worker.isActive(), true);
      assert.strictEqual(worker.getStartupRecoveryCount(), 1, 'Debe haber ejecutado exactamente 1 recuperación al inicio');

      // Esperar activamente hasta observar al menos 2 ciclos periódicos (acotado a 1500ms)
      const startWait = Date.now();
      while (worker.getPeriodicRecoveryCycleCount() < 2 && Date.now() - startWait < 1500) {
        await new Promise((resolve) => setTimeout(resolve, 20));
      }

      const periodicCycles = worker.getPeriodicRecoveryCycleCount();
      await worker.stop(1000);

      assert.ok(
        periodicCycles >= 2,
        `Se debieron observar al menos 2 ciclos de recuperación periódica (observados: ${periodicCycles})`
      );
    });

    it('3.2 should enforce in-process mutual exclusion to prevent overlapping recovery runs', async () => {
      const worker = new ConversionWorker(db, storage, undefined, 'cert-ws03-mutex');

      let releaseRecoveryBarrier!: () => void;
      const recoveryBarrier = new Promise<void>((resolve) => {
        releaseRecoveryBarrier = resolve;
      });

      const originalSelect = db.select.bind(db);
      let intercepted = false;

      (worker as any).db = {
        ...db,
        select: (...args: any[]) => {
          if (!intercepted) {
            intercepted = true;
            return {
              from: () => ({
                where: async () => {
                  await recoveryBarrier; // Pausar ejecución 1 dentro de la sección crítica
                  return [];
                },
              }),
            };
          }
          return (originalSelect as any)(...args);
        },
      };

      // Iniciar ejecución 1 que quedará pausada en la barrera dentro de recoverStaleJobs
      const run1 = worker.recoverStaleJobs();

      // Permitir que run1 ingrese a recoverStaleJobs y adquiera isRecovering = true
      await new Promise((resolve) => setTimeout(resolve, 20));
      assert.strictEqual(worker.isRecoveryActive(), true, 'isRecovering debe estar activo');

      // Ejecución 2 llamada concurrentemente mientras run1 está dentro del mutex
      const recovered2 = await worker.recoverStaleJobs();
      assert.strictEqual(recovered2, 0, 'La ejecución concurrente 2 debe retornar 0 de inmediato por exclusión mutua');

      // Liberar barrera de ejecución 1
      releaseRecoveryBarrier();
      const recovered1 = await run1;

      assert.strictEqual(recovered1, 0);
      assert.strictEqual(worker.isRecoveryActive(), false, 'isRecovering debe ser liberado tras completar run1');
    });

    it('3.3 should be resilient to errors in recovery, release mutex in finally, and continue subsequent cycles', async () => {
      let callCount = 0;
      let secondCycleDone = false;
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
        try {
          return await originalRecover();
        } finally {
          secondCycleDone = true;
        }
      };

      await worker.start();
      // Esperar activamente hasta que el ciclo subsecuente culmine completamente (acotado a 2000ms)
      const startWait = Date.now();
      while (!secondCycleDone && Date.now() - startWait < 2000) {
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      await worker.stop(1000);

      assert.ok(callCount >= 2, `Debió reintentar y ejecutar ciclos subsecuentes (llamadas: ${callCount})`);
      assert.strictEqual(worker.isRecoveryActive(), false, 'Mutex debe estar libre tras salir de error');
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

    it('3.6 should NOT reclaim jobs with active (unexpired) leases in PROCESSING status', async () => {
      const activeLeaseExpires = new Date(Date.now() + 120_000); // 2 minutos en el futuro
      const [activeJob] = await db
        .insert(backgroundJobs)
        .values({
          jobType: 'CONVERSION',
          status: 'PROCESSING',
          progress: 40,
          userId: testUserId,
          inputRef: 'active_lease_job.cho',
          leaseOwner: 'worker_currently_active',
          leaseToken: 'token_currently_active',
          leaseExpiresAt: activeLeaseExpires,
          attempts: 1,
          maxAttempts: 3,
        })
        .returning();
      createdJobIds.push(activeJob.id);

      const worker = new ConversionWorker(db, storage, undefined, 'cert-ws03-active-lease');
      const reclaimed = await worker.recoverStaleJobs();

      const [checkedJob] = await db.select().from(backgroundJobs).where(eq(backgroundJobs.id, activeJob.id));
      assert.strictEqual(checkedJob.status, 'PROCESSING', 'El trabajo activo no debe ser alterado');
      assert.strictEqual(checkedJob.leaseOwner, 'worker_currently_active');
      assert.strictEqual(checkedJob.leaseToken, 'token_currently_active');
    });

    it('3.7 should NEVER overwrite or modify terminal jobs (COMPLETED, CANCELLED, FAILED)', async () => {
      const pastDate = new Date(Date.now() - 100_000);
      const [completedJob] = await db
        .insert(backgroundJobs)
        .values({
          jobType: 'CONVERSION',
          status: 'COMPLETED',
          progress: 100,
          userId: testUserId,
          inputRef: 'terminal_completed.cho',
          leaseExpiresAt: pastDate,
        })
        .returning();
      const [failedJob] = await db
        .insert(backgroundJobs)
        .values({
          jobType: 'CONVERSION',
          status: 'FAILED',
          progress: 100,
          userId: testUserId,
          inputRef: 'terminal_failed.cho',
          leaseExpiresAt: pastDate,
        })
        .returning();
      const [cancelledJob] = await db
        .insert(backgroundJobs)
        .values({
          jobType: 'CONVERSION',
          status: 'CANCELLED',
          progress: 50,
          userId: testUserId,
          inputRef: 'terminal_cancelled.cho',
          leaseExpiresAt: pastDate,
        })
        .returning();
      createdJobIds.push(completedJob.id, failedJob.id, cancelledJob.id);

      const worker = new ConversionWorker(db, storage, undefined, 'cert-ws03-terminal-jobs');
      await worker.recoverStaleJobs();

      const [cJob] = await db.select().from(backgroundJobs).where(eq(backgroundJobs.id, completedJob.id));
      const [fJob] = await db.select().from(backgroundJobs).where(eq(backgroundJobs.id, failedJob.id));
      const [xJob] = await db.select().from(backgroundJobs).where(eq(backgroundJobs.id, cancelledJob.id));

      assert.strictEqual(cJob.status, 'COMPLETED');
      assert.strictEqual(fJob.status, 'FAILED');
      assert.strictEqual(xJob.status, 'CANCELLED');
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

    it('4.7 exists() must return true for existing file, false on ENOENT, and throw StorageReadError on EACCES', async () => {
      const testContent = Buffer.from('archivo para verificar existencia');
      const saveRes = await storage.save('test_exists.txt', testContent);

      // Archivo existente
      const existsTrue = await storage.exists(saveRes.storageKey);
      assert.strictEqual(existsTrue, true, 'exists() debe retornar true para archivo existente');

      // Archivo no existente (ENOENT)
      const existsFalse = await storage.exists('archivo_inexistente_enoent.txt');
      assert.strictEqual(existsFalse, false, 'exists() debe retornar false cuando fs.access lanza ENOENT');

      // Error de permisos simulado (EACCES)
      const originalAccess = fs.promises.access;
      (fs.promises as any).access = async () => {
        const err: any = new Error('EACCES: permission denied, access');
        err.code = 'EACCES';
        throw err;
      };

      try {
        await assert.rejects(
          async () => {
            await storage.exists('archivo_con_permiso_denegado.txt');
          },
          (err: any) => {
            assert.ok(err instanceof StorageReadError, 'exists() debe lanzar StorageReadError en EACCES');
            assert.match(err.message, /Fallo al verificar existencia en almacenamiento/);
            return true;
          }
        );
      } finally {
        fs.promises.access = originalAccess;
      }
    });

    it('4.8 exists() must throw ValidationError on Path Traversal attempt', async () => {
      await assert.rejects(
        async () => {
          await storage.exists('../../etc/passwd');
        },
        (err: any) => {
          assert.ok(err instanceof ValidationError, 'exists() debe lanzar ValidationError ante Path Traversal');
          assert.match(err.message, /Violación de seguridad: Intento de Path Traversal detectado/);
          return true;
        }
      );
    });

    it('4.9 delete() must return true on deletion, false on ENOENT, and throw StorageDeleteError on EACCES', async () => {
      const testContent = Buffer.from('archivo para eliminar');
      const saveRes = await storage.save('test_delete.txt', testContent);

      // Eliminar archivo existente
      const deletedTrue = await storage.delete(saveRes.storageKey);
      assert.strictEqual(deletedTrue, true, 'delete() debe retornar true tras eliminar el archivo');

      // Eliminar archivo que ya no existe (ENOENT)
      const deletedFalse = await storage.delete(saveRes.storageKey);
      assert.strictEqual(deletedFalse, false, 'delete() debe retornar false cuando el archivo no existe (ENOENT)');

      // Error de permisos simulado (EACCES)
      const originalUnlink = fs.promises.unlink;
      (fs.promises as any).unlink = async () => {
        const err: any = new Error('EACCES: permission denied, unlink');
        err.code = 'EACCES';
        throw err;
      };

      try {
        await assert.rejects(
          async () => {
            await storage.delete('archivo_no_borrable.txt');
          },
          (err: any) => {
            assert.ok(err instanceof StorageDeleteError, 'delete() debe lanzar StorageDeleteError en EACCES');
            assert.ok(err instanceof StorageReadError, 'StorageDeleteError debe heredar de StorageReadError');
            assert.match(err.message, /Fallo al eliminar archivo en almacenamiento/);
            return true;
          }
        );
      } finally {
        fs.promises.unlink = originalUnlink;
      }
    });

    it('4.10 delete() must throw ValidationError on Path Traversal attempt', async () => {
      await assert.rejects(
        async () => {
          await storage.delete('../../etc/shadow');
        },
        (err: any) => {
          assert.ok(err instanceof ValidationError, 'delete() debe lanzar ValidationError ante Path Traversal');
          assert.match(err.message, /Violación de seguridad: Intento de Path Traversal detectado/);
          return true;
        }
      );
    });
  });
});
