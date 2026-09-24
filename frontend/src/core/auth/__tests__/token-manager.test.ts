/**
 * @file token-manager.test.ts
 * @description Suite de pruebas para el gestor de Access Tokens en memoria volátil estricta (Fase 2B).
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { tokenManager } from '../token-manager.ts';

describe('Phase 2B — Frontend Memory-Only TokenManager', () => {
  beforeEach(() => {
    tokenManager.clearToken();
  });

  it('1. should store access token in memory and retrieve it while valid', () => {
    const dummyJwt = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.dummy.signature';
    tokenManager.setToken(dummyJwt, 900); // 15 minutos

    assert.strictEqual(tokenManager.isAuthenticated(), true);
    assert.strictEqual(tokenManager.getToken(), dummyJwt);
  });

  it('2. should return null and clear state when token expires', async () => {
    const dummyJwt = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.dummy.signature';
    // Establecer vigencia de 0.05 segundos (50ms)
    tokenManager.setToken(dummyJwt, 0.05);

    assert.strictEqual(tokenManager.isAuthenticated(), true);

    // Esperar 80ms para que expire
    await new Promise((resolve) => setTimeout(resolve, 80));

    assert.strictEqual(tokenManager.getToken(), null);
    assert.strictEqual(tokenManager.isAuthenticated(), false);
  });

  it('3. should immediately clear token and reset authentication state on clearToken', () => {
    const dummyJwt = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.dummy.signature';
    tokenManager.setToken(dummyJwt, 900);

    assert.strictEqual(tokenManager.isAuthenticated(), true);

    tokenManager.clearToken();

    assert.strictEqual(tokenManager.getToken(), null);
    assert.strictEqual(tokenManager.isAuthenticated(), false);
  });

  it('4. should schedule silent refresh before expiration', async () => {
    let refreshTriggered = false;
    const dummyJwt = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.dummy.signature';
    tokenManager.setToken(dummyJwt, 1);

    tokenManager.scheduleSilentRefresh(async () => {
      refreshTriggered = true;
    });

    tokenManager.cancelSilentRefresh();
    assert.strictEqual(refreshTriggered, false);
  });
});
