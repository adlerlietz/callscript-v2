-- =============================================================================
-- Migration 23: RLS Policies for Multi-Tenant Tables
-- =============================================================================
-- Adds Row Level Security to: qa_rules, api_keys, settings, webhook_logs
-- Uses existing helper functions from migration 16: current_org_id(), user_has_role()
-- =============================================================================

-- ============================================================================
-- QA RULES RLS
-- System rules (org_id IS NULL) visible to everyone
-- Custom rules (org_id IS NOT NULL) only visible to own org
-- ============================================================================

ALTER TABLE core.qa_rules ENABLE ROW LEVEL SECURITY;

-- SELECT: See system rules (NULL org_id) OR own org's custom rules
CREATE POLICY "qa_rules_select_policy"
ON core.qa_rules
FOR SELECT
TO authenticated
USING (
    org_id IS NULL  -- System/global rules visible to all
    OR org_id = core.current_org_id()  -- Own org's custom rules
);

-- INSERT: Only owner/admin can create custom rules for their org
CREATE POLICY "qa_rules_insert_policy"
ON core.qa_rules
FOR INSERT
TO authenticated
WITH CHECK (
    org_id = core.current_org_id()
    AND core.user_has_role(ARRAY['owner', 'admin'])
);

-- UPDATE: Can only update own org's non-system rules
CREATE POLICY "qa_rules_update_policy"
ON core.qa_rules
FOR UPDATE
TO authenticated
USING (
    org_id = core.current_org_id()
    AND NOT is_system
    AND core.user_has_role(ARRAY['owner', 'admin'])
)
WITH CHECK (
    org_id = core.current_org_id()
    AND NOT is_system
    AND core.user_has_role(ARRAY['owner', 'admin'])
);

-- DELETE: Can only delete own org's non-system rules
CREATE POLICY "qa_rules_delete_policy"
ON core.qa_rules
FOR DELETE
TO authenticated
USING (
    org_id = core.current_org_id()
    AND NOT is_system
    AND core.user_has_role(ARRAY['owner', 'admin'])
);

-- ============================================================================
-- API KEYS RLS
-- Only owner/admin can view/manage API keys
-- ============================================================================

ALTER TABLE core.api_keys ENABLE ROW LEVEL SECURITY;

-- SELECT: Owner/admin can see their org's keys
CREATE POLICY "api_keys_select_policy"
ON core.api_keys
FOR SELECT
TO authenticated
USING (
    org_id = core.current_org_id()
    AND core.user_has_role(ARRAY['owner', 'admin'])
);

-- INSERT: Owner/admin can create keys for their org
CREATE POLICY "api_keys_insert_policy"
ON core.api_keys
FOR INSERT
TO authenticated
WITH CHECK (
    org_id = core.current_org_id()
    AND core.user_has_role(ARRAY['owner', 'admin'])
);

-- UPDATE: Owner/admin can update their org's keys
CREATE POLICY "api_keys_update_policy"
ON core.api_keys
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

-- DELETE: Owner/admin can delete their org's keys
CREATE POLICY "api_keys_delete_policy"
ON core.api_keys
FOR DELETE
TO authenticated
USING (
    org_id = core.current_org_id()
    AND core.user_has_role(ARRAY['owner', 'admin'])
);

-- ============================================================================
-- SETTINGS RLS
-- Owner/admin can manage org settings
-- ============================================================================

ALTER TABLE core.settings ENABLE ROW LEVEL SECURITY;

-- SELECT: Owner/admin can see their org's settings
CREATE POLICY "settings_select_policy"
ON core.settings
FOR SELECT
TO authenticated
USING (
    org_id = core.current_org_id()
    AND core.user_has_role(ARRAY['owner', 'admin'])
);

-- INSERT: Owner/admin can create settings for their org
CREATE POLICY "settings_insert_policy"
ON core.settings
FOR INSERT
TO authenticated
WITH CHECK (
    org_id = core.current_org_id()
    AND core.user_has_role(ARRAY['owner', 'admin'])
);

-- UPDATE: Owner/admin can update their org's settings
CREATE POLICY "settings_update_policy"
ON core.settings
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

-- DELETE: Owner/admin can delete their org's settings
CREATE POLICY "settings_delete_policy"
ON core.settings
FOR DELETE
TO authenticated
USING (
    org_id = core.current_org_id()
    AND core.user_has_role(ARRAY['owner', 'admin'])
);

-- ============================================================================
-- WEBHOOK LOGS RLS
-- Owner/admin can view webhook logs for their org
-- ============================================================================

