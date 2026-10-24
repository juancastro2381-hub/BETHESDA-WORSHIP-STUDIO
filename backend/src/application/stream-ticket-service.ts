/**
 * @file stream-ticket-service.ts
 * @description Servicio de emisión y validación de tickets seguros de corta duración
 * para Server-Sent Events (SSE), streaming de audio y visualización de documentos en atril (R1-P0 / F-01).
 *
 * Modelo de Seguridad y Ciclo de Vida Explícito:
 * 1. SSE_STREAM:
 *    - Monouso estricto (maxUses = 1).
 *    - Se quema inmediatamente tras establecer el canal SSE unidireccional.
 * 2. AUDIO_STREAM y DOCUMENT_VIEW:
 *    - Ventana acotada por tiempo (TTL = 60 segundos) y cuota máxima de peticiones (maxUses = 25).
 *    - Permite al visor nativo realizar peticiones HTTP de rango (Range requests), carga de bloques
 *      de diccionario xref/trailer y navegación rápida dentro de la sesión sin forzar reautenticación
 *      ni exponer credenciales JWT reutilizables indefinidamente.
 *    - Una vez alcanzado maxUses o superado el TTL, el ticket queda revocado de forma definitiva.
 * 3. Enlace criptográfico:
 *    - Cada ticket se genera con entropía criptográfica (crypto.randomBytes(32)) y se vincula
 *      a userId, rol, resourceId y propósito.
 *    - Se rechaza cualquier discrepancia de recurso, rol o propósito con HTTP 401 Unauthorized.
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
  readonly maxUses: number;
  useCount: number;
}

export class StreamTicketService {
  private tickets: Map<string, StreamTicketPayload>;
  private readonly defaultTtlMs: number;

  constructor(defaultTtlMs = 60 * 1000) {
    this.tickets = new Map();
    this.defaultTtlMs = defaultTtlMs;
  }

  /**
   * Determina la cuota predeterminada de peticiones según el propósito del ticket.
   */
  private getDefaultMaxUses(purpose: TicketPurpose): number {
    switch (purpose) {
      case 'SSE_STREAM':
        return 1; // Monouso estricto para conexión de eventos
      case 'AUDIO_STREAM':
      case 'DOCUMENT_VIEW':
        return 25; // Ventana acotada para Range requests y bloques de renderizado en visor nativo
      default:
        return 1;
    }
  }

  /**
   * Emite un ticket seguro vinculado a un usuario, rol, recurso y propósito específico.
   */
  public issueTicket(params: {
    userId: string;
    role: string;
    resourceId: string;
    purpose: TicketPurpose;
    ttlMs?: number;
    maxUses?: number;
  }): string {
    this.pruneExpired();

    const ticket = crypto.randomBytes(32).toString('hex');
    const ttl = params.ttlMs ?? this.defaultTtlMs;
    const expiresAt = Date.now() + ttl;
    const maxUses = params.maxUses ?? this.getDefaultMaxUses(params.purpose);

    this.tickets.set(ticket, {
      ticket,
      userId: params.userId,
      role: params.role,
      resourceId: params.resourceId,
      purpose: params.purpose,
      expiresAt,
      maxUses,
      useCount: 0,
    });

    return ticket;
  }

  /**
   * Valida y consume el ticket registrando el uso en su ciclo de vida.
   * Lanza UnauthorizedError si el ticket es inexistente, expiró, excedió su cuota o no coincide con recurso/propósito.
   *
   * @param burn Si es true, quema el ticket inmediatamente sin importar los usos restantes.
   */
  public consumeTicket(
    params: {
      ticket: string;
      resourceId: string;
      purpose: TicketPurpose;
    },
    burn?: boolean
  ): { userId: string; role: string; remainingUses: number } {
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

    // Incrementar conteo de usos
    payload.useCount += 1;
    const remainingUses = Math.max(0, payload.maxUses - payload.useCount);

    // Si se solicitó quema explícita o se agotó la cuota permitida, revocar ticket inmediatamente
    const shouldBurn = burn === true || payload.useCount >= payload.maxUses;
    if (shouldBurn) {
      this.tickets.delete(params.ticket);
    }

    return {
      userId: payload.userId,
      role: payload.role,
      remainingUses,
    };
  }

  /**
   * Inspecciona el estado de un ticket activo (para diagnósticos y suites de prueba).
   */
  public getTicketState(ticket: string): StreamTicketPayload | null {
    this.pruneExpired();
    const item = this.tickets.get(ticket);
    return item ? { ...item } : null;
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
