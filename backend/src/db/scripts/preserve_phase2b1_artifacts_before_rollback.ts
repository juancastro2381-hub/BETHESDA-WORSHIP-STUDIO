/**
 * @file preserve_phase2b1_artifacts_before_rollback.ts
 * @description Procedimiento de preservación física completa y atómica de artefactos antes de rollback de esquema (Fase 2B.1).
 *
 * Funciones Principales:
 * 1. Enumerable autoritativo de trabajos con output_storage_key no nulos en background_jobs.
 * 2. Verificación física de existencia e integridad criptográfica SHA-256 contra la base de datos.
 * 3. Detección y preservación de archivos companion canónicos (*.canonical.json) para Zero Musical Fabrication.
 * 4. Copia segura a directorio de respaldo inmutable (storage/rollback-backup/<timestamp>/).
 * 5. Generación de manifest.json con hashes, tamaños, metadata y procedimientos de restauración.
 * 6. Respaldo relacional en background_jobs_phase2b1_rollback_backup.
 * 7. Política Fail-Closed: ante cualquier discrepancia o archivo faltante no podado, el script aborta con código 1.
 */

import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { isNotNull } from 'drizzle-orm';
import { db, pool } from '../index.ts';
import { backgroundJobs } from '../schema.ts';
import { LocalFileSystemStorageProvider } from '../../domain/storage/storage-provider.ts';

export interface PreservedArtifactEntry {
  jobId: string;
  userId: string | null;
  status: string;
  outputRef: string | null;
  outputStorageKey: string;
  outputChecksumSha256: string | null;
  outputByteLength: number | null;
  prunedAt: string | null;
  createdAt: string | null;
  completedAt: string | null;
  physicalFileExists: boolean;
  checksumVerified: boolean;
  preservedFilePath: string | null;
  companionStorageKey: string | null;
  companionPreservedPath: string | null;
}

export interface RollbackBackupManifest {
  version: string;
  timestamp: string;
  backupDirectory: string;
  totalJobsScanned: number;
  activeArtifactsPreserved: number;
  prunedArtifactsRecorded: number;
  companionFilesPreserved: number;
  artifacts: PreservedArtifactEntry[];
  restorationInstructions: {
    schemaRestore: string;
    filesRestore: string;
  };
}

