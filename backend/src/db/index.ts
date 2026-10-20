/**
 * @file index.ts
 * @description Configuración del pool de PostgreSQL y cliente Drizzle ORM.
 */

import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { env } from '../config/env.ts';
import * as schema from './schema.ts';

const { Pool } = pg;
const isTestEnv = env.NODE_ENV === 'test';

if (isTestEnv) {
  if (env.TEST_DATABASE_URL === env.DATABASE_URL) {
    throw new Error(
      '❌ Invariante de Seguridad Violada: TEST_DATABASE_URL no puede ser idéntica a DATABASE_URL durante la ejecución de pruebas para evitar corrupción de datos.'
    );
  }
}

export const pool = new Pool({
  connectionString: isTestEnv ? env.TEST_DATABASE_URL : env.DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

export const db = drizzle(pool, { schema });

export type Database = typeof db;
