-- Organization Settings Storage
-- Stores configuration like webhooks, API keys, and integration settings

-- ============================================================================
-- TABLE: core.settings
-- Key-value store for organization settings
-- ============================================================================
CREATE TABLE IF NOT EXISTS core.settings (
    key TEXT PRIMARY KEY,
    value JSONB NOT NULL,
    description TEXT,
    is_secret BOOLEAN DEFAULT false,  -- If true, value should be masked in UI
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by TEXT  -- For audit trail
);

-- ============================================================================
-- TABLE: core.api_keys
-- Secure storage for API keys (both internal and external integrations)
-- ============================================================================
CREATE TABLE IF NOT EXISTS core.api_keys (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,                    -- "Production API Key", "Ringba Integration"
    key_prefix TEXT NOT NULL,              -- "cs_live_" or "cs_test_"
    key_hash TEXT NOT NULL,                -- Hashed version of the key
    key_hint TEXT NOT NULL,                -- Last 4 characters for identification
    permissions JSONB DEFAULT '["read"]',  -- ["read", "write", "admin"]
    is_active BOOLEAN DEFAULT true,
    last_used_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by TEXT
);

-- Index for key lookup
CREATE INDEX idx_api_keys_active ON core.api_keys(is_active, key_prefix);

-- ============================================================================
-- TABLE: core.webhook_logs
-- Audit log for webhook deliveries
-- ============================================================================
CREATE TABLE IF NOT EXISTS core.webhook_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    webhook_type TEXT NOT NULL,            -- "slack", "discord", "custom"
    event_type TEXT NOT NULL,              -- "critical_flag", "queue_alert", "daily_digest"
    payload JSONB,
    response_status INTEGER,
    response_body TEXT,
    success BOOLEAN,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for recent logs
CREATE INDEX idx_webhook_logs_recent ON core.webhook_logs(created_at DESC);

-- ============================================================================
-- SEED: Default Settings
-- ============================================================================
INSERT INTO core.settings (key, value, description, is_secret) VALUES
    ('slack_webhook_url', '""', 'Slack webhook URL for notifications', true),
    ('discord_webhook_url', '""', 'Discord webhook URL for notifications', true),
    ('notifications_enabled', '{"critical_flags": true, "queue_alerts": true, "daily_digest": false}', 'Notification preferences', false),
    ('ringba_account_id', '""', 'Ringba Account ID for API access', false),
    ('ringba_api_token', '""', 'Ringba API Token (read-only)', true),
    ('openai_api_key', '""', 'OpenAI API Key for Judge Lane', true),
    ('judge_model', '"gpt-4o-mini"', 'Model used for QA analysis', false),
    ('judge_temperature', '0.3', 'Temperature for QA model', false),
    ('auto_flag_threshold', '40', 'Score below which calls are auto-flagged', false),
    ('default_vertical', '"general"', 'Default vertical for new campaigns', false)
ON CONFLICT (key) DO NOTHING;

-- ============================================================================
-- Function: Update setting
-- ============================================================================
CREATE OR REPLACE FUNCTION core.update_setting(
    p_key TEXT,
    p_value JSONB,
    p_updated_by TEXT DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
    v_result JSONB;
BEGIN
    UPDATE core.settings
    SET value = p_value,
        updated_at = now(),
        updated_by = p_updated_by
    WHERE key = p_key
    RETURNING value INTO v_result;

    RETURN v_result;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- Function: Get all settings (masks secrets)
-- ============================================================================
CREATE OR REPLACE FUNCTION core.get_settings_safe()
RETURNS TABLE (
    key TEXT,
    value JSONB,
    description TEXT,
    is_secret BOOLEAN,
    updated_at TIMESTAMPTZ
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        s.key,
        CASE
            WHEN s.is_secret AND s.value::text != '""' AND s.value::text != 'null'
            THEN to_jsonb('••••••••' || RIGHT(s.value::text, 4))
            ELSE s.value
        END as value,
        s.description,
        s.is_secret,
        s.updated_at
    FROM core.settings s
    ORDER BY s.key;
END;
$$ LANGUAGE plpgsql STABLE;

-- Grant permissions
GRANT SELECT, UPDATE ON core.settings TO authenticated;
GRANT SELECT, INSERT ON core.api_keys TO authenticated;
GRANT SELECT, INSERT ON core.webhook_logs TO authenticated;
GRANT EXECUTE ON FUNCTION core.update_setting(TEXT, JSONB, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION core.get_settings_safe() TO authenticated;
