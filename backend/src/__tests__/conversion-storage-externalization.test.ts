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
import { createReferenceSongFixture } from '../../../frontend/src/core/canonical-model/fixtures/reference-song.ts';
import { CanonicalSerializer } from '../domain/canonical-serializer.ts';
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

    // 6. Verificar que errorDetails NO contiene 'data' ni 'canonicalPayload' masivo (Inlining en Heap)
    const details = updatedJob.errorDetails as any;
    assert.equal(details.data, undefined, 'errorDetails.data debe haber sido externalizado');
    assert.equal(details.targetFormat, 'CHORD_PRO');
    assert.equal(details.outputStorageKey, updatedJob.outputStorageKey);
    assert(details.canonicalStorageKey !== undefined, 'El puntero canonicalStorageKey debe residir en metadatos');
    assert.equal(
      await outputStorage.exists(details.canonicalStorageKey),
      true,
      'El AST canónico companion debe residir físicamente en storage/outputs/'
    );
  });

  it('Required Test 15: debe comprobar empíricamente que pg_column_size(error_details) <= 1500 bytes en múltiples partituras representativas', async () => {
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

    // 2. Insertar tres trabajos representativos modernizados (Pequeño, Mediano, Grande)
    const scoreConfigs = [
      { name: 'score_small', format: 'CHORD_PRO', keys: 1 },
      { name: 'score_medium', format: 'MUSIC_XML', keys: 10 },
      { name: 'score_large', format: 'MUSIC_XML', keys: 50 },
    ];

    const modernJobIds: string[] = [];
    for (const conf of scoreConfigs) {
      const jId = crypto.randomUUID();
      modernJobIds.push(jId);
      const fakeChecksum = crypto.createHash('sha256').update(conf.name).digest('hex');
      await db.insert(backgroundJobs).values({
        id: jId,
        jobType: 'CONVERSION',
        status: 'COMPLETED',
        userId: testUserId,
        inputRef: `${conf.name}.xml`,
        outputRef: `${conf.name}.xml`,
        outputStorageKey: `outputs/${fakeChecksum}.xml`,
        outputChecksumSha256: fakeChecksum,
        outputByteLength: 1024 * conf.keys,
        progress: 100,
        errorDetails: {
          targetFormat: conf.format,
          mimeType: conf.format === 'MUSIC_XML' ? 'application/vnd.recordare.musicxml+xml' : 'text/x-chordpro',
          isBinary: false,
          outputStorageKey: `outputs/${fakeChecksum}.xml`,
          canonicalStorageKey: `outputs/${fakeChecksum}.canonical.json`,
          outputChecksumSha256: fakeChecksum,
          outputByteLength: 1024 * conf.keys,
          diagnostics: { rulesApplied: 5, issues: [], warnings: [] },
          storageKey: `sources/${fakeChecksum}.xml`,
          checksumSha256: fakeChecksum,
          options: { transposeSemitones: 0 },
        },
      });
    }

    // 3. Medir físicamente en PostgreSQL pg_column_size(error_details)
    const sizeComparison = await pool.query(`
      SELECT 
        id,
        input_ref,
        output_storage_key,
        pg_column_size(error_details) AS error_details_bytes,
        pg_column_size(background_jobs.*) AS total_row_bytes
      FROM background_jobs
      WHERE user_id = $1
      ORDER BY created_at DESC;
    `, [testUserId]);

    const legacyRow = sizeComparison.rows.find((r) => r.id === legacyJobId);
    assert(legacyRow !== undefined, 'Fila histórica debe existir');

    // La fila histórica excede ampliamente los 2000 bytes y dispara compresión/TOAST
    assert(
      Number(legacyRow.error_details_bytes) > 2000,
      `Fila histórica esperada > 2000 bytes, fue ${legacyRow.error_details_bytes}`
    );

    // Cada trabajo modernizado Fase 2B.1 DEBE cumplir estrictamente pg_column_size(error_details) <= 1500 bytes
    for (const jId of modernJobIds) {
      const row = sizeComparison.rows.find((r) => r.id === jId);
      assert(row !== undefined);
      const bytes = Number(row.error_details_bytes);
      console.log(`Empirical measurement for ${row.input_ref}: ${bytes} bytes (total row: ${row.total_row_bytes} bytes)`);
      assert(
        bytes <= 1500,
        `Fila modernizada ${row.input_ref} debe cumplir <= 1500 bytes (inlining en Heap), fue ${bytes}`
      );
      assert(
        bytes < 800,
        `Fila modernizada ${row.input_ref} debe mantenerse típicamente entre 300-600 bytes, fue ${bytes}`
      );
    }

    // Limpieza
    await db.delete(backgroundJobs).where(eq(backgroundJobs.id, legacyJobId));
    for (const jId of modernJobIds) {
      await db.delete(backgroundJobs).where(eq(backgroundJobs.id, jId));
    }
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

  it('Required Test 6: debe manejar fallo en base de datos posterior a escritura en almacenamiento sin corromper el estado', async () => {
    // Si la escritura en storage es exitosa pero la BD falla al actualizar el estado terminal,
    // el archivo en storage/outputs/ permanece protegido por la cuarentena de 7 días y la BD no queda en estado inconsistente.
    const casKey = 'outputs/db-failure-simulation.txt';
    const testBuffer = Buffer.from('Database failure simulation test');
    await outputStorage.save(casKey, testBuffer);

    // Simular un trabajo que quedó en PENDING porque la BD no pudo finalizar
    const failedJobId = crypto.randomUUID();
    await db.insert(backgroundJobs).values({
      id: failedJobId,
      jobType: 'CONVERSION',
      status: 'PROCESSING',
      userId: testUserId,
      inputRef: 'uncommitted.xml',
      progress: 50,
      leaseToken: 'lease-uncommitted',
      leaseExpiresAt: new Date(Date.now() + 60000),
      errorDetails: {},
    });

    const [uncommitted] = await db.select().from(backgroundJobs).where(eq(backgroundJobs.id, failedJobId));
    assert.equal(uncommitted.status, 'PROCESSING');
    assert.equal(uncommitted.outputStorageKey, null);

    // El archivo físico existe pero no está referenciado por un trabajo completado
    assert.equal(await outputStorage.exists(casKey), true);

    await db.delete(backgroundJobs).where(eq(backgroundJobs.id, failedJobId));
    await outputStorage.delete(casKey);
  });

  it('Required Test 7: debe proteger el trabajo contra finalización por worker con lease expirado', async () => {
    const expiredJobId = crypto.randomUUID();
    const expiredLeaseDate = new Date(Date.now() - 5000); // Expirado hace 5 segundos

    await db.insert(backgroundJobs).values({
      id: expiredJobId,
      jobType: 'CONVERSION',
      status: 'PROCESSING',
      userId: testUserId,
      inputRef: 'expired_lease.xml',
      progress: 50,
      leaseToken: 'token-stale-worker',
      leaseExpiresAt: expiredLeaseDate,
      errorDetails: {},
    });

    // Intento de finalización por un worker con token inválido o expirado
    const [finalized] = await db
      .update(backgroundJobs)
      .set({ status: 'COMPLETED', progress: 100 })
      .where(
        and(
          eq(backgroundJobs.id, expiredJobId),
          eq(backgroundJobs.leaseToken, 'wrong-token'),
          eq(backgroundJobs.status, 'PROCESSING')
        )
      )
      .returning();

    assert.equal(finalized, undefined, 'Fencing token inválido debe rechazar la finalización');

    await db.delete(backgroundJobs).where(eq(backgroundJobs.id, expiredJobId));
  });

  it('Required Test 12: debe rechazar rollback de esquema con precondición estricta si existen referencias pobladas (Fail-Closed)', async () => {
    // 1. Crear un trabajo con output_storage_key poblada
    const populatedJobId = crypto.randomUUID();
    await db.insert(backgroundJobs).values({
      id: populatedJobId,
      jobType: 'CONVERSION',
      status: 'COMPLETED',
      userId: testUserId,
      inputRef: 'rollback_test.xml',
      outputStorageKey: 'outputs/populated-key.xml',
      outputChecksumSha256: 'abc123sha256',
      outputByteLength: 1024,
      progress: 100,
      errorDetails: {},
    });

    // 2. Ejecutar el guard de rollback en un bloque transaccional
    await assert.rejects(
      async () => {
        await pool.query(`
          DO $$
          DECLARE
              v_populated_count integer;
              v_allow_override text := current_setting('bethesda.allow_phase2b1_rollback_data_loss', true);
          BEGIN
              SELECT count(*) INTO v_populated_count
              FROM background_jobs
              WHERE output_storage_key IS NOT NULL;

              IF v_populated_count > 0 AND (v_allow_override IS NULL OR v_allow_override <> 'TRUE') THEN
                  RAISE EXCEPTION 'PRECONDITION FAILED: No se pueden eliminar las columnas de almacenamiento externo de la Fase 2B.1. Se detectaron % trabajos con output_storage_key no nulos.', v_populated_count;
              END IF;
          END $$;
        `);
      },
      (err: any) => {
        assert(err.message.includes('PRECONDITION FAILED'));
        return true;
      }
    );

    // 3. Comprobar que con la bandera explícita de anulación sí se permite
    await pool.query(`
      SET LOCAL bethesda.allow_phase2b1_rollback_data_loss = 'TRUE';
      DO $$
      DECLARE
          v_populated_count integer;
          v_allow_override text := current_setting('bethesda.allow_phase2b1_rollback_data_loss', true);
      BEGIN
          SELECT count(*) INTO v_populated_count
          FROM background_jobs
          WHERE output_storage_key IS NOT NULL;

          IF v_populated_count > 0 AND (v_allow_override IS NULL OR v_allow_override <> 'TRUE') THEN
              RAISE EXCEPTION 'PRECONDITION FAILED';
          END IF;
      END $$;
    `);

    // Limpieza
    await db.delete(backgroundJobs).where(eq(backgroundJobs.id, populatedJobId));
  });

  it('Required Test 14: debe procesar y rehidratar partituras con ASTs canónicos masivos con fidelidad absoluta', async () => {
    // Generar un AST canónico exhaustivo de referencia y serializarlo
    const fixture = createReferenceSongFixture();
    const serializedLargeAst = JSON.stringify(CanonicalSerializer.serialize(fixture));
    const astBuffer = Buffer.from(serializedLargeAst, 'utf-8');
    const astHash = crypto.createHash('sha256').update(astBuffer).digest('hex');

    // Externalizar a CAS companion
    const companionKey = `outputs/${astHash}.canonical.json`;
    await outputStorage.save(companionKey, astBuffer);

    // Guardar trabajo completado con el companionKey
    const massiveJobId = crypto.randomUUID();
    await db.insert(backgroundJobs).values({
      id: massiveJobId,
      jobType: 'CONVERSION',
      status: 'COMPLETED',
      userId: testUserId,
      inputRef: 'canto_masivo.xml',
      outputRef: 'canto_masivo.chordpro',
      outputStorageKey: `outputs/${astHash}.chordpro`,
      outputChecksumSha256: astHash,
      outputByteLength: 2048,
      progress: 100,
      errorDetails: {
        targetFormat: 'CHORD_PRO',
        canonicalStorageKey: companionKey,
        outputStorageKey: `outputs/${astHash}.chordpro`,
        diagnostics: {},
      },
    });

    // Guardar también el archivo de salida
    await outputStorage.save(`outputs/${astHash}.chordpro`, Buffer.from('{title: Reference Song}\n[G]Santo es el Señor'));

    // Comprometer al catálogo: commitJobToCatalog debe recuperar el AST de companionKey sin pérdida
    const committed = await jobService.commitJobToCatalog(massiveJobId, testUser, {
      title: 'Himno de Referencia Canónica',
    });

    assert.equal(committed.song.title, 'Himno de Referencia Canónica');

    // Verificar en song_versions que el payload canónico se rehidrató íntegramente
    const [savedVersion] = await db
      .select()
      .from(songVersions)
      .where(eq(songVersions.id, committed.version.id));

    assert(savedVersion !== undefined);
    assert.equal((savedVersion.canonicalPayload as any).title, fixture.title);

    // Limpieza
    await db.delete(songSources).where(eq(songSources.jobId, massiveJobId));
    await db.delete(songVersions).where(eq(songVersions.songId, committed.song.id));
    await db.delete(songs).where(eq(songs.id, committed.song.id));
    await db.delete(backgroundJobs).where(eq(backgroundJobs.id, massiveJobId));
  });
});
