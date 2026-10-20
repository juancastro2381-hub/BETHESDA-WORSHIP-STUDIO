/**
 * @file UserManagementModal.tsx
 * @description Interfaz de administración segura de usuarios, asignación de roles RBAC e invitaciones (Fases 2B y C).
 *
 * Responsabilidades:
 * - Listar usuarios con paginación, búsqueda por texto y filtros por rol y estado de cuenta.
 * - Invitar nuevos usuarios con derivación de lista permitida de roles según el rol del operador.
 * - Reenviar invitaciones con invalidación criptográfica del token previo.
 * - Advertir con transparencia técnica cuando el servicio SMTP no está configurado (enlace de activación manual).
 * - Modificar roles y suspender/reactivar cuentas respetando la jerarquía RBAC y Anti-IDOR.
 * - Proteger al último Super Administrador activo de ser deshabilitado o despojado de su rol.
 * - Proveer accesibilidad WCAG 2.1 AA (role="dialog", aria-modal, foco, Escape multinivel).
 */

import React, { useState, useEffect, useCallback, useId } from 'react';
import { BethesdaApiClient, type FrontendUserEntity } from '../../core/api/api-client.ts';
import { useAuth } from '../../core/auth/use-auth.ts';
import type { UserRole, AccountStatus } from '../../core/auth/types.ts';

const ROLE_LABELS: Record<UserRole, string> = {
  SUPER_ADMIN: 'Super Administrador',
  ADMIN: 'Administrador',
  WORSHIP_LEADER: 'Líder de Alabanza',
  MUSICIAN: 'Músico',
  VIEWER: 'Lector / Espectador',
};

const ROLE_COLORS: Record<UserRole, string> = {
  SUPER_ADMIN: '#ec4899', // Rosa
  ADMIN: '#8b5cf6', // Púrpura
  WORSHIP_LEADER: '#3b82f6', // Azul
  MUSICIAN: '#10b981', // Verde
  VIEWER: '#64748b', // Gris
};

const STATUS_LABELS: Record<AccountStatus, string> = {
  ACTIVE: 'Activo',
  PENDING_INVITATION: 'Invitación Pendiente',
  MUST_CHANGE_PASSWORD: 'Debe Cambiar Clave',
  SUSPENDED: 'Suspendido',
  LOCKED: 'Bloqueado Temporalmente',
  DISABLED: 'Deshabilitado',
};

const STATUS_COLORS: Record<AccountStatus, { bg: string; text: string; border: string }> = {
  ACTIVE: { bg: 'rgba(16, 185, 129, 0.15)', text: '#34d399', border: 'rgba(16, 185, 129, 0.4)' },
  PENDING_INVITATION: { bg: 'rgba(245, 158, 11, 0.15)', text: '#fbbf24', border: 'rgba(245, 158, 11, 0.4)' },
  MUST_CHANGE_PASSWORD: { bg: 'rgba(56, 189, 248, 0.15)', text: '#38bdf8', border: 'rgba(56, 189, 248, 0.4)' },
  SUSPENDED: { bg: 'rgba(239, 68, 68, 0.15)', text: '#f87171', border: 'rgba(239, 68, 68, 0.4)' },
  LOCKED: { bg: 'rgba(225, 29, 72, 0.15)', text: '#fb7185', border: 'rgba(225, 29, 72, 0.4)' },
  DISABLED: { bg: 'rgba(100, 116, 139, 0.15)', text: '#94a3b8', border: 'rgba(100, 116, 139, 0.4)' },
};

export interface UserManagementModalProps {
  isOpen: boolean;
  onClose: () => void;
  apiClient?: BethesdaApiClient;
}

