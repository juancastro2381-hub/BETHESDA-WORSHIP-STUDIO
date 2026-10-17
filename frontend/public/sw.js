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

// 3. Estrategia de Enrutamiento y Fetch
self.addEventListener('fetch', (event) => {
  const request = event.request;
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
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const responseToCache = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(request, responseToCache);
            });
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
        .then((networkResponse) => {
          if (
            networkResponse &&
            networkResponse.status === 200 &&
            request.method === 'GET' &&
            !url.pathname.startsWith('/api/')
          ) {
            const responseToCache = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(request, responseToCache);
            });
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
