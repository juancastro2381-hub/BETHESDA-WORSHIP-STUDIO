/**
 * @file sw-lifecycle-manager.ts
 * @description Coordinador determinista del ciclo de vida del Service Worker v2,
 * protocolo de precalentamiento de recursos (PRECACHE_ASSETS) y protección de escenario
 * en vivo frente a actualizaciones disruptivas (Fase 2D — WS-2D-01).
 *
 * REGLAS DE ARQUITECTURA Y SEGURIDAD (WS-2D-01):
 * 1. Caché versionado `bethesda-worship-studio-shell-v2` con purga determinista de versiones previas (`v1`).
 * 2. Protocolo `PRECACHE_ASSETS` filtrado estrictamente mediante `isCacheEligibleRequestResponse` y `resolveEligiblePrecacheAssetUrl`.
 * 3. Jamás almacenar respuestas de `/api/` ni recursos con esquemas no HTTP(S) o tokens en parámetros.
 * 4. Handshake controlado `SKIP_WAITING`: diferir obligatoriamente cualquier activación de SW mientras
 *    `loadedSetlist?.status === 'ACTIVE'` o `isMusicStandMode === true`.
 * 5. Limpieza determinista de listeners y suscripciones para evitar fugas de memoria o prompts competitivos.
 */

export const SW_SHELL_CACHE_NAME_V1 = 'bethesda-worship-studio-shell-v1';
export const SW_SHELL_CACHE_NAME_V2 = 'bethesda-worship-studio-shell-v2';

export const DEFAULT_CRITICAL_SHELL_ASSETS: readonly string[] = [
  '/',
  '/index.html',
  '/manifest.json',
  '/worship_studio_saxophone_emblem.png',
  '/fonts/Bravura.woff2',
] as const;

export const ALLOWED_EXTERNAL_FONT_ORIGINS: readonly string[] = [
  'https://fonts.googleapis.com',
  'https://fonts.gstatic.com',
] as const;

export const MAX_PRECACHE_ASSET_URLS = 64;

export interface CacheEligibleRequestLike {
  readonly url: string;
  readonly method: string;
}

export interface CacheEligibleResponseLike {
  readonly status: number;
  readonly type: 'basic' | 'cors' | 'opaque' | 'error' | ' opaqueredirect' | string;
}

export interface PostMessageWorkerLike {
  postMessage: (message: any) => void;
  readonly state?: string | undefined;
  addEventListener?: ((type: string, listener: () => void) => void) | undefined;
  removeEventListener?: ((type: string, listener: () => void) => void) | undefined;
}

export interface ServiceWorkerRegistrationLike {
  readonly active?: PostMessageWorkerLike | null | undefined;
  readonly waiting?: PostMessageWorkerLike | null | undefined;
  readonly installing?: PostMessageWorkerLike | null | undefined;
  addEventListener?: ((type: string, listener: () => void) => void) | undefined;
  removeEventListener?: ((type: string, listener: () => void) => void) | undefined;
}

export interface StageProtectionState {
  readonly isSetlistActive: boolean;
  readonly isMusicStandMode: boolean;
}

export interface SwLifecycleSnapshot {
  readonly cacheVersion: string;
  readonly isStageProtected: boolean;
  readonly isSetlistActive: boolean;
  readonly isMusicStandMode: boolean;
  readonly hasWaitingWorker: boolean;
  readonly isUpdateDeferred: boolean;
  readonly isUpdateReadyToApply: boolean;
  readonly isApplyingUpdate: boolean;
  readonly lastWarmupUrls: readonly string[];
}

export interface PrecacheProtocolExecutionResult {
  readonly cacheName: string;
  readonly cached: string[];
  readonly rejected: string[];
}

/**
 * Valida si un par Request/Response cumple las reglas de seguridad de `isCacheEligible`
 * para el caché del App Shell (`bethesda-worship-studio-shell-v2`).
 */
