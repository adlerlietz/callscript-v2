-- 10_schedule_ingest.sql
-- Schedule sync-ringba-realtime Edge Function to run every 5 minutes via pg_cron

-- Idempotent: Unschedule existing job if it exists
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM cron.job WHERE jobname = 'sync_ringba_realtime'
    ) THEN
        PERFORM cron.unschedule(jobid)
        FROM cron.job
        WHERE jobname = 'sync_ringba_realtime';
    END IF;
END;
$$;

-- Schedule the job to run every 5 minutes
-- Uses internal Kong proxy (no auth required for internal calls)
SELECT cron.schedule(
    'sync_ringba_realtime',                                    -- jobname
    '*/5 * * * *',                                             -- schedule (every 5 minutes)
    $$
    SELECT net.http_post(
        url := 'http://kong:8000/functions/v1/sync-ringba-realtime',
        headers := '{"Content-Type": "application/json"}'::jsonb,
        body := '{}'::jsonb,
        timeout_milliseconds := 300000  -- 5 minute timeout (Edge Function may run long)
    ) AS request_id;
    $$
);
