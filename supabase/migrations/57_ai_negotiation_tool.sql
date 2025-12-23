-- =============================================================================
-- Migration 57: AI Negotiation Engine - Partner Leverage Analysis
-- =============================================================================
-- Purpose: Identify Buyers with high margins (price increase leverage) and
--          Publishers losing money (payout cuts needed).
-- Example: "Who should I ask for a price increase?" → HIGH_MARGIN buyers
-- Example: "Which publishers are losing me money?" → NEGATIVE_PROFIT publishers
-- =============================================================================

CREATE OR REPLACE FUNCTION core.get_partner_leverage_analysis(
  p_org_id UUID,
  p_partner_type TEXT,          -- 'buyer' or 'publisher'
  p_lookback_days INT DEFAULT 30,
  p_min_calls INT DEFAULT 10
)
RETURNS TABLE(
  entity_name TEXT,
  total_calls BIGINT,
  revenue NUMERIC,
  payout NUMERIC,
  profit NUMERIC,
  margin_pct NUMERIC,
  rpc NUMERIC,
  action_tag TEXT,
  suggested_tactic TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = core, public
AS $$
DECLARE
  v_lookback INT;
  v_min_calls INT;
BEGIN
  -- Validate partner_type parameter
  IF p_partner_type NOT IN ('buyer', 'publisher') THEN
    RAISE EXCEPTION 'Invalid partner_type: %. Must be one of: buyer, publisher', p_partner_type;
  END IF;

  -- Enforce safety limits
  v_lookback := LEAST(COALESCE(p_lookback_days, 30), 90);
  v_min_calls := GREATEST(COALESCE(p_min_calls, 10), 1);

  RETURN QUERY
  WITH org_avg AS (
    -- Calculate org-wide average RPC for LOW_RPC comparison
    SELECT COALESCE(SUM(c.revenue) / NULLIF(COUNT(*), 0), 0) AS avg_rpc
    FROM core.calls c
    WHERE c.org_id = p_org_id
      AND c.start_time_utc::date > CURRENT_DATE - v_lookback
      AND c.start_time_utc::date <= CURRENT_DATE
  ),

  partner_data AS (
    SELECT
      -- Dynamic partner name based on type
      CASE p_partner_type
        WHEN 'buyer' THEN COALESCE(c.buyer_name, 'Unknown Buyer')
        WHEN 'publisher' THEN COALESCE(c.publisher_name, c.publisher_id, 'Unknown Publisher')
      END AS entity_name,
      COUNT(*) AS total_calls,
      COALESCE(SUM(c.revenue), 0) AS revenue,
      COALESCE(SUM(c.payout), 0) AS payout,
      COALESCE(SUM(c.revenue), 0) - COALESCE(SUM(c.payout), 0) AS profit,
      -- Margin = (Revenue - Payout) / Revenue * 100
      CASE WHEN SUM(c.revenue) > 0
        THEN ROUND(((SUM(c.revenue) - SUM(c.payout)) / SUM(c.revenue) * 100)::numeric, 1)
        ELSE 0
      END AS margin_pct,
      -- RPC = Revenue / Calls
      CASE WHEN COUNT(*) > 0
        THEN ROUND((SUM(c.revenue) / COUNT(*))::numeric, 2)
        ELSE 0
      END AS rpc
    FROM core.calls c
    WHERE c.org_id = p_org_id
      AND c.start_time_utc::date > CURRENT_DATE - v_lookback
      AND c.start_time_utc::date <= CURRENT_DATE
    GROUP BY
      CASE p_partner_type
        WHEN 'buyer' THEN COALESCE(c.buyer_name, 'Unknown Buyer')
        WHEN 'publisher' THEN COALESCE(c.publisher_name, c.publisher_id, 'Unknown Publisher')
      END
    HAVING COUNT(*) >= v_min_calls
  )

  SELECT
    pd.entity_name,
    pd.total_calls,
    ROUND(pd.revenue::numeric, 2) AS revenue,
    ROUND(pd.payout::numeric, 2) AS payout,
    ROUND(pd.profit::numeric, 2) AS profit,
    pd.margin_pct,
    pd.rpc,
    -- Action tag assignment
    CASE
      WHEN p_partner_type = 'buyer' THEN
        CASE
          WHEN pd.margin_pct > 40 THEN 'HIGH_MARGIN'
          WHEN pd.margin_pct < 15 THEN 'LOW_MARGIN'
          WHEN pd.total_calls > 100 THEN 'HIGH_VOLUME'
          ELSE 'STANDARD'
        END
      WHEN p_partner_type = 'publisher' THEN
        CASE
          WHEN pd.profit < 0 THEN 'NEGATIVE_PROFIT'
          WHEN pd.rpc < (SELECT avg_rpc FROM org_avg) THEN 'LOW_RPC'
          WHEN pd.profit > 1000 AND pd.margin_pct > 20 THEN 'HIGH_PERFORMER'
          ELSE 'STANDARD'
        END
    END AS action_tag,
    -- Suggested tactic (human-readable)
    CASE
      WHEN p_partner_type = 'buyer' THEN
        CASE
          WHEN pd.margin_pct > 40 THEN 'Opportunity: Ask for higher CPA or cap increase'
          WHEN pd.margin_pct < 15 THEN 'Risk: Review operational efficiency'
          WHEN pd.total_calls > 100 THEN 'Strategic partner - maintain relationship'
          ELSE 'Monitor performance'
        END
      WHEN p_partner_type = 'publisher' THEN
        CASE
          WHEN pd.profit < 0 THEN 'CRITICAL: Cut payout or block immediately'
          WHEN pd.rpc < (SELECT avg_rpc FROM org_avg) THEN 'Quality issue: Review traffic source'
          WHEN pd.profit > 1000 AND pd.margin_pct > 20 THEN 'Scale: Offer incentive for more volume'
          ELSE 'Monitor performance'
        END
    END AS suggested_tactic
  FROM partner_data pd
  ORDER BY
    -- Buyers: Best leverage first (highest margin)
    -- Publishers: Worst performers first (lowest profit)
    CASE WHEN p_partner_type = 'buyer' THEN pd.margin_pct END DESC NULLS LAST,
    CASE WHEN p_partner_type = 'publisher' THEN pd.profit END ASC NULLS LAST
  LIMIT 50;  -- Safety limit
END;
$$;

COMMENT ON FUNCTION core.get_partner_leverage_analysis IS
'AI Tool: Identify partners with negotiation leverage or financial risk.
Parameters:
  - p_partner_type: ''buyer'' or ''publisher''
  - p_lookback_days: Days of data to analyze (default 30, max 90)
  - p_min_calls: Minimum calls to include partner (default 10)
Returns: Partners ranked by leverage with action tags and recommended tactics.
Action Tags:
  - Buyer: HIGH_MARGIN, LOW_MARGIN, HIGH_VOLUME, STANDARD
  - Publisher: NEGATIVE_PROFIT, LOW_RPC, HIGH_PERFORMER, STANDARD';

-- Grant execute permission
GRANT EXECUTE ON FUNCTION core.get_partner_leverage_analysis(UUID, TEXT, INT, INT) TO authenticated;
GRANT EXECUTE ON FUNCTION core.get_partner_leverage_analysis(UUID, TEXT, INT, INT) TO service_role;

-- Revoke from anon (defense in depth)
REVOKE EXECUTE ON FUNCTION core.get_partner_leverage_analysis(UUID, TEXT, INT, INT) FROM anon;

-- =============================================================================
-- Example queries this enables:
-- =============================================================================
-- "Who should I ask for a price increase?"
--   get_partner_leverage_analysis(org_id, 'buyer', 30, 10)
--   → Returns buyers sorted by margin DESC, HIGH_MARGIN first
--
-- "Which publishers are losing me money?"
--   get_partner_leverage_analysis(org_id, 'publisher', 30, 10)
--   → Returns publishers sorted by profit ASC, NEGATIVE_PROFIT first
--
-- "Who are my best performing publishers?"
--   get_partner_leverage_analysis(org_id, 'publisher', 30, 50)
--   → Filter for HIGH_PERFORMER tag in results
-- =============================================================================
