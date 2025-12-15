-- =============================================================================
-- Migration 21: Public Views for Settings Tables
-- =============================================================================
-- Exposes core.settings, core.qa_rules, core.verticals, core.campaigns
-- to the public schema so they're accessible via the REST API
-- =============================================================================

-- =============================================================================
-- VIEW: public.settings
-- =============================================================================
CREATE OR REPLACE VIEW public.settings AS
SELECT
    key,
    value,
    description,
    is_secret,
    updated_at
FROM core.settings;

COMMENT ON VIEW public.settings IS 'Organization settings (key-value store)';

-- Grant access
GRANT SELECT ON public.settings TO anon, authenticated;
GRANT UPDATE ON public.settings TO authenticated;

-- =============================================================================
-- VIEW: public.qa_rules
-- =============================================================================
CREATE OR REPLACE VIEW public.qa_rules AS
SELECT
    id,
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

COMMENT ON VIEW public.qa_rules IS 'QA rules for the Judge Lane';

-- Grant access
GRANT SELECT ON public.qa_rules TO anon, authenticated;
GRANT UPDATE ON public.qa_rules TO authenticated;
GRANT INSERT ON public.qa_rules TO authenticated;
GRANT DELETE ON public.qa_rules TO authenticated;

-- =============================================================================
-- VIEW: public.verticals
-- =============================================================================
CREATE OR REPLACE VIEW public.verticals AS
SELECT
    id,
    name,
    description,
    icon,
    color,
    display_order
FROM core.verticals;

COMMENT ON VIEW public.verticals IS 'Available industry verticals';

-- Grant access
GRANT SELECT ON public.verticals TO anon, authenticated;

-- =============================================================================
-- VIEW: public.campaigns
-- =============================================================================
CREATE OR REPLACE VIEW public.campaigns AS
SELECT
    c.id,
    c.ringba_campaign_id,
    c.name,
    c.vertical,
    c.inference_source,
    c.is_verified,
    c.created_at,
    c.updated_at,
    COUNT(calls.id) AS call_count
FROM core.campaigns c
LEFT JOIN core.calls calls ON calls.campaign_id = c.id
GROUP BY c.id;

COMMENT ON VIEW public.campaigns IS 'Campaign metadata with call counts';

-- Grant access
GRANT SELECT ON public.campaigns TO anon, authenticated;
GRANT UPDATE ON public.campaigns TO authenticated;

-- =============================================================================
-- INSTEAD OF triggers for updatable views
-- =============================================================================

-- Settings update trigger
CREATE OR REPLACE FUNCTION public.update_settings()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE core.settings
    SET value = NEW.value,
        updated_at = now()
    WHERE key = OLD.key;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS settings_update_trigger ON public.settings;
CREATE TRIGGER settings_update_trigger
    INSTEAD OF UPDATE ON public.settings
    FOR EACH ROW
    EXECUTE FUNCTION public.update_settings();

-- QA Rules update trigger
CREATE OR REPLACE FUNCTION public.update_qa_rules()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE core.qa_rules
    SET name = COALESCE(NEW.name, OLD.name),
        description = COALESCE(NEW.description, OLD.description),
        enabled = COALESCE(NEW.enabled, OLD.enabled),
        severity = COALESCE(NEW.severity, OLD.severity),
        prompt_fragment = COALESCE(NEW.prompt_fragment, OLD.prompt_fragment),
        updated_at = now()
    WHERE id = OLD.id;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS qa_rules_update_trigger ON public.qa_rules;
CREATE TRIGGER qa_rules_update_trigger
    INSTEAD OF UPDATE ON public.qa_rules
    FOR EACH ROW
    EXECUTE FUNCTION public.update_qa_rules();

-- QA Rules insert trigger
CREATE OR REPLACE FUNCTION public.insert_qa_rules()
RETURNS TRIGGER AS $$
DECLARE
    v_id UUID;
BEGIN
    INSERT INTO core.qa_rules (
        slug, name, description, scope, vertical, enabled,
        severity, prompt_fragment, rule_type, rule_config,
        is_system, display_order
    ) VALUES (
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

-- QA Rules delete trigger
CREATE OR REPLACE FUNCTION public.delete_qa_rules()
RETURNS TRIGGER AS $$
BEGIN
    -- Only allow deleting non-system rules
    DELETE FROM core.qa_rules
    WHERE id = OLD.id AND is_system = false;
    RETURN OLD;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS qa_rules_delete_trigger ON public.qa_rules;
CREATE TRIGGER qa_rules_delete_trigger
    INSTEAD OF DELETE ON public.qa_rules
    FOR EACH ROW
    EXECUTE FUNCTION public.delete_qa_rules();

-- Campaigns update trigger
CREATE OR REPLACE FUNCTION public.update_campaigns()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE core.campaigns
    SET name = COALESCE(NEW.name, OLD.name),
        vertical = COALESCE(NEW.vertical, OLD.vertical),
        is_verified = COALESCE(NEW.is_verified, OLD.is_verified),
        updated_at = now()
    WHERE id = OLD.id;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS campaigns_update_trigger ON public.campaigns;
CREATE TRIGGER campaigns_update_trigger
    INSTEAD OF UPDATE ON public.campaigns
    FOR EACH ROW
    EXECUTE FUNCTION public.update_campaigns();
