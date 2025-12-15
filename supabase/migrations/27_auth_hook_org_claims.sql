-- =============================================================================
-- Migration 27: Auth Hook for Organization Claims
-- =============================================================================
-- Creates a custom access token hook that injects org_id, org_role, org_name,
-- and org_slug into the JWT when a user logs in.
-- =============================================================================

-- ============================================================================
-- FUNCTION: Custom Access Token Hook
-- ============================================================================
-- This function is called by Supabase Auth on every token refresh.
-- It looks up the user's organization membership and injects claims into the JWT.

CREATE OR REPLACE FUNCTION public.custom_access_token_hook(event JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    claims JSONB;
    user_id UUID;
    org_record RECORD;
BEGIN
    -- Extract the user ID from the event
    user_id := (event->>'user_id')::UUID;

    -- Get current claims
    claims := event->'claims';

    -- Look up the user's organization membership
    SELECT
        om.org_id,
        om.role,
        o.name AS org_name,
        o.slug AS org_slug
    INTO org_record
    FROM core.organization_members om
    JOIN core.organizations o ON o.id = om.org_id
    WHERE om.user_id = user_id
      AND om.accepted_at IS NOT NULL
      AND o.is_active = true
    ORDER BY om.created_at ASC  -- First org they joined
    LIMIT 1;

    -- If user has org membership, inject claims
    IF org_record IS NOT NULL THEN
        claims := jsonb_set(claims, '{app_metadata}',
            COALESCE(claims->'app_metadata', '{}'::jsonb) ||
            jsonb_build_object(
                'org_id', org_record.org_id,
                'org_role', org_record.role,
                'org_name', org_record.org_name,
                'org_slug', org_record.org_slug
            )
        );
    END IF;

    -- Return the modified event with updated claims
    RETURN jsonb_set(event, '{claims}', claims);
END;
$$;

-- Grant execute to supabase_auth_admin (required for auth hooks)
GRANT EXECUTE ON FUNCTION public.custom_access_token_hook TO supabase_auth_admin;

-- Revoke from public for security
REVOKE EXECUTE ON FUNCTION public.custom_access_token_hook FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.custom_access_token_hook FROM anon;
REVOKE EXECUTE ON FUNCTION public.custom_access_token_hook FROM authenticated;

COMMENT ON FUNCTION public.custom_access_token_hook IS
'Auth hook that injects organization claims (org_id, org_role, org_name, org_slug) into JWT on login.';

-- ============================================================================
-- NOTE: After applying this migration, you must enable the hook in Supabase Dashboard:
-- 1. Go to Authentication > Hooks
-- 2. Enable "Customize Access Token (JWT) hook"
-- 3. Select schema: public, function: custom_access_token_hook
-- ============================================================================
