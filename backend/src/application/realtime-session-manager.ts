/**
 * @file realtime-session-manager.ts
 * @description Gestor de sesiones litúrgicas en tiempo real en memoria (Fase 3B).
 *
 * Administra el estado volátil del atril en vivo:
 * - Secuencia monotónica de eventos (epoch + sequence) para ordenamiento determinista.
 * - Idempotencia ante retransmisiones duplicadas (LRU de actionIds).
 * - Detección y rechazo de eventos desactualizados / fuera de secuencia (ConflictError 409).
 * - Control de acceso server-side: solo el director o administradores pueden mutar el estado.
 * - Aislamiento estricto: los cambios en vivo NUNCA mutan las tablas canónicas en PostgreSQL.
 * - Soporte de SSE (Server-Sent Events) para difusión en tiempo real a atriles clientes.
 */

import crypto from 'node:crypto';
import type {
  RealtimeAction,
  RealtimeEvent,
  RealtimeSessionSnapshot,
  RealtimeSessionStatus,
  ParticipantState,
} from '../domain/realtime/realtime-types.ts';
import {
  ForbiddenError,
  NotFoundError,
  ConflictError,
  ValidationError,
} from '../domain/errors.ts';

const MAX_ACTION_HISTORY = 300;
const SESSION_INACTIVITY_TIMEOUT_MS = 60 * 60 * 1000; // 1 hora
const PARTICIPANT_TIMEOUT_MS = 90 * 1000; // 90 segundos

export class ManagedRealtimeSession {
  public sessionId: string;
  public setlistId: string;
  public setlistTitle: string;
  public hostUserId: string;
  public status: RealtimeSessionStatus;
  public epoch: number;
  public sequence: number;
  public currentItemIndex: number;
  public currentSection: string | null;
  public currentKeyOverride: string | null;
  public currentBpmOverride: number | null;
  public participants: Map<string, ParticipantState>;
  public processedActionIds: Set<string>;
  public actionIdQueue: string[];
  public subscribers: Set<(event: RealtimeEvent) => void>;
  public createdAt: Date;
  public lastActivityAt: Date;

  constructor(
    sessionId: string,
    setlistId: string,
    setlistTitle: string,
    hostUserId: string,
    initialItemIndex = 0
  ) {
    this.sessionId = sessionId;
    this.setlistId = setlistId;
    this.setlistTitle = setlistTitle;
    this.hostUserId = hostUserId;
    this.status = 'ACTIVE';
    this.epoch = 1;
    this.sequence = 1;
    this.currentItemIndex = Math.max(0, initialItemIndex);
    this.currentSection = null;
    this.currentKeyOverride = null;
    this.currentBpmOverride = null;
    this.participants = new Map();
    this.processedActionIds = new Set();
    this.actionIdQueue = [];
    this.subscribers = new Set();
    this.createdAt = new Date();
    this.lastActivityAt = new Date();
  }

  public toSnapshot(): RealtimeSessionSnapshot {
    return {
      sessionId: this.sessionId,
      setlistId: this.setlistId,
      setlistTitle: this.setlistTitle,
      hostUserId: this.hostUserId,
      status: this.status,
      epoch: this.epoch,
      sequence: this.sequence,
      currentItemIndex: this.currentItemIndex,
      currentSection: this.currentSection,
      currentKeyOverride: this.currentKeyOverride,
      currentBpmOverride: this.currentBpmOverride,
      participantsCount: this.participants.size,
      participants: Array.from(this.participants.values()),
      lastActivityAt: this.lastActivityAt.toISOString(),
    };
  }

  public broadcast(event: RealtimeEvent): void {
    for (const subscriber of this.subscribers) {
      try {
        subscriber(event);
      } catch {
        // Ignorar fallas individuales de transporte cliente
      }
    }
  }

  public recordAction(actionId: string): void {
    this.processedActionIds.add(actionId);
    this.actionIdQueue.push(actionId);
    if (this.actionIdQueue.length > MAX_ACTION_HISTORY) {
      const oldest = this.actionIdQueue.shift();
      if (oldest) {
        this.processedActionIds.delete(oldest);
      }
    }
  }
}

export class RealtimeSessionManager {
  private sessions: Map<string, ManagedRealtimeSession>;
  private setlistToSession: Map<string, string>;

  constructor() {
    this.sessions = new Map();
    this.setlistToSession = new Map();
  }

