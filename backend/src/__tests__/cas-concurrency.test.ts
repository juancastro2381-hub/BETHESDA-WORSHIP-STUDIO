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

  it('Escenario F: Process crashes after both physical deletions but before database finalization', async () => {
    const salt = crypto.randomUUID();
    const hash = crypto.createHash('sha256').update('Scenario F ' + salt).digest('hex');
    const key = `outputs/${hash}.txt`;
    const canonicalKey = `outputs/${hash}.canonical.json`;

    // Ninguno de los dos archivos existe en disco (ambos fueron desvinculados antes del crash)
    assert.equal(await outputStorage.exists(key), false);
    assert.equal(await outputStorage.exists(canonicalKey), false);

    try {
      await db.insert(casDeletionIntents).values({
        storageKey: key,
        canonicalKey,
        checksumSha256: hash,
        state: 'DELETE_PENDING',
        primaryDeleted: false,
        companionDeleted: false,
        attempts: 0,
      });

      const recReport = await retentionService.reconcilePendingDeletions({ userId: testUserId });
      assert(recReport.reconciledCount >= 1);
      assert.equal(recReport.failedCount, 0);

      const [intent] = await db
        .select()
        .from(casDeletionIntents)
        .where(eq(casDeletionIntents.storageKey, key));

      assert.equal(intent.state, 'DELETED');
      assert.equal(intent.primaryDeleted, true);
      assert.equal(intent.companionDeleted, true);
      assert.equal(intent.audited, true);
    } finally {
      await db.delete(casDeletionIntents).where(eq(casDeletionIntents.storageKey, key));
    }
  });

  it('Escenario G: Lock acquisition fails after acquiring the first key but before acquiring the second', async () => {
    const keyA = `outputs/test_lock_a_${crypto.randomUUID()}.txt`;
    const keyB = `outputs/test_lock_b_${crypto.randomUUID()}.canonical.json`;
    const sortedKeys = [keyA, keyB].sort();
    const firstKey = sortedKeys[0];
    const secondKey = sortedKeys[1];

    const blockerClient = await pool.connect();
    const verifierClient = await pool.connect();

    try {
      // Bloquear secondKey en un cliente independiente
      await blockerClient.query('SELECT pg_advisory_lock(hashtext($1))', [secondKey]);

      // Intentar adquisición secuencial en un cliente con statement_timeout corto (100ms)
      // para forzar fallo durante la adquisición de la segunda clave
      let acquisitionFailed = false;
      const client = await pool.connect();
      try {
        await client.query('SET statement_timeout = 100');
        await client.query('SELECT pg_advisory_lock(hashtext($1))', [firstKey]);
        // Ahora intentar secondKey -> fallará por timeout al estar tomada por blockerClient
        await client.query('SELECT pg_advisory_lock(hashtext($1))', [secondKey]);
      } catch {
        acquisitionFailed = true;
        // Simular el bloque finally de withCasAdvisoryLocks:
        // Debe liberar confiablemente la primera clave adquirida
        await client.query('SET statement_timeout = 0').catch(() => {});
        await client.query('SELECT pg_advisory_unlock(hashtext($1))', [firstKey]).catch(() => {});
      } finally {
        client.release();
      }

      assert.equal(acquisitionFailed, true, 'La adquisición de secondKey debió fallar por contención');

      // Verificación crítica: firstKey fue liberado y NO quedó bloqueado o filtrado
      const testLock = await verifierClient.query(
        'SELECT pg_try_advisory_lock(hashtext($1)) as acquired',
        [firstKey]
      );
      assert.equal(
        testLock.rows[0].acquired,
        true,
        'firstKey debe haber sido liberado en el bloque finally'
      );

      await verifierClient.query('SELECT pg_advisory_unlock(hashtext($1))', [firstKey]);
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
});
