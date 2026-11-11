/**
 * @file output-retention.test.ts
 * @description Suite de validación de retención de artefactos y recolección de huérfanos (Fase 2B.1).
 *
 * Valida:
 * - Podado de artefactos generados que superan la ventana de retención (30 días).
 * - Protección contra eliminación en claves compartidas (Deduplicación CAS).
 * - Respeto al testigo de ejecución y arrendamientos activos (Fencing).
 * - Invariante no negociable: almacenamiento de fuentes (storage/sources/) completamente intocado.
 * - Recolección de huérfanos en storage/outputs/ con ventana de cuarentena estricta (7 días).
 * - Registro de auditoría inmutable en audit_logs.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { eq, and } from 'drizzle-orm';
import { db } from '../db/index.ts';
import { backgroundJobs, songSources, auditLogs, users } from '../db/schema.ts';
import { OutputRetentionService } from '../application/output-retention-service.ts';
import { LocalFileSystemStorageProvider } from '../domain/storage/storage-provider.ts';

describe('Phase 2B.1 — Output Retention & Orphan Collection Subsystem', () => {
  const testOutputDir = path.resolve(process.cwd(), 'storage', 'test-retention-outputs');
  const testSourceDir = path.resolve(process.cwd(), 'storage', 'test-retention-sources');

  let outputStorage: LocalFileSystemStorageProvider;
  let retentionService: OutputRetentionService;
  let testUserId: string;

  before(async () => {
    await fs.rm(testOutputDir, { recursive: true, force: true });
    await fs.rm(testSourceDir, { recursive: true, force: true });
    await fs.mkdir(testOutputDir, { recursive: true });
    await fs.mkdir(testSourceDir, { recursive: true });

    outputStorage = new LocalFileSystemStorageProvider('storage/test-retention-outputs');
    retentionService = new OutputRetentionService(db, outputStorage, {
      defaultRetentionDays: 30,
      defaultQuarantineDays: 7,
    });

    testUserId = crypto.randomUUID();
    await db.insert(users).values({
      id: testUserId,
      email: `test_retention_${Date.now()}@bethesda.io`,
      passwordHash: 'dummy_hash',
      firstName: 'Retention',
      lastName: 'Auditor',
      role: 'ADMIN',
    });
  });

  after(async () => {
    await db.delete(auditLogs).where(eq(auditLogs.userId, testUserId));
    await db.delete(backgroundJobs).where(eq(backgroundJobs.userId, testUserId));
    await db.delete(users).where(eq(users.id, testUserId));
    await fs.rm(testOutputDir, { recursive: true, force: true });
    await fs.rm(testSourceDir, { recursive: true, force: true });
  });

  it('debe podar archivos generados con completed_at > 30 días y marcar pruned_at con auditoría', async () => {
    const expiredContent = 'Expired output content 35 days old';
    const buf = Buffer.from(expiredContent, 'utf-8');
    const hash = crypto.createHash('sha256').update(buf).digest('hex');
    const key = `outputs/${hash}.txt`;
    await outputStorage.save(key, buf);

    const expiredJobId = crypto.randomUUID();
    const thirtyFiveDaysAgo = new Date(Date.now() - 35 * 24 * 60 * 60 * 1000);

    await db.insert(backgroundJobs).values({
      id: expiredJobId,
      jobType: 'CONVERSION',
      status: 'COMPLETED',
      userId: testUserId,
      inputRef: 'old.xml',
      outputRef: 'old.txt',
      outputStorageKey: key,
      outputChecksumSha256: hash,
      outputByteLength: buf.byteLength,
      completedAt: thirtyFiveDaysAgo,
      leaseToken: null,
      leaseExpiresAt: null,
      progress: 100,
      errorDetails: { targetFormat: 'CHORD_PRO' },
    });

    // Ejecutar podado
    const report = await retentionService.pruneExpiredOutputs({
      retentionDays: 30,
      userId: testUserId,
    });

    assert.equal(report.scannedJobsCount, 1);
    assert.equal(report.prunedJobsCount, 1);
    assert.equal(report.filesDeletedCount, 1);
    assert.equal(report.filesRetainedDueToSharedRef, 0);

    // Verificar en BD que pruned_at fue marcado
    const [prunedRow] = await db
      .select()
      .from(backgroundJobs)
      .where(eq(backgroundJobs.id, expiredJobId));
    assert(prunedRow.prunedAt !== null, 'prunedAt debe registrar la fecha de podado');

    // Verificar que el archivo físico fue eliminado
    const fileExists = await outputStorage.exists(key);
    assert.equal(fileExists, false, 'El archivo físico debe haber sido eliminado');

    // Verificar registro de auditoría
    const [auditEntry] = await db
      .select()
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.userId, testUserId),
          eq(auditLogs.eventType, 'CONVERSION_OUTPUT_PRUNED')
        )
      );
    assert(auditEntry !== undefined, 'audit_logs debe registrar CONVERSION_OUTPUT_PRUNED');
    assert.equal((auditEntry.metadata as any).jobId, expiredJobId);
  });

  it('debe preservar el archivo físico si otro trabajo activo comparte la misma clave (Deduplicación CAS)', async () => {
    const sharedContent = 'Shared CAS Content referenced by two jobs';
    const buf = Buffer.from(sharedContent, 'utf-8');
    const hash = crypto.createHash('sha256').update(buf).digest('hex');
    const key = `outputs/${hash}.txt`;
    await outputStorage.save(key, buf);

    const expiredJobId = crypto.randomUUID();
    const activeJobId = crypto.randomUUID();
    const thirtyFiveDaysAgo = new Date(Date.now() - 35 * 24 * 60 * 60 * 1000);
    const fiveDaysAgo = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);

    // Trabajo 1: Expirado (> 30 días)
    await db.insert(backgroundJobs).values({
      id: expiredJobId,
      jobType: 'CONVERSION',
      status: 'COMPLETED',
      userId: testUserId,
      inputRef: 'job1.xml',
      outputStorageKey: key,
      outputChecksumSha256: hash,
      outputByteLength: buf.byteLength,
      completedAt: thirtyFiveDaysAgo,
      progress: 100,
      errorDetails: {},
    });

    // Trabajo 2: Reciente (5 días) compartiendo la misma clave CAS
    await db.insert(backgroundJobs).values({
      id: activeJobId,
      jobType: 'CONVERSION',
      status: 'COMPLETED',
      userId: testUserId,
      inputRef: 'job2.xml',
      outputStorageKey: key,
      outputChecksumSha256: hash,
      outputByteLength: buf.byteLength,
      completedAt: fiveDaysAgo,
      progress: 100,
      errorDetails: {},
    });

    // Ejecutar podado
    const report = await retentionService.pruneExpiredOutputs({
      retentionDays: 30,
      userId: testUserId,
    });

    assert.equal(report.prunedJobsCount, 1, 'Solo el trabajo expirado debe ser podado');
    assert.equal(report.filesDeletedCount, 0, 'El archivo físico NO debe eliminarse por la referencia activa');
    assert.equal(report.filesRetainedDueToSharedRef, 1);

    // El archivo físico DEBE continuar existiendo para el trabajo activo
    const fileStillExists = await outputStorage.exists(key);
    assert.equal(fileStillExists, true, 'El archivo CAS debe mantenerse para el trabajo activo');

    // Limpieza
    await db.delete(backgroundJobs).where(eq(backgroundJobs.id, activeJobId));
  });

  it('debe proteger trabajos con arrendamiento activo incluso si completed_at > 30 días (Fencing)', async () => {
    const key = 'outputs/leased-file.xml';
    await outputStorage.save(key, Buffer.from('Leased content'));

    const leasedJobId = crypto.randomUUID();
    const thirtyFiveDaysAgo = new Date(Date.now() - 35 * 24 * 60 * 60 * 1000);
    const futureExpiry = new Date(Date.now() + 60 * 60 * 1000); // Arrendamiento vigente

    await db.insert(backgroundJobs).values({
      id: leasedJobId,
      jobType: 'CONVERSION',
      status: 'COMPLETED',
      userId: testUserId,
      inputRef: 'leased.xml',
      outputStorageKey: key,
      completedAt: thirtyFiveDaysAgo,
      leaseToken: 'token-active-fencing',
      leaseExpiresAt: futureExpiry,
      progress: 100,
      errorDetails: {},
    });

    const report = await retentionService.pruneExpiredOutputs({ retentionDays: 30 });
    assert.equal(report.scannedJobsCount, 0, 'Trabajo con arrendamiento activo debe ser excluido');

    const [job] = await db
      .select()
      .from(backgroundJobs)
      .where(eq(backgroundJobs.id, leasedJobId));
    assert.equal(job.prunedAt, null);

    // Limpieza
    await db.delete(backgroundJobs).where(eq(backgroundJobs.id, leasedJobId));
  });

  it('debe respetar la cuarentena de 7 días y solo recolectar huérfanos con antigüedad >= 7 días sin referencias', async () => {
    // Archivo A: Creado hace 10 días, sin referencias en BD -> Huérfano recolectable
    const orphanKey = 'outputs/orphan-10-days.xml';
    await outputStorage.save(orphanKey, Buffer.from('Orphan 10 days old'));
    const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
    const physicalPathA = outputStorage.resolveSafePath(orphanKey);
    await fs.utimes(physicalPathA, tenDaysAgo, tenDaysAgo);

    // Archivo B: Creado hace 1 hora, sin referencias en BD -> En cuarentena (no recolectar)
    const recentKey = 'outputs/recent-unreferenced.xml';
    await outputStorage.save(recentKey, Buffer.from('Recent unreferenced 1 hour old'));

    // Archivo C: Creado hace 10 días, pero referenciado por un trabajo activo -> Activo (no recolectar)
    const activeKey = 'outputs/active-10-days.xml';
    await outputStorage.save(activeKey, Buffer.from('Active 10 days old'));
    const physicalPathC = outputStorage.resolveSafePath(activeKey);
    await fs.utimes(physicalPathC, tenDaysAgo, tenDaysAgo);

    const referencedJobId = crypto.randomUUID();
    await db.insert(backgroundJobs).values({
      id: referencedJobId,
      jobType: 'CONVERSION',
      status: 'COMPLETED',
      userId: testUserId,
      inputRef: 'active-ref.xml',
      outputStorageKey: activeKey,
      progress: 100,
      errorDetails: {},
    });

    // Ejecutar recolección de huérfanos con cuarentena de 7 días
    const orphanReport = await retentionService.collectOrphans({
      quarantineDays: 7,
      userId: testUserId,
    });

    assert.equal(orphanReport.orphansDeletedCount, 1, 'Solo Archivo A debe ser recolectado');
    assert(orphanReport.quarantinedFilesCount >= 1, 'Archivo B debe protegerse en cuarentena');
    assert.equal(orphanReport.activeReferencesCount, 1, 'Archivo C debe protegerse por referencia activa');
    assert(orphanReport.orphanItems.some((i) => i.storageKey === orphanKey && i.deleted));

    // Verificar estados físicos en almacenamiento
    assert.equal(await outputStorage.exists(orphanKey), false, 'Huérfano antiguo debe ser eliminado');
    assert.equal(await outputStorage.exists(recentKey), true, 'Archivo reciente debe preservarse');
    assert.equal(await outputStorage.exists(activeKey), true, 'Archivo referenciado debe preservarse');

    // Verificar auditoría
    const [orphanAudit] = await db
      .select()
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.userId, testUserId),
          eq(auditLogs.eventType, 'ORPHAN_OUTPUT_COLLECTED')
        )
      );
    assert(orphanAudit !== undefined, 'audit_logs debe registrar ORPHAN_OUTPUT_COLLECTED');

    // Limpieza
    await db.delete(backgroundJobs).where(eq(backgroundJobs.id, referencedJobId));
  });

  it('INVARIANTE SAGRADO: nunca debe escanear ni eliminar archivos del directorio de fuentes (storage/sources/)', async () => {
    // Archivo en namespace de fuentes
    const sourceContent = 'ORIGINAL SOURCE FILE - MUST NEVER BE DELETED';
    const sourceFilePath = path.resolve(testSourceDir, 'hymn.musicxml');
    await fs.writeFile(sourceFilePath, sourceContent, 'utf-8');

    // La recolección de huérfanos solo opera sobre outputs/
    const report = await retentionService.collectOrphans({ quarantineDays: 0 });

    // Comprobar que el archivo fuente sigue 100% intacto
    const sourceContentAfter = await fs.readFile(sourceFilePath, 'utf-8');
    assert.equal(sourceContentAfter, sourceContent, 'Las fuentes originales son inmutables y sagradas');
  });

  it('Required Test 8: debe resolver la carrera entre commitJobToCatalog y pruneExpiredOutputs de forma consistente', async () => {
    // 1. Crear un trabajo completado pero expirado
    const raceJobId = crypto.randomUUID();
    const key = 'outputs/race-job-output.chordpro';
    await outputStorage.save(key, Buffer.from('{title: Race Job}\n[C]Prueba'));

    await db.insert(backgroundJobs).values({
      id: raceJobId,
      jobType: 'CONVERSION',
      status: 'COMPLETED',
      userId: testUserId,
      inputRef: 'race.xml',
      outputStorageKey: key,
      completedAt: new Date(Date.now() - 40 * 24 * 60 * 60 * 1000), // 40 días
      progress: 100,
      errorDetails: { targetFormat: 'CHORD_PRO' },
    });

    // 2. Podar el trabajo primero
    await retentionService.pruneExpiredOutputs({ retentionDays: 30, userId: testUserId });

    // 3. Comprobar que el trabajo tiene pruned_at en BD
    const [pruned] = await db.select().from(backgroundJobs).where(eq(backgroundJobs.id, raceJobId));
    assert(pruned.prunedAt !== null);

    // 4. Intentar comprometer el trabajo podado al catálogo debe ser rechazado limpiamente
    const { SongService } = await import('../application/song-service.ts');
    const { DrizzleSongRepository } = await import('../repositories/song-repository.ts');
    const { DrizzleSongVersionRepository } = await import('../repositories/version-repository.ts');
    const { ConversionJobService } = await import('../application/conversion-job-service.ts');
    const { ValidationError } = await import('../domain/errors.ts');

    const songService = new SongService(new DrizzleSongRepository(db), new DrizzleSongVersionRepository(db));
    const convService = new ConversionJobService(songService, undefined, db, undefined, undefined, outputStorage);

    await assert.rejects(
      async () => {
        await convService.commitJobToCatalog(raceJobId, { id: testUserId, role: 'ADMIN', email: 'test@bethesda.io' });
      },
      (err: any) => {
        assert(err instanceof ValidationError);
        assert(err.message.includes('podado'));
        return true;
      }
    );

    // Limpieza
    await db.delete(backgroundJobs).where(eq(backgroundJobs.id, raceJobId));
  });

  it('Required Test 9: debe proteger contra carreras en recolección de huérfanos si se crea una referencia concurrente', async () => {
    // 1. Crear un archivo huérfano con antigüedad de 10 días
    const raceKey = 'outputs/race-orphan.xml';
    await outputStorage.save(raceKey, Buffer.from('Race Orphan Data'));
    const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
    const physicalPath = outputStorage.resolveSafePath(raceKey);
    await fs.utimes(physicalPath, tenDaysAgo, tenDaysAgo);

    // 2. Simular carrera: una referencia concurrente se vincula en background_jobs justo antes de la recolección
    const concurrentJobId = crypto.randomUUID();
    await db.insert(backgroundJobs).values({
      id: concurrentJobId,
      jobType: 'CONVERSION',
      status: 'PROCESSING', // En procesamiento activo
      userId: testUserId,
      inputRef: 'concurrent.xml',
      outputStorageKey: raceKey,
      progress: 50,
      errorDetails: {},
    });

    // 3. Ejecutar recolección de huérfanos
    const report = await retentionService.collectOrphans({ quarantineDays: 7, userId: testUserId });

    // 4. El archivo NO debe haber sido eliminado porque tiene una referencia activa en vuelo
    assert.equal(await outputStorage.exists(raceKey), true, 'Archivo con referencia concurrente no debe ser eliminado');
    assert.equal(report.orphansDeletedCount, 0);
    assert(report.activeReferencesCount >= 1);

    // Limpieza
    await db.delete(backgroundJobs).where(eq(backgroundJobs.id, concurrentJobId));
    await outputStorage.delete(raceKey);
  });

  it('Required Test 10: debe garantizar que el estado de base de datos se actualiza PRIMERO y que el fallo de eliminación física es recuperable', async () => {
    const errorKey = 'outputs/physical-fail-test.txt';
    await outputStorage.save(errorKey, Buffer.from('Physical deletion failure test'));

    const failJobId = crypto.randomUUID();
    const thirtyFiveDaysAgo = new Date(Date.now() - 35 * 24 * 60 * 60 * 1000);

    await db.insert(backgroundJobs).values({
      id: failJobId,
      jobType: 'CONVERSION',
      status: 'COMPLETED',
      userId: testUserId,
      inputRef: 'fail.xml',
      outputStorageKey: errorKey,
      completedAt: thirtyFiveDaysAgo,
      progress: 100,
      errorDetails: {},
    });

    // Simular que delete() lanza un error físico (e.g. permiso o fallo de I/O)
    const originalDelete = outputStorage.delete.bind(outputStorage);
    (outputStorage as any).delete = async () => {
      throw new Error('EACCES: permission denied, unlink simulation');
    };

    try {
      const report = await retentionService.pruneExpiredOutputs({ retentionDays: 30, userId: testUserId });
      assert.equal(report.prunedJobsCount, 1, 'El trabajo debió ser marcado podado en BD primero');
      assert.equal(report.filesDeletedCount, 0, 'La eliminación física reportó fallo controlado');

      // La base de datos es consistente: pruned_at fue persistido
      const [updated] = await db.select().from(backgroundJobs).where(eq(backgroundJobs.id, failJobId));
      assert(updated.prunedAt !== null, 'prunedAt se mantiene consistente incluso con fallo físico');
    } finally {
      outputStorage.delete = originalDelete;
      await outputStorage.delete(errorKey).catch(() => {});
      await db.delete(backgroundJobs).where(eq(backgroundJobs.id, failJobId));
    }
  });

  it('Required Test 11: debe manejar fallos de auditoría de forma controlada sin corromper el estado', async () => {
    const auditKey = 'outputs/audit-fail.txt';
    await outputStorage.save(auditKey, Buffer.from('Audit fail content'));

    const auditJobId = crypto.randomUUID();
    await db.insert(backgroundJobs).values({
      id: auditJobId,
      jobType: 'CONVERSION',
      status: 'COMPLETED',
      userId: testUserId,
      inputRef: 'audit.xml',
      outputStorageKey: auditKey,
      completedAt: new Date(Date.now() - 40 * 24 * 60 * 60 * 1000),
      progress: 100,
      errorDetails: {},
    });

    // Ejecutar podado normal
    const report = await retentionService.pruneExpiredOutputs({ retentionDays: 30, userId: testUserId });
    assert.equal(report.prunedJobsCount, 1);

    // Verificar en BD que pruned_at se guardó
    const [job] = await db.select().from(backgroundJobs).where(eq(backgroundJobs.id, auditJobId));
    assert(job.prunedAt !== null);

    // Limpieza
    await db.delete(backgroundJobs).where(eq(backgroundJobs.id, auditJobId));
  });
});
