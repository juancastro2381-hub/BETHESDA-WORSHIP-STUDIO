/**
 * @file conversion-security.test.ts
 * @description Pruebas de seguridad, aislamiento multi-inquilino y Anti-IDOR para el Centro de Conversión (CR-08).
 *
 * Verifica:
 * - Aislamiento estricto de trabajos entre usuarios (job.userId === user.id).
 * - Protección Anti-IDOR en consulta, descarga, cancelación, reintento y persistencia al catálogo (403 Forbidden).
 * - Acceso administrativo autorizado (ADMIN puede inspeccionar cualquier trabajo).
 * - Idempotencia transaccional en persistencia al catálogo (commitJobToCatalog).
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../app.ts';
import { type FastifyInstance } from 'fastify';
import { JwtTokenService } from '../application/token-service.ts';
import { env } from '../config/env.ts';
import { db, pool } from '../db/index.ts';
import { users, backgroundJobs, songs, songVersions, songSources } from '../db/schema.ts';
import { eq } from 'drizzle-orm';
import { createReferenceSongFixture } from '../../../frontend/src/core/canonical-model/fixtures/reference-song.ts';
import { CanonicalSerializer } from '../domain/canonical-serializer.ts';
import { stopConversionQueue } from '../infrastructure/queue/conversion-queue.ts';

describe('Phase 2A-R — CR-08: Conversion Security & Anti-IDOR Suite', () => {
  let app: FastifyInstance;
  let tokenService: JwtTokenService;

  const userAId = 'a0000000-0000-0000-0000-000000000001';
  const userBId = 'b0000000-0000-0000-0000-000000000002';
  const adminId = 'c0000000-0000-0000-0000-000000000003';

  let tokenUserA: string;
  let tokenUserB: string;
  let tokenAdmin: string;

  let userAJobId: string;
  let completedJobId: string;

  const validChordProContent = `{title: Dios Incomparable}
{artist: Generación 12}
{key: E}
{tempo: 72}
{time: 4/4}
{start_of_verse: Verso 1}
[E]Dios de mi corazón
[B]En ti encontré salvación
{end_of_verse}
`;

  before(async () => {
    app = await buildApp();
    await app.ready();

    tokenService = new JwtTokenService(env.JWT_SECRET, env.JWT_ACCESS_EXPIRES_IN);

    tokenUserA = tokenService.signAccessToken({
      id: userAId,
      email: 'userA@bethesda.com',
      role: 'MUSICIAN',
    }).token;

    tokenUserB = tokenService.signAccessToken({
      id: userBId,
      email: 'userB@bethesda.com',
      role: 'MUSICIAN',
    }).token;

    tokenAdmin = tokenService.signAccessToken({
      id: adminId,
      email: 'admin@bethesda.com',
      role: 'ADMIN',
    }).token;

    // Asegurar que los usuarios existan en la base de datos de prueba
    await db.insert(users).values([
      {
        id: userAId,
        email: 'userA@bethesda.com',
        passwordHash: '$argon2id$v=19$m=65536,t=3,p=4$dummyhashuserA',
        firstName: 'Usuario',
        lastName: 'A',
        role: 'MUSICIAN',
        accountStatus: 'ACTIVE',
        emailVerified: true,
      },
      {
        id: userBId,
        email: 'userB@bethesda.com',
        passwordHash: '$argon2id$v=19$m=65536,t=3,p=4$dummyhashuserB',
        firstName: 'Usuario',
        lastName: 'B',
        role: 'MUSICIAN',
        accountStatus: 'ACTIVE',
        emailVerified: true,
      },
      {
        id: adminId,
        email: 'admin@bethesda.com',
        passwordHash: '$argon2id$v=19$m=65536,t=3,p=4$dummyhashadmin',
        firstName: 'Admin',
        lastName: 'Bethesda',
        role: 'ADMIN',
        accountStatus: 'ACTIVE',
        emailVerified: true,
      },
    ]).onConflictDoNothing();

    // Crear un trabajo real para Usuario A
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v1/conversion/jobs',
      headers: { authorization: `Bearer ${tokenUserA}` },
      payload: {
        filename: 'dios-incomparable.cho',
        targetFormat: 'LYRICS_ONLY',
        rawText: validChordProContent,
      },
    });

    assert.strictEqual(createRes.statusCode, 201);
    const body = JSON.parse(createRes.payload);
    userAJobId = body.data.id;
    assert.ok(userAJobId);

    // Crear un trabajo COMPLETADO para Usuario A con datos fidedignos y payload canónico (CR-06)
    const fixture = createReferenceSongFixture();
    const serializedCanonical = CanonicalSerializer.serialize(fixture);

    const [compJob] = await db.insert(backgroundJobs).values({
      jobType: 'CONVERSION',
      status: 'COMPLETED',
      progress: 100,
      userId: userAId,
      inputRef: 'himno_completo.cho',
      outputRef: 'himno_completo.txt',
      errorDetails: {
        targetFormat: 'LYRICS_ONLY',
        mimeType: 'text/plain',
        isBinary: false,
        data: 'Sublime gracia del Señor que a un infeliz salvó',
        diagnostics: [],
        canonicalPayload: serializedCanonical,
      },
    }).returning();

    completedJobId = compJob.id;

    await db.insert(songSources).values({
      userId: userAId,
      sourceType: 'CHORD_PRO',
      filename: 'himno_completo.cho',
      storagePath: 'storage/sources/himno_completo.cho',
      mimeType: 'text/plain',
      fileSizeBytes: 128,
      checksumSha256: 'abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
      importerName: 'ConversionJobService',
      importerVersion: '2.0.0',
      jobId: compJob.id,
    });
  });

  after(async () => {
    // Limpieza de datos de prueba
    if (completedJobId) {
      await db.delete(songSources).where(eq(songSources.jobId, completedJobId));
      await db.delete(backgroundJobs).where(eq(backgroundJobs.id, completedJobId));
    }
    if (userAJobId) {
      await db.delete(songSources).where(eq(songSources.jobId, userAJobId));
      await db.delete(backgroundJobs).where(eq(backgroundJobs.id, userAJobId));
    }
    await app.close();
    await stopConversionQueue();
    await pool.end();
  });

  it('1. GET /api/v1/conversion/jobs/:jobId — Usuario B no puede acceder al trabajo de Usuario A (403 Forbidden Anti-IDOR)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/conversion/jobs/${userAJobId}`,
      headers: { authorization: `Bearer ${tokenUserB}` },
    });

    assert.strictEqual(res.statusCode, 403);
    const body = JSON.parse(res.payload);
    assert.strictEqual(body.error.code, 'FORBIDDEN');
  });

  it('2. GET /api/v1/conversion/jobs/:jobId/download — Usuario B no puede descargar el archivo de Usuario A (403 Forbidden Anti-IDOR)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/conversion/jobs/${completedJobId}/download`,
      headers: { authorization: `Bearer ${tokenUserB}` },
    });

    assert.strictEqual(res.statusCode, 403);
    const body = JSON.parse(res.payload);
    assert.strictEqual(body.error.code, 'FORBIDDEN');
  });

  it('3. POST /api/v1/conversion/jobs/:jobId/cancel — Usuario B no puede cancelar el trabajo de Usuario A (403 Forbidden Anti-IDOR)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/conversion/jobs/${userAJobId}/cancel`,
      headers: { authorization: `Bearer ${tokenUserB}` },
    });

    assert.strictEqual(res.statusCode, 403);
    const body = JSON.parse(res.payload);
    assert.strictEqual(body.error.code, 'FORBIDDEN');
  });

  it('4. POST /api/v1/conversion/jobs/:jobId/retry — Usuario B no puede reintentar el trabajo de Usuario A (403 Forbidden Anti-IDOR)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/conversion/jobs/${userAJobId}/retry`,
      headers: { authorization: `Bearer ${tokenUserB}` },
    });

    assert.strictEqual(res.statusCode, 403);
    const body = JSON.parse(res.payload);
    assert.strictEqual(body.error.code, 'FORBIDDEN');
  });

  it('5. POST /api/v1/conversion/jobs/:jobId/commit — Usuario B no puede persistir al catálogo el trabajo de Usuario A (403 Forbidden Anti-IDOR)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/conversion/jobs/${completedJobId}/commit`,
      headers: { authorization: `Bearer ${tokenUserB}` },
      payload: { title: 'Intento Ilegítimo' },
    });

    assert.strictEqual(res.statusCode, 403);
    const body = JSON.parse(res.payload);
    assert.strictEqual(body.error.code, 'FORBIDDEN');
  });

  it('6. GET /api/v1/conversion/jobs/:jobId — Usuario A puede acceder a su propio trabajo (200 OK)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/conversion/jobs/${userAJobId}`,
      headers: { authorization: `Bearer ${tokenUserA}` },
    });

    assert.strictEqual(res.statusCode, 200);
    const body = JSON.parse(res.payload);
    assert.strictEqual(body.data.id, userAJobId);
  });

  it('7. GET /api/v1/conversion/jobs/:jobId — Administrador puede inspeccionar el trabajo de cualquier usuario (200 OK)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/conversion/jobs/${userAJobId}`,
      headers: { authorization: `Bearer ${tokenAdmin}` },
    });

    assert.strictEqual(res.statusCode, 200);
    const body = JSON.parse(res.payload);
    assert.strictEqual(body.data.id, userAJobId);
  });

  it('8. GET /api/v1/conversion/jobs — Listado aísla trabajos entre usuarios (Usuario B no ve trabajos de Usuario A)', async () => {
    const resB = await app.inject({
      method: 'GET',
      url: '/api/v1/conversion/jobs',
      headers: { authorization: `Bearer ${tokenUserB}` },
    });

    assert.strictEqual(resB.statusCode, 200);
    const bodyB = JSON.parse(resB.payload);
    const hasUserAJob = bodyB.data.some((j: any) => j.id === userAJobId || j.id === completedJobId);
    assert.strictEqual(hasUserAJob, false, 'Usuario B no debe ver trabajos pertenecientes a Usuario A');
  });

  it('9. POST /api/v1/conversion/jobs/:jobId/commit — Idempotencia: Múltiples llamados no duplican registros en catálogo', async () => {
    // Primer guardado
    const commit1 = await app.inject({
      method: 'POST',
      url: `/api/v1/conversion/jobs/${completedJobId}/commit`,
      headers: { authorization: `Bearer ${tokenUserA}` },
      payload: { title: 'Dios Incomparable', artist: 'Generación 12' },
    });

    assert.strictEqual(commit1.statusCode, 201);
    const body1 = JSON.parse(commit1.payload);
    const songId1 = body1.data.song.id;
    assert.ok(songId1);

    // Segundo guardado (idempotente)
    const commit2 = await app.inject({
      method: 'POST',
      url: `/api/v1/conversion/jobs/${completedJobId}/commit`,
      headers: { authorization: `Bearer ${tokenUserA}` },
      payload: { title: 'Dios Incomparable', artist: 'Generación 12' },
    });

    assert.strictEqual(commit2.statusCode, 201);
    const body2 = JSON.parse(commit2.payload);
    const songId2 = body2.data.song.id;

    assert.strictEqual(songId1, songId2, 'El ID de la canción debe ser exactamente el mismo en llamadas idempotentes');

    // Verificar en base de datos que solo existe 1 registro para este trabajo
    const linkedSources = await db
      .select()
      .from(songSources)
      .where(eq(songSources.jobId, completedJobId));

    assert.strictEqual(linkedSources.length, 1, 'Debe existir exactamente 1 registro en song_sources');
    assert.strictEqual(linkedSources[0].songId, songId1);

    // Limpieza de la canción creada
    await db.delete(songSources).where(eq(songSources.songId, songId1));
    await db.delete(songVersions).where(eq(songVersions.songId, songId1));
    await db.delete(songs).where(eq(songs.id, songId1));
  });
});
