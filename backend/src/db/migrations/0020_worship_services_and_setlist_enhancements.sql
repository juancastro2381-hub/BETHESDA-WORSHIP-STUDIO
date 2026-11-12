-- Migration 0020: Worship Services & Setlist Enhancements (Phase 2C)
-- Incorpora la gestión litúrgica de Cultos/Eventos y enriquece los ítems de setlist y plantillas.

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'worship_service_status') THEN
        CREATE TYPE worship_service_status AS ENUM (
            'DRAFT',
            'UPCOMING',
            'ACTIVE',
            'COMPLETED',
            'ARCHIVED'
        );
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS worship_services (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    description TEXT,
    service_type VARCHAR(64) NOT NULL DEFAULT 'Culto General',
    scheduled_at TIMESTAMP WITH TIME ZONE NOT NULL,
    worship_leader_id UUID REFERENCES users(id) ON DELETE SET NULL,
    notes TEXT,
    status worship_service_status NOT NULL DEFAULT 'DRAFT',
    setlist_id UUID REFERENCES setlists(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_worship_services_status ON worship_services (status);
CREATE INDEX IF NOT EXISTS idx_worship_services_scheduled ON worship_services (scheduled_at);
CREATE INDEX IF NOT EXISTS idx_worship_services_leader ON worship_services (worship_leader_id);
CREATE INDEX IF NOT EXISTS idx_worship_services_setlist ON worship_services (setlist_id);
CREATE INDEX IF NOT EXISTS idx_worship_services_type ON worship_services (service_type);

-- Reusable setlists / templates
ALTER TABLE setlists ADD COLUMN IF NOT EXISTS is_template BOOLEAN NOT NULL DEFAULT FALSE;
CREATE INDEX IF NOT EXISTS idx_setlists_is_template ON setlists (is_template);

-- Enhanced musical configuration per setlist item
ALTER TABLE setlist_items ADD COLUMN IF NOT EXISTS preferred_instrument VARCHAR(64);
ALTER TABLE setlist_items ADD COLUMN IF NOT EXISTS preferred_tuning VARCHAR(64);
ALTER TABLE setlist_items ADD COLUMN IF NOT EXISTS preferred_format VARCHAR(32);

