-- =============================================================================
-- Migration 41: Update calls_overview View with Analytics Columns
-- =============================================================================
-- Adds the new analytics columns to the public view so the frontend can access them.
-- =============================================================================

DROP VIEW IF EXISTS public.calls_overview CASCADE;

CREATE VIEW public.calls_overview
WITH (security_invoker = true)
AS SELECT
    c.id,
    c.org_id,
    c.ringba_call_id,
    c.campaign_id,
    c.start_time_utc,
    c.updated_at,
    c.caller_number,
    c.duration_seconds,
    c.revenue,
    c.audio_url,
    c.storage_path,
    c.status,
    c.retry_count,
    c.processing_error,
    c.transcript_text,
    c.transcript_segments,
    c.qa_flags,
    c.qa_version,
    c.judge_model,
    -- New analytics columns (Phase 1)
    c.publisher_id,
    c.publisher_sub_id,
    c.buyer_name,
    c.target_id,
    c.target_name,
    c.payout,
    c.caller_state,
    c.caller_city,
    -- Computed column (Phase 2)
    c.profit
FROM core.calls AS c;

COMMENT ON VIEW public.calls_overview IS
    'Full call data view with analytics columns. SECURITY INVOKER ensures RLS applies.';

-- Grant access only to authenticated and service_role
GRANT SELECT ON public.calls_overview TO authenticated, service_role;

-- Explicitly revoke anon access
REVOKE ALL ON public.calls_overview FROM anon;
