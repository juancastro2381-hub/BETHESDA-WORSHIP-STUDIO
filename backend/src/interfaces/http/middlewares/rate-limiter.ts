/**
 * @file rate-limiter.ts
 * @description Limitador de tasa bidimensional independiente (IP y Cuenta/Correo) conforme a la especificación de Fase 2B.
 * Soporta almacenamiento en memoria para desarrollo/pruebas y arquitectura extensible a Redis para producción.
 */

import type { FastifyRequest, FastifyReply } from 'fastify';
import { AppError } from '../../../domain/errors.ts';

interface RateLimitBucket {
  count: number;
  resetAt: number; // Unix timestamp en milisegundos
}

export class DualRateLimiter {
  private ipBuckets: Map<string, RateLimitBucket> = new Map();
  private accountBuckets: Map<string, RateLimitBucket> = new Map();

  private readonly ipWindowMs: number;
  private readonly ipMaxAttempts: number;
  private readonly accountWindowMs: number;
  private readonly accountMaxFailedAttempts: number;

  constructor(options?: {
    ipWindowMs?: number;
    ipMaxAttempts?: number;
    accountWindowMs?: number;
    accountMaxFailedAttempts?: number;
  }) {
    this.ipWindowMs = options?.ipWindowMs ?? 60 * 1000; // 1 minuto
    this.ipMaxAttempts = options?.ipMaxAttempts ?? 5; // 5 intentos / min
    this.accountWindowMs = options?.accountWindowMs ?? 60 * 1000; // 1 minuto
    this.accountMaxFailedAttempts = options?.accountMaxFailedAttempts ?? 5; // 5 fallos / min
  }

  /**
   * Valida la tasa por dirección IP.
   */
  public checkIp(ip: string): { allowed: boolean; retryAfter: number } {
    const now = Date.now();
    const bucket = this.ipBuckets.get(ip);

    if (!bucket || now >= bucket.resetAt) {
      return { allowed: true, retryAfter: 0 };
    }

    if (bucket.count >= this.ipMaxAttempts) {
      const retryAfter = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
      return { allowed: false, retryAfter };
    }

    return { allowed: true, retryAfter: 0 };
  }

  /**
   * Registra un intento de solicitud desde la IP dada.
   */
  public recordIpAttempt(ip: string): void {
    const now = Date.now();
    const bucket = this.ipBuckets.get(ip);

    if (!bucket || now >= bucket.resetAt) {
      this.ipBuckets.set(ip, {
        count: 1,
        resetAt: now + this.ipWindowMs,
      });
    } else {
      bucket.count += 1;
    }
  }

  /**
   * Valida la tasa por cuenta (correo electrónico).
   */
  public checkAccount(email: string): { allowed: boolean; retryAfter: number } {
    const normalizedEmail = email.toLowerCase().trim();
    const now = Date.now();
    const bucket = this.accountBuckets.get(normalizedEmail);

    if (!bucket || now >= bucket.resetAt) {
      return { allowed: true, retryAfter: 0 };
    }

    if (bucket.count >= this.accountMaxFailedAttempts) {
      const retryAfter = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
      return { allowed: false, retryAfter };
    }

    return { allowed: true, retryAfter: 0 };
  }

  /**
   * Registra un intento fallido de autenticación para una cuenta.
   */
  public recordAccountFailedAttempt(email: string): void {
    const normalizedEmail = email.toLowerCase().trim();
    const now = Date.now();
    const bucket = this.accountBuckets.get(normalizedEmail);

    if (!bucket || now >= bucket.resetAt) {
      this.accountBuckets.set(normalizedEmail, {
        count: 1,
        resetAt: now + this.accountWindowMs,
      });
    } else {
      bucket.count += 1;
    }
  }

  /**
   * Restablece el contador de fallos de una cuenta tras un login exitoso.
   */
  public resetAccountFailures(email: string): void {
    const normalizedEmail = email.toLowerCase().trim();
    this.accountBuckets.delete(normalizedEmail);
  }

  /**
   * Limpia todos los cubos (útil para pruebas unitarias).
   */
  public reset(): void {
    this.ipBuckets.clear();
    this.accountBuckets.clear();
  }

  /**
   * Middleware preHandler para Fastify que evalúa ambas dimensiones antes de procesar el handler.
   */
  public preHandler() {
    return async (request: FastifyRequest, reply: FastifyReply) => {
      const ip = request.ip || request.socket.remoteAddress || '127.0.0.1';
      const body = request.body as Record<string, unknown> | undefined;
      const email = typeof body?.email === 'string' ? body.email : undefined;

      // 1. Verificar Dimensión IP
      const ipCheck = this.checkIp(ip);
      if (!ipCheck.allowed) {
        reply.header('Retry-After', ipCheck.retryAfter.toString());
        throw new AppError(
          'RATE_LIMIT_EXCEEDED',
          `Límite de solicitudes por IP excedido. Por favor espere ${ipCheck.retryAfter} segundos.`,
          429
        );
      }

      // 2. Verificar Dimensión Cuenta (si aplica)
      if (email) {
        const accountCheck = this.checkAccount(email);
        if (!accountCheck.allowed) {
          reply.header('Retry-After', accountCheck.retryAfter.toString());
          throw new AppError(
            'RATE_LIMIT_EXCEEDED',
            `Demasiados intentos fallidos para esta cuenta. Por favor espere ${accountCheck.retryAfter} segundos.`,
            429
          );
        }
      }

      // Registrar intento de IP
      this.recordIpAttempt(ip);
    };
  }
}

// Instancia singleton por defecto para la aplicación
export const defaultRateLimiter = new DualRateLimiter();
