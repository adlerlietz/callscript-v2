-- =============================================================================
-- Migration 25: Enforce NOT NULL on org_id Columns
-- =============================================================================
-- WARNING: Only run this AFTER migration 24 backfill is complete!
-- This migration should be run during a maintenance window.
-- =============================================================================

-- ============================================================================
-- PRE-CHECK: Verify no NULL org_ids remain
-- ============================================================================

DO $$
DECLARE
    v_null_calls INTEGER;
    v_null_campaigns INTEGER;
    v_null_settings INTEGER;
    v_null_api_keys INTEGER;
BEGIN
    SELECT COUNT(*) INTO v_null_calls FROM core.calls WHERE org_id IS NULL;
    SELECT COUNT(*) INTO v_null_campaigns FROM core.campaigns WHERE org_id IS NULL;
    SELECT COUNT(*) INTO v_null_settings FROM core.settings WHERE org_id IS NULL;
    SELECT COUNT(*) INTO v_null_api_keys FROM core.api_keys WHERE org_id IS NULL;

    IF v_null_calls > 0 OR v_null_campaigns > 0 OR v_null_settings > 0 OR v_null_api_keys > 0 THEN
        RAISE EXCEPTION 'Cannot enforce NOT NULL: NULL org_id values exist. Calls: %, Campaigns: %, Settings: %, API Keys: %',
            v_null_calls, v_null_campaigns, v_null_settings, v_null_api_keys;
    END IF;

    RAISE NOTICE 'Pre-check passed. No NULL org_id values found.';
END $$;

-- ============================================================================
-- STEP 1: Enforce NOT NULL on calls
-- ============================================================================

ALTER TABLE core.calls ALTER COLUMN org_id SET NOT NULL;

-- ============================================================================
-- STEP 2: Enforce NOT NULL on campaigns
-- ============================================================================

ALTER TABLE core.campaigns ALTER COLUMN org_id SET NOT NULL;

-- ============================================================================
-- STEP 3: Enforce NOT NULL on settings
-- ============================================================================

ALTER TABLE core.settings ALTER COLUMN org_id SET NOT NULL;

-- ============================================================================
-- STEP 4: Enforce NOT NULL on api_keys
-- ============================================================================

ALTER TABLE core.api_keys ALTER COLUMN org_id SET NOT NULL;

-- ============================================================================
-- STEP 5: Enforce NOT NULL on webhook_logs
-- ============================================================================

ALTER TABLE core.webhook_logs ALTER COLUMN org_id SET NOT NULL;

-- ============================================================================
-- NOTE: qa_rules.org_id stays NULLABLE because system rules have NULL org_id
-- ============================================================================

-- ============================================================================
-- STEP 6: Update unique indexes to remove COALESCE (no longer needed)
-- ============================================================================

-- Drop old indexes with COALESCE
DROP INDEX IF EXISTS core.calls_org_ringba_unique;
DROP INDEX IF EXISTS core.campaigns_org_ringba_unique;
DROP INDEX IF EXISTS core.qa_rules_org_slug_unique;
DROP INDEX IF EXISTS core.settings_org_key_unique;

-- Recreate with direct column references (better performance)
CREATE UNIQUE INDEX calls_org_ringba_unique ON core.calls(org_id, ringba_call_id);
CREATE UNIQUE INDEX campaigns_org_ringba_unique ON core.campaigns(org_id, ringba_campaign_id);

-- For qa_rules, keep COALESCE since org_id can be NULL for system rules
CREATE UNIQUE INDEX qa_rules_org_slug_unique
ON core.qa_rules(COALESCE(org_id, '00000000-0000-0000-0000-000000000000'::uuid), slug);

-- Settings unique constraint
CREATE UNIQUE INDEX settings_org_key_unique ON core.settings(org_id, key);

-- ============================================================================
-- POST-CHECK: Verify constraints are in place
-- ============================================================================

DO $$
BEGIN
    RAISE NOTICE 'NOT NULL constraints enforced successfully.';
    RAISE NOTICE 'Multi-tenant database schema is now complete.';
END $$;

-- ============================================================================
-- Done. Multi-tenant database migration complete.
-- ============================================================================
