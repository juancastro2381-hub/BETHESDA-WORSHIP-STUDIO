/**
 * @file realtime-client.ts
 * @description Cliente para la sincronización litúrgica en tiempo real mediante Server-Sent Events (SSE) y REST.
 */

import type {
  RealtimeAction,
  RealtimeConnectionState,
  RealtimeEvent,
  RealtimeSessionSnapshot,
} from './realtime-types.ts';

export interface RealtimeClientCallbacks {
  onConnectionChange?: (state: RealtimeConnectionState) => void;
  onSnapshot?: (snapshot: RealtimeSessionSnapshot) => void;
  onStateChange?: (event: RealtimeEvent) => void;
  onError?: (error: Error) => void;
  onConcluded?: () => void;
}

export class RealtimeClient {
  private eventSource: EventSource | null = null;
  private connectionState: RealtimeConnectionState = 'DISCONNECTED';
  private currentSessionId: string | null = null;
  private currentToken: string | null = null;
  private reconnectTimer: any = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private baseReconnectDelayMs = 1500;
  private callbacks: RealtimeClientCallbacks = {};
  public readonly baseUrl: string;

  constructor(baseUrl = 'http://localhost:3000', callbacks: RealtimeClientCallbacks = {}) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.callbacks = callbacks;
  }

  public getConnectionState(): RealtimeConnectionState {
    return this.connectionState;
  }

  public setCallbacks(callbacks: RealtimeClientCallbacks): void {
    this.callbacks = { ...this.callbacks, ...callbacks };
  }

  private setConnectionState(state: RealtimeConnectionState): void {
    this.connectionState = state;
    this.callbacks.onConnectionChange?.(state);
  }

  /**
   * Conecta el atril a la transmisión en tiempo real de una sesión litúrgica.
   */
  public connect(sessionId: string, token: string): void {
    this.disconnect();

    this.currentSessionId = sessionId;
    this.currentToken = token;
    this.setConnectionState('CONNECTING');

    if (typeof EventSource === 'undefined') {
      // Entorno de test o navegador sin EventSource nativo
      this.setConnectionState('CONNECTED');
      return;
    }

    try {
      const streamUrl = `${this.baseUrl}/api/v1/realtime/sessions/${sessionId}/stream?token=${encodeURIComponent(token)}`;
      this.eventSource = new EventSource(streamUrl);

      this.eventSource.onopen = () => {
        this.reconnectAttempts = 0;
        this.setConnectionState('CONNECTED');
      };

      this.eventSource.addEventListener('snapshot', (e: MessageEvent) => {
        try {
          const snapshot: RealtimeSessionSnapshot = JSON.parse(e.data);
          this.callbacks.onSnapshot?.(snapshot);
        } catch (err) {
          this.callbacks.onError?.(err as Error);
        }
      });

      this.eventSource.addEventListener('STATE_CHANGED', (e: MessageEvent) => {
        try {
          const event: RealtimeEvent = JSON.parse(e.data);
          this.callbacks.onStateChange?.(event);
        } catch (err) {
          this.callbacks.onError?.(err as Error);
        }
      });

      this.eventSource.addEventListener('SESSION_CONCLUDED', () => {
        this.callbacks.onConcluded?.();
        this.disconnect();
      });

      this.eventSource.onerror = () => {
        this.handleDisconnectAndRetry();
      };
    } catch (err) {
      this.callbacks.onError?.(err as Error);
      this.handleDisconnectAndRetry();
    }
  }

  private handleDisconnectAndRetry(): void {
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }

    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts += 1;
      this.setConnectionState('RECONNECTING');

      const delay = this.baseReconnectDelayMs * Math.pow(1.5, this.reconnectAttempts - 1);
      this.reconnectTimer = setTimeout(() => {
        if (this.currentSessionId && this.currentToken) {
          this.connect(this.currentSessionId, this.currentToken);
        }
      }, delay);
    } else {
      this.setConnectionState('ERROR');
      this.callbacks.onError?.(new Error('Conexión litúrgica en tiempo real perdida. Intentos agotados.'));
    }
  }

  /**
   * Cierra la conexión SSE activa.
   */
  public disconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }

    this.currentSessionId = null;
    this.currentToken = null;
    this.reconnectAttempts = 0;
    this.setConnectionState('DISCONNECTED');
  }

  /**
   * Despacha un comando litúrgico autenticado (cambio de índice, sección, tono, tempo).
   */
  public async dispatchAction(
    sessionId: string,
    token: string,
    action: RealtimeAction
  ): Promise<{ success: boolean; sequence: number; state: RealtimeSessionSnapshot }> {
    const res = await fetch(`${this.baseUrl}/api/v1/realtime/sessions/${sessionId}/actions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(action),
    });

    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}));
      throw new Error(errBody.error?.message || `Error ${res.status} al despachar acción litúrgica.`);
    }

    const json = await res.json();
    return json.data;
  }

  /**
   * Crea o recupera una sesión en vivo para un setlist.
   */
  public async createOrGetSession(
    setlistId: string,
    token: string,
    initialItemIndex = 0
  ): Promise<RealtimeSessionSnapshot> {
    const res = await fetch(`${this.baseUrl}/api/v1/realtime/sessions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ setlistId, initialItemIndex }),
    });

    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}));
      throw new Error(errBody.error?.message || `Error al crear sesión en vivo.`);
    }

    const json = await res.json();
    return json.data;
  }

  /**
   * Busca si existe una sesión activa para un setlist.
   */
  public async findActiveSession(
    setlistId: string,
    token: string
  ): Promise<RealtimeSessionSnapshot | null> {
    try {
      const res = await fetch(`${this.baseUrl}/api/v1/realtime/sessions/by-setlist/${setlistId}`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (res.status === 404) return null;
      if (!res.ok) return null;

      const json = await res.json();
      return json.data;
    } catch {
      return null;
    }
  }
}
