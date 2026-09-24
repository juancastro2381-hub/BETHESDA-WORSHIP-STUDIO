/**
 * @file rate-limiting-dual-dimension.test.ts
 * @description Suite de pruebas de integración para el limitador de tasa bidimensional independiente (Fase 2B).
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { DualRateLimiter } from '../interfaces/http/middlewares/rate-limiter.ts';

describe('Phase 2B — Dual-Dimension Rate Limiting (IP & Account)', () => {
  let rateLimiter: DualRateLimiter;

  beforeEach(() => {
    // Configurar 5 intentos por minuto para cada dimensión
    rateLimiter = new DualRateLimiter({
      ipWindowMs: 60000,
      ipMaxAttempts: 5,
      accountWindowMs: 60000,
      accountMaxFailedAttempts: 5,
    });
  });

  it('1. should allow up to 5 attempts from the same IP and block on the 6th with retryAfter', () => {
    const testIp = '192.168.1.50';

    for (let i = 1; i <= 5; i++) {
      const check = rateLimiter.checkIp(testIp);
      assert.strictEqual(check.allowed, true, `Intento ${i} debería permitirse`);
      rateLimiter.recordIpAttempt(testIp);
    }

    // 6to intento debe ser bloqueado
    const blockedCheck = rateLimiter.checkIp(testIp);
    assert.strictEqual(blockedCheck.allowed, false);
    assert.ok(blockedCheck.retryAfter > 0);
    assert.ok(blockedCheck.retryAfter <= 60);
  });

  it('2. should track accounts independently: 5 failed attempts on an account should block it regardless of IP', () => {
    const targetEmail = 'pastor@bethesda.co';

    for (let i = 1; i <= 5; i++) {
      const check = rateLimiter.checkAccount(targetEmail);
      assert.strictEqual(check.allowed, true, `Intento fallido ${i} debería ser aceptado para evaluación`);
      rateLimiter.recordAccountFailedAttempt(targetEmail);
    }

    // 6to intento fallido para esta cuenta debe ser rechazado
    const blockedAccountCheck = rateLimiter.checkAccount(targetEmail);
    assert.strictEqual(blockedAccountCheck.allowed, false);
    assert.ok(blockedAccountCheck.retryAfter > 0);

    // Otra cuenta no debe estar afectada
    const otherAccountCheck = rateLimiter.checkAccount('musico@bethesda.co');
    assert.strictEqual(otherAccountCheck.allowed, true);
  });

  it('3. should verify independent dimensions: rotating IPs cannot bypass account limit (distributed brute-force protection)', () => {
    const victimAccount = 'tesorero@bethesda.co';

    // 5 intentos fallidos desde 5 IPs distintas (ataque distribuido)
    for (let i = 1; i <= 5; i++) {
      const rotatingIp = `10.0.0.${i}`;
      // La IP nueva tiene cupo
      assert.strictEqual(rateLimiter.checkIp(rotatingIp).allowed, true);
      // Pero el atacante falla en la cuenta
      rateLimiter.recordAccountFailedAttempt(victimAccount);
    }

    // Un 6to intento desde una 6ta IP distinta aún debe ser bloqueado por la dimensión de cuenta
    const sixthIp = '10.0.0.6';
    assert.strictEqual(rateLimiter.checkIp(sixthIp).allowed, true);
    assert.strictEqual(rateLimiter.checkAccount(victimAccount).allowed, false);
  });

  it('4. should reset account failures upon successful login', () => {
    const account = 'lider@bethesda.co';

    // 4 intentos fallidos
    for (let i = 0; i < 4; i++) {
      rateLimiter.recordAccountFailedAttempt(account);
    }

    // Login exitoso
    rateLimiter.resetAccountFailures(account);

    // El contador debe estar en cero (permitir 5 más)
    for (let i = 0; i < 5; i++) {
      assert.strictEqual(rateLimiter.checkAccount(account).allowed, true);
      rateLimiter.recordAccountFailedAttempt(account);
    }

    // Ahora sí se bloquea
    assert.strictEqual(rateLimiter.checkAccount(account).allowed, false);
  });
});
