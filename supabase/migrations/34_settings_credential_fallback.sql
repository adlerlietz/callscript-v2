-- =============================================================================
-- Migration 34: Fallback to Settings for Ringba Credentials
-- =============================================================================
-- Updates get_all_org_ringba_credentials to also check settings table
-- when vault credentials don't exist. This handles orgs that saved
-- credentials via Settings UI before vault storage was working.
-- =============================================================================

-- First, add settings for upbeat.chat org (their credentials were saved under wrong org)
SELECT public.upsert_setting(
    '9096238d-852b-41dd-93ca-747bfa19e98b'::uuid,
    'ringba_account_id',
    '"RA9ba54ee022bf4ef5882c9563613679bc"'::jsonb,
    'Ringba Account ID',
    false
);

SELECT public.upsert_setting(
    '9096238d-852b-41dd-93ca-747bfa19e98b'::uuid,
    'ringba_api_token',
    '"09f0c9f0eca30423a41098458328abeb3b1f78c007beff33b0aaa367d17b5f876d53a5ccb07c9328e23f2d846eb122c2439659a1da2ada7996fc84d188b9f2c3eb71e2ab6ccf3c5c524af6ff6d8a8d9f6da21c26cd50bb658f6ad74d4ee0ee751c8c117473748c39a2f9ff08551238933a1f98af"'::jsonb,
    'Ringba API Token',
    true
);

-- Also clean up: delete the incomplete organization_credentials entry
-- (was created without vault secret due to permission error)
DELETE FROM core.organization_credentials
WHERE org_id = '9096238d-852b-41dd-93ca-747bfa19e98b'
  AND provider = 'ringba';

-- Drop existing function
DROP FUNCTION IF EXISTS core.get_all_org_ringba_credentials();

-- Recreate with settings fallback
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
    -- First, try vault credentials
    SELECT
        o.id AS org_id,
        o.name AS org_name,
        (SELECT core.get_org_credential(o.id, 'ringba', 'account_id')) AS account_id,
        (SELECT core.get_org_credential(o.id, 'ringba', 'token')) AS token
    FROM core.organizations o
    WHERE o.is_active = true
    AND EXISTS (
        SELECT 1 FROM core.organization_credentials oc
        WHERE oc.org_id = o.id AND oc.provider = 'ringba'
    )

    UNION ALL

    -- Fallback: check settings table for orgs without vault credentials
    SELECT
        o.id AS org_id,
        o.name AS org_name,
        -- Parse account_id from settings JSON
        COALESCE(
            (
                SELECT s.value::text
                FROM core.settings s
                WHERE s.org_id = o.id AND s.key = 'ringba_account_id'
            )::jsonb ->> 0,  -- Handle JSON string wrapper
            (
                SELECT s.value::text
                FROM core.settings s
                WHERE s.org_id = o.id AND s.key = 'ringba_account_id'
            )
        ) AS account_id,
        -- Parse token from settings JSON
        COALESCE(
            (
                SELECT s.value::text
                FROM core.settings s
                WHERE s.org_id = o.id AND s.key = 'ringba_api_token'
            )::jsonb ->> 0,  -- Handle JSON string wrapper
            (
                SELECT s.value::text
                FROM core.settings s
                WHERE s.org_id = o.id AND s.key = 'ringba_api_token'
            )
        ) AS token
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
    );
END;
$$;

-- Update public wrapper
DROP FUNCTION IF EXISTS public.get_all_org_ringba_credentials();

CREATE OR REPLACE FUNCTION public.get_all_org_ringba_credentials()
RETURNS TABLE (org_id UUID, org_name TEXT, account_id TEXT, token TEXT)
LANGUAGE sql
SECURITY DEFINER
AS $$
    SELECT * FROM core.get_all_org_ringba_credentials();
$$;

GRANT EXECUTE ON FUNCTION public.get_all_org_ringba_credentials() TO service_role;

COMMENT ON FUNCTION core.get_all_org_ringba_credentials() IS
'Returns all active organizations with Ringba credentials (from vault or settings fallback).';
