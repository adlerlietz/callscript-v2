-- =============================================================================
-- Migration 48: AI Explore Platform - RPC Functions
-- =============================================================================
-- Purpose: Create "Safe Tool" functions for the AI to query data
-- Security: All functions use SECURITY DEFINER with strict org_id filtering
-- =============================================================================

-- -----------------------------------------------------------------------------
-- RPC 1: get_kpi_summary
-- Returns aggregated KPIs for a date range
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION core.get_kpi_summary(
  p_org_id UUID,
  p_start_date DATE,
  p_end_date DATE
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = core, public
AS $$
DECLARE
  result JSON;
BEGIN
  SELECT json_build_object(
    'period', json_build_object('start', p_start_date, 'end', p_end_date),
    'metrics', json_build_object(
      'total_calls', COALESCE(COUNT(*), 0),
      'revenue', COALESCE(SUM(revenue), 0),
      'payout', COALESCE(SUM(payout), 0),
      'profit', COALESCE(SUM(revenue) - SUM(payout), 0),
      'margin_pct', CASE
        WHEN COALESCE(SUM(revenue), 0) > 0
        THEN ROUND(((SUM(revenue) - COALESCE(SUM(payout), 0)) / SUM(revenue) * 100)::numeric, 2)
        ELSE 0
      END,
      'flag_rate_pct', CASE
        WHEN COUNT(*) > 0
        THEN ROUND((COUNT(*) FILTER (WHERE status = 'flagged')::numeric / COUNT(*) * 100), 2)
        ELSE 0
      END,
      'rpc', CASE
        WHEN COUNT(*) > 0
        THEN ROUND((COALESCE(SUM(revenue), 0) / COUNT(*))::numeric, 2)
        ELSE 0
      END
    ),
    'definitions', json_build_object(
      'revenue', 'Total revenue from buyers',
      'payout', 'Total paid to publishers',
      'profit', 'Revenue minus Payout',
      'margin_pct', 'Profit divided by Revenue, as percentage',
      'flag_rate_pct', 'Percentage of calls flagged for compliance issues',
      'rpc', 'Revenue Per Call'
    )
  ) INTO result
  FROM core.calls
  WHERE org_id = p_org_id
    AND start_time_utc::date BETWEEN p_start_date AND p_end_date;

  RETURN result;
END;
$$;

COMMENT ON FUNCTION core.get_kpi_summary IS 'AI Tool: Get aggregated KPIs (revenue, profit, flag rate, etc.) for a date range';

-- -----------------------------------------------------------------------------
-- RPC 2: get_trend_data
-- Returns time-series data for charting
-- Safety: Limited to 90 data points max
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION core.get_trend_data(
  p_org_id UUID,
  p_metric TEXT,
  p_interval TEXT,
  p_start_date DATE,
  p_end_date DATE
)
RETURNS TABLE(date_bucket DATE, value NUMERIC)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = core, public
AS $$
BEGIN
  -- Validate metric parameter
  IF p_metric NOT IN ('revenue', 'profit', 'calls', 'flag_rate', 'rpc') THEN
    RAISE EXCEPTION 'Invalid metric: %. Must be one of: revenue, profit, calls, flag_rate, rpc', p_metric;
  END IF;

  -- Validate interval parameter
  IF p_interval NOT IN ('day', 'week') THEN
    RAISE EXCEPTION 'Invalid interval: %. Must be one of: day, week', p_interval;
  END IF;

  RETURN QUERY
  SELECT
    CASE
      WHEN p_interval = 'week' THEN date_trunc('week', c.start_time_utc)::date
      ELSE c.start_time_utc::date
    END AS date_bucket,
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
          THEN ROUND((COALESCE(SUM(c.revenue), 0) / COUNT(*))::numeric, 2)
          ELSE 0
        END
      ELSE COUNT(*)::numeric
    END AS value
  FROM core.calls c
  WHERE c.org_id = p_org_id
    AND c.start_time_utc::date BETWEEN p_start_date AND p_end_date
  GROUP BY 1
  ORDER BY 1
  LIMIT 90;  -- Safety: max 90 data points to prevent token overflow
END;
$$;

COMMENT ON FUNCTION core.get_trend_data IS 'AI Tool: Get time-series trend data for a metric (max 90 points)';

-- -----------------------------------------------------------------------------
-- RPC 3: get_leaderboard
-- Returns top performers by dimension
-- Safety: Limited to 25 entries max
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION core.get_leaderboard(
  p_org_id UUID,
  p_dimension TEXT,
  p_metric TEXT,
  p_start_date DATE,
  p_end_date DATE
)
RETURNS TABLE(name TEXT, value NUMERIC, total_calls BIGINT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = core, public
AS $$
BEGIN
  -- Validate dimension parameter
  IF p_dimension NOT IN ('publisher', 'buyer', 'campaign', 'state') THEN
    RAISE EXCEPTION 'Invalid dimension: %. Must be one of: publisher, buyer, campaign, state', p_dimension;
  END IF;

  -- Validate metric parameter
  IF p_metric NOT IN ('revenue', 'profit', 'calls', 'flag_rate') THEN
    RAISE EXCEPTION 'Invalid metric: %. Must be one of: revenue, profit, calls, flag_rate', p_metric;
  END IF;

  RETURN QUERY
  SELECT
    CASE p_dimension
      WHEN 'publisher' THEN COALESCE(c.publisher_name, c.publisher_id, 'Unknown')
      WHEN 'buyer' THEN COALESCE(c.buyer_name, 'Unknown')
      WHEN 'campaign' THEN COALESCE(c.campaign_name, 'Unknown')
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
      ELSE COALESCE(SUM(c.revenue), 0)
    END AS value,
    COUNT(*) AS total_calls
  FROM core.calls c
  WHERE c.org_id = p_org_id
    AND c.start_time_utc::date BETWEEN p_start_date AND p_end_date
  GROUP BY 1
  ORDER BY 2 DESC
  LIMIT 25;  -- Safety: max 25 entries to prevent token overflow
END;
$$;

COMMENT ON FUNCTION core.get_leaderboard IS 'AI Tool: Get top performers by dimension and metric (max 25 entries)';

-- -----------------------------------------------------------------------------
-- Grant permissions to authenticated users
-- -----------------------------------------------------------------------------
GRANT EXECUTE ON FUNCTION core.get_kpi_summary(UUID, DATE, DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION core.get_trend_data(UUID, TEXT, TEXT, DATE, DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION core.get_leaderboard(UUID, TEXT, TEXT, DATE, DATE) TO authenticated;

-- =============================================================================
-- End Migration 48
-- =============================================================================
