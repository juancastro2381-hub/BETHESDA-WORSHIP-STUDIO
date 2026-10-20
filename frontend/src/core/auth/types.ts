/**
 * @file types.ts
 * @description Tipos de datos para el subsistema de autenticación y RBAC del frontend (Fase 2B).
 */

export type UserRole = 'SUPER_ADMIN' | 'ADMIN' | 'WORSHIP_LEADER' | 'MUSICIAN' | 'VIEWER';

export type AccountStatus =
  | 'ACTIVE'
  | 'PENDING_INVITATION'
  | 'MUST_CHANGE_PASSWORD'
  | 'DISABLED'
  | 'SUSPENDED'
  | 'LOCKED';

export type AuthLifecycleStatus = 'INITIALIZING' | 'AUTHENTICATED' | 'UNAUTHENTICATED';

export interface AuthUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: UserRole;
  accountStatus: AccountStatus;
  emailVerified: boolean;
}

export interface AuthResponseData {
  accessToken: string;
  expiresIn: number;
  user: AuthUser;
}

export interface AuthResponse {
  success: boolean;
  data: AuthResponseData;
}
