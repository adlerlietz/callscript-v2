-- =============================================================================
-- Migration 50: Add campaign_name and vertical columns for AI Explore
-- =============================================================================
-- Problem: AI can't query "bad calls by campaign" or "by vertical" because
-- these values are in the campaigns table, not denormalized on calls.
--
-- Solution: Denormalize campaign_name and vertical onto calls table
-- (follows existing pattern: publisher_name, buyer_name, target_name)
-- =============================================================================

-- Step 1: Add columns to calls table
ALTER TABLE core.calls ADD COLUMN IF NOT EXISTS campaign_name TEXT;
ALTER TABLE core.calls ADD COLUMN IF NOT EXISTS vertical TEXT;

-- Step 2: Backfill existing calls from campaigns table
UPDATE core.calls c
SET
  campaign_name = cam.name,
  vertical = cam.vertical
FROM core.campaigns cam
WHERE c.campaign_id = cam.id
  AND (c.campaign_name IS NULL OR c.vertical IS NULL);

-- Step 3: Create index for vertical analytics
CREATE INDEX IF NOT EXISTS idx_calls_vertical
ON core.calls(vertical)
WHERE vertical IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_calls_campaign_name
ON core.calls(campaign_name)
WHERE campaign_name IS NOT NULL;

-- Step 4: Update get_leaderboard RPC to support 'vertical' dimension
CREATE OR REPLACE FUNCTION core.get_leaderboard(
  p_org_id UUID,
  p_dimension TEXT,
  p_metric TEXT,
  p_start_date DATE,
  p_end_date DATE
)
RETURNS TABLE(name TEXT, value NUMERIC, total_calls BIGINT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = core, public
AS $$
BEGIN
  -- Validate dimension parameter (added 'vertical')
  IF p_dimension NOT IN ('publisher', 'buyer', 'campaign', 'state', 'vertical') THEN
    RAISE EXCEPTION 'Invalid dimension: %. Must be one of: publisher, buyer, campaign, state, vertical', p_dimension;
  END IF;

  -- Validate metric parameter
  IF p_metric NOT IN ('revenue', 'profit', 'calls', 'flag_rate') THEN
    RAISE EXCEPTION 'Invalid metric: %. Must be one of: revenue, profit, calls, flag_rate', p_metric;
  END IF;

  RETURN QUERY
  SELECT
    CASE p_dimension
      WHEN 'publisher' THEN COALESCE(c.publisher_name, c.publisher_id, 'Unknown')
      WHEN 'buyer' THEN COALESCE(c.buyer_name, 'Unknown')
      WHEN 'campaign' THEN COALESCE(c.campaign_name, 'Unknown')
      WHEN 'vertical' THEN COALESCE(c.vertical, 'Unknown')
      WHEN 'state' THEN COALESCE(c.caller_state, 'Unknown')
      ELSE 'Unknown'
    END AS name,
    CASE p_metric
      WHEN 'revenue' THEN COALESCE(SUM(c.revenue), 0)
      WHEN 'profit' THEN COALESCE(SUM(c.revenue), 0) - COALESCE(SUM(c.payout), 0)
      WHEN 'calls' THEN COUNT(*)::numeric
      WHEN 'flag_rate' THEN
        CASE WHEN COUNT(*) > 0
          THEN ROUND((COUNT(*) FILTER (WHERE c.status = 'flagged')::numeric / COUNT(*) * 100), 2)
          ELSE 0
        END
      ELSE COALESCE(SUM(c.revenue), 0)
    END AS value,
    COUNT(*) AS total_calls
  FROM core.calls c
  WHERE c.org_id = p_org_id
    AND c.start_time_utc::date BETWEEN p_start_date AND p_end_date
  GROUP BY 1
  ORDER BY 2 DESC
  LIMIT 25;  -- Safety: max 25 entries to prevent token overflow
END;
$$;

COMMENT ON FUNCTION core.get_leaderboard IS 'AI Tool: Get top performers by dimension (publisher, buyer, campaign, vertical, state) and metric (max 25 entries)';

-- Step 5: Add comments for documentation
COMMENT ON COLUMN core.calls.campaign_name IS 'Denormalized campaign name for analytics (from campaigns table)';
COMMENT ON COLUMN core.calls.vertical IS 'Denormalized vertical for analytics (from campaigns table, e.g. aca, medicare, solar)';

-- Log results
DO $$
DECLARE
  backfilled_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO backfilled_count
  FROM core.calls
  WHERE campaign_name IS NOT NULL;
  RAISE NOTICE 'Migration complete: % calls have campaign_name populated', backfilled_count;
END $$;
