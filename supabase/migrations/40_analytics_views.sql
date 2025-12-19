-- =============================================================================
-- Migration 40: Analytics Summary Views
-- =============================================================================
-- Phase 2 of the CallScript V2 Analytics Refactor
--
-- Purpose: Pre-aggregated views for dashboard analytics without complex queries.
--
-- Views:
--   1. calls_daily_summary - Daily aggregates by org/campaign/publisher
--   2. calls_publisher_summary - Publisher performance metrics
--   3. calls_analytics - Flexible grouping for ad-hoc analysis
--
-- Security: All views use SECURITY INVOKER so RLS applies.
-- =============================================================================

-- =============================================================================
-- 1. DAILY SUMMARY VIEW
-- =============================================================================
-- Pre-aggregated daily metrics for dashboard charts
DROP VIEW IF EXISTS public.calls_daily_summary;

CREATE VIEW public.calls_daily_summary
WITH (security_invoker = true)
AS SELECT
    org_id,
    day_bucket,
    -- Volume metrics
    COUNT(*) as total_calls,
    COUNT(*) FILTER (WHERE status = 'flagged') as flagged_calls,
    COUNT(*) FILTER (WHERE status = 'safe') as safe_calls,
    COUNT(*) FILTER (WHERE status IN ('flagged', 'safe')) as reviewed_calls,
    -- Financial metrics
    COALESCE(SUM(revenue), 0) as total_revenue,
    COALESCE(SUM(payout), 0) as total_payout,
    COALESCE(SUM(profit), 0) as total_profit,
    -- Calculated metrics
    CASE
        WHEN COUNT(*) > 0 THEN ROUND(SUM(revenue) / COUNT(*), 4)
        ELSE 0
    END as rpc,
    CASE
        WHEN COUNT(*) FILTER (WHERE status IN ('flagged', 'safe')) > 0
        THEN ROUND(
            100.0 * COUNT(*) FILTER (WHERE status = 'flagged') /
            COUNT(*) FILTER (WHERE status IN ('flagged', 'safe')),
            2
        )
        ELSE 0
    END as flag_rate_pct,
    -- Duration metrics
    COALESCE(SUM(duration_seconds), 0) as total_duration_seconds,
    CASE
        WHEN COUNT(*) > 0 THEN ROUND(AVG(duration_seconds), 0)
        ELSE 0
    END as avg_duration_seconds
FROM core.calls
GROUP BY org_id, day_bucket;

COMMENT ON VIEW public.calls_daily_summary IS
    'Daily aggregated metrics by organization. Use for dashboard time-series charts.';

GRANT SELECT ON public.calls_daily_summary TO authenticated, service_role;

-- =============================================================================
-- 2. PUBLISHER SUMMARY VIEW
-- =============================================================================
-- Publisher performance leaderboard
DROP VIEW IF EXISTS public.calls_publisher_summary;

CREATE VIEW public.calls_publisher_summary
WITH (security_invoker = true)
AS SELECT
    org_id,
    publisher_id,
    -- Volume
    COUNT(*) as total_calls,
    COUNT(*) FILTER (WHERE status = 'flagged') as flagged_calls,
    COUNT(*) FILTER (WHERE status = 'safe') as safe_calls,
    -- Financial
    COALESCE(SUM(revenue), 0) as total_revenue,
    COALESCE(SUM(payout), 0) as total_payout,
    COALESCE(SUM(profit), 0) as total_profit,
    -- RPC (Revenue Per Call)
    CASE
        WHEN COUNT(*) > 0 THEN ROUND(SUM(revenue) / COUNT(*), 4)
        ELSE 0
    END as rpc,
    -- Flag rate
    CASE
        WHEN COUNT(*) FILTER (WHERE status IN ('flagged', 'safe')) > 0
        THEN ROUND(
            100.0 * COUNT(*) FILTER (WHERE status = 'flagged') /
            COUNT(*) FILTER (WHERE status IN ('flagged', 'safe')),
            2
        )
        ELSE 0
    END as flag_rate_pct,
    -- Time range
    MIN(start_time_utc) as first_call,
    MAX(start_time_utc) as last_call
