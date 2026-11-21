/**
 * @file migrate.ts
 * @description Ejecutor programático de migraciones de base de datos para Bethesda Worship Studio.
 */

import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import pg from 'pg';
import { env } from '../config/env.ts';
import { db, pool } from './index.ts';
import * as schema from './schema.ts';

const { Pool } = pg;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function runMigrations(): Promise<void> {
  const migrationsFolder = path.resolve(__dirname, 'migrations');
  console.log(`🚀 Aplicando migraciones de Drizzle desde: ${migrationsFolder}`);

  // En Fase 1A-R3.2: Las herramientas de migración DDL utilizan prioritariamente MIGRATION_DATABASE_URL
  // separando el rol de migraciones/DBA del rol de ejecución restringido (R3.2-02).
  const migrationConnUrl =
    env.MIGRATION_DATABASE_URL ||
    (env.NODE_ENV === 'test' && env.TEST_DATABASE_URL
      ? env.TEST_DATABASE_URL
      : env.DATABASE_URL);

  const isDedicatedMigrationPool = !!env.MIGRATION_DATABASE_URL;
  const migrationPool = isDedicatedMigrationPool
    ? new Pool({ connectionString: migrationConnUrl, max: 2, connectionTimeoutMillis: 10000 })
    : pool;
  const migrationDb = isDedicatedMigrationPool ? drizzle(migrationPool, { schema }) : db;

  try {
    await migrate(migrationDb, { migrationsFolder });
    console.log('✅ Migraciones aplicadas con éxito.');
  } catch (error) {
    console.error('❌ Fallo al aplicar migraciones:', error);
    throw error;
  } finally {
    if (isDedicatedMigrationPool) {
      await migrationPool.end();
    }
  }
}

// Si se ejecuta directamente desde CLI
if (process.argv[1] === __filename) {
  runMigrations()
    .then(async () => {
      await pool.end();
      process.exit(0);
    })
    .catch(async (err) => {
      console.error(err);
      await pool.end();
      process.exit(1);
    });
}
