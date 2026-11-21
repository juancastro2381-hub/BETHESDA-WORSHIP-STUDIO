-- Rollback Migration 0017: Output Storage Architecture and Database TOAST Optimization (Phase 2B.1)
-- Defect 5 Remediation: Fail-closed precondition guard & automated data preservation

DO $$
DECLARE
    v_populated_count integer;
    v_allow_override text := current_setting('bethesda.allow_phase2b1_rollback_data_loss', true);
BEGIN
    SELECT count(*) INTO v_populated_count
    FROM background_jobs
    WHERE output_storage_key IS NOT NULL;

    IF v_populated_count > 0 AND (v_allow_override IS NULL OR v_allow_override <> 'TRUE') THEN
        RAISE EXCEPTION 'PRECONDITION FAILED: No se pueden eliminar las columnas de almacenamiento externo de la Fase 2B.1. Se detectaron % trabajos con output_storage_key no nulos. Un rollback directo desvincularía irreversiblemente los archivos en almacenamiento externo. Para proceder, ejecute primero el script de preservación o declare explícitamente: SET bethesda.allow_phase2b1_rollback_data_loss = ''TRUE'';', v_populated_count;
    END IF;
END $$;

-- Preservación automática de seguridad en tabla de respaldo histórica antes de modificar el esquema
CREATE TABLE IF NOT EXISTS background_jobs_phase2b1_rollback_backup AS
SELECT id, user_id, status, input_ref, output_ref, output_storage_key,
       output_checksum_sha256, output_byte_length, pruned_at, created_at, completed_at, NOW() AS backed_up_at
FROM background_jobs
WHERE output_storage_key IS NOT NULL;

DROP INDEX IF EXISTS idx_background_jobs_pruned_at;
DROP INDEX IF EXISTS idx_background_jobs_output_checksum;
DROP INDEX IF EXISTS idx_background_jobs_output_storage_key;

ALTER TABLE background_jobs
  DROP COLUMN IF EXISTS pruned_at,
  DROP COLUMN IF EXISTS output_byte_length,
  DROP COLUMN IF EXISTS output_checksum_sha256,
  DROP COLUMN IF EXISTS output_storage_key;


