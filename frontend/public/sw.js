/**
 * @file sw.js
 * @description Service Worker de Bethesda Worship Studio (Fase 2B — WP-04 / Fase 2D — WS-2D-01 Hardening v2).
 *
 * RESPONSABILIDADES:
 * 1. Almacenar en caché los recursos estáticos esenciales del App Shell (HTML, CSS, JS, íconos, fuentes musicales Bravura).
 * 2. Permitir que la aplicación cargue en frío (Cold Boot) cuando el músico no tiene conexión a internet.
 * 3. Protocolo determinista PRECACHE_ASSETS para precalentar bundles compilados, hojas de estilo y fuentes de notación.
 * 4. Ciclo de vida controlado con handshake SKIP_WAITING que respeta el estado de ejecución en vivo (Atril / Setlist ACTIVO).
 * 5. NUNCA almacenar en la Cache API respuestas autenticadas de `/api/v1/*` ni tokens de acceso (Regla de Seguridad 4.6).
 * 6. Los datos musicales privados (canciones, setlists, audios) son gestionados exclusivamente en IndexedDB por BethesdaOfflineManager con validación SHA-256 y aislamiento de usuario.
 * 7. Filtrar estrictamente esquemas no soportados (`chrome-extension:`, `file:`, `data:`, `blob:`, `about:`) antes de invocar `cache.put()`.
 */

const CACHE_NAME = 'bethesda-worship-studio-shell-v2';

const STATIC_SHELL_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/worship_studio_saxophone_emblem.png',
  '/fonts/Bravura.woff2',
];

const ALLOWED_EXTERNAL_FONT_ORIGINS = [
  'https://fonts.googleapis.com',
  'https://fonts.gstatic.com',
];

const MAX_PRECACHE_URLS = 64;

/**
 * Valida de forma determinista si un par Request/Response es elegible para ser almacenado
 * en la Cache API del navegador sin producir TypeError ni vulnerar el aislamiento de sesión.
 *
 * Condiciones obligatorias:
 * 1. Protocolo estrictamente `http:` o `https:` (excluye `chrome-extension:`, `chrome:`, `moz-extension:`, `file:`, `data:`, `blob:`, `about:`).
 * 2. Método HTTP estrictamente `GET`.
 * 3. Código de estado HTTP exactamente `200`.
 * 4. Tipo de respuesta `basic` (mismo origen) o `cors` válido (ej. Google Fonts).
 * 5. Nunca almacenar rutas de API (`/api/`).
 *
 * @param {Request} request
 * @param {Response} response
 * @param {URL} url
 * @returns {boolean}
 */
function isCacheEligible(request, response, url) {
  if (!request || !response || !url) return false;
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
  if (request.method !== 'GET') return false;
  if (response.status !== 200) return false;
  if (response.type !== 'basic' && response.type !== 'cors') return false;
  if (url.pathname.startsWith('/api/')) return false;
  return true;
}

/**
 * Valida preventivamente si una URL candidata enviada mediante PRECACHE_ASSETS
 * puede ser solicitada y almacenada de forma segura en el caché del App Shell.
 *
 * @param {string} rawUrl
 * @param {string} baseOrigin
 * @returns {URL | null}
 */
function resolveEligiblePrecacheUrl(rawUrl, baseOrigin) {
  if (typeof rawUrl !== 'string' || rawUrl.trim().length === 0) return null;
  const trimmed = rawUrl.trim();

  // Rechazar esquemas explícitamente no HTTP(S) antes de resolver
  if (
    trimmed.includes('://') &&
    !trimmed.startsWith('http://') &&
    !trimmed.startsWith('https://')
  ) {
    return null;
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(trimmed, baseOrigin);
  } catch {
    return null;
  }

  if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
    return null;
  }

  // Prohibir categóricamente rutas de API o endpoints autenticados
  if (parsedUrl.pathname.startsWith('/api/')) {
    return null;
  }

  // Prohibir parámetros de consulta sensibles (tokens, credenciales, códigos)
  const lowerSearch = parsedUrl.search.toLowerCase();
  if (
    lowerSearch.includes('token=') ||
    lowerSearch.includes('password=') ||
    lowerSearch.includes('secret=') ||
    lowerSearch.includes('authorization=') ||
    lowerSearch.includes('credential=')
  ) {
    return null;
  }

  // Permitir únicamente recursos del mismo origen o fuentes tipográficas autorizadas
  const isSameOrigin = parsedUrl.origin === baseOrigin;
  const isAllowedFontOrigin = ALLOWED_EXTERNAL_FONT_ORIGINS.includes(parsedUrl.origin);
  if (!isSameOrigin && !isAllowedFontOrigin) {
    return null;
  }

  return parsedUrl;
}

