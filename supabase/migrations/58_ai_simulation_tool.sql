-- =============================================================================
-- Migration 58: AI Scenario Simulator - "What If" Financial Analysis
-- =============================================================================
-- Purpose: Calculate hypothetical financial impact of payout or revenue changes
--          based on historical data. Read-only simulation - no data is modified.
-- Example: "What if I cut Publisher X's payout by $5?" → Shows profit impact
-- Example: "What if Buyer Y paid $10 more per call?" → Shows profit impact
-- =============================================================================

CREATE OR REPLACE FUNCTION core.get_simulation_impact(
  p_org_id UUID,
  p_target_type TEXT,          -- 'publisher' or 'buyer'
  p_target_id TEXT,            -- Name of the publisher or buyer
  p_change_variable TEXT,      -- 'payout' (for publishers) or 'revenue' (for buyers)
  p_change_amount NUMERIC,     -- Dollar change per call (e.g., -5 = cut $5/call)
  p_lookback_days INT DEFAULT 30
)
RETURNS TABLE(
  target_name TEXT,
  total_calls BIGINT,
  current_revenue NUMERIC,
  current_payout NUMERIC,
  current_profit NUMERIC,
  simulated_revenue NUMERIC,
  simulated_payout NUMERIC,
  simulated_profit NUMERIC,
  profit_change NUMERIC,
  profit_change_pct NUMERIC,
  change_description TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = core, public
AS $$
DECLARE
  v_lookback INT;
BEGIN
  -- Validate target_type parameter
  IF p_target_type NOT IN ('publisher', 'buyer') THEN
    RAISE EXCEPTION 'Invalid target_type: %. Must be one of: publisher, buyer', p_target_type;
  END IF;

  -- Validate change_variable matches target_type
  IF p_target_type = 'publisher' AND p_change_variable != 'payout' THEN
    RAISE EXCEPTION 'For publishers, change_variable must be ''payout''. Got: %', p_change_variable;
  END IF;

  IF p_target_type = 'buyer' AND p_change_variable != 'revenue' THEN
    RAISE EXCEPTION 'For buyers, change_variable must be ''revenue''. Got: %', p_change_variable;
  END IF;

  -- Enforce safety limits
  v_lookback := LEAST(COALESCE(p_lookback_days, 30), 90);

  RETURN QUERY
  WITH target_data AS (
    SELECT
      -- Entity name based on type
      CASE p_target_type
        WHEN 'publisher' THEN COALESCE(c.publisher_name, c.publisher_id, 'Unknown Publisher')
        WHEN 'buyer' THEN COALESCE(c.buyer_name, 'Unknown Buyer')
      END AS entity_name,
      COUNT(*) AS call_count,
      COALESCE(SUM(c.revenue), 0) AS total_revenue,
      COALESCE(SUM(c.payout), 0) AS total_payout,
      COALESCE(SUM(c.revenue), 0) - COALESCE(SUM(c.payout), 0) AS total_profit
    FROM core.calls c
    WHERE c.org_id = p_org_id
      AND c.start_time_utc::date > CURRENT_DATE - v_lookback
      AND c.start_time_utc::date <= CURRENT_DATE
      -- Dynamic filter based on target type
      AND CASE p_target_type
        WHEN 'publisher' THEN COALESCE(c.publisher_name, c.publisher_id) = p_target_id
        WHEN 'buyer' THEN c.buyer_name = p_target_id
      END
    GROUP BY 1
  )
  SELECT
    td.entity_name AS target_name,
    td.call_count AS total_calls,
    ROUND(td.total_revenue::numeric, 2) AS current_revenue,
    ROUND(td.total_payout::numeric, 2) AS current_payout,
    ROUND(td.total_profit::numeric, 2) AS current_profit,
    -- Simulated revenue (only changes for buyers)
    CASE p_target_type
      WHEN 'buyer' THEN ROUND((td.total_revenue + (p_change_amount * td.call_count))::numeric, 2)
      ELSE ROUND(td.total_revenue::numeric, 2)
    END AS simulated_revenue,
    -- Simulated payout (only changes for publishers)
    CASE p_target_type
      WHEN 'publisher' THEN ROUND((td.total_payout + (p_change_amount * td.call_count))::numeric, 2)
      ELSE ROUND(td.total_payout::numeric, 2)
    END AS simulated_payout,
    -- Simulated profit
    CASE p_target_type
      WHEN 'publisher' THEN ROUND((td.total_revenue - (td.total_payout + (p_change_amount * td.call_count)))::numeric, 2)
      WHEN 'buyer' THEN ROUND(((td.total_revenue + (p_change_amount * td.call_count)) - td.total_payout)::numeric, 2)
    END AS simulated_profit,
    -- Profit change
    CASE p_target_type
      WHEN 'publisher' THEN ROUND((-p_change_amount * td.call_count)::numeric, 2)
      WHEN 'buyer' THEN ROUND((p_change_amount * td.call_count)::numeric, 2)
    END AS profit_change,
    -- Profit change percentage
    CASE WHEN td.total_profit != 0
      THEN ROUND((
        CASE p_target_type
          WHEN 'publisher' THEN (-p_change_amount * td.call_count)
          WHEN 'buyer' THEN (p_change_amount * td.call_count)
        END / NULLIF(ABS(td.total_profit), 0) * 100
      )::numeric, 1)
      ELSE NULL
    END AS profit_change_pct,
    -- Human-readable description
    CASE
      WHEN p_change_amount > 0 THEN 'Simulated ' || p_change_variable || ' increase of $' || p_change_amount::text || '/call'
      WHEN p_change_amount < 0 THEN 'Simulated ' || p_change_variable || ' decrease of $' || ABS(p_change_amount)::text || '/call'
      ELSE 'No change simulated'
    END AS change_description
  FROM target_data td;
END;
$$;

COMMENT ON FUNCTION core.get_simulation_impact IS
'AI Tool: Calculate hypothetical financial impact of payout or revenue changes.
Parameters:
  - p_target_type: ''publisher'' or ''buyer''
  - p_target_id: Name of the publisher or buyer
  - p_change_variable: ''payout'' (publishers only) or ''revenue'' (buyers only)
  - p_change_amount: Dollar change per call (+5 = increase, -5 = decrease)
  - p_lookback_days: Days of historical data (default 30, max 90)
Returns: Current vs simulated financials with profit change calculation.
Note: This is a READ-ONLY simulation - no data is modified.';

-- Grant execute permission
GRANT EXECUTE ON FUNCTION core.get_simulation_impact(UUID, TEXT, TEXT, TEXT, NUMERIC, INT) TO authenticated;
GRANT EXECUTE ON FUNCTION core.get_simulation_impact(UUID, TEXT, TEXT, TEXT, NUMERIC, INT) TO service_role;

-- Revoke from anon (defense in depth)
REVOKE EXECUTE ON FUNCTION core.get_simulation_impact(UUID, TEXT, TEXT, TEXT, NUMERIC, INT) FROM anon;

-- =============================================================================
-- Example queries this enables:
-- =============================================================================
-- "What if I cut Publisher ABC's payout by $5?"
--   get_simulation_impact(org_id, 'publisher', 'ABC', 'payout', -5, 30)
--   → Returns current_profit vs simulated_profit with profit_change
--
-- "What if Buyer XYZ paid $10 more per call?"
--   get_simulation_impact(org_id, 'buyer', 'Buyer XYZ', 'revenue', 10, 30)
--   → Returns current_profit vs simulated_profit with profit_change
--
-- "What would happen if I raised Publisher DEF's payout by $2?"
--   get_simulation_impact(org_id, 'publisher', 'DEF', 'payout', 2, 30)
--   → Returns profit decrease from increased payout
-- =============================================================================
