-- Migration 0011: Audit Least-Privilege Hardening and Function Security
-- Bethesda Worship Studio - Phase 1A-R3.1

-- 1. Recrear la función de trigger con search_path explícito e inmutabilidad garantizada
CREATE OR REPLACE FUNCTION trg_prevent_omr_audit_modification()
RETURNS TRIGGER 
SET search_path = pg_catalog, public
AS $$
BEGIN
    RAISE EXCEPTION 'omr_audit_history records are immutable: UPDATE and DELETE operations are strictly prohibited'
        USING ERRCODE = '55000'; -- 55000: OBJECT NOT IN PREREQUISITE STATE
END;
$$ LANGUAGE plpgsql;

-- 2. Revocar privilegios de mutación destructiva de PUBLIC en omr_audit_history
REVOKE ALL ON "omr_audit_history" FROM PUBLIC;
REVOKE TRUNCATE, UPDATE, DELETE ON "omr_audit_history" FROM PUBLIC;

-- 3. Revocar privilegios de alteración de la función de trigger de PUBLIC
REVOKE ALL ON FUNCTION trg_prevent_omr_audit_modification() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION trg_prevent_omr_audit_modification() TO PUBLIC;

