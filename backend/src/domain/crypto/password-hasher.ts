/**
 * @file password-hasher.ts
 * @description Implementación mandatoria de hashing de contraseñas con Argon2id (Fase 2B).
 *
 * Sigue las recomendaciones de seguridad de OWASP:
 * - Tipo: Argon2id (variante híbrida resistente a GPU y side-channel).
 * - Cero fallback silencioso a algoritmos débiles o alternativos.
 */

import * as argon2 from '@node-rs/argon2';
import { env } from '../../config/env.ts';

export interface IPasswordHasher {
  hash(password: string): Promise<string>;
  verify(password: string, hash: string): Promise<boolean>;
}

export class Argon2PasswordHasher implements IPasswordHasher {
  private readonly memoryCost: number;
  private readonly timeCost: number;
  private readonly parallelism: number;

  public constructor(options?: { memoryCost?: number; timeCost?: number; parallelism?: number }) {
    this.memoryCost = options?.memoryCost ?? env.ARGON2_MEMORY_COST;
    this.timeCost = options?.timeCost ?? env.ARGON2_TIME_COST;
    this.parallelism = options?.parallelism ?? env.ARGON2_PARALLELISM;
  }

  /**
   * Genera un hash criptográfico Argon2id seguro para una contraseña en texto plano.
   */
  public async hash(password: string): Promise<string> {
    if (!password || typeof password !== 'string' || password.length === 0) {
      throw new Error('La contraseña no puede estar vacía.');
    }

    try {
      return await argon2.hash(password, {
        algorithm: argon2.Algorithm.Argon2id,
        memoryCost: this.memoryCost,
        timeCost: this.timeCost,
        parallelism: this.parallelism,
      });
    } catch (err) {
      console.error('❌ Error fatal al ejecutar Argon2id:', err);
      throw new Error('Fallo crítico del subsistema de hashing de contraseñas (Argon2id).');
    }
  }

  /**
   * Verifica de manera segura en tiempo constante si una contraseña coincide con el hash almacenado.
   */
  public async verify(password: string, hash: string): Promise<boolean> {
    if (!password || !hash) {
      return false;
    }

    try {
      return await argon2.verify(hash, password, {
        algorithm: argon2.Algorithm.Argon2id,
      });
    } catch {
      return false;
    }
  }
}
