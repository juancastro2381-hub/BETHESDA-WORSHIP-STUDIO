/**
 * @file song-repository.test.ts
 * @description Pruebas de integración de persistencia con PostgreSQL y Drizzle ORM.
 */

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert';
import { sql } from 'drizzle-orm';
import { db, pool } from '../db/index.ts';
import { runMigrations } from '../db/migrate.ts';
import { DrizzleSongRepository } from '../repositories/song-repository.ts';
import { DrizzleSongVersionRepository } from '../repositories/version-repository.ts';
import { CanonicalSerializer } from '../domain/canonical-serializer.ts';
import { createReferenceSongFixture } from '../../../frontend/src/core/canonical-model/fixtures/reference-song.ts';

describe('Phase 2A — Persistence Repository Tests (PostgreSQL + Drizzle)', () => {
  const songRepo = new DrizzleSongRepository(db);
  const versionRepo = new DrizzleSongVersionRepository(db);

  before(async () => {
    // 1 & 2. Verificar conexión y migraciones
    await runMigrations();
  });

  after(async () => {
    // Cierre limpio del pool al finalizar la suite
    await pool.end();
  });

  it('1. should verify active connection to PostgreSQL', async () => {
    const result = await db.execute(sql`SELECT 1 as connected`);
    assert.strictEqual((result.rows[0] as any).connected, 1);
  });

  it('3 & 4. should create a new song with initial canonical version and retrieve it', async () => {
    const canonicalSong = createReferenceSongFixture();
    const canonicalJSON = CanonicalSerializer.serialize(canonicalSong);

    const created = await songRepo.create({
      title: 'Canción Test Persistencia',
      artist: 'Artista Test',
      ccliNumber: '123456',
      defaultKey: 'G Major',
      defaultBpm: 120,
      timeSignature: '4/4',
      status: 'APPROVED',
      versionName: 'Versión Original',
      versionDescription: 'Primera versión de prueba',
      sourceFormat: 'INTERNAL',
      canonicalPayload: canonicalJSON,
      metadata: {
        tags: ['alabanza', 'himno'],
        themes: ['gracia', 'salvacion'],
      },
    });

    assert.ok(created.song.id);
    assert.strictEqual(created.song.title, 'Canción Test Persistencia');
    assert.strictEqual(created.song.defaultKey, 'G Major');
    assert.strictEqual(created.song.status, 'APPROVED');

    assert.ok(created.version.id);
    assert.strictEqual(created.version.versionNumber, 1);
    assert.strictEqual(created.version.isCurrent, true);
    assert.strictEqual(created.song.currentVersionId, created.version.id);

    // Recuperar por id con versión actual
    const retrieved = await songRepo.findWithCurrentVersion(created.song.id);
    assert.ok(retrieved);
    assert.strictEqual(retrieved.song.id, created.song.id);
    assert.strictEqual(retrieved.version.id, created.version.id);
    assert.strictEqual(retrieved.version.canonicalPayload.title, canonicalSong.title);
    assert.ok(retrieved.metadata);
    assert.deepStrictEqual(retrieved.metadata.tags, ['alabanza', 'himno']);
  });

  it('5 & 6. should create subsequent versions for a song and retrieve version list', async () => {
    const canonicalSong = createReferenceSongFixture();
    const canonicalJSON = CanonicalSerializer.serialize(canonicalSong);

    // Crear canción
    const created = await songRepo.create({
      title: 'Canción Multi-Versión',
      defaultKey: 'C Major',
      sourceFormat: 'CHORD_PRO',
      canonicalPayload: canonicalJSON,
    });

    // Crear versión 2
    const v2 = await versionRepo.createVersion({
      songId: created.song.id,
      name: 'Arreglo Acústico v2',
      description: 'Adaptación acústica para guitarra',
      sourceFormat: 'CHORD_PRO',
      canonicalPayload: canonicalJSON,
      setAsCurrent: true,
    });

    assert.strictEqual(v2.versionNumber, 2);
    assert.strictEqual(v2.isCurrent, true);

    // Listar versiones de la canción
    const versions = await versionRepo.findBySongId(created.song.id);
    assert.strictEqual(versions.length, 2);
    assert.strictEqual(versions[0]!.versionNumber, 2); // Orden descendente
    assert.strictEqual(versions[1]!.versionNumber, 1);

    // Verificar que la canción apunta a la v2 como versión actual
    const songRefreshed = await songRepo.findWithCurrentVersion(created.song.id);
    assert.strictEqual(songRefreshed?.song.currentVersionId, v2.id);
    assert.strictEqual(songRefreshed?.version.versionNumber, 2);

    // Cambiar versión actual de vuelta a v1
    await versionRepo.setCurrentVersion(created.song.id, created.version.id);
    const songAfterRollback = await songRepo.findWithCurrentVersion(created.song.id);
    assert.strictEqual(songAfterRollback?.song.currentVersionId, created.version.id);
    assert.strictEqual(songAfterRollback?.version.versionNumber, 1);
  });

  it('10 & 11. should handle non-existent songs and versions gracefully', async () => {
    const randomUuid = '00000000-0000-0000-0000-000000000000';
    const song = await songRepo.findById(randomUuid);
    assert.strictEqual(song, null);

    const version = await versionRepo.findById(randomUuid);
    assert.strictEqual(version, null);
  });

  it('14. should list songs with search and pagination filters', async () => {
    const listResult = await songRepo.list({
      search: 'Persistencia',
      limit: 10,
    });

    assert.ok(listResult.items.length >= 1);
    assert.ok(listResult.total >= 1);
    assert.ok(listResult.items.some((s) => s.title.includes('Persistencia')));
  });
});
