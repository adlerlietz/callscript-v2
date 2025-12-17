-- =============================================================================
-- Migration 31: Public wrapper for store_org_credential RPC
-- =============================================================================
-- PostgREST only exposes functions in public schema by default.
-- Create wrapper to expose core.store_org_credential() for Settings API.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.store_org_credential(
    p_org_id UUID,
    p_provider TEXT,
    p_account_id TEXT,
    p_token TEXT
)
RETURNS UUID
LANGUAGE sql
SECURITY DEFINER
AS $$
    SELECT core.store_org_credential(p_org_id, p_provider, p_account_id, p_token);
$$;

-- Grant to service_role (API uses this key for admin operations)
GRANT EXECUTE ON FUNCTION public.store_org_credential(UUID, TEXT, TEXT, TEXT) TO service_role;

COMMENT ON FUNCTION public.store_org_credential IS
'Public wrapper for core.store_org_credential - stores Ringba credentials in vault.';
