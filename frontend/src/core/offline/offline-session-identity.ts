/**
 * @file offline-session-identity.ts
 * @description Persistencia segura de identidad offline no sensible (`OfflineSessionIdentity`),
 * compuerta centralizada de bloqueo de mutaciones al servidor (`assertServerMutationAllowed`),
 * transición atómica a modo sin conexión con invalidación inmediata de token en memoria (Finding B),
 * arranque en frío sin conexión (Offline Cold Boot) y reconciliación con el servidor al reconectar
 * (Fase 2D — WS-2D-01, Decisión DEC-2D-04).
 *
 * SALVAGUARDAS DE SEGURIDAD OBLIGATORIAS (Secciones 3.3 y 3.4 + Remediación WS-2D-01):
 * - Salvaguarda A: `OfflineSessionIdentity` es exclusivamente para continuidad de UI de solo lectura, NUNCA autenticación ante el servidor.
 * - Salvaguarda B: Modo estricto de solo lectura cuando la identidad offline está activa (`isOfflineSession: true`, `isReadOnlyOffline: true`, `canManageUsers: false`).
 *   Compuerta centralizada fail-closed que bloquea POST, PUT, PATCH y DELETE en el cliente API antes de invocar la red (Finding C).
 * - Salvaguarda C: El servidor sigue siendo la única fuente de la verdad al reconectar; mientras la validación del servidor está pendiente se mantiene el modo de solo lectura; si responde 401/403 o estado inactivo, purga inmediata.
 * - Salvaguarda D: Expiración estricta a los 7 días (`MAX_OFFLINE_DAYS_GRACE_PERIOD = 7`) y tolerancia de reloj de 5 minutos (`300_000 ms`). Jamás extiende `lastAuthenticatedAt` al abrir o transicionar sin conexión.
 * - Salvaguarda E: Aislamiento estricto por usuario en dispositivos compartidos y purga con tombstone en `logout()`.
 * - Salvaguarda F: `logout()` funciona siempre sin conexión, limpiando identidad y datos locales y distinguiendo `localCleared` de `serverRevoked`.
 * - Salvaguarda G: Fail-closed ante cualquier corrupción, clave prohibida, discrepancia de propietario o expiración.
 * - Finding B: La transición `offline` activa primero la compuerta de solo lectura, incrementa `epoch`, cancela el refresco silencioso y limpia el access token en memoria (`tokenManager.clearToken()`).
 */

import type { AuthLifecycleStatus, AuthUser, UserRole } from '../auth/types.ts';
import { tokenManager } from '../auth/token-manager.ts';
import { OFFLINE_POLICIES, OfflineStorageError } from './types.ts';

export const OFFLINE_SESSION_IDENTITY_KEY = 'bethesda_offline_session_identity_v1';

export const OFFLINE_IDENTITY_GRACE_PERIOD_MS =
  OFFLINE_POLICIES.MAX_OFFLINE_DAYS_GRACE_PERIOD * 24 * 60 * 60 * 1000; // 7 días en ms

export const OFFLINE_CLOCK_SKEW_TOLERANCE_MS = 5 * 60 * 1000; // 5 minutos (300,000 ms)

export const ALLOWED_OFFLINE_IDENTITY_KEYS: readonly string[] = [
  'userId',
  'email',
  'fullName',
  'role',
  'lastAuthenticatedAt',
] as const;

export const FORBIDDEN_IDENTITY_KEY_PATTERNS: readonly string[] = [
  'token',
  'access',
  'refresh',
  'password',
  'secret',
  'cookie',
  'credential',
  'authorization',
  'bearer',
  'jwt',
  'private',
  'apikey',
] as const;

const VALID_USER_ROLES: readonly UserRole[] = [
  'SUPER_ADMIN',
  'ADMIN',
  'WORSHIP_LEADER',
  'MUSICIAN',
  'VIEWER',
] as const;

// ============================================================================
// COMPUERTA CENTRALIZADA DE MUTACIONES AL SERVIDOR (CRITICAL FINDING B & C)
// ============================================================================

let globalOfflineReadOnlyMutationGuard = false;
let simulatedOnlineStateOverride: boolean | null = null;

/**
 * Activa o desactiva la compuerta global de bloqueo de mutaciones por sesión offline de solo lectura.
 */
export function setOfflineReadOnlyMutationGuard(active: boolean): void {
  globalOfflineReadOnlyMutationGuard = Boolean(active);
}

/**
 * Consulta si la compuerta global de sesión offline de solo lectura se encuentra activa.
 */
export function isOfflineReadOnlyMutationGuardActive(): boolean {
  return globalOfflineReadOnlyMutationGuard;
}

