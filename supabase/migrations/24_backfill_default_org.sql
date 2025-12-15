-- =============================================================================
-- Migration 24: Backfill Existing Data to Default Organization
-- =============================================================================
-- Creates a default organization and assigns all existing data to it.
-- This maintains backwards compatibility with single-tenant deployment.
-- =============================================================================

-- ============================================================================
-- STEP 1: Create default organization (if not exists)
-- ============================================================================

INSERT INTO core.organizations (
    id,
    name,
    slug,
    plan,
    is_active,
    created_at,
    updated_at
) VALUES (
    '00000000-0000-0000-0000-000000000001',
    'Default Organization',
    'default',
    'pro',
    true,
    now(),
    now()
) ON CONFLICT (id) DO NOTHING;

-- Also handle slug conflict
INSERT INTO core.organizations (
    id,
    name,
    slug,
    plan,
    is_active,
    created_at,
    updated_at
) VALUES (
    '00000000-0000-0000-0000-000000000001',
    'Default Organization',
    'default',
    'pro',
    true,
    now(),
    now()
) ON CONFLICT (slug) DO NOTHING;

-- ============================================================================
-- STEP 2: Backfill calls table
-- ============================================================================

UPDATE core.calls
SET org_id = '00000000-0000-0000-0000-000000000001'
WHERE org_id IS NULL;

-- ============================================================================
-- STEP 3: Backfill campaigns table
-- ============================================================================

UPDATE core.campaigns
SET org_id = '00000000-0000-0000-0000-000000000001'
WHERE org_id IS NULL;

-- ============================================================================
-- STEP 4: Backfill settings table
-- ============================================================================

UPDATE core.settings
SET org_id = '00000000-0000-0000-0000-000000000001'
WHERE org_id IS NULL;

-- ============================================================================
-- STEP 5: Backfill api_keys table
-- ============================================================================

UPDATE core.api_keys
SET org_id = '00000000-0000-0000-0000-000000000001'
WHERE org_id IS NULL;

-- ============================================================================
-- STEP 6: Backfill webhook_logs table
-- ============================================================================

UPDATE core.webhook_logs
SET org_id = '00000000-0000-0000-0000-000000000001'
WHERE org_id IS NULL;

-- ============================================================================
-- STEP 7: Backfill qa_rules custom rules (system rules stay NULL)
-- ============================================================================

-- Custom rules should belong to default org
UPDATE core.qa_rules
SET org_id = '00000000-0000-0000-0000-000000000001'
WHERE org_id IS NULL AND scope = 'custom';

-- System and vertical rules stay with NULL org_id (they're global)

-- ============================================================================
-- STEP 8: Create default organization member for existing users
-- This ensures existing authenticated users can access the default org
-- ============================================================================

-- Note: You may need to manually add users to the organization_members table
-- or handle this via the auth hook when they first log in.

-- Example (uncomment and modify as needed):
-- INSERT INTO core.organization_members (org_id, user_id, role, accepted_at)
-- SELECT
--     '00000000-0000-0000-0000-000000000001',
--     id,
--     'owner',
--     now()
-- FROM auth.users
-- WHERE id NOT IN (SELECT user_id FROM core.organization_members)
-- ON CONFLICT (org_id, user_id) DO NOTHING;

-- ============================================================================
-- STEP 9: Verify backfill completed
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

    IF v_null_calls > 0 THEN
        RAISE NOTICE 'WARNING: % calls still have NULL org_id', v_null_calls;
    END IF;
    IF v_null_campaigns > 0 THEN
        RAISE NOTICE 'WARNING: % campaigns still have NULL org_id', v_null_campaigns;
    END IF;
    IF v_null_settings > 0 THEN
        RAISE NOTICE 'WARNING: % settings still have NULL org_id', v_null_settings;
    END IF;
    IF v_null_api_keys > 0 THEN
        RAISE NOTICE 'WARNING: % api_keys still have NULL org_id', v_null_api_keys;
    END IF;

    RAISE NOTICE 'Backfill complete. Default org ID: 00000000-0000-0000-0000-000000000001';
END $$;

-- ============================================================================
-- Done. After verifying data, run migration 25 to enforce NOT NULL.
-- ============================================================================