FROM core.calls
WHERE publisher_id IS NOT NULL
GROUP BY org_id, publisher_id;

COMMENT ON VIEW public.calls_publisher_summary IS
    'Publisher performance metrics. Use for publisher leaderboard/comparison.';

GRANT SELECT ON public.calls_publisher_summary TO authenticated, service_role;

-- =============================================================================
-- 3. FLEXIBLE ANALYTICS VIEW
-- =============================================================================
-- Grouped by multiple dimensions for ad-hoc analysis
DROP VIEW IF EXISTS public.calls_analytics;

CREATE VIEW public.calls_analytics
WITH (security_invoker = true)
AS SELECT
    org_id,
    campaign_id,
    publisher_id,
    buyer_name,
    target_id,
    caller_state,
    day_bucket,
    status,
    -- Counts
    COUNT(*) as call_count,
    -- Financial
    COALESCE(SUM(revenue), 0) as total_revenue,
    COALESCE(SUM(payout), 0) as total_payout,
    COALESCE(SUM(profit), 0) as total_profit,
    -- RPC
    CASE
        WHEN COUNT(*) > 0 THEN ROUND(SUM(revenue) / COUNT(*), 4)
        ELSE 0
    END as rpc,
    -- Duration
    COALESCE(SUM(duration_seconds), 0) as total_duration,
    ROUND(AVG(duration_seconds), 0) as avg_duration
FROM core.calls
GROUP BY
    org_id,
    campaign_id,
    publisher_id,
    buyer_name,
    target_id,
    caller_state,
    day_bucket,
    status;

COMMENT ON VIEW public.calls_analytics IS
    'Flexible analytics view grouped by all dimensions. Filter as needed.';

GRANT SELECT ON public.calls_analytics TO authenticated, service_role;

-- =============================================================================
-- 4. STATE-LEVEL SUMMARY VIEW (for compliance)
-- =============================================================================
DROP VIEW IF EXISTS public.calls_state_summary;

CREATE VIEW public.calls_state_summary
WITH (security_invoker = true)
AS SELECT
    org_id,
    caller_state,
    -- Volume
    COUNT(*) as total_calls,
    COUNT(*) FILTER (WHERE status = 'flagged') as flagged_calls,
    -- Flag rate by state (compliance metric)
    CASE
        WHEN COUNT(*) FILTER (WHERE status IN ('flagged', 'safe')) > 0
        THEN ROUND(
            100.0 * COUNT(*) FILTER (WHERE status = 'flagged') /
            COUNT(*) FILTER (WHERE status IN ('flagged', 'safe')),
            2
        )
        ELSE 0
    END as flag_rate_pct,
    -- Financial
    COALESCE(SUM(revenue), 0) as total_revenue,
    COALESCE(SUM(profit), 0) as total_profit
FROM core.calls
WHERE caller_state IS NOT NULL
GROUP BY org_id, caller_state;

COMMENT ON VIEW public.calls_state_summary IS
    'State-level metrics for geographic compliance analysis.';

GRANT SELECT ON public.calls_state_summary TO authenticated, service_role;

-- =============================================================================
-- VERIFICATION QUERIES
-- =============================================================================
/*
-- Test daily summary (should return aggregated rows)
SELECT * FROM public.calls_daily_summary
WHERE day_bucket > current_date - interval '7 days'
ORDER BY day_bucket DESC;

-- Test publisher summary (should show publisher leaderboard)
SELECT publisher_id, total_calls, total_revenue, rpc, flag_rate_pct
FROM public.calls_publisher_summary
ORDER BY total_revenue DESC
LIMIT 10;

-- Test state summary
SELECT caller_state, total_calls, flag_rate_pct
FROM public.calls_state_summary
ORDER BY total_calls DESC;
*/
-- =============================================================================
