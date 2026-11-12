/**
 * @file auth-context.tsx
 * @description Contexto de React y Proveedor para el estado de autenticación, RBAC y
 * continuidad de sesión offline de solo lectura (Fase 2B & Fase 2D — WS-2D-01).
 *
 * PROHIBICIÓN ARQUITECTÓNICA:
 * - Los componentes de renderizado musical (AlphaTab, OSMD, LeadSheetDOM) NO deben importar este contexto.
 * - La seguridad permanece confinada a la capa de aplicación y entorno de usuario.
 *
 * SALVAGUARDAS WS-2D-01 (DEC-2D-04 + Remediación de Seguridad):
 * - Cero persistencia de tokens o secretos en almacenamiento local.
 * - Transición atómica a modo sin conexión (Finding B): activa primero la compuerta de bloqueo de mutaciones,
 *   incrementa `authEpochRef`, cancela el refresco silencioso y limpia el access token en memoria (`tokenManager.clearToken()`).
 * - Modo estricto de solo lectura cuando `isOfflineSession === true` (`canManageUsers = false`).
 * - Reconciliación obligatoria con el servidor al recuperar conectividad (`online`), manteniendo el modo de solo lectura
 *   mientras la validación del servidor está pendiente.
 * - Aislamiento de usuario en dispositivos compartidos y soporte garantizado de `logout()` sin conexión.
 */

import React, { createContext, useState, useEffect, useCallback, useRef, type ReactNode } from 'react';
import type { AuthUser, UserRole, AuthLifecycleStatus } from './types.ts';
import { tokenManager } from './token-manager.ts';
import { BethesdaApiClient } from '../api/api-client.ts';
import { offlineManager } from '../offline/offline-manager.ts';
import {
  saveOfflineSessionIdentity,
  loadValidOfflineSessionIdentity,
  clearOfflineSessionIdentity,
  peekStoredOfflineIdentityUserId,
  toReadOnlyAuthUser,
  isServerAuthRejectionError,
  type LogoutExecutionResult,
} from '../offline/offline-session-identity.ts';

export interface AuthContextType {
  user: AuthUser | null;
  authStatus: AuthLifecycleStatus;
  isAuthenticated: boolean;
  isLoading: boolean;
  isOfflineSession: boolean;
  isReadOnlyOffline: boolean;
  canManageUsers: boolean;
  lastLogoutResult: LogoutExecutionResult | null;
  login: (email: string, password: string) => Promise<AuthUser>;
  logout: () => Promise<void>;
  changeInitialPassword: (currentPassword: string, newPassword: string) => Promise<void>;
  hasRole: (roles: UserRole | UserRole[]) => boolean;
}

