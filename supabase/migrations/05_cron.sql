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

SELECT
    cron.schedule(
        jobname   => 'core_zombie_killer',
        schedule  => '*/30 * * * *',
        command   => $cmd$
            SELECT core.reset_stuck_calls();
        $cmd$
    );
