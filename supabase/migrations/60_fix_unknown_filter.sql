-- =============================================================================
-- Migration 60: Fix "Unknown" Filter in Call Samples
-- =============================================================================
-- Problem: When AI shows "Unknown Buyer" in leaderboards, users can't fetch
--          samples because the filter looks for literal "Unknown Buyer" text,
--          but the actual value is NULL.
-- Solution: Treat "unknown" as a special keyword that matches NULL values.
-- =============================================================================

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
  -- Enforce safety limit
  v_limit := LEAST(COALESCE(p_limit, 5), 25);

  -- Extract filters
  v_buyer_filter := LOWER(TRIM(p_filters->>'buyer_name'));
  v_publisher_filter := LOWER(TRIM(p_filters->>'publisher_name'));

  RETURN QUERY
  WITH filtered_calls AS (
    SELECT
      c.id AS call_id,
      c.start_time_utc,
      COALESCE(c.publisher_name, c.publisher_id, 'Unknown') AS pub_name,
      -- Mask caller number for privacy: "555-***-1234"
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
      -- Status label based on business logic
      CASE
        WHEN COALESCE(c.revenue, 0) > 0 THEN 'Converted'
        WHEN COALESCE(c.duration_seconds, 0) > 60 AND COALESCE(c.revenue, 0) = 0 THEN 'Missed Opportunity'
        WHEN COALESCE(c.duration_seconds, 0) < 5 AND COALESCE(c.revenue, 0) = 0 THEN 'System Drop'
        ELSE 'Unconverted'
      END AS status_lbl,
      c.audio_url AS audio
    FROM core.calls c
    WHERE c.org_id = p_org_id
      -- Date filters
      AND (
        (p_filters->>'start_date') IS NULL
        OR c.start_time_utc::date >= (p_filters->>'start_date')::date
      )
      AND (
        (p_filters->>'end_date') IS NULL
        OR c.start_time_utc::date <= (p_filters->>'end_date')::date
      )
      -- Publisher filter (partial match OR "unknown" matches NULL)
      AND (
        v_publisher_filter IS NULL
        OR v_publisher_filter = ''
        OR (
          v_publisher_filter IN ('unknown', 'unknown publisher')
          AND c.publisher_name IS NULL
          AND c.publisher_id IS NULL
        )
        OR COALESCE(c.publisher_name, c.publisher_id, '') ILIKE '%' || (p_filters->>'publisher_name') || '%'
      )
      -- Buyer filter (partial match OR "unknown" matches NULL)
      AND (
        v_buyer_filter IS NULL
        OR v_buyer_filter = ''
        OR (
          v_buyer_filter IN ('unknown', 'unknown buyer')
          AND c.buyer_name IS NULL
        )
        OR c.buyer_name ILIKE '%' || (p_filters->>'buyer_name') || '%'
      )
      -- Duration filters
      AND (
        (p_filters->>'min_duration') IS NULL
        OR COALESCE(c.duration_seconds, 0) >= (p_filters->>'min_duration')::int
      )
      AND (
        (p_filters->>'max_duration') IS NULL
        OR COALESCE(c.duration_seconds, 0) <= (p_filters->>'max_duration')::int
      )
      -- Revenue filters
      AND (
        (p_filters->>'min_revenue') IS NULL
        OR COALESCE(c.revenue, 0) >= (p_filters->>'min_revenue')::numeric
      )
      AND (
        (p_filters->>'max_revenue') IS NULL
        OR COALESCE(c.revenue, 0) <= (p_filters->>'max_revenue')::numeric
      )
      -- Status filter (derived logic)
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

COMMENT ON FUNCTION core.get_call_samples IS
'AI Tool: Fetch actual call records as proof points for analysis.
Parameters:
  - p_org_id: Organization ID
  - p_filters: JSONB object with optional filters:
    - publisher_name: Partial match filter (use "unknown" for NULL values)
    - buyer_name: Partial match filter (use "unknown" for NULL values)
    - status: ''all'', ''converted'', ''missed'', ''system_drop''
    - min_duration / max_duration: Duration range in seconds
    - min_revenue / max_revenue: Revenue range
    - start_date / end_date: Date range (YYYY-MM-DD)
  - p_limit: Max calls to return (default 5, hard cap 25)
Returns: Call records with masked caller numbers for privacy.
Special: "unknown" or "unknown buyer" matches NULL buyer_name values.';
