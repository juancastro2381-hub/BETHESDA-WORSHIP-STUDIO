/**
 * @file migrate.ts
 * @description Ejecutor programático de migraciones de base de datos para Bethesda Worship Studio.
 */

import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { db, pool } from './index.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function runMigrations(): Promise<void> {
  const migrationsFolder = path.resolve(__dirname, 'migrations');
  console.log(`🚀 Aplicando migraciones de Drizzle desde: ${migrationsFolder}`);
  try {
    await migrate(db, { migrationsFolder });
    console.log('✅ Migraciones aplicadas con éxito.');
  } catch (error) {
    console.error('❌ Fallo al aplicar migraciones:', error);
    throw error;
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
