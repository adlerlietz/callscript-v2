-- =============================================================================
-- Migration 26: Multi-Org Credentials RPC Function
-- =============================================================================
-- Creates a function to fetch all organizations with valid Ringba credentials.
-- Used by the Ingest Worker in multi-org mode.
-- =============================================================================

-- ============================================================================
-- FUNCTION: Get All Org Ringba Credentials
-- ============================================================================
-- Returns all active organizations with their Ringba credentials.
-- Credentials are stored encrypted and decrypted on retrieval.
-- Note: This function should only be called by service_role (workers).

CREATE OR REPLACE FUNCTION core.get_all_org_ringba_credentials()
RETURNS TABLE (
    org_id UUID,
    org_name TEXT,
    account_id TEXT,
    token TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    RETURN QUERY
    SELECT
        o.id AS org_id,
        o.name AS org_name,
        -- Get account_id credential
        (
            SELECT core.get_org_credential(o.id, 'ringba', 'account_id')
        ) AS account_id,
        -- Get token credential
        (
            SELECT core.get_org_credential(o.id, 'ringba', 'token')
        ) AS token
    FROM core.organizations o
    WHERE o.is_active = true
    AND EXISTS (
        -- Only return orgs that have Ringba credentials
        SELECT 1 FROM core.organization_credentials oc
        WHERE oc.org_id = o.id
        AND oc.provider = 'ringba'
    );
END;
$$;

COMMENT ON FUNCTION core.get_all_org_ringba_credentials() IS
'Returns all active organizations with their decrypted Ringba credentials for multi-org ingestion.';

-- Grant execute to service_role (used by workers)
GRANT EXECUTE ON FUNCTION core.get_all_org_ringba_credentials() TO service_role;

-- ============================================================================
-- Done.
-- ============================================================================
