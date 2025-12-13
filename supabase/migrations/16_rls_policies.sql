-- =============================================================================
-- Migration 16: Row-Level Security Policies
-- =============================================================================
-- PHASE C: Run AFTER org_id is NOT NULL and backfilled
-- =============================================================================

-- =============================================================================
-- 1. Helper Function: Get current user's org_id from JWT
-- =============================================================================
CREATE OR REPLACE FUNCTION core.current_org_id()
RETURNS UUID AS $$
BEGIN
    -- org_id is set in app_metadata by auth hook
    RETURN (auth.jwt() -> 'app_metadata' ->> 'org_id')::uuid;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

COMMENT ON FUNCTION core.current_org_id IS
    'Extracts org_id from JWT app_metadata. Used by RLS policies.';


-- =============================================================================
-- 2. Helper Function: Check if user has specific role
-- =============================================================================
CREATE OR REPLACE FUNCTION core.user_has_role(required_roles TEXT[])
RETURNS BOOLEAN AS $$
BEGIN
    RETURN (auth.jwt() -> 'app_metadata' ->> 'org_role') = ANY(required_roles);
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

COMMENT ON FUNCTION core.user_has_role IS
    'Checks if current user has one of the required roles. Used by RLS policies.';


-- =============================================================================
-- 3. Enable RLS on all tenant tables
-- =============================================================================
ALTER TABLE core.organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.organization_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.organization_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.calls ENABLE ROW LEVEL SECURITY;


-- =============================================================================
-- 4. Organizations Policies
-- =============================================================================
-- Users can only see organizations they belong to

CREATE POLICY "org_select_own"
    ON core.organizations
    FOR SELECT
    TO authenticated
    USING (id = core.current_org_id());

-- Only owners can update org settings
CREATE POLICY "org_update_owner"
    ON core.organizations
    FOR UPDATE
    TO authenticated
    USING (id = core.current_org_id() AND core.user_has_role(ARRAY['owner']))
    WITH CHECK (id = core.current_org_id() AND core.user_has_role(ARRAY['owner']));


-- =============================================================================
-- 5. Organization Members Policies
-- =============================================================================
-- All members can see other members in their org

CREATE POLICY "members_select_own_org"
    ON core.organization_members
    FOR SELECT
    TO authenticated
    USING (org_id = core.current_org_id());

-- Only owners and admins can add/remove members
CREATE POLICY "members_insert_admin"
    ON core.organization_members
    FOR INSERT
    TO authenticated
    WITH CHECK (
        org_id = core.current_org_id()
        AND core.user_has_role(ARRAY['owner', 'admin'])
    );

CREATE POLICY "members_delete_admin"
    ON core.organization_members
    FOR DELETE
    TO authenticated
    USING (
        org_id = core.current_org_id()
        AND core.user_has_role(ARRAY['owner', 'admin'])
    );


-- =============================================================================
-- 6. Organization Credentials Policies
-- =============================================================================
-- Only owners and admins can view/manage credentials

CREATE POLICY "credentials_select_admin"
    ON core.organization_credentials
    FOR SELECT
    TO authenticated
    USING (
        org_id = core.current_org_id()
        AND core.user_has_role(ARRAY['owner', 'admin'])
    );

CREATE POLICY "credentials_all_admin"
    ON core.organization_credentials
    FOR ALL
    TO authenticated
    USING (
        org_id = core.current_org_id()
        AND core.user_has_role(ARRAY['owner', 'admin'])
    )
    WITH CHECK (
        org_id = core.current_org_id()
        AND core.user_has_role(ARRAY['owner', 'admin'])
    );


-- =============================================================================
-- 7. Campaigns Policies
-- =============================================================================
-- All org members can view campaigns

CREATE POLICY "campaigns_select_own_org"
    ON core.campaigns
    FOR SELECT
    TO authenticated
    USING (org_id = core.current_org_id());

-- Admins can manage campaigns
CREATE POLICY "campaigns_all_admin"
    ON core.campaigns
    FOR ALL
    TO authenticated
    USING (
        org_id = core.current_org_id()
        AND core.user_has_role(ARRAY['owner', 'admin'])
    )
    WITH CHECK (
        org_id = core.current_org_id()
        AND core.user_has_role(ARRAY['owner', 'admin'])
    );


-- =============================================================================
-- 8. Calls Policies
-- =============================================================================
-- All org members can view calls

CREATE POLICY "calls_select_own_org"
    ON core.calls
    FOR SELECT
    TO authenticated
    USING (org_id = core.current_org_id());

-- Reviewers can update call status (mark safe, confirm flagged)
CREATE POLICY "calls_update_reviewer"
    ON core.calls
    FOR UPDATE
    TO authenticated
    USING (org_id = core.current_org_id())
    WITH CHECK (org_id = core.current_org_id());


-- =============================================================================
-- 9. Service Role Bypass
-- =============================================================================
-- NOTE: service_role automatically bypasses RLS in Supabase
-- Workers and Edge Functions use service_role, so they can access all data
-- No additional policy needed


-- =============================================================================
-- VERIFICATION QUERIES
-- =============================================================================
/*
-- Check RLS is enabled:
SELECT tablename, rowsecurity
FROM pg_tables
WHERE schemaname = 'core'
  AND tablename IN ('organizations', 'organization_members', 'organization_credentials', 'campaigns', 'calls');

-- Expected: All rowsecurity = true

-- Check policies exist:
SELECT tablename, policyname, cmd
FROM pg_policies
WHERE schemaname = 'core';

-- Test RLS (simulate authenticated user with wrong org_id):
-- This should return 0 rows if RLS is working

SET ROLE authenticated;
SET request.jwt.claims = '{"app_metadata": {"org_id": "00000000-0000-0000-0000-000000000099", "org_role": "reviewer"}}';
SELECT COUNT(*) FROM core.calls;  -- Should be 0

-- Reset
RESET ROLE;
*/
