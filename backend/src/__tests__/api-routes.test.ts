/**
 * @file api-routes.test.ts
 * @description Pruebas de integración de la API HTTP con Fastify (inyección de solicitudes sin puerto).
 */

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../app.ts';
import { pool } from '../db/index.ts';
import { runMigrations } from '../db/migrate.ts';
import { createReferenceSongFixture } from '../../../frontend/src/core/canonical-model/fixtures/reference-song.ts';
import { CanonicalSerializer } from '../domain/canonical-serializer.ts';

describe('Phase 2A — Fastify HTTP API Integration Tests (/api/v1)', () => {
  let app: FastifyInstance;

  before(async () => {
    await runMigrations();
    app = await buildApp();
    await app.ready();
  });

  after(async () => {
    await app.close();
    await pool.end();
  });

  it('1. GET /api/v1/health should return ok and database connected', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/health',
    });

    assert.strictEqual(response.statusCode, 200);
    const body = JSON.parse(response.payload);
    assert.strictEqual(body.status, 'ok');
    assert.strictEqual(body.database, 'connected');
    assert.ok(body.timestamp);
  });

  it('2. POST /api/v1/songs should create a new song and return 201', async () => {
    const canonicalSong = createReferenceSongFixture();
    const canonicalJSON = CanonicalSerializer.serialize(canonicalSong);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/songs',
      payload: {
        title: 'Himno de Gloria API Test',
        artist: 'Compositor API',
        defaultKey: 'D Major',
        defaultBpm: 128,
        timeSignature: '4/4',
        status: 'DRAFT',
        sourceFormat: 'INTERNAL',
        canonicalPayload: canonicalJSON,
      },
    });

    assert.strictEqual(response.statusCode, 201);
    const body = JSON.parse(response.payload);
    assert.ok(body.data.song.id);
    assert.strictEqual(body.data.song.title, 'Himno de Gloria API Test');
    assert.strictEqual(body.data.version.versionNumber, 1);
  });

  it('3. GET /api/v1/songs should list songs with pagination', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/songs?limit=5&offset=0',
    });

    assert.strictEqual(response.statusCode, 200);
    const body = JSON.parse(response.payload);
    assert.ok(Array.isArray(body.data));
    assert.ok(body.pagination);
    assert.strictEqual(body.pagination.limit, 5);
  });

  it('4. GET /api/v1/songs/:songId should retrieve song and current version', async () => {
    // Primero crear una canción
    const canonicalSong = createReferenceSongFixture();
    const canonicalJSON = CanonicalSerializer.serialize(canonicalSong);

    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v1/songs',
      payload: {
        title: 'Canción para Consulta ID',
        defaultKey: 'A Major',
        sourceFormat: 'INTERNAL',
        canonicalPayload: canonicalJSON,
      },
    });

    const created = JSON.parse(createRes.payload).data;

    // Consultar por ID
    const getRes = await app.inject({
      method: 'GET',
      url: `/api/v1/songs/${created.song.id}`,
    });

    assert.strictEqual(getRes.statusCode, 200);
    const getBody = JSON.parse(getRes.payload);
    assert.strictEqual(getBody.data.song.id, created.song.id);
    assert.strictEqual(getBody.data.version.id, created.version.id);
  });

  it('5. POST /api/v1/songs/:songId/versions should create a new version', async () => {
    const canonicalSong = createReferenceSongFixture();
    const canonicalJSON = CanonicalSerializer.serialize(canonicalSong);

    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v1/songs',
      payload: {
        title: 'Canción Base para Versión API',
        defaultKey: 'F Major',
        sourceFormat: 'INTERNAL',
        canonicalPayload: canonicalJSON,
      },
    });

    const songId = JSON.parse(createRes.payload).data.song.id;

    // Crear versión 2
    const v2Res = await app.inject({
      method: 'POST',
      url: `/api/v1/songs/${songId}/versions`,
      payload: {
        name: 'Versión 2 de Estudio',
        description: 'Nueva versión creada desde endpoint',
        sourceFormat: 'INTERNAL',
        canonicalPayload: canonicalJSON,
        setAsCurrent: true,
      },
    });

    assert.strictEqual(v2Res.statusCode, 201);
    const v2Body = JSON.parse(v2Res.payload);
    assert.strictEqual(v2Body.data.versionNumber, 2);
    assert.strictEqual(v2Body.data.isCurrent, true);

    // Listar versiones
    const listVersionsRes = await app.inject({
      method: 'GET',
      url: `/api/v1/songs/${songId}/versions`,
    });

    assert.strictEqual(listVersionsRes.statusCode, 200);
    const versionsBody = JSON.parse(listVersionsRes.payload);
    assert.strictEqual(versionsBody.data.length, 2);
  });

  it('12 & 13. should reject invalid payloads with structured 400 VALIDATION_ERROR', async () => {
    // Caso 1: Título vacío
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/songs',
      payload: {
        title: '', // Inválido
        defaultKey: 'C',
        sourceFormat: 'INTERNAL',
        canonicalPayload: {},
      },
    });

    assert.strictEqual(response.statusCode, 400);
    const body = JSON.parse(response.payload);
    assert.strictEqual(body.error.code, 'VALIDATION_ERROR');
    assert.ok(body.error.details);
  });

  it('12 & 13. should return 404 NOT_FOUND when requesting non-existent song', async () => {
    const randomUuid = '99999999-9999-9999-9999-999999999999';
    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/songs/${randomUuid}`,
    });

    assert.strictEqual(response.statusCode, 404);
    const body = JSON.parse(response.payload);
    assert.strictEqual(body.error.code, 'NOT_FOUND');
  });

  it('12 & 13. should return 422 INVALID_MUSIC_PAYLOAD when canonical payload is malformed', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/songs',
      payload: {
        title: 'Canción con Payload Roto',
        defaultKey: 'C',
        sourceFormat: 'INTERNAL',
        canonicalPayload: {
          title: 'Payload Roto',
          // Carece de timeline y measures
        },
      },
    });

    assert.strictEqual(response.statusCode, 422);
    const body = JSON.parse(response.payload);
    assert.strictEqual(body.error.code, 'INVALID_MUSIC_PAYLOAD');
  });
});
