-- =============================================================================
-- Migration 35: Fix get_all_org_ringba_credentials function
-- =============================================================================
-- Fixes the function signature issue - get_org_credential takes (uuid, text)
-- not (uuid, text, text)
-- =============================================================================

-- Drop existing functions
DROP FUNCTION IF EXISTS public.get_all_org_ringba_credentials();
DROP FUNCTION IF EXISTS core.get_all_org_ringba_credentials();

-- Recreate with correct function calls
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
DECLARE
    rec RECORD;
    cred RECORD;
BEGIN
    -- Loop through orgs with vault credentials
    FOR rec IN
        SELECT o.id, o.name
        FROM core.organizations o
        WHERE o.is_active = true
        AND EXISTS (
            SELECT 1 FROM core.organization_credentials oc
            WHERE oc.org_id = o.id AND oc.provider = 'ringba'
        )
    LOOP
        -- Get credential from vault
        SELECT oc.account_id, vs.decrypted_secret
        INTO cred
        FROM core.organization_credentials oc
        JOIN vault.decrypted_secrets vs ON vs.name = oc.vault_secret_name
        WHERE oc.org_id = rec.id AND oc.provider = 'ringba';

        IF cred IS NOT NULL THEN
            org_id := rec.id;
            org_name := rec.name;
            account_id := cred.account_id;
            token := cred.decrypted_secret;
            RETURN NEXT;
        END IF;
    END LOOP;

    -- Fallback: loop through orgs with settings credentials (no vault)
    FOR rec IN
        SELECT
            o.id,
            o.name,
            -- Get account_id from settings, trim JSON quotes
            trim(both '"' from (
                SELECT s.value::text
                FROM core.settings s
                WHERE s.org_id = o.id AND s.key = 'ringba_account_id'
                LIMIT 1
            )) AS acct,
            -- Get token from settings, trim JSON quotes
            trim(both '"' from (
                SELECT s.value::text
                FROM core.settings s
                WHERE s.org_id = o.id AND s.key = 'ringba_api_token'
                LIMIT 1
            )) AS tok
        FROM core.organizations o
        WHERE o.is_active = true
        -- Only for orgs that DON'T have vault credentials
        AND NOT EXISTS (
            SELECT 1 FROM core.organization_credentials oc
            WHERE oc.org_id = o.id AND oc.provider = 'ringba'
        )
        -- But DO have settings credentials
        AND EXISTS (
            SELECT 1 FROM core.settings s
            WHERE s.org_id = o.id AND s.key = 'ringba_account_id'
        )
        AND EXISTS (
            SELECT 1 FROM core.settings s
            WHERE s.org_id = o.id AND s.key = 'ringba_api_token'
        )
    LOOP
        IF rec.acct IS NOT NULL AND rec.tok IS NOT NULL THEN
            org_id := rec.id;
            org_name := rec.name;
            account_id := rec.acct;
            token := rec.tok;
            RETURN NEXT;
        END IF;
    END LOOP;
END;
$$;

-- Recreate public wrapper
CREATE OR REPLACE FUNCTION public.get_all_org_ringba_credentials()
RETURNS TABLE (org_id UUID, org_name TEXT, account_id TEXT, token TEXT)
LANGUAGE sql
SECURITY DEFINER
AS $$
    SELECT * FROM core.get_all_org_ringba_credentials();
$$;

GRANT EXECUTE ON FUNCTION public.get_all_org_ringba_credentials() TO service_role;

COMMENT ON FUNCTION core.get_all_org_ringba_credentials() IS
'Returns all active organizations with Ringba credentials (vault + settings fallback).';
