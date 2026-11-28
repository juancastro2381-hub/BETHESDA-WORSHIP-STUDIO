-- ============================================================================
-- SCRIPT DE PROVISIÓN DE ROL DE EJECUCIÓN (LEAST PRIVILEGE)
-- Bethesda Worship Studio - Phase 1A-R3.2 / GATE 2 REM-01 Hardening
-- ============================================================================
-- Este script debe ser ejecutado por un Administrador de Base de Datos (DBA)
-- o superusuario de PostgreSQL durante el aprovisionamiento de la infraestructura.
--
-- Separa formalmente las responsabilidades:
-- 1. Rol Propietario / Migraciones (e.g. postgres o bethesda_migration_user):
--    Aplica migraciones DDL, posee tablas, funciones y triggers.
-- 2. Rol de Ejecución de Aplicación (bethesda_app_runtime):
--    Utilizado por el pool de la aplicación para operaciones DML ordinarias.
--    NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS.
--    NO posee tablas ni triggers, NO tiene permisos de CREATE, TRUNCATE, ALTER ni DROP.
--    En las tablas de auditoría inmutable (audit_logs, omr_audit_history) tiene
--    ÚNICAMENTE permisos de SELECT e INSERT.
--
-- USO RECOMENDADO EN PRODUCCIÓN / CERTIFICACIÓN:
--   psql -U postgres -d <TARGET_DB> -v APP_RUNTIME_PASSWORD="${SECURE_RUNTIME_PASSWORD}" -f provision_app_runtime_role.sql
-- ============================================================================

-- 1. Crear o actualizar el rol de ejecución sin privilegios administrativos ni DDL
\if :{?APP_RUNTIME_PASSWORD}
  SELECT set_config('app.runtime_password', :'APP_RUNTIME_PASSWORD', false);
  DO $$
  DECLARE
    v_password text := current_setting('app.runtime_password', true);
  BEGIN
    IF v_password IS NULL OR length(v_password) = 0 THEN
      RAISE EXCEPTION 'APP_RUNTIME_PASSWORD no puede estar vacío';
    END IF;
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'bethesda_app_runtime') THEN
      EXECUTE format(
        'CREATE ROLE bethesda_app_runtime WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD %L',
        v_password
      );
    ELSE
      EXECUTE format(
        'ALTER ROLE bethesda_app_runtime WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD %L',
        v_password
      );
    END IF;
  END
  $$;
  SELECT set_config('app.runtime_password', '', false);
\else
  -- Fallback declarativo informativo si se ejecuta sin psql -v (requiere ALTER ROLE manual previo a uso)
  DO $$
  BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'bethesda_app_runtime') THEN
      CREATE ROLE bethesda_app_runtime WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
      RAISE NOTICE 'Rol bethesda_app_runtime creado sin contraseña predefinida. Asigne una contraseña segura mediante secret manager antes de iniciar la aplicación.';
    ELSE
      ALTER ROLE bethesda_app_runtime WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
    END IF;
  END
  $$;
\endif

-- 2. Otorgar permisos de conexión únicamente sobre la base de datos objetivo actual y uso de esquema (CERO CREATE)
DO $$
BEGIN
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO bethesda_app_runtime', current_database());
END
$$;

REVOKE CREATE ON SCHEMA public FROM PUBLIC;
REVOKE CREATE ON SCHEMA public FROM bethesda_app_runtime;
GRANT USAGE ON SCHEMA public TO bethesda_app_runtime;

-- Limpiar privilegios previos sobre tablas de public antes de re-aplicar matriz explícita
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM bethesda_app_runtime;

-- 3. Permisos DML explícitos y documentados sobre las 19 tablas operativas del catálogo (sin DDL ni TRUNCATE)
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  users,
  refresh_tokens,
  password_reset_tokens,
  user_invitations,
  songs,
  song_versions,
  song_sources,
  song_metadata,
  worship_services,
  setlists,
  setlist_items,
  user_view_preferences,
  audio_assets,
  multitrack_sessions,
  multitrack_tracks,
  background_jobs,
  omr_proposals,
  omr_proposal_measures,
  cas_deletion_intents
TO bethesda_app_runtime;

-- 4. Permisos de uso de secuencias en public para identificadores autonuméricos
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO bethesda_app_runtime;

-- 5. Endurecimiento estricto de las 2 tablas de auditoría inmutable (21 tablas en total: 19 DML + 2 append-only)
REVOKE ALL ON TABLE audit_logs FROM PUBLIC;
REVOKE ALL ON TABLE audit_logs FROM bethesda_app_runtime;
GRANT SELECT, INSERT ON TABLE audit_logs TO bethesda_app_runtime;

REVOKE ALL ON TABLE omr_audit_history FROM PUBLIC;
REVOKE ALL ON TABLE omr_audit_history FROM bethesda_app_runtime;
GRANT SELECT, INSERT ON TABLE omr_audit_history TO bethesda_app_runtime;

-- 6. Denegación de alteración de triggers y funciones de auditoría
REVOKE ALL ON FUNCTION trg_prevent_omr_audit_modification() FROM PUBLIC;
REVOKE ALL ON FUNCTION trg_prevent_omr_audit_modification() FROM bethesda_app_runtime;
GRANT EXECUTE ON FUNCTION trg_prevent_omr_audit_modification() TO bethesda_app_runtime;

-- 7. Privilegios mínimos en esquema pgboss (si ya fue inicializado) sin permitir DDL de esquema
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.schemata WHERE schema_name = 'pgboss') THEN
    REVOKE CREATE ON SCHEMA pgboss FROM PUBLIC;
    REVOKE CREATE ON SCHEMA pgboss FROM bethesda_app_runtime;
    GRANT USAGE ON SCHEMA pgboss TO bethesda_app_runtime;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA pgboss TO bethesda_app_runtime;
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA pgboss TO bethesda_app_runtime;
    GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA pgboss TO bethesda_app_runtime;
  END IF;
END
$$;

-- 8. Asegurar que futuras tablas mantengan privilegios cerrados por defecto
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM PUBLIC;
