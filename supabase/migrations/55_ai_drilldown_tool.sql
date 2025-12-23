-- =============================================================================
-- Migration 55: AI Drill Down Tool - Breakdown Analysis
-- =============================================================================
-- Purpose: Enable the AI to explain WHY a metric is high/low by breaking it
--          down by another dimension.
-- Example: "Why is Florida the top state?" → Break down FL by publisher
-- =============================================================================

CREATE OR REPLACE FUNCTION core.get_breakdown_analysis(
  p_org_id UUID,
  p_dimension TEXT,        -- The context we're analyzing: 'state', 'publisher', etc.
  p_filter_value TEXT,     -- The specific value: 'FL', 'Medicare Inc', etc.
  p_breakdown_by TEXT,     -- What to split by: 'publisher', 'campaign', etc.
  p_metric TEXT,           -- 'revenue', 'profit', 'calls', 'rpc'
  p_start_date DATE,
  p_end_date DATE
)
RETURNS TABLE(
  name TEXT,
  value NUMERIC,
  total_calls BIGINT,
  contribution_pct NUMERIC
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = core, public
AS $$
BEGIN
  -- Validate dimension parameter
  IF p_dimension NOT IN ('publisher', 'buyer', 'campaign', 'vertical', 'state') THEN
    RAISE EXCEPTION 'Invalid dimension: %. Must be one of: publisher, buyer, campaign, vertical, state', p_dimension;
  END IF;

  -- Validate breakdown_by parameter
  IF p_breakdown_by NOT IN ('publisher', 'buyer', 'campaign', 'vertical', 'state') THEN
    RAISE EXCEPTION 'Invalid breakdown_by: %. Must be one of: publisher, buyer, campaign, vertical, state', p_breakdown_by;
  END IF;

  -- Validate metric parameter
  IF p_metric NOT IN ('revenue', 'profit', 'calls', 'rpc') THEN
    RAISE EXCEPTION 'Invalid metric: %. Must be one of: revenue, profit, calls, rpc', p_metric;
  END IF;

  RETURN QUERY
  WITH filtered_data AS (
    SELECT
      -- Dynamic grouping column (safe from SQL injection via CASE)
      CASE p_breakdown_by
        WHEN 'publisher' THEN COALESCE(c.publisher_name, c.publisher_id, 'Unknown')
        WHEN 'buyer' THEN COALESCE(c.buyer_name, 'Unknown')
        WHEN 'campaign' THEN COALESCE(c.campaign_name, 'Unknown')
        WHEN 'vertical' THEN COALESCE(c.vertical, 'Unknown')
        WHEN 'state' THEN COALESCE(c.caller_state, 'Unknown')
      END AS breakdown_name,
      c.revenue,
      c.payout,
      c.status
    FROM core.calls c
    WHERE c.org_id = p_org_id
      AND c.start_time_utc::date BETWEEN p_start_date AND p_end_date
      -- Dynamic filter column (safe from SQL injection via CASE)
      AND CASE p_dimension
        WHEN 'publisher' THEN COALESCE(c.publisher_name, c.publisher_id)
        WHEN 'buyer' THEN c.buyer_name
        WHEN 'campaign' THEN c.campaign_name
        WHEN 'vertical' THEN c.vertical
        WHEN 'state' THEN c.caller_state
      END = p_filter_value
  ),
  aggregated AS (
    SELECT
      breakdown_name AS name,
      CASE p_metric
        WHEN 'revenue' THEN COALESCE(SUM(revenue), 0)
        WHEN 'profit' THEN COALESCE(SUM(revenue), 0) - COALESCE(SUM(payout), 0)
        WHEN 'calls' THEN COUNT(*)::numeric
        WHEN 'rpc' THEN
          CASE WHEN COUNT(*) > 0
            THEN ROUND(COALESCE(SUM(revenue), 0) / COUNT(*), 2)
            ELSE 0
          END
      END AS value,
      COUNT(*) AS total_calls
    FROM filtered_data
    GROUP BY breakdown_name
    HAVING COUNT(*) >= 1  -- Exclude empty groups
  )
  SELECT
    a.name,
    a.value,
    a.total_calls,
    -- Calculate contribution percentage using window function
    CASE
      WHEN SUM(a.value) OVER() > 0
      THEN ROUND((a.value / SUM(a.value) OVER() * 100)::numeric, 1)
      ELSE 0
    END AS contribution_pct
  FROM aggregated a
  ORDER BY a.value DESC
  LIMIT 25;  -- Safety: max 25 entries
END;
$$;

COMMENT ON FUNCTION core.get_breakdown_analysis IS
'AI Tool: Drill down into a specific entity to explain its performance.
Parameters:
  - p_dimension: The entity type being analyzed (publisher, buyer, campaign, vertical, state)
  - p_filter_value: The specific entity value (e.g., "FL" for Florida)
  - p_breakdown_by: What to break it down by (publisher, buyer, campaign, vertical, state)
  - p_metric: The metric to analyze (revenue, profit, calls, rpc)
Example: Break down Florida by publisher to see who drives that state''s traffic.';

-- Grant execute permission
GRANT EXECUTE ON FUNCTION core.get_breakdown_analysis(UUID, TEXT, TEXT, TEXT, TEXT, DATE, DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION core.get_breakdown_analysis(UUID, TEXT, TEXT, TEXT, TEXT, DATE, DATE) TO service_role;

-- Revoke from anon (defense in depth)
REVOKE EXECUTE ON FUNCTION core.get_breakdown_analysis(UUID, TEXT, TEXT, TEXT, TEXT, DATE, DATE) FROM anon;

-- =============================================================================
-- Example queries this enables:
-- =============================================================================
-- "Why is Florida the top state?"
--   get_breakdown_analysis(org_id, 'state', 'FL', 'publisher', 'rpc', start, end)
--
-- "What's driving Medicare Inc's revenue?"
--   get_breakdown_analysis(org_id, 'publisher', 'Medicare Inc', 'campaign', 'revenue', start, end)
--
-- "Which states contribute most to this campaign?"
--   get_breakdown_analysis(org_id, 'campaign', 'ACA Summer', 'state', 'calls', start, end)
-- =============================================================================
