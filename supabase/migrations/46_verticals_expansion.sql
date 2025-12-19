-- Migration: 46_verticals_expansion.sql
-- Purpose: Add missing verticals and normalize campaign vertical values to use IDs

-- =============================================================================
-- 1. Add missing verticals
-- =============================================================================

INSERT INTO core.verticals (id, name, description, icon, color, display_order)
VALUES
    ('final_expense', 'Final Expense', 'Final expense life insurance', '💀', 'purple', 3),
    ('mva', 'MVA / Personal Injury', 'Motor vehicle accident and personal injury leads', '🚗', 'red', 4)
ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    description = EXCLUDED.description,
    icon = EXCLUDED.icon,
    color = EXCLUDED.color;

-- =============================================================================
-- 2. Normalize existing campaign vertical values to use IDs
-- =============================================================================

-- Fix campaigns that have display names instead of IDs
UPDATE core.campaigns SET vertical = 'aca' WHERE LOWER(vertical) IN ('aca', 'aca / health');
UPDATE core.campaigns SET vertical = 'medicare' WHERE LOWER(vertical) = 'medicare';
UPDATE core.campaigns SET vertical = 'auto_insurance' WHERE LOWER(vertical) IN ('auto', 'auto insurance');
UPDATE core.campaigns SET vertical = 'final_expense' WHERE LOWER(vertical) = 'final expense';
UPDATE core.campaigns SET vertical = 'solar' WHERE LOWER(vertical) = 'solar';
UPDATE core.campaigns SET vertical = 'debt_relief' WHERE LOWER(vertical) IN ('debt', 'debt relief');
UPDATE core.campaigns SET vertical = 'home_services' WHERE LOWER(vertical) IN ('home services', 'home_services', 'hvac', 'roofing');
UPDATE core.campaigns SET vertical = 'general' WHERE vertical IS NULL OR vertical = '' OR vertical = 'General';

-- Detect MVA campaigns by name and set their vertical
UPDATE core.campaigns SET vertical = 'mva' WHERE LOWER(name) LIKE '%mva%' OR LOWER(name) LIKE '%motor vehicle%' OR LOWER(name) LIKE '%accident%';

-- =============================================================================
-- 3. Update the auto-tag trigger to use correct vertical IDs
-- =============================================================================

CREATE OR REPLACE FUNCTION core.infer_campaign_vertical()
RETURNS TRIGGER AS $$
DECLARE
    v_vertical TEXT := 'general';
    v_name_lower TEXT;
BEGIN
    v_name_lower := LOWER(NEW.name);

    -- Order matters: more specific patterns first
    IF v_name_lower LIKE '%mva%' OR v_name_lower LIKE '%motor vehicle%' OR v_name_lower LIKE '%accident%' THEN
        v_vertical := 'mva';
    ELSIF v_name_lower LIKE '%aca%' OR v_name_lower LIKE '%affordable care%' OR v_name_lower LIKE '%obamacare%' THEN
        v_vertical := 'aca';
    ELSIF v_name_lower LIKE '%medicare%' THEN
        v_vertical := 'medicare';
    ELSIF v_name_lower LIKE '%final expense%' OR v_name_lower LIKE '%fe %' OR v_name_lower LIKE 'fe-%' OR v_name_lower LIKE '% fe' THEN
        v_vertical := 'final_expense';
    ELSIF v_name_lower LIKE '%auto%' OR v_name_lower LIKE '%car insurance%' OR v_name_lower LIKE '%vehicle insurance%' THEN
        v_vertical := 'auto_insurance';
    ELSIF v_name_lower LIKE '%solar%' THEN
        v_vertical := 'solar';
    ELSIF v_name_lower LIKE '%debt%' THEN
        v_vertical := 'debt_relief';
    ELSIF v_name_lower LIKE '%hvac%' OR v_name_lower LIKE '%roofing%' OR v_name_lower LIKE '%windows%' OR v_name_lower LIKE '%home service%' THEN
        v_vertical := 'home_services';
    END IF;

    -- Only set if not already manually assigned
    IF NEW.vertical IS NULL OR NEW.vertical = '' OR NEW.vertical = 'general' THEN
        NEW.vertical := v_vertical;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Recreate trigger
DROP TRIGGER IF EXISTS trg_campaigns_infer_vertical ON core.campaigns;
CREATE TRIGGER trg_campaigns_infer_vertical
    BEFORE INSERT OR UPDATE ON core.campaigns
    FOR EACH ROW
    EXECUTE FUNCTION core.infer_campaign_vertical();

-- =============================================================================
-- 4. Re-run inference on existing campaigns that need it
-- =============================================================================

-- Trigger a no-op update to re-run the inference trigger on campaigns with general vertical
UPDATE core.campaigns
SET updated_at = NOW()
WHERE vertical = 'general' OR vertical IS NULL;

COMMENT ON FUNCTION core.infer_campaign_vertical() IS 'Auto-assigns vertical based on campaign name patterns. Uses vertical IDs (snake_case).';
