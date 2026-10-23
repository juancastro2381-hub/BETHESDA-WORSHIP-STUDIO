/**
 * @file sw.js
 * @description Service Worker para Bethesda Worship Studio (WP-04 — PWA Offline).
 * 
 * POLÍTICA DE SEGURIDAD ESTRICTA:
 * - NUNCA almacenar en Cache API las respuestas autenticadas de /api/v1/*.
 * - Las rutas de API siempre van directamente a la red. Si la red falla,
 *   devuelve una respuesta 503 controlada para que el cliente maneje el modo offline.
 * - Cache API se reserva exclusivamente para los recursos estáticos del Application Shell
 *   (HTML, CSS, JS bundles compilados, íconos y tipografías).
 */

const CACHE_NAME = 'bethesda-worship-studio-shell-v1';

const STATIC_SHELL_ASSETS = [
  '/',
  '/index.html',
  '/worship_studio_saxophone_emblem.png',
  '/manifest.webmanifest',
];

// 1. Instalación: Precargar el App Shell mínimo
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_SHELL_ASSETS);
    }).then(() => {
      return self.skipWaiting();
    })
  );
});

// 2. Activación: Limpieza de versiones obsoletas y toma de control inmediato
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      );
    }).then(() => {
      return self.clients.claim();
    })
  );
});

// Helpers de validación de elegibilidad para Cache API y almacenamiento seguro
/**
 * Valida si una solicitud y su respuesta son estrictamente elegibles para almacenarse en la Cache API.
 * 
 * Reglas de elegibilidad:
 * 1. El esquema de la URL debe ser estrictamente 'http:' o 'https:'.
 * 2. El método HTTP debe ser 'GET' (Cache API specification RFC 7231 / W3C).
 * 3. La respuesta debe existir y tener código HTTP 200 (OK).
 * 4. La respuesta debe ser de tipo 'basic' o 'cors' (no opaque ni error).
 * 5. La ruta no debe pertenecer a endpoints protegidos de la API REST (/api/).
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
 * Ejecuta una escritura segura en la Cache API, capturando fallos de almacenamiento
 * (p. ej. cuota excedida, aborto de conexión o restricciones del navegador)
 * sin interrumpir el flujo de red hacia el cliente ni generar excepciones no controladas.
 */
async function safelyPutInCache(cacheName, request, response) {
  try {
    const cache = await caches.open(cacheName);
    await cache.put(request, response);
  } catch (cacheError) {
    // Si falla el almacenamiento en caché (p. ej. QuotaExceededError),
    // se registra de forma limpia sin exponer parámetros sensibles de la URL.
    const sanitizedUrl = typeof request.url === 'string' ? request.url.split('?')[0] : 'unknown';
    console.warn('[ServiceWorker] No se pudo escribir en Cache API:', {
      url: sanitizedUrl,
      error: cacheError instanceof Error ? cacheError.message : String(cacheError),
    });
  }
}

// 3. Estrategia de Enrutamiento y Fetch
self.addEventListener('fetch', (event) => {
  const request = event.request;

  // REGLA CRÍTICA DE ESQUEMA:
  // Ignorar inmediatamente esquemas no HTTP(S) como chrome-extension:, chrome:, file:, blob:, data:.
  // El navegador manejará estas peticiones de forma nativa sin pasar por la Cache API.
  if (!request.url.startsWith('http://') && !request.url.startsWith('https://')) {
    return;
  }

  const url = new URL(request.url);

  // INVARIANTE DE SEGURIDAD Y AISLAMIENTO:
  // NUNCA cachear peticiones autenticadas o endpoints de la API REST /api/v1/
  if (url.pathname.startsWith('/api/v1/')) {
    event.respondWith(
      fetch(request).catch(() => {
        return new Response(
          JSON.stringify({
            success: false,
            error: {
              code: 'NETWORK_OFFLINE',
              message: 'Sin conexión con el servidor. Modo solo lectura activado.',
            },
          }),
          {
            status: 503,
            statusText: 'Service Unavailable (Offline)',
            headers: { 'Content-Type': 'application/json' },
          }
        );
      })
    );
    return;
  }

  // Solicitudes de Navegación (HTML de la aplicación SPA): Network-First con fallback a cache
  if (request.mode === 'navigate' && request.method === 'GET') {
    event.respondWith(
      fetch(request)
        .then(async (networkResponse) => {
          if (isCacheEligible(request, networkResponse, url)) {
            await safelyPutInCache(CACHE_NAME, request, networkResponse.clone());
          }
          return networkResponse;
        })
        .catch(async () => {
          const cachedResponse = await caches.match('/index.html');
          if (cachedResponse) {
            return cachedResponse;
          }
          return caches.match('/');
        })
    );
    return;
  }

  // Recursos estáticos (JS, CSS, Imágenes, Fuentes): Stale-While-Revalidate
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
          // Si falla la red y no hay caché, retornar error silencioso
          return cachedResponse;
        });

      return cachedResponse || fetchPromise;
    })
  );
});

