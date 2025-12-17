-- =============================================================================
-- Migration 37: Grant authenticated role access to all core tables
-- =============================================================================
-- With SECURITY INVOKER views, authenticated users need SELECT permission
-- on underlying tables. RLS policies handle row-level filtering.
-- =============================================================================

-- Grant SELECT on all core tables to authenticated role
GRANT SELECT ON core.calls TO authenticated;
GRANT SELECT ON core.organizations TO authenticated;
GRANT SELECT ON core.organization_members TO authenticated;
GRANT SELECT ON core.campaigns TO authenticated;
GRANT SELECT ON core.settings TO authenticated;
GRANT SELECT ON core.qa_rules TO authenticated;

-- Grant UPDATE where needed (for call status updates)
GRANT UPDATE ON core.calls TO authenticated;

-- Ensure RLS is enabled on all tables
ALTER TABLE core.calls ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.organization_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.qa_rules ENABLE ROW LEVEL SECURITY;
