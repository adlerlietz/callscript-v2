-- =============================================================================
-- Migration 53: Fix permissions for enhanced get_leaderboard function
-- =============================================================================
-- Migration 52 changed the function signature but didn't update grants
-- =============================================================================

-- Grant execute permission for the new function signature
GRANT EXECUTE ON FUNCTION core.get_leaderboard(UUID, TEXT, TEXT, DATE, DATE, TEXT, TEXT, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION core.get_leaderboard(UUID, TEXT, TEXT, DATE, DATE, TEXT, TEXT, INTEGER) TO service_role;

-- Also ensure the anon role can't call it (defense in depth)
REVOKE EXECUTE ON FUNCTION core.get_leaderboard(UUID, TEXT, TEXT, DATE, DATE, TEXT, TEXT, INTEGER) FROM anon;
