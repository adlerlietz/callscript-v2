-- =============================================================================
-- Migration 33: Create RPC for upserting settings
-- =============================================================================
-- PostgREST upsert doesn't work well with views, so we create a dedicated RPC.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.upsert_setting(
    p_org_id UUID,
    p_key TEXT,
    p_value JSONB,
    p_description TEXT DEFAULT NULL,
    p_is_secret BOOLEAN DEFAULT false
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    INSERT INTO core.settings (org_id, key, value, description, is_secret, updated_at)
    VALUES (p_org_id, p_key, p_value, p_description, p_is_secret, now())
    ON CONFLICT (org_id, key) DO UPDATE SET
        value = EXCLUDED.value,
        description = COALESCE(EXCLUDED.description, core.settings.description),
        is_secret = COALESCE(EXCLUDED.is_secret, core.settings.is_secret),
        updated_at = now();
END;
$$;

-- Grant to service_role for admin API calls
GRANT EXECUTE ON FUNCTION public.upsert_setting(UUID, TEXT, JSONB, TEXT, BOOLEAN) TO service_role;

COMMENT ON FUNCTION public.upsert_setting IS 'Upsert a single setting for an organization';
