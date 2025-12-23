-- =============================================================================
-- Migration 61: Security Helpers & Function Patches
-- =============================================================================
-- Addresses CodeRabbit findings:
-- 1. Missing org_id authorization in SECURITY DEFINER functions
-- 2. ILIKE pattern injection vulnerability
-- =============================================================================

-- =============================================================================
-- PART 1: Security Helper Functions
-- =============================================================================

-- 1. Authorization helper (validates caller owns the org)
CREATE OR REPLACE FUNCTION core.authorize_org_access(p_org_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = core, public
AS $$
BEGIN
  IF p_org_id IS NULL THEN
    RAISE EXCEPTION 'Organization ID is required';
  END IF;

  -- current_org_id() returns the org from JWT claims
  IF p_org_id != core.current_org_id() THEN
    RAISE EXCEPTION 'Unauthorized: You do not have access to this organization';
  END IF;
END;
$$;

COMMENT ON FUNCTION core.authorize_org_access IS
'Security helper: Validates the caller has access to the specified org_id.
Call at the start of any SECURITY DEFINER function that accepts p_org_id.';

GRANT EXECUTE ON FUNCTION core.authorize_org_access(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION core.authorize_org_access(UUID) TO service_role;
REVOKE EXECUTE ON FUNCTION core.authorize_org_access(UUID) FROM anon;

-- 2. Safe ILIKE helper (escapes wildcards to prevent pattern injection)
CREATE OR REPLACE FUNCTION core.safe_ilike(haystack TEXT, needle TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  IF needle IS NULL OR TRIM(needle) = '' THEN
    RETURN TRUE;  -- Empty filter = match all
  END IF;

  -- Escape SQL ILIKE wildcards: %, _, and \
  RETURN haystack ILIKE '%' ||
    REGEXP_REPLACE(needle, '([%_\\])', '\\\1', 'g') || '%';
END;
$$;

COMMENT ON FUNCTION core.safe_ilike IS
'Safe pattern matching: Escapes %, _, and \ in needle to prevent wildcard injection.
Use instead of raw ILIKE when needle comes from user input.';

GRANT EXECUTE ON FUNCTION core.safe_ilike(TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION core.safe_ilike(TEXT, TEXT) TO service_role;
REVOKE EXECUTE ON FUNCTION core.safe_ilike(TEXT, TEXT) FROM anon;

-- =============================================================================
-- PART 2: Patch AI Tool Functions with Authorization
-- =============================================================================

-- Patch get_breakdown_analysis (Migration 55)
CREATE OR REPLACE FUNCTION core.get_breakdown_analysis(
  p_org_id UUID,
  p_dimension TEXT,
  p_filter_value TEXT,
  p_breakdown_by TEXT,
  p_metric TEXT,
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
  -- Authorization check (NEW)
  PERFORM core.authorize_org_access(p_org_id);

  -- Validate dimension parameter
  IF p_dimension NOT IN ('publisher', 'buyer', 'campaign', 'vertical', 'state') THEN
    RAISE EXCEPTION 'Invalid dimension: %. Must be one of: publisher, buyer, campaign, vertical, state', p_dimension;
  END IF;

  IF p_breakdown_by NOT IN ('publisher', 'buyer', 'campaign', 'vertical', 'state') THEN
    RAISE EXCEPTION 'Invalid breakdown_by: %. Must be one of: publisher, buyer, campaign, vertical, state', p_breakdown_by;
  END IF;

  IF p_metric NOT IN ('revenue', 'profit', 'calls', 'rpc') THEN
    RAISE EXCEPTION 'Invalid metric: %. Must be one of: revenue, profit, calls, rpc', p_metric;
  END IF;

  RETURN QUERY
  WITH filtered_data AS (
    SELECT
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
    HAVING COUNT(*) >= 1
  )
  SELECT
    a.name,
    a.value,
    a.total_calls,
    CASE
      WHEN SUM(a.value) OVER() > 0
      THEN ROUND((a.value / SUM(a.value) OVER() * 100)::numeric, 1)
      ELSE 0
    END AS contribution_pct
  FROM aggregated a
  ORDER BY a.value DESC
  LIMIT 25;
END;
$$;

-- Patch get_metric_forecast (Migration 56)
CREATE OR REPLACE FUNCTION core.get_metric_forecast(
  p_org_id UUID,
  p_metric TEXT,
  p_lookback_days INT DEFAULT 30,
  p_forecast_days INT DEFAULT 7,
  p_dimension TEXT DEFAULT NULL,
  p_filter_value TEXT DEFAULT NULL
)
RETURNS TABLE(
  date DATE,
  actual_value NUMERIC,
  forecast_value NUMERIC,
  is_forecast BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = core, public
AS $$
DECLARE
  v_lookback INT;
  v_forecast INT;
BEGIN
  -- Authorization check (NEW)
  PERFORM core.authorize_org_access(p_org_id);

  IF p_metric NOT IN ('revenue', 'profit', 'calls') THEN
    RAISE EXCEPTION 'Invalid metric: %. Must be one of: revenue, profit, calls', p_metric;
  END IF;

  IF p_dimension IS NOT NULL AND p_dimension NOT IN ('publisher', 'buyer', 'campaign', 'vertical', 'state') THEN
    RAISE EXCEPTION 'Invalid dimension: %. Must be one of: publisher, buyer, campaign, vertical, state', p_dimension;
  END IF;

  v_lookback := LEAST(COALESCE(p_lookback_days, 30), 90);
  v_forecast := LEAST(COALESCE(p_forecast_days, 7), 30);

  RETURN QUERY
  WITH daily_data AS (
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
    SELECT
      regr_slope(value, day_index) AS slope,
      regr_intercept(value, day_index) AS intercept,
      MAX(day_index) AS last_index,
      COUNT(*) AS data_points
    FROM daily_data
    WHERE value IS NOT NULL
  )
  SELECT
    combined.date,
    combined.actual_value,
    combined.forecast_value,
    combined.is_forecast
  FROM (
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
    WHERE t.data_points >= 2

    UNION ALL

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
    WHERE t.data_points >= 2
  ) combined
  ORDER BY combined.date;
END;
$$;

-- Patch get_partner_leverage_analysis (Migration 57)
CREATE OR REPLACE FUNCTION core.get_partner_leverage_analysis(
  p_org_id UUID,
  p_partner_type TEXT,
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
  -- Authorization check (NEW)
  PERFORM core.authorize_org_access(p_org_id);

  IF p_partner_type NOT IN ('buyer', 'publisher') THEN
    RAISE EXCEPTION 'Invalid partner_type: %. Must be one of: buyer, publisher', p_partner_type;
  END IF;

  v_lookback := LEAST(COALESCE(p_lookback_days, 30), 90);
  v_min_calls := GREATEST(COALESCE(p_min_calls, 10), 1);

  RETURN QUERY
  WITH org_avg AS (
    SELECT COALESCE(SUM(c.revenue) / NULLIF(COUNT(*), 0), 0) AS avg_rpc
    FROM core.calls c
    WHERE c.org_id = p_org_id
      AND c.start_time_utc::date > CURRENT_DATE - v_lookback
      AND c.start_time_utc::date <= CURRENT_DATE
  ),
  partner_data AS (
    SELECT
      CASE p_partner_type
        WHEN 'buyer' THEN COALESCE(c.buyer_name, 'Unknown Buyer')
        WHEN 'publisher' THEN COALESCE(c.publisher_name, c.publisher_id, 'Unknown Publisher')
      END AS entity_name,
      COUNT(*) AS total_calls,
      COALESCE(SUM(c.revenue), 0) AS revenue,
      COALESCE(SUM(c.payout), 0) AS payout,
      COALESCE(SUM(c.revenue), 0) - COALESCE(SUM(c.payout), 0) AS profit,
      CASE WHEN SUM(c.revenue) > 0
        THEN ROUND(((SUM(c.revenue) - SUM(c.payout)) / SUM(c.revenue) * 100)::numeric, 1)
        ELSE 0
      END AS margin_pct,
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
    CASE WHEN p_partner_type = 'buyer' THEN pd.margin_pct END DESC NULLS LAST,
    CASE WHEN p_partner_type = 'publisher' THEN pd.profit END ASC NULLS LAST
  LIMIT 50;
END;
$$;

-- Patch get_simulation_impact (Migration 58)
CREATE OR REPLACE FUNCTION core.get_simulation_impact(
  p_org_id UUID,
  p_target_type TEXT,
  p_target_id TEXT,
  p_change_variable TEXT,
  p_change_amount NUMERIC,
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
  -- Authorization check (NEW)
  PERFORM core.authorize_org_access(p_org_id);

  IF p_target_type NOT IN ('publisher', 'buyer') THEN
    RAISE EXCEPTION 'Invalid target_type: %. Must be one of: publisher, buyer', p_target_type;
  END IF;

  IF p_target_type = 'publisher' AND p_change_variable != 'payout' THEN
    RAISE EXCEPTION 'For publishers, change_variable must be ''payout''. Got: %', p_change_variable;
  END IF;

  IF p_target_type = 'buyer' AND p_change_variable != 'revenue' THEN
    RAISE EXCEPTION 'For buyers, change_variable must be ''revenue''. Got: %', p_change_variable;
  END IF;

  v_lookback := LEAST(COALESCE(p_lookback_days, 30), 90);

  RETURN QUERY
  WITH target_data AS (
    SELECT
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
    CASE p_target_type
      WHEN 'buyer' THEN ROUND((td.total_revenue + (p_change_amount * td.call_count))::numeric, 2)
      ELSE ROUND(td.total_revenue::numeric, 2)
    END AS simulated_revenue,
    CASE p_target_type
      WHEN 'publisher' THEN ROUND((td.total_payout + (p_change_amount * td.call_count))::numeric, 2)
      ELSE ROUND(td.total_payout::numeric, 2)
    END AS simulated_payout,
    CASE p_target_type
      WHEN 'publisher' THEN ROUND((td.total_revenue - (td.total_payout + (p_change_amount * td.call_count)))::numeric, 2)
      WHEN 'buyer' THEN ROUND(((td.total_revenue + (p_change_amount * td.call_count)) - td.total_payout)::numeric, 2)
    END AS simulated_profit,
    CASE p_target_type
      WHEN 'publisher' THEN ROUND((-p_change_amount * td.call_count)::numeric, 2)
      WHEN 'buyer' THEN ROUND((p_change_amount * td.call_count)::numeric, 2)
    END AS profit_change,
    CASE WHEN td.total_profit != 0
      THEN ROUND((
        CASE p_target_type
          WHEN 'publisher' THEN (-p_change_amount * td.call_count)
          WHEN 'buyer' THEN (p_change_amount * td.call_count)
        END / NULLIF(ABS(td.total_profit), 0) * 100
      )::numeric, 1)
      ELSE NULL
    END AS profit_change_pct,
    CASE
      WHEN p_change_amount > 0 THEN 'Simulated ' || p_change_variable || ' increase of $' || p_change_amount::text || '/call'
      WHEN p_change_amount < 0 THEN 'Simulated ' || p_change_variable || ' decrease of $' || ABS(p_change_amount)::text || '/call'
      ELSE 'No change simulated'
    END AS change_description
  FROM target_data td;
END;
$$;

-- Patch get_call_samples (Migration 59/60) with authorization + safe_ilike
CREATE OR REPLACE FUNCTION core.get_call_samples(
  p_org_id UUID,
  p_filters JSONB DEFAULT '{}',
  p_limit INT DEFAULT 5
)
RETURNS TABLE(
  call_id UUID,
  start_time_utc TIMESTAMPTZ,
  publisher_name TEXT,
  caller_masked TEXT,
  duration_seconds INT,
  revenue NUMERIC,
  payout NUMERIC,
  status_label TEXT,
  audio_url TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = core, public
AS $$
DECLARE
  v_limit INT;
  v_buyer_filter TEXT;
  v_publisher_filter TEXT;
BEGIN
  -- Authorization check (NEW)
  PERFORM core.authorize_org_access(p_org_id);

  v_limit := LEAST(COALESCE(p_limit, 5), 25);
  v_buyer_filter := LOWER(TRIM(p_filters->>'buyer_name'));
  v_publisher_filter := LOWER(TRIM(p_filters->>'publisher_name'));

  RETURN QUERY
  WITH filtered_calls AS (
    SELECT
      c.id AS call_id,
      c.start_time_utc,
      COALESCE(c.publisher_name, c.publisher_id, 'Unknown') AS pub_name,
      CASE
        WHEN c.caller_number IS NOT NULL
             AND LENGTH(REGEXP_REPLACE(c.caller_number, '[^0-9]', '', 'g')) >= 10
        THEN LEFT(REGEXP_REPLACE(c.caller_number, '[^0-9]', '', 'g'), 3)
             || '-***-'
             || RIGHT(REGEXP_REPLACE(c.caller_number, '[^0-9]', '', 'g'), 4)
        ELSE '***-***-****'
      END AS caller_masked,
      COALESCE(c.duration_seconds, 0) AS dur_seconds,
      COALESCE(c.revenue, 0) AS rev,
      COALESCE(c.payout, 0) AS pay,
      CASE
        WHEN COALESCE(c.revenue, 0) > 0 THEN 'Converted'
        WHEN COALESCE(c.duration_seconds, 0) > 60 AND COALESCE(c.revenue, 0) = 0 THEN 'Missed Opportunity'
        WHEN COALESCE(c.duration_seconds, 0) < 5 AND COALESCE(c.revenue, 0) = 0 THEN 'System Drop'
        ELSE 'Unconverted'
      END AS status_lbl,
      c.audio_url AS audio
    FROM core.calls c
    WHERE c.org_id = p_org_id
      AND (
        (p_filters->>'start_date') IS NULL
        OR c.start_time_utc::date >= (p_filters->>'start_date')::date
      )
      AND (
        (p_filters->>'end_date') IS NULL
        OR c.start_time_utc::date <= (p_filters->>'end_date')::date
      )
      -- Publisher filter using safe_ilike (FIXED: pattern injection)
      AND (
        v_publisher_filter IS NULL
        OR v_publisher_filter = ''
        OR (
          v_publisher_filter IN ('unknown', 'unknown publisher')
          AND c.publisher_name IS NULL
          AND c.publisher_id IS NULL
        )
        OR core.safe_ilike(COALESCE(c.publisher_name, c.publisher_id, ''), v_publisher_filter)
      )
      -- Buyer filter using safe_ilike (FIXED: pattern injection)
      AND (
        v_buyer_filter IS NULL
        OR v_buyer_filter = ''
        OR (
          v_buyer_filter IN ('unknown', 'unknown buyer')
          AND c.buyer_name IS NULL
        )
        OR core.safe_ilike(COALESCE(c.buyer_name, ''), v_buyer_filter)
      )
      AND (
        (p_filters->>'min_duration') IS NULL
        OR COALESCE(c.duration_seconds, 0) >= (p_filters->>'min_duration')::int
      )
      AND (
        (p_filters->>'max_duration') IS NULL
        OR COALESCE(c.duration_seconds, 0) <= (p_filters->>'max_duration')::int
      )
      AND (
        (p_filters->>'min_revenue') IS NULL
        OR COALESCE(c.revenue, 0) >= (p_filters->>'min_revenue')::numeric
      )
      AND (
        (p_filters->>'max_revenue') IS NULL
        OR COALESCE(c.revenue, 0) <= (p_filters->>'max_revenue')::numeric
      )
      AND (
        (p_filters->>'status') IS NULL
        OR (p_filters->>'status') = 'all'
        OR (
          (p_filters->>'status') = 'converted'
          AND COALESCE(c.revenue, 0) > 0
        )
        OR (
          (p_filters->>'status') = 'missed'
          AND COALESCE(c.duration_seconds, 0) > 60
          AND COALESCE(c.revenue, 0) = 0
        )
        OR (
          (p_filters->>'status') = 'system_drop'
          AND COALESCE(c.duration_seconds, 0) < 5
          AND COALESCE(c.revenue, 0) = 0
        )
        OR (
          (p_filters->>'status') = 'unconverted'
          AND COALESCE(c.duration_seconds, 0) >= 5
          AND COALESCE(c.duration_seconds, 0) <= 60
          AND COALESCE(c.revenue, 0) = 0
        )
      )
  )
  SELECT
    fc.call_id,
    fc.start_time_utc,
    fc.pub_name AS publisher_name,
    fc.caller_masked,
    fc.dur_seconds AS duration_seconds,
    ROUND(fc.rev::numeric, 2) AS revenue,
    ROUND(fc.pay::numeric, 2) AS payout,
    fc.status_lbl AS status_label,
    fc.audio AS audio_url
  FROM filtered_calls fc
  ORDER BY fc.start_time_utc DESC
  LIMIT v_limit;
END;
$$;

-- =============================================================================
-- Summary of changes:
-- =============================================================================
-- 1. Created core.authorize_org_access(UUID) - validates caller owns the org
-- 2. Created core.safe_ilike(TEXT, TEXT) - escapes ILIKE wildcards
-- 3. Patched get_breakdown_analysis - added authorization
-- 4. Patched get_metric_forecast - added authorization
-- 5. Patched get_partner_leverage_analysis - added authorization
-- 6. Patched get_simulation_impact - added authorization
-- 7. Patched get_call_samples - added authorization + safe_ilike for filters
-- =============================================================================
