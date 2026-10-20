/**
 * @file auth-context.tsx
 * @description Contexto de React y Proveedor para el estado de autenticación y RBAC (Fase 2B).
 *
 * PROHIBICIÓN ARQUITECTÓNICA:
 * - Los componentes de renderizado musical (AlphaTab, OSMD, LeadSheetDOM) NO deben importar este contexto.
 * - La seguridad permanece confinada a la capa de aplicación y entorno de usuario.
 */

import React, { createContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import type { AuthUser, UserRole, AuthLifecycleStatus } from './types.ts';
import { tokenManager } from './token-manager.ts';
import { BethesdaApiClient } from '../api/api-client.ts';
import { offlineManager } from '../offline/offline-manager.ts';

export interface AuthContextType {
  user: AuthUser | null;
  authStatus: AuthLifecycleStatus;
  isAuthenticated: boolean;
  isLoading: boolean;
  canManageUsers: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  changeInitialPassword: (currentPassword: string, newPassword: string) => Promise<void>;
  hasRole: (roles: UserRole | UserRole[]) => boolean;
}

export const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [authStatus, setAuthStatus] = useState<AuthLifecycleStatus>('INITIALIZING');

  const apiClient = BethesdaApiClient.getInstance();

  /**
   * Función para renovar silenciosamente la sesión con la cookie HttpOnly.
   */
  const performSilentRefresh = useCallback(async (): Promise<AuthUser | null> => {
    try {
      const response = await apiClient.refreshSession();
      tokenManager.setToken(response.accessToken, response.expiresIn);
      setUser(response.user);
      setAuthStatus('AUTHENTICATED');

      // Programar la siguiente renovación 60s antes de expirar
      tokenManager.scheduleSilentRefresh(async () => {
        await performSilentRefresh();
      });

      return response.user;
    } catch {
      tokenManager.clearToken();
      setUser(null);
      setAuthStatus('UNAUTHENTICATED');
      return null;
    }
  }, [apiClient]);

  // Al montar la aplicación (o tras recarga F5), restaurar la sesión usando la cookie HttpOnly
  useEffect(() => {
    let isMounted = true;

    async function initSession() {
      try {
        await performSilentRefresh();
      } catch {
        if (isMounted) {
          setAuthStatus('UNAUTHENTICATED');
        }
      }
    }

    initSession();

    return () => {
      isMounted = false;
      tokenManager.cancelSilentRefresh();
    };
  }, [performSilentRefresh]);

  /**
   * Iniciar sesión con correo y contraseña.
   */
  const login = useCallback(
    async (email: string, password: string): Promise<void> => {
      const response = await apiClient.login(email, password);
      tokenManager.setToken(response.accessToken, response.expiresIn);
      setUser(response.user);
      setAuthStatus('AUTHENTICATED');

      tokenManager.scheduleSilentRefresh(async () => {
        await performSilentRefresh();
      });
    },
    [apiClient, performSilentRefresh]
  );

  /**
   * Cerrar sesión invalidando el refresh token en el servidor y limpiando la cookie, memoria y datos offline privados.
   */
  const logout = useCallback(async (): Promise<void> => {
    const currentUserId = user?.id;
    try {
      await apiClient.logout();
    } finally {
      // WP-04 (Requisito 4.6): Purga y cancelación de descargas privadas de la sesión
      if (currentUserId) {
        await offlineManager.purgeSessionData(currentUserId).catch((err) => {
          console.error('⚠️ Error al purgar almacenamiento offline durante logout:', err);
        });
      }
      tokenManager.clearToken();
      setUser(null);
      setAuthStatus('UNAUTHENTICATED');
    }
  }, [apiClient, user]);

  /**
   * Cambiar contraseña inicial para usuarios en estado MUST_CHANGE_PASSWORD.
   */
  const changeInitialPassword = useCallback(
    async (currentPassword: string, newPassword: string): Promise<void> => {
      await apiClient.changeInitialPassword(currentPassword, newPassword);
      // Actualizar estado del usuario localmente a ACTIVE
      if (user) {
        setUser({ ...user, accountStatus: 'ACTIVE' });
      }
    },
    [apiClient, user]
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

  const canManageUsers = !!user && (user.role === 'SUPER_ADMIN' || user.role === 'ADMIN');
  const isLoading = authStatus === 'INITIALIZING';
  const isAuthenticated = authStatus === 'AUTHENTICATED' && user !== null;

  return (
    <AuthContext.Provider
      value={{
        user,
        authStatus,
        isAuthenticated,
        isLoading,
        canManageUsers,
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
