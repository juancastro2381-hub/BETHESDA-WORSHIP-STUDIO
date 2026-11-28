/**
 * @file disposable-test-guard.ts
 * @description Guardias estrictos para certificación en base de datos PostgreSQL desechable (REM-02).
 * Impide cualquier operación destructiva sobre bethesda_worship_dev, bethesda_worship_test o producción.
 */

import type pg from 'pg';
import { areDatabaseTargetsEquivalent } from './index.ts';

export const DISPOSABLE_CERT_DB_NAME = 'bethesda_worship_r2_cert_tmp';

export const FORBIDDEN_DATABASE_NAMES = new Set<string>([
  'bethesda_worship_dev',
  'bethesda_worship_test',
  'postgres',
  'template0',
  'template1',
]);

export interface ParsedDisposableTarget {
  dbName: string;
  host: string;
  port: string;
}

/**
 * Valida antes de cualquier operación destructiva o suite certificadora que la URL de destino
 * corresponda exclusiva y explícitamente a bethesda_worship_r2_cert_tmp.
 */
export function assertDisposableCertDatabaseUrl(
  targetUrl: string | undefined,
  primaryDatabaseUrl?: string
): ParsedDisposableTarget {
  if (!targetUrl || !targetUrl.trim()) {
    throw new Error(
      '❌ Invariante REM-02 Violada: la URL de base de datos de prueba es obligatoria.'
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(targetUrl);
  } catch {
    throw new Error('❌ Invariante REM-02 Violada: URL de conexión PostgreSQL inválida.');
  }

  if (parsed.protocol !== 'postgres:' && parsed.protocol !== 'postgresql:') {
    throw new Error(`❌ Invariante REM-02 Violada: protocolo no permitido (${parsed.protocol}).`);
  }

  const dbName = parsed.pathname.replace(/^\/+|\/+$/g, '').toLowerCase();
  if (!dbName) {
    throw new Error('❌ Invariante REM-02 Violada: la URL no especifica nombre de base de datos.');
  }

  if (FORBIDDEN_DATABASE_NAMES.has(dbName) || dbName.includes('prod')) {
    throw new Error(
      `❌ Invariante REM-02 Violada: base de datos protegida rechazada ("${dbName}"). Solo se permite "${DISPOSABLE_CERT_DB_NAME}".`
    );
  }

  if (dbName !== DISPOSABLE_CERT_DB_NAME) {
    throw new Error(
      `❌ Invariante REM-02 Violada: base de datos inesperada ("${dbName}"). Debe ser exactamente "${DISPOSABLE_CERT_DB_NAME}".`
    );
  }

  if (primaryDatabaseUrl && areDatabaseTargetsEquivalent(targetUrl, primaryDatabaseUrl)) {
    throw new Error(
      '❌ Invariante REM-02 Violada: la URL desechable no puede equivaler a DATABASE_URL.'
    );
  }

  return {
    dbName,
    host: parsed.hostname.toLowerCase(),
    port: parsed.port || '5432',
  };
}

/**
 * Consulta metadatos reales de PostgreSQL antes de ejecutar mutaciones destructivas de prueba
 * para confirmar que la sesión activa está conectada a bethesda_worship_r2_cert_tmp.
 */
export async function verifyLiveDisposableDatabaseIdentity(
  activePool: pg.Pool,
  expectedUrl: string,
  primaryDatabaseUrl?: string
): Promise<{ currentDatabase: string; currentUser: string; serverPort: number }> {
  const expected = assertDisposableCertDatabaseUrl(expectedUrl, primaryDatabaseUrl);
  const res = await activePool.query<{
    current_database: string;
    current_user: string;
    server_port: number | null;
  }>('SELECT current_database(), current_user, inet_server_port() AS server_port');

  const row = res.rows[0];
  const actualDb = (row?.current_database ?? '').toLowerCase();
  if (!row || actualDb !== expected.dbName || FORBIDDEN_DATABASE_NAMES.has(actualDb) || actualDb.includes('prod')) {
    throw new Error(
      `❌ Invariante REM-02 Violada: identidad PostgreSQL real ("${actualDb}") no coincide con "${expected.dbName}".`
    );
  }

  return {
    currentDatabase: row.current_database,
    currentUser: row.current_user,
    serverPort: row.server_port ?? Number(expected.port),
  };
}
