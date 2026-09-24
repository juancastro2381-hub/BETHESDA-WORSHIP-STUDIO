/**
 * @file index.ts
 * @description Configuración del pool de PostgreSQL y cliente Drizzle ORM.
 */

import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { env } from '../config/env.ts';
import * as schema from './schema.ts';

const { Pool } = pg;

export const pool = new Pool({
  connectionString: env.NODE_ENV === 'test' ? env.TEST_DATABASE_URL : env.DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

export const db = drizzle(pool, { schema });

export type Database = typeof db;