  /**
   * Crea o recupera una sesión en tiempo real para un setlist litúrgico.
   */
  public createOrGetSession(
    setlistId: string,
    setlistTitle: string,
    hostUser: { id: string; name: string; role: string },
    initialItemIndex = 0
  ): ManagedRealtimeSession {
    this.pruneStaleSessions();

    const existingSessionId = this.setlistToSession.get(setlistId);
    if (existingSessionId) {
      const existing = this.sessions.get(existingSessionId);
      if (existing && existing.status !== 'CONCLUDED') {
        // Registrar o actualizar al anfitrión
        existing.participants.set(hostUser.id, {
          userId: hostUser.id,
          name: hostUser.name,
          role: hostUser.role,
          lastSeenAt: new Date().toISOString(),
          isHost: hostUser.id === existing.hostUserId,
        });
        existing.lastActivityAt = new Date();
        return existing;
      }
    }

    const sessionId = crypto.randomUUID();
    const session = new ManagedRealtimeSession(
      sessionId,
      setlistId,
      setlistTitle,
      hostUser.id,
      initialItemIndex
    );

    // Registrar anfitrión como primer participante
    session.participants.set(hostUser.id, {
      userId: hostUser.id,
      name: hostUser.name,
      role: hostUser.role,
      lastSeenAt: new Date().toISOString(),
      isHost: true,
    });

    this.sessions.set(sessionId, session);
    this.setlistToSession.set(setlistId, sessionId);

    return session;
  }

