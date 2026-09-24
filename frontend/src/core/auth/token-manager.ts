/**
 * @file token-manager.ts
 * @description Gestor del Access Token en memoria volátil estricta (closure léxico privado).
 *
 * PROHIBICIÓN ABSOLUTA:
 * - NUNCA almacenar el Access Token en localStorage, sessionStorage o IndexedDB.
 * - En caso de recarga del navegador (F5), el token se recupera a través de la Cookie HttpOnly de refresco.
 */

class MemoryTokenManager {
  // Variables privadas de cierre léxico (en memoria solamente)
  private accessToken: string | null = null;
  private expiresAt: number | null = null;
  private refreshTimer: any = null;

  /**
   * Almacena el token de acceso recibido en memoria volátil.
   * @param token Cadena JWT HS256
   * @param expiresInSeconds Vigencia en segundos (ej. 900 para 15m)
   */
  public setToken(token: string, expiresInSeconds: number): void {
    this.accessToken = token;
    this.expiresAt = Date.now() + expiresInSeconds * 1000;
  }

  /**
   * Obtiene el token de acceso actual en memoria si no ha expirado.
   */
  public getToken(): string | null {
    if (!this.accessToken || !this.expiresAt) {
      return null;
    }

    // Si ya expiró en memoria, limpiarlo
    if (Date.now() >= this.expiresAt) {
      this.clearToken();
      return null;
    }

    return this.accessToken;
  }

  /**
   * Limpia el token y cancela cualquier temporizador activo de renovación silenciosa.
   */
  public clearToken(): void {
    this.accessToken = null;
    this.expiresAt = null;
    this.cancelSilentRefresh();
  }

  /**
   * Verifica si hay un token válido y no expirado en memoria.
   */
  public isAuthenticated(): boolean {
    return this.getToken() !== null;
  }

  /**
   * Programa la renovación silenciosa del token 60 segundos antes de su expiración.
   */
  public scheduleSilentRefresh(refreshFn: () => Promise<void>): void {
    this.cancelSilentRefresh();

    if (!this.expiresAt) {
      return;
    }

    const timeUntilExpiryMs = this.expiresAt - Date.now();
    // Programar 60 segundos antes de expirar (o inmediatamente si queda menos)
    const refreshDelayMs = Math.max(5000, timeUntilExpiryMs - 60000);

    this.refreshTimer = setTimeout(async () => {
      try {
        await refreshFn();
      } catch (err) {
        console.warn('⚠️ Fallo en renovación silenciosa de sesión:', err);
      }
    }, refreshDelayMs);
  }

  /**
   * Cancela el temporizador de renovación programada.
   */
  public cancelSilentRefresh(): void {
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }
  }
}

export const tokenManager = new MemoryTokenManager();
