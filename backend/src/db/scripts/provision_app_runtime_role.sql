-- ============================================================================
-- SCRIPT DE PROVISIÓN DE ROL DE EJECUCIÓN (LEAST PRIVILEGE)
-- Bethesda Worship Studio - Phase 1A-R3.1
-- ============================================================================
-- Este script debe ser ejecutado por un Administrador de Base de Datos (DBA)
-- o superusuario de PostgreSQL durante el aprovisionamiento de la infraestructura.
--
-- Separa las responsabilidades:
-- 1. Rol Propietario / Migraciones (e.g. postgres o bethesda_migration_user):
--    Aplica migraciones DDL, posee tablas, funciones y triggers.
-- 2. Rol de Ejecución en Tiempo de Ejecución (bethesda_app_runtime):
--    Utilizado por el pool de la aplicación para operaciones DML ordinarias.
--    NO posee tablas ni triggers, NO tiene permisos de TRUNCATE, ALTER ni DROP.
--    En omr_audit_history tiene ÚNICAMENTE permisos de SELECT e INSERT.
-- ============================================================================

-- 1. Crear el rol de ejecución sin privilegios de superusuario ni creación de BD
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'bethesda_app_runtime') THEN
    CREATE ROLE bethesda_app_runtime WITH LOGIN PASSWORD 'CAMBIAR_EN_PRODUCCION_MEDIANTE_SECRETO_ENV';
  END IF;
END
$$;

-- 2. Otorgar permisos de conexión y uso de esquema
GRANT CONNECT ON DATABASE bethesda_worship_dev TO bethesda_app_runtime;
GRANT USAGE ON SCHEMA public TO bethesda_app_runtime;

-- 3. Permisos DML en tablas ordinarias del catálogo
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO bethesda_app_runtime;

-- 4. Endurecimiento de omr_audit_history (CERO UPDATE, CERO DELETE, CERO TRUNCATE)
REVOKE ALL ON "omr_audit_history" FROM bethesda_app_runtime;
GRANT SELECT, INSERT ON "omr_audit_history" TO bethesda_app_runtime;

-- 5. Revocar alteración de funciones de auditoría
REVOKE ALL ON FUNCTION trg_prevent_omr_audit_modification() FROM bethesda_app_runtime;
GRANT EXECUTE ON FUNCTION trg_prevent_omr_audit_modification() TO bethesda_app_runtime;

-- 6. Garantizar que futuras tablas mantengan la política de seguridad
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO bethesda_app_runtime;