export const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [authStatus, setAuthStatus] = useState<AuthLifecycleStatus>('INITIALIZING');
  const [isOfflineSession, setIsOfflineSession] = useState<boolean>(false);
  const [lastLogoutResult, setLastLogoutResult] = useState<LogoutExecutionResult | null>(null);

  // Contador monotónico para prevenir condiciones de carrera entre initSession, refresh, offline, reconexión y logout
  const authEpochRef = useRef<number>(0);
  const isMountedRef = useRef<boolean>(true);

  const apiClient = BethesdaApiClient.getInstance();

  /**
   * Intenta restaurar el contexto de interfaz en modo estricto de solo lectura
   * a partir de `OfflineSessionIdentity` (Salvaguardas A, B, D, G y Finding B).
   * Jamás extiende `lastAuthenticatedAt` ni otorga permisos administrativos.
   */
  const tryRestoreOfflineIdentity = useCallback((expectedEpoch: number): AuthUser | null => {
    if (!isMountedRef.current || expectedEpoch !== authEpochRef.current) {
      return null;
    }

    // Activar compuerta de bloqueo de mutaciones y limpiar cualquier token en memoria
    offlineManager.setOfflineReadOnlySessionActive(true);
    tokenManager.cancelSilentRefresh();
    tokenManager.clearToken();

    const validIdentity = loadValidOfflineSessionIdentity();

    if (!validIdentity) {
      offlineManager.setOfflineReadOnlySessionActive(!offlineManager.isOnline());
      setIsOfflineSession(false);
      setUser(null);
      setAuthStatus('UNAUTHENTICATED');
      return null;
    }

    const restoredUser = toReadOnlyAuthUser(validIdentity);
    setIsOfflineSession(true);
    setUser(restoredUser);
    setAuthStatus('AUTHENTICATED');
    return restoredUser;
  }, []);

  /**
   * Renueva silenciosamente la sesión con el servidor o aplica las reglas de continuidad/revocación offline.
   */
  const performSilentRefresh = useCallback(async (): Promise<AuthUser | null> => {
    const myEpoch = ++authEpochRef.current;

    // Si la aplicación arranca o recarga (F5) genuinamente sin conexión, evaluar OfflineSessionIdentity
    if (!offlineManager.isOnline()) {
      return tryRestoreOfflineIdentity(myEpoch);
    }

    try {
      const response = await apiClient.refreshSession();
      if (!isMountedRef.current || myEpoch !== authEpochRef.current || !offlineManager.isOnline()) {
        tokenManager.clearToken();
        return null;
      }

      // Salvaguarda E: Si existía una identidad de un usuario distinto en este dispositivo compartido, purgar sus datos privados
      const previousStoredUserId = peekStoredOfflineIdentityUserId();
      if (previousStoredUserId && previousStoredUserId !== response.user?.id) {
        await offlineManager.purgeSessionData(previousStoredUserId).catch(() => {});
        if (!isMountedRef.current || myEpoch !== authEpochRef.current || !offlineManager.isOnline()) {
          tokenManager.clearToken();
          return null;
        }
      }

      if (
        response.user?.mustChangePassword ||
        response.user?.accountStatus === 'MUST_CHANGE_PASSWORD' ||
        (response.user?.accountStatus && response.user.accountStatus !== 'ACTIVE')
      ) {
        tokenManager.clearToken();
        clearOfflineSessionIdentity();
        offlineManager.setOfflineReadOnlySessionActive(false);
        if (response.user?.id) {
          await offlineManager.purgeSessionData(response.user.id).catch(() => {});
        }
        if (!isMountedRef.current || myEpoch !== authEpochRef.current) {
          return null;
        }
        setIsOfflineSession(false);
        setUser(null);
        setAuthStatus('UNAUTHENTICATED');
        return null;
      }

      tokenManager.setToken(response.accessToken, response.expiresIn);
      saveOfflineSessionIdentity(response.user);
      offlineManager.setOfflineReadOnlySessionActive(false);
      setIsOfflineSession(false);
      setUser(response.user);
      setAuthStatus('AUTHENTICATED');

      // Programar la siguiente renovación 60s antes de expirar
      tokenManager.scheduleSilentRefresh(async () => {
        await performSilentRefresh();
      });

      return response.user;
    } catch (err) {
      if (!isMountedRef.current || myEpoch !== authEpochRef.current) {
        return null;
      }

      // Salvaguarda C: Si el servidor rechazó o revocó explícitamente la sesión (401/403), invalidar y purgar de inmediato
      if (isServerAuthRejectionError(err)) {
        const storedUserId = peekStoredOfflineIdentityUserId();
        tokenManager.clearToken();
        clearOfflineSessionIdentity();
        offlineManager.setOfflineReadOnlySessionActive(false);
        if (storedUserId) {
          await offlineManager.purgeSessionData(storedUserId).catch(() => {});
        }
        if (!isMountedRef.current || myEpoch !== authEpochRef.current) {
          return null;
        }
        setIsOfflineSession(false);
        setUser(null);
        setAuthStatus('UNAUTHENTICATED');
        return null;
      }

      // Si el fallo se debió a pérdida de red o servidor inalcanzable, intentar restaurar identidad offline de solo lectura
      return tryRestoreOfflineIdentity(myEpoch);
    }
  }, [apiClient, tryRestoreOfflineIdentity]);

  // 1. Al montar la aplicación (o tras recarga F5), inicializar sesión (Online Refresh o Offline Cold Boot)
  useEffect(() => {
    isMountedRef.current = true;
    performSilentRefresh().catch(() => {
      if (isMountedRef.current) {
        setAuthStatus('UNAUTHENTICATED');
      }
    });

    return () => {
      isMountedRef.current = false;
      tokenManager.cancelSilentRefresh();
    };
  }, [performSilentRefresh]);

  // 2. Salvaguarda C & Finding B: Transición atómica a modo offline y reconciliación al reconectar (`online`)
  useEffect(() => {
    const handleOnline = () => {
      // Mantener la compuerta de solo lectura activa y sin token hasta que el servidor confirme la sesión
      offlineManager.setOfflineReadOnlySessionActive(true);
      tokenManager.clearToken();
      performSilentRefresh().catch(() => {});
    };

    const handleOffline = () => {
      // Transición atómica y fail-closed a modo sin conexión (Finding B):
      // 1. Activar inmediatamente la compuerta de mutación al servidor
      offlineManager.setOfflineReadOnlySessionActive(true);
      // 2. Incrementar epoch para invalidar cualquier refresco asíncrono en vuelo
      const offlineEpoch = ++authEpochRef.current;
      // 3. Cancelar refresco silencioso y limpiar el access token en memoria
      tokenManager.cancelSilentRefresh();
      tokenManager.clearToken();
      // 4. Preservar únicamente la identidad local previamente validada dentro de los 7 días de gracia
      tryRestoreOfflineIdentity(offlineEpoch);
    };

    if (typeof window !== 'undefined') {
      window.addEventListener('online', handleOnline);
      window.addEventListener('offline', handleOffline);
    }

    return () => {
      if (typeof window !== 'undefined') {
        window.removeEventListener('online', handleOnline);
        window.removeEventListener('offline', handleOffline);
      }
    };
  }, [performSilentRefresh, tryRestoreOfflineIdentity]);

  /**
   * Iniciar sesión con correo y contraseña.
   */
  const login = useCallback(
    async (email: string, password: string): Promise<AuthUser> => {
      offlineManager.assertCanMutateServer();
      const loginEpoch = ++authEpochRef.current;
      const response = await apiClient.login(email, password);

      // Salvaguarda E: Aislamiento en dispositivos compartidos — si había otro usuario previo, purgar sus datos offline
      const previousUserId = user?.id ?? peekStoredOfflineIdentityUserId();
      if (previousUserId && previousUserId !== response.user?.id) {
        await offlineManager.purgeSessionData(previousUserId).catch(() => {});
      }

      if (!isMountedRef.current || loginEpoch !== authEpochRef.current || !offlineManager.isOnline()) {
        tokenManager.clearToken();
        return response.user;
      }

      tokenManager.setToken(response.accessToken, response.expiresIn);

      // Si la cuenta requiere cambio forzoso de contraseña, no admitir al espacio musical autenticado ni guardar identidad offline
      if (response.user?.mustChangePassword || response.user?.accountStatus === 'MUST_CHANGE_PASSWORD') {
        clearOfflineSessionIdentity();
        offlineManager.setOfflineReadOnlySessionActive(false);
        setIsOfflineSession(false);
        setUser(null);
        setAuthStatus('UNAUTHENTICATED');
        return response.user;
      }

      saveOfflineSessionIdentity(response.user);
      offlineManager.setOfflineReadOnlySessionActive(false);
      setIsOfflineSession(false);
      setUser(response.user);
      setAuthStatus('AUTHENTICATED');

      tokenManager.scheduleSilentRefresh(async () => {
        await performSilentRefresh();
      });

      return response.user;
    },
    [apiClient, performSilentRefresh, user]
  );

  /**
   * Cerrar sesión de forma segura tanto en línea como sin conexión (Salvaguardas E y F).
   * - Incrementa inmediatamente `authEpochRef` para invalidar cualquier operación asíncrona en vuelo.
   * - Limpia `OfflineSessionIdentity`, tokens en memoria y datos privados en IndexedDB (con tombstone).
   * - No reporta revocación en el servidor como completada si el cierre ocurrió sin conexión.
   */
  const logout = useCallback(async (): Promise<void> => {
    const logoutEpoch = ++authEpochRef.current;
    tokenManager.cancelSilentRefresh();

    const userIdToPurge = user?.id ?? peekStoredOfflineIdentityUserId();

    // 1. Limpieza local inmediata (funciona incluso sin red)
    tokenManager.clearToken();
    clearOfflineSessionIdentity();
    offlineManager.setOfflineReadOnlySessionActive(false);
    setIsOfflineSession(false);
    setUser(null);
    setAuthStatus('UNAUTHENTICATED');

    // 2. Purgar datos privados en IndexedDB y abortar descargas activas (preservando tombstone)
    let purgedCount = 0;
    try {
      const purgeRes = await offlineManager.purgeSessionData(userIdToPurge);
      purgedCount = purgeRes.purgedCount;
    } catch (err) {
      console.error('⚠️ Error al purgar almacenamiento offline durante logout:', err);
    }

    // 3. Intentar revocación en el servidor solo si hay conectividad
    let serverRevoked = false;
    if (offlineManager.isOnline()) {
      try {
        await apiClient.logout();
        serverRevoked = true;
      } catch {
        serverRevoked = false;
      }
    }

    if (isMountedRef.current && logoutEpoch === authEpochRef.current) {
      setLastLogoutResult({
        localCleared: true,
        serverRevoked,
        purgedOfflineItemsCount: purgedCount,
      });
    }
  }, [apiClient, user]);

  /**
   * Cambiar contraseña inicial para usuarios en estado MUST_CHANGE_PASSWORD.
   */
  const changeInitialPassword = useCallback(
    async (currentPassword: string, newPassword: string): Promise<void> => {
      offlineManager.assertCanMutateServer();
      await apiClient.changeInitialPassword(currentPassword, newPassword);
    },
    [apiClient]
  );

  /**
   * Evalúa si el usuario autenticado tiene al menos uno de los roles especificados.
   */
  const hasRole = useCallback(
    (roles: UserRole | UserRole[]): boolean => {
      if (!user) return false;
      const roleList = Array.isArray(roles) ? roles : [roles];
      return roleList.includes(user.role);
    },
    [user]
  );

  const isReadOnlyOffline = isOfflineSession || !offlineManager.isOnline();
  // Salvaguarda A y B: Bloquear estrictamente operaciones administrativas cuando la sesión es offline
  const canManageUsers = !isReadOnlyOffline && !!user && (user.role === 'SUPER_ADMIN' || user.role === 'ADMIN');
  const isLoading = authStatus === 'INITIALIZING';
  const isAuthenticated = authStatus === 'AUTHENTICATED' && user !== null;

  return (
    <AuthContext.Provider
      value={{
        user,
        authStatus,
        isAuthenticated,
        isLoading,
        isOfflineSession,
        isReadOnlyOffline,
        canManageUsers,
        lastLogoutResult,
        login,
        logout,
        changeInitialPassword,
        hasRole,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};
