-- =============================================================================
-- Migration 14: Add org_id to Existing Tables
-- =============================================================================
-- Phase A (Part 2): Add NULLABLE columns first
-- Phase B: Backfill data (separate step, run manually)
-- Phase C: Enforce NOT NULL (separate step, needs maintenance window)
-- =============================================================================

-- =============================================================================
-- PHASE A: Add nullable org_id columns (SAFE - no constraints yet)
-- =============================================================================

-- Add to campaigns (if not exists)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'core'
        AND table_name = 'campaigns'
        AND column_name = 'org_id'
    ) THEN
        ALTER TABLE core.campaigns
            ADD COLUMN org_id UUID REFERENCES core.organizations(id);
        RAISE NOTICE 'Added org_id to core.campaigns';
    ELSE
        RAISE NOTICE 'org_id already exists on core.campaigns';
    END IF;
END $$;

-- Add to calls (if not exists)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'core'
        AND table_name = 'calls'
        AND column_name = 'org_id'
    ) THEN
        ALTER TABLE core.calls
            ADD COLUMN org_id UUID REFERENCES core.organizations(id);
        RAISE NOTICE 'Added org_id to core.calls';
    ELSE
        RAISE NOTICE 'org_id already exists on core.calls';
    END IF;
END $$;


-- =============================================================================
-- VERIFICATION QUERY (run after Phase A)
-- =============================================================================
-- Check columns were added:
--
-- SELECT column_name, is_nullable, data_type
-- FROM information_schema.columns
-- WHERE table_schema = 'core'
--   AND table_name IN ('campaigns', 'calls')
--   AND column_name = 'org_id';
--
-- Expected: 2 rows, both is_nullable = 'YES'
-- =============================================================================


-- =============================================================================
-- PHASE B: Backfill (RUN MANUALLY AFTER VERIFICATION)
-- =============================================================================
-- DO NOT UNCOMMENT - Run these manually in SQL editor after Phase A verification
-- =============================================================================

/*
-- Step 1: Create the default organization for existing data
INSERT INTO core.organizations (id, name, slug, plan)
VALUES (
    '00000000-0000-0000-0000-000000000001',
    'CallScript Default',
    'default',
    'pro'
)
ON CONFLICT (slug) DO NOTHING;

-- Step 2: Backfill campaigns
UPDATE core.campaigns
SET org_id = '00000000-0000-0000-0000-000000000001'
WHERE org_id IS NULL;

-- Step 3: Backfill calls (may take a few seconds for large tables)
UPDATE core.calls
SET org_id = '00000000-0000-0000-0000-000000000001'
WHERE org_id IS NULL;

-- Step 4: VERIFY before proceeding to Phase C
SELECT
    'campaigns_null' as check_name,
    COUNT(*) as count
FROM core.campaigns WHERE org_id IS NULL
UNION ALL
SELECT
    'calls_null',
    COUNT(*)
FROM core.calls WHERE org_id IS NULL
UNION ALL
SELECT
    'campaigns_total',
    COUNT(*)
FROM core.campaigns
UNION ALL
SELECT
    'calls_total',
    COUNT(*)
FROM core.calls;

-- Expected: campaigns_null = 0, calls_null = 0
-- Total counts should match what you had before
*/


-- =============================================================================
-- PHASE C: Enforce NOT NULL (RUN AFTER PHASE B VERIFICATION)
-- =============================================================================
-- DO NOT UNCOMMENT - Run these manually during maintenance window
-- Requires: Workers stopped, pg_cron disabled
-- =============================================================================

/*
-- Step 1: Stop workers first!
-- ssh root@<runpod> 'cd /workspace && ./scripts/manage_fleet.sh stop'

-- Step 2: Disable pg_cron jobs temporarily
UPDATE cron.job SET active = false WHERE jobname LIKE '%ringba%' OR jobname LIKE '%vault%';

-- Step 3: Enforce NOT NULL
ALTER TABLE core.campaigns ALTER COLUMN org_id SET NOT NULL;
ALTER TABLE core.calls ALTER COLUMN org_id SET NOT NULL;

-- Step 4: Verify constraints
SELECT
    table_name,
    column_name,
    is_nullable
FROM information_schema.columns
WHERE table_schema = 'core'
  AND table_name IN ('campaigns', 'calls')
  AND column_name = 'org_id';

-- Expected: Both is_nullable = 'NO'

-- Step 5: Re-enable pg_cron
UPDATE cron.job SET active = true WHERE jobname LIKE '%ringba%' OR jobname LIKE '%vault%';

-- Step 6: Restart workers
-- ssh root@<runpod> 'cd /workspace && ./scripts/manage_fleet.sh start'
*/
