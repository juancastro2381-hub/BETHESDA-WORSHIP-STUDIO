-- Rollback Migration 0018: CAS Deletion State Machine and Intent Log (Phase 2B.1 Deletion Safety Remediation)

DROP INDEX IF EXISTS idx_cas_deletion_intents_key;
DROP INDEX IF EXISTS idx_cas_deletion_intents_state;
DROP TABLE IF EXISTS cas_deletion_intents;
DROP TYPE IF EXISTS cas_deletion_state;
