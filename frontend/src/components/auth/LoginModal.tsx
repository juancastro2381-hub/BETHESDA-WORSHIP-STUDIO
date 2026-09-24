/**
 * @file LoginModal.tsx
 * @description Modal de autenticación de Bethesda Worship Studio con soporte para MUST_CHANGE_PASSWORD (Fase 2B).
 */

import React, { useState } from 'react';
import { useAuth } from '../../core/auth/use-auth.ts';

interface LoginModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const LoginModal: React.FC<LoginModalProps> = ({ isOpen, onClose }) => {
  const { login, changeInitialPassword } = useAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isMustChangeMode, setIsMustChangeMode] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (!isOpen) return null;

  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setIsSubmitting(true);

    try {
      await login(email, password);
      // Limpiar formulario y cerrar
      setPassword('');
      onClose();
    } catch (err: any) {
      if (err.message && err.message.includes('MUST_CHANGE_PASSWORD')) {
        setIsMustChangeMode(true);
      } else {
        setErrorMessage(err.message || 'Error al iniciar sesión. Verifique sus credenciales.');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleChangePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    if (newPassword !== confirmPassword) {
      setErrorMessage('Las contraseñas no coinciden.');
      return;
    }

    if (newPassword.length < 10) {
      setErrorMessage('La nueva contraseña debe tener al menos 10 caracteres.');
      return;
    }

    setIsSubmitting(true);
    try {
      await changeInitialPassword(password, newPassword);
      setIsMustChangeMode(false);
      setPassword('');
      setNewPassword('');
      setConfirmPassword('');
      onClose();
    } catch (err: any) {
      setErrorMessage(err.message || 'Error al actualizar contraseña inicial.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="auth-modal-title">
      <div className="modal-content auth-modal">
        <div className="modal-header">
          <h2 id="auth-modal-title" className="modal-title">
            {isMustChangeMode ? '🔑 Actualizar Contraseña Inicial' : '🔐 Acceso a Bethesda Worship Studio'}
          </h2>
          <button
            type="button"
            className="modal-close-button"
            onClick={onClose}
            aria-label="Cerrar modal de inicio de sesión"
          >
            ✕
          </button>
        </div>

        {errorMessage && (
          <div className="auth-error-banner" role="alert">
            <span>⚠️</span>
            <span>{errorMessage}</span>
          </div>
        )}

        {!isMustChangeMode ? (
          <form onSubmit={handleLoginSubmit} className="auth-form">
            <div className="form-group">
              <label htmlFor="login-email">Correo Electrónico:</label>
              <input
                id="login-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="ejemplo@bethesda.co"
                required
                autoComplete="email"
                disabled={isSubmitting}
                className="auth-input"
              />
            </div>

            <div className="form-group">
              <label htmlFor="login-password">Contraseña:</label>
              <input
                id="login-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••••••"
                required
                autoComplete="current-password"
                disabled={isSubmitting}
                className="auth-input"
              />
            </div>

            <div className="modal-actions">
              <button
                type="button"
                className="action-button secondary"
                onClick={onClose}
                disabled={isSubmitting}
              >
                Cancelar
              </button>
              <button
                type="submit"
                className="action-button primary"
                disabled={isSubmitting}
              >
                {isSubmitting ? 'Iniciando sesión...' : 'Iniciar Sesión'}
              </button>
            </div>
          </form>
        ) : (
          <form onSubmit={handleChangePasswordSubmit} className="auth-form">
            <p className="auth-hint">
              Por motivos de seguridad, debe definir una contraseña personal definitiva antes de continuar.
            </p>

            <div className="form-group">
              <label htmlFor="change-new-password">Nueva Contraseña (mínimo 10 caracteres):</label>
              <input
                id="change-new-password"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Nueva contraseña robusta"
                required
                disabled={isSubmitting}
                className="auth-input"
              />
            </div>

            <div className="form-group">
              <label htmlFor="change-confirm-password">Confirmar Nueva Contraseña:</label>
              <input
                id="change-confirm-password"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Repita la nueva contraseña"
                required
                disabled={isSubmitting}
                className="auth-input"
              />
            </div>

            <div className="modal-actions">
              <button
                type="submit"
                className="action-button primary"
                disabled={isSubmitting}
              >
                {isSubmitting ? 'Guardando...' : 'Establecer Contraseña'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};
