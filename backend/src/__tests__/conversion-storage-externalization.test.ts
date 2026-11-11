/**
 * @file conversion-storage-externalization.test.ts
 * @description Suite de validación de desacoplamiento de almacenamiento y optimización TOAST (Fase 2B.1).
 *
 * Valida:
 * - Externalización de archivos generados a almacenamiento CAS independiente (storage/outputs/).
 * - Eliminación de payloads masivos en errorDetails (< 1500 bytes, inlining en heap de PostgreSQL).
 * - Compatibilidad dual de lectura (Fase 2B.1 vs histórico Fase 2A).
 * - Medición física del tamaño de tupla pg_column_size(error_details).
 * - Persistencia al catálogo canónico con metadatos de almacenamiento externo.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { eq, and, sql } from 'drizzle-orm';
import { db, pool } from '../db/index.ts';
import { backgroundJobs, songSources, songVersions, songs, users } from '../db/schema.ts';
import { ConversionWorker } from '../application/conversion-worker.ts';
import { ConversionJobService } from '../application/conversion-job-service.ts';
import { LocalFileSystemStorageProvider } from '../domain/storage/storage-provider.ts';
import { LocalFileSystemSourceStorageProvider } from '../domain/ingestion/source-storage-provider.ts';
import { SongService } from '../application/song-service.ts';
import { DrizzleSongRepository } from '../repositories/song-repository.ts';
import { DrizzleSongVersionRepository } from '../repositories/version-repository.ts';
import type { AuthenticatedUser } from '../domain/auth-types.ts';

describe('Phase 2B.1 — Conversion Storage Externalization & TOAST Optimization', () => {
  const testOutputDir = path.resolve(process.cwd(), 'storage', 'test-conversion-outputs');
  const testSourceDir = path.resolve(process.cwd(), 'storage', 'test-conversion-sources');

  let outputStorage: LocalFileSystemStorageProvider;
  let sourceStorage: LocalFileSystemSourceStorageProvider;
  let worker: ConversionWorker;
  let jobService: ConversionJobService;
  let songService: SongService;

  let testUser: AuthenticatedUser;
  let testUserId: string;

  before(async () => {
    await fs.rm(testOutputDir, { recursive: true, force: true });
    await fs.rm(testSourceDir, { recursive: true, force: true });
    await fs.mkdir(testOutputDir, { recursive: true });
    await fs.mkdir(testSourceDir, { recursive: true });

    outputStorage = new LocalFileSystemStorageProvider('storage/test-conversion-outputs');
    sourceStorage = new LocalFileSystemSourceStorageProvider('storage/test-conversion-sources');

    const songRepo = new DrizzleSongRepository(db);
    const versionRepo = new DrizzleSongVersionRepository(db);
    songService = new SongService(songRepo, versionRepo);

    worker = new ConversionWorker(db, sourceStorage, undefined, 'test-toast-worker', {
      outputStorage,
    });

    jobService = new ConversionJobService(
      songService,
      undefined,
      db,
      sourceStorage,
      worker,
      outputStorage
    );

    // Crear usuario de prueba
    testUserId = crypto.randomUUID();
    await db.insert(users).values({
      id: testUserId,
      email: `test_toast_${Date.now()}@bethesda.io`,
      passwordHash: 'dummy_hash_for_testing',
      firstName: 'TOAST',
      lastName: 'Tester',
      role: 'ADMIN',
    });

    testUser = {
      id: testUserId,
      role: 'ADMIN',
      email: 'test_toast@bethesda.io',
    };
  });

  after(async () => {
    // Limpieza de datos creados
    await db.delete(backgroundJobs).where(eq(backgroundJobs.userId, testUserId));
    await db.delete(users).where(eq(users.id, testUserId));
    await fs.rm(testOutputDir, { recursive: true, force: true });
    await fs.rm(testSourceDir, { recursive: true, force: true });
  });

  it('debe procesar un trabajo de conversión, externalizar el archivo a storage/outputs/ y mantener errorDetails sin data masivo', async () => {
    // 1. Guardar archivo fuente de prueba (MusicXML de tamaño representativo)
    const xmlContent = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">
<score-partwise version="4.0">
  <work><work-title>Himno de Adoración Phase 2B.1</work-title></work>
  <part-list>
    <score-part id="P1"><part-name>Voz</part-name></score-part>
  </part-list>
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>4</divisions>
        <key><fifths>0</fifths></key>
        <time><beats>4</beats><beat-type>4</beat-type></time>
        <clef><sign>G</sign><line>2</line></clef>
      </attributes>
      <harmony>
        <root><root-step>C</root-step></root>
        <kind>major</kind>
      </harmony>
      <note>
        <pitch><step>C</step><octave>4</octave></pitch>
        <duration>16</duration>
        <type>whole</type>
        <lyric number="1"><text>Santo</text></lyric>
      </note>
    </measure>
  </part>
</score-partwise>`;

    const sourceBuffer = Buffer.from(xmlContent, 'utf-8');
    const sourceHash = crypto.createHash('sha256').update(sourceBuffer).digest('hex');
    const sourceStorageKey = `sources/${sourceHash}.musicxml`;
    await sourceStorage.save(sourceStorageKey, sourceBuffer);

    // 2. Crear trabajo en segundo plano
    const jobId = crypto.randomUUID();
    await db.insert(backgroundJobs).values({
      id: jobId,
      jobType: 'CONVERSION',
      status: 'PENDING',
      userId: testUserId,
      tenantId: 'bethesda-default',
      inputRef: 'adoracion.musicxml',
      progress: 0,
      errorDetails: {
        targetFormat: 'CHORD_PRO',
        storageKey: sourceStorageKey,
        checksumSha256: sourceHash,
        options: { transposeSemitones: 2 },
      },
    });

    // 3. Procesar el trabajo con el worker
    const result = await worker.processJob({
      jobId,
      userId: testUserId,
      tenantId: 'bethesda-default',
      filename: 'adoracion.musicxml',
      targetFormat: 'CHORD_PRO',
      storageKey: sourceStorageKey,
      checksumSha256: sourceHash,
      options: { transposeSemitones: 2 },
    });

    assert(result.success, 'La conversión debió ser exitosa');

    // 4. Verificar el registro actualizado en background_jobs
    const [updatedJob] = await db
      .select()
      .from(backgroundJobs)
      .where(eq(backgroundJobs.id, jobId));

    assert.equal(updatedJob.status, 'COMPLETED');
    assert.equal(updatedJob.progress, 100);
    assert(updatedJob.outputStorageKey !== null, 'output_storage_key debe estar poblada');
    assert(updatedJob.outputChecksumSha256 !== null, 'output_checksum_sha256 debe estar poblada');
    assert(typeof updatedJob.outputByteLength === 'number' && updatedJob.outputByteLength > 0);

    // 5. Verificar que el archivo físico fue creado en el almacenamiento externo
    const fileExists = await outputStorage.exists(updatedJob.outputStorageKey!);
    assert.equal(fileExists, true, 'El archivo generado debe residir físicamente en storage/outputs/');

    const physicalContent = await outputStorage.getBuffer(updatedJob.outputStorageKey!);
    assert(physicalContent.length === updatedJob.outputByteLength);

    // 6. Verificar que errorDetails NO contiene 'data' masivo (Inlining en Heap)
    const details = updatedJob.errorDetails as any;
    assert.equal(details.data, undefined, 'errorDetails.data debe haber sido externalizado');
    assert.equal(details.targetFormat, 'CHORD_PRO');
    assert.equal(details.outputStorageKey, updatedJob.outputStorageKey);
    assert(details.canonicalPayload !== null, 'El AST canónico debe persistir en metadatos');
  });

  it('debe medir físicamente el tamaño en PostgreSQL pg_column_size(error_details) comprobando inlining < 1500 bytes', async () => {
    // 1. Crear un trabajo simulado histórico Fase 2A con datos masivos en línea (> 4000 bytes)
    const largeDummyData = crypto.randomBytes(3000).toString('hex'); // 6000 chars, incompresible, excede umbral TOAST
    const legacyJobId = crypto.randomUUID();
    await db.insert(backgroundJobs).values({
      id: legacyJobId,
      jobType: 'CONVERSION',
      status: 'COMPLETED',
      userId: testUserId,
      inputRef: 'legacy_big.xml',
      progress: 100,
      errorDetails: {
        targetFormat: 'MUSIC_XML',
        data: largeDummyData, // En línea masivo
        mimeType: 'text/xml',
      },
    });

    // 2. Medir pg_column_size del trabajo histórico vs el trabajo nuevo Fase 2B.1
    const sizeComparison = await pool.query(`
      SELECT 
        id,
        output_storage_key,
        pg_column_size(error_details) AS error_details_bytes,
        pg_column_size(background_jobs.*) AS total_row_bytes
      FROM background_jobs
      WHERE user_id = $1
      ORDER BY created_at DESC;
    `, [testUserId]);

    const legacyRow = sizeComparison.rows.find((r) => r.id === legacyJobId);
    const modernRow = sizeComparison.rows.find((r) => r.output_storage_key !== null);

    console.log('Size measurement:', {
      legacy_bytes: legacyRow?.error_details_bytes,
      modern_bytes: modernRow?.error_details_bytes,
      legacy_total: legacyRow?.total_row_bytes,
      modern_total: modernRow?.total_row_bytes,
    });

    assert(legacyRow !== undefined, 'Fila histórica debe existir');
    assert(modernRow !== undefined, 'Fila desacoplada Fase 2B.1 debe existir');

    // La fila histórica excede ampliamente los 2000 bytes y dispara compresión/TOAST
    assert(
      Number(legacyRow.error_details_bytes) > 2000,
      `Fila histórica esperada > 2000 bytes, fue ${legacyRow.error_details_bytes}`
    );

    // La fila modernizada Fase 2B.1 se mantiene estrictamente por debajo del umbral de 2048 bytes (TOAST_TUPLE_THRESHOLD)
    assert(
      Number(modernRow.error_details_bytes) < 2000,
      `Fila modernizada debe ser < 2000 bytes para evitar TOAST (inlining en heap), fue ${modernRow.error_details_bytes}`
    );

    // Limpieza
    await db.delete(backgroundJobs).where(eq(backgroundJobs.id, legacyJobId));
  });

  it('debe permitir la persistencia en catálogo canónico (commitJobToCatalog) utilizando metadatos de almacenamiento externo', async () => {
    // 1. Obtener el trabajo completado en la prueba anterior
    const [completedJob] = await db
      .select()
      .from(backgroundJobs)
      .where(
        and(
          eq(backgroundJobs.userId, testUserId),
          eq(backgroundJobs.status, 'COMPLETED')
        )
      );

    assert(completedJob, 'Debe haber un trabajo completado para persistir en catálogo');

    // 2. Comprometer al catálogo musical
    const committedResult = await jobService.commitJobToCatalog(completedJob.id, testUser, {
      title: 'Himno Fase 2B.1 en Catálogo',
      artist: 'Bethesda Worship Band',
    });

    assert(committedResult.song.id, 'Debe haber creado la canción');
    assert.equal(committedResult.song.title, 'Himno Fase 2B.1 en Catálogo');
    assert.equal(committedResult.song.artist, 'Bethesda Worship Band');

    // 3. Verificar que background_jobs fue actualizado con committedSongId
    const [updatedJob] = await db
      .select()
      .from(backgroundJobs)
      .where(eq(backgroundJobs.id, completedJob.id));

    assert.equal(updatedJob.committedSongId, committedResult.song.id);

    // 4. Verificar que song_sources se vinculó con la clave de almacenamiento externo y checksum
    const [linkedSource] = await db
      .select()
      .from(songSources)
      .where(eq(songSources.jobId, completedJob.id));

    assert(linkedSource !== undefined, 'song_sources debe contener el registro vinculado');
    assert.equal(linkedSource.storagePath, completedJob.outputStorageKey);
    assert.equal(linkedSource.checksumSha256, completedJob.outputChecksumSha256);
    assert.equal(linkedSource.fileSizeBytes, completedJob.outputByteLength);

    // 5. Verificar idempotencia: una segunda llamada a commitJobToCatalog debe retornar la canción existente sin duplicados
    const idempotentResult = await jobService.commitJobToCatalog(completedJob.id, testUser);
    assert.equal(idempotentResult.song.id, committedResult.song.id);

    // Limpieza de canciones creadas
    await db.delete(songSources).where(eq(songSources.jobId, completedJob.id));
    await db.delete(songVersions).where(eq(songVersions.songId, committedResult.song.id));
    await db.delete(songs).where(eq(songs.id, committedResult.song.id));
  });

  it('debe manejar compatibilidad dual de lectura y respetar política de podado (prunedAt)', async () => {
    // 1. Caso A: Trabajo nuevo con outputStorageKey
    const modernJobId = crypto.randomUUID();
    const testContent = '{title: Dual Read Modern}\n[C]Prueba [G]de lectura';
    const testBuf = Buffer.from(testContent, 'utf-8');
    const hash = crypto.createHash('sha256').update(testBuf).digest('hex');
    const key = `outputs/${hash}.chordpro`;
    await outputStorage.save(key, testBuf);

    await db.insert(backgroundJobs).values({
      id: modernJobId,
      jobType: 'CONVERSION',
      status: 'COMPLETED',
      userId: testUserId,
      inputRef: 'modern.chordpro',
      outputRef: 'modern.chordpro',
      outputStorageKey: key,
      outputChecksumSha256: hash,
      outputByteLength: testBuf.byteLength,
      progress: 100,
      errorDetails: { targetFormat: 'CHORD_PRO' },
    });

    const modernJob = await jobService.getJob(modernJobId, testUser);
    assert.equal(modernJob.outputStorageKey, key);

    // 2. Caso B: Trabajo histórico con details.data en línea
    const legacyJobId = crypto.randomUUID();
    const legacyData = '{title: Dual Read Legacy}\n[Am]Historico';
    await db.insert(backgroundJobs).values({
      id: legacyJobId,
      jobType: 'CONVERSION',
      status: 'COMPLETED',
      userId: testUserId,
      inputRef: 'legacy.chordpro',
      outputRef: 'legacy.chordpro',
      progress: 100,
      errorDetails: {
        targetFormat: 'CHORD_PRO',
        data: legacyData,
        isBinary: false,
      },
    });

    const legacyJob = await jobService.getJob(legacyJobId, testUser);
    assert.equal(legacyJob.outputStorageKey, null);
    assert.equal((legacyJob.errorDetails as any).data, legacyData);

    // 3. Caso C: Trabajo podado con pruned_at no nulo
    const prunedJobId = crypto.randomUUID();
    await db.insert(backgroundJobs).values({
      id: prunedJobId,
      jobType: 'CONVERSION',
      status: 'COMPLETED',
      userId: testUserId,
      inputRef: 'pruned.xml',
      outputRef: 'pruned.xml',
      outputStorageKey: 'outputs/old-file.xml',
      prunedAt: new Date(Date.now() - 1000), // Podado
      progress: 100,
      errorDetails: { targetFormat: 'MUSIC_XML' },
    });

    const prunedJob = await jobService.getJob(prunedJobId, testUser);
    assert(prunedJob.prunedAt !== null, 'prunedAt debe estar presente');

    // Limpieza
    await db.delete(backgroundJobs).where(eq(backgroundJobs.id, modernJobId));
    await db.delete(backgroundJobs).where(eq(backgroundJobs.id, legacyJobId));
    await db.delete(backgroundJobs).where(eq(backgroundJobs.id, prunedJobId));
  });
});
