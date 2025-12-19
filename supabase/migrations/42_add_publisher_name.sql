-- =============================================================================
-- Migration 42: Add publisher_name Column
-- =============================================================================
-- Stores the human-readable publisher name from Ringba (publisherName field)
-- =============================================================================

ALTER TABLE core.calls
    ADD COLUMN IF NOT EXISTS publisher_name TEXT;

COMMENT ON COLUMN core.calls.publisher_name IS 'Ringba publisherName - human-readable publisher/affiliate name';

-- Update calls_overview view to include publisher_name
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
    -- Analytics columns
    c.publisher_id,
    c.publisher_sub_id,
    c.publisher_name,  -- NEW
    c.buyer_name,
    c.target_id,
    c.target_name,
    c.payout,
    c.caller_state,
    c.caller_city,
    c.profit
FROM core.calls AS c;

COMMENT ON VIEW public.calls_overview IS
    'Full call data view with analytics columns. SECURITY INVOKER ensures RLS applies.';

GRANT SELECT ON public.calls_overview TO authenticated, service_role;
REVOKE ALL ON public.calls_overview FROM anon;
