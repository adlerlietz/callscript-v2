-- =============================================================================
-- Migration 47: Add Operational Metrics Columns
-- =============================================================================
-- Purpose: Enable AI Root Cause Analysis by capturing:
--   - Who hung up (endCallSource)
--   - Call outcome (callStatus)
--   - Duration breakdown (connectedCallLengthInSeconds, timeToAnswer)
--   - Conversion flag (isConverted)
--   - Target response (targetResponseStatus)
-- =============================================================================

-- Add operational columns to core.calls
ALTER TABLE core.calls
ADD COLUMN IF NOT EXISTS end_call_source TEXT,
ADD COLUMN IF NOT EXISTS call_status TEXT,
ADD COLUMN IF NOT EXISTS connected_duration INTEGER,
ADD COLUMN IF NOT EXISTS time_to_answer INTEGER,
ADD COLUMN IF NOT EXISTS is_converted BOOLEAN,
ADD COLUMN IF NOT EXISTS target_response_status TEXT;

-- Add comments for documentation
COMMENT ON COLUMN core.calls.end_call_source IS 'Who hung up: Caller, Target, System, etc. (from Ringba endCallSource)';
COMMENT ON COLUMN core.calls.call_status IS 'Call outcome: Completed, Abandoned, Busy, NoAnswer, etc. (from Ringba callStatus)';
COMMENT ON COLUMN core.calls.connected_duration IS 'Actual talk time in seconds (from Ringba connectedCallLengthInSeconds)';
COMMENT ON COLUMN core.calls.time_to_answer IS 'Seconds until call was answered (from Ringba timeToAnswer)';
COMMENT ON COLUMN core.calls.is_converted IS 'Whether call converted (from Ringba isConverted)';
COMMENT ON COLUMN core.calls.target_response_status IS 'Target response: Answered, Busy, NoAnswer, etc. (from Ringba targetResponseStatus)';

-- Create indexes for common query patterns
CREATE INDEX IF NOT EXISTS idx_calls_end_call_source
ON core.calls(end_call_source)
WHERE end_call_source IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_calls_call_status
ON core.calls(call_status)
WHERE call_status IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_calls_is_converted
ON core.calls(is_converted)
WHERE is_converted IS NOT NULL;

-- Grant permissions to authenticated users
GRANT SELECT ON core.calls TO authenticated;

-- =============================================================================
-- Re-enable geographic columns in ingest (state/city)
-- These columns already exist from migration 38, just ensuring they're usable
-- =============================================================================
-- Re-index for geographic queries if not exists
CREATE INDEX IF NOT EXISTS idx_calls_caller_city
ON core.calls(caller_city)
WHERE caller_city IS NOT NULL;
