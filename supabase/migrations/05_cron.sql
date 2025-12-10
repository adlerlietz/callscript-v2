-- pg_cron job: run Zombie Killer every 30 minutes

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM cron.job WHERE jobname = 'core_zombie_killer'
    ) THEN
        PERFORM cron.unschedule(jobid)
        FROM cron.job
        WHERE jobname = 'core_zombie_killer';
    END IF;
END;
$$;

SELECT cron.schedule(
    'core_zombie_killer',          -- jobname
    '*/30 * * * *',                -- schedule (every 30 minutes)
    'SELECT core.reset_stuck_calls();'  -- command
);
