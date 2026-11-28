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

/**
 * Determina de forma robusta si dos URLs de conexión PostgreSQL apuntan al mismo destino de base de datos.
 * No se basa únicamente en igualdad literal de cadenas, sino que normaliza:
 * - Direcciones loopback (localhost, 127.0.0.1, ::1)
 * - Puerto predeterminado de PostgreSQL (5432)
 * - Nombre de base de datos (path sin slashes, minúsculas)
 */
export function areDatabaseTargetsEquivalent(urlStr1: string, urlStr2: string): boolean {
  if (!urlStr1 || !urlStr2) return false;
  if (urlStr1.trim() === urlStr2.trim()) return true;

  try {
    const u1 = new URL(urlStr1);
    const u2 = new URL(urlStr2);

    const isLoopback = (host: string) =>
      host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]';

    const host1 = u1.hostname.toLowerCase();
    const host2 = u2.hostname.toLowerCase();
    const hostsMatch = host1 === host2 || (isLoopback(host1) && isLoopback(host2));

    const port1 = u1.port || '5432';
    const port2 = u2.port || '5432';
    const portsMatch = port1 === port2;

    const db1 = u1.pathname.replace(/^\/+|\/+$/g, '').toLowerCase();
    const db2 = u2.pathname.replace(/^\/+|\/+$/g, '').toLowerCase();
    const dbsMatch = db1 === db2;

    return hostsMatch && portsMatch && dbsMatch;
  } catch {
    // Si no es un URL válido para new URL, fallback a comparación literal normalizada
    return urlStr1.trim().toLowerCase() === urlStr2.trim().toLowerCase();
  }
}

if (isTestEnv) {
  if (!env.TEST_DATABASE_URL) {
    throw new Error(
      '❌ Invariante de Seguridad Violada: TEST_DATABASE_URL debe estar definida durante la ejecución de pruebas.'
    );
  }
  if (areDatabaseTargetsEquivalent(env.TEST_DATABASE_URL, env.DATABASE_URL)) {
    throw new Error(
      '❌ Invariante de Seguridad Violada: TEST_DATABASE_URL no puede apuntar a la misma base de datos que DATABASE_URL durante la ejecución de pruebas para evitar corrupción o pérdida de datos.'
    );
  }
}

export const pool = new Pool({
  connectionString: isTestEnv ? (env.TEST_DATABASE_URL as string) : env.DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

export const db = drizzle(pool, { schema });

export type Database = typeof db;

export interface RuntimeRoleCheckOptions {
  enforceInAllEnvs?: boolean;
}

/**
 * Verifica en tiempo de ejecución que el rol de conexión sea un rol de ejecución restringido (R3.2-02 / REM-01).
 * Falla de forma segura (fail-safe) en producción (o cuando enforceInAllEnvs es true) si el rol actual
 * posee privilegios de superusuario, creación de roles, creación de bases de datos o bypass RLS.
 */
export async function assertNonSuperuserRuntimeRole(
  activePool: pg.Pool = pool,
  options: RuntimeRoleCheckOptions = {}
): Promise<void> {
  if (!options.enforceInAllEnvs && env.NODE_ENV !== 'production') return;

  const res = await activePool.query(`
    SELECT r.rolname, r.rolsuper, r.rolcreaterole, r.rolcreatedb, r.rolbypassrls
    FROM pg_roles r
    WHERE r.rolname = current_user
  `);
  const currentRole = res.rows[0];
  if (
    !currentRole ||
    currentRole.rolsuper ||
    currentRole.rolcreaterole ||
    currentRole.rolcreatedb ||
    currentRole.rolbypassrls
  ) {
    const roleName = currentRole?.rolname ?? 'desconocido';
    throw new Error(
      `❌ Invariante de Seguridad Violada: La aplicación no puede ejecutarse con el rol privilegiado "${roleName}" (super=${Boolean(currentRole?.rolsuper)}, createrole=${Boolean(currentRole?.rolcreaterole)}, createdb=${Boolean(currentRole?.rolcreatedb)}, bypassrls=${Boolean(currentRole?.rolbypassrls)}). Configure una cuenta de ejecución no privilegiada (e.g. bethesda_app_runtime).`
    );
  }
}