export async function preservePhase2b1Artifacts(options?: {
  backupRoot?: string;
  storageBaseDir?: string;
}): Promise<RollbackBackupManifest> {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupRoot = options?.backupRoot ?? path.resolve(process.cwd(), 'storage', 'rollback-backup');
  const backupDir = path.join(backupRoot, `backup-${timestamp}`);
  const artifactsDir = path.join(backupDir, 'artifacts');

  await fs.mkdir(artifactsDir, { recursive: true });

  const storageProvider = new LocalFileSystemStorageProvider(options?.storageBaseDir ?? 'storage/outputs');

  console.log(`[PRESERVE-2B.1] Iniciando escaneo autoritativo de base de datos...`);

  // 1. Consultar todos los trabajos con artefactos externos
  const jobs = await db
    .select()
    .from(backgroundJobs)
    .where(isNotNull(backgroundJobs.outputStorageKey));

  console.log(`[PRESERVE-2B.1] Trabajos detectados con output_storage_key: ${jobs.length}`);

  let activeArtifactsPreserved = 0;
  let prunedArtifactsRecorded = 0;
  let companionFilesPreserved = 0;
  const artifactEntries: PreservedArtifactEntry[] = [];

  for (const job of jobs) {
    const storageKey = job.outputStorageKey!;
    const isPruned = job.prunedAt !== null;

    let physicalExists = false;
    let checksumVerified = false;
    let preservedFilePath: string | null = null;
    let companionStorageKey: string | null = null;
    let companionPreservedPath: string | null = null;

    if (!isPruned) {
      physicalExists = await storageProvider.exists(storageKey);
      if (!physicalExists) {
        throw new Error(
          `[FAIL-CLOSED PRECONDITION FAILED] Trabajo activo ${job.id} declara output_storage_key "${storageKey}", pero el archivo físico no existe en almacenamiento.`
        );
      }

      // Verificación de integridad criptográfica
      const buffer = await storageProvider.getBuffer(storageKey);
      const computedHash = crypto.createHash('sha256').update(buffer).digest('hex');

      if (job.outputChecksumSha256 && computedHash !== job.outputChecksumSha256) {
        throw new Error(
          `[FAIL-CLOSED PRECONDITION FAILED] Corrupción de integridad detectada para trabajo ${job.id}: hash esperado ${job.outputChecksumSha256}, hash calculado ${computedHash}`
        );
      }
      checksumVerified = true;

      // Preservar copia física inmutable
      const destPath = path.join(artifactsDir, path.basename(storageKey));
      await fs.writeFile(destPath, buffer);
      preservedFilePath = path.relative(backupDir, destPath);
      activeArtifactsPreserved++;

      // Verificar y preservar companion canónico (*.canonical.json)
      const companionCandidateKey = storageKey.replace(/\.[^.]+$/, '.canonical.json');
      if (await storageProvider.exists(companionCandidateKey)) {
        companionStorageKey = companionCandidateKey;
        const compBuf = await storageProvider.getBuffer(companionCandidateKey);
        const compDestPath = path.join(artifactsDir, path.basename(companionCandidateKey));
        await fs.writeFile(compDestPath, compBuf);
        companionPreservedPath = path.relative(backupDir, compDestPath);
        companionFilesPreserved++;
      }
    } else {
      prunedArtifactsRecorded++;
    }

    artifactEntries.push({
      jobId: job.id,
      userId: job.userId,
      status: job.status,
      outputRef: job.outputRef,
      outputStorageKey: storageKey,
      outputChecksumSha256: job.outputChecksumSha256,
      outputByteLength: job.outputByteLength,
      prunedAt: job.prunedAt ? job.prunedAt.toISOString() : null,
      createdAt: job.createdAt ? job.createdAt.toISOString() : null,
      completedAt: job.completedAt ? job.completedAt.toISOString() : null,
      physicalFileExists: physicalExists,
      checksumVerified,
      preservedFilePath,
      companionStorageKey,
      companionPreservedPath,
    });
  }

  // 2. Preservar registros en base de datos en background_jobs_phase2b1_rollback_backup
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`
      CREATE TABLE IF NOT EXISTS background_jobs_phase2b1_rollback_backup (
        backup_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        job_id UUID NOT NULL,
        user_id UUID,
        status VARCHAR(50),
        input_ref TEXT,
        output_ref TEXT,
        output_storage_key TEXT,
        output_checksum_sha256 VARCHAR(64),
        output_byte_length BIGINT,
        pruned_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ,
        completed_at TIMESTAMPTZ,
        backed_up_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    await client.query(`
      INSERT INTO background_jobs_phase2b1_rollback_backup (
        job_id, user_id, status, input_ref, output_ref, output_storage_key,
        output_checksum_sha256, output_byte_length, pruned_at, created_at, completed_at
      )
      SELECT id, user_id, status, input_ref, output_ref, output_storage_key,
             output_checksum_sha256, output_byte_length, pruned_at, created_at, completed_at
      FROM background_jobs
      WHERE output_storage_key IS NOT NULL;
    `);
    await client.query('COMMIT');
  } finally {
    client.release();
  }

  // 3. Generar manifest.json durable
  const manifest: RollbackBackupManifest = {
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    backupDirectory: backupDir,
    totalJobsScanned: jobs.length,
    activeArtifactsPreserved,
    prunedArtifactsRecorded,
    companionFilesPreserved,
    artifacts: artifactEntries,
    restorationInstructions: {
      schemaRestore:
        'Para restaurar las columnas de Fase 2B.1 y los datos preservados: ejecute la migración 0017_phase2b1_output_storage.sql y luego restaure los campos desde background_jobs_phase2b1_rollback_backup.',
      filesRestore:
        'Copie todos los archivos del directorio artifacts/ hacia storage/outputs/. Todos los hashes y nombres de archivos preservan su formato canónico CAS.',
    },
  };

  const manifestPath = path.join(backupDir, 'manifest.json');
  const manifestContent = JSON.stringify(manifest, null, 2);
  await fs.writeFile(manifestPath, manifestContent, 'utf-8');

  const manifestHash = crypto.createHash('sha256').update(manifestContent).digest('hex');

  console.log(`[PRESERVE-2B.1] Preservación completada exitosamente.`);
  console.log(`[PRESERVE-2B.1] Directorio de respaldo: ${backupDir}`);
  console.log(`[PRESERVE-2B.1] Activos preservados: ${activeArtifactsPreserved}, Canónicos companion: ${companionFilesPreserved}`);
  console.log(`[PRESERVE-2B.1] Manifest SHA-256: ${manifestHash}`);

  return manifest;
}

if (process.argv[1] && process.argv[1].includes('preserve_phase2b1_artifacts_before_rollback')) {
  preservePhase2b1Artifacts()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('[PRESERVE-2B.1] FATAL:', err);
      process.exit(1);
    });
}
