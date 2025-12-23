-- =============================================================================
-- Migration 56: AI Forecast Tool - Linear Regression Projections
-- =============================================================================
-- Purpose: Enable the AI to project future metrics using linear regression
--          based on historical data.
-- Example: "Project my revenue for next week" → 7-day forecast with trend line
-- =============================================================================

CREATE OR REPLACE FUNCTION core.get_metric_forecast(
  p_org_id UUID,
  p_metric TEXT,                    -- 'revenue', 'profit', 'calls'
  p_lookback_days INT DEFAULT 30,   -- Training window (max 90)
  p_forecast_days INT DEFAULT 7,    -- Projection window (max 30)
  p_dimension TEXT DEFAULT NULL,    -- Optional filter: 'publisher', 'buyer', etc.
  p_filter_value TEXT DEFAULT NULL  -- Optional filter value
)
RETURNS TABLE(
  date DATE,
  actual_value NUMERIC,    -- NULL for future dates
  forecast_value NUMERIC,  -- Trend line value (past + future)
  is_forecast BOOLEAN      -- TRUE for projected dates
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = core, public
AS $$
DECLARE
  v_lookback INT;
  v_forecast INT;
BEGIN
  -- Validate metric parameter
  IF p_metric NOT IN ('revenue', 'profit', 'calls') THEN
    RAISE EXCEPTION 'Invalid metric: %. Must be one of: revenue, profit, calls', p_metric;
  END IF;

  -- Validate dimension parameter (if provided)
  IF p_dimension IS NOT NULL AND p_dimension NOT IN ('publisher', 'buyer', 'campaign', 'vertical', 'state') THEN
    RAISE EXCEPTION 'Invalid dimension: %. Must be one of: publisher, buyer, campaign, vertical, state', p_dimension;
  END IF;

  -- Enforce safety limits
  v_lookback := LEAST(COALESCE(p_lookback_days, 30), 90);
  v_forecast := LEAST(COALESCE(p_forecast_days, 7), 30);

  RETURN QUERY
  WITH daily_data AS (
    -- Aggregate daily metric values with day index for regression
    SELECT
      c.start_time_utc::date AS dt,
      ROW_NUMBER() OVER (ORDER BY c.start_time_utc::date) AS day_index,
      CASE p_metric
        WHEN 'revenue' THEN COALESCE(SUM(c.revenue), 0)
        WHEN 'profit' THEN COALESCE(SUM(c.revenue), 0) - COALESCE(SUM(c.payout), 0)
        WHEN 'calls' THEN COUNT(*)::numeric
      END AS value
    FROM core.calls c
    WHERE c.org_id = p_org_id
      AND c.start_time_utc::date > CURRENT_DATE - v_lookback
      AND c.start_time_utc::date <= CURRENT_DATE
      -- Optional dimension filter using CASE for SQL injection safety
      AND (p_dimension IS NULL OR (
        CASE p_dimension
          WHEN 'publisher' THEN COALESCE(c.publisher_name, c.publisher_id)
          WHEN 'buyer' THEN c.buyer_name
          WHEN 'campaign' THEN c.campaign_name
          WHEN 'vertical' THEN c.vertical
          WHEN 'state' THEN c.caller_state
        END = p_filter_value
      ))
    GROUP BY c.start_time_utc::date
    ORDER BY c.start_time_utc::date
  ),

  trend AS (
    -- Calculate linear regression: y = slope * x + intercept
    SELECT
      regr_slope(value, day_index) AS slope,
      regr_intercept(value, day_index) AS intercept,
      MAX(day_index) AS last_index,
      COUNT(*) AS data_points
    FROM daily_data
    WHERE value IS NOT NULL
  )

  -- Return combined historical + projected data
  SELECT
    combined.date,
    combined.actual_value,
    combined.forecast_value,
    combined.is_forecast
  FROM (
    -- Historical rows (actual data with trend line overlay)
    SELECT
      d.dt AS date,
      d.value AS actual_value,
      CASE
        WHEN t.slope IS NOT NULL THEN ROUND((t.slope * d.day_index + t.intercept)::numeric, 2)
        ELSE NULL
      END AS forecast_value,
      FALSE AS is_forecast
    FROM daily_data d
    CROSS JOIN trend t
    WHERE t.data_points >= 2  -- Need at least 2 points for regression

    UNION ALL

    -- Future rows (projected values only)
    SELECT
      (CURRENT_DATE + i)::date AS date,
      NULL AS actual_value,
      CASE
        WHEN t.slope IS NOT NULL THEN ROUND((t.slope * (t.last_index + i) + t.intercept)::numeric, 2)
        ELSE NULL
      END AS forecast_value,
      TRUE AS is_forecast
    FROM trend t
    CROSS JOIN generate_series(1, v_forecast) AS i
    WHERE t.data_points >= 2  -- Need at least 2 points for regression
  ) combined
  ORDER BY combined.date;
END;
$$;

COMMENT ON FUNCTION core.get_metric_forecast IS
'AI Tool: Project future metrics using linear regression on historical data.
Parameters:
  - p_metric: The metric to forecast (revenue, profit, calls)
  - p_lookback_days: Days of history to train on (default 30, max 90)
  - p_forecast_days: Days to project forward (default 7, max 30)
  - p_dimension: Optional filter dimension (publisher, buyer, campaign, vertical, state)
  - p_filter_value: Optional filter value for the dimension
Returns: Historical data with trend line + projected future values.
Uses: regr_slope() and regr_intercept() for linear regression calculation.';

-- Grant execute permission
GRANT EXECUTE ON FUNCTION core.get_metric_forecast(UUID, TEXT, INT, INT, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION core.get_metric_forecast(UUID, TEXT, INT, INT, TEXT, TEXT) TO service_role;

-- Revoke from anon (defense in depth)
REVOKE EXECUTE ON FUNCTION core.get_metric_forecast(UUID, TEXT, INT, INT, TEXT, TEXT) FROM anon;

-- =============================================================================
-- Example queries this enables:
-- =============================================================================
-- "Project my revenue for next week"
--   get_metric_forecast(org_id, 'revenue', 30, 7)
--
-- "Where is traffic trending over the next 2 weeks?"
--   get_metric_forecast(org_id, 'calls', 30, 14)
--
-- "Forecast profit for Publisher X"
--   get_metric_forecast(org_id, 'profit', 30, 7, 'publisher', 'Publisher X')
-- =============================================================================
