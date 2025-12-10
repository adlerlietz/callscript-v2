-- 07_public_views.sql
-- Create a safe, read-only public view for listing calls in the dashboard.

CREATE OR REPLACE VIEW public.calls_overview AS
SELECT
  c.id,
  c.ringba_call_id,
  c.start_time_utc,
  c.day_bucket,
  c.hour_bucket,
  c.caller_number,
  c.has_recording,
  c.source,
  c.status
FROM core.calls AS c;

COMMENT ON VIEW public.calls_overview IS
  'Safe, read-only list of calls (no PII beyond caller_number) for the CallScript dashboard.';

-- Grant read access to app roles (we can open this up further later if needed)
GRANT SELECT ON public.calls_overview TO authenticated, service_role;