export function isCacheEligibleRequestResponse(
  request: CacheEligibleRequestLike | null | undefined,
  response: CacheEligibleResponseLike | null | undefined,
  url: URL | null | undefined
): boolean {
  if (!request || !response || !url) return false;
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
  if (request.method !== 'GET') return false;
  if (response.status !== 200) return false;
  if (response.type !== 'basic' && response.type !== 'cors') return false;
  if (url.pathname.startsWith('/api/')) return false;
  return true;
}

/**
 * Resuelve y filtra preventivamente una URL candidata para `PRECACHE_ASSETS`.
 * Rechaza esquemas no soportados (`chrome-extension:`, `blob:`, `data:`, `file:`, `about:`),
 * endpoints `/api/`, orígenes externos no autorizados y parámetros con credenciales/tokens.
 */
export function resolveEligiblePrecacheAssetUrl(
  rawUrl: unknown,
  baseOrigin: string = 'http://localhost'
): URL | null {
  if (typeof rawUrl !== 'string' || rawUrl.trim().length === 0) {
    return null;
  }

  const trimmed = rawUrl.trim();

  // Rechazar esquemas explícitamente no HTTP(S)
  if (
    trimmed.includes('://') &&
    !trimmed.startsWith('http://') &&
    !trimmed.startsWith('https://')
  ) {
    return null;
  }

  if (
    trimmed.startsWith('chrome-extension:') ||
    trimmed.startsWith('moz-extension:') ||
    trimmed.startsWith('chrome:') ||
    trimmed.startsWith('file:') ||
    trimmed.startsWith('data:') ||
    trimmed.startsWith('blob:') ||
    trimmed.startsWith('about:') ||
    trimmed.startsWith('javascript:')
  ) {
    return null;
  }

  let parsedUrl: URL;
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

  // Prohibir parámetros de consulta sensibles
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

  const isSameOrigin = parsedUrl.origin === baseOrigin;
  const isAllowedFontOrigin = ALLOWED_EXTERNAL_FONT_ORIGINS.includes(parsedUrl.origin);
  if (!isSameOrigin && !isAllowedFontOrigin) {
    return null;
  }

  return parsedUrl;
}

/**
 * Ejecuta el protocolo `PRECACHE_ASSETS` sobre un conjunto de URLs candidatas utilizando
 * las funciones de fetch y almacenamiento provistas (compatible con Service Worker y pruebas Node.js).
 */
export async function executePrecacheAssetsProtocol(
  rawUrls: unknown,
  options: {
    baseOrigin: string;
    fetchFn: (url: string, method: 'GET') => Promise<{ status: number; type: string }>;
    putInCacheFn: (cacheName: string, url: string, response: { status: number; type: string }) => Promise<boolean>;
    cacheName?: string;
  }
): Promise<PrecacheProtocolExecutionResult> {
  const cacheName = options.cacheName ?? SW_SHELL_CACHE_NAME_V2;
  const cached: string[] = [];
  const rejected: string[] = [];

  if (!Array.isArray(rawUrls)) {
    return { cacheName, cached, rejected };
  }

  const uniqueCandidates = Array.from(new Set(rawUrls)).slice(0, MAX_PRECACHE_ASSET_URLS);

  for (const candidate of uniqueCandidates) {
    const resolvedUrl = resolveEligiblePrecacheAssetUrl(candidate, options.baseOrigin);
    if (!resolvedUrl) {
      const sanitized = typeof candidate === 'string' ? candidate.split('?')[0] || 'invalid_url' : 'invalid_url';
      rejected.push(sanitized);
      continue;
    }

    try {
      const req: CacheEligibleRequestLike = { url: resolvedUrl.href, method: 'GET' };
      const res = await options.fetchFn(resolvedUrl.href, 'GET');
      if (isCacheEligibleRequestResponse(req, res, resolvedUrl)) {
        const stored = await options.putInCacheFn(cacheName, resolvedUrl.href, res);
        if (stored) {
          cached.push(resolvedUrl.href);
        } else {
          rejected.push(resolvedUrl.href.split('?')[0] ?? resolvedUrl.pathname);
        }
      } else {
        rejected.push(resolvedUrl.href.split('?')[0] ?? resolvedUrl.pathname);
      }
    } catch {
      rejected.push(resolvedUrl.href.split('?')[0] ?? resolvedUrl.pathname);
    }
  }

  return { cacheName, cached, rejected };
}

