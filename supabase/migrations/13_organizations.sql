-- =============================================================================
-- Migration 13: Multi-Tenant Organizations Schema
-- =============================================================================
-- Phase A: ADDITIVE ONLY - Creates new tables, does not modify existing
-- Safe to run while system is live
-- =============================================================================

-- 1. Organizations (Tenant Container)
-- =============================================================================
CREATE TABLE IF NOT EXISTS core.organizations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Identity
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,  -- URL-safe: "acme-insurance"

    -- Plan/Billing (future use)
    plan TEXT DEFAULT 'trial' CHECK (plan IN ('trial', 'starter', 'pro', 'enterprise')),
    trial_ends_at TIMESTAMPTZ DEFAULT (now() + INTERVAL '14 days'),

    -- Status
    is_active BOOLEAN DEFAULT true,  -- Kill switch for org

    -- Timestamps
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Trigger for updated_at
CREATE TRIGGER trg_organizations_updated_at
    BEFORE UPDATE ON core.organizations
    FOR EACH ROW
    EXECUTE FUNCTION core.set_updated_at();

COMMENT ON TABLE core.organizations IS 'Multi-tenant organization container. Each org has isolated data.';


-- 2. Organization Members (User <-> Org Mapping)
-- =============================================================================
CREATE TABLE IF NOT EXISTS core.organization_members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Relationships
    org_id UUID NOT NULL REFERENCES core.organizations(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

    -- Permissions
    role TEXT NOT NULL DEFAULT 'reviewer' CHECK (role IN ('owner', 'admin', 'reviewer')),

    -- Invitation tracking
    invited_by UUID REFERENCES auth.users(id),
    invited_at TIMESTAMPTZ DEFAULT now(),
    accepted_at TIMESTAMPTZ,  -- NULL = pending invite

    -- Timestamps
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- Constraints
    CONSTRAINT unique_org_member UNIQUE(org_id, user_id)
);

COMMENT ON TABLE core.organization_members IS 'Links users to organizations with role-based access.';
COMMENT ON COLUMN core.organization_members.role IS 'owner=full access, admin=manage members, reviewer=view/flag calls';


-- 3. Organization Credentials (API Keys Reference)
-- =============================================================================
-- NOTE: Actual tokens stored in Supabase Vault (encrypted)
-- This table only stores the reference pointer

CREATE TABLE IF NOT EXISTS core.organization_credentials (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Relationships
    org_id UUID NOT NULL REFERENCES core.organizations(id) ON DELETE CASCADE,

    -- Provider configuration
    provider TEXT NOT NULL DEFAULT 'ringba',  -- Future: callrail, invoca, etc.
    account_id TEXT NOT NULL,                  -- Provider's account identifier

    -- Vault reference (NOT the actual secret)
    vault_secret_name TEXT NOT NULL,           -- Points to vault.secrets.name

    -- Health tracking
    is_valid BOOLEAN DEFAULT true,             -- Set false if API calls fail
    last_sync_at TIMESTAMPTZ,                  -- Last successful sync
    last_error TEXT,                           -- Last error message if failed

    -- Timestamps
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- Constraints: One credential per provider per org
    CONSTRAINT unique_org_provider UNIQUE(org_id, provider)
);

-- Trigger for updated_at
CREATE TRIGGER trg_org_credentials_updated_at
    BEFORE UPDATE ON core.organization_credentials
    FOR EACH ROW
    EXECUTE FUNCTION core.set_updated_at();

COMMENT ON TABLE core.organization_credentials IS 'Stores references to encrypted API credentials in Vault.';
COMMENT ON COLUMN core.organization_credentials.vault_secret_name IS 'Reference to vault.secrets - actual token is encrypted there.';


-- 4. Basic Indexes for New Tables
-- =============================================================================
CREATE INDEX IF NOT EXISTS idx_org_members_user_id
    ON core.organization_members(user_id);

CREATE INDEX IF NOT EXISTS idx_org_members_org_id
    ON core.organization_members(org_id);

CREATE INDEX IF NOT EXISTS idx_org_credentials_org_id
    ON core.organization_credentials(org_id);

CREATE INDEX IF NOT EXISTS idx_org_credentials_provider
    ON core.organization_credentials(org_id, provider);


-- =============================================================================
-- VERIFICATION QUERY (run after migration)
-- =============================================================================
-- SELECT
--     'organizations' as table_name, COUNT(*) as row_count FROM core.organizations
-- UNION ALL SELECT
--     'organization_members', COUNT(*) FROM core.organization_members
-- UNION ALL SELECT
--     'organization_credentials', COUNT(*) FROM core.organization_credentials;
--
-- Expected: All counts = 0 (tables created but empty)
-- =============================================================================
