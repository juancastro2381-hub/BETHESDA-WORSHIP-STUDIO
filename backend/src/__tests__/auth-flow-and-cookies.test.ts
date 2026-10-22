/**
 * @file auth-flow-and-cookies.test.ts
 * @description Suite de pruebas de integración para el flujo HTTP completo de autenticación, cookies HttpOnly y rotación (Fase 2B).
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../app.ts';
import { runMigrations } from '../db/migrate.ts';
import { pool } from '../db/index.ts';
import { DrizzleUserRepository } from '../repositories/user-repository.ts';
import { Argon2PasswordHasher } from '../domain/crypto/password-hasher.ts';
import { env } from '../config/env.ts';

describe('Phase 2B — Complete HTTP Auth Flow, HttpOnly Cookies & Session Rotation', () => {
  let app: FastifyInstance;
  const userRepo = new DrizzleUserRepository();
  const hasher = new Argon2PasswordHasher({
    memoryCost: env.ARGON2_MEMORY_COST,
    timeCost: env.ARGON2_TIME_COST,
    parallelism: env.ARGON2_PARALLELISM,
  });

  const testEmail = `authflow-${Date.now()}@bethesda.co`;
  const testPassword = 'SecurePassword123!';
  let userId: string;

  before(async () => {
    await runMigrations();
    app = await buildApp();
    await app.ready();

    // Crear usuario activo para pruebas
    const hash = await hasher.hash(testPassword);
    const created = await userRepo.create({
      email: testEmail,
      passwordHash: hash,
      firstName: 'Flujo',
      lastName: 'Prueba',
      role: 'ADMIN',
      accountStatus: 'ACTIVE',
    });
    userId = created.id;
  });

  after(async () => {
    await app.close();
    await pool.end();
  });

  let refreshCookieValue = '';
  let accessToken = '';

  it('1. POST /api/v1/auth/login should return accessToken in JSON and refreshToken in HttpOnly cookie', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: {
        email: testEmail,
        password: testPassword,
      },
    });

    assert.strictEqual(res.statusCode, 200);
    const body = JSON.parse(res.payload);
    assert.strictEqual(body.success, true);
    assert.ok(body.data.accessToken);
    assert.strictEqual(body.data.expiresIn, 900);
    assert.strictEqual(body.data.user.email, testEmail);

    // El refresh token JAMÁS debe viajar en el cuerpo JSON
    assert.strictEqual((body.data as any).refreshToken, undefined);

    // Verificar encabezado Set-Cookie
    const setCookieHeader = res.headers['set-cookie'];
    assert.ok(setCookieHeader, 'Debe incluir Set-Cookie');

    const cookiesList = Array.isArray(setCookieHeader) ? setCookieHeader : [setCookieHeader as string];
    const cookieStr = cookiesList.find((c) => c.includes('bethesda_refresh_token=')) || '';
    assert.match(cookieStr, /bethesda_refresh_token=/);
    assert.match(cookieStr, /HttpOnly/i);
    assert.match(cookieStr, /SameSite=Strict/i);
    assert.match(cookieStr, /Path=\/api\/v1\/auth/);

    // Extraer valor de la cookie para solicitudes subsecuentes
    const match = cookieStr.match(/bethesda_refresh_token=([^;]+)/);
    assert.ok(match && match[1]);
    refreshCookieValue = match[1];
    accessToken = body.data.accessToken;
  });

  it('2. GET /api/v1/auth/me with Bearer token should return authenticated user profile', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: {
        authorization: `Bearer ${accessToken}`,
      },
    });

    assert.strictEqual(res.statusCode, 200);
    const body = JSON.parse(res.payload);
    assert.strictEqual(body.success, true);
    assert.strictEqual(body.data.id, userId);
    assert.strictEqual(body.data.email, testEmail);
    assert.strictEqual(body.data.role, 'ADMIN');
  });

  it('3. POST /api/v1/auth/refresh with HttpOnly cookie should rotate token and return new accessToken', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      cookies: {
        bethesda_refresh_token: refreshCookieValue,
      },
    });

    assert.strictEqual(res.statusCode, 200);
    const body = JSON.parse(res.payload);
    assert.strictEqual(body.success, true);
    assert.ok(body.data.accessToken);
    assert.notStrictEqual(body.data.accessToken, accessToken, 'El nuevo token debe ser diferente');

    // Debe emitir una nueva cookie rotada
    const setCookieHeader = res.headers['set-cookie'];
    const cookiesList = Array.isArray(setCookieHeader) ? setCookieHeader : [setCookieHeader as string];
    const cookieStr = cookiesList.find((c) => c.includes('bethesda_refresh_token=')) || '';
    assert.match(cookieStr, /bethesda_refresh_token=/);

    // Actualizar cookie y token para siguientes pruebas
    const match = cookieStr.match(/bethesda_refresh_token=([^;]+)/);
    assert.ok(match && match[1]);
    refreshCookieValue = match[1];
    accessToken = body.data.accessToken;
  });

  it('4. POST /api/v1/auth/logout should invalidate refresh cookie and clear it from client', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
      cookies: {
        bethesda_refresh_token: refreshCookieValue,
      },
    });

    assert.strictEqual(res.statusCode, 200);
    const body = JSON.parse(res.payload);
    assert.strictEqual(body.success, true);

    // Debe limpiar la cookie estableciendo Max-Age=0 o Expires en el pasado
    const setCookieHeader = res.headers['set-cookie'];
    const cookiesList = Array.isArray(setCookieHeader) ? setCookieHeader : [setCookieHeader as string];
    const cookieStr = cookiesList.find((c) => c.includes('bethesda_refresh_token=')) || '';
    assert.match(cookieStr, /bethesda_refresh_token=;|bethesda_refresh_token="";|Max-Age=0|Expires=/i);
  });

  it('5. POST /api/v1/auth/forgot-password should return anti-enumeration 200 message for any email', async () => {
    // Caso A: Correo existente
    const res1 = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/forgot-password',
      payload: { email: testEmail },
    });
    assert.strictEqual(res1.statusCode, 200);
    const body1 = JSON.parse(res1.payload);
    assert.strictEqual(body1.success, true);
    assert.match(body1.message, /Si la cuenta existe/);

    // Caso B: Correo inexistente (debe responder EXACTAMENTE lo mismo)
    const res2 = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/forgot-password',
      payload: { email: 'nonexistent-account-999@bethesda.co' },
    });
    assert.strictEqual(res2.statusCode, 200);
    const body2 = JSON.parse(res2.payload);
    assert.strictEqual(body2.success, true);
    assert.strictEqual(body2.message, body1.message);
  });

  it('6. GET /api/v1/users should succeed for ADMIN and reject VIEWER with 403', async () => {
    // 1. Solicitud con token de ADMIN
    const adminRes = await app.inject({
      method: 'GET',
      url: '/api/v1/users',
      headers: {
        authorization: `Bearer ${accessToken}`,
      },
    });
    assert.strictEqual(adminRes.statusCode, 200);
    const adminBody = JSON.parse(adminRes.payload);
    assert.strictEqual(adminBody.success, true);
    assert.ok(Array.isArray(adminBody.data));

    // 2. Crear token de VIEWER
    const viewerEmail = `viewer-${Date.now()}@bethesda.co`;
    const viewerUser = await userRepo.create({
      email: viewerEmail,
      passwordHash: 'dummy_hash',
      firstName: 'Lector',
      lastName: 'Comun',
      role: 'VIEWER',
      accountStatus: 'ACTIVE',
    });

    const tokenService = new (await import('../application/token-service.ts')).JwtTokenService(env.JWT_SECRET, '15m');
    const { token: viewerToken } = tokenService.signAccessToken({
      sub: viewerUser.id,
      email: viewerUser.email,
      role: 'VIEWER',
    });

    const viewerRes = await app.inject({
      method: 'GET',
      url: '/api/v1/users',
      headers: {
        authorization: `Bearer ${viewerToken}`,
      },
    });
    assert.strictEqual(viewerRes.statusCode, 403);
    const viewerBody = JSON.parse(viewerRes.payload);
    assert.strictEqual(viewerBody.error.code, 'FORBIDDEN');
  });

  it('7. POST /api/v1/auth/refresh with no JSON body does not fail because of an empty-body parsing error', async () => {
    // Iniciar sesión para obtener una cookie de refresco válida
    const loginRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: {
        email: testEmail,
        password: testPassword,
      },
    });
    assert.strictEqual(loginRes.statusCode, 200);
    const setCookie = loginRes.headers['set-cookie'];
    const cookiesList = Array.isArray(setCookie) ? setCookie : [setCookie as string];
    const cookieStr = cookiesList.find((c) => c.includes('bethesda_refresh_token=')) || '';
    const match = cookieStr.match(/bethesda_refresh_token=([^;]+)/);
    assert.ok(match && match[1]);

    // Petición POST a /refresh SIN cabecera Content-Type y SIN cuerpo (exacto como lo hace api-client.ts corregido)
    const refreshRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      cookies: {
        bethesda_refresh_token: match[1],
      },
    });

    assert.strictEqual(refreshRes.statusCode, 200, 'Refresh sin cuerpo JSON debe procesarse correctamente sin error 400/500');
    const refreshBody = JSON.parse(refreshRes.payload);
    assert.strictEqual(refreshBody.success, true);
    assert.ok(refreshBody.data.accessToken);
    assert.strictEqual(refreshBody.data.user.email, testEmail);
  });

  it('8. Fastify client parsing errors preserve their intended HTTP status code (400 Bad Request) instead of degrading to 500', async () => {
    // Si un cliente envía Content-Type: application/json pero omite el cuerpo, Fastify arroja FST_ERR_CTP_EMPTY_JSON_BODY (400)
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      headers: {
        'content-type': 'application/json',
      },
      // Sin payload / body
    });

    assert.strictEqual(res.statusCode, 400, 'El error de parser debe responder 400 Bad Request y no degradarse a 500');
    const body = JSON.parse(res.payload);
    assert.strictEqual(body.error.statusCode, 400);
    assert.strictEqual(body.error.code, 'FST_ERR_CTP_EMPTY_JSON_BODY');
    assert.match(body.error.message, /Body cannot be empty when content-type is set to 'application\/json'/);
    assert.strictEqual(body.error.details, null, 'No debe exponer trazas internas ni detalles no controlados');
  });
});
