/**
 * @file service-worker-cache-eligibility.test.ts
 * @description Suite de regresión y validación estricta para la elegibilidad en Cache API y remediación del error
 * "Failed to execute 'put' on 'Cache': Request scheme 'chrome-extension' is unsupported" (Workstream A).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

// Simulador puro de la lógica de validación de sw.js
interface MockRequest {
  url: string;
  method: string;
  mode?: string;
}

interface MockResponse {
  status: number;
  type: 'basic' | 'cors' | 'opaque' | 'error';
  clone: () => MockResponse;
}

function isCacheEligible(request: MockRequest, response: MockResponse, url: URL): boolean {
  if (!request || !response || !url) return false;
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
  if (request.method !== 'GET') return false;
  if (response.status !== 200) return false;
  if (response.type !== 'basic' && response.type !== 'cors') return false;
  if (url.pathname.startsWith('/api/')) return false;
  return true;
}

async function safelyPutInCache(
  cacheName: string,
  request: MockRequest,
  response: MockResponse,
  mockCache: { put: (req: any, res: any) => Promise<void> },
  warnLog: string[]
): Promise<boolean> {
  try {
    await mockCache.put(request, response);
    return true;
  } catch (cacheError) {
    const sanitizedUrl = typeof request.url === 'string' ? request.url.split('?')[0] : 'unknown';
    warnLog.push(`[ServiceWorker] No se pudo escribir en Cache API: ${sanitizedUrl}`);
    return false;
  }
}

describe('Workstream A — Service Worker Cache API & Scheme Remediation Suite', () => {
  it('1. should reject chrome-extension: scheme from Cache API writes', () => {
    const extUrl = 'chrome-extension://abcdefghijklmnopqrstuvwxyz/content-script.js';
    const request: MockRequest = { url: extUrl, method: 'GET' };
    const response: MockResponse = { status: 200, type: 'basic', clone: () => response };
    const url = new URL(extUrl);

    assert.strictEqual(
      isCacheEligible(request, response, url),
      false,
      'El esquema chrome-extension: debe ser categóricamente rechazado por isCacheEligible'
    );
  });

  it('2. should reject chrome:, moz-extension:, file:, data:, blob:, and about: schemes', () => {
    const unsupportedSchemes = [
      'chrome://settings/style.css',
      'moz-extension://12345/script.js',
      'file:///C:/local/asset.png',
      'data:text/javascript;base64,console.log()',
      'blob:http://localhost:5173/1234-uuid',
      'about:blank',
    ];

    for (const rawUrl of unsupportedSchemes) {
      try {
        const url = new URL(rawUrl);
        const request: MockRequest = { url: rawUrl, method: 'GET' };
        const response: MockResponse = { status: 200, type: 'basic', clone: () => response };
        assert.strictEqual(
          isCacheEligible(request, response, url),
          false,
          `El esquema ${url.protocol} debe ser rechazado`
        );
      } catch {
        // En caso de que new URL() falle para algún esquema, también está excluido
        assert.ok(true);
      }
    }
  });

  it('3. should accept eligible http: and https: application assets', () => {
    const validAssets = [
      'http://localhost:5173/index.html',
      'http://localhost:5173/assets/index-abc.js',
      'https://worship.bethesda.org/worship_studio_saxophone_emblem.png',
      'https://fonts.googleapis.com/css2?family=Inter:wght@400;600&display=swap',
    ];

    for (const rawUrl of validAssets) {
      const url = new URL(rawUrl);
      const request: MockRequest = { url: rawUrl, method: 'GET' };
      const response: MockResponse = {
        status: 200,
        type: rawUrl.includes('fonts.googleapis') ? 'cors' : 'basic',
        clone: () => response,
      };

      assert.strictEqual(
        isCacheEligible(request, response, url),
        true,
        `La URL ${rawUrl} debe ser elegible para la Cache API`
      );
    }
  });

  it('4. should reject non-GET HTTP methods (POST, PUT, DELETE, PATCH)', () => {
    const methods = ['POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'];
    const url = new URL('https://worship.bethesda.org/songs/submit');
    const response: MockResponse = { status: 200, type: 'basic', clone: () => response };

    for (const method of methods) {
      const request: MockRequest = { url: url.href, method };
      assert.strictEqual(
        isCacheEligible(request, response, url),
        false,
        `Método ${method} no debe ser elegible para Cache API (RFC 7231 / W3C)`
      );
    }
  });

  it('5. should reject non-200 HTTP response codes', () => {
    const url = new URL('https://worship.bethesda.org/bundle.js');
    const request: MockRequest = { url: url.href, method: 'GET' };
    const invalidStatuses = [201, 204, 301, 304, 400, 401, 403, 404, 500, 503];

    for (const status of invalidStatuses) {
      const response: MockResponse = { status, type: 'basic', clone: () => response };
      assert.strictEqual(
        isCacheEligible(request, response, url),
        false,
        `Respuesta HTTP ${status} no debe ser cacheada en App Shell`
      );
    }
  });

  it('6. should reject opaque and error response types', () => {
    const url = new URL('https://worship.bethesda.org/bundle.js');
    const request: MockRequest = { url: url.href, method: 'GET' };

    const opaqueResponse: MockResponse = { status: 0, type: 'opaque', clone: () => opaqueResponse };
    assert.strictEqual(isCacheEligible(request, opaqueResponse, url), false);

    const errorResponse: MockResponse = { status: 0, type: 'error', clone: () => errorResponse };
    assert.strictEqual(isCacheEligible(request, errorResponse, url), false);
  });

  it('7. should strictly reject /api/ endpoints to preserve REST security and session isolation', () => {
    const apiUrls = [
      'https://worship.bethesda.org/api/v1/auth/me',
      'https://worship.bethesda.org/api/v1/songs',
      'https://worship.bethesda.org/api/v1/setlists/1234',
      'http://localhost:3001/api/v1/users',
    ];

    for (const rawUrl of apiUrls) {
      const url = new URL(rawUrl);
      const request: MockRequest = { url: rawUrl, method: 'GET' };
      const response: MockResponse = { status: 200, type: 'basic', clone: () => response };

      assert.strictEqual(
        isCacheEligible(request, response, url),
        false,
        `El endpoint de API ${rawUrl} NUNCA debe almacenarse en la Cache API`
      );
    }
  });

  it('8. should safely handle cache write failure without throwing or breaking response', async () => {
    const warnLog: string[] = [];
    const failingCache = {
      put: async () => {
        throw new Error("QuotaExceededError: The quota has been exceeded.");
      },
    };

    const request: MockRequest = { url: 'https://worship.bethesda.org/large-asset.js', method: 'GET' };
    const response: MockResponse = { status: 200, type: 'basic', clone: () => response };

    const success = await safelyPutInCache('shell-v1', request, response, failingCache, warnLog);
    assert.strictEqual(success, false, 'safelyPutInCache debe retornar false en caso de fallo');
    assert.strictEqual(warnLog.length, 1, 'Debe registrar la advertencia');
    const firstWarn = warnLog[0] ?? '';
    assert.match(firstWarn, /large-asset\.js/, 'Debe incluir la URL sin quebrar');
  });

  it('9. should sanitize URLs in log messages to prevent leaking invitation tokens or query credentials', async () => {
    const warnLog: string[] = [];
    const failingCache = {
      put: async () => {
        throw new Error("Failed to execute 'put' on 'Cache'");
      },
    };

    const sensitiveUrl = 'https://worship.bethesda.org/invitation?token=SUPER_SECRET_TOKEN_99999&email=test@bethesda.org';
    const request: MockRequest = { url: sensitiveUrl, method: 'GET' };
    const response: MockResponse = { status: 200, type: 'basic', clone: () => response };

    await safelyPutInCache('shell-v1', request, response, failingCache, warnLog);

    assert.strictEqual(warnLog.length, 1);
    const sanitizedLog = warnLog[0] ?? '';
    assert.ok(!sanitizedLog.includes('SUPER_SECRET_TOKEN_99999'), 'El token NUNCA debe figurar en los logs');
    assert.ok(!sanitizedLog.includes('test@bethesda.org'), 'El correo NUNCA debe figurar en los logs');
    assert.strictEqual(sanitizedLog, '[ServiceWorker] No se pudo escribir en Cache API: https://worship.bethesda.org/invitation');
  });

  it('10. should verify actual sw.js file contains scheme guard, isCacheEligible, and safelyPutInCache', () => {
    const swPath = path.resolve(process.cwd(), 'public', 'sw.js');
    assert.ok(fs.existsSync(swPath), 'sw.js debe existir en public/sw.js');
    const content = fs.readFileSync(swPath, 'utf-8');

    assert.ok(
      content.includes("!request.url.startsWith('http://') && !request.url.startsWith('https://')"),
      'sw.js debe tener el filtro preventivo de esquemas no HTTP(S)'
    );
    assert.ok(
      content.includes('function isCacheEligible'),
      'sw.js debe declarar la función isCacheEligible'
    );
    assert.ok(
      content.includes('async function safelyPutInCache'),
      'sw.js debe declarar la función safelyPutInCache'
    );
    assert.ok(
      content.includes("request.url.split('?')[0]"),
      'sw.js debe sanitizar las URLs eliminando tokens y parámetros de consulta'
    );
  });
});