/**
 * Permite sobrescribir de forma determinista el estado de conectividad en suites de prueba Node.js.
 * Pasar `null` restaura la lectura estándar de `navigator.onLine`.
 */
export function setSimulatedOnlineStateForTests(isOnline: boolean | null): void {
  simulatedOnlineStateOverride = isOnline;
}

/**
 * Consulta si el cliente se encuentra actualmente en línea.
 */
export function isClientCurrentlyOnline(): boolean {
  if (simulatedOnlineStateOverride !== null) {
    return simulatedOnlineStateOverride;
  }
  if (typeof navigator !== 'undefined' && typeof navigator.onLine === 'boolean') {
    return navigator.onLine;
  }
  return true;
}

/**
 * Determina si un método HTTP corresponde a una operación de escritura/mutación en el servidor.
 * Solo `GET` y `HEAD` se consideran operaciones de lectura.
 */
export function isMutatingHttpMethod(method?: string | null): boolean {
  const normalized = (method ?? 'GET').trim().toUpperCase();
  return normalized !== 'GET' && normalized !== 'HEAD';
}

/**
 * Compuerta centralizada fail-closed que protege todas las escrituras autenticadas hacia el servidor
 * (`POST`, `PUT`, `PATCH`, `DELETE`).
 * Lanza `OfflineStorageError('UNAUTHORIZED_SESSION')` si el cliente está desconectado o si la sesión
 * se encuentra en modo offline de solo lectura (pendiente de revalidación con el servidor).
 * Jamás encola mutaciones para ejecución diferida.
 */
export function assertServerMutationAllowed(method?: string, endpoint?: string): void {
  if (!isClientCurrentlyOnline() || globalOfflineReadOnlyMutationGuard) {
    const methodLabel = (method ?? 'WRITE').toUpperCase();
    const endpointLabel = endpoint ? ` (${endpoint.split('?')[0]})` : '';
    throw new OfflineStorageError(
      'UNAUTHORIZED_SESSION',
      `Operación denegada [${methodLabel}${endpointLabel}]: Bethesda Worship Studio se encuentra en Modo Sin Conexión (Solo Lectura). Las modificaciones canónicas y administrativas requieren una sesión validada en línea con el servidor.`
    );
  }
}

/**
 * Esquema estricto y exclusivo para la identidad de continuidad offline (Sección 3.3).
 * CERO tokens, contraseñas, cookies o secretos de autenticación.
 */
