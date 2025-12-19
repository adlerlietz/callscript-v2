-- =============================================================================
-- Migration 52: Enhanced Leaderboard with Filters and RPC Metric
-- =============================================================================
-- Problem: AI can't answer "best states for Medicare" because:
--   1. Can't filter by vertical (WHERE vertical='medicare')
--   2. Can't calculate RPC (Revenue Per Call) - the real "best" metric
--
-- Solution: Add optional filter parameters and RPC metric to get_leaderboard
-- =============================================================================

-- Drop and recreate with new signature
DROP FUNCTION IF EXISTS core.get_leaderboard(UUID, TEXT, TEXT, DATE, DATE);

CREATE OR REPLACE FUNCTION core.get_leaderboard(
  p_org_id UUID,
  p_dimension TEXT,
  p_metric TEXT,
  p_start_date DATE,
  p_end_date DATE,
  p_vertical_filter TEXT DEFAULT NULL,
  p_state_filter TEXT DEFAULT NULL,
  p_min_calls INTEGER DEFAULT 10
)
RETURNS TABLE(name TEXT, value NUMERIC, total_calls BIGINT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = core, public
AS $$
BEGIN
  -- Validate dimension parameter
  IF p_dimension NOT IN ('publisher', 'buyer', 'campaign', 'state', 'vertical') THEN
    RAISE EXCEPTION 'Invalid dimension: %. Must be one of: publisher, buyer, campaign, state, vertical', p_dimension;
  END IF;

  -- Validate metric parameter (added 'rpc')
  IF p_metric NOT IN ('revenue', 'profit', 'calls', 'flag_rate', 'rpc') THEN
    RAISE EXCEPTION 'Invalid metric: %. Must be one of: revenue, profit, calls, flag_rate, rpc', p_metric;
  END IF;

  RETURN QUERY
  SELECT
    CASE p_dimension
      WHEN 'publisher' THEN COALESCE(c.publisher_name, c.publisher_id, 'Unknown')
      WHEN 'buyer' THEN COALESCE(c.buyer_name, 'Unknown')
      WHEN 'campaign' THEN COALESCE(c.campaign_name, 'Unknown')
      WHEN 'vertical' THEN COALESCE(c.vertical, 'Unknown')
      WHEN 'state' THEN COALESCE(c.caller_state, 'Unknown')
      ELSE 'Unknown'
    END AS name,
    CASE p_metric
      WHEN 'revenue' THEN COALESCE(SUM(c.revenue), 0)
      WHEN 'profit' THEN COALESCE(SUM(c.revenue), 0) - COALESCE(SUM(c.payout), 0)
      WHEN 'calls' THEN COUNT(*)::numeric
      WHEN 'flag_rate' THEN
        CASE WHEN COUNT(*) > 0
          THEN ROUND((COUNT(*) FILTER (WHERE c.status = 'flagged')::numeric / COUNT(*) * 100), 2)
          ELSE 0
        END
      WHEN 'rpc' THEN
        CASE WHEN COUNT(*) > 0
          THEN ROUND(COALESCE(SUM(c.revenue), 0) / COUNT(*), 2)
          ELSE 0
        END
      ELSE COALESCE(SUM(c.revenue), 0)
    END AS value,
    COUNT(*) AS total_calls
  FROM core.calls c
  WHERE c.org_id = p_org_id
    AND c.start_time_utc::date BETWEEN p_start_date AND p_end_date
    -- Optional vertical filter (e.g., 'medicare', 'aca', 'solar')
    AND (p_vertical_filter IS NULL OR LOWER(c.vertical) = LOWER(p_vertical_filter))
    -- Optional state filter (e.g., 'CA', 'TX')
    AND (p_state_filter IS NULL OR UPPER(c.caller_state) = UPPER(p_state_filter))
  GROUP BY 1
  -- For RPC, require minimum calls to avoid misleading single-call outliers
  HAVING (p_metric != 'rpc' OR COUNT(*) >= p_min_calls)
  ORDER BY 2 DESC
  LIMIT 25;
END;
$$;

COMMENT ON FUNCTION core.get_leaderboard IS
'AI Tool: Get top performers by dimension with optional filters.
Dimensions: publisher, buyer, campaign, vertical, state
Metrics: revenue, profit, calls, flag_rate, rpc
Filters: vertical_filter (e.g. medicare), state_filter (e.g. CA)
Note: RPC metric requires min_calls (default 10) to avoid outliers.';

-- =============================================================================
-- Example queries this enables:
-- =============================================================================
-- "Best states for Medicare" (by RPC):
--   get_leaderboard(org_id, 'state', 'rpc', start, end, 'medicare', NULL, 10)
--
-- "Which publishers perform best in California?":
--   get_leaderboard(org_id, 'publisher', 'rpc', start, end, NULL, 'CA', 10)
--
-- "Flag rate by campaign for ACA":
--   get_leaderboard(org_id, 'campaign', 'flag_rate', start, end, 'aca', NULL, 10)
-- =============================================================================