export const UserManagementModal: React.FC<UserManagementModalProps> = ({
  isOpen,
  onClose,
  apiClient,
}) => {
  const client = apiClient ?? BethesdaApiClient.getInstance();
  const { user: currentUser } = useAuth();
  const titleId = useId();

  // Estados de datos y listado
  const [users, setUsers] = useState<FrontendUserEntity[]>([]);
  const [totalUsers, setTotalUsers] = useState<number>(0);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Filtros
  const [search, setSearch] = useState<string>('');
  const [roleFilter, setRoleFilter] = useState<string>('ALL');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');

  // Formulario de invitación
  const [showInviteForm, setShowInviteForm] = useState<boolean>(false);
  const [inviteEmail, setInviteEmail] = useState<string>('');
  const [inviteFirstName, setInviteFirstName] = useState<string>('');
  const [inviteLastName, setInviteLastName] = useState<string>('');
  const [inviteRole, setInviteRole] = useState<UserRole>('MUSICIAN');
  const [inviting, setInviting] = useState<boolean>(false);

  // Entrega administrativa manual (fallback cuando SMTP no está configurado)
  const [generatedInviteLink, setGeneratedInviteLink] = useState<string | null>(null);
  const [copiedLink, setCopiedLink] = useState<boolean>(false);

  // Operaciones sensibles y confirmaciones
  const [actionInProgressId, setActionInProgressId] = useState<string | null>(null);
  const [userToModifyRole, setUserToModifyRole] = useState<FrontendUserEntity | null>(null);
  const [newSelectedRole, setNewSelectedRole] = useState<UserRole>('MUSICIAN');
  const [userToToggleStatus, setUserToToggleStatus] = useState<FrontendUserEntity | null>(null);
  const [statusActionType, setStatusActionType] = useState<'SUSPEND' | 'ENABLE'>('SUSPEND');

  // Carga de usuarios desde el backend
  const fetchUsers = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await client.listUsers({
        limit: 100,
        search: search.trim() ? search.trim() : undefined,
        role: roleFilter !== 'ALL' ? (roleFilter as UserRole) : undefined,
        status: statusFilter !== 'ALL' ? (statusFilter as AccountStatus) : undefined,
      });
      setUsers(result.items);
      setTotalUsers(result.total);
    } catch (err: any) {
      setError(err?.message || 'Error al conectar con el servidor para consultar usuarios.');
    } finally {
      setLoading(false);
    }
  }, [client, search, roleFilter, statusFilter]);

  useEffect(() => {
    if (isOpen) {
      fetchUsers();
    }
  }, [isOpen, fetchUsers]);

  // Manejo de tecla Escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (userToModifyRole || userToToggleStatus) {
          setUserToModifyRole(null);
          setUserToToggleStatus(null);
        } else if (showInviteForm) {
          setShowInviteForm(false);
        } else {
          onClose();
        }
      }
    };
    if (isOpen) {
      window.addEventListener('keydown', handleKeyDown);
    }
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose, userToModifyRole, userToToggleStatus, showInviteForm]);

  if (!isOpen) return null;

  // Derivar roles permitidos para asignar según el rol del operador
  const isSuperAdmin = currentUser?.role === 'SUPER_ADMIN';
  const allowedRolesForInvite: UserRole[] = isSuperAdmin
    ? ['SUPER_ADMIN', 'ADMIN', 'WORSHIP_LEADER', 'MUSICIAN', 'VIEWER']
    : ['ADMIN', 'WORSHIP_LEADER', 'MUSICIAN', 'VIEWER']; // Los ADMIN no pueden crear SUPER_ADMIN

  // Enviar invitación
  const handleInviteSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccessMessage(null);
    setGeneratedInviteLink(null);
    setInviting(true);

    try {
      const result = await client.inviteUser({
        email: inviteEmail.trim(),
        firstName: inviteFirstName.trim(),
        lastName: inviteLastName.trim(),
        role: inviteRole,
      });

      setSuccessMessage(`Invitación generada exitosamente para ${result.email}.`);
      setInviteEmail('');
      setInviteFirstName('');
      setInviteLastName('');
      setShowInviteForm(false);

      // Si el servicio SMTP no está configurado, proveer el enlace administrativo seguro
      if (result.deliveryStatus === 'UNCONFIGURED_MOCK' && result.invitationToken) {
        const origin = typeof window !== 'undefined' ? window.location.origin : '';
        const link = `${origin}/accept-invite?token=${encodeURIComponent(result.invitationToken)}`;
        setGeneratedInviteLink(link);
      }

      await fetchUsers();
    } catch (err: any) {
      setError(err?.message || 'Error al emitir la invitación.');
    } finally {
      setInviting(false);
    }
  };

  // Reenviar invitación existente
  const handleResendInvite = async (user: FrontendUserEntity) => {
    setError(null);
    setSuccessMessage(null);
    setGeneratedInviteLink(null);
    setActionInProgressId(user.id);

    try {
      const result = await client.resendInvitation(user.id);
      setSuccessMessage(`Nueva invitación y token generados para ${user.email}.`);

      if (result.deliveryStatus === 'UNCONFIGURED_MOCK' && result.invitationToken) {
        const origin = typeof window !== 'undefined' ? window.location.origin : '';
        const link = `${origin}/accept-invite?token=${encodeURIComponent(result.invitationToken)}`;
        setGeneratedInviteLink(link);
      }

      await fetchUsers();
    } catch (err: any) {
      setError(err?.message || 'Error al reenviar la invitación.');
    } finally {
      setActionInProgressId(null);
    }
  };

  // Confirmar cambio de rol
  const handleConfirmRoleChange = async () => {
    if (!userToModifyRole) return;
    setError(null);
    setSuccessMessage(null);
    setActionInProgressId(userToModifyRole.id);

    try {
      await client.changeUserRole(userToModifyRole.id, newSelectedRole);
      setSuccessMessage(
        `Rol de ${userToModifyRole.firstName} ${userToModifyRole.lastName} actualizado a ${ROLE_LABELS[newSelectedRole]}.`
      );
      setUserToModifyRole(null);
      await fetchUsers();
    } catch (err: any) {
      setError(err?.message || 'Error al actualizar el rol del usuario.');
    } finally {
      setActionInProgressId(null);
    }
  };

  // Confirmar suspensión o reactivación
  const handleConfirmStatusToggle = async () => {
    if (!userToToggleStatus) return;
    setError(null);
    setSuccessMessage(null);
    setActionInProgressId(userToToggleStatus.id);

    try {
      if (statusActionType === 'SUSPEND') {
        await client.disableUser(userToToggleStatus.id);
        setSuccessMessage(`La cuenta de ${userToToggleStatus.email} ha sido suspendida exitosamente.`);
      } else {
        await client.enableUser(userToToggleStatus.id);
        setSuccessMessage(`La cuenta de ${userToToggleStatus.email} ha sido reactivada exitosamente.`);
      }
      setUserToToggleStatus(null);
      await fetchUsers();
    } catch (err: any) {
      setError(err?.message || 'Error al modificar el estado de la cuenta.');
    } finally {
      setActionInProgressId(null);
    }
  };

  // Copiar enlace de activación
  const handleCopyInviteLink = () => {
    if (generatedInviteLink && typeof navigator !== 'undefined') {
      navigator.clipboard.writeText(generatedInviteLink);
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2500);
    }
  };

  return (
    <div
      className="modal-backdrop user-mgmt-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
    >
      <div className="modal-content user-mgmt-modal-container">
        {/* Cabecera Principal */}
        <div className="modal-header user-mgmt-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <img
              src="/worship_studio_saxophone_emblem.png"
              alt="Worship Studio"
              className="brand-emblem-img"
              width={34}
              height={34}
              style={{ height: '34px', width: 'auto' }}
            />
            <div>
              <h2 id={titleId} className="modal-title" style={{ fontSize: '1.2rem', margin: 0 }}>
                Administración de Usuarios y Ministerio
              </h2>
              <span style={{ fontSize: '0.8rem', color: '#94a3b8' }}>
                Control de acceso RBAC, gestión de integrantes y credenciales
              </span>
            </div>
          </div>
          <button
            type="button"
            className="modal-close-button"
            onClick={onClose}
            aria-label="Cerrar modal de administración de usuarios"
            id="close-user-mgmt-button"
          >
            ✕
          </button>
        </div>

        {/* Banners de Notificación */}
        {error && (
          <div className="auth-error-banner" role="alert" style={{ margin: '0.75rem 1.5rem 0' }}>
            <span aria-hidden="true">⚠️</span>
            <span style={{ flex: 1 }}>{error}</span>
            <button
              type="button"
              onClick={() => setError(null)}
              style={{ background: 'none', border: 'none', color: '#fca5a5', cursor: 'pointer' }}
            >
              ✕
            </button>
          </div>
        )}

        {successMessage && (
          <div
            className="user-mgmt-success-banner"
            role="status"
            style={{ margin: '0.75rem 1.5rem 0' }}
          >
            <span aria-hidden="true">✅</span>
            <span style={{ flex: 1 }}>{successMessage}</span>
            <button
              type="button"
              onClick={() => setSuccessMessage(null)}
              style={{ background: 'none', border: 'none', color: '#86efac', cursor: 'pointer' }}
            >
              ✕
            </button>
          </div>
        )}

        {/* Banner de Enlace Administrativo (SMTP No Configurado - Fallback de Contingencia) */}
        {generatedInviteLink && (
          <div className="user-mgmt-invite-link-banner" style={{ margin: '0.75rem 1.5rem 0' }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.5rem' }}>
              <span aria-hidden="true" style={{ fontSize: '1.1rem' }}>⚠️</span>
              <div style={{ flex: 1 }}>
                <strong style={{ color: '#fde047', display: 'block', marginBottom: '0.25rem' }}>
                  [CONTINGENCIA OPERATIVA / DESARROLLO]: Servidor de correo SMTP no configurado
                </strong>
                <p style={{ margin: '0 0 0.5rem 0', fontSize: '0.82rem', color: '#cbd5e1' }}>
                  El correo no fue despachado automáticamente porque el servidor SMTP no está configurado en este entorno. En producción es obligatorio un proveedor de correo saliente. Como contingencia operativa controlada, entregue este enlace seguro de activación de un solo uso (válido por 72 horas) directamente al integrante:
                </p>
                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                  <input
                    type="text"
                    readOnly
                    value={generatedInviteLink}
                    className="auth-input"
                    style={{ fontSize: '0.8rem', padding: '0.35rem 0.6rem', flex: 1, background: '#0f172a' }}
                    id="generated-invite-url-input"
                  />
                  <button
                    type="button"
                    className="btn-copy-invite-link"
                    onClick={handleCopyInviteLink}
                    id="copy-invite-link-btn"
                  >
                    {copiedLink ? '✓ Copiado' : '📋 Copiar'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Barra de Filtros y Acciones */}
        <div className="user-mgmt-toolbar">
          <div className="user-mgmt-search-box">
            <span aria-hidden="true">🔍</span>
            <input
              type="text"
              placeholder="Buscar por nombre o correo..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="user-mgmt-search-input"
              id="user-search-input"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch('')}
                className="user-mgmt-clear-search"
                title="Limpiar búsqueda"
              >
                ✕
              </button>
            )}
          </div>

          <div className="user-mgmt-filters">
            <select
              value={roleFilter}
              onChange={(e) => setRoleFilter(e.target.value)}
              className="user-mgmt-select"
              id="role-filter-select"
              aria-label="Filtrar por rol"
            >
              <option value="ALL">Todos los roles</option>
              <option value="SUPER_ADMIN">Super Administrador</option>
              <option value="ADMIN">Administrador</option>
              <option value="WORSHIP_LEADER">Líder de Alabanza</option>
              <option value="MUSICIAN">Músico</option>
              <option value="VIEWER">Lector / Espectador</option>
            </select>

            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="user-mgmt-select"
              id="status-filter-select"
              aria-label="Filtrar por estado"
            >
              <option value="ALL">Todos los estados</option>
              <option value="ACTIVE">Activos</option>
              <option value="PENDING_INVITATION">Invitación Pendiente</option>
              <option value="MUST_CHANGE_PASSWORD">Debe Cambiar Clave</option>
              <option value="SUSPENDED">Suspendidos</option>
              <option value="LOCKED">Bloqueados</option>
            </select>

            <button
              type="button"
              className="btn-toggle-invite-form"
              onClick={() => setShowInviteForm(!showInviteForm)}
              id="toggle-invite-form-button"
            >
              {showInviteForm ? '✕ Cancelar' : '➕ Invitar Usuario'}
            </button>
          </div>
        </div>

        {/* Formulario Desplegable de Invitación */}
        {showInviteForm && (
          <div className="user-mgmt-invite-drawer">
            <h3 style={{ fontSize: '1rem', margin: '0 0 1rem 0', color: '#f8fafc' }}>
              Invitar a un Nuevo Integrante al Ministerio
            </h3>
            <form onSubmit={handleInviteSubmit} className="user-mgmt-invite-form">
              <div className="invite-form-grid">
                <div className="form-group">
                  <label htmlFor="invite-email" style={{ fontSize: '0.8rem', color: '#cbd5e1' }}>
                    Correo Electrónico *
                  </label>
                  <input
                    id="invite-email"
                    type="email"
                    required
                    placeholder="usuario@bethesda.co"
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                    className="auth-input"
                    disabled={inviting}
                  />
                </div>

                <div className="form-group">
                  <label htmlFor="invite-firstname" style={{ fontSize: '0.8rem', color: '#cbd5e1' }}>
                    Nombre *
                  </label>
                  <input
                    id="invite-firstname"
                    type="text"
                    required
                    placeholder="Juan"
                    value={inviteFirstName}
                    onChange={(e) => setInviteFirstName(e.target.value)}
                    className="auth-input"
                    disabled={inviting}
                  />
                </div>

                <div className="form-group">
                  <label htmlFor="invite-lastname" style={{ fontSize: '0.8rem', color: '#cbd5e1' }}>
                    Apellido *
                  </label>
                  <input
                    id="invite-lastname"
                    type="text"
                    required
                    placeholder="Castro"
                    value={inviteLastName}
                    onChange={(e) => setInviteLastName(e.target.value)}
                    className="auth-input"
                    disabled={inviting}
                  />
                </div>

                <div className="form-group">
                  <label htmlFor="invite-role" style={{ fontSize: '0.8rem', color: '#cbd5e1' }}>
                    Rol Asignado *
                  </label>
                  <select
                    id="invite-role"
                    value={inviteRole}
                    onChange={(e) => setInviteRole(e.target.value as UserRole)}
                    className="user-mgmt-select"
                    style={{ width: '100%', height: '38px' }}
                    disabled={inviting}
                  >
                    {allowedRolesForInvite.map((role) => (
                      <option key={role} value={role}>
                        {ROLE_LABELS[role]}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginTop: '1rem' }}>
                <button
                  type="button"
                  className="btn-cancel"
                  onClick={() => setShowInviteForm(false)}
                  disabled={inviting}
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="btn-submit-invite"
                  disabled={inviting}
                  id="submit-invite-btn"
                >
                  {inviting ? 'Generando...' : 'Generar Invitación'}
                </button>
              </div>
            </form>
          </div>
        )}

        {/* Tabla de Usuarios */}
        <div className="user-mgmt-table-wrapper">
          {loading ? (
            <div className="user-mgmt-loading-state">
              <span className="auth-spinner" />
              <span>Cargando integrantes del ministerio...</span>
            </div>
          ) : users.length === 0 ? (
            <div className="user-mgmt-empty-state">
              <span style={{ fontSize: '2rem' }}>👥</span>
              <p>No se encontraron integrantes que coincidan con los filtros seleccionados.</p>
            </div>
          ) : (
            <table className="user-mgmt-table" aria-label="Listado de integrantes del ministerio">
              <thead>
                <tr>
                  <th scope="col">Integrante</th>
                  <th scope="col">Rol RBAC</th>
                  <th scope="col">Estado</th>
                  <th scope="col">Fecha Registro</th>
                  <th scope="col" style={{ textAlign: 'right' }}>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {users.map((targetUser) => {
                  const isSelf = targetUser.id === currentUser?.id;
                  const isTargetSuperAdmin = targetUser.role === 'SUPER_ADMIN';
                  const cannotModifyDueToRole = !isSuperAdmin && isTargetSuperAdmin;
                  const isActionPending = actionInProgressId === targetUser.id;

                  const roleColor = ROLE_COLORS[targetUser.role] || '#64748b';
                  const statusStyle = STATUS_COLORS[targetUser.accountStatus] || {
                    bg: 'rgba(100, 116, 139, 0.2)',
                    text: '#94a3b8',
                    border: 'rgba(100, 116, 139, 0.4)',
                  };

                  return (
                    <tr key={targetUser.id} className={isSelf ? 'user-row-self' : ''}>
                      <td>
                        <div style={{ display: 'flex', flexDirection: 'column' }}>
                          <span style={{ fontWeight: 600, color: '#f8fafc' }}>
                            {targetUser.firstName} {targetUser.lastName}
                            {isSelf && (
                              <span className="user-self-pill" title="Tu cuenta actual">
                                (Tú)
                              </span>
                            )}
                          </span>
                          <span style={{ fontSize: '0.8rem', color: '#94a3b8' }}>{targetUser.email}</span>
                        </div>
                      </td>

                      <td>
                        <span
                          className="user-role-badge"
                          style={{
                            backgroundColor: `${roleColor}22`,
                            color: roleColor,
                            borderColor: roleColor,
                          }}
                        >
                          {ROLE_LABELS[targetUser.role] || targetUser.role}
                        </span>
                      </td>

                      <td>
                        <span
                          className="user-status-pill"
                          style={{
                            backgroundColor: statusStyle.bg,
                            color: statusStyle.text,
                            borderColor: statusStyle.border,
                          }}
                        >
                          {STATUS_LABELS[targetUser.accountStatus] || targetUser.accountStatus}
                        </span>
                      </td>

                      <td style={{ fontSize: '0.8rem', color: '#94a3b8' }}>
                        {new Date(targetUser.createdAt).toLocaleDateString()}
                      </td>

                      <td style={{ textAlign: 'right' }}>
                        <div className="user-action-buttons">
                          {/* Reenviar invitación */}
                          {targetUser.accountStatus === 'PENDING_INVITATION' && (
                            <button
                              type="button"
                              className="btn-user-action resend"
                              disabled={isActionPending || cannotModifyDueToRole}
                              onClick={() => handleResendInvite(targetUser)}
                              title={
                                cannotModifyDueToRole
                                  ? 'Solo un Super Administrador puede gestionar a este usuario'
                                  : 'Reenviar invitación (invalida el token previo)'
                              }
                              id={`resend-invite-${targetUser.id}`}
                            >
                              {isActionPending ? '...' : 'Reenviar'}
                            </button>
                          )}

                          {/* Cambiar rol */}
                          <button
                            type="button"
                            className="btn-user-action change-role"
                            disabled={isActionPending || isSelf || cannotModifyDueToRole}
                            onClick={() => {
                              setUserToModifyRole(targetUser);
                              setNewSelectedRole(targetUser.role);
                            }}
                            title={
                              isSelf
                                ? 'No puede modificar su propio rol'
                                : cannotModifyDueToRole
                                ? 'Solo un Super Administrador puede modificar a este usuario'
                                : 'Cambiar rol'
                            }
                            id={`change-role-${targetUser.id}`}
                          >
                            Rol
                          </button>

                          {/* Suspender / Reactivar */}
                          {targetUser.accountStatus === 'ACTIVE' || targetUser.accountStatus === 'MUST_CHANGE_PASSWORD' ? (
                            <button
                              type="button"
                              className="btn-user-action suspend"
                              disabled={isActionPending || isSelf || cannotModifyDueToRole}
                              onClick={() => {
                                setUserToToggleStatus(targetUser);
                                setStatusActionType('SUSPEND');
                              }}
                              title={
                                isSelf
                                  ? 'No puede deshabilitar su propia cuenta'
                                  : cannotModifyDueToRole
                                  ? 'Solo un Super Administrador puede deshabilitar a este usuario'
                                  : 'Suspender cuenta'
                              }
                              id={`suspend-user-${targetUser.id}`}
                            >
                              Suspender
                            </button>
                          ) : (
                            <button
                              type="button"
                              className="btn-user-action reactivate"
                              disabled={isActionPending || isSelf || cannotModifyDueToRole}
                              onClick={() => {
                                setUserToToggleStatus(targetUser);
                                setStatusActionType('ENABLE');
                              }}
                              title="Reactivar cuenta"
                              id={`reactivate-user-${targetUser.id}`}
                            >
                              Reactivar
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* Pie del Modal con Resumen de Registros */}
        <div className="user-mgmt-footer">
          <span style={{ fontSize: '0.8rem', color: '#94a3b8' }}>
            Total de integrantes registrados: <strong>{totalUsers}</strong>
          </span>
          <button
            type="button"
            className="btn-refresh-users"
            onClick={fetchUsers}
            disabled={loading}
            title="Refrescar catálogo"
          >
            🔄 Actualizar
          </button>
        </div>

        {/* Modal Secundario de Cambio de Rol */}
        {userToModifyRole && (
          <div className="submodal-backdrop" role="dialog" aria-modal="true" aria-labelledby="change-role-title">
            <div className="submodal-content">
              <h3 id="change-role-title" style={{ fontSize: '1.05rem', margin: '0 0 0.5rem 0' }}>
                Modificar Rol de {userToModifyRole.firstName} {userToModifyRole.lastName}
              </h3>
              <p style={{ fontSize: '0.82rem', color: '#94a3b8', margin: '0 0 1rem 0' }}>
                El cambio revocará todas las sesiones activas del usuario, forzándolo a iniciar sesión nuevamente con las nuevas atribuciones.
              </p>
              <div className="form-group" style={{ marginBottom: '1.25rem' }}>
                <label htmlFor="select-new-role" style={{ fontSize: '0.8rem', color: '#cbd5e1' }}>
                  Nuevo Rol Asignado:
                </label>
                <select
                  id="select-new-role"
                  value={newSelectedRole}
                  onChange={(e) => setNewSelectedRole(e.target.value as UserRole)}
                  className="user-mgmt-select"
                  style={{ width: '100%', marginTop: '0.25rem' }}
                >
                  {allowedRolesForInvite.map((role) => (
                    <option key={role} value={role}>
                      {ROLE_LABELS[role]}
                    </option>
                  ))}
                </select>
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
                <button
                  type="button"
                  className="btn-cancel"
                  onClick={() => setUserToModifyRole(null)}
                  disabled={actionInProgressId !== null}
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  className="btn-confirm-action"
                  onClick={handleConfirmRoleChange}
                  disabled={actionInProgressId !== null || newSelectedRole === userToModifyRole.role}
                  id="confirm-role-change-btn"
                >
                  {actionInProgressId ? 'Aplicando...' : 'Confirmar Cambio de Rol'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Modal Secundario de Confirmación de Suspensión / Reactivación */}
        {userToToggleStatus && (
          <div className="submodal-backdrop" role="dialog" aria-modal="true" aria-labelledby="status-toggle-title">
            <div className="submodal-content">
              <h3 id="status-toggle-title" style={{ fontSize: '1.05rem', margin: '0 0 0.5rem 0' }}>
                {statusActionType === 'SUSPEND' ? 'Confirmar Suspensión de Cuenta' : 'Confirmar Reactivación de Cuenta'}
              </h3>
              <p style={{ fontSize: '0.85rem', color: '#cbd5e1', margin: '0 0 1.25rem 0', lineHeight: 1.5 }}>
                {statusActionType === 'SUSPEND' ? (
                  <>
                    ¿Está seguro de que desea suspender la cuenta de <strong>{userToToggleStatus.email}</strong>?
                    El usuario perderá inmediatamente el acceso a las funciones del ministerio y todas sus sesiones activas serán revocadas.
                  </>
                ) : (
                  <>
                    ¿Desea restaurar el estado activo para la cuenta de <strong>{userToToggleStatus.email}</strong>?
                    El usuario podrá iniciar sesión normalmente con sus credenciales establecidas.
                  </>
                )}
              </p>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
                <button
                  type="button"
                  className="btn-cancel"
                  onClick={() => setUserToToggleStatus(null)}
                  disabled={actionInProgressId !== null}
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  className={`btn-confirm-action ${statusActionType === 'SUSPEND' ? 'danger' : 'success'}`}
                  onClick={handleConfirmStatusToggle}
                  disabled={actionInProgressId !== null}
                  id="confirm-status-toggle-btn"
                >
                  {actionInProgressId
                    ? 'Procesando...'
                    : statusActionType === 'SUSPEND'
                    ? 'Sí, Suspender Cuenta'
                    : 'Sí, Reactivar Cuenta'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
