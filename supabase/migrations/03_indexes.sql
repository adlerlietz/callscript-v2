-- Indexes for queue performance (LIFO and helpers)

CREATE INDEX IF NOT EXISTS idx_calls_queue
ON core.calls (status, start_time_utc DESC);

CREATE INDEX IF NOT EXISTS idx_calls_ringba_call_id
ON core.calls (ringba_call_id);

CREATE INDEX IF NOT EXISTS idx_calls_campaign_time
ON core.calls (campaign_id, start_time_utc DESC);
