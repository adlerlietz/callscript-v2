-- =============================================================================
-- Migration 39: Add Computed Profit Column
-- =============================================================================
-- Phase 2 of the CallScript V2 Analytics Refactor
--
-- Purpose: Auto-compute profit (revenue - payout) for every call.
-- This is a GENERATED ALWAYS column - computed on insert/update, not stored
-- until queried (actually STORED means it IS persisted for performance).
--
-- Benefits:
--   - No application code needed to calculate profit
--   - Always consistent (can't get out of sync)
--   - Indexed for fast aggregation queries
--
-- Safety:
--   - Nullable inputs handled with COALESCE
--   - Existing rows will have profit computed automatically
-- =============================================================================

-- Add computed profit column
-- profit = revenue - payout (what we keep after paying the publisher)
ALTER TABLE core.calls
    ADD COLUMN IF NOT EXISTS profit NUMERIC(12,4)
        GENERATED ALWAYS AS (COALESCE(revenue, 0) - COALESCE(payout, 0)) STORED;

-- Index for profit-based queries (e.g., "show me negative profit calls")
CREATE INDEX IF NOT EXISTS idx_calls_profit
    ON core.calls(profit)
    WHERE profit != 0;

-- Comment for documentation
COMMENT ON COLUMN core.calls.profit IS
    'Computed: revenue - payout. Positive = we made money, negative = we lost money.';

-- =============================================================================
-- VERIFICATION (run after migration)
-- =============================================================================
-- SELECT
--     id, revenue, payout, profit,
--     (revenue - payout) as manual_calc,
--     profit = (COALESCE(revenue,0) - COALESCE(payout,0)) as matches
-- FROM core.calls
-- WHERE payout > 0
-- LIMIT 5;
-- Expected: profit column auto-populated, matches = true for all rows
-- =============================================================================
