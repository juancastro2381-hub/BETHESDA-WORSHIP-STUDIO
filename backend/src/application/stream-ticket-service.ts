/**
 * @file stream-ticket-service.ts
 * @description Servicio de emisión y validación de tickets de un solo uso y corta duración
 * para Server-Sent Events (SSE) y streaming multimedia seguro (R1-P0).
 *
 * Elimina la exposición de Access Tokens JWT en la cadena de consulta (query string / URLs).
 * Los tickets:
 * - Son de uso único estricto (se queman al consumirse).
 * - Tienen un tiempo de vida (TTL) ultracorto (60 segundos).
 * - Están vinculados criptográficamente al usuario, rol y recurso específico (sessionId o audioId).
 * - No contienen información confidencial decodificable en logs.
 */

import crypto from 'node:crypto';
import { UnauthorizedError } from '../domain/errors.ts';

export type TicketPurpose = 'SSE_STREAM' | 'AUDIO_STREAM' | 'DOCUMENT_VIEW';

export interface StreamTicketPayload {
  readonly ticket: string;
  readonly userId: string;
  readonly role: string;
  readonly resourceId: string;
  readonly purpose: TicketPurpose;
  readonly expiresAt: number;
}

export class StreamTicketService {
  private tickets: Map<string, StreamTicketPayload>;
  private readonly defaultTtlMs: number;

  constructor(defaultTtlMs = 60 * 1000) {
    this.tickets = new Map();
    this.defaultTtlMs = defaultTtlMs;
  }

  /**
   * Emite un ticket de un solo uso para un usuario y recurso específico.
   */
  public issueTicket(params: {
    userId: string;
    role: string;
    resourceId: string;
    purpose: TicketPurpose;
  }): string {
    this.pruneExpired();

    const ticket = crypto.randomBytes(32).toString('hex');
    const expiresAt = Date.now() + this.defaultTtlMs;

    this.tickets.set(ticket, {
      ticket,
      userId: params.userId,
      role: params.role,
      resourceId: params.resourceId,
      purpose: params.purpose,
      expiresAt,
    });

    return ticket;
  }

  /**
   * Valida y quema inmediatamente el ticket (Single-Use Invariant).
   * Lanza UnauthorizedError si el ticket es inválido, expiró o no coincide con el recurso/propósito.
   */
  public consumeTicket(
    params: {
      ticket: string;
      resourceId: string;
      purpose: TicketPurpose;
    },
    burn = true
  ): { userId: string; role: string } {
    this.pruneExpired();

    const payload = this.tickets.get(params.ticket);

    if (!payload) {
      throw new UnauthorizedError('Ticket de transmisión inválido o ya consumido.');
    }

    if (Date.now() > payload.expiresAt) {
      this.tickets.delete(params.ticket);
      throw new UnauthorizedError('El ticket de transmisión ha expirado.');
    }

    if (payload.purpose !== params.purpose) {
      throw new UnauthorizedError('Propósito de ticket de transmisión incompatible.');
    }

    if (payload.resourceId !== params.resourceId) {
      throw new UnauthorizedError('El ticket no autoriza el acceso al recurso solicitado.');
    }

    // Quema inmediata del ticket si burn es true (ej. SSE de conexión única).
    // Para streaming multimedia con múltiples peticiones HTTP Range (seeking), se conserva durante su ventana de 60s.
    if (burn) {
      this.tickets.delete(params.ticket);
    }

    return {
      userId: payload.userId,
      role: payload.role,
    };
  }

  /**
   * Limpia tickets expirados para evitar fugas de memoria.
   */
  private pruneExpired(): void {
    const now = Date.now();
    for (const [key, value] of this.tickets.entries()) {
      if (now > value.expiresAt) {
        this.tickets.delete(key);
      }
    }
  }

  /**
   * Reset para entornos de prueba
   */
  public clear(): void {
    this.tickets.clear();
  }
}

// Instancia singleton compartida
export const globalStreamTicketService = new StreamTicketService();