/**
 * Purga cachés obsoletos (como `bethesda-worship-studio-shell-v1`) durante la activación de `v2`.
 */
export async function cleanupLegacyServiceWorkerCaches(
  cacheStorage: {
    keys: () => Promise<string[]>;
    delete: (cacheName: string) => Promise<boolean>;
  },
  activeCacheName: string = SW_SHELL_CACHE_NAME_V2
): Promise<{ deletedCaches: string[]; retainedCache: string }> {
  const allKeys = await cacheStorage.keys();
  const deletedCaches: string[] = [];

  for (const key of allKeys) {
    if (key !== activeCacheName) {
      const removed = await cacheStorage.delete(key);
      if (removed) {
        deletedCaches.push(key);
      }
    }
  }

  return {
    deletedCaches,
    retainedCache: activeCacheName,
  };
}

/**
 * Descubre los recursos estáticos compilados (bundles JS, hojas CSS, fuentes de notación Bravura e íconos)
 * presentes en el documento actual para enviarlos mediante `PRECACHE_ASSETS`.
 */
export function discoverApplicationShellAssets(
  doc?: {
    querySelectorAll?: (selector: string) => Iterable<{ getAttribute?: (attr: string) => string | null }>;
  } | null,
  baseOrigin: string = typeof window !== 'undefined' && window.location ? window.location.origin : 'http://localhost'
): string[] {
  const candidateUrls = new Set<string>(DEFAULT_CRITICAL_SHELL_ASSETS);

  if (doc && typeof doc.querySelectorAll === 'function') {
    try {
      const elements = doc.querySelectorAll('script[src], link[rel="stylesheet"][href], link[rel="preload"][href], link[rel="icon"][href]');
      for (const el of elements) {
        const src = el.getAttribute?.('src') || el.getAttribute?.('href');
        if (src) {
          candidateUrls.add(src);
        }
      }
    } catch {
      // Ignorar errores de inspección DOM en entornos sin navegador
    }
  }

  const eligibleHrefs: string[] = [];
  for (const raw of candidateUrls) {
    const resolved = resolveEligiblePrecacheAssetUrl(raw, baseOrigin);
    if (resolved) {
      eligibleHrefs.push(resolved.href);
    }
  }

  return Array.from(new Set(eligibleHrefs)).slice(0, MAX_PRECACHE_ASSET_URLS);
}

/**
 * Controlador de ciclo de vida del Service Worker con protección de escenario en vivo (WS-2D-01 Sección 3.2).
 */
export class ServiceWorkerLifecycleManager {
  private static instance: ServiceWorkerLifecycleManager | null = null;

  private isSetlistActive = false;
  private isMusicStandMode = false;
  private waitingWorker: PostMessageWorkerLike | null = null;
  private activeWorker: PostMessageWorkerLike | null = null;
  private isApplyingUpdate = false;
  private lastWarmupUrls: string[] = [];
  private listeners = new Set<(snapshot: SwLifecycleSnapshot) => void>();
  private cleanupCallbacks: Array<() => void> = [];

  public static getInstance(): ServiceWorkerLifecycleManager {
    if (!ServiceWorkerLifecycleManager.instance) {
      ServiceWorkerLifecycleManager.instance = new ServiceWorkerLifecycleManager();
    }
    return ServiceWorkerLifecycleManager.instance;
  }

  /**
   * Indica si el músico se encuentra actualmente en ejecución activa (Setlist ACTIVO o Modo Atril).
   * Mientras sea `true`, ninguna actualización del Service Worker puede activarse ni interrumpir la vista.
   */
  public isStageProtected(): boolean {
    return this.isSetlistActive || this.isMusicStandMode;
  }

