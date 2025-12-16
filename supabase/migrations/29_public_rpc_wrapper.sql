-- =============================================================================
-- Migration 29: Public wrapper for org credentials RPC
-- =============================================================================
-- PostgREST only exposes functions in public schema by default.
-- Create wrapper to expose core.get_all_org_ringba_credentials().
-- =============================================================================

CREATE OR REPLACE FUNCTION public.get_all_org_ringba_credentials()
RETURNS TABLE (org_id UUID, org_name TEXT, account_id TEXT, token TEXT)
LANGUAGE sql
SECURITY DEFINER
AS $$
    SELECT * FROM core.get_all_org_ringba_credentials();
$$;

-- Grant to service_role (workers use this key)
GRANT EXECUTE ON FUNCTION public.get_all_org_ringba_credentials() TO service_role;

COMMENT ON FUNCTION public.get_all_org_ringba_credentials() IS
'Public wrapper for core.get_all_org_ringba_credentials - used by ingest workers in multi-org mode.';
