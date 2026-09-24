/**
 * @file argon2-hasher.test.ts
 * @description Pruebas automatizadas de la implementación mandatoria de Argon2id (Fase 2B).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Argon2PasswordHasher } from '../domain/crypto/password-hasher.ts';
import { generateSecureToken, hashToken, timingSafeEqual } from '../domain/crypto/token-utils.ts';

describe('Phase 2B — Cryptography & Argon2id Password Hashing', () => {
  const hasher = new Argon2PasswordHasher();

  it('1. should hash passwords using Argon2id with unique salts', async () => {
    const password = 'BethesdaSecurePass2026!';
    const hash1 = await hasher.hash(password);
    const hash2 = await hasher.hash(password);

    assert.ok(hash1.startsWith('$argon2id$'), 'El hash debe ser del algoritmo Argon2id');
    assert.ok(hash2.startsWith('$argon2id$'), 'El hash debe ser del algoritmo Argon2id');
    assert.notEqual(hash1, hash2, 'Dos hashes de la misma contraseña deben tener sales distintas');
  });

  it('2. should verify correct password successfully', async () => {
    const password = 'SuperSecretLeaderPassword#123';
    const hash = await hasher.hash(password);

    const isValid = await hasher.verify(password, hash);
    assert.equal(isValid, true, 'La verificación de contraseña correcta debe retornar true');
  });

  it('3. should reject incorrect password cleanly', async () => {
    const password = 'CorrectPassword123';
    const wrongPassword = 'WrongPassword456';
    const hash = await hasher.hash(password);

    const isValid = await hasher.verify(wrongPassword, hash);
    assert.equal(isValid, false, 'La verificación con contraseña incorrecta debe retornar false');
  });

  it('4. should reject empty password or empty hash without throwing unhandled exceptions', async () => {
    await assert.rejects(
      async () => await hasher.hash(''),
      /La contraseña no puede estar vacía/,
      'Debe rechazar cadenas vacías al hashear'
    );

    const isMatch = await hasher.verify('', '$argon2id$somehash');
    assert.equal(isMatch, false, 'Contraseña vacía debe retornar false');

    const isMatch2 = await hasher.verify('SomePassword', '');
    assert.equal(isMatch2, false, 'Hash vacío debe retornar false');
  });

  it('5. should generate cryptographically secure 256-bit random tokens', () => {
    const token1 = generateSecureToken(32);
    const token2 = generateSecureToken(32);

    assert.equal(token1.length, 64, '32 bytes deben producir 64 caracteres hex');
    assert.equal(token2.length, 64, '32 bytes deben producir 64 caracteres hex');
    assert.notEqual(token1, token2, 'Los tokens criptográficos deben ser únicos');
  });

  it('6. should deterministically hash tokens with SHA-256 for secure DB persistence', () => {
    const token = '7f8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b';
    const hashA = hashToken(token);
    const hashB = hashToken(token);

    assert.equal(hashA.length, 64, 'El hash SHA-256 debe tener longitud de 64 caracteres hex');
    assert.equal(hashA, hashB, 'El hasheo de tokens debe ser determinístico');
  });

  it('7. should execute constant-time comparison safely with timingSafeEqual', () => {
    const hashA = hashToken('secretA');
    const hashB = hashToken('secretB');

    assert.equal(timingSafeEqual(hashA, hashA), true, 'Hashes idénticos deben retornar true');
    assert.equal(timingSafeEqual(hashA, hashB), false, 'Hashes diferentes deben retornar false');
    assert.equal(timingSafeEqual('', hashA), false, 'Hash vacío debe retornar false');
  });
});
