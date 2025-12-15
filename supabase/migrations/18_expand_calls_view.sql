-- 18_expand_calls_view.sql
-- Expand calls_overview to include all fields needed by frontend

DROP VIEW IF EXISTS public.calls_overview CASCADE;

CREATE VIEW public.calls_overview AS
SELECT
  c.id,
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
  'Full call data view for CallScript dashboard (read-only).';

GRANT SELECT ON public.calls_overview TO authenticated, service_role, anon;
