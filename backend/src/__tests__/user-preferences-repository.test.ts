/**
 * @file user-preferences-repository.test.ts
 * @description Suite de pruebas de integración para DrizzleUserPreferencesRepository (Fase 3A — DEC-02).
 * Verifica persistencia en PostgreSQL, upsert atómico, unicidad por usuario y cascada referencial.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { db, pool } from '../db/index.ts';
import { runMigrations } from '../db/migrate.ts';
import { users } from '../db/schema.ts';
import { eq } from 'drizzle-orm';
import { DrizzleUserRepository } from '../repositories/user-repository.ts';
import { DrizzleUserPreferencesRepository } from '../repositories/user-preferences-repository.ts';
import { Argon2PasswordHasher } from '../domain/crypto/password-hasher.ts';
import { env } from '../config/env.ts';

describe('Phase 3A — WP-01: User Preferences Repository & Data Model Tests (PostgreSQL + Drizzle)', () => {
  const userRepo = new DrizzleUserRepository(db);
  const preferencesRepo = new DrizzleUserPreferencesRepository(db);
  const hasher = new Argon2PasswordHasher({
    memoryCost: env.ARGON2_MEMORY_COST,
    timeCost: env.ARGON2_TIME_COST,
    parallelism: env.ARGON2_PARALLELISM,
  });

  let testUserId: string;
  const testEmail = `pref-test-${Date.now()}@bethesda.co`;

  before(async () => {
    await runMigrations();

    const hash = await hasher.hash('PrefTestPassword123!');
    const user = await userRepo.create({
      email: testEmail,
      passwordHash: hash,
      firstName: 'Musico',
      lastName: 'Prueba',
      role: 'MUSICIAN',
      accountStatus: 'ACTIVE',
    });
    testUserId = user.id;
  });

  after(async () => {
    // Limpieza de usuario de prueba si persiste
    if (testUserId) {
      await db.delete(users).where(eq(users.id, testUserId));
    }
    await pool.end();
  });

  it('1. should return null when user has no stored preferences', async () => {
    const preferences = await preferencesRepo.findByUserId(testUserId);
    assert.strictEqual(preferences, null);
  });

  it('2. should insert initial preferences using atomic upsert', async () => {
    const created = await preferencesRepo.upsert(testUserId, {
      instrumentId: 'acoustic_guitar',
      primaryRepresentation: 'CHORDS',
      secondaryRepresentations: ['LYRICS'],
      chordNotationSystem: 'STANDARD',
      transpositionSemitones: 0,
      capoFret: 2,
      clefOverride: null,
      preferFlats: false,
    });

    assert.ok(created.id);
    assert.strictEqual(created.userId, testUserId);
    assert.strictEqual(created.instrumentId, 'acoustic_guitar');
    assert.strictEqual(created.primaryRepresentation, 'CHORDS');
    assert.deepStrictEqual(created.secondaryRepresentations, ['LYRICS']);
    assert.strictEqual(created.chordNotationSystem, 'STANDARD');
    assert.strictEqual(created.transpositionSemitones, 0);
    assert.strictEqual(created.capoFret, 2);
    assert.strictEqual(created.clefOverride, null);
    assert.strictEqual(created.preferFlats, false);
    assert.ok(created.createdAt instanceof Date);
    assert.ok(created.updatedAt instanceof Date);
  });

  it('3. should retrieve saved preferences with findByUserId', async () => {
    const found = await preferencesRepo.findByUserId(testUserId);
    assert.ok(found);
    assert.strictEqual(found.userId, testUserId);
    assert.strictEqual(found.instrumentId, 'acoustic_guitar');
    assert.strictEqual(found.primaryRepresentation, 'CHORDS');
    assert.deepStrictEqual(found.secondaryRepresentations, ['LYRICS']);
    assert.strictEqual(found.capoFret, 2);
  });

  it('4. should atomically update existing preferences on conflict without duplicating records', async () => {
    const updated = await preferencesRepo.upsert(testUserId, {
      instrumentId: 'alto_sax',
      primaryRepresentation: 'STANDARD_NOTATION',
      secondaryRepresentations: ['CHORDS'],
      chordNotationSystem: 'LATIN',
      transpositionSemitones: 2,
      capoFret: 0,
      clefOverride: 'TREBLE',
      preferFlats: true,
    });

    assert.strictEqual(updated.userId, testUserId);
    assert.strictEqual(updated.instrumentId, 'alto_sax');
    assert.strictEqual(updated.primaryRepresentation, 'STANDARD_NOTATION');
    assert.deepStrictEqual(updated.secondaryRepresentations, ['CHORDS']);
    assert.strictEqual(updated.chordNotationSystem, 'LATIN');
    assert.strictEqual(updated.transpositionSemitones, 2);
    assert.strictEqual(updated.capoFret, 0);
    assert.strictEqual(updated.clefOverride, 'TREBLE');
    assert.strictEqual(updated.preferFlats, true);

    // Verificar que solo existe exactamente un registro para este usuario
    const allRecords = await preferencesRepo.findByUserId(testUserId);
    assert.ok(allRecords);
    assert.strictEqual(allRecords.id, updated.id);
    assert.strictEqual(allRecords.instrumentId, 'alto_sax');
  });

  it('5. should allow resetting clefOverride to null', async () => {
    const reset = await preferencesRepo.upsert(testUserId, {
      instrumentId: 'alto_sax',
      primaryRepresentation: 'STANDARD_NOTATION',
      secondaryRepresentations: [],
      chordNotationSystem: 'STANDARD',
      transpositionSemitones: 0,
      capoFret: 0,
      clefOverride: null,
      preferFlats: false,
    });

    assert.strictEqual(reset.clefOverride, null);

    const verified = await preferencesRepo.findByUserId(testUserId);
    assert.ok(verified);
    assert.strictEqual(verified.clefOverride, null);
  });

  it('6. should explicitly delete preferences with deleteByUserId', async () => {
    const deleted = await preferencesRepo.deleteByUserId(testUserId);
    assert.strictEqual(deleted, true);

    const check = await preferencesRepo.findByUserId(testUserId);
    assert.strictEqual(check, null);
  });

  it('7. should cascade delete preferences when parent user is deleted', async () => {
    // Crear un segundo usuario temporal
    const tempEmail = `cascade-${Date.now()}@bethesda.co`;
    const hash = await hasher.hash('TempPassword123!');
    const tempUser = await userRepo.create({
      email: tempEmail,
      passwordHash: hash,
      firstName: 'Temp',
      lastName: 'Cascade',
      role: 'MUSICIAN',
      accountStatus: 'ACTIVE',
    });

    // Guardar preferencias para este usuario
    await preferencesRepo.upsert(tempUser.id, {
      instrumentId: 'keyboard',
      primaryRepresentation: 'GRAND_STAFF',
      secondaryRepresentations: ['CHORDS'],
    });

    // Verificar que se guardó
    const beforeDelete = await preferencesRepo.findByUserId(tempUser.id);
    assert.ok(beforeDelete);
    assert.strictEqual(beforeDelete.instrumentId, 'keyboard');

    // Eliminar el usuario en users
    await db.delete(users).where(eq(users.id, tempUser.id));

    // Verificar que la preferencia fue eliminada en cascada automáticamente por PostgreSQL
    const afterDelete = await preferencesRepo.findByUserId(tempUser.id);
    assert.strictEqual(afterDelete, null);
  });
});
