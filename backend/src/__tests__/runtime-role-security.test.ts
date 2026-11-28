/**
 * @file runtime-role-security.test.ts
 * @description Pruebas unitarias y adversariales en PostgreSQL para REM-01:
 * - Protección NF-01 en resolveMigrationDatabaseUrl()
 * - Verificación de arranque assertNonSuperuserRuntimeRole() en server.ts y db/index.ts
 * - Mínimo privilegio en las 21 tablas aplicativas + esquema pgboss mediante provision_app_runtime_role.sql
 * - Bloqueo efectivo de DDL no autorizado (CREATE/ALTER/DROP) y mutación de tablas de auditoría
 */

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { env } from '../config/env.ts';
import { assertNonSuperuserRuntimeRole, pool } from '../db/index.ts';
import { resolveMigrationDatabaseUrl, runMigrations } from '../db/migrate.ts';
import { startConversionQueue, stopConversionQueue } from '../infrastructure/queue/conversion-queue.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ALL_DML_TABLES = [
  'users',
  'refresh_tokens',
  'password_reset_tokens',
  'user_invitations',
  'songs',
  'song_versions',
  'song_sources',
  'song_metadata',
  'worship_services',
  'setlists',
  'setlist_items',
  'user_view_preferences',
  'audio_assets',
  'multitrack_sessions',
  'multitrack_tracks',
  'background_jobs',
  'omr_proposals',
  'omr_proposal_measures',
  'cas_deletion_intents',
] as const;

const APPEND_ONLY_AUDIT_TABLES = ['audit_logs', 'omr_audit_history'] as const;

