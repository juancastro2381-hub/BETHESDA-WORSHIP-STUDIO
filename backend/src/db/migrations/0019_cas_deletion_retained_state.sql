-- Migration 0019: CAS Deletion Retained State and Granular Companion Tracking (Phase 2B.1 Closure)
--
-- ENUM LIFECYCLE & SEMANTIC SPECIFICATION:
-- 1. 'RETAINED': Estado transicionado automáticamente por el reconciliador de recuperación
--    (reconcilePendingDeletions) cuando se detecta una referencia activa concurrente en background_jobs
--    o song_sources. Garantiza veracidad en el reporte (el archivo físico no fue borrado, fue conservado).
-- 2. 'CANCELLED': Reservado intencionalmente para cancelaciones administrativas/manuales de intenciones
--    de eliminación (p.ej. anulación por operador o resurrección de tareas antes de podado).
-- 3. Inmutabilidad DDL de Enums en PostgreSQL: Una vez agregados valores a un enum en PostgreSQL,
--    no existe comando 'DROP VALUE' sin reconstruir el tipo completo y todas las tablas dependientes.
--    Los valores permanecen inmutables y seguros sin riesgo para datos existentes.
--
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

