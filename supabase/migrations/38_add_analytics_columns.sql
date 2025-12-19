-- =============================================================================
-- Migration 38: Add Analytics Columns for Publisher/Buyer/Target Dimensions
-- =============================================================================
-- Phase 1 of the CallScript V2 Analytics Refactor
--
-- Purpose: Capture previously-dropped Ringba fields to enable:
--   - Publisher analytics (attribution, performance)
--   - Buyer/Target analytics (routing analysis)
--   - Profit calculations (revenue - payout)
--   - State-level compliance analytics
--   - Raw payload retention for forensics/future fields
--
-- Safety: All columns are NULLABLE with no constraints.
--         Existing queries will continue to work unchanged.
-- =============================================================================

-- Publisher attribution
ALTER TABLE core.calls
    ADD COLUMN IF NOT EXISTS publisher_id TEXT;

ALTER TABLE core.calls
    ADD COLUMN IF NOT EXISTS publisher_sub_id TEXT;

-- Buyer/Target routing
ALTER TABLE core.calls
    ADD COLUMN IF NOT EXISTS buyer_name TEXT;

ALTER TABLE core.calls
    ADD COLUMN IF NOT EXISTS target_id TEXT;

ALTER TABLE core.calls
    ADD COLUMN IF NOT EXISTS target_name TEXT;

-- Financial: payout enables profit calculation (revenue - payout)
ALTER TABLE core.calls
    ADD COLUMN IF NOT EXISTS payout NUMERIC(12,4) DEFAULT 0;

-- Geographic: enables state-level compliance analytics
ALTER TABLE core.calls
    ADD COLUMN IF NOT EXISTS caller_state TEXT;

ALTER TABLE core.calls
    ADD COLUMN IF NOT EXISTS caller_city TEXT;

-- Raw payload: full Ringba response for forensics and future fields
-- Stored as JSONB for efficient querying if needed
ALTER TABLE core.calls
    ADD COLUMN IF NOT EXISTS raw_payload JSONB;

-- =============================================================================
-- INDEXES (partial, for common query patterns)
-- =============================================================================
-- Only index non-null values to save space

CREATE INDEX IF NOT EXISTS idx_calls_publisher_id
    ON core.calls(publisher_id)
    WHERE publisher_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_calls_caller_state
    ON core.calls(caller_state)
    WHERE caller_state IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_calls_target_id
    ON core.calls(target_id)
    WHERE target_id IS NOT NULL;

-- =============================================================================
-- COMMENTS (for documentation)
-- =============================================================================
COMMENT ON COLUMN core.calls.publisher_id IS 'Ringba publisherId - traffic source identifier';
COMMENT ON COLUMN core.calls.publisher_sub_id IS 'Ringba publisherSubId - affiliate sub-ID for granular attribution';
COMMENT ON COLUMN core.calls.buyer_name IS 'Ringba buyer - the buyer who received the call';
COMMENT ON COLUMN core.calls.target_id IS 'Ringba targetId - specific target/agent that handled the call';
COMMENT ON COLUMN core.calls.target_name IS 'Ringba targetName - human-readable target name';
COMMENT ON COLUMN core.calls.payout IS 'Ringba payoutAmount - cost to acquire this call. Profit = revenue - payout';
COMMENT ON COLUMN core.calls.caller_state IS 'Ringba state - caller geographic state (for compliance analytics)';
COMMENT ON COLUMN core.calls.caller_city IS 'Ringba city - caller geographic city';
COMMENT ON COLUMN core.calls.raw_payload IS 'Complete Ringba API response for this call (forensics/future-proofing)';

-- =============================================================================
-- VERIFICATION (run after migration)
-- =============================================================================
-- SELECT column_name, data_type, is_nullable
-- FROM information_schema.columns
-- WHERE table_schema = 'core' AND table_name = 'calls'
-- AND column_name IN ('publisher_id', 'publisher_sub_id', 'buyer_name',
--                     'target_id', 'target_name', 'payout',
--                     'caller_state', 'caller_city', 'raw_payload');
-- Expected: 9 rows, all nullable
-- =============================================================================
