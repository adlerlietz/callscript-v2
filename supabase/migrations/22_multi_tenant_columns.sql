-- =============================================================================
-- Migration 22: Add org_id to remaining tables for multi-tenancy
-- =============================================================================
-- Adds org_id column to: qa_rules, api_keys, settings, webhook_logs
-- Updates unique constraints for per-org uniqueness
-- =============================================================================

-- ============================================================================
-- STEP 1: Add org_id columns (nullable initially for backwards compatibility)
-- ============================================================================

-- QA Rules: org_id for custom rules (system rules stay NULL)
ALTER TABLE core.qa_rules
ADD COLUMN IF NOT EXISTS org_id UUID REFERENCES core.organizations(id);

-- API Keys: must belong to an org
ALTER TABLE core.api_keys
ADD COLUMN IF NOT EXISTS org_id UUID REFERENCES core.organizations(id);

-- Settings: convert from global singleton to per-org
ALTER TABLE core.settings
ADD COLUMN IF NOT EXISTS org_id UUID REFERENCES core.organizations(id);

-- Webhook Logs: track which org generated the webhook
ALTER TABLE core.webhook_logs
ADD COLUMN IF NOT EXISTS org_id UUID REFERENCES core.organizations(id);

-- ============================================================================
-- STEP 2: Add indexes for org_id queries
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_qa_rules_org_id ON core.qa_rules(org_id);
CREATE INDEX IF NOT EXISTS idx_api_keys_org_id ON core.api_keys(org_id);
CREATE INDEX IF NOT EXISTS idx_settings_org_id ON core.settings(org_id);
CREATE INDEX IF NOT EXISTS idx_webhook_logs_org_id ON core.webhook_logs(org_id);

-- ============================================================================
-- STEP 3: Update unique constraints for per-org uniqueness
-- ============================================================================

-- QA Rules: slug should be unique per-org (system rules have NULL org_id)
-- Drop old constraint and create new one
ALTER TABLE core.qa_rules DROP CONSTRAINT IF EXISTS qa_rules_slug_key;
CREATE UNIQUE INDEX IF NOT EXISTS qa_rules_org_slug_unique
ON core.qa_rules(COALESCE(org_id, '00000000-0000-0000-0000-000000000000'::uuid), slug);

-- Settings: change from global key to per-org key
-- First drop the old primary key
ALTER TABLE core.settings DROP CONSTRAINT IF EXISTS settings_pkey;

-- Add a new id column for primary key
ALTER TABLE core.settings
ADD COLUMN IF NOT EXISTS id UUID DEFAULT gen_random_uuid();

-- Set the id as primary key (only if it's not already)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'settings_pkey' AND conrelid = 'core.settings'::regclass
    ) THEN
        ALTER TABLE core.settings ADD PRIMARY KEY (id);
    END IF;
END $$;

-- Add unique constraint for org_id + key combination
CREATE UNIQUE INDEX IF NOT EXISTS settings_org_key_unique
ON core.settings(COALESCE(org_id, '00000000-0000-0000-0000-000000000000'::uuid), key);

-- ============================================================================
-- STEP 4: Update calls table unique constraint (per-org ringba_call_id)
-- ============================================================================

-- Drop old global unique constraint on ringba_call_id
ALTER TABLE core.calls DROP CONSTRAINT IF EXISTS calls_ringba_call_id_key;

-- Add composite unique constraint (org_id, ringba_call_id)
-- Using COALESCE to handle NULL org_id during transition
CREATE UNIQUE INDEX IF NOT EXISTS calls_org_ringba_unique
ON core.calls(COALESCE(org_id, '00000000-0000-0000-0000-000000000000'::uuid), ringba_call_id);

-- Same for campaigns
ALTER TABLE core.campaigns DROP CONSTRAINT IF EXISTS campaigns_ringba_campaign_id_key;
CREATE UNIQUE INDEX IF NOT EXISTS campaigns_org_ringba_unique
ON core.campaigns(COALESCE(org_id, '00000000-0000-0000-0000-000000000000'::uuid), ringba_campaign_id);

-- ============================================================================
-- Done. Run migration 23 for RLS policies, then 24 for backfill.
-- ============================================================================
