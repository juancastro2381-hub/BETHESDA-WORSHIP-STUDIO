/**
 * @file database-isolation.test.ts
 * @description Pruebas de verificación de aislamiento de base de datos de prueba y equivalencia semántica de URLs.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { areDatabaseTargetsEquivalent } from '../db/index.ts';

describe('Production Gates — Test Database Semantic Isolation', () => {
  it('1. should identify identical URLs as equivalent', () => {
    const url1 = 'postgresql://postgres:secret@localhost:5432/bethesda_worship_dev';
    const url2 = 'postgresql://postgres:secret@localhost:5432/bethesda_worship_dev';
    assert.equal(areDatabaseTargetsEquivalent(url1, url2), true);
  });

  it('2. should identify localhost and 127.0.0.1 targeting the same database as equivalent', () => {
    const devUrl = 'postgresql://postgres:secret@localhost:5432/bethesda_worship_dev';
    const testUrl = 'postgresql://postgres:other@127.0.0.1:5432/bethesda_worship_dev';
    assert.equal(areDatabaseTargetsEquivalent(devUrl, testUrl), true);
  });

  it('3. should identify default port 5432 omission as equivalent to explicit port 5432', () => {
    const devUrl = 'postgresql://postgres:secret@localhost/bethesda_worship_dev';
    const testUrl = 'postgresql://postgres:secret@localhost:5432/bethesda_worship_dev';
    assert.equal(areDatabaseTargetsEquivalent(devUrl, testUrl), true);
  });

  it('4. should normalize trailing slashes and case sensitivity', () => {
    const devUrl = 'postgresql://postgres:secret@LocalHost:5432/bethesda_worship_dev/';
    const testUrl = 'postgresql://postgres:secret@localhost:5432/BETHESDA_WORSHIP_DEV';
    assert.equal(areDatabaseTargetsEquivalent(devUrl, testUrl), true);
  });

  it('5. should NOT consider different database names as equivalent (isolated targets)', () => {
    const devUrl = 'postgresql://postgres:secret@localhost:5432/bethesda_worship_dev';
    const testUrl = 'postgresql://postgres:secret@localhost:5432/bethesda_worship_test';
    assert.equal(areDatabaseTargetsEquivalent(devUrl, testUrl), false);
  });

  it('6. should NOT consider different ports on distinct hosts as equivalent', () => {
    const devUrl = 'postgresql://postgres:secret@db.prod.internal:5432/bethesda_worship';
    const testUrl = 'postgresql://postgres:secret@db.test.internal:5433/bethesda_worship';
    assert.equal(areDatabaseTargetsEquivalent(devUrl, testUrl), false);
  });
});
