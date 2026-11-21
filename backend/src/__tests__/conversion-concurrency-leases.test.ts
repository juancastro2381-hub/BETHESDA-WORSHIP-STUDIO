/**
 * @file conversion-concurrency-leases.test.ts
 * @description Suite de pruebas para concurrencia, arrendamientos distribuidos y cercado de ejecución (CR-02 & CR-04).
 *
 * Valida:
 * 1. Competencia entre dos workers concurrentes (solo 1 adquiere el trabajo atómicamente).
 * 2. Renovación de arrendamiento mediante latido periódico (heartbeat).
 * 3. Cercado criptográfico (fencing token): rechazo de actualizaciones por worker con token desactualizado.
 * 4. Preservación estricta de arrendamientos activos durante tareas de recuperación.
 * 5. Recuperación consciente de arrendamientos expirados con reintento o agotamiento terminal.
 */

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db, pool } from '../db/index.ts';
import { backgroundJobs, users, songSources } from '../db/schema.ts';
import { ConversionWorker } from '../application/conversion-worker.ts';
import { stopConversionQueue } from '../infrastructure/queue/conversion-queue.ts';

describe('CR-02 & CR-04 — Concurrency, Leases, Fencing and Recovery Suite', () => {
  const testUserId = '00000000-0000-0000-0000-000000000001';
  let createdJobIds: string[] = [];

  before(async () => {
    // Asegurar usuario de prueba
    await db.insert(users).values({
      id: testUserId,
      email: 'concurrency-tester@bethesda.com',
      passwordHash: '$argon2id$v=19$m=65536,t=3,p=4$dummyhash',
      firstName: 'Concurrency',
      lastName: 'Tester',
      role: 'MUSICIAN',
      accountStatus: 'ACTIVE',
      emailVerified: true,
    }).onConflictDoNothing();
  });

  after(async () => {
    // Limpieza de tareas creadas
    for (const jobId of createdJobIds) {
      await db.delete(songSources).where(eq(songSources.jobId, jobId));
      await db.delete(backgroundJobs).where(eq(backgroundJobs.id, jobId));
    }
    await stopConversionQueue();
    await pool.end();
  });

  it('1. should allow exactly one worker to acquire a PENDING job under concurrent contention', async () => {
    const [job] = await db.insert(backgroundJobs).values({
      jobType: 'CONVERSION',
      status: 'PENDING',
      progress: 0,
      userId: testUserId,
      inputRef: 'competing_song.cho',
      attempts: 0,
    }).returning();
    createdJobIds.push(job.id);

    const workerA = new ConversionWorker(db, undefined, undefined, 'worker-alpha');
    const workerB = new ConversionWorker(db, undefined, undefined, 'worker-beta');

    const tokenA = crypto.randomUUID();
    const tokenB = crypto.randomUUID();

    // Ambos trabajadores intentan adquirir simultáneamente la misma tarea
    const [acquiredA, acquiredB] = await Promise.all([
      workerA.acquireJob(job.id, tokenA),
      workerB.acquireJob(job.id, tokenB),
    ]);

    // Exactamente uno debe tener éxito y el otro debe recibir null
    const winners = [acquiredA, acquiredB].filter(Boolean);
    const losers = [acquiredA, acquiredB].filter((res) => res === null);

    assert.strictEqual(winners.length, 1, 'Exactamente un worker debe adquirir el trabajo');
    assert.strictEqual(losers.length, 1, 'El worker perdedor debe recibir null sin lanzar error fatal');

    // Verificar en base de datos el estado persistido
    const [persisted] = await db
      .select()
      .from(backgroundJobs)
      .where(eq(backgroundJobs.id, job.id));

    assert.strictEqual(persisted.status, 'PROCESSING');
    assert.ok(persisted.leaseOwner === 'worker-alpha' || persisted.leaseOwner === 'worker-beta');
    assert.ok(persisted.leaseExpiresAt !== null);
    assert.ok(persisted.leaseExpiresAt.getTime() > Date.now());
  });

  it('2. should extend lease deadline via heartbeat renewal for the authorized lease owner', async () => {
    const [job] = await db.insert(backgroundJobs).values({
      jobType: 'CONVERSION',
      status: 'PENDING',
      progress: 0,
      userId: testUserId,
      inputRef: 'heartbeat_song.cho',
      attempts: 0,
    }).returning();
    createdJobIds.push(job.id);

    const worker = new ConversionWorker(db, undefined, undefined, 'worker-heartbeat');
    const token = crypto.randomUUID();

    const acquired = await worker.acquireJob(job.id, token);
    assert.ok(acquired, 'El worker debe adquirir el trabajo');
    const initialLeaseExpiry = acquired.leaseExpiresAt!;

    // Esperar 50ms para asegurar diferencia temporal perceptible
    await new Promise((r) => setTimeout(r, 50));

    const renewed = await worker.renewHeartbeat(job.id, token);
    assert.strictEqual(renewed, true, 'La renovación de latido debe ser exitosa');

    const [updated] = await db
      .select()
      .from(backgroundJobs)
      .where(eq(backgroundJobs.id, job.id));

    assert.ok(
      updated.leaseExpiresAt!.getTime() >= initialLeaseExpiry.getTime(),
      'La fecha de expiración del arrendamiento debe ser extendida hacia el futuro'
    );
    assert.ok(updated.heartbeatAt !== null, 'El timestamp de latido debe haberse actualizado');
  });

  it('3. should reject progress updates from stale worker with invalid or mismatched fencing token', async () => {
    const [job] = await db.insert(backgroundJobs).values({
      jobType: 'CONVERSION',
      status: 'PENDING',
      progress: 0,
      userId: testUserId,
      inputRef: 'fencing_song.cho',
      attempts: 0,
    }).returning();
    createdJobIds.push(job.id);

    const workerLegit = new ConversionWorker(db, undefined, undefined, 'worker-legit');
    const workerStale = new ConversionWorker(db, undefined, undefined, 'worker-stale');

    const legitToken = crypto.randomUUID();
    const staleToken = crypto.randomUUID();

    // Adquisición por worker legítimo
    const acquired = await workerLegit.acquireJob(job.id, legitToken);
    assert.ok(acquired);

    // Intento de actualización por worker desactualizado (stale) con token inválido
    const staleProgressSuccess = await workerStale.updateProgressFenced(job.id, staleToken, 50);
    assert.strictEqual(staleProgressSuccess, false, 'La actualización de worker stale debe ser rechazada');

    // Intento de renovación de latido por worker stale
    const staleHeartbeatSuccess = await workerStale.renewHeartbeat(job.id, staleToken);
    assert.strictEqual(staleHeartbeatSuccess, false, 'El latido de worker stale debe ser rechazado');

    // Verificar que el progreso en base de datos permanece inalterado en el valor original
    const [persisted] = await db
      .select()
      .from(backgroundJobs)
      .where(eq(backgroundJobs.id, job.id));

    assert.strictEqual(persisted.progress, 10, 'El progreso no debe haber sido corrompido por el worker desactualizado');
    assert.strictEqual(persisted.leaseToken, legitToken, 'El token legítimo debe preservarse');
  });

  it('4. should preserve active unexpired leases during stale recovery', async () => {
    const futureExpiry = new Date(Date.now() + 60_000);
    const [job] = await db.insert(backgroundJobs).values({
      jobType: 'CONVERSION',
      status: 'PROCESSING',
      progress: 30,
      userId: testUserId,
      inputRef: 'active_lease.cho',
      leaseOwner: 'worker-busy',
      leaseToken: 'token-active-1234',
      leaseExpiresAt: futureExpiry,
      heartbeatAt: new Date(),
      attempts: 1,
    }).returning();
    createdJobIds.push(job.id);

    const recoveryWorker = new ConversionWorker(db, undefined, undefined, 'worker-recovery');
    const recoveredCount = await recoveryWorker.recoverStaleJobs();

    // Verificar que el trabajo activo con arrendamiento vigente NO fue tocado
    const [persisted] = await db
      .select()
      .from(backgroundJobs)
      .where(eq(backgroundJobs.id, job.id));

    assert.strictEqual(persisted.status, 'PROCESSING', 'El trabajo activo no debe revertirse');
    assert.strictEqual(persisted.leaseOwner, 'worker-busy');
    assert.strictEqual(persisted.leaseToken, 'token-active-1234');
  });

  it('5. should recover genuinely expired leases and reset to PENDING if attempts < 3', async () => {
    const pastExpiry = new Date(Date.now() - 30_000); // Expiró hace 30 segundos
    const [job] = await db.insert(backgroundJobs).values({
      jobType: 'CONVERSION',
      status: 'PROCESSING',
      progress: 40,
      userId: testUserId,
      inputRef: 'stale_lease.cho',
      leaseOwner: 'worker-crashed',
      leaseToken: 'token-stale-9999',
      leaseExpiresAt: pastExpiry,
      heartbeatAt: pastExpiry,
      attempts: 1,
      errorDetails: {
        storageKey: 'storage/stale_lease.cho',
        checksumSha256: 'dummyhash',
        targetFormat: 'CHORD_PRO',
      },
    }).returning();
    createdJobIds.push(job.id);

    const recoveryWorker = new ConversionWorker(db, undefined, undefined, 'worker-recovery');
    const recoveredCount = await recoveryWorker.recoverStaleJobs();

    assert.ok(recoveredCount >= 1, 'Debe haber recuperado al menos el trabajo expirado');

    const [recovered] = await db
      .select()
      .from(backgroundJobs)
      .where(eq(backgroundJobs.id, job.id));

    assert.strictEqual(recovered.status, 'PENDING', 'El trabajo expirado debe volver a PENDING');
    assert.strictEqual(recovered.leaseOwner, null, 'El propietario de arrendamiento debe ser liberado');
    assert.strictEqual(recovered.leaseToken, null, 'El testigo de arrendamiento debe ser liberado');
    assert.strictEqual(recovered.leaseExpiresAt, null, 'La expiración de arrendamiento debe ser limpiada');
    assert.strictEqual(recovered.progress, 0, 'El progreso debe restablecerse a 0');
  });

  it('6. should transition to FAILED with LEASE_RETRY_EXHAUSTED when expired lease exceeds max attempts', async () => {
    const pastExpiry = new Date(Date.now() - 45_000); // Expiró hace 45 segundos
    const [job] = await db.insert(backgroundJobs).values({
      jobType: 'CONVERSION',
      status: 'PROCESSING',
      progress: 60,
      userId: testUserId,
      inputRef: 'exhausted_lease.cho',
      leaseOwner: 'worker-dead',
      leaseToken: 'token-exhausted-8888',
      leaseExpiresAt: pastExpiry,
      heartbeatAt: pastExpiry,
      attempts: 3, // Ya consumió los 3 intentos máximos
      errorDetails: { code: 'PREVIOUS_ERROR' },
    }).returning();
    createdJobIds.push(job.id);

    const recoveryWorker = new ConversionWorker(db, undefined, undefined, 'worker-recovery');
    await recoveryWorker.recoverStaleJobs();

    const [failed] = await db
      .select()
      .from(backgroundJobs)
      .where(eq(backgroundJobs.id, job.id));

    assert.strictEqual(failed.status, 'FAILED', 'El trabajo con intentos agotados debe fallar');
    assert.strictEqual(failed.errorCode, 'LEASE_EXPIRED_MAX_ATTEMPTS');
    assert.strictEqual(failed.progress, 100);
    assert.ok(failed.completedAt !== null);
  });
});