  /**
   * Obtiene una instantánea inmutable del estado actual del ciclo de vida del Service Worker.
   */
  public getSnapshot(): SwLifecycleSnapshot {
    const stageProtected = this.isStageProtected();
    const hasWaiting = this.waitingWorker !== null;
    return {
      cacheVersion: SW_SHELL_CACHE_NAME_V2,
      isStageProtected: stageProtected,
      isSetlistActive: this.isSetlistActive,
      isMusicStandMode: this.isMusicStandMode,
      hasWaitingWorker: hasWaiting,
      isUpdateDeferred: hasWaiting && stageProtected,
      isUpdateReadyToApply: hasWaiting && !stageProtected && !this.isApplyingUpdate,
      isApplyingUpdate: this.isApplyingUpdate,
      lastWarmupUrls: [...this.lastWarmupUrls],
    };
  }

  /**
   * Actualiza el estado de protección de escenario desde MusicalWorkspace.
   * Si el músico sale del Modo Atril y no hay un Setlist ACTIVO, cualquier actualización
   * en espera pasa de diferida (`isUpdateDeferred: true`) a lista para aplicar (`isUpdateReadyToApply: true`).
   */
  public setStageProtectionState(state: StageProtectionState): SwLifecycleSnapshot {
    const changed =
      this.isSetlistActive !== state.isSetlistActive ||
      this.isMusicStandMode !== state.isMusicStandMode;

    this.isSetlistActive = Boolean(state.isSetlistActive);
    this.isMusicStandMode = Boolean(state.isMusicStandMode);

    if (changed) {
      this.notifyListeners();
    }

    return this.getSnapshot();
  }

  /**
   * Registra un Service Worker en estado `waiting` detectado por el navegador.
   * Nunca envía `SKIP_WAITING` automáticamente cuando el escenario está protegido.
   */
  public onWaitingWorkerDetected(worker: PostMessageWorkerLike | null): SwLifecycleSnapshot {
    if (!worker) {
      return this.getSnapshot();
    }

    // Evitar duplicar estado o reiniciar una actualización ya en curso para el mismo worker
    if (this.waitingWorker === worker) {
      return this.getSnapshot();
    }

    this.waitingWorker = worker;
    this.isApplyingUpdate = false;
    this.notifyListeners();
    return this.getSnapshot();
  }

  /**
   * Solicita explícitamente la activación segura de la actualización en espera mediante `{ type: 'SKIP_WAITING' }`.
   * Bloquea la operación si `isStageProtected()` es `true` o si no existe worker en espera.
   */
  public requestSafeUpdateActivation(): boolean {
    if (this.isStageProtected()) {
      return false;
    }

    if (!this.waitingWorker || this.isApplyingUpdate) {
      return false;
    }

    try {
      this.isApplyingUpdate = true;
      this.waitingWorker.postMessage({ type: 'SKIP_WAITING' });
      this.notifyListeners();
      return true;
    } catch {
      this.isApplyingUpdate = false;
      this.notifyListeners();
      return false;
    }
  }

  /**
   * Confirma que el nuevo Service Worker ha tomado el control y limpia el estado de espera.
   */
  public markUpdateApplied(newActiveWorker?: PostMessageWorkerLike | null): SwLifecycleSnapshot {
    if (newActiveWorker !== undefined) {
      this.activeWorker = newActiveWorker;
    }
    this.waitingWorker = null;
    this.isApplyingUpdate = false;
    this.notifyListeners();
    return this.getSnapshot();
  }