/**
 * Envuelve `cache.put()` de forma resiliente para evitar que errores de cuota,
 * extensiones de navegador o fallos de almacenamiento interrumpan la respuesta de red.
 * Sanitiza la URL antes de registrar diagnósticos para no exponer tokens ni credenciales.
 *
 * @param {string} cacheName
 * @param {Request} request
 * @param {Response} response
 * @returns {Promise<boolean>}
 */
async function safelyPutInCache(cacheName, request, response) {
  try {
    const cache = await caches.open(cacheName);
    await cache.put(request, response);
    return true;
  } catch (cacheError) {
    const sanitizedUrl = typeof request.url === 'string' ? request.url.split('?')[0] : 'unknown';
    console.warn('[ServiceWorker] No se pudo escribir en Cache API:', sanitizedUrl);
    return false;
  }
}

/**
 * Ejecuta el protocolo determinista PRECACHE_ASSETS validando cada URL a través de isCacheEligible.
 *
 * @param {unknown[]} rawUrls
 * @returns {Promise<{ cached: string[]; rejected: string[] }>}
 */
async function handlePrecacheAssets(rawUrls) {
  const cached = [];
  const rejected = [];

  if (!Array.isArray(rawUrls)) {
    return { cached, rejected };
  }

  const baseOrigin = self.location ? self.location.origin : 'http://localhost';
  const uniqueUrls = Array.from(new Set(rawUrls)).slice(0, MAX_PRECACHE_URLS);

  for (const candidate of uniqueUrls) {
    const resolvedUrl = resolveEligiblePrecacheUrl(candidate, baseOrigin);
    if (!resolvedUrl) {
      const sanitizedRejected =
        typeof candidate === 'string' ? candidate.split('?')[0] : 'invalid_url';
      rejected.push(sanitizedRejected);
      continue;
    }

    try {
      const request = new Request(resolvedUrl.href, {
        method: 'GET',
        credentials: resolvedUrl.origin === baseOrigin ? 'same-origin' : 'omit',
      });

      if (!request.url.startsWith('http://') && !request.url.startsWith('https://')) {
        rejected.push(resolvedUrl.pathname);
        continue;
      }

      const response = await fetch(request);
      if (isCacheEligible(request, response, resolvedUrl)) {
        const stored = await safelyPutInCache(CACHE_NAME, request, response.clone());
        if (stored) {
          cached.push(resolvedUrl.href);
        } else {
          rejected.push(resolvedUrl.href.split('?')[0]);
        }
      } else {
        rejected.push(resolvedUrl.href.split('?')[0]);
      }
    } catch {
      rejected.push(resolvedUrl.href.split('?')[0]);
    }
  }

  return { cached, rejected };
}

// 1. Instalación: Pre-cachear el App Shell estático con tolerancia a fallos individuales
self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      try {
        const cache = await caches.open(CACHE_NAME);
        for (const assetPath of STATIC_SHELL_ASSETS) {
          try {
            const resolvedUrl = new URL(assetPath, self.location.origin);
            const request = new Request(resolvedUrl.href, { method: 'GET' });
            const response = await fetch(request);
            if (isCacheEligible(request, response, resolvedUrl)) {
              await cache.put(request, response.clone());
            }
          } catch {
            // Tolerancia individual para no abortar la instalación completa si un asset opcional falla
          }
        }
      } catch (err) {
        console.warn('[ServiceWorker] Precarga inicial parcial:', err);
      }

      // Ciclo de vida controlado (WS-2D-01 Sección 3.2):
      // Solo activar inmediatamente en la primera instalación (cuando no hay un SW activo controlando clientes).
      // Si ya existe un SW activo, permanecer en estado "waiting" hasta recibir el mensaje controlado SKIP_WAITING.
      if (!self.registration || !self.registration.active) {
        await self.skipWaiting();
      }
    })()
  );
});

