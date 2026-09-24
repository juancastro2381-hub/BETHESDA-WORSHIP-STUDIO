/**
 * @file token-service.ts
 * @description Servicio de emisión y verificación de Access Tokens JWT estrictamente con algoritmo HS256 (Fase 2B).
 *
 * Directrices mandatorias de seguridad:
 * - Algoritmo fijado a HS256 exclusivamente.
 * - Rechazo categórico de alg=none y algoritmos asimétricos.
 * - Claims obligatorios: sub, email, role, jti, iat, exp.
 * - Duración: 15 minutos (900 segundos).
 */

import crypto from 'node:crypto';
import { env } from '../config/env.ts';
import type { JwtTokenPayload, UserRole } from '../domain/auth-types.ts';
import { TokenExpiredError, TokenInvalidError } from '../domain/errors.ts';

export interface ITokenService {
  signAccessToken(user: { id?: string; sub?: string; email: string; role: UserRole }): { token: string; jti: string; expiresIn: number };
  verifyAccessToken(token: string): JwtTokenPayload;
}

export class JwtTokenService implements ITokenService {
  private readonly secret: string;
  private readonly expirationSeconds: number;

  public constructor(
    secretOrOptions?: string | { secret?: string; expirationSeconds?: number },
    expiration?: number | string
  ) {
    if (typeof secretOrOptions === 'string') {
      this.secret = secretOrOptions;
      if (typeof expiration === 'number') {
        this.expirationSeconds = expiration;
      } else if (typeof expiration === 'string' && expiration.endsWith('m')) {
        this.expirationSeconds = parseInt(expiration, 10) * 60;
      } else {
        this.expirationSeconds = 900;
      }
    } else {
      this.secret = secretOrOptions?.secret ?? env.JWT_SECRET;
      this.expirationSeconds = secretOrOptions?.expirationSeconds ?? 900;
    }
  }

  /**
   * Genera un Access Token JWT firmado determinísticamente con HS256.
   */
  public signAccessToken(user: { id?: string; sub?: string; email: string; role: UserRole }): {
    token: string;
    jti: string;
    expiresIn: number;
  } {
    const now = Math.floor(Date.now() / 1000);
    const exp = now + this.expirationSeconds;
    const jti = crypto.randomUUID();
    const userId = user.id ?? user.sub;

    if (!userId) {
      throw new Error('Debe proveer id o sub para firmar el token.');
    }

    const header = {
      alg: 'HS256',
      typ: 'JWT',
    };

    const payload: JwtTokenPayload = {
      sub: userId,
      email: user.email,
      role: user.role,
      jti,
      iat: now,
      exp,
    };

    const encodedHeader = Buffer.from(JSON.stringify(header)).toString('base64url');
    const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const signatureInput = `${encodedHeader}.${encodedPayload}`;

    const signature = crypto
      .createHmac('sha256', this.secret)
      .update(signatureInput)
      .digest('base64url');

    const token = `${signatureInput}.${signature}`;

    return { token, jti, expiresIn: this.expirationSeconds };
  }

  /**
   * Verifica la validez criptográfica del token, el algoritmo HS256 estricto y los claims requeridos.
   */
  public verifyAccessToken(token: string): JwtTokenPayload {
    if (!token || typeof token !== 'string') {
      throw new TokenInvalidError('Formato de token no provisto o inválido.');
    }

    const parts = token.split('.');
    if (parts.length !== 3) {
      throw new TokenInvalidError('Estructura de token JWT inválida (debe contener 3 segmentos).');
    }

    const [headerB64, payloadB64, signatureB64] = parts;

    // 1. Decodificar y validar encabezado
    let header: { alg?: string; typ?: string };
    try {
      header = JSON.parse(Buffer.from(headerB64, 'base64url').toString('utf8'));
    } catch {
      throw new TokenInvalidError('Encabezado de token JWT malformado.');
    }

    // Rechazo mandatorio de algoritmos no autorizados y alg=none
    if (header.alg !== 'HS256') {
      throw new TokenInvalidError(`Algoritmo '${header.alg}' no permitido. Únicamente se admite HS256.`);
    }

    // 2. Verificar firma con clave simétrica en tiempo constante
    const signatureInput = `${headerB64}.${payloadB64}`;
    const expectedSignature = crypto
      .createHmac('sha256', this.secret)
      .update(signatureInput)
      .digest('base64url');

    const sigBuf = Buffer.from(signatureB64, 'utf8');
    const expectedBuf = Buffer.from(expectedSignature, 'utf8');

    if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
      throw new TokenInvalidError('Firma de token inválida.');
    }

    // 3. Decodificar y validar payload
    let payload: JwtTokenPayload;
    try {
      payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
    } catch {
      throw new TokenInvalidError('Carga útil de token JWT malformada.');
    }

    // Validar presencia estricta de claims
    if (!payload.sub || !payload.email || !payload.role || !payload.jti || !payload.iat || !payload.exp) {
      throw new TokenInvalidError('Token JWT incompleto (carece de claims requeridos: sub, email, role, jti, iat, exp).');
    }

    // 4. Verificar expiración
    const now = Math.floor(Date.now() / 1000);
    if (payload.exp < now) {
      throw new TokenExpiredError('El token de acceso ha expirado.');
    }

    return payload;
  }
}
