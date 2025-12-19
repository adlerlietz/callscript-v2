-- Migration: Add 'skipped' status for calls that shouldn't be processed
--
-- Problem: Calls that are too short or have no audio URL clog the queue
-- Solution: New status 'skipped' with skip_reason to explain why
--
-- Skip reasons:
--   - 'too_short': duration < 5 seconds (not enough audio to transcribe)
--   - 'zero_duration': duration = 0 (no audio at all)
--   - 'no_recording': no audio_url after 24h (Ringba didn't provide recording)
--   - 'no_duration': duration is NULL (incomplete metadata)

-- Step 1: Add skip_reason column
ALTER TABLE core.calls
ADD COLUMN IF NOT EXISTS skip_reason TEXT;

-- Step 2: Drop old constraint and add new one with 'skipped' status
ALTER TABLE core.calls DROP CONSTRAINT IF EXISTS status_valid;

ALTER TABLE core.calls ADD CONSTRAINT status_valid CHECK (
    status IN (
        'pending',
        'downloaded',
        'processing',
        'transcribed',
        'flagged',
        'safe',
        'failed',
        'skipped'  -- NEW: intentionally not processed
    )
);

-- Step 3: Add index for skip_reason analytics
CREATE INDEX IF NOT EXISTS idx_calls_skip_reason
ON core.calls(skip_reason)
WHERE skip_reason IS NOT NULL;

-- Step 4: Update existing stuck calls based on duration analysis
-- These are calls that have been pending with no audio_url

-- 4a: Zero duration calls → skipped (zero_duration)
UPDATE core.calls
SET status = 'skipped',
    skip_reason = 'zero_duration',
    updated_at = NOW()
WHERE status = 'pending'
  AND audio_url IS NULL
  AND duration_seconds = 0;

-- 4b: Very short calls (1-4 seconds) → skipped (too_short)
UPDATE core.calls
SET status = 'skipped',
    skip_reason = 'too_short',
    updated_at = NOW()
WHERE status = 'pending'
  AND audio_url IS NULL
  AND duration_seconds > 0
  AND duration_seconds < 5;

-- 4c: Calls with NULL duration that are older than 24h → skipped (no_duration)
-- These have incomplete metadata and won't get better
UPDATE core.calls
SET status = 'skipped',
    skip_reason = 'no_duration',
    updated_at = NOW()
WHERE status = 'pending'
  AND audio_url IS NULL
  AND duration_seconds IS NULL
  AND start_time_utc < NOW() - INTERVAL '24 hours';

-- 4d: Calls with duration >= 5s but no audio_url after 24h → skipped (no_recording)
-- Ringba should have provided a recording URL by now
UPDATE core.calls
SET status = 'skipped',
    skip_reason = 'no_recording',
    updated_at = NOW()
WHERE status = 'pending'
  AND audio_url IS NULL
  AND duration_seconds >= 5
  AND start_time_utc < NOW() - INTERVAL '24 hours';

-- Step 5: Update the calls_overview view to exclude skipped calls from active counts
-- (The view already filters by org_id, we just need to update queue displays)

-- Step 6: Add comment for documentation
COMMENT ON COLUMN core.calls.skip_reason IS 'Reason call was skipped: too_short, zero_duration, no_recording, no_duration';

-- Log results (will show in migration output)
DO $$
DECLARE
    skipped_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO skipped_count FROM core.calls WHERE status = 'skipped';
    RAISE NOTICE 'Migration complete: % calls marked as skipped', skipped_count;
END $$;
