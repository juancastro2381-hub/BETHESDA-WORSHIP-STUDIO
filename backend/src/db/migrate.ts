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
import { areDatabaseTargetsEquivalent, db, pool } from './index.ts';
import * as schema from './schema.ts';

const { Pool } = pg;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface MigrationDbResolutionConfig {
  NODE_ENV: string;
  DATABASE_URL: string;
  TEST_DATABASE_URL?: string;
  MIGRATION_DATABASE_URL?: string;
}

/**
 * Resuelve de forma segura la URL de conexión para migraciones DDL (NF-01).
 * En NODE_ENV === 'test' exige TEST_DATABASE_URL aislada y rechaza cualquier
 * MIGRATION_DATABASE_URL que no apunte al mismo destino aislado que TEST_DATABASE_URL.
 */
export function resolveMigrationDatabaseUrl(config: MigrationDbResolutionConfig): {
  url: string;
  isDedicatedMigrationPool: boolean;
} {
  if (config.NODE_ENV === 'test') {
    if (!config.TEST_DATABASE_URL) {
      throw new Error(
        '❌ Invariante de Seguridad Violada (NF-01): TEST_DATABASE_URL es obligatoria para ejecutar migraciones en NODE_ENV=test.'
      );
    }
    if (areDatabaseTargetsEquivalent(config.TEST_DATABASE_URL, config.DATABASE_URL)) {
      throw new Error(
        '❌ Invariante de Seguridad Violada (NF-01): TEST_DATABASE_URL no puede apuntar al mismo destino que DATABASE_URL.'
      );
    }
    if (config.MIGRATION_DATABASE_URL) {
      if (
        !areDatabaseTargetsEquivalent(config.MIGRATION_DATABASE_URL, config.TEST_DATABASE_URL) ||
        areDatabaseTargetsEquivalent(config.MIGRATION_DATABASE_URL, config.DATABASE_URL)
      ) {
        throw new Error(
          '❌ Invariante de Seguridad Violada (NF-01): MIGRATION_DATABASE_URL en NODE_ENV=test debe apuntar exclusivamente al mismo destino aislado que TEST_DATABASE_URL.'
        );
      }
      return { url: config.MIGRATION_DATABASE_URL, isDedicatedMigrationPool: true };
    }
    return { url: config.TEST_DATABASE_URL, isDedicatedMigrationPool: false };
  }

  if (config.MIGRATION_DATABASE_URL) {
    return { url: config.MIGRATION_DATABASE_URL, isDedicatedMigrationPool: true };
  }
  return { url: config.DATABASE_URL, isDedicatedMigrationPool: false };
}

export async function runMigrations(): Promise<void> {
  const migrationsFolder = path.resolve(__dirname, 'migrations');
  console.log(`🚀 Aplicando migraciones de Drizzle desde: ${migrationsFolder}`);

  // En Fase 1A-R3.2 / REM-01: Las herramientas de migración DDL utilizan prioritariamente MIGRATION_DATABASE_URL
  // separando el rol de migraciones/DBA del rol de ejecución restringido, con aislamiento estricto en test (NF-01).
  const { url: migrationConnUrl, isDedicatedMigrationPool } = resolveMigrationDatabaseUrl(env);
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
