-- =============================================================================
-- Migration 15: Multi-Tenant Performance Indexes
-- =============================================================================
-- NOTE: Using regular CREATE INDEX (not CONCURRENTLY) for migration compatibility
-- CONCURRENTLY cannot run inside a transaction/pipeline
-- =============================================================================

-- =============================================================================
-- 1. Primary Queue Index (LIFO + Tenant Isolation)
-- =============================================================================
-- This is THE critical index for worker performance
-- Query pattern: WHERE org_id = ? AND status = 'downloaded' ORDER BY start_time_utc DESC

-- Drop old index that doesn't include org_id
DROP INDEX IF EXISTS core.idx_calls_queue;

-- Create new composite index with org_id first
-- Order matters: org_id filters first (tenant isolation), then status, then LIFO sort
CREATE INDEX IF NOT EXISTS idx_calls_org_queue
    ON core.calls(org_id, status, start_time_utc DESC);

COMMENT ON INDEX core.idx_calls_org_queue IS
    'Primary queue index: enables fast LIFO polling with tenant isolation';


-- =============================================================================
-- 2. Campaign Lookup by Org
-- =============================================================================
CREATE INDEX IF NOT EXISTS idx_campaigns_org_id
    ON core.campaigns(org_id);


-- =============================================================================
-- 3. Calls by Campaign (for analytics)
-- =============================================================================
-- Query pattern: WHERE campaign_id = ? AND org_id = ? (for dashboard)
CREATE INDEX IF NOT EXISTS idx_calls_campaign_org
    ON core.calls(campaign_id, org_id);


-- =============================================================================
-- 4. Calls by Time Range (for dashboard charts)
-- =============================================================================
-- Query pattern: WHERE org_id = ? AND start_time_utc > ?
CREATE INDEX IF NOT EXISTS idx_calls_org_time
    ON core.calls(org_id, start_time_utc DESC);


-- =============================================================================
-- 5. Unique constraint update for ringba_call_id
-- =============================================================================
-- Current: ringba_call_id is globally unique
-- Multi-tenant: ringba_call_id should be unique PER ORG
-- (Two orgs could theoretically have same call ID from different Ringba accounts)

-- NOTE: Only run this AFTER org_id is NOT NULL
-- Commented out for safety - run manually when ready

/*
-- Drop old unique constraint
ALTER TABLE core.calls DROP CONSTRAINT IF EXISTS calls_ringba_call_id_key;

-- Add new composite unique constraint
ALTER TABLE core.calls ADD CONSTRAINT calls_org_ringba_unique
    UNIQUE(org_id, ringba_call_id);
*/


-- =============================================================================
-- VERIFICATION QUERY
-- =============================================================================
-- Check indexes exist:
--
-- SELECT indexname, indexdef
-- FROM pg_indexes
-- WHERE schemaname = 'core'
--   AND tablename IN ('calls', 'campaigns')
--   AND indexname LIKE '%org%';
--
-- Expected: idx_calls_org_queue, idx_campaigns_org_id, idx_calls_campaign_org, idx_calls_org_time
-- =============================================================================