  /**
   * Obtiene una sesión activa por ID.
   */
  public getSession(sessionId: string): ManagedRealtimeSession {
    this.pruneStaleSessions();
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new NotFoundError('Sesión en tiempo real', sessionId);
    }
    return session;
  }

  /**
   * Obtiene la sesión activa vinculada a un setlist si existe.
   */
  public getSessionBySetlistId(setlistId: string): ManagedRealtimeSession | null {
    this.pruneStaleSessions();
    const sessionId = this.setlistToSession.get(setlistId);
    if (!sessionId) return null;
    const session = this.sessions.get(sessionId);
    if (!session || session.status === 'CONCLUDED') return null;
    return session;
  }

  /**
   * Une un usuario (músico, director o espectador) a la sesión en tiempo real.
   */
  public joinSession(
    sessionId: string,
    user: { id: string; name: string; role: string }
  ): RealtimeSessionSnapshot {
    const session = this.getSession(sessionId);

    if (session.status === 'CONCLUDED') {
      throw new ValidationError('Esta sesión litúrgica ya ha finalizado.');
    }

    const isHost = user.id === session.hostUserId;
    const participant: ParticipantState = {
      userId: user.id,
      name: user.name,
      role: user.role,
      lastSeenAt: new Date().toISOString(),
      isHost,
    };

    session.participants.set(user.id, participant);
    session.lastActivityAt = new Date();

    // Notificar a todos los atriles conectados
    const event: RealtimeEvent = {
      eventId: crypto.randomUUID(),
      sessionId: session.sessionId,
      type: 'PARTICIPANT_JOINED',
      epoch: session.epoch,
      sequence: session.sequence,
      timestamp: new Date().toISOString(),
      state: session.toSnapshot(),
    };
    session.broadcast(event);

    return session.toSnapshot();
  }

  /**
   * Registra la salida voluntaria de un usuario de la sesión.
   */
  public leaveSession(sessionId: string, userId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    if (session.participants.has(userId)) {
      session.participants.delete(userId);
      session.lastActivityAt = new Date();

      const event: RealtimeEvent = {
        eventId: crypto.randomUUID(),
        sessionId: session.sessionId,
        type: 'PARTICIPANT_LEFT',
        epoch: session.epoch,
        sequence: session.sequence,
        timestamp: new Date().toISOString(),
        state: session.toSnapshot(),
      };
      session.broadcast(event);
    }
  }

  /**
   * Heartbeat para mantener activa la presencia del participante y la sesión.
   */
  public heartbeat(
    sessionId: string,
    userId: string
  ): { ok: boolean; sequence: number } {
    const session = this.getSession(sessionId);
    const participant = session.participants.get(userId);
    if (participant) {
      participant.lastSeenAt = new Date().toISOString();
    }
    session.lastActivityAt = new Date();
    return { ok: true, sequence: session.sequence };
  }

  /**
   * Despacha y procesa una acción litúrgica en vivo con control estricto de autorización,
   * idempotencia y ordenamiento secuencial.
   */
  public dispatchAction(
    sessionId: string,
    user: { id: string; role: string },
    action: RealtimeAction
  ): { success: boolean; sequence: number; state: RealtimeSessionSnapshot; deduplicated?: boolean } {
    const session = this.getSession(sessionId);

    if (session.status === 'CONCLUDED') {
      throw new ValidationError('No se pueden enviar acciones a una sesión concluida.');
    }

    // 1. Autorización: solo el anfitrión asignado o un ADMIN/SUPER_ADMIN puede modificar el estado litúrgico
    const isHost = user.id === session.hostUserId;
    const isGlobalAdmin = user.role === 'ADMIN' || user.role === 'SUPER_ADMIN';

    if (!isHost && !isGlobalAdmin) {
      throw new ForbiddenError(
        'Solo el director de alabanza asignado o un administrador pueden dirigir y cambiar el estado del culto en vivo.'
      );
    }

    // 2. Idempotencia: si la acción ya fue procesada, devolver estado actual sin mutar ni avanzar secuencia
    if (session.processedActionIds.has(action.actionId)) {
      return {
        success: true,
        sequence: session.sequence,
        state: session.toSnapshot(),
        deduplicated: true,
      };
    }

    // 3. Ordenamiento / Detección de desfase: si el cliente provee expectedSequence menor que la actual
    if (
      action.expectedSequence !== undefined &&
      action.expectedSequence < session.sequence
    ) {
      throw new ConflictError(
        `Desfase litúrgico detectado. Secuencia enviada (${action.expectedSequence}) es anterior a la secuencia actual del servidor (${session.sequence}). Sincronice el estado local antes de continuar.`
      );
    }

    // 4. Aplicar la transición de estado litúrgico según el tipo de acción
    switch (action.type) {
      case 'SET_ITEM_INDEX': {
        const newIndex = action.payload.itemIndex ?? 0;
        session.currentItemIndex = Math.max(0, newIndex);
        session.currentSection = null; // Reiniciar sección al cambiar de elemento
        break;
      }
      case 'SET_SECTION': {
        session.currentSection = action.payload.section ?? null;
        break;
      }
      case 'SET_KEY_OVERRIDE': {
        session.currentKeyOverride = action.payload.keyOverride ?? null;
        break;
      }
      case 'SET_BPM_OVERRIDE': {
        session.currentBpmOverride = action.payload.bpmOverride ?? null;
        break;
      }
      case 'SET_STATUS': {
        if (action.payload.status) {
          session.status = action.payload.status;
        }
        break;
      }
      default:
        throw new ValidationError(`Tipo de acción litúrgica desconocido: ${(action as any).type}`);
    }

    // 5. Incrementar secuencia monotónica y registrar idempotencia
    session.sequence += 1;
    session.recordAction(action.actionId);
    session.lastActivityAt = new Date();

    const snapshot = session.toSnapshot();

    // 6. Construir y transmitir evento SSE a todos los atriles conectados
    const event: RealtimeEvent = {
      eventId: crypto.randomUUID(),
      sessionId: session.sessionId,
      type: session.status === 'CONCLUDED' ? 'SESSION_CONCLUDED' : 'STATE_CHANGED',
      epoch: session.epoch,
      sequence: session.sequence,
      timestamp: new Date().toISOString(),
      state: snapshot,
      action: {
        actionId: action.actionId,
        type: action.type,
        performedBy: user.id,
      },
    };

    session.broadcast(event);

    return {
      success: true,
      sequence: session.sequence,
      state: snapshot,
    };
  }

  /**
   * Suscribe un cliente SSE al flujo de eventos de la sesión.
   * Retorna función de desuscripción.
   */
  public subscribe(
    sessionId: string,
    callback: (event: RealtimeEvent) => void
  ): () => void {
    const session = this.getSession(sessionId);
    session.subscribers.add(callback);

    return () => {
      session.subscribers.delete(callback);
    };
  }

  /**
   * Limpia sesiones inactivas o participantes desconectados por timeout.
   */
  public pruneStaleSessions(): void {
    const now = Date.now();

    for (const [sessionId, session] of this.sessions.entries()) {
      // Remover participantes sin heartbeat
      for (const [userId, participant] of session.participants.entries()) {
        const lastSeen = new Date(participant.lastSeenAt).getTime();
        if (now - lastSeen > PARTICIPANT_TIMEOUT_MS) {
          session.participants.delete(userId);
        }
      }

      // Remover sesiones completamente inactivas por más de 1 hora o concluidas hace más de 15 min
      const sessionInactivity = now - session.lastActivityAt.getTime();
      if (
        sessionInactivity > SESSION_INACTIVITY_TIMEOUT_MS ||
        (session.status === 'CONCLUDED' && sessionInactivity > 15 * 60 * 1000)
      ) {
        this.sessions.delete(sessionId);
        this.setlistToSession.delete(session.setlistId);
      }
    }
  }

  /**
   * Reset para entornos de prueba
   */
  public clearAllSessions(): void {
    this.sessions.clear();
    this.setlistToSession.clear();
  }
}

// Instancia singleton para el ciclo de vida de la aplicación backend
export const globalRealtimeSessionManager = new RealtimeSessionManager();
