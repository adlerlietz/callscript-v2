-- =============================================================================
-- Migration 29: Secure Views for Multi-Tenant Isolation
-- =============================================================================
-- CRITICAL SECURITY FIX: Prevents data leakage across organizations
--
-- Issue: The calls_overview view was using SECURITY DEFINER (default),
-- which executes as the view owner (superuser), bypassing RLS.
-- Combined with GRANT to anon, this allowed unauthenticated queries
-- to return ALL calls from ALL organizations.
--
-- Fix: Recreate view with SECURITY INVOKER so RLS applies based on
-- the querying user's role, not the view owner.
-- =============================================================================

-- 1. Drop existing view
DROP VIEW IF EXISTS public.calls_overview CASCADE;

-- 2. Recreate view with SECURITY INVOKER
-- This ensures RLS policies are evaluated based on the calling user
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
  c.judge_model
FROM core.calls AS c;

COMMENT ON VIEW public.calls_overview IS
  'Secure call data view with SECURITY INVOKER - RLS applies to caller.';

-- 3. Grant access only to authenticated and service_role
-- IMPORTANT: Do NOT grant to anon - this was the security hole
GRANT SELECT ON public.calls_overview TO authenticated, service_role;

-- 4. Explicitly revoke anon access (defense in depth)
REVOKE ALL ON public.calls_overview FROM anon;

-- 5. Add explicit deny policy for anon on core.calls
-- This ensures even if view permissions change, anon can't access data
DO $$
BEGIN
  -- Drop existing policy if it exists
  DROP POLICY IF EXISTS "calls_deny_anon" ON core.calls;

  -- Create explicit deny for anon role
  CREATE POLICY "calls_deny_anon"
    ON core.calls
    FOR SELECT
    TO anon
    USING (false);

  RAISE NOTICE 'Created deny policy for anon role on core.calls';
END $$;

-- =============================================================================
-- VERIFICATION
-- =============================================================================
-- After running this migration, verify:
-- 1. SELECT * FROM pg_views WHERE viewname = 'calls_overview';
--    Should show security_invoker = true
--
-- 2. As anon user: SELECT * FROM public.calls_overview;
--    Should fail with permission denied
--
-- 3. As authenticated user with org_id in JWT:
--    SELECT * FROM public.calls_overview;
--    Should only return rows matching their org_id
-- =============================================================================
