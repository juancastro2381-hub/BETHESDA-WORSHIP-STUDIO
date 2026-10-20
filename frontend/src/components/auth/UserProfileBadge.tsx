/**
 * @file UserProfileBadge.tsx
 * @description Indicador de sesión de usuario, distintivo de rol RBAC y selector de login/logout (Fase 2B).
 */

import React, { useState } from 'react';
import { useAuth } from '../../core/auth/use-auth.ts';
import { LoginModal } from './LoginModal.tsx';
import { UserManagementModal } from '../admin/UserManagementModal.tsx';
import type { UserRole } from '../../core/auth/types.ts';

const ROLE_LABELS: Record<UserRole, string> = {
  SUPER_ADMIN: 'Super Administrador',
  ADMIN: 'Administrador',
  WORSHIP_LEADER: 'Líder de Alabanza',
  MUSICIAN: 'Músico',
  VIEWER: 'Lector / Espectador',
};

const ROLE_COLORS: Record<UserRole, string> = {
  SUPER_ADMIN: '#ec4899', // Rosa vibrante
  ADMIN: '#8b5cf6', // Púrpura
  WORSHIP_LEADER: '#3b82f6', // Azul
  MUSICIAN: '#10b981', // Verde esmeralda
  VIEWER: '#64748b', // Gris pizarra
};

export const UserProfileBadge: React.FC = () => {
  const { user, isAuthenticated, isLoading, logout, canManageUsers } = useAuth();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isUserMgmtOpen, setIsUserMgmtOpen] = useState(false);

  if (isLoading) {
    return (
      <div className="user-profile-badge loading" title="Verificando sesión...">
        <span className="auth-spinner" />
      </div>
    );
  }

  if (!isAuthenticated || !user) {
    return (
      <>
        <div className="user-profile-badge unauthenticated">
          <button
            type="button"
            className="auth-login-button"
            onClick={() => setIsModalOpen(true)}
            id="open-login-modal-button"
          >
            <span aria-hidden="true">👤</span> Iniciar Sesión
          </button>
        </div>
        <LoginModal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} />
      </>
    );
  }

  const roleColor = ROLE_COLORS[user.role] || '#64748b';
  const roleLabel = ROLE_LABELS[user.role] || user.role;

  return (
    <>
      <div className="user-profile-badge authenticated" id="user-profile-badge">
        <div className="user-info">
          <span className="user-name">{user.firstName} {user.lastName}</span>
          <span
            className="user-role-badge"
            style={{ backgroundColor: `${roleColor}22`, color: roleColor, borderColor: roleColor }}
          >
            {roleLabel}
          </span>
        </div>

        {canManageUsers && (
          <button
            type="button"
            className="auth-admin-button"
            onClick={() => setIsUserMgmtOpen(true)}
            title="Administración de integrantes y roles"
            id="open-user-management-button"
          >
            <span aria-hidden="true">👥</span> Integrantes
          </button>
        )}

        <button
          type="button"
          className="auth-logout-button"
          onClick={() => logout()}
          title="Cerrar sesión"
          id="logout-button"
        >
          Salir
        </button>
      </div>

      <LoginModal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} />
      {canManageUsers && (
        <UserManagementModal
          isOpen={isUserMgmtOpen}
          onClose={() => setIsUserMgmtOpen(false)}
        />
      )}
    </>
  );
};
