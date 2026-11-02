-- Fase 1A-R2: Inmutabilidad física de auditoría e Idempotencia de compromiso canónico
-- 1. Añadir columna canonical_song_id a omr_proposals para garantizar idempotencia (R2-06)
ALTER TABLE "omr_proposals" ADD COLUMN IF NOT EXISTS "canonical_song_id" uuid REFERENCES "public"."songs"("id") ON DELETE set null;
CREATE UNIQUE INDEX IF NOT EXISTS "idx_omr_proposals_canonical_song_id" ON "omr_proposals" ("canonical_song_id");

-- 2. Gatillo (trigger) a nivel de PostgreSQL para garantizar inmutabilidad física de omr_audit_history (R2-05)
-- Prohíbe cualquier operación de UPDATE o DELETE en el historial de auditoría
CREATE OR REPLACE FUNCTION trg_prevent_omr_audit_modification()
RETURNS TRIGGER AS $$
BEGIN
  IF current_setting('app.allow_audit_cleanup', true) = 'true' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'omr_audit_history records are immutable: UPDATE and DELETE operations are strictly prohibited'
    USING ERRCODE = '55000';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_omr_audit_immutability ON "omr_audit_history";
CREATE TRIGGER trg_omr_audit_immutability
BEFORE UPDATE OR DELETE ON "omr_audit_history"
FOR EACH ROW
EXECUTE FUNCTION trg_prevent_omr_audit_modification();