function resolvePsqlBinary(): string {
  const candidates = [
    process.env.PSQL_PATH,
    'C:\\Program Files\\PostgreSQL\\18\\bin\\psql.exe',
    'psql',
  ].filter((v): v is string => Boolean(v && v.trim().length > 0));

  for (const candidate of candidates) {
    if (candidate === 'psql' || fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return 'psql';
}

describe('GATE 2 REM-01 — PostgreSQL Runtime Least-Privilege & Migration Isolation', () => {
  let runtimePool: pg.Pool | null = null;
  const disposableDbName = 'bethesda_worship_r2_cert_tmp';

  before(async () => {
    const dbCheck = await pool.query<{ current_db: string }>('SELECT current_database() AS current_db');
    const actualDb = dbCheck.rows[0]?.current_db;
    assert.strictEqual(
      actualDb,
      disposableDbName,
      `La certificación REM-01 en vivo solo puede ejecutarse contra ${disposableDbName} (detectada: ${actualDb}).`
    );

    await runMigrations();
    await startConversionQueue();
    await stopConversionQueue();
  });

  after(async () => {
    if (runtimePool) {
      await runtimePool.end();
      runtimePool = null;
    }
    await pool.end();
  });

  it('1. NF-01: resolveMigrationDatabaseUrl() should reject mismatched or unsafe URLs in test mode', () => {
    const devUrl = 'postgresql://postgres:secret@127.0.0.1:5432/bethesda_worship_dev';
    const testUrl = 'postgresql://postgres:secret@localhost:5432/bethesda_worship_r2_cert_tmp';
    const safeTestMigrator = 'postgresql://migrator:secret@127.0.0.1:5432/bethesda_worship_r2_cert_tmp';

    assert.throws(
      () => resolveMigrationDatabaseUrl({ NODE_ENV: 'test', DATABASE_URL: devUrl }),
      /TEST_DATABASE_URL es obligatoria/
    );

    assert.throws(
      () => resolveMigrationDatabaseUrl({ NODE_ENV: 'test', DATABASE_URL: devUrl, TEST_DATABASE_URL: devUrl }),
      /no puede apuntar al mismo destino/
    );

    assert.throws(
      () =>
        resolveMigrationDatabaseUrl({
          NODE_ENV: 'test',
          DATABASE_URL: devUrl,
          TEST_DATABASE_URL: testUrl,
          MIGRATION_DATABASE_URL: devUrl,
        }),
      /NF-01/
    );

    assert.throws(
      () =>
        resolveMigrationDatabaseUrl({
          NODE_ENV: 'test',
          DATABASE_URL: devUrl,
          TEST_DATABASE_URL: testUrl,
          MIGRATION_DATABASE_URL: 'postgresql://postgres:secret@prod.internal:5432/bethesda_worship_prod',
        }),
      /NF-01/
    );

    const resolvedValid = resolveMigrationDatabaseUrl({
      NODE_ENV: 'test',
      DATABASE_URL: devUrl,
      TEST_DATABASE_URL: testUrl,
      MIGRATION_DATABASE_URL: safeTestMigrator,
    });
    assert.strictEqual(resolvedValid.url, safeTestMigrator);
    assert.strictEqual(resolvedValid.isDedicatedMigrationPool, true);
  });

  it('2. server.ts must enforce assertNonSuperuserRuntimeRole() before migrations and bootstrap', () => {
    const serverPath = path.resolve(__dirname, '..', 'server.ts');
    const serverSource = fs.readFileSync(serverPath, 'utf-8');
    assert.ok(serverSource.includes("import { assertNonSuperuserRuntimeRole } from './db/index.ts'"));
    const roleCheckIdx = serverSource.indexOf('await assertNonSuperuserRuntimeRole()');
    const migrateIdx = serverSource.indexOf('await runMigrations()');
    assert.ok(roleCheckIdx > 0, 'server.ts debe invocar assertNonSuperuserRuntimeRole()');
    assert.ok(roleCheckIdx < migrateIdx, 'assertNonSuperuserRuntimeRole() debe ejecutarse antes que runMigrations()');
  });

  it('3. provision_app_runtime_role.sql provisions NOSUPERUSER/NOCREATEDB/NOCREATEROLE across 21 tables + pgboss and blocks DDL & audit tampering', async () => {
    const scriptPath = path.resolve(__dirname, '..', 'db', 'scripts', 'provision_app_runtime_role.sql');
    const psqlBin = resolvePsqlBinary();
    const ephemeralPassword = crypto.randomBytes(18).toString('hex');

    // Ejecutar dos veces para demostrar idempotencia en el aprovisionamiento
    for (let run = 1; run <= 2; run++) {
      execFileSync(
        psqlBin,
        [
          env.TEST_DATABASE_URL as string,
          '-v',
          'ON_ERROR_STOP=1',
          '-v',
          `APP_RUNTIME_PASSWORD=${ephemeralPassword}`,
          '-f',
          scriptPath,
        ],
        { stdio: 'pipe' }
      );
    }

    const roleRes = await pool.query<{
      rolname: string;
      rolcanlogin: boolean;
      rolsuper: boolean;
      rolcreatedb: boolean;
      rolcreaterole: boolean;
      rolbypassrls: boolean;
    }>(`
      SELECT rolname, rolcanlogin, rolsuper, rolcreatedb, rolcreaterole, rolbypassrls
      FROM pg_roles
      WHERE rolname = 'bethesda_app_runtime'
    `);
    const roleRow = roleRes.rows[0];
    assert.ok(roleRow, 'El rol bethesda_app_runtime debe existir tras ejecutar el script');
    assert.strictEqual(roleRow.rolcanlogin, true);
    assert.strictEqual(roleRow.rolsuper, false);
    assert.strictEqual(roleRow.rolcreatedb, false);
    assert.strictEqual(roleRow.rolcreaterole, false);
    assert.strictEqual(roleRow.rolbypassrls, false);

    // Verificar privilegios explícitos en las 19 tablas operativas + 2 tablas de auditoría (= 21) + pgboss
    for (const table of ALL_DML_TABLES) {
      const priv = (
        await pool.query(
          `SELECT
             has_table_privilege('bethesda_app_runtime', $1, 'SELECT') AS sel,
             has_table_privilege('bethesda_app_runtime', $1, 'INSERT') AS ins,
             has_table_privilege('bethesda_app_runtime', $1, 'UPDATE') AS upd,
             has_table_privilege('bethesda_app_runtime', $1, 'DELETE') AS del,
             has_table_privilege('bethesda_app_runtime', $1, 'TRUNCATE') AS trn`,
          [table]
        )
      ).rows[0];
      assert.strictEqual(priv.sel, true, `${table} debe permitir SELECT`);
      assert.strictEqual(priv.ins, true, `${table} debe permitir INSERT`);
      assert.strictEqual(priv.upd, true, `${table} debe permitir UPDATE`);
      assert.strictEqual(priv.del, true, `${table} debe permitir DELETE`);
      assert.strictEqual(priv.trn, false, `${table} NO debe permitir TRUNCATE`);
    }

    for (const auditTable of APPEND_ONLY_AUDIT_TABLES) {
      const priv = (
        await pool.query(
          `SELECT
             has_table_privilege('bethesda_app_runtime', $1, 'SELECT') AS sel,
             has_table_privilege('bethesda_app_runtime', $1, 'INSERT') AS ins,
             has_table_privilege('bethesda_app_runtime', $1, 'UPDATE') AS upd,
             has_table_privilege('bethesda_app_runtime', $1, 'DELETE') AS del,
             has_table_privilege('bethesda_app_runtime', $1, 'TRUNCATE') AS trn`,
          [auditTable]
        )
      ).rows[0];
      assert.strictEqual(priv.sel, true, `${auditTable} debe permitir SELECT`);
      assert.strictEqual(priv.ins, true, `${auditTable} debe permitir INSERT`);
      assert.strictEqual(priv.upd, false, `${auditTable} NO debe permitir UPDATE`);
      assert.strictEqual(priv.del, false, `${auditTable} NO debe permitir DELETE`);
      assert.strictEqual(priv.trn, false, `${auditTable} NO debe permitir TRUNCATE`);
    }

    const schemaPrivs = (
      await pool.query(`
        SELECT
          has_schema_privilege('bethesda_app_runtime', 'public', 'USAGE') AS pub_usage,
          has_schema_privilege('bethesda_app_runtime', 'public', 'CREATE') AS pub_create,
          has_schema_privilege('bethesda_app_runtime', 'pgboss', 'USAGE') AS pgb_usage,
          has_schema_privilege('bethesda_app_runtime', 'pgboss', 'CREATE') AS pgb_create,
          has_table_privilege('bethesda_app_runtime', 'pgboss.job', 'SELECT,INSERT,UPDATE,DELETE') AS pgb_job_dml
      `)
    ).rows[0];
    assert.strictEqual(schemaPrivs.pub_usage, true);
    assert.strictEqual(schemaPrivs.pub_create, false);
    assert.strictEqual(schemaPrivs.pgb_usage, true);
    assert.strictEqual(schemaPrivs.pgb_create, false);
    assert.strictEqual(schemaPrivs.pgb_job_dml, true);

    const runtimeUrl = new URL(env.TEST_DATABASE_URL as string);
    runtimeUrl.username = 'bethesda_app_runtime';
    runtimeUrl.password = ephemeralPassword;
    runtimePool = new pg.Pool({ connectionString: runtimeUrl.toString() });

    // Negativo: arranque rechaza superusuario y acepta bethesda_app_runtime
    await assert.rejects(
      async () => assertNonSuperuserRuntimeRole(pool, { enforceInAllEnvs: true }),
      /Invariante de Seguridad Violada/
    );
    await assert.doesNotReject(
      async () => assertNonSuperuserRuntimeRole(runtimePool!, { enforceInAllEnvs: true })
    );

    // Negativo DDL: CREATE TABLE, ALTER TABLE, DROP TABLE, CREATE SCHEMA denegados
    await assert.rejects(
      async () => runtimePool!.query('CREATE TABLE public.unauthorized_ddl_probe (id int)'),
      (err: any) => err.code === '42501'
    );
    await assert.rejects(
      async () => runtimePool!.query('ALTER TABLE public.songs ADD COLUMN unauthorized_col text'),
      (err: any) => err.code === '42501'
    );
    await assert.rejects(
      async () => runtimePool!.query('DROP TABLE public.songs'),
      (err: any) => err.code === '42501'
    );
    await assert.rejects(
      async () => runtimePool!.query('CREATE SCHEMA unauthorized_schema'),
      (err: any) => err.code === '42501'
    );

    // Negativo auditoría: UPDATE / DELETE / TRUNCATE denegados en audit_logs y omr_audit_history
    await assert.rejects(
      async () => runtimePool!.query("UPDATE public.audit_logs SET resource = 'tampered'"),
      (err: any) => err.code === '42501'
    );
    await assert.rejects(
      async () => runtimePool!.query('DELETE FROM public.audit_logs'),
      (err: any) => err.code === '42501'
    );
    await assert.rejects(
      async () => runtimePool!.query('TRUNCATE public.audit_logs'),
      (err: any) => err.code === '42501'
    );
    await assert.rejects(
      async () => runtimePool!.query("UPDATE public.omr_audit_history SET reason = 'tampered'"),
      (err: any) => err.code === '42501' || err.code === '55000'
    );
    await assert.rejects(
      async () => runtimePool!.query('DELETE FROM public.omr_audit_history'),
      (err: any) => err.code === '42501' || err.code === '55000'
    );
    await assert.rejects(
      async () => runtimePool!.query('TRUNCATE public.omr_audit_history'),
      (err: any) => err.code === '42501' || err.code === '55000'
    );
  });
});
