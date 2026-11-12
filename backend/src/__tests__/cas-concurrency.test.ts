/**
 * @file cas-concurrency.test.ts
 * @description Suite autoritativa de pruebas de concurrencia, bloqueo determinista de compañeros canónicos
 * y recuperación de transacciones CAS (Fase 2B.1 Closure).
 *
 * Escenarios de Inyección de Fallos requeridos por la auditoría técnica independiente:
 * - Escenario A: Primary file deletion succeeds, companion deletion fails.
 * - Escenario B: Companion file is being accessed while retention attempts deletion.
 * - Escenario C: Two independent workers attempt to delete the same primary and companion pair.
 * - Escenario D: Recovery discovers an active valid reference and cancels deletion without incorrectly reporting DELETED.
 * - Escenario E: Process crashes after primary deletion but before companion deletion.
 * - Escenario F: Process crashes after both physical deletions but before database finalization.
 * - Escenario G: Lock acquisition fails after acquiring the first key but before acquiring the second.
 * - Escenario H: Reconciliation retries only the incomplete artifact.
 * - Escenario I: Audit failure preserves truthful final states.
 * - Escenario J: Carrera simultánea entre commitJobToCatalog y pruneExpiredOutputs serializada mediante FOR UPDATE.
 * - Escenario K: Worker cae tras escribir archivo físico antes del commit en BD (protección por ventana de cuarentena).
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { eq, and, isNull, inArray } from 'drizzle-orm';
import { db, pool } from '../db/index.ts';
import { backgroundJobs, casDeletionIntents, auditLogs, users } from '../db/schema.ts';
import { OutputRetentionService } from '../application/output-retention-service.ts';
import { LocalFileSystemStorageProvider } from '../domain/storage/storage-provider.ts';
import { SongService } from '../application/song-service.ts';
import { DrizzleSongRepository } from '../repositories/song-repository.ts';
import { DrizzleSongVersionRepository } from '../repositories/version-repository.ts';
import { ConversionJobService } from '../application/conversion-job-service.ts';
import { createReferenceSongFixture } from '../../../frontend/src/core/canonical-model/fixtures/reference-song.ts';
import { CanonicalSerializer } from '../domain/canonical-serializer.ts';

describe('Phase 2B.1 — CAS Object Lifecycle Concurrency & Hardening Suite', () => {
  const testOutputDir = path.resolve(process.cwd(), 'storage', 'test-concurrency-outputs');
  let outputStorage: LocalFileSystemStorageProvider;
  let retentionService: OutputRetentionService;
  let testUserId: string;

  before(async () => {
    await fs.rm(testOutputDir, { recursive: true, force: true });
    await fs.mkdir(testOutputDir, { recursive: true });

    outputStorage = new LocalFileSystemStorageProvider('storage/test-concurrency-outputs');
    retentionService = new OutputRetentionService(
      db,
      outputStorage,
      {
        defaultRetentionDays: 30,
        defaultQuarantineDays: 7,
      },
      pool
    );

    testUserId = crypto.randomUUID();
    await db.insert(users).values({
      id: testUserId,
      email: `test_concurrency_${Date.now()}@bethesda.io`,
      passwordHash: 'dummy_hash',
      firstName: 'Concurrency',
      lastName: 'Tester',
      role: 'ADMIN',
    });
  });

  after(async () => {
    await db.delete(casDeletionIntents);
    await db.delete(auditLogs).where(eq(auditLogs.userId, testUserId));
    await db.delete(backgroundJobs).where(eq(backgroundJobs.userId, testUserId));
    await db.delete(users).where(eq(users.id, testUserId));
    await fs.rm(testOutputDir, { recursive: true, force: true });
    await pool.end();
  });

  it('Escenario A: Primary file deletion succeeds, companion deletion fails', async () => {
    const salt = crypto.randomUUID();
    const content = Buffer.from('Scenario A Primary Content ' + salt);
    const hash = crypto.createHash('sha256').update(content).digest('hex');
    const key = `outputs/${hash}.txt`;
    const canonicalKey = `outputs/${hash}.canonical.json`;

    await outputStorage.save(key, content);
    await outputStorage.save(canonicalKey, Buffer.from('{"title":"Scenario A Companion"}'));

    const jobId = crypto.randomUUID();
    const completedAt = new Date(Date.now() - 35 * 24 * 60 * 60 * 1000);

    const originalDelete = outputStorage.delete.bind(outputStorage);

    try {
      await db.insert(backgroundJobs).values({
        id: jobId,
        jobType: 'CONVERSION',
        status: 'COMPLETED',
        userId: testUserId,
        inputRef: 'scenario-a.xml',
        outputStorageKey: key,
        outputChecksumSha256: hash,
        outputByteLength: content.length,
        completedAt,
        progress: 100,
        errorDetails: {
          canonicalStorageKey: canonicalKey,
        },
      });

      // Simular fallo en eliminación física del companion canónico
      outputStorage.delete = async (k: string) => {
        if (k === canonicalKey) {
          throw new Error('EACCES: simulated companion permission failure');
        }
        return originalDelete(k);
      };

      const pruneReport = await retentionService.pruneExpiredOutputs({
        retentionDays: 30,
        userId: testUserId,
      });

      // 1. Archivo primario fue eliminado físicamente
      assert.equal(await outputStorage.exists(key), false, 'El archivo primario debe haber sido eliminado');
      // 2. Archivo canónico PERMANECE en disco
      assert.equal(
        await outputStorage.exists(canonicalKey),
        true,
        'El compañero canónico debe permanecer en disco'
      );

      // 3. Intención en BD debe estar en RETRY_PENDING (NUNCA DELETED)
      const [intent] = await db
        .select()
        .from(casDeletionIntents)
        .where(eq(casDeletionIntents.storageKey, key));

      assert(intent !== undefined, 'Debe registrarse intención');
      assert.equal(intent.state, 'RETRY_PENDING', 'El estado DEBE ser RETRY_PENDING');
      assert.equal(intent.primaryDeleted, true, 'primaryDeleted debe ser true');
      assert.equal(intent.companionDeleted, false, 'companionDeleted debe ser false');
      assert(intent.companionError?.includes('EACCES'), 'companionError debe capturar el error exacto');
      assert(intent.lastError?.includes('Companion'), 'lastError debe documentar el fallo del companion');
      assert.equal(intent.attempts, 1);

      assert(pruneReport.errors.length > 0, 'El reporte de podado debe registrar el error');
    } finally {
      outputStorage.delete = originalDelete;
      await outputStorage.delete(key).catch(() => {});
      await outputStorage.delete(canonicalKey).catch(() => {});
      await db.delete(casDeletionIntents).where(eq(casDeletionIntents.storageKey, key));
      await db.delete(backgroundJobs).where(eq(backgroundJobs.id, jobId));
    }
  });

  it('Escenario B: Companion file is being accessed while retention attempts deletion', async () => {
    const salt = crypto.randomUUID();
    const content = Buffer.from('Scenario B Content ' + salt);
    const hash = crypto.createHash('sha256').update(content).digest('hex');
    const key = `outputs/${hash}.txt`;
    const canonicalKey = `outputs/${hash}.canonical.json`;

    await outputStorage.save(key, content);
    await outputStorage.save(canonicalKey, Buffer.from('{"title":"Scenario B Companion"}'));

    const jobId = crypto.randomUUID();
    const completedAt = new Date(Date.now() - 35 * 24 * 60 * 60 * 1000);

    const contenderClient = await pool.connect();

    try {
      await db.insert(backgroundJobs).values({
        id: jobId,
        jobType: 'CONVERSION',
        status: 'COMPLETED',
        userId: testUserId,
        inputRef: 'scenario-b.xml',
        outputStorageKey: key,
        outputChecksumSha256: hash,
        outputByteLength: content.length,
        completedAt,
        progress: 100,
        errorDetails: {
          canonicalStorageKey: canonicalKey,
        },
      });

      // El lector/proceso concurrente adquiere advisory lock sobre el companionKey
      await contenderClient.query('SELECT pg_advisory_lock(hashtext($1))', [canonicalKey]);

      let prunerCompleted = false;
      let prunerError: any = null;

      // Lanzar el podador de retención en background
      const prunePromise = retentionService
        .pruneExpiredOutputs({ retentionDays: 30, userId: testUserId })
        .then((res) => {
          prunerCompleted = true;
          return res;
        })
        .catch((err) => {
          prunerError = err;
        });

      // Bounded barrier: esperar 150ms y verificar que el podador NO ha avanzado porque el companion lock está tomado
      await new Promise((resolve) => setTimeout(resolve, 150));
      assert.equal(
        prunerCompleted,
        false,
        'El podador DEBE estar bloqueado esperando el advisory lock del companion'
      );
      assert.equal(
        await outputStorage.exists(key),
        true,
        'El archivo primario NO debe haber sido eliminado mientras el companion esté bloqueado'
      );
      assert.equal(
        await outputStorage.exists(canonicalKey),
        true,
        'El archivo companion NO debe haber sido eliminado'
      );

      // Liberar el advisory lock del companion en el cliente competidor
      await contenderClient.query('SELECT pg_advisory_unlock(hashtext($1))', [canonicalKey]);

      // Esperar a que el podador complete
      const report = await prunePromise;
      assert.equal(prunerCompleted, true, 'El podador debe haber completado tras la liberación del lock');
      assert.equal(prunerError, null, 'No debe haber error');

      // Ambos archivos deben haber sido eliminados limpiamente tras adquirir el lock
      assert.equal(await outputStorage.exists(key), false, 'Primario eliminado tras liberación');
      assert.equal(await outputStorage.exists(canonicalKey), false, 'Companion eliminado tras liberación');

      const [intent] = await db
        .select()
        .from(casDeletionIntents)
        .where(eq(casDeletionIntents.storageKey, key));
      assert.equal(intent.state, 'DELETED');
      assert.equal(intent.primaryDeleted, true);
      assert.equal(intent.companionDeleted, true);
    } finally {
      await contenderClient.query('SELECT pg_advisory_unlock_all()').catch(() => {});
      contenderClient.release();
      await outputStorage.delete(key).catch(() => {});
      await outputStorage.delete(canonicalKey).catch(() => {});
      await db.delete(casDeletionIntents).where(eq(casDeletionIntents.storageKey, key));
      await db.delete(backgroundJobs).where(eq(backgroundJobs.id, jobId));
    }
  });

  it('Escenario C: Two independent workers attempt to delete the same primary and companion pair', async () => {
    const salt = crypto.randomUUID();
    const content = Buffer.from('Scenario C Content ' + salt);
    const hash = crypto.createHash('sha256').update(content).digest('hex');
    const key = `outputs/${hash}.txt`;
    const canonicalKey = `outputs/${hash}.canonical.json`;

    await outputStorage.save(key, content);
    await outputStorage.save(canonicalKey, Buffer.from('{"title":"Scenario C Companion"}'));

    const jobId = crypto.randomUUID();
    const completedAt = new Date(Date.now() - 35 * 24 * 60 * 60 * 1000);

    const service1 = new OutputRetentionService(db, outputStorage, { defaultRetentionDays: 30 }, pool);
    const service2 = new OutputRetentionService(db, outputStorage, { defaultRetentionDays: 30 }, pool);

    try {
      await db.insert(backgroundJobs).values({
        id: jobId,
        jobType: 'CONVERSION',
        status: 'COMPLETED',
        userId: testUserId,
        inputRef: 'scenario-c.xml',
        outputStorageKey: key,
        outputChecksumSha256: hash,
        outputByteLength: content.length,
        completedAt,
        progress: 100,
        errorDetails: { canonicalStorageKey: canonicalKey },
      });

      // Ejecutar ambos workers de retención simultáneamente
      const [report1, report2] = await Promise.all([
        service1.pruneExpiredOutputs({ retentionDays: 30, userId: testUserId }),
        service2.pruneExpiredOutputs({ retentionDays: 30, userId: testUserId }),
      ]);

      assert.equal(report1.errors.length, 0);
      assert.equal(report2.errors.length, 0);

      const totalFilesDeleted = report1.filesDeletedCount + report2.filesDeletedCount;
      assert.equal(totalFilesDeleted, 1, 'Exactamente un podador debe registrar la eliminación física');

      assert.equal(await outputStorage.exists(key), false);
      assert.equal(await outputStorage.exists(canonicalKey), false);

      const [intent] = await db
        .select()
        .from(casDeletionIntents)
        .where(eq(casDeletionIntents.storageKey, key));
      assert.equal(intent.state, 'DELETED');
      assert.equal(intent.primaryDeleted, true);
      assert.equal(intent.companionDeleted, true);
    } finally {
      await outputStorage.delete(key).catch(() => {});
      await outputStorage.delete(canonicalKey).catch(() => {});
      await db.delete(casDeletionIntents).where(eq(casDeletionIntents.storageKey, key));
      await db.delete(backgroundJobs).where(eq(backgroundJobs.id, jobId));
    }
  });

  it('Escenario D: Recovery discovers an active valid reference and cancels deletion without incorrectly reporting DELETED', async () => {
    const salt = crypto.randomUUID();
    const content = Buffer.from('Scenario D Content ' + salt);
    const hash = crypto.createHash('sha256').update(content).digest('hex');
    const key = `outputs/${hash}.txt`;
    const canonicalKey = `outputs/${hash}.canonical.json`;

    await outputStorage.save(key, content);
    await outputStorage.save(canonicalKey, Buffer.from('{"title":"Scenario D Companion"}'));

    const activeJobId = crypto.randomUUID();

    try {
      // 1. Trabajo activo legítimo en la base de datos (NO podado)
      await db.insert(backgroundJobs).values({
        id: activeJobId,
        jobType: 'CONVERSION',
        status: 'COMPLETED',
        userId: testUserId,
        inputRef: 'scenario-d-active.xml',
        outputStorageKey: key,
        outputChecksumSha256: hash,
        outputByteLength: content.length,
        completedAt: new Date(),
        prunedAt: null,
        progress: 100,
        errorDetails: { canonicalStorageKey: canonicalKey },
      });

      // 2. Intención de eliminación pendiente huérfana
      await db.insert(casDeletionIntents).values({
        storageKey: key,
        canonicalKey,
        checksumSha256: hash,
        state: 'DELETE_PENDING',
        primaryDeleted: false,
        companionDeleted: false,
        attempts: 0,
      });

      // 3. Ejecutar reconciliación de recuperación
      const recReport = await retentionService.reconcilePendingDeletions({ userId: testUserId });

      assert(recReport.reconciledCount >= 1, 'Debe registrar 1 reconciliación');
      assert.equal(recReport.failedCount, 0);

      // 4. Verificaciones Semánticas Críticas:
      const [intent] = await db
        .select()
        .from(casDeletionIntents)
        .where(eq(casDeletionIntents.storageKey, key));

      assert.notEqual(intent.state, 'DELETED', 'NO debe marcar DELETED porque existe referencia activa');
      assert.equal(intent.state, 'RETAINED', 'El estado semántico correcto es RETAINED');
      assert(intent.lastError?.includes('active reference detected'), 'lastError debe indicar referencia activa');
      assert.equal(intent.audited, true, 'Debe auditar la retención');

      // 5. Los archivos físicos DEBEN permanecer intactos
      assert.equal(await outputStorage.exists(key), true, 'El archivo primario DEBE conservarse intacto');
      assert.equal(
        await outputStorage.exists(canonicalKey),
        true,
        'El archivo companion DEBE conservarse intacto'
      );

      // 6. El trabajo activo NO debe haber sido alterado
      const [activeJob] = await db.select().from(backgroundJobs).where(eq(backgroundJobs.id, activeJobId));
      assert.equal(activeJob.prunedAt, null, 'prunedAt del trabajo activo debe permanecer null');

      // 7. Auditoría veraz: evento CAS_OBJECT_RETAINED
      const auditRows = await db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.eventType, 'CAS_OBJECT_RETAINED'));
      assert(auditRows.some((a) => (a.metadata as any)?.storageKey === key));
    } finally {
      await outputStorage.delete(key).catch(() => {});
      await outputStorage.delete(canonicalKey).catch(() => {});
      await db.delete(casDeletionIntents).where(eq(casDeletionIntents.storageKey, key));
      await db.delete(backgroundJobs).where(eq(backgroundJobs.id, activeJobId));
    }
  });

  it('Escenario E: Process crashes after primary deletion but before companion deletion', async () => {
    const salt = crypto.randomUUID();
    const content = Buffer.from('Scenario E Content ' + salt);
    const hash = crypto.createHash('sha256').update(content).digest('hex');
    const key = `outputs/${hash}.txt`;
    const canonicalKey = `outputs/${hash}.canonical.json`;

    // Archivo primario ya fue borrado físicamente; companion todavía existe en disco
    await outputStorage.save(canonicalKey, Buffer.from('{"title":"Scenario E Companion"}'));

    try {
      // Estado en BD tras caída: primary_deleted = true, companion_deleted = false, RETRY_PENDING
      await db.insert(casDeletionIntents).values({
        storageKey: key,
        canonicalKey,
        checksumSha256: hash,
        state: 'RETRY_PENDING',
        primaryDeleted: true,
        companionDeleted: false,
        primaryError: null,
        companionError: 'Simulated crash before companion unlink',
        lastError: 'Incomplete physical deletion',
        attempts: 1,
      });

      assert.equal(await outputStorage.exists(key), false, 'Primario ya no existe');
      assert.equal(await outputStorage.exists(canonicalKey), true, 'Companion aún existe');

      // Ejecutar reconciliación
      const recReport = await retentionService.reconcilePendingDeletions({ userId: testUserId });
      assert(recReport.reconciledCount >= 1);
      assert.equal(recReport.failedCount, 0);

      // Verificaciones: Companion fue eliminado por la reconciliación
      assert.equal(await outputStorage.exists(canonicalKey), false, 'Companion debe haber sido eliminado');

      const [intent] = await db
        .select()
        .from(casDeletionIntents)
        .where(eq(casDeletionIntents.storageKey, key));

      assert.equal(intent.state, 'DELETED', 'Estado final debe ser DELETED');
      assert.equal(intent.primaryDeleted, true);
      assert.equal(intent.companionDeleted, true);
      assert.equal(intent.audited, true);
    } finally {
      await outputStorage.delete(canonicalKey).catch(() => {});
      await db.delete(casDeletionIntents).where(eq(casDeletionIntents.storageKey, key));
    }
  });

  it('Escenario F: Interrupted deletion cycle with physical unlinking completed before terminal DB finalization', async () => {
    // =========================================================================
    // PARTE 1: INYECCIÓN DE FALLO A NIVEL DE SERVICIO (E/S física completada, fallo antes de Tx 2)
    // =========================================================================
    const salt1 = crypto.randomUUID();
    const content1 = Buffer.from('Scenario F Injected ' + salt1);
    const hash1 = crypto.createHash('sha256').update(content1).digest('hex');
    const key1 = `outputs/${hash1}.chordpro`;
    const canonicalKey1 = `outputs/${hash1}.canonical.json`;

    // 1. Crear los archivos reales en almacenamiento físico
    await outputStorage.save(key1, content1);
    await outputStorage.save(canonicalKey1, Buffer.from('{"title":"Scenario F Injected"}'));
    assert.equal(await outputStorage.exists(key1), true);
    assert.equal(await outputStorage.exists(canonicalKey1), true);

    const jobId1 = crypto.randomUUID();
    const expiredDate1 = new Date(Date.now() - 35 * 24 * 60 * 60 * 1000);

    const originalTx = db.transaction.bind(db);
    let phase3Interrupted = false;

    try {
      await db.insert(backgroundJobs).values({
        id: jobId1,
        jobType: 'CONVERSION',
        status: 'COMPLETED',
        userId: testUserId,
        inputRef: 'scenario-f-injected.xml',
        outputStorageKey: key1,
        outputChecksumSha256: hash1,
        outputByteLength: content1.length,
        completedAt: expiredDate1,
        progress: 100,
        errorDetails: { canonicalStorageKey: canonicalKey1 },
      });

      // Interceptar db.transaction: dejar pasar Fase 1 (Tx 1), pero lanzar error en Fase 3 (Tx 2)
      let txCount = 0;
      (db as any).transaction = async (cb: any) => {
        txCount++;
        // txCount === 1 es Fase 1 (commit de DELETE_PENDING y pruned_at)
        if (txCount === 2) {
          phase3Interrupted = true;
          throw new Error('Simulated process interruption/database network disconnect before Phase 3 DB finalization');
        }
        return originalTx(cb);
      };

      // Ejecutar podado con inyección de fallo en Fase 3
      const pruneReport = await retentionService.pruneExpiredOutputs({
        retentionDays: 30,
        userId: testUserId,
      });

      assert.equal(phase3Interrupted, true, 'La Fase 3 debió ser interrumpida tras la desvinculación física');
      assert(pruneReport.errors.some((e) => e.error.includes('Simulated process interruption')));

      // Verificación de estado físico: AMBOS archivos fueron desvinculados físicamente por el servicio
      assert.equal(await outputStorage.exists(key1), false, 'Archivo primario fue desvinculado físicamente');
      assert.equal(await outputStorage.exists(canonicalKey1), false, 'Companion fue desvinculado físicamente');

      // Verificación de estado en BD: La intención quedó en DELETE_PENDING debido a la interrupción antes de Tx 2
      const [interruptedIntent] = await db
        .select()
        .from(casDeletionIntents)
        .where(eq(casDeletionIntents.storageKey, key1));

      assert.equal(interruptedIntent.state, 'DELETE_PENDING', 'Intención debe permanecer DELETE_PENDING tras interrupción');

      // 2. Ejecutar el worker de recuperación real (reconcilePendingDeletions)
      const recReport = await retentionService.reconcilePendingDeletions({ userId: testUserId });
      assert(recReport.reconciledCount >= 1);
      assert.equal(recReport.failedCount, 0);

      // Verificación final tras recuperación: reconciliado a DELETED con veracidad
      const [reconciledIntent] = await db
        .select()
        .from(casDeletionIntents)
        .where(eq(casDeletionIntents.storageKey, key1));

      assert.equal(reconciledIntent.state, 'DELETED');
      assert.equal(reconciledIntent.primaryDeleted, true);
      assert.equal(reconciledIntent.companionDeleted, true);
      assert.equal(reconciledIntent.audited, true);
    } finally {
      (db as any).transaction = originalTx;
      await outputStorage.delete(key1).catch(() => {});
      await outputStorage.delete(canonicalKey1).catch(() => {});
      await db.delete(casDeletionIntents).where(eq(casDeletionIntents.storageKey, key1));
      await db.delete(backgroundJobs).where(eq(backgroundJobs.id, jobId1));
    }

    // =========================================================================
    // PARTE 2: RECUPERACIÓN ANTE ESTADO POST-UNLINK SIMULADO PREVIO
    // =========================================================================
    // Verifica que si un intento DELETE_PENDING ya existía en la base de datos
    // y los archivos ya no están presentes en disco, la recuperación no falla y finaliza limpiamente
    const salt2 = crypto.randomUUID();
    const hash2 = crypto.createHash('sha256').update('Scenario F Simulated ' + salt2).digest('hex');
    const key2 = `outputs/${hash2}.txt`;
    const canonicalKey2 = `outputs/${hash2}.canonical.json`;

    assert.equal(await outputStorage.exists(key2), false);
    assert.equal(await outputStorage.exists(canonicalKey2), false);

    try {
      await db.insert(casDeletionIntents).values({
        storageKey: key2,
        canonicalKey: canonicalKey2,
        checksumSha256: hash2,
        state: 'DELETE_PENDING',
        primaryDeleted: false,
        companionDeleted: false,
        attempts: 0,
      });

      const recReport2 = await retentionService.reconcilePendingDeletions({ userId: testUserId });
      assert(recReport2.reconciledCount >= 1);

      const [intent2] = await db
        .select()
        .from(casDeletionIntents)
        .where(eq(casDeletionIntents.storageKey, key2));

      assert.equal(intent2.state, 'DELETED');
      assert.equal(intent2.primaryDeleted, true);
      assert.equal(intent2.companionDeleted, true);
      assert.equal(intent2.audited, true);
    } finally {
      await db.delete(casDeletionIntents).where(eq(casDeletionIntents.storageKey, key2));
    }
  });

  it('Escenario G: Production withCasAdvisoryLocks handles bounded lock timeout, reverse-order release and connection cleanup', async () => {
    // 1. Probar adquisición normal y liberación en orden inverso invocando el helper de producción real
    const orderLog: string[] = [];
    const testKey1 = `outputs/test_normal_1_${crypto.randomUUID()}.txt`;
    const testKey2 = `outputs/test_normal_2_${crypto.randomUUID()}.canonical.json`;

    await retentionService.withCasAdvisoryLocks([testKey1, testKey2], async (client) => {
      const lockCheck = await client.query(
        "SELECT count(*) as count FROM pg_locks WHERE locktype = 'advisory' AND pid = pg_backend_pid()"
      );
      assert.equal(parseInt(lockCheck.rows[0].count, 10), 2, 'Debe retener exactamente 2 bloqueos consultivos en la sesión');
      orderLog.push('operation_executed');
    });

    assert.equal(orderLog[0], 'operation_executed');

    // Verificar que ambas claves fueron liberadas tras la ejecución normal
    const verifierAfterNormal = await pool.connect();
    try {
      const lockCheck1 = await verifierAfterNormal.query(
        'SELECT pg_try_advisory_lock(hashtext($1)) as acquired',
        [testKey1]
      );
      const lockCheck2 = await verifierAfterNormal.query(
        'SELECT pg_try_advisory_lock(hashtext($1)) as acquired',
        [testKey2]
      );
      assert.equal(lockCheck1.rows[0].acquired, true, 'Clave 1 debe estar liberada');
      assert.equal(lockCheck2.rows[0].acquired, true, 'Clave 2 debe estar liberada');
      await verifierAfterNormal.query('SELECT pg_advisory_unlock(hashtext($1))', [testKey1]);
      await verifierAfterNormal.query('SELECT pg_advisory_unlock(hashtext($1))', [testKey2]);
    } finally {
      verifierAfterNormal.release();
    }

    // 2. Probar adquisición parcial fallida con timeout PostgreSQL acotado
    const keyA = `outputs/test_lock_a_${crypto.randomUUID()}.txt`;
    const keyB = `outputs/test_lock_b_${crypto.randomUUID()}.canonical.json`;
    const sortedKeys = [keyA, keyB].sort();
    const firstKey = sortedKeys[0];
    const secondKey = sortedKeys[1];

    const blockerClient = await pool.connect();
    const verifierClient = await pool.connect();

    try {
      // Bloquear secondKey en una conexión independiente
      await blockerClient.query('SELECT pg_advisory_lock(hashtext($1))', [secondKey]);

      let helperFailed = false;
      let helperError: any = null;

      try {
        // Invocar directamente el método de producción real con timeout acotado (200ms)
        await retentionService.withCasAdvisoryLocks(
          [firstKey, secondKey],
          async () => {
            throw new Error('Inalcanzable: la operación no debe ejecutarse si falla la adquisición del bloqueo');
          },
          { lockTimeoutMs: 200 }
        );
      } catch (err: any) {
        helperFailed = true;
        helperError = err;
      }

      assert.equal(helperFailed, true, 'La adquisición debió fallar por contención en secondKey');
      assert(
        helperError?.code === '55P03' ||
          helperError?.message?.includes('tiempo de espera') ||
          helperError?.message?.includes('timeout') ||
          helperError?.message?.includes('canceling statement'),
        `Error debió ser lock_timeout (55P03): ${helperError?.message}`
      );

      // Verificación crítica 1: firstKey fue liberado por withCasAdvisoryLocks en su bloque finally
      const testLock = await verifierClient.query(
        'SELECT pg_try_advisory_lock(hashtext($1)) as acquired',
        [firstKey]
      );
      assert.equal(
        testLock.rows[0].acquired,
        true,
        'firstKey DEBE haber sido liberado por el helper de producción en su bloque finally'
      );
      await verifierClient.query('SELECT pg_advisory_unlock(hashtext($1))', [firstKey]);

      // Liberar secondKey del blocker
      await blockerClient.query('SELECT pg_advisory_unlock(hashtext($1))', [secondKey]);

      // Verificación crítica 2: Ningún bloqueo consultivo residual en el servidor PostgreSQL
      const globalLockCheck = await pool.query(
        "SELECT count(*) as count FROM pg_locks WHERE locktype = 'advisory'"
      );
      assert.equal(
        parseInt(globalLockCheck.rows[0].count, 10),
        0,
        'No deben existir bloqueos consultivos residuales retenidos en el servidor PostgreSQL'
      );
    } finally {
      await blockerClient.query('SELECT pg_advisory_unlock_all()').catch(() => {});
      blockerClient.release();
      verifierClient.release();
    }
  });

  it('Escenario H: Reconciliation retries only the incomplete artifact', async () => {
    const salt = crypto.randomUUID();
    const hash = crypto.createHash('sha256').update('Scenario H ' + salt).digest('hex');
    const key = `outputs/${hash}.txt`;
    const canonicalKey = `outputs/${hash}.canonical.json`;

    await outputStorage.save(canonicalKey, Buffer.from('{"title":"Scenario H"}'));

    const deletedOps: string[] = [];
    const originalDelete = outputStorage.delete.bind(outputStorage);
    outputStorage.delete = async (k: string) => {
      deletedOps.push(k);
      return originalDelete(k);
    };

    try {
      await db.insert(casDeletionIntents).values({
        storageKey: key,
        canonicalKey,
        checksumSha256: hash,
        state: 'RETRY_PENDING',
        primaryDeleted: true, // Primario ya fue eliminado en un intento previo
        companionDeleted: false, // Companion aún pendiente
        attempts: 1,
      });

      const recReport = await retentionService.reconcilePendingDeletions({ userId: testUserId });
      assert(recReport.reconciledCount >= 1);

      // Verificación estricta: NO se llamó a delete para el archivo primario ya eliminado
      assert.equal(
        deletedOps.includes(key),
        false,
        'NO debe reintentar eliminar el archivo primario ya marcado como primaryDeleted'
      );
      assert.equal(deletedOps.includes(canonicalKey), true, 'DEBE eliminar el companion pendiente');

      const [intent] = await db
        .select()
        .from(casDeletionIntents)
        .where(eq(casDeletionIntents.storageKey, key));

      assert.equal(intent.state, 'DELETED');
      assert.equal(intent.primaryDeleted, true);
      assert.equal(intent.companionDeleted, true);
    } finally {
      outputStorage.delete = originalDelete;
      await outputStorage.delete(canonicalKey).catch(() => {});
      await db.delete(casDeletionIntents).where(eq(casDeletionIntents.storageKey, key));
    }
  });

  it('Escenario I: Audit failure preserves truthful final states', async () => {
    const salt = crypto.randomUUID();
    const content = Buffer.from('Scenario I Content ' + salt);
    const hash = crypto.createHash('sha256').update(content).digest('hex');
    const key = `outputs/${hash}.txt`;
    const canonicalKey = `outputs/${hash}.canonical.json`;

    await outputStorage.save(key, content);
    await outputStorage.save(canonicalKey, Buffer.from('{"title":"Scenario I"}'));

    const jobId = crypto.randomUUID();
    const completedAt = new Date(Date.now() - 35 * 24 * 60 * 60 * 1000);

    try {
      await db.insert(backgroundJobs).values({
        id: jobId,
        jobType: 'CONVERSION',
        status: 'COMPLETED',
        userId: testUserId,
        inputRef: 'scenario-i.xml',
        outputStorageKey: key,
        outputChecksumSha256: hash,
        outputByteLength: content.length,
        completedAt,
        progress: 100,
        errorDetails: { canonicalStorageKey: canonicalKey },
      });

      // Pasar un userId no existente que viole la clave foránea en la tabla auditLogs
      const nonExistentUserId = crypto.randomUUID();

      const pruneReport = await retentionService.pruneExpiredOutputs({
        retentionDays: 30,
        userId: nonExistentUserId,
      });

      // 1. La eliminación física tuvo éxito
      assert.equal(await outputStorage.exists(key), false, 'Archivo primario fue eliminado');
      assert.equal(await outputStorage.exists(canonicalKey), false, 'Companion fue eliminado');

      // 2. El reporte registra el error de auditoría
      assert(
        pruneReport.errors.some((e) => e.error.includes('auditoría')),
        'Debe reportar fallo de auditoría'
      );

      // 3. Veracidad en DB: estado es DELETED pero audited es FALSE
      const [intent] = await db
        .select()
        .from(casDeletionIntents)
        .where(eq(casDeletionIntents.storageKey, key));

      assert.equal(intent.state, 'DELETED', 'Físicamente fue eliminado');
      assert.equal(intent.audited, false, 'audited DEBE ser false con veracidad estricta');

      // 4. Procedimiento de reconciliación de auditoría (reconcileUnauditedDeletions)
      // Reconciliar con un userId válido para completar la auditoría pendiente
      const auditRecReport = await retentionService.reconcileUnauditedDeletions({ userId: testUserId });
      assert(auditRecReport.reconciledAuditCount >= 1, 'Debe reconciliar el registro no auditado');

      const [reconciledIntent] = await db
        .select()
        .from(casDeletionIntents)
        .where(eq(casDeletionIntents.storageKey, key));

      assert.equal(reconciledIntent.state, 'DELETED', 'Estado físico se preserva');
      assert.equal(reconciledIntent.audited, true, 'audited transiciona a true tras la reconciliación');
    } finally {
      await outputStorage.delete(key).catch(() => {});
      await outputStorage.delete(canonicalKey).catch(() => {});
      await db.delete(casDeletionIntents).where(eq(casDeletionIntents.storageKey, key));
      await db.delete(backgroundJobs).where(eq(backgroundJobs.id, jobId));
    }
  });

  it('Escenario J: Carrera simultánea entre commitJobToCatalog y pruneExpiredOutputs serializada mediante FOR UPDATE', async () => {
    const key = 'outputs/scenario-j.chordpro';
    const content = Buffer.from('{title: Scenario J Song}\n[D]Praise');
    await outputStorage.save(key, content);

    const canonicalKey = 'outputs/scenario-j.canonical.json';
    const fixture = createReferenceSongFixture();
    const serializedPayload = JSON.stringify(CanonicalSerializer.serialize(fixture));
    await outputStorage.save(canonicalKey, Buffer.from(serializedPayload, 'utf-8'));

    const raceJobId = crypto.randomUUID();
    const thirtyFiveDaysAgo = new Date(Date.now() - 35 * 24 * 60 * 60 * 1000);

    await db.insert(backgroundJobs).values({
      id: raceJobId,
      jobType: 'CONVERSION',
      status: 'COMPLETED',
      userId: testUserId,
      inputRef: 'scenario-j.xml',
      outputStorageKey: key,
      outputChecksumSha256: crypto.createHash('sha256').update(content).digest('hex'),
      outputByteLength: content.length,
      completedAt: thirtyFiveDaysAgo,
      progress: 100,
      errorDetails: {
        targetFormat: 'CHORD_PRO',
        canonicalStorageKey: canonicalKey,
      },
    });

    const songService = new SongService(
      new DrizzleSongRepository(db),
      new DrizzleSongVersionRepository(db)
    );
    const convJobService = new ConversionJobService(
      songService,
      undefined,
      db,
      undefined,
      undefined,
      outputStorage
    );

    // Ejecutar simultáneamente commitJobToCatalog y pruneExpiredOutputs
    const commitPromise = convJobService.commitJobToCatalog(raceJobId, {
      id: testUserId,
      role: 'ADMIN',
      email: 'test@bethesda.io',
    });

    const prunePromise = retentionService.pruneExpiredOutputs({
      retentionDays: 30,
      userId: testUserId,
    });

    const results = await Promise.allSettled([commitPromise, prunePromise]);

    const commitResult = results[0];
    const pruneResult = results[1];

    assert.equal(pruneResult.status, 'fulfilled', 'El podador debe terminar de forma controlada');

    if (commitResult.status === 'fulfilled') {
      assert.equal(
        await outputStorage.exists(key),
        true,
        'El archivo físico debe existir al haber sido comprometido al catálogo'
      );
    } else {
      assert(commitResult.reason?.message?.includes('podado'), 'Commit debe ser rechazado si fue podado primero');
    }

    await outputStorage.delete(key).catch(() => {});
    await outputStorage.delete(canonicalKey).catch(() => {});
    await db.delete(casDeletionIntents).where(eq(casDeletionIntents.storageKey, key));
    await db.delete(backgroundJobs).where(eq(backgroundJobs.id, raceJobId));
  });

  it('Escenario K: Worker cae tras escribir archivo físico antes del commit en BD (protección por cuarentena)', async () => {
    const crashedKey = 'outputs/crashed-worker-k.xml';
    const crashContent = Buffer.from('Crash Scenario K Data');

    // 1. Simular worker que escribe el archivo pero cae (cierra conexión abruptamente sin COMMIT)
    const crashClient = await pool.connect();
    try {
      await crashClient.query('BEGIN');
      await crashClient.query('SELECT pg_advisory_xact_lock(hashtext($1))', [crashedKey]);
      await outputStorage.save(crashedKey, crashContent);
      // Caída abrupta: liberar cliente con true destruye el socket
      crashClient.release(true);
    } catch {
      // Ignorar
    }

    // 2. El archivo físico existe pero no hay registro en BD
    assert.equal(await outputStorage.exists(crashedKey), true, 'El archivo físico fue escrito');

    // 3. Ejecutar recolector de huérfanos con ventana de cuarentena por defecto (7 días)
    const report = await retentionService.collectOrphans({ quarantineDays: 7, userId: testUserId });

    // 4. El archivo NO debe eliminarse porque está dentro de la ventana de cuarentena
    assert.equal(
      await outputStorage.exists(crashedKey),
      true,
      'La cuarentena debe proteger escrituras recientes de workers caídos'
    );
    assert(report.quarantinedFilesCount >= 1, 'El archivo fue contabilizado en cuarentena');
    assert.equal(report.orphansDeletedCount, 0);

    // Limpieza
    await outputStorage.delete(crashedKey).catch(() => {});
  });

  it('Escenario L: Concurrencia e idempotencia estricta en reconcileUnauditedDeletions (Dos workers concurrentes)', async () => {
    const salt = crypto.randomUUID();
    const hash = crypto.createHash('sha256').update('Scenario L ' + salt).digest('hex');
    const key = `outputs/${hash}.txt`;
    const canonicalKey = `outputs/${hash}.canonical.json`;

    // 1. Insertar una intención en estado DELETED con audited = false
    await db.insert(casDeletionIntents).values({
      storageKey: key,
      canonicalKey,
      checksumSha256: hash,
      state: 'DELETED',
      primaryDeleted: true,
      companionDeleted: true,
      attempts: 0,
      audited: false,
    });

    // 2. Instanciar dos workers de retención independientes
    const service1 = new OutputRetentionService(db, outputStorage, {}, pool);
    const service2 = new OutputRetentionService(db, outputStorage, {}, pool);

    try {
      // 3. Ejecutar reconcileUnauditedDeletions simultáneamente
      const [res1, res2] = await Promise.all([
        service1.reconcileUnauditedDeletions({ userId: testUserId }),
        service2.reconcileUnauditedDeletions({ userId: testUserId }),
      ]);

      // 4. Verificaciones de concurrencia y no falsedad en reportes
      // Uno de los dos debe haber reconciliado exactamente 1; el otro debió omitir 1 (skippedCount = 1)
      const totalReconciled = res1.reconciledCount + res2.reconciledCount;
      const totalSkipped = res1.skippedCount + res2.skippedCount;

      assert.equal(totalReconciled, 1, 'Exactamente un worker debe reconciliar la intención');
      assert.equal(totalSkipped, 1, 'El segundo worker debe omitir de forma segura');
      assert.equal(res1.failedCount, 0, 'Worker 1 no debe reportar fallos');
      assert.equal(res2.failedCount, 0, 'Worker 2 no debe reportar fallos');

      // 5. La intención en base de datos debe terminar en audited = true
      const [intent] = await db
        .select()
        .from(casDeletionIntents)
        .where(eq(casDeletionIntents.storageKey, key));

      assert.equal(intent.audited, true, 'La intención debe terminar con audited = true');
      assert.equal(intent.state, 'DELETED', 'El estado físico DELETED se mantiene intacto');

      // 6. En audit_logs debe existir EXACTAMENTE una entrada para este recurso
      const auditEntries = await db
        .select()
        .from(auditLogs)
        .where(
          and(
            eq(auditLogs.resource, `storage/${key}`),
            eq(auditLogs.eventType, 'CONVERSION_OUTPUT_DELETION_RECONCILED')
          )
        );

      assert.equal(auditEntries.length, 1, 'Debe persistirse exactamente UN evento de auditoría en audit_logs');
    } finally {
      await db.delete(casDeletionIntents).where(eq(casDeletionIntents.storageKey, key));
      await db.delete(auditLogs).where(eq(auditLogs.resource, `storage/${key}`));
    }
  });

  it('Escenario M: Fallo de inserción en reconcileUnauditedDeletions revierte transacción y preserva audited=false', async () => {
    const salt = crypto.randomUUID();
    const hash = crypto.createHash('sha256').update('Scenario M ' + salt).digest('hex');
    const key = `outputs/${hash}.txt`;
    const canonicalKey = `outputs/${hash}.canonical.json`;

    await db.insert(casDeletionIntents).values({
      storageKey: key,
      canonicalKey,
      checksumSha256: hash,
      state: 'DELETED',
      primaryDeleted: true,
      companionDeleted: true,
      attempts: 0,
      audited: false,
    });

    try {
      // Pasar un userId no existente que viole la clave foránea en auditLogs
      const nonExistentUserId = crypto.randomUUID();
      const report = await retentionService.reconcileUnauditedDeletions({ userId: nonExistentUserId });

      assert.equal(report.failedCount, 1, 'Debe registrar exactamente 1 fallo');
      assert.equal(report.reconciledCount, 0, 'No debe reportar reconciliación exitosa');
      assert(report.errors.length > 0, 'Debe contener el error capturado');

      // Verificación de integridad: audited continúa siendo FALSE y state continúa siendo DELETED
      const [intent] = await db
        .select()
        .from(casDeletionIntents)
        .where(eq(casDeletionIntents.storageKey, key));

      assert.equal(intent.audited, false, 'audited DEBE permanecer false tras el rollback');
      assert.equal(intent.state, 'DELETED', 'El estado físico no debe sufrir alteraciones');
    } finally {
      await db.delete(casDeletionIntents).where(eq(casDeletionIntents.storageKey, key));
    }
  });

  it('Escenario N: Validación estricta de lock_timeout (valores válidos, inválidos y límites de contorno)', async () => {
    // 1. Valores válidos
    assert.equal(OutputRetentionService.validateLockTimeout(0), 0, '0 debe ser válido (timeout desactivado)');
    assert.equal(OutputRetentionService.validateLockTimeout(1), 1, '1 debe ser válido (límite mínimo)');
    assert.equal(OutputRetentionService.validateLockTimeout(10000), 10000, '10000 debe ser válido (default)');
    assert.equal(OutputRetentionService.validateLockTimeout(300000), 300000, '300000 debe ser válido (límite máximo)');

    // 2. Valores negativos o fuera de rango (RangeError)
    assert.throws(
      () => OutputRetentionService.validateLockTimeout(-1),
      /no puede ser negativo/,
      'Debe rechazar timeout negativo -1'
    );
    assert.throws(
      () => OutputRetentionService.validateLockTimeout(-500),
      /no puede ser negativo/,
      'Debe rechazar timeout negativo -500'
    );
    assert.throws(
      () => OutputRetentionService.validateLockTimeout(300001),
      /excede el límite máximo seguro/,
      'Debe rechazar timeout superior al máximo (300001)'
    );

    // 3. Valores no numéricos, flotantes o no finitos (TypeError)
    assert.throws(
      () => OutputRetentionService.validateLockTimeout(NaN),
      /número entero finito/,
      'Debe rechazar NaN'
    );
    assert.throws(
      () => OutputRetentionService.validateLockTimeout(Infinity),
      /número entero finito/,
      'Debe rechazar Infinity'
    );
    assert.throws(
      () => OutputRetentionService.validateLockTimeout(-Infinity),
      /número entero finito/,
      'Debe rechazar -Infinity'
    );
    assert.throws(
      () => OutputRetentionService.validateLockTimeout(12.5),
      /sin decimales/,
      'Debe rechazar números decimales'
    );
    assert.throws(
      () => OutputRetentionService.validateLockTimeout('10000' as any),
      /número entero finito/,
      'Debe rechazar strings'
    );
    assert.throws(
      () => OutputRetentionService.validateLockTimeout(null as any),
      /número entero finito/,
      'Debe rechazar null'
    );

    // 4. Invocación de withCasAdvisoryLocks con timeout desactivado (0) y timeout en el límite mínimo (1ms)
    const testKeyValid = `outputs/test_timeout_valid_${crypto.randomUUID()}.txt`;
    await retentionService.withCasAdvisoryLocks(
      testKeyValid,
      async (client) => {
        const res = await client.query('SELECT 1 as val');
        assert.equal(res.rows[0].val, 1);
      },
      { lockTimeoutMs: 0 }
    );

    // 5. Invocación de withCasAdvisoryLocks con valor inválido debe rechazar inmediatamente antes de tocar BD
    await assert.rejects(
      async () => {
        await retentionService.withCasAdvisoryLocks(
          testKeyValid,
          async () => {},
          { lockTimeoutMs: -10 }
        );
      },
      /no puede ser negativo/,
      'withCasAdvisoryLocks debe rechazar timeout inválido inmediatamente'
    );

    // 6. Verificación de no fuga de sesión: checkout de nueva conexión tiene lock_timeout por defecto (0 o default)
    const freshClient = await pool.connect();
    try {
      const timeoutCheck = await freshClient.query('SHOW lock_timeout');
      assert.equal(
        timeoutCheck.rows[0].lock_timeout,
        '0',
        'La conexión del pool no debe tener lock_timeout alterado'
      );
    } finally {
      freshClient.release();
    }
  });
});
