/**
 * @file env.ts
 * @description Validación estricta con Zod de las variables de entorno para Bethesda Worship Studio (Fase 2A & 2B).
 */

import * as dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(3001),
  HOST: z.string().default('0.0.0.0'),
  DATABASE_URL: z.string().url().default('postgresql://postgres:1011324455Ne@localhost:5432/bethesda_worship_dev'),
  TEST_DATABASE_URL: z.string().url().default('postgresql://postgres:1011324455Ne@localhost:5432/bethesda_worship_test'),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  // Fase 2B: Seguridad & Autenticación
  JWT_SECRET: z.string().min(32, 'El secreto JWT debe tener al menos 32 caracteres (256 bits)'),
  COOKIE_SECRET: z.string().min(32, 'El secreto de cookies debe tener al menos 32 caracteres (256 bits)'),
  JWT_ACCESS_EXPIRES_IN: z.string().default('15m'),
  REFRESH_TOKEN_EXPIRES_IN_DAYS: z.coerce.number().default(7),

  // Parámetros de Argon2id
  ARGON2_MEMORY_COST: z.coerce.number().default(65536),
  ARGON2_TIME_COST: z.coerce.number().default(3),
  ARGON2_PARALLELISM: z.coerce.number().default(4),

  // Rate Limiting distribuido (Opcional en desarrollo, requerido en producción multi-instancia)
  REDIS_URL: z.string().url().optional(),

  // Bootstrap Super Admin (Opcional para inicialización)
  INITIAL_SUPERADMIN_EMAIL: z.string().email().optional(),
  INITIAL_SUPERADMIN_PASSWORD: z.string().min(10).optional(),

  // Workstream A: Almacenamiento seguro de audio
  AUDIO_STORAGE_PATH: z.string().default('storage/audio'),
  MAX_AUDIO_FILE_SIZE_BYTES: z.coerce.number().default(50 * 1024 * 1024), // 50MB (Decisión U-03)
});

export type Env = z.infer<typeof envSchema>;

function parseEnv(): Env {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    console.error('❌ Error fatal de configuración de variables de entorno:', result.error.format());
    throw new Error('Configuración de entorno inválida.');
  }
  return result.data;
}

export const env = parseEnv();
