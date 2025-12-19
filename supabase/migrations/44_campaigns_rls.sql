-- =============================================================================
-- Migration 44: Add RLS Policy for Campaigns
-- =============================================================================
-- core.campaigns had RLS enabled but no policy, blocking all access.
-- =============================================================================

-- SELECT: Users can see campaigns belonging to their org
CREATE POLICY "campaigns_select_policy"
ON core.campaigns
FOR SELECT
TO authenticated
USING (org_id = core.current_org_id());

-- INSERT: Owner/admin can create campaigns for their org
CREATE POLICY "campaigns_insert_policy"
ON core.campaigns
FOR INSERT
TO authenticated
WITH CHECK (
    org_id = core.current_org_id()
    AND core.user_has_role(ARRAY['owner', 'admin'])
);

-- UPDATE: Owner/admin can update their org's campaigns
CREATE POLICY "campaigns_update_policy"
ON core.campaigns
FOR UPDATE
TO authenticated
USING (
    org_id = core.current_org_id()
    AND core.user_has_role(ARRAY['owner', 'admin'])
)
WITH CHECK (
    org_id = core.current_org_id()
    AND core.user_has_role(ARRAY['owner', 'admin'])
);

-- DELETE: Owner/admin can delete their org's campaigns
CREATE POLICY "campaigns_delete_policy"
ON core.campaigns
FOR DELETE
TO authenticated
USING (
    org_id = core.current_org_id()
    AND core.user_has_role(ARRAY['owner', 'admin'])
);
