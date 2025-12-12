-- 11_schedule_vault.sql
-- Schedule recording-watcher (Vault Lane) to run every 2 minutes

-- Idempotent: Unschedule existing job if it exists
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM cron.job WHERE jobname = 'vault_recording_watcher'
    ) THEN
        PERFORM cron.unschedule(jobid)
        FROM cron.job
        WHERE jobname = 'vault_recording_watcher';
    END IF;
END;
$$;

-- Schedule the job to run every 2 minutes
SELECT cron.schedule(
    'vault_recording_watcher',                                 -- jobname
    '*/2 * * * *',                                             -- schedule (every 2 minutes)
    $$
    SELECT net.http_post(
        url := 'http://kong:8000/functions/v1/recording-watcher',
        headers := '{"Content-Type": "application/json"}'::jsonb,
        body := '{}'::jsonb,
        timeout_milliseconds := 120000  -- 2 minute timeout
    ) AS request_id;
    $$
);
