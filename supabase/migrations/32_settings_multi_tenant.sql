-- =============================================================================
-- Migration 32: Make Settings Table Multi-Tenant
-- =============================================================================
-- Adds org_id to settings table to support per-organization configuration.
-- =============================================================================

-- Step 1: Add org_id column to settings table
ALTER TABLE core.settings ADD COLUMN IF NOT EXISTS org_id UUID;

-- Step 2: Update existing rows to use default org
UPDATE core.settings
SET org_id = '00000000-0000-0000-0000-000000000001'
WHERE org_id IS NULL;

-- Step 3: Drop old primary key and create new composite key
ALTER TABLE core.settings DROP CONSTRAINT IF EXISTS settings_pkey;
ALTER TABLE core.settings ADD PRIMARY KEY (org_id, key);

-- Step 4: Make org_id NOT NULL after backfill
ALTER TABLE core.settings ALTER COLUMN org_id SET NOT NULL;

-- Step 5: Add foreign key to organizations
ALTER TABLE core.settings
ADD CONSTRAINT settings_org_fk
FOREIGN KEY (org_id) REFERENCES core.organizations(id) ON DELETE CASCADE;

-- Step 6: Enable RLS
ALTER TABLE core.settings ENABLE ROW LEVEL SECURITY;

-- Step 7: Create RLS policies
DROP POLICY IF EXISTS "settings_org_isolation" ON core.settings;
CREATE POLICY "settings_org_isolation" ON core.settings
    FOR ALL
    TO authenticated
    USING (
        org_id IN (
            SELECT om.org_id FROM core.organization_members om
            WHERE om.user_id = auth.uid()
        )
    );

-- Step 8: Grant INSERT permission (was only SELECT/UPDATE before)
GRANT INSERT ON core.settings TO authenticated;

-- Step 9: Update the public view to include org_id
DROP VIEW IF EXISTS public.settings CASCADE;
CREATE OR REPLACE VIEW public.settings
WITH (security_invoker = true)
AS SELECT
    org_id,
    key,
    value,
    description,
    is_secret,
    updated_at
FROM core.settings;

GRANT SELECT, INSERT, UPDATE ON public.settings TO authenticated;

-- Step 10: Recreate update trigger for the view
CREATE OR REPLACE FUNCTION public.update_settings()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE core.settings
    SET value = NEW.value,
        updated_at = now()
    WHERE org_id = OLD.org_id AND key = OLD.key;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS settings_update_trigger ON public.settings;
CREATE TRIGGER settings_update_trigger
    INSTEAD OF UPDATE ON public.settings
    FOR EACH ROW
    EXECUTE FUNCTION public.update_settings();

-- Step 11: Create insert trigger for the view
CREATE OR REPLACE FUNCTION public.insert_settings()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO core.settings (org_id, key, value, description, is_secret, updated_at)
    VALUES (NEW.org_id, NEW.key, NEW.value, NEW.description, NEW.is_secret, COALESCE(NEW.updated_at, now()))
    ON CONFLICT (org_id, key) DO UPDATE SET
        value = EXCLUDED.value,
        description = EXCLUDED.description,
        is_secret = EXCLUDED.is_secret,
        updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS settings_insert_trigger ON public.settings;
CREATE TRIGGER settings_insert_trigger
    INSTEAD OF INSERT ON public.settings
    FOR EACH ROW
    EXECUTE FUNCTION public.insert_settings();

COMMENT ON TABLE core.settings IS 'Multi-tenant organization settings (key-value store)';
