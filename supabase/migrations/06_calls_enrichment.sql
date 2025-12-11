-- 06_calls_enrichment.sql
-- Add basic derived / enrichment columns to core.calls

ALTER TABLE core.calls
    ADD COLUMN IF NOT EXISTS day_bucket date
        GENERATED ALWAYS AS ((start_time_utc AT TIME ZONE 'UTC')::date) STORED,
    ADD COLUMN IF NOT EXISTS hour_bucket int
        GENERATED ALWAYS AS (EXTRACT(HOUR FROM (start_time_utc AT TIME ZONE 'UTC'))) STORED,
    ADD COLUMN IF NOT EXISTS has_recording boolean
        GENERATED ALWAYS AS (audio_url IS NOT NULL) STORED,
    ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'ringba';
