/**
 * @file audit-sanitizer.test.ts
 * @description Pruebas del sanitizador mandatorio de auditoría (Fase 2B).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeAuditMetadata } from '../domain/audit/audit-sanitizer.ts';

describe('Phase 2B — Audit Metadata Sanitizer', () => {
  it('1. should redact passwords, secrets and tokens from flat metadata', () => {
    const raw = {
      action: 'LOGIN_ATTEMPT',
      email: 'test@bethesda.org',
      password: 'MyPlainTextPassword!',
      refreshToken: '7f8b9c0d1e2f3a4b5c6d',
      accessToken: 'eyJhbGciOiJIUzI1Ni...',
      resetToken: 'opaque-reset-token-123',
      invitationToken: 'invite-token-456',
      cookieSecret: 'ultra-secret-cookie-key',
      jwtSecret: 'super-jwt-key',
      safeDetail: 'Firefox 120 on Windows',
    };

    const clean = sanitizeAuditMetadata(raw);

    assert.equal(clean.action, 'LOGIN_ATTEMPT');
    assert.equal(clean.email, 'test@bethesda.org');
    assert.equal(clean.safeDetail, 'Firefox 120 on Windows');

    assert.equal(clean.password, '[REDACTED]');
    assert.equal(clean.refreshToken, '[REDACTED]');
    assert.equal(clean.accessToken, '[REDACTED]');
    assert.equal(clean.resetToken, '[REDACTED]');
    assert.equal(clean.invitationToken, '[REDACTED]');
    assert.equal(clean.cookieSecret, '[REDACTED]');
    assert.equal(clean.jwtSecret, '[REDACTED]');
  });

  it('2. should recursively redact sensitive fields in nested objects and arrays', () => {
    const raw = {
      user: {
        id: '123',
        credentials: {
          passwordHash: '$argon2id$...',
          rawToken: 'secret-token-xyz',
        },
      },
      headers: [
        { authorization: 'Bearer eyJhbGciOi...' },
        { userAgent: 'Mozilla/5.0' },
      ],
    };

    const clean = sanitizeAuditMetadata(raw) as any;

    assert.equal(clean.user.id, '123');
    assert.equal(clean.user.credentials.passwordHash, '[REDACTED]');
    assert.equal(clean.user.credentials.rawToken, '[REDACTED]');
    assert.equal(clean.headers[0].authorization, '[REDACTED]');
    assert.equal(clean.headers[1].userAgent, 'Mozilla/5.0');
  });

  it('3. should return empty object for null, undefined or non-object input', () => {
    assert.deepEqual(sanitizeAuditMetadata(null), {});
    assert.deepEqual(sanitizeAuditMetadata(undefined), {});
    assert.deepEqual(sanitizeAuditMetadata('not-an-object' as any), {});
  });
});
