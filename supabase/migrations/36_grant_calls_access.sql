-- =============================================================================
-- Migration 36: Grant authenticated role access to core.calls
-- =============================================================================
-- With SECURITY INVOKER on calls_overview view, authenticated users need
-- direct SELECT permission on core.calls (RLS still applies for row filtering)
-- =============================================================================

-- Grant SELECT on core.calls to authenticated role
-- RLS policies will still filter rows by org_id
GRANT SELECT ON core.calls TO authenticated;

-- Also grant on other core tables that might be accessed via views
GRANT SELECT ON core.organizations TO authenticated;
GRANT SELECT ON core.campaigns TO authenticated;

-- Verify RLS is enabled (should already be, but ensure)
ALTER TABLE core.calls ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.campaigns ENABLE ROW LEVEL SECURITY;
