-- Rollback Migration 0020: Worship Services & Setlist Enhancements (Phase 2C)

ALTER TABLE setlist_items DROP COLUMN IF EXISTS preferred_format;
ALTER TABLE setlist_items DROP COLUMN IF EXISTS preferred_tuning;
ALTER TABLE setlist_items DROP COLUMN IF EXISTS preferred_instrument;

DROP INDEX IF EXISTS idx_setlists_is_template;
ALTER TABLE setlists DROP COLUMN IF EXISTS is_template;

DROP TABLE IF EXISTS worship_services;
DROP TYPE IF EXISTS worship_service_status;

