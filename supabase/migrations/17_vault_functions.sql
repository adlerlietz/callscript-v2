-- =============================================================================
-- Migration 17: Vault Functions for Credential Management
-- =============================================================================
-- Functions to securely store/retrieve per-org API credentials
-- Uses Supabase Vault for encrypted storage
-- =============================================================================

-- =============================================================================
-- 1. Store Organization Credential
-- =============================================================================
-- Stores API token in Vault and creates reference in organization_credentials

CREATE OR REPLACE FUNCTION core.store_org_credential(
    p_org_id UUID,
    p_provider TEXT,
    p_account_id TEXT,
    p_token TEXT
)
RETURNS UUID AS $$
DECLARE
    v_secret_name TEXT;
    v_cred_id UUID;
BEGIN
    -- Generate unique secret name
    v_secret_name := p_provider || '_token_' || p_org_id::text;

    -- Store encrypted token in Vault
    -- Upsert to allow updating existing token
    INSERT INTO vault.secrets (name, secret, description)
    VALUES (
        v_secret_name,
        p_token,
        format('%s API token for organization %s', initcap(p_provider), p_org_id)
    )
    ON CONFLICT (name) DO UPDATE
        SET secret = EXCLUDED.secret,
            updated_at = now();

    -- Store reference in organization_credentials table
    INSERT INTO core.organization_credentials (
        org_id,
        provider,
        account_id,
        vault_secret_name,
        is_valid,
        last_sync_at
    )
    VALUES (
        p_org_id,
        p_provider,
        p_account_id,
        v_secret_name,
        true,
        NULL
    )
    ON CONFLICT (org_id, provider) DO UPDATE
        SET account_id = EXCLUDED.account_id,
            vault_secret_name = EXCLUDED.vault_secret_name,
            is_valid = true,
            last_error = NULL,
            updated_at = now()
    RETURNING id INTO v_cred_id;

    RETURN v_cred_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION core.store_org_credential IS
    'Stores API credential in Vault (encrypted) and creates reference record.';


-- =============================================================================
-- 2. Get Organization Credential (for Edge Functions / Workers)
-- =============================================================================
-- Retrieves decrypted credential for use in API calls
-- Only callable by service_role (SECURITY DEFINER)

CREATE OR REPLACE FUNCTION core.get_org_credential(
    p_org_id UUID,
    p_provider TEXT DEFAULT 'ringba'
)
RETURNS TABLE (
    account_id TEXT,
    token TEXT,
    is_valid BOOLEAN,
    last_sync_at TIMESTAMPTZ
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        oc.account_id,
        vs.decrypted_secret AS token,
        oc.is_valid,
        oc.last_sync_at
    FROM core.organization_credentials oc
    JOIN vault.decrypted_secrets vs ON vs.name = oc.vault_secret_name
    WHERE oc.org_id = p_org_id
      AND oc.provider = p_provider;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION core.get_org_credential IS
    'Retrieves decrypted API credential from Vault. Service role only.';


-- =============================================================================
-- 3. Mark Credential Invalid (on API failure)
-- =============================================================================
CREATE OR REPLACE FUNCTION core.mark_credential_invalid(
    p_org_id UUID,
    p_provider TEXT,
    p_error TEXT
)
RETURNS VOID AS $$
BEGIN
    UPDATE core.organization_credentials
    SET
        is_valid = false,
        last_error = p_error,
        updated_at = now()
    WHERE org_id = p_org_id
      AND provider = p_provider;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- =============================================================================
-- 4. Update Last Sync Time (on successful sync)
-- =============================================================================
CREATE OR REPLACE FUNCTION core.mark_credential_synced(
    p_org_id UUID,
    p_provider TEXT DEFAULT 'ringba'
)
RETURNS VOID AS $$
BEGIN
    UPDATE core.organization_credentials
    SET
        is_valid = true,
        last_sync_at = now(),
        last_error = NULL,
        updated_at = now()
    WHERE org_id = p_org_id
      AND provider = p_provider;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- =============================================================================
-- 5. Get All Active Credentials (for Ingest Loop)
-- =============================================================================
-- Returns all orgs with valid credentials for batch processing

CREATE OR REPLACE FUNCTION core.get_active_org_credentials(
    p_provider TEXT DEFAULT 'ringba'
)
RETURNS TABLE (
    org_id UUID,
    org_name TEXT,
    account_id TEXT,
    token TEXT
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        o.id AS org_id,
        o.name AS org_name,
        oc.account_id,
        vs.decrypted_secret AS token
    FROM core.organizations o
    JOIN core.organization_credentials oc ON oc.org_id = o.id
    JOIN vault.decrypted_secrets vs ON vs.name = oc.vault_secret_name
    WHERE o.is_active = true
      AND oc.provider = p_provider
      AND oc.is_valid = true;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION core.get_active_org_credentials IS
    'Returns all active orgs with valid credentials for batch ingest.';


-- =============================================================================
-- 6. Delete Credential (when org removes integration)
-- =============================================================================
CREATE OR REPLACE FUNCTION core.delete_org_credential(
    p_org_id UUID,
    p_provider TEXT
)
RETURNS VOID AS $$
DECLARE
    v_secret_name TEXT;
BEGIN
    -- Get secret name before deleting reference
    SELECT vault_secret_name INTO v_secret_name
    FROM core.organization_credentials
    WHERE org_id = p_org_id AND provider = p_provider;

    -- Delete from Vault
    IF v_secret_name IS NOT NULL THEN
        DELETE FROM vault.secrets WHERE name = v_secret_name;
    END IF;

    -- Delete reference
    DELETE FROM core.organization_credentials
    WHERE org_id = p_org_id AND provider = p_provider;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- =============================================================================
-- VERIFICATION QUERIES
-- =============================================================================
/*
-- Check functions exist:
SELECT routine_name, routine_type
FROM information_schema.routines
WHERE routine_schema = 'core'
  AND routine_name LIKE '%credential%';

-- Test storing a credential (use service role in SQL editor):
SELECT core.store_org_credential(
    '00000000-0000-0000-0000-000000000001'::uuid,
    'ringba',
    'test-account-id',
    'test-token-value'
);

-- Test retrieving:
SELECT * FROM core.get_org_credential('00000000-0000-0000-0000-000000000001'::uuid);

-- Clean up test:
SELECT core.delete_org_credential('00000000-0000-0000-0000-000000000001'::uuid, 'ringba');
*/
