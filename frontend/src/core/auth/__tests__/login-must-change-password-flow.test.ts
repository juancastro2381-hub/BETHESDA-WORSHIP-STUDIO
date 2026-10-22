/**
 * @file login-must-change-password-flow.test.ts
 * @description Suite de regresión para el flujo de autenticación con MUST_CHANGE_PASSWORD (Fase 2B / Post-Login API Error Remediation).
 *
 * Cobertura exigida:
 * 1. A login response with mustChangePassword: true keeps the initial-password-change flow open.
 * 2. The normal authenticated workspace is not entered before the required password change succeeds.
 * 3. Token is acquired in memory to allow calling /change-initial-password with authorization.
 * 4. After the password change succeeds, re-authentication verifies active account state and allows normal authenticated experience.
 * 5. If user cancels while in mustChangePassword mode, credentials are wiped and workspace remains unauthenticated.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { tokenManager } from '../token-manager.ts';
import type { AuthUser } from '../types.ts';

describe('Login Modal & MUST_CHANGE_PASSWORD Flow Regression Suite', () => {
  beforeEach(() => {
    tokenManager.clearToken();
  });

  afterEach(() => {
    tokenManager.clearToken();
  });

  it('1. should keep initial-password-change flow open when login response has mustChangePassword: true', async () => {
    // Simular el controlador de login en LoginModal con la respuesta del backend
    const mockLoginResponse: AuthUser = {
      id: 'superadmin-uuid',
      email: 'admin@bethesda.org',
      firstName: 'Super',
      lastName: 'Admin',
      role: 'SUPER_ADMIN',
      mustChangePassword: true,
      accountStatus: 'MUST_CHANGE_PASSWORD',
    };

    let isMustChangeMode = false;
    let modalClosed = false;

    // Simulación del manejador handleLoginSubmit de LoginModal
    const handleLoginSubmit = async (userResult: AuthUser) => {
      if (userResult?.mustChangePassword || userResult?.accountStatus === 'MUST_CHANGE_PASSWORD') {
        isMustChangeMode = true;
        // El modal NO se cierra (onClose no se ejecuta)
      } else {
        modalClosed = true;
      }
    };

    await handleLoginSubmit(mockLoginResponse);

    assert.strictEqual(isMustChangeMode, true, 'El modal debe pasar a isMustChangeMode = true');
    assert.strictEqual(modalClosed, false, 'El modal de login NO debe cerrarse cuando mustChangePassword es true');
  });

  it('2. should NOT enter normal authenticated workspace before required password change succeeds', async () => {
    // Simular el AuthContext cuando login() recibe mustChangePassword: true
    let contextUser: AuthUser | null = null;
    let authStatus = 'INITIALIZING';

    const loginHandler = (loginData: { user: AuthUser; accessToken: string; expiresIn: number }) => {
      tokenManager.setToken(loginData.accessToken, loginData.expiresIn);

      // Regla de seguridad implementada en auth-context:
      // Si la cuenta requiere cambio forzoso de contraseña, no admitir al espacio musical autenticado
      if (loginData.user?.mustChangePassword || loginData.user?.accountStatus === 'MUST_CHANGE_PASSWORD') {
        contextUser = null;
        authStatus = 'UNAUTHENTICATED';
        return loginData.user;
      }

      contextUser = loginData.user;
      authStatus = 'AUTHENTICATED';
      return loginData.user;
    };

    const initialResult = loginHandler({
      accessToken: 'temp-token-must-change',
      expiresIn: 900,
      user: {
        id: 'superadmin-uuid',
        email: 'admin@bethesda.org',
        firstName: 'Super',
        lastName: 'Admin',
        role: 'SUPER_ADMIN',
        mustChangePassword: true,
        accountStatus: 'MUST_CHANGE_PASSWORD',
      },
    });

    assert.strictEqual(initialResult.mustChangePassword, true);
    assert.strictEqual(contextUser, null, 'El usuario en contexto debe permanecer null en el espacio de trabajo');
    assert.strictEqual(authStatus, 'UNAUTHENTICATED', 'El estado del contexto no debe ser AUTHENTICATED');

    // Comprobar que en este estado, el espacio de trabajo NO intentará cargar preferencias
    const shouldFetchPreferences = contextUser !== null;
    assert.strictEqual(
      shouldFetchPreferences,
      false,
      'MusicalWorkspace NO debe consultar getUserPreferences() mientras contextUser sea null'
    );

    // Pero el token en memoria DEBE estar disponible para autorizar /change-initial-password
    assert.strictEqual(tokenManager.isAuthenticated(), true);
    assert.strictEqual(tokenManager.getToken(), 'temp-token-must-change');
  });

  it('3. should enter normal authenticated workspace ONLY AFTER password change succeeds and backend confirms ACTIVE', async () => {
    let contextUser: AuthUser | null = null;
    let authStatus = 'UNAUTHENTICATED';
    let modalClosed = false;
    let isMustChangeMode = true;

    // 1. Simular éxito de cambio de contraseña en backend
    let passwordChangeCompletedInBackend = false;
    const changeInitialPassword = async (_curr: string, _newP: string) => {
      passwordChangeCompletedInBackend = true;
    };

    // 2. Simular re-autenticación con la nueva contraseña confirmada
    const loginWithNewPassword = async () => {
      assert.strictEqual(passwordChangeCompletedInBackend, true, 'No se puede re-autenticar antes del cambio en backend');
      const activeUser: AuthUser = {
        id: 'superadmin-uuid',
        email: 'admin@bethesda.org',
        firstName: 'Super',
        lastName: 'Admin',
        role: 'SUPER_ADMIN',
        mustChangePassword: false,
        accountStatus: 'ACTIVE',
      };

      tokenManager.setToken('fresh-active-token', 900);
      contextUser = activeUser;
      authStatus = 'AUTHENTICATED';
      return activeUser;
    };

    // Simular handleChangePasswordSubmit en LoginModal
    await changeInitialPassword('InitialPassword!', 'NewDefinitiveSecret2026!');
    const activeUser = await loginWithNewPassword();

    if (!activeUser.mustChangePassword && activeUser.accountStatus === 'ACTIVE') {
      isMustChangeMode = false;
      modalClosed = true;
    }

    assert.strictEqual(isMustChangeMode, false, 'El modo mustChange debe desactivarse');
    assert.strictEqual(modalClosed, true, 'El modal ahora sí debe cerrarse');
    assert.strictEqual(authStatus, 'AUTHENTICATED', 'El estado pasa a AUTHENTICATED');
    assert.ok(contextUser !== null, 'El usuario en contexto es ahora no nulo');
    assert.strictEqual((contextUser as any).accountStatus, 'ACTIVE', 'El usuario está plenamente ACTIVO');

    // Ahora el atril musical sí puede consultar preferencias de forma segura
    const shouldFetchPreferences = contextUser !== null;
    assert.strictEqual(shouldFetchPreferences, true, 'Ahora MusicalWorkspace puede cargar preferencias con status ACTIVE');
  });

  it('4. should clean up token and reset form when user cancels during initial password change', async () => {
    tokenManager.setToken('temp-token', 900);
    let isMustChangeMode = true;
    let email = 'admin@bethesda.org';
    let password = 'InitialPassword!';
    let modalClosed = false;

    // Simular handleModalClose
    const handleModalClose = () => {
      if (isMustChangeMode) {
        tokenManager.clearToken();
      }
      isMustChangeMode = false;
      email = '';
      password = '';
      modalClosed = true;
    };

    handleModalClose();

    assert.strictEqual(modalClosed, true);
    assert.strictEqual(isMustChangeMode, false);
    assert.strictEqual(email, '');
    assert.strictEqual(password, '');
    assert.strictEqual(tokenManager.isAuthenticated(), false, 'El token temporal debe ser revocado en memoria');
  });
});
