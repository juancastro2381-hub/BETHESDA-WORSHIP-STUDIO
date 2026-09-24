/**
 * @file token-utils.ts
 * @description Utilidades criptográficas para generación, hasheo SHA-256 y comparación segura de tokens (Fase 2B).
 */

import crypto from 'node:crypto';

/**
 * Genera un token aleatorio criptográficamente seguro de longitud especificada en bytes.
 * Retorna una cadena hexadecimal (por defecto 32 bytes = 256 bits = 64 caracteres hex).
 */
export function generateSecureToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString('hex');
}

/**
 * Calcula el hash SHA-256 de un token en texto plano para persistencia segura en base de datos.
 * Esto garantiza que los tokens nunca se almacenen en texto plano.
 */
export function hashToken(token: string): string {
  if (!token) throw new Error('El token a hashear no puede estar vacío.');
  return crypto.createHash('sha256').update(token).digest('hex');
}

/**
 * Compara dos hashes en tiempo constante para evitar ataques de canal lateral (timing attacks).
 */
export function timingSafeEqual(a: string, b: string): boolean {
  if (!a || !b) return false;
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}