  /**
   * Envía el protocolo determinista `PRECACHE_ASSETS` al Service Worker activo para
   * precalentar los recursos compilados, fuentes musicales (Bravura) e íconos del App Shell.
   */
  public warmUpShellAssets(
    rawUrls: readonly string[],
    baseOrigin: string = typeof window !== 'undefined' && window.location ? window.location.origin : 'http://localhost',
    targetWorker?: PostMessageWorkerLike | null
  ): string[] {
    const worker = targetWorker ?? this.activeWorker;
    const eligibleUrls: string[] = [];

    for (const raw of rawUrls) {
      const resolved = resolveEligiblePrecacheAssetUrl(raw, baseOrigin);
      if (resolved) {
        eligibleUrls.push(resolved.href);
      }
    }

    const deduplicated = Array.from(new Set(eligibleUrls)).slice(0, MAX_PRECACHE_ASSET_URLS);
    this.lastWarmupUrls = deduplicated;

    if (worker && deduplicated.length > 0) {
      try {
        worker.postMessage({
          type: 'PRECACHE_ASSETS',
          urls: deduplicated,
        });
      } catch {
        // Fallo silencioso de mensajería si el worker fue cerrado
      }
    }

    this.notifyListeners();
    return deduplicated;
  }

  /**
   * Vincula un `ServiceWorkerRegistration` real o simulado al gestor de ciclo de vida,
   * registrando listeners con limpieza determinista.
   */
  public attachRegistration(
    registration: ServiceWorkerRegistrationLike,
    options?: {
      doc?: { querySelectorAll?: (selector: string) => Iterable<{ getAttribute?: (attr: string) => string | null }> } | null;
      baseOrigin?: string;
    }
  ): () => void {
    // Limpiar vinculaciones previas para evitar listeners duplicados
    this.clearRegistrationListeners();

    if (registration.active) {
      this.activeWorker = registration.active;
      const discovered = discoverApplicationShellAssets(options?.doc ?? null, options?.baseOrigin);
      this.warmUpShellAssets(discovered, options?.baseOrigin, registration.active);
    }

    if (registration.waiting) {
      this.onWaitingWorkerDetected(registration.waiting);
    }

    const handleUpdateFound = () => {
      const installing = registration.installing;
      if (!installing || typeof installing.addEventListener !== 'function') return;

      const handleStateChange = () => {
        if (installing.state === 'installed') {
          if (registration.waiting) {
            this.onWaitingWorkerDetected(registration.waiting);
          } else if (this.activeWorker) {
            this.onWaitingWorkerDetected(installing);
          } else {
            this.activeWorker = installing;
            const discovered = discoverApplicationShellAssets(options?.doc ?? null, options?.baseOrigin);
            this.warmUpShellAssets(discovered, options?.baseOrigin, installing);
          }
        }
      };

      installing.addEventListener('statechange', handleStateChange);
      this.cleanupCallbacks.push(() => {
        installing.removeEventListener?.('statechange', handleStateChange);
      });
    };

    if (typeof registration.addEventListener === 'function') {
      registration.addEventListener('updatefound', handleUpdateFound);
      this.cleanupCallbacks.push(() => {
        registration.removeEventListener?.('updatefound', handleUpdateFound);
      });
    }

    return () => {
      this.clearRegistrationListeners();
    };
  }

  /**
   * Suscribe un observador a los cambios del ciclo de vida del Service Worker.
   * Retorna una función para cancelar la suscripción.
   */
  public subscribe(listener: (snapshot: SwLifecycleSnapshot) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Limpia todos los listeners y reinicia el estado interno (utilizado en desmontaje y pruebas).
   */
  public dispose(): void {
    this.clearRegistrationListeners();
    this.listeners.clear();
    this.waitingWorker = null;
    this.activeWorker = null;
    this.isApplyingUpdate = false;
    this.isSetlistActive = false;
    this.isMusicStandMode = false;
    this.lastWarmupUrls = [];
  }

  private clearRegistrationListeners(): void {
    while (this.cleanupCallbacks.length > 0) {
      const fn = this.cleanupCallbacks.pop();
      try {
        fn?.();
      } catch {
        // Ignorar errores en limpieza
      }
    }
  }

  private notifyListeners(): void {
    const snapshot = this.getSnapshot();
    for (const listener of this.listeners) {
      try {
        listener(snapshot);
      } catch {
        // Evitar que un listener rompa a los demás
      }
    }
  }
}

export const swLifecycleManager = ServiceWorkerLifecycleManager.getInstance();
