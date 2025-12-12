-- 09_fix_calls_overview.sql
-- Force recreation of calls_overview with audio_url field

DROP VIEW IF EXISTS public.calls_overview CASCADE;

CREATE VIEW public.calls_overview AS
SELECT
  c.id,
  c.ringba_call_id,
  c.start_time_utc,
  c.day_bucket,
  c.hour_bucket,
  c.caller_number,
  c.audio_url,
  c.has_recording,
  c.source,
  c.status
FROM core.calls AS c;

COMMENT ON VIEW public.calls_overview IS
  'Safe, read-only list of calls (no PII beyond caller_number) for the CallScript dashboard.';

GRANT SELECT ON public.calls_overview TO authenticated, service_role, anon;
