/**
 * @file disposable-test-guard.test.ts
 * @description Pruebas unitarias negativas y verificación en vivo de aislamiento para REM-02.
 */

import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { env } from '../config/env.ts';
import { pool } from '../db/index.ts';
import {
  assertDisposableCertDatabaseUrl,
  DISPOSABLE_CERT_DB_NAME,
  verifyLiveDisposableDatabaseIdentity,
} from '../db/disposable-test-guard.ts';

describe('GATE 2 REM-02 — Disposable PostgreSQL Identity Guard', () => {
  after(async () => {
    await pool.end();
  });

  it('1. rejects bethesda_worship_dev, bethesda_worship_test, postgres, and any prod database name', () => {
    const devUrl = 'postgresql://postgres:x@127.0.0.1:5432/bethesda_worship_dev';

    assert.throws(
      () => assertDisposableCertDatabaseUrl('postgresql://postgres:x@127.0.0.1:5432/bethesda_worship_dev', devUrl),
      /protegida rechazada/
    );
    assert.throws(
      () => assertDisposableCertDatabaseUrl('postgresql://postgres:x@127.0.0.1:5432/bethesda_worship_test', devUrl),
      /protegida rechazada/
    );
    assert.throws(
      () => assertDisposableCertDatabaseUrl('postgresql://postgres:x@127.0.0.1:5432/bethesda_worship_prod', devUrl),
      /protegida rechazada/
    );
    assert.throws(
      () => assertDisposableCertDatabaseUrl('postgresql://postgres:x@127.0.0.1:5432/postgres', devUrl),
      /protegida rechazada/
    );
    assert.throws(
      () => assertDisposableCertDatabaseUrl('postgresql://postgres:x@127.0.0.1:5432/other_random_db', devUrl),
      /inesperada/
    );
  });

  it('2. accepts strictly bethesda_worship_r2_cert_tmp and verifies live PostgreSQL metadata identity', async () => {
    const parsed = assertDisposableCertDatabaseUrl(env.TEST_DATABASE_URL, env.DATABASE_URL);
    assert.strictEqual(parsed.dbName, DISPOSABLE_CERT_DB_NAME);

    const live = await verifyLiveDisposableDatabaseIdentity(pool, env.TEST_DATABASE_URL!, env.DATABASE_URL);
    assert.strictEqual(live.currentDatabase, DISPOSABLE_CERT_DB_NAME);
    assert.ok(live.currentUser.length > 0);
  });
});
