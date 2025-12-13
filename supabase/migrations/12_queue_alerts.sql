-- 12_queue_alerts.sql
-- Database-level queue monitoring with pg_cron + pg_net
-- Sends webhook alerts when queue exceeds threshold

-- Requires: pg_cron, pg_net extensions (already enabled)

-- 1. Create alert function
CREATE OR REPLACE FUNCTION core.check_queue_and_alert()
RETURNS void AS $$
DECLARE
    v_pending_count INTEGER;
    v_processing_count INTEGER;
    v_failed_count INTEGER;
    v_alert_threshold INTEGER := 200;  -- Alert when pending > 200
    v_stuck_threshold INTEGER := 10;   -- Alert when processing > 10 for extended time
    v_webhook_url TEXT;
    v_payload JSONB;
BEGIN
    -- Get current counts
    SELECT COUNT(*) INTO v_pending_count FROM core.calls WHERE status = 'pending';
    SELECT COUNT(*) INTO v_processing_count FROM core.calls WHERE status = 'processing';
    SELECT COUNT(*) INTO v_failed_count FROM core.calls WHERE status = 'failed';

    -- Check pending queue backup
    IF v_pending_count > v_alert_threshold THEN
        v_webhook_url := current_setting('app.settings.slack_webhook', true);

        IF v_webhook_url IS NOT NULL AND v_webhook_url != '' THEN
            v_payload := jsonb_build_object(
                'text', format(
                    ':warning: *CallScript Queue Alert*%sPending queue backup: %s calls (threshold: %s)%sProcessing: %s | Failed: %s',
                    E'\n', v_pending_count, v_alert_threshold,
                    E'\n', v_processing_count, v_failed_count
                ),
                'username', 'CallScript DB',
                'icon_emoji', ':database:'
            );

            PERFORM net.http_post(
                url := v_webhook_url,
                headers := '{"Content-Type": "application/json"}'::jsonb,
                body := v_payload
            );
        END IF;
    END IF;

    -- Log check (visible in pg_cron logs)
    RAISE NOTICE 'Queue check: pending=%, processing=%, failed=%',
        v_pending_count, v_processing_count, v_failed_count;
END;
$$ LANGUAGE plpgsql;

-- 2. Create stall detection function
CREATE OR REPLACE FUNCTION core.detect_pipeline_stall()
RETURNS void AS $$
DECLARE
    v_stalled_count INTEGER;
    v_oldest_stalled TIMESTAMPTZ;
    v_webhook_url TEXT;
    v_payload JSONB;
BEGIN
    -- Find calls stuck in processing for > 1 hour
    SELECT COUNT(*), MIN(updated_at)
    INTO v_stalled_count, v_oldest_stalled
    FROM core.calls
    WHERE status = 'processing'
      AND updated_at < (now() - INTERVAL '1 hour');

    IF v_stalled_count > 0 THEN
        v_webhook_url := current_setting('app.settings.slack_webhook', true);

        IF v_webhook_url IS NOT NULL AND v_webhook_url != '' THEN
            v_payload := jsonb_build_object(
                'text', format(
                    ':rotating_light: *CallScript STALL DETECTED*%s%s calls stuck in processing for >1 hour%sOldest: %s%sZombie killer should reset these in next 30min cycle.',
                    E'\n', v_stalled_count,
                    E'\n', v_oldest_stalled,
                    E'\n'
                ),
                'username', 'CallScript DB',
                'icon_emoji', ':zombie:'
            );

            PERFORM net.http_post(
                url := v_webhook_url,
                headers := '{"Content-Type": "application/json"}'::jsonb,
                body := v_payload
            );
        END IF;
    END IF;
END;
$$ LANGUAGE plpgsql;

-- 3. Schedule queue check (every 15 minutes)
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'queue_alert_check') THEN
        PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'queue_alert_check';
    END IF;
END;
$$;

SELECT cron.schedule(
    'queue_alert_check',
    '*/15 * * * *',  -- Every 15 minutes
    'SELECT core.check_queue_and_alert();'
);

-- 4. Schedule stall detection (every 30 minutes, offset from zombie killer)
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'stall_detection') THEN
        PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'stall_detection';
    END IF;
END;
$$;

SELECT cron.schedule(
    'stall_detection',
    '15,45 * * * *',  -- At :15 and :45 (offset from zombie killer at :00 and :30)
    'SELECT core.detect_pipeline_stall();'
);

-- 5. Create health check view for monitoring
CREATE OR REPLACE VIEW core.pipeline_health AS
SELECT
    (SELECT COUNT(*) FROM core.calls WHERE status = 'pending') AS pending,
    (SELECT COUNT(*) FROM core.calls WHERE status = 'downloaded') AS downloaded,
    (SELECT COUNT(*) FROM core.calls WHERE status = 'processing') AS processing,
    (SELECT COUNT(*) FROM core.calls WHERE status = 'transcribed') AS transcribed,
    (SELECT COUNT(*) FROM core.calls WHERE status = 'flagged') AS flagged,
    (SELECT COUNT(*) FROM core.calls WHERE status = 'safe') AS safe,
    (SELECT COUNT(*) FROM core.calls WHERE status = 'failed') AS failed,
    (SELECT COUNT(*) FROM core.calls WHERE status = 'processing' AND updated_at < now() - INTERVAL '30 minutes') AS stuck,
    now() AS checked_at;

-- Grant access to service role
GRANT SELECT ON core.pipeline_health TO service_role;
