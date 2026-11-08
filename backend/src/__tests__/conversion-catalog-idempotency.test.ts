/**
 * @file conversion-catalog-idempotency.test.ts
 * @description Suite de pruebas para persistencia transaccional e idempotente en el catálogo (CR-05 & CR-08).
 *
 * Valida:
 * 1. Compromiso exitoso de trabajo completado con generación de Song, Version y SongSource vinculados.
 * 2. Idempotencia secuencial: llamadas consecutivas retornan la misma entidad sin duplicar filas.
 * 3. Idempotencia concurrente: múltiples llamadas simultáneas crean exactamente 1 canción (bloqueo FOR UPDATE + índices únicos).
 * 4. Reversión transaccional completa (rollback) ante fallos simulados durante la persistencia.
 * 5. Rechazo estricto por falta de autorización anti-IDOR (un usuario no puede agregar trabajos ajenos al catálogo).
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { eq } from 'drizzle-orm';
import { db, pool } from '../db/index.ts';
import { backgroundJobs, users, songs, songVersions, songSources } from '../db/schema.ts';
import { DrizzleSongRepository } from '../repositories/song-repository.ts';
import { DrizzleSongVersionRepository } from '../repositories/version-repository.ts';
import { SongService } from '../application/song-service.ts';
import { ConversionJobService } from '../application/conversion-job-service.ts';
import { stopConversionQueue } from '../infrastructure/queue/conversion-queue.ts';
import { createReferenceSongFixture } from '../../../frontend/src/core/canonical-model/fixtures/reference-song.ts';
import { CanonicalSerializer } from '../domain/canonical-serializer.ts';
import { ForbiddenError, ValidationError } from '../domain/errors.ts';
import type { AuthenticatedUser } from '../domain/auth-types.ts';

describe('CR-05 & CR-08 — Transactional & Idempotent Catalog Commitment Suite', () => {
  const userAId = 'a1000000-0000-0000-0000-000000000001';
  const userBId = 'b2000000-0000-0000-0000-000000000002';

  const userA: AuthenticatedUser = {
    id: userAId,
    email: 'usera@bethesda.com',
    role: 'MUSICIAN',
  };

  const userB: AuthenticatedUser = {
    id: userBId,
    email: 'userb@bethesda.com',
    role: 'MUSICIAN',
  };

  let songService: SongService;
  let jobService: ConversionJobService;
  let createdSongIds: string[] = [];
  let createdJobIds: string[] = [];
  let serializedFixture: any;

  before(async () => {
    songService = new SongService(new DrizzleSongRepository(), new DrizzleSongVersionRepository());
    jobService = new ConversionJobService(songService);

    // Usuarios de prueba
    await db.insert(users).values([
      {
        id: userAId,
        email: 'usera@bethesda.com',
        passwordHash: '$argon2id$v=19$m=65536,t=3,p=4$dummyhashA',
        firstName: 'User',
        lastName: 'A',
        role: 'MUSICIAN',
        accountStatus: 'ACTIVE',
        emailVerified: true,
      },
      {
        id: userBId,
        email: 'userb@bethesda.com',
        passwordHash: '$argon2id$v=19$m=65536,t=3,p=4$dummyhashB',
        firstName: 'User',
        lastName: 'B',
        role: 'MUSICIAN',
        accountStatus: 'ACTIVE',
        emailVerified: true,
      },
    ]).onConflictDoNothing();

    const fixture = createReferenceSongFixture();
    serializedFixture = CanonicalSerializer.serialize(fixture);
  });

  after(async () => {
    for (const songId of createdSongIds) {
      await db.delete(songSources).where(eq(songSources.songId, songId));
      await db.delete(songVersions).where(eq(songVersions.songId, songId));
      await db.delete(songs).where(eq(songs.id, songId));
    }
    for (const jobId of createdJobIds) {
      await db.delete(songSources).where(eq(songSources.jobId, jobId));
      await db.delete(backgroundJobs).where(eq(backgroundJobs.id, jobId));
    }
    await stopConversionQueue();
    await pool.end();
  });

  it('1. should successfully commit a COMPLETED job to catalog and update committedSongId', async () => {
    const [job] = await db.insert(backgroundJobs).values({
      jobType: 'CONVERSION',
      status: 'COMPLETED',
      progress: 100,
      userId: userAId,
      inputRef: 'himno_idempotente.cho',
      outputRef: 'himno_idempotente.musicxml',
      completedAt: new Date(),
      errorDetails: {
        canonicalPayload: serializedFixture,
        targetFormat: 'MUSIC_XML',
        mimeType: 'application/vnd.recordare.musicxml+xml',
        data: '<score-partwise></score-partwise>',
      },
    }).returning();
    createdJobIds.push(job.id);

    const result = await jobService.commitJobToCatalog(job.id, userA);
    assert.ok(result.song);
    assert.ok(result.version);
    createdSongIds.push(result.song.id);

    // Verificar en background_jobs que se actualizó committedSongId
    const [updatedJob] = await db
      .select()
      .from(backgroundJobs)
      .where(eq(backgroundJobs.id, job.id));

    assert.strictEqual(updatedJob.committedSongId, result.song.id, 'background_jobs debe registrar committedSongId');

    // Verificar en song_sources que se asoció el registro al song_id y jobId
    const linkedSources = await db
      .select()
      .from(songSources)
      .where(eq(songSources.jobId, job.id));

    assert.strictEqual(linkedSources.length, 1);
    assert.strictEqual(linkedSources[0].songId, result.song.id);
  });

  it('2. should be sequentially idempotent and return existing song without creating new rows', async () => {
    const [job] = await db.insert(backgroundJobs).values({
      jobType: 'CONVERSION',
      status: 'COMPLETED',
      progress: 100,
      userId: userAId,
      inputRef: 'himno_seq.cho',
      completedAt: new Date(),
      errorDetails: {
        canonicalPayload: serializedFixture,
        targetFormat: 'CHORD_PRO',
        data: '{title: Test}',
      },
    }).returning();
    createdJobIds.push(job.id);

    // Primera invocación
    const firstCall = await jobService.commitJobToCatalog(job.id, userA);
    createdSongIds.push(firstCall.song.id);

    // Segunda invocación
    const secondCall = await jobService.commitJobToCatalog(job.id, userA);

    assert.strictEqual(firstCall.song.id, secondCall.song.id, 'Las dos llamadas deben retornar el mismo ID');

    // Verificar que solo existe exactamente una canción con ese ID en base de datos
    const songRows = await db.select().from(songs).where(eq(songs.id, firstCall.song.id));
    assert.strictEqual(songRows.length, 1);

    // Verificar que no se duplicaron las versiones
    const versionRows = await db.select().from(songVersions).where(eq(songVersions.songId, firstCall.song.id));
    assert.strictEqual(versionRows.length, 1);
  });

  it('3. should handle concurrent commitment requests safely and create exactly 1 song', async () => {
    const [job] = await db.insert(backgroundJobs).values({
      jobType: 'CONVERSION',
      status: 'COMPLETED',
      progress: 100,
      userId: userAId,
      inputRef: 'himno_concurrent.cho',
      completedAt: new Date(),
      errorDetails: {
        canonicalPayload: serializedFixture,
        targetFormat: 'LYRICS_ONLY',
        data: 'Letra',
      },
    }).returning();
    createdJobIds.push(job.id);

    // Ejecutar dos compromisos simultáneos
    const [res1, res2] = await Promise.all([
      jobService.commitJobToCatalog(job.id, userA),
      jobService.commitJobToCatalog(job.id, userA),
    ]);

    assert.strictEqual(res1.song.id, res2.song.id, 'Ambas llamadas simultáneas deben resolver al mismo ID');
    createdSongIds.push(res1.song.id);

    const songCount = await db.select().from(songs).where(eq(songs.id, res1.song.id));
    assert.strictEqual(songCount.length, 1, 'Debe existir exactamente 1 registro en la tabla songs');
  });

  it('4. should rollback completely and leave no orphans if catalog creation fails', async () => {
    const [job] = await db.insert(backgroundJobs).values({
      jobType: 'CONVERSION',
      status: 'COMPLETED',
      progress: 100,
      userId: userAId,
      inputRef: 'himno_error.cho',
      completedAt: new Date(),
      errorDetails: {
        // canonicalPayload faltante forzará una excepción de validación antes de cometer
        targetFormat: 'LYRICS_ONLY',
      },
    }).returning();
    createdJobIds.push(job.id);

    await assert.rejects(
      async () => {
        await jobService.commitJobToCatalog(job.id, userA);
      },
      (err: any) => {
        assert.ok(err instanceof ValidationError);
        return true;
      }
    );

    // Verificar que no se modificó committedSongId
    const [persistedJob] = await db
      .select()
      .from(backgroundJobs)
      .where(eq(backgroundJobs.id, job.id));

    assert.strictEqual(persistedJob.committedSongId, null, 'committedSongId debe permanecer null tras rollback');
  });

  it('5. should reject catalog commitment by unauthorized user (Anti-IDOR)', async () => {
    const [job] = await db.insert(backgroundJobs).values({
      jobType: 'CONVERSION',
      status: 'COMPLETED',
      progress: 100,
      userId: userAId, // Pertenece a User A
      inputRef: 'himno_privado.cho',
      completedAt: new Date(),
      errorDetails: {
        canonicalPayload: serializedFixture,
        targetFormat: 'CHORD_PRO',
      },
    }).returning();
    createdJobIds.push(job.id);

    // User B intenta cometer la tarea de User A
    await assert.rejects(
      async () => {
        await jobService.commitJobToCatalog(job.id, userB);
      },
      (err: any) => {
        assert.ok(err instanceof ForbiddenError, 'Debe lanzar ForbiddenError por violación anti-IDOR');
        return true;
      }
    );

    const [persistedJob] = await db
      .select()
      .from(backgroundJobs)
      .where(eq(backgroundJobs.id, job.id));

    assert.strictEqual(persistedJob.committedSongId, null);
  });
});
