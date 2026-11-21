-- Migration 0010: True Audit Immutability and Canonical Commit Traceability
-- Bethesda Worship Studio - Phase 1A-R3

-- 1. Eliminar temporalmente el trigger existente para reconciliación idempotente
DROP TRIGGER IF EXISTS trg_omr_audit_immutability ON "omr_audit_history";

-- 2. Reconciliar referencias huérfanas preexistentes en entornos heredados antes de aplicar ON DELETE RESTRICT
UPDATE "omr_audit_history" 
  SET "user_id" = NULL 
  WHERE "user_id" IS NOT NULL 
    AND "user_id" NOT IN (SELECT "id" FROM "users");

-- 3. Crear función de trigger de auditoría incondicionalmente inmutable (CERO bypass)
CREATE OR REPLACE FUNCTION trg_prevent_omr_audit_modification()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'omr_audit_history records are immutable: UPDATE and DELETE operations are strictly prohibited'
        USING ERRCODE = '55000'; -- 55000: OBJECT NOT IN PREREQUISITE STATE
END;
$$ LANGUAGE plpgsql;

-- 4. Instalar trigger inmutable incondicional
CREATE TRIGGER trg_omr_audit_immutability
BEFORE UPDATE OR DELETE ON "omr_audit_history"
FOR EACH ROW
EXECUTE FUNCTION trg_prevent_omr_audit_modification();

-- 5. Endurecer integridad referencial de la canción canónica generada (ON DELETE RESTRICT)
ALTER TABLE "omr_proposals" 
  DROP CONSTRAINT IF EXISTS "omr_proposals_canonical_song_id_songs_id_fk";
ALTER TABLE "omr_proposals" 
  DROP CONSTRAINT IF EXISTS "omr_proposals_canonical_song_id_fkey";

ALTER TABLE "omr_proposals" 
  ADD CONSTRAINT "omr_proposals_canonical_song_id_songs_id_fk" 
  FOREIGN KEY ("canonical_song_id") REFERENCES "songs"("id") ON DELETE RESTRICT;

-- 6. Endurecer integridad referencial del usuario en el historial de auditoría (ON DELETE RESTRICT)
ALTER TABLE "omr_audit_history" 
  DROP CONSTRAINT IF EXISTS "omr_audit_history_user_id_users_id_fk";
ALTER TABLE "omr_audit_history" 
  DROP CONSTRAINT IF EXISTS "omr_audit_history_user_id_fkey";

ALTER TABLE "omr_audit_history" 
  ADD CONSTRAINT "omr_audit_history_user_id_users_id_fk" 
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT;
