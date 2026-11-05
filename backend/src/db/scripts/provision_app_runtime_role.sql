-- ============================================================================
-- SCRIPT DE PROVISIÓN DE ROL DE EJECUCIÓN (LEAST PRIVILEGE)
-- Bethesda Worship Studio - Phase 1A-R3.2
-- ============================================================================
-- Este script debe ser ejecutado por un Administrador de Base de Datos (DBA)
-- o superusuario de PostgreSQL durante el aprovisionamiento de la infraestructura.
--
-- Separa formalmente las responsabilidades:
-- 1. Rol Propietario / Migraciones (e.g. postgres o bethesda_migration_user):
--    Aplica migraciones DDL, posee tablas, funciones y triggers.
-- 2. Rol de Ejecución de Aplicación (bethesda_app_runtime):
--    Utilizado por el pool de la aplicación para operaciones DML ordinarias.
--    NO posee tablas ni triggers, NO tiene permisos de TRUNCATE, ALTER ni DROP.
--    En omr_audit_history tiene ÚNICAMENTE permisos de SELECT e INSERT.
--
-- USO RECOMENDADO EN PRODUCCIÓN:
--   psql -U postgres -d bethesda_worship_prod -v APP_RUNTIME_PASSWORD="'${SECURE_RUNTIME_PASSWORD}'" -f provision_app_runtime_role.sql
-- ============================================================================

-- 1. Crear el rol de ejecución sin privilegios de superusuario ni creación de BD
-- La contraseña se suministra obligatoriamente a través de variables de entorno o secret manager.
\if :{?APP_RUNTIME_PASSWORD}
  DO $$
  BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'bethesda_app_runtime') THEN
      EXECUTE format('CREATE ROLE bethesda_app_runtime WITH LOGIN PASSWORD %L', :'APP_RUNTIME_PASSWORD');
    ELSE
      EXECUTE format('ALTER ROLE bethesda_app_runtime WITH PASSWORD %L', :'APP_RUNTIME_PASSWORD');
    END IF;
  END
  $$;
\else
  -- Fallback declarativo informativo si se ejecuta sin psql -v (requiere ALTER ROLE manual previo a uso)
  DO $$
  BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'bethesda_app_runtime') THEN
      CREATE ROLE bethesda_app_runtime WITH LOGIN;
      RAISE NOTICE 'Rol bethesda_app_runtime creado sin contraseña predefinida. Asigne una contraseña segura mediante secret manager antes de iniciar la aplicación.';
    END IF;
  END
  $$;
\endif

-- 2. Otorgar permisos de conexión y uso de esquema
GRANT CONNECT ON DATABASE bethesda_worship_dev TO bethesda_app_runtime;
GRANT USAGE ON SCHEMA public TO bethesda_app_runtime;

-- 3. Permisos DML explícitos y documentados tabla por tabla en el catálogo de negocio
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE 
  users, 
  songs, 
  song_versions, 
  audio_assets, 
  multitrack_sessions, 
  multitrack_tracks, 
  omr_proposals, 
  omr_proposal_measures, 
  background_jobs 
TO bethesda_app_runtime;

-- 4. Permisos de uso de secuencias para identificadores autonuméricos
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO bethesda_app_runtime;

-- 5. Endurecimiento estricto de omr_audit_history (CERO UPDATE, CERO DELETE, CERO TRUNCATE)
REVOKE ALL ON TABLE omr_audit_history FROM bethesda_app_runtime;
REVOKE ALL ON TABLE omr_audit_history FROM PUBLIC;
GRANT SELECT, INSERT ON TABLE omr_audit_history TO bethesda_app_runtime;

-- 6. Denegación de alteración de triggers y funciones de auditoría
REVOKE ALL ON FUNCTION trg_prevent_omr_audit_modification() FROM PUBLIC;
REVOKE ALL ON FUNCTION trg_prevent_omr_audit_modification() FROM bethesda_app_runtime;
GRANT EXECUTE ON FUNCTION trg_prevent_omr_audit_modification() TO bethesda_app_runtime;

-- 7. Asegurar que futuras tablas mantengan permisos DML explícitos y no comprometan omr_audit_history
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM PUBLIC;
