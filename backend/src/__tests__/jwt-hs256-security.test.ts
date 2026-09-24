/**
 * @file jwt-hs256-security.test.ts
 * @description Pruebas de seguridad para la emisión y validación de tokens JWT estrictamente con HS256 (Fase 2B).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { JwtTokenService } from '../application/token-service.ts';
import { TokenExpiredError, TokenInvalidError } from '../domain/errors.ts';

describe('Phase 2B — JWT Security & HS256 Algorithm Enforcement', () => {
  const secret = 'super_secret_test_key_minimum_32_characters_long_entropy_2026';
  const tokenService = new JwtTokenService({ secret, expirationSeconds: 900 });

  it('1. should sign an access token with valid HS256 header and required claims', () => {
    const user = { id: 'usr-123', email: 'director@bethesda.org', role: 'WORSHIP_LEADER' as const };
    const { token, jti, expiresIn } = tokenService.signAccessToken(user);

    assert.ok(token, 'El token no debe ser nulo');
    assert.equal(expiresIn, 900, 'Debe expirar en 900 segundos (15 min)');
    assert.ok(jti, 'Debe incluir un jti único');

    const [headerB64, payloadB64] = token.split('.');
    const header = JSON.parse(Buffer.from(headerB64, 'base64url').toString('utf8'));
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));

    assert.equal(header.alg, 'HS256', 'El algoritmo debe ser estrictamente HS256');
    assert.equal(payload.sub, 'usr-123');
    assert.equal(payload.email, 'director@bethesda.org');
    assert.equal(payload.role, 'WORSHIP_LEADER');
    assert.equal(payload.jti, jti);
    assert.ok(typeof payload.iat === 'number');
    assert.ok(typeof payload.exp === 'number');
  });

  it('2. should verify a valid access token successfully', () => {
    const user = { id: 'usr-456', email: 'musico@bethesda.org', role: 'MUSICIAN' as const };
    const { token } = tokenService.signAccessToken(user);

    const verified = tokenService.verifyAccessToken(token);
    assert.equal(verified.sub, 'usr-456');
    assert.equal(verified.email, 'musico@bethesda.org');
    assert.equal(verified.role, 'MUSICIAN');
  });

  it('3. should reject token if signature is tampered with', () => {
    const user = { id: 'usr-789', email: 'viewer@bethesda.org', role: 'VIEWER' as const };
    const { token } = tokenService.signAccessToken(user);

    const parts = token.split('.');
    // Modificar la firma
    const tamperedToken = `${parts[0]}.${parts[1]}.bad_signature_here`;

    assert.throws(
      () => tokenService.verifyAccessToken(tamperedToken),
      (err: any) => err instanceof TokenInvalidError && err.message.includes('Firma de token inválida')
    );
  });

  it('4. should reject token if payload has been tampered with', () => {
    const user = { id: 'usr-789', email: 'viewer@bethesda.org', role: 'VIEWER' as const };
    const { token } = tokenService.signAccessToken(user);

    const parts = token.split('.');
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    payload.role = 'SUPER_ADMIN'; // Intento de escalamiento de privilegios
    const forgedPayloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const forgedToken = `${parts[0]}.${forgedPayloadB64}.${parts[2]}`;

    assert.throws(
      () => tokenService.verifyAccessToken(forgedToken),
      (err: any) => err instanceof TokenInvalidError
    );
  });

  it('5. should CATEGORICALLY REJECT alg=none tokens', () => {
    const header = { alg: 'none', typ: 'JWT' };
    const payload = {
      sub: 'usr-999',
      email: 'attacker@evil.com',
      role: 'SUPER_ADMIN',
      jti: 'fake-jti',
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 900,
    };

    const hB64 = Buffer.from(JSON.stringify(header)).toString('base64url');
    const pB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const noneToken = `${hB64}.${pB64}.`;

    assert.throws(
      () => tokenService.verifyAccessToken(noneToken),
      (err: any) => err instanceof TokenInvalidError && err.message.includes("Algoritmo 'none' no permitido")
    );
  });

  it('6. should reject unexpected algorithms such as RS256 or HS512', () => {
    const header = { alg: 'RS256', typ: 'JWT' };
    const payload = {
      sub: 'usr-999',
      email: 'attacker@evil.com',
      role: 'SUPER_ADMIN',
      jti: 'fake-jti',
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 900,
    };

    const hB64 = Buffer.from(JSON.stringify(header)).toString('base64url');
    const pB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const rsToken = `${hB64}.${pB64}.fakesig`;

    assert.throws(
      () => tokenService.verifyAccessToken(rsToken),
      (err: any) => err instanceof TokenInvalidError && err.message.includes("Algoritmo 'RS256' no permitido")
    );
  });

  it('7. should reject expired access tokens with TokenExpiredError', () => {
    // Servicio con expiración de -1 segundo
    const expiredService = new JwtTokenService({ secret, expirationSeconds: -1 });
    const user = { id: 'usr-exp', email: 'exp@bethesda.org', role: 'MUSICIAN' as const };
    const { token } = expiredService.signAccessToken(user);

    assert.throws(
      () => tokenService.verifyAccessToken(token),
      (err: any) => err instanceof TokenExpiredError
    );
  });
});