ALTER TABLE core.webhook_logs ENABLE ROW LEVEL SECURITY;

-- SELECT: Owner/admin can see their org's webhook logs
CREATE POLICY "webhook_logs_select_policy"
ON core.webhook_logs
FOR SELECT
TO authenticated
USING (
    org_id = core.current_org_id()
    AND core.user_has_role(ARRAY['owner', 'admin'])
);

-- INSERT: System can insert (via service_role), no user insert needed
-- (Webhook logs are created by the system, not users)

-- ============================================================================
-- Update public views to include org_id filtering
-- ============================================================================

-- Recreate settings view with org_id
DROP VIEW IF EXISTS public.settings;
CREATE VIEW public.settings AS
SELECT
    id,
    org_id,
    key,
    value,
    description,
    is_secret,
    updated_at
FROM core.settings;

COMMENT ON VIEW public.settings IS 'Organization settings (per-org key-value store)';

-- Grant access (RLS on underlying table will filter)
GRANT SELECT ON public.settings TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.settings TO authenticated;

-- Recreate qa_rules view with org_id
DROP VIEW IF EXISTS public.qa_rules;
CREATE VIEW public.qa_rules AS
SELECT
    id,
    org_id,
    slug,
    name,
    description,
    scope,
    vertical,
    enabled,
    severity,
    prompt_fragment,
    rule_type,
    rule_config,
    is_system,
    display_order,
    created_at,
    updated_at
FROM core.qa_rules;

COMMENT ON VIEW public.qa_rules IS 'QA rules for the Judge Lane (per-org custom rules)';

GRANT SELECT ON public.qa_rules TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.qa_rules TO authenticated;

-- ============================================================================
-- INSTEAD OF triggers need to include org_id
-- ============================================================================

-- Settings update trigger (include org_id)
CREATE OR REPLACE FUNCTION public.update_settings()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE core.settings
    SET value = NEW.value,
        updated_at = now()
    WHERE id = OLD.id AND org_id = OLD.org_id;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Settings insert trigger (include org_id from context)
CREATE OR REPLACE FUNCTION public.insert_settings()
RETURNS TRIGGER AS $$
DECLARE
    v_org_id UUID;
BEGIN
    v_org_id := core.current_org_id();
    IF v_org_id IS NULL THEN
        RAISE EXCEPTION 'No organization context';
    END IF;

    INSERT INTO core.settings (org_id, key, value, description, is_secret)
    VALUES (v_org_id, NEW.key, NEW.value, NEW.description, COALESCE(NEW.is_secret, false))
    ON CONFLICT (org_id, key) DO UPDATE SET
        value = EXCLUDED.value,
        updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS settings_insert_trigger ON public.settings;
CREATE TRIGGER settings_insert_trigger
    INSTEAD OF INSERT ON public.settings
    FOR EACH ROW
    EXECUTE FUNCTION public.insert_settings();

-- QA Rules insert trigger (include org_id)
CREATE OR REPLACE FUNCTION public.insert_qa_rules()
RETURNS TRIGGER AS $$
DECLARE
    v_org_id UUID;
    v_id UUID;
BEGIN
    v_org_id := core.current_org_id();
    IF v_org_id IS NULL AND NEW.scope = 'custom' THEN
        RAISE EXCEPTION 'No organization context for custom rule';
    END IF;

    INSERT INTO core.qa_rules (
        org_id, slug, name, description, scope, vertical, enabled,
        severity, prompt_fragment, rule_type, rule_config,
        is_system, display_order
    ) VALUES (
        CASE WHEN NEW.scope = 'custom' THEN v_org_id ELSE NULL END,
        NEW.slug, NEW.name, NEW.description, COALESCE(NEW.scope, 'custom'),
        NEW.vertical, COALESCE(NEW.enabled, true),
        COALESCE(NEW.severity, 'warning'), NEW.prompt_fragment,
        NEW.rule_type, NEW.rule_config,
        COALESCE(NEW.is_system, false), COALESCE(NEW.display_order, 100)
    )
    RETURNING id INTO v_id;

    NEW.id := v_id;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS qa_rules_insert_trigger ON public.qa_rules;
CREATE TRIGGER qa_rules_insert_trigger
    INSTEAD OF INSERT ON public.qa_rules
    FOR EACH ROW
    EXECUTE FUNCTION public.insert_qa_rules();

-- ============================================================================
-- Done. Run migration 24 for data backfill.
-- ============================================================================
