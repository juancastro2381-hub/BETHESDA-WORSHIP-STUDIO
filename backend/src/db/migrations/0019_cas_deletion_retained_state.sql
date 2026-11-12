-- Migration 0019: CAS Deletion Retained State and Granular Companion Tracking (Phase 2B.1 Closure)
-- Agrega el estado 'RETAINED' al enum cas_deletion_state para modelar cancelaciones legítimas
-- donde un objeto CAS no debe eliminarse por la existencia de referencias activas concurrentes.
-- Agrega columnas para rastrear el progreso independiente de desvinculación física de artefactos primarios y canónicos.

ALTER TYPE cas_deletion_state ADD VALUE IF NOT EXISTS 'RETAINED';
ALTER TYPE cas_deletion_state ADD VALUE IF NOT EXISTS 'CANCELLED';

ALTER TABLE cas_deletion_intents
    ADD COLUMN IF NOT EXISTS canonical_key VARCHAR(512),
    ADD COLUMN IF NOT EXISTS primary_deleted BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS companion_deleted BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS primary_error TEXT,
    ADD COLUMN IF NOT EXISTS companion_error TEXT;

CREATE INDEX IF NOT EXISTS idx_cas_deletion_intents_canonical_key ON cas_deletion_intents (canonical_key);

