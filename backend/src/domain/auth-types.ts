/**
 * @file auth-types.ts
 * @description Tipos, interfaces y constantes del dominio de autenticación, RBAC y auditoría (Fase 2B).
 */

export const UserRoleEnum = [
  'SUPER_ADMIN',
  'ADMIN',
  'WORSHIP_LEADER',
  'MUSICIAN',
  'VIEWER',
] as const;

export type UserRole = (typeof UserRoleEnum)[number];

export type AccountStatus =
  | 'PENDING_INVITATION'
  | 'MUST_CHANGE_PASSWORD'
  | 'ACTIVE'
  | 'LOCKED'
  | 'SUSPENDED';

export type Permission =
  | 'songs:read'
  | 'songs:create'
  | 'songs:update_draft'
  | 'songs:approve'
  | 'songs:archive'
  | 'songs:delete'
  | 'users:list'
  | 'users:invite'
  | 'users:change_role'
  | 'users:disable'
  | 'audit:read'
  | 'setlists:list'
  | 'setlists:read'
  | 'setlists:create'
  | 'setlists:update'
  | 'setlists:reorder'
  | 'setlists:activate'
  | 'setlists:delete';

export const ROLE_PERMISSIONS: Record<UserRole, Permission[]> = {
  SUPER_ADMIN: [
    'songs:read',
    'songs:create',
    'songs:update_draft',
    'songs:approve',
    'songs:archive',
    'songs:delete',
    'users:list',
    'users:invite',
    'users:change_role',
    'users:disable',
    'audit:read',
    'setlists:list',
    'setlists:read',
    'setlists:create',
    'setlists:update',
    'setlists:reorder',
    'setlists:activate',
    'setlists:delete',
  ],
  ADMIN: [
    'songs:read',
    'songs:create',
    'songs:update_draft',
    'songs:approve',
    'songs:archive',
    'users:list',
    'users:invite',
    'users:change_role',
    'users:disable',
    'audit:read',
    'setlists:list',
    'setlists:read',
    'setlists:create',
    'setlists:update',
    'setlists:reorder',
    'setlists:activate',
    'setlists:delete',
  ],
  WORSHIP_LEADER: [
    'songs:read',
    'songs:create',
    'songs:update_draft',
    'users:list',
    'setlists:list',
    'setlists:read',
    'setlists:create',
    'setlists:update',
    'setlists:reorder',
    'setlists:activate',
  ],
  MUSICIAN: [
    'songs:read',
    'songs:update_draft',
    'setlists:list',
    'setlists:read',
  ],
  VIEWER: [
    'songs:read',
    'setlists:list',
    'setlists:read',
  ],
};


export interface UserEntity {
  id: string;
  email: string;
  passwordHash: string;
  firstName: string;
  lastName: string;
  role: UserRole;
  accountStatus: AccountStatus;
  emailVerified: boolean;
  mfaEnabled: boolean;
  failedLoginAttempts: number;
  lockoutUntil: Date | null;
  lastLoginAt: Date | null;
  tokenVersion: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface RefreshTokenEntity {
  id: string;
  userId: string;
  tokenHash: string;
  familyId: string;
  isRevoked: boolean;
  expiresAt: Date;
  userAgent: string | null;
  ipAddress: string | null;
  createdAt: Date;
  lastUsedAt: Date | null;
}

export interface PasswordResetTokenEntity {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  isUsed: boolean;
  ipAddress: string | null;
  createdAt: Date;
}

export interface UserInvitationEntity {
  id: string;
  email: string;
  tokenHash: string;
  role: UserRole;
  invitedByUserId: string;
  expiresAt: Date;
  isAccepted: boolean;
  createdAt: Date;
}

export type SecurityEventType =
  | 'USER_INVITED'
  | 'INVITATION_COMPLETED'
  | 'LOGIN_SUCCESS'
  | 'LOGIN_FAILURE'
  | 'LOGOUT'
  | 'PASSWORD_RESET_REQUESTED'
  | 'PASSWORD_RESET_COMPLETED'
  | 'PASSWORD_CHANGED'
  | 'ROLE_CHANGED'
  | 'USER_DISABLED'
  | 'ACCOUNT_LOCKED'
  | 'SONG_APPROVED'
  | 'SONG_ARCHIVED'
  | 'SONG_DELETED'
  | 'SUSPICIOUS_TOKEN_REUSE'
  | 'UNAUTHORIZED_ACCESS_ATTEMPT'
  | 'SETLIST_CREATED'
  | 'SETLIST_ACTIVATED'
  | 'SETLIST_DELETED';

export interface AuditLogEntity {
  id: string;
  eventType: SecurityEventType | string;
  userId: string | null;
  resource: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  metadata: Record<string, unknown>;
  createdAt: Date;
}

export interface JwtTokenPayload {
  sub: string;
  email: string;
  role: UserRole;
  jti: string;
  iat?: number;
  exp?: number;
}

export type JwtPayload = JwtTokenPayload;