// 2. Activación: Limpiar cachés antiguos (incluyendo v1) y reclamar clientes
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((cacheNames) => {
        return Promise.all(
          cacheNames.map((key) => {
            if (key !== CACHE_NAME) {
              return caches.delete(key);
            }
            return Promise.resolve();
          })
        );
      })
      .then(() => self.clients.claim())
  );
});

// 3. Mensajería controlada: Protocolos SKIP_WAITING y PRECACHE_ASSETS (WS-2D-01)
self.addEventListener('message', (event) => {
  const data = event && event.data;
  if (!data || typeof data !== 'object') return;

  if (data.type === 'SKIP_WAITING') {
    event.waitUntil(
      Promise.resolve(self.skipWaiting()).then(() => {
        if (event.ports && event.ports[0]) {
          event.ports[0].postMessage({ type: 'SKIP_WAITING_ACK', cacheName: CACHE_NAME });
        }
      })
    );
    return;
  }

  if (data.type === 'PRECACHE_ASSETS') {
    event.waitUntil(
      handlePrecacheAssets(data.urls).then((result) => {
        if (event.ports && event.ports[0]) {
          event.ports[0].postMessage({
            type: 'PRECACHE_ASSETS_RESULT',
            cacheName: CACHE_NAME,
            cached: result.cached,
            rejected: result.rejected,
          });
        }
      })
    );
  }
});

// 4. Estrategia de Intercepción (Fetch)
self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Ignorar inmediatamente esquemas no HTTP/HTTPS (ej. chrome-extension://, file://, data:, blob:)
  if (!request.url.startsWith('http://') && !request.url.startsWith('https://')) {
    return;
  }

  let url;
  try {
    url = new URL(request.url);
  } catch {
    return;
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return;
  }

  // REGLA DE SEGURIDAD CRÍTICA: Jamás cachear peticiones a la API REST (/api/v1/*).
  // Dejar que el cliente HTTP / BethesdaOfflineManager las maneje directamente con respuesta 503 controlada si no hay red.
  if (url.pathname.startsWith('/api/v1/')) {
    event.respondWith(
      fetch(request).catch(() => {
        return new Response(
          JSON.stringify({
            error: 'OFFLINE_MODE',
            message: 'Sin conexión con el servidor Bethesda. Operando en modo local de solo lectura.',
          }),
          {
            status: 503,
            headers: { 'Content-Type': 'application/json' },
          }
        );
      })
    );
    return;
  }

  if (url.pathname.startsWith('/api/') || request.method !== 'GET') {
    return;
  }

  // Para navegación SPA (documentos HTML): Estrategia Network-First con Fallback a /index.html en caché
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then(async (networkResponse) => {
          if (isCacheEligible(request, networkResponse, url)) {
            await safelyPutInCache(CACHE_NAME, request, networkResponse.clone());
          }
          return networkResponse;
        })
        .catch(() => {
          return caches.match('/index.html').then((cachedHtml) => {
            return (
              cachedHtml ||
              new Response(
                '<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><title>Bethesda Worship Studio — Sin Conexión</title></head><body style="background:#0f172a;color:#f8fafc;font-family:sans-serif;padding:2rem;text-align:center;"><h1>Bethesda Worship Studio</h1><p>Modo sin conexión activo. Recargue una vez que el App Shell haya sido inicializado.</p></body></html>',
                { headers: { 'Content-Type': 'text/html; charset=utf-8' } }
              )
            );
          });
        })
    );
    return;
  }

  // Para assets estáticos (JS, CSS, Fuentes, Imágenes): Estrategia Stale-While-Revalidate
  event.respondWith(
    caches.match(request).then((cachedResponse) => {
      const fetchPromise = fetch(request)
        .then(async (networkResponse) => {
          if (isCacheEligible(request, networkResponse, url)) {
            await safelyPutInCache(CACHE_NAME, request, networkResponse.clone());
          }
          return networkResponse;
        })
        .catch(() => {
          // Si falla la red y teníamos respuesta en caché, se usa la caché silenciosamente
          return cachedResponse;
        });

      return cachedResponse || fetchPromise;
    })
  );
});