export interface OfflineSessionIdentity {
  readonly userId: string;
  readonly email: string;
  readonly fullName: string;
  readonly role: UserRole;
  readonly lastAuthenticatedAt: string;
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export type OfflineIdentityValidationResult =
  | { readonly valid: true; readonly identity: OfflineSessionIdentity }
  | { readonly valid: false; readonly reason: string };

export interface LogoutExecutionResult {
  readonly localCleared: boolean;
  readonly serverRevoked: boolean;
  readonly purgedOfflineItemsCount: number;
}

export interface OfflineAuthLifecycleState {
  readonly user: AuthUser | null;
  readonly authStatus: AuthLifecycleStatus;
  readonly isOfflineSession: boolean;
  readonly isReadOnlyOffline: boolean;
  readonly canManageUsers: boolean;
  readonly offlineIdentity: OfflineSessionIdentity | null;
  readonly lastLogoutResult: LogoutExecutionResult | null;
  readonly epoch: number;
}

function resolveDefaultStorage(customStorage?: StorageLike | null): StorageLike | null {
  if (customStorage !== undefined) {
    return customStorage;
  }
  if (typeof globalThis !== 'undefined' && typeof globalThis.localStorage !== 'undefined') {
    return globalThis.localStorage;
  }
  return null;
}

/**
 * Construye el nombre completo legible a partir de un `AuthUser`.
 */
export function formatAuthUserFullName(user: Pick<AuthUser, 'firstName' | 'lastName' | 'email'>): string {
  const combined = `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim();
  return combined.length > 0 ? combined : user.email;
}

/**
 * Reconstruye un objeto `AuthUser` en memoria para continuidad de interfaz de solo lectura
 * a partir de una `OfflineSessionIdentity` validada.
 */
export function toReadOnlyAuthUser(identity: OfflineSessionIdentity): AuthUser {
  const trimmedName = identity.fullName.trim();
  const firstSpaceIdx = trimmedName.indexOf(' ');
  const firstName = firstSpaceIdx > 0 ? trimmedName.slice(0, firstSpaceIdx) : trimmedName;
  const lastName = firstSpaceIdx > 0 ? trimmedName.slice(firstSpaceIdx + 1).trim() : '';

  return {
    id: identity.userId,
    email: identity.email,
    firstName: firstName || identity.email,
    lastName,
    role: identity.role,
    accountStatus: 'ACTIVE',
    mustChangePassword: false,
  };
}

/**
 * Valida de forma estricta y determinista una estructura candidata a `OfflineSessionIdentity`.
 * Aplica Fail-Closed (Salvaguarda G), rechazo de claves sensibles (Sección 3.3) y
 * verificación de expiración de 7 días + anomalías de reloj (Salvaguarda D).
 */
export function validateOfflineSessionIdentityPayload(
  raw: unknown,
  options?: {
    readonly nowMs?: number | undefined;
    readonly expectedUserId?: string | undefined;
  }
): OfflineIdentityValidationResult {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { valid: false, reason: 'IDENTITY_NOT_OBJECT' };
  }

  const record = raw as Record<string, unknown>;
  const keys = Object.keys(record);

  // 1. Verificar que no contenga ninguna clave prohibida o credencial
  for (const key of keys) {
    const lowerKey = key.toLowerCase();
    for (const forbidden of FORBIDDEN_IDENTITY_KEY_PATTERNS) {
      if (lowerKey.includes(forbidden)) {
        return { valid: false, reason: `FORBIDDEN_SENSITIVE_KEY:${key}` };
      }
    }
    if (!ALLOWED_OFFLINE_IDENTITY_KEYS.includes(key)) {
      return { valid: false, reason: `UNEXPECTED_SCHEMA_KEY:${key}` };
    }
  }

  // 2. Verificar presencia y tipo de los 5 campos obligatorios
  const { userId, email, fullName, role, lastAuthenticatedAt } = record;

  if (typeof userId !== 'string' || userId.trim().length === 0) {
    return { valid: false, reason: 'INVALID_USER_ID' };
  }
  if (typeof email !== 'string' || email.trim().length === 0 || !email.includes('@')) {
    return { valid: false, reason: 'INVALID_EMAIL' };
  }
  if (typeof fullName !== 'string' || fullName.trim().length === 0) {
    return { valid: false, reason: 'INVALID_FULL_NAME' };
  }
  if (typeof role !== 'string' || !VALID_USER_ROLES.includes(role as UserRole)) {
    return { valid: false, reason: 'INVALID_ROLE' };
  }
  if (typeof lastAuthenticatedAt !== 'string' || lastAuthenticatedAt.trim().length === 0) {
    return { valid: false, reason: 'INVALID_TIMESTAMP_TYPE' };
  }

  // 3. Verificar que ninguno de los valores de texto contenga un JWT o Bearer infiltrado
  for (const strVal of [userId, email, fullName, lastAuthenticatedAt]) {
    if (
      strVal.startsWith('Bearer ') ||
      /^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(strVal.trim())
    ) {
      return { valid: false, reason: 'FORBIDDEN_TOKEN_VALUE_DETECTED' };
    }
  }

  // 4. Validar marca de tiempo ISO, tolerancia de reloj y período de gracia de 7 días
  const authTimeMs = new Date(lastAuthenticatedAt).getTime();
  if (!Number.isFinite(authTimeMs) || Number.isNaN(authTimeMs)) {
    return { valid: false, reason: 'MALFORMED_TIMESTAMP' };
  }

  const nowMs = options?.nowMs ?? Date.now();
  const elapsedMs = nowMs - authTimeMs;

  // Rechazar fechas futuras más allá de 5 minutos de tolerancia (manipulación de reloj)
  if (elapsedMs < -OFFLINE_CLOCK_SKEW_TOLERANCE_MS) {
    return { valid: false, reason: 'CLOCK_SKEW_FUTURE_TIMESTAMP' };
  }

  // Rechazar identidades que hayan alcanzado o superado el límite de 7 días
  if (elapsedMs >= OFFLINE_IDENTITY_GRACE_PERIOD_MS) {
    return { valid: false, reason: 'OFFLINE_GRACE_PERIOD_EXPIRED' };
  }

  // 5. Validar coincidencia de usuario propietario si se especificó un contexto esperado
  if (options?.expectedUserId && userId.trim() !== options.expectedUserId.trim()) {
    return { valid: false, reason: 'USER_OWNERSHIP_MISMATCH' };
  }

  return {
    valid: true,
    identity: {
      userId: userId.trim(),
      email: email.trim(),
      fullName: fullName.trim(),
      role: role as UserRole,
      lastAuthenticatedAt: lastAuthenticatedAt.trim(),
    },
  };
}

/**
 * Persiste una `OfflineSessionIdentity` únicamente tras una autenticación o refresco exitoso
 * confirmado por el servidor con cuenta ACTIVA y sin cambio de contraseña pendiente.
 */
export function saveOfflineSessionIdentity(
  user: AuthUser,
  options?: {
    readonly nowIso?: string | undefined;
    readonly storage?: StorageLike | null | undefined;
  }
): OfflineSessionIdentity | null {
  const storage = resolveDefaultStorage(options?.storage);
  if (!storage) return null;

  // Nunca persistir si la cuenta no está activa o requiere cambio obligatorio de contraseña
  if (user.mustChangePassword === true) {
    clearOfflineSessionIdentity(storage);
    return null;
  }
  if (user.accountStatus && user.accountStatus !== 'ACTIVE') {
    clearOfflineSessionIdentity(storage);
    return null;
  }

  const nowIso = options?.nowIso ?? new Date().toISOString();
  const identity: OfflineSessionIdentity = {
    userId: user.id.trim(),
    email: user.email.trim(),
    fullName: formatAuthUserFullName(user),
    role: user.role,
    lastAuthenticatedAt: nowIso,
  };

  const validation = validateOfflineSessionIdentityPayload(identity, {
    nowMs: new Date(nowIso).getTime(),
  });
  if (!validation.valid) {
    return null;
  }

  try {
    storage.setItem(OFFLINE_SESSION_IDENTITY_KEY, JSON.stringify(validation.identity));
    return validation.identity;
  } catch {
    return null;
  }
}

/**
 * Carga y valida la `OfflineSessionIdentity` almacenada.
 * IMPORTANTE (Salvaguarda D): NUNCA modifica ni extiende `lastAuthenticatedAt` al leer.
 * IMPORTANTE (Salvaguarda G): Si el registro está corrupto, expirado o existe un tombstone pendiente,
 * falla de forma cerrada (`null`) y limpia la identidad inválida.
 */
export function loadValidOfflineSessionIdentity(options?: {
  readonly nowMs?: number | undefined;
  readonly expectedUserId?: string | undefined;
  readonly storage?: StorageLike | null | undefined;
}): OfflineSessionIdentity | null {
  const storage = resolveDefaultStorage(options?.storage);
  if (!storage) return null;

  try {
    // Salvaguarda E / G: Si existe un tombstone de limpieza pendiente, bloquear cualquier restauración offline
    const pendingTombstone = storage.getItem(OFFLINE_POLICIES.CLEANUP_TOMBSTONE_KEY);
    if (pendingTombstone && pendingTombstone.trim().length > 0) {
      storage.removeItem(OFFLINE_SESSION_IDENTITY_KEY);
      return null;
    }

    const rawJson = storage.getItem(OFFLINE_SESSION_IDENTITY_KEY);
    if (!rawJson) {
      return null;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(rawJson);
    } catch {
      storage.removeItem(OFFLINE_SESSION_IDENTITY_KEY);
      return null;
    }

    const validation = validateOfflineSessionIdentityPayload(parsed, {
      nowMs: options?.nowMs,
      expectedUserId: options?.expectedUserId,
    });

    if (!validation.valid) {
      // Fail-closed: eliminar identidad inválida, corrupta o expirada
      storage.removeItem(OFFLINE_SESSION_IDENTITY_KEY);
      return null;
    }

    return validation.identity;
  } catch {
    return null;
  }
}

/**
 * Lee el `userId` almacenado sin validar expiración únicamente para asegurar la purga completa
 * de datos privados durante `logout()` o invalidación de sesión.
 */
export function peekStoredOfflineIdentityUserId(storage?: StorageLike | null): string | null {
  const resolved = resolveDefaultStorage(storage);
  if (!resolved) return null;
  try {
    const rawJson = resolved.getItem(OFFLINE_SESSION_IDENTITY_KEY);
    if (!rawJson) return null;
    const parsed = JSON.parse(rawJson) as Record<string, unknown>;
    return typeof parsed?.userId === 'string' && parsed.userId.trim().length > 0
      ? parsed.userId.trim()
      : null;
  } catch {
    return null;
  }
}

/**
 * Elimina inmediatamente la `OfflineSessionIdentity` del almacenamiento local.
 */
export function clearOfflineSessionIdentity(storage?: StorageLike | null): void {
  const resolved = resolveDefaultStorage(storage);
  if (!resolved) return;
  try {
    resolved.removeItem(OFFLINE_SESSION_IDENTITY_KEY);
  } catch {
    // Ignorar fallos de acceso a storage bloqueado
  }
}

/**
 * Determina si un error capturado durante `refreshSession` corresponde a un rechazo explícito
 * de autorización/autenticación del servidor (401/403) en lugar de una caída de red.
 */
export function isServerAuthRejectionError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const anyErr = err as { statusCode?: number; status?: number; code?: string; message?: string };
  if (anyErr.statusCode === 401 || anyErr.statusCode === 403) return true;
  if (anyErr.status === 401 || anyErr.status === 403) return true;
  if (
    anyErr.code === 'UNAUTHORIZED' ||
    anyErr.code === 'FORBIDDEN' ||
    anyErr.code === 'ACCOUNT_DISABLED' ||
    anyErr.code === 'ACCOUNT_LOCKED' ||
    anyErr.code === 'TOKEN_REVOKED' ||
    anyErr.code === 'TOKEN_INVALID' ||
    anyErr.code === 'TOKEN_EXPIRED' ||
    anyErr.code === 'INVALID_CREDENTIALS'
  ) {
    return true;
  }
  if (typeof anyErr.message === 'string') {
    const msg = anyErr.message.toLowerCase();
    if (
      msg.includes('http 401') ||
      msg.includes('http 403') ||
      msg.includes('sesión expirada') ||
      msg.includes('no autorizado') ||
      msg.includes('cuenta suspendida') ||
      msg.includes('account disabled') ||
      msg.includes('cookie de refresco') ||
      msg.includes('token de refresco') ||
      msg.includes('token reutilizado') ||
      msg.includes('revoked')
    ) {
      return true;
    }
  }
  return false;
}

export interface OfflineAuthLifecycleDependencies {
  readonly isOnlineFn: () => boolean;
  readonly refreshSessionFn: () => Promise<{ accessToken: string; expiresIn?: number | undefined; user: AuthUser }>;
  readonly serverLogoutFn: () => Promise<void>;
  readonly purgeUserSessionDataFn: (userId?: string | null) => Promise<{ success: boolean; purgedCount: number }>;
  readonly setOfflineReadOnlyGuardFn?: ((active: boolean) => void) | undefined;
  readonly storage?: StorageLike | null | undefined;
  readonly nowFn?: (() => number) | undefined;
}

/**
 * Coordinador determinista del ciclo de vida de autenticación online/offline (WS-2D-01 Sección 3.5 + Finding B).
 * Garantiza:
 * - Protección contra condiciones de carrera mediante contador monotónico `epoch`.
 * - Transición atómica a modo sin conexión (`transitionToOfflineMode`): activa primero el guard de mutación,
 *   cancela refrescos programados, limpia el access token en memoria (`tokenManager.clearToken()`) e invalida
 *   operaciones en vuelo.
 * - Aislamiento en dispositivos compartidos (purga del usuario anterior si otro usuario inicia sesión).
 * - Restauración en frío sin conexión (Offline Cold Boot / F5) en modo estricto de solo lectura.
 * - Reconciliación obligatoria con el servidor al recuperar conectividad (`reconcileOnReconnect`) manteniendo
 *   el estado de solo lectura mientras la validación del servidor está pendiente.
 * - Cierre de sesión offline garantizado (`LogoutExecutionResult`).
 */
export class OfflineAuthLifecycleController {
  private readonly deps: OfflineAuthLifecycleDependencies;
  private currentEpoch = 0;
  private state: OfflineAuthLifecycleState = {
    user: null,
    authStatus: 'INITIALIZING',
    isOfflineSession: false,
    isReadOnlyOffline: false,
    canManageUsers: false,
    offlineIdentity: null,
    lastLogoutResult: null,
    epoch: 0,
  };
  private listeners = new Set<(state: OfflineAuthLifecycleState) => void>();

  public constructor(deps: OfflineAuthLifecycleDependencies) {
    this.deps = deps;
  }

  public getState(): OfflineAuthLifecycleState {
    return { ...this.state };
  }

  public subscribe(listener: (state: OfflineAuthLifecycleState) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private getNowMs(overrideNowMs?: number): number {
    if (overrideNowMs !== undefined) return overrideNowMs;
    return this.deps.nowFn ? this.deps.nowFn() : Date.now();
  }

  private setReadOnlyGuard(active: boolean): void {
    setOfflineReadOnlyMutationGuard(active);
    this.deps.setOfflineReadOnlyGuardFn?.(active);
  }

  private updateState(partial: Partial<OfflineAuthLifecycleState>): OfflineAuthLifecycleState {
    this.state = {
      ...this.state,
      ...partial,
    };
    this.setReadOnlyGuard(this.state.isReadOnlyOffline);
    const snapshot = this.getState();
    for (const listener of this.listeners) {
      try {
        listener(snapshot);
      } catch {
        // Aislar errores de observadores
      }
    }
    return snapshot;
  }

  /**
   * Transición atómica y fail-closed a modo sin conexión (Critical Finding B):
   * 1. Activa inmediatamente la compuerta de bloqueo de mutaciones al servidor.
   * 2. Incrementa `epoch` para invalidar cualquier operación de refresco asíncrono en vuelo.
   * 3. Cancela temporizadores de refresco silencioso y limpia el access token en memoria (`tokenManager.clearToken()`).
   * 4. Preserva únicamente la identidad local previamente validada dentro del período de gracia de 7 días (sin extender `lastAuthenticatedAt`).
   * 5. Nunca afirma que ocurrió un logout o revocación en el servidor por el simple hecho de perder red.
   */
  public transitionToOfflineMode(options?: { readonly nowMs?: number | undefined }): OfflineAuthLifecycleState {
    // 1. Activar compuerta de mutación al servidor ANTES de cualquier otra acción
    this.setReadOnlyGuard(true);

    // 2. Incrementar epoch para bloquear cualquier promesa en vuelo
    const offlineEpoch = ++this.currentEpoch;
    const nowMs = this.getNowMs(options?.nowMs);

    // 3. Cancelar refresco silencioso programado y limpiar access token en memoria
    tokenManager.cancelSilentRefresh();
    tokenManager.clearToken();

    // 4. Evaluar identidad local sin extender el período de gracia de 7 días
    return this.restoreOfflineReadOnlyContext(offlineEpoch, nowMs);
  }

  /**
   * Registra una sesión autenticada exitosamente contra el servidor (`login` o `refreshSession`).
   * Aplica Salvaguarda E: si existía una identidad o datos de otro usuario en el dispositivo,
   * purga primero los datos privados del usuario anterior antes de activar el nuevo usuario.
   */
  public async activateServerAuthenticatedSession(
    user: AuthUser,
    accessToken: string,
    options?: {
      readonly nowMs?: number | undefined;
      readonly expectedEpoch?: number | undefined;
      readonly expiresInSeconds?: number | undefined;
    }
  ): Promise<OfflineAuthLifecycleState> {
    const targetEpoch = options?.expectedEpoch ?? ++this.currentEpoch;
    const nowMs = this.getNowMs(options?.nowMs);
    const nowIso = new Date(nowMs).toISOString();

    // Si mientras tanto el cliente pasó a offline o avanzó el epoch, abortar y mantener limpio el token
    if (targetEpoch !== this.currentEpoch || !this.deps.isOnlineFn()) {
      tokenManager.clearToken();
      return this.getState();
    }

    // Verificar si existía un usuario distinto previamente almacenado en el dispositivo
    const previousStoredUserId =
      this.state.user?.id ??
      this.state.offlineIdentity?.userId ??
      peekStoredOfflineIdentityUserId(this.deps.storage);

    if (previousStoredUserId && previousStoredUserId !== user.id) {
      await this.deps.purgeUserSessionDataFn(previousStoredUserId);
      if (targetEpoch !== this.currentEpoch || !this.deps.isOnlineFn()) {
        tokenManager.clearToken();
        return this.getState();
      }
    }

    // Validar que la cuenta esté activa y no tenga cambio obligatorio de contraseña pendiente
    if (user.mustChangePassword === true || (user.accountStatus && user.accountStatus !== 'ACTIVE')) {
      tokenManager.clearToken();
      clearOfflineSessionIdentity(this.deps.storage);
      await this.deps.purgeUserSessionDataFn(user.id);
      if (targetEpoch !== this.currentEpoch) {
        return this.getState();
      }
      return this.updateState({
        user: null,
        authStatus: 'UNAUTHENTICATED',
        isOfflineSession: false,
        isReadOnlyOffline: false,
        canManageUsers: false,
        offlineIdentity: null,
        epoch: targetEpoch,
      });
    }

    tokenManager.setToken(accessToken, options?.expiresInSeconds ?? 900);
    const savedIdentity = saveOfflineSessionIdentity(user, {
      nowIso,
      storage: this.deps.storage,
    });

    const isAdmin = user.role === 'SUPER_ADMIN' || user.role === 'ADMIN';

    return this.updateState({
      user,
      authStatus: 'AUTHENTICATED',
      isOfflineSession: false,
      isReadOnlyOffline: false,
      canManageUsers: isAdmin,
      offlineIdentity: savedIdentity,
      epoch: targetEpoch,
    });
  }

  /**
   * Inicializa la sesión en el arranque de la aplicación o tras recarga (F5).
   * - Si hay conexión, valida con el servidor (`refreshSessionFn`).
   * - Si no hay conexión (o falla la red estando desconectado), restaura el contexto offline de solo lectura
   *   únicamente si `OfflineSessionIdentity` es íntegra y se encuentra dentro del período de gracia de 7 días.
   */
  public async initializeSession(options?: { readonly nowMs?: number | undefined }): Promise<OfflineAuthLifecycleState> {
    const myEpoch = ++this.currentEpoch;
    const nowMs = this.getNowMs(options?.nowMs);

    // Si estamos desconectados en el arranque en frío (Cold Boot / Offline F5)
    if (!this.deps.isOnlineFn()) {
      this.setReadOnlyGuard(true);
      tokenManager.clearToken();
      return this.restoreOfflineReadOnlyContext(myEpoch, nowMs);
    }

    try {
      const response = await this.deps.refreshSessionFn();
      if (myEpoch !== this.currentEpoch || !this.deps.isOnlineFn()) {
        tokenManager.clearToken();
        return this.getState();
      }
      return await this.activateServerAuthenticatedSession(response.user, response.accessToken, {
        nowMs,
        expectedEpoch: myEpoch,
        expiresInSeconds: response.expiresIn ?? 900,
      });
    } catch (err) {
      if (myEpoch !== this.currentEpoch) {
        return this.getState();
      }

      // Salvaguarda C: Si el servidor rechazó explícitamente la sesión (401/403), invalidar y purgar todo
      if (isServerAuthRejectionError(err)) {
        const storedUserId =
          this.state.user?.id ??
          this.state.offlineIdentity?.userId ??
          peekStoredOfflineIdentityUserId(this.deps.storage);
        tokenManager.clearToken();
        clearOfflineSessionIdentity(this.deps.storage);
        if (storedUserId) {
          await this.deps.purgeUserSessionDataFn(storedUserId);
        }
        if (myEpoch !== this.currentEpoch) {
          return this.getState();
        }
        return this.updateState({
          user: null,
          authStatus: 'UNAUTHENTICATED',
          isOfflineSession: false,
          isReadOnlyOffline: false,
          canManageUsers: false,
          offlineIdentity: null,
          epoch: myEpoch,
        });
      }

      // Si el fallo fue por pérdida de red / servidor inalcanzable, intentar continuidad offline de solo lectura
      return this.restoreOfflineReadOnlyContext(myEpoch, nowMs);
    }
  }

  /**
   * Restaura una sesión offline estrictamente de solo lectura desde `OfflineSessionIdentity`.
   * Salvaguarda B: `isOfflineSession = true`, `isReadOnlyOffline = true`, `canManageUsers = false`, `token = null`.
   * Salvaguarda D: Jamás modifica ni extiende `lastAuthenticatedAt`.
   */
  private restoreOfflineReadOnlyContext(targetEpoch: number, nowMs: number): OfflineAuthLifecycleState {
    if (targetEpoch !== this.currentEpoch) {
      return this.getState();
    }

    this.setReadOnlyGuard(true);
    tokenManager.cancelSilentRefresh();
    tokenManager.clearToken();

    const validIdentity = loadValidOfflineSessionIdentity({
      nowMs,
      storage: this.deps.storage,
    });

    if (!validIdentity) {
      return this.updateState({
        user: null,
        authStatus: 'UNAUTHENTICATED',
        isOfflineSession: false,
        isReadOnlyOffline: !this.deps.isOnlineFn(),
        canManageUsers: false,
        offlineIdentity: null,
        epoch: targetEpoch,
      });
    }

    const restoredUser = toReadOnlyAuthUser(validIdentity);

    return this.updateState({
      user: restoredUser,
      authStatus: 'AUTHENTICATED',
      isOfflineSession: true,
      isReadOnlyOffline: true,
      // Salvaguarda A y B: las operaciones administrativas están estrictamente bloqueadas en modo offline
      canManageUsers: false,
      offlineIdentity: validIdentity,
      epoch: targetEpoch,
    });
  }

  /**
   * Reconcilia la identidad local con el servidor cuando retorna la conectividad (`online`).
   * Salvaguarda C + Critical Finding B:
   * 1. Mantiene explícitamente la sesión en modo de solo lectura mientras la validación del servidor está pendiente.
   * 2. La identidad offline jamás se convierte silenciosamente en una sesión online autenticada sin validación del servidor.
   * 3. Si el servidor responde 401/403 o cuenta inactiva, invalida inmediatamente la identidad offline y purga los datos privados.
   * 4. Si ocurre un fallo de red o una transición `offline` concurrente, retiene el modo de solo lectura sin restaurar tokens.
   */
  public async reconcileOnReconnect(options?: { readonly nowMs?: number | undefined }): Promise<OfflineAuthLifecycleState> {
    const myEpoch = ++this.currentEpoch;
    const nowMs = this.getNowMs(options?.nowMs);

    // 1. Mantener estrictamente la compuerta de solo lectura activa mientras se valida con el servidor
    this.setReadOnlyGuard(true);
    tokenManager.clearToken();

    if (!this.deps.isOnlineFn()) {
      return this.restoreOfflineReadOnlyContext(myEpoch, nowMs);
    }

    try {
      const response = await this.deps.refreshSessionFn();
      if (myEpoch !== this.currentEpoch || !this.deps.isOnlineFn()) {
        tokenManager.clearToken();
        return this.getState();
      }
      return await this.activateServerAuthenticatedSession(response.user, response.accessToken, {
        nowMs,
        expectedEpoch: myEpoch,
        expiresInSeconds: response.expiresIn ?? 900,
      });
    } catch (err) {
      if (myEpoch !== this.currentEpoch) {
        return this.getState();
      }

      if (isServerAuthRejectionError(err)) {
        const userIdToPurge =
          this.state.user?.id ??
          this.state.offlineIdentity?.userId ??
          peekStoredOfflineIdentityUserId(this.deps.storage);

        tokenManager.clearToken();
        clearOfflineSessionIdentity(this.deps.storage);
        if (userIdToPurge) {
          await this.deps.purgeUserSessionDataFn(userIdToPurge);
        }
        if (myEpoch !== this.currentEpoch) {
          return this.getState();
        }
        return this.updateState({
          user: null,
          authStatus: 'UNAUTHENTICATED',
          isOfflineSession: false,
          isReadOnlyOffline: false,
          canManageUsers: false,
          offlineIdentity: null,
          epoch: myEpoch,
        });
      }

      // Error de red transitorio durante la reconexión: NUNCA promover a sesión online autenticada;
      // permanecer en modo estricto de solo lectura si la identidad sigue dentro de los 7 días.
      return this.restoreOfflineReadOnlyContext(myEpoch, nowMs);
    }
  }

  /**
   * Ejecuta el cierre de sesión seguro tanto en línea como sin conexión (Salvaguardas E y F).
   * - Incrementa inmediatamente `epoch` para invalidar cualquier operación asíncrona previa en vuelo.
   * - Limpia `OfflineSessionIdentity` y tokens en memoria.
   * - Purga los datos privados del usuario en IndexedDB respetando el mecanismo de tombstone.
   * - Distingue explícitamente entre limpieza local (`localCleared: true`) y revocación en servidor (`serverRevoked`).
   */
  public async logout(): Promise<LogoutExecutionResult> {
    const logoutEpoch = ++this.currentEpoch;
    const userIdToPurge =
      this.state.user?.id ??
      this.state.offlineIdentity?.userId ??
      peekStoredOfflineIdentityUserId(this.deps.storage);

    // 1. Limpieza local inmediata de credenciales e identidad offline
    tokenManager.cancelSilentRefresh();
    tokenManager.clearToken();
    clearOfflineSessionIdentity(this.deps.storage);

    this.updateState({
      user: null,
      authStatus: 'UNAUTHENTICATED',
      isOfflineSession: false,
      isReadOnlyOffline: !this.deps.isOnlineFn(),
      canManageUsers: false,
      offlineIdentity: null,
      epoch: logoutEpoch,
    });

    // 2. Purgar datos privados del usuario en IndexedDB (cancela descargas activas y gestiona tombstone)
    let purgedCount = 0;
    try {
      const purgeRes = await this.deps.purgeUserSessionDataFn(userIdToPurge);
      purgedCount = purgeRes.purgedCount;
    } catch {
      // El mecanismo de tombstone en purgeSessionData protege al siguiente usuario ante cualquier fallo de disco
    }

    // 3. Intentar revocación en el servidor únicamente si existe conectividad de red
    let serverRevoked = false;
    if (this.deps.isOnlineFn()) {
      try {
        await this.deps.serverLogoutFn();
        serverRevoked = true;
      } catch {
        serverRevoked = false;
      }
    }

    const result: LogoutExecutionResult = {
      localCleared: true,
      serverRevoked,
      purgedOfflineItemsCount: purgedCount,
    };

    if (logoutEpoch === this.currentEpoch) {
      this.updateState({
        lastLogoutResult: result,
      });
    }

    return result;
  }

  /**
   * Salvaguarda A y B: Verifica que la sesión actual tenga autorización real del servidor para mutar datos.
   * Bloquea cualquier mutación o acción administrativa si `isOfflineSession` o `isReadOnlyOffline` está activo.
   */
  public assertOnlineServerMutationAllowed(): void {
    assertServerMutationAllowed();
    if (
      this.state.isOfflineSession ||
      this.state.isReadOnlyOffline ||
      !this.deps.isOnlineFn() ||
      !tokenManager.getToken()
    ) {
      throw new OfflineStorageError(
        'UNAUTHORIZED_SESSION',
        'Operación denegada: La sesión actual se encuentra en Modo Sin Conexión (Solo Lectura). Las modificaciones y acciones administrativas requieren una sesión validada en línea con el servidor.'
      );
    }
  }
}
