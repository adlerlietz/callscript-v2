-- QA Rules Configuration
-- This table stores the rules that the Judge Lane uses to analyze calls.
-- Rules are hierarchical: Global → Vertical → Custom

-- ============================================================================
-- TABLE: core.qa_rules
-- ============================================================================
CREATE TABLE IF NOT EXISTS core.qa_rules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Rule identification
    slug TEXT NOT NULL UNIQUE,              -- Machine identifier: "pii_detection"
    name TEXT NOT NULL,                     -- Human name: "Detect PII Collection"
    description TEXT,                       -- Shown in UI tooltip

    -- Scope determines when this rule applies
    scope TEXT NOT NULL CHECK (scope IN ('global', 'vertical', 'custom')),
    vertical TEXT,                          -- NULL for global, "medicare"/"solar" for vertical-specific

    -- Rule configuration
    enabled BOOLEAN NOT NULL DEFAULT true,
    severity TEXT NOT NULL DEFAULT 'warning' CHECK (severity IN ('critical', 'warning')),

    -- The actual prompt fragment sent to GPT
    -- This is the "brain" of the rule
    prompt_fragment TEXT NOT NULL,

    -- For structured custom rules (type-safe alternatives to free-form)
    rule_type TEXT CHECK (rule_type IN ('toggle', 'keyword_required', 'keyword_forbidden', 'count_threshold')),
    rule_config JSONB,                      -- {"keyword": "zero down", "min_count": 2}

    -- Metadata
    is_system BOOLEAN NOT NULL DEFAULT false,  -- System rules cannot be deleted
    display_order INTEGER DEFAULT 0,           -- For UI sorting
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for efficient rule lookups by scope
CREATE INDEX idx_qa_rules_scope ON core.qa_rules(scope, vertical, enabled);
CREATE INDEX idx_qa_rules_display ON core.qa_rules(scope, display_order);

-- ============================================================================
-- TABLE: core.verticals
-- Defines available verticals with their metadata
-- ============================================================================
CREATE TABLE IF NOT EXISTS core.verticals (
    id TEXT PRIMARY KEY,                    -- "medicare", "solar", "debt_relief"
    name TEXT NOT NULL,                     -- "Medicare", "Solar", "Debt Relief"
    description TEXT,                       -- "Health insurance for seniors 65+"
    icon TEXT,                              -- Emoji or icon name: "🏥"
    color TEXT,                             -- Tailwind color: "blue", "yellow"
    display_order INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================================
-- SEED DATA: Verticals
-- ============================================================================
INSERT INTO core.verticals (id, name, description, icon, color, display_order) VALUES
    ('general', 'General', 'Default vertical for unmapped campaigns', '📞', 'zinc', 0),
    ('medicare', 'Medicare', 'Health insurance for seniors 65+', '🏥', 'blue', 1),
    ('aca', 'ACA / Health', 'Affordable Care Act health insurance', '🏥', 'sky', 2),
    ('solar', 'Solar', 'Residential solar panel installation', '🌞', 'yellow', 3),
    ('debt_relief', 'Debt Relief', 'Debt consolidation and settlement', '💳', 'red', 4),
    ('auto_insurance', 'Auto Insurance', 'Vehicle insurance policies', '🚗', 'emerald', 5),
    ('home_services', 'Home Services', 'HVAC, roofing, windows, etc.', '🏠', 'orange', 6)
ON CONFLICT (id) DO NOTHING;

-- ============================================================================
-- SEED DATA: Global Rules (Apply to ALL calls)
-- ============================================================================
INSERT INTO core.qa_rules (slug, name, description, scope, severity, prompt_fragment, rule_type, is_system, display_order) VALUES
    (
        'pii_detection',
        'Detect PII Collection',
        'Flag calls where sensitive personal information is requested inappropriately',
        'global',
        'critical',
        'Flag as a compliance issue if the agent requests Social Security Number, full credit card number, bank account number, or date of birth without proper verification context.',
        'toggle',
        true,
        1
    ),
    (
        'tcpa_disclosure',
        'TCPA Recording Disclosure',
        'Ensure callers are informed the call may be recorded',
        'global',
        'critical',
        'Flag as a compliance issue if the agent does not inform the caller that the call is being recorded or may be monitored for quality assurance.',
        'toggle',
        true,
        2
    ),
    (
        'dnc_request',
        'Do Not Call Request',
        'Detect when callers ask to be removed from call lists',
        'global',
        'warning',
        'Flag if the caller explicitly requests to be removed from the call list, says "do not call me again", "take me off your list", or similar opt-out language.',
        'toggle',
        true,
        3
    ),
    (
        'agent_professionalism',
        'Agent Professionalism',
        'Detect unprofessional agent behavior',
        'global',
        'warning',
        'Flag if the agent uses profanity, raises their voice aggressively, interrupts the customer repeatedly, or speaks in a condescending or disrespectful manner.',
        'toggle',
        true,
        4
    ),
    (
        'customer_distress',
        'Customer Distress',
        'Detect signs of customer confusion or distress',
        'global',
        'warning',
        'Flag if the customer sounds extremely upset, is crying, expresses significant confusion about what they are agreeing to, or indicates they feel pressured.',
        'toggle',
        true,
        5
    )
ON CONFLICT (slug) DO UPDATE SET
    name = EXCLUDED.name,
    description = EXCLUDED.description,
    prompt_fragment = EXCLUDED.prompt_fragment,
    updated_at = now();

-- ============================================================================
-- SEED DATA: Medicare Vertical Rules
-- ============================================================================
INSERT INTO core.qa_rules (slug, name, description, scope, vertical, severity, prompt_fragment, rule_type, is_system, display_order) VALUES
    (
        'medicare_cms_disclaimer',
        'CMS Disclaimer Required',
        'Medicare calls must include required CMS disclaimer language',
        'vertical',
        'medicare',
        'critical',
        'Flag if the agent does not mention that they are not affiliated with Medicare or the government, or fails to provide the required CMS disclaimer.',
        'toggle',
        true,
        1
    ),
    (
        'medicare_no_guarantee',
        'No Guarantee of Benefits',
        'Agents cannot guarantee specific Medicare benefits',
        'vertical',
        'medicare',
        'critical',
        'Flag if the agent guarantees specific benefits, coverage amounts, or cost savings without proper qualification that benefits vary by plan and location.',
        'toggle',
        true,
        2
    ),
    (
        'medicare_licensed_agent',
        'Licensed Agent Verification',
        'Agent should identify as licensed insurance professional',
        'vertical',
        'medicare',
        'warning',
        'Flag if the agent does not identify themselves as a licensed insurance agent or representative when discussing Medicare plans.',
        'toggle',
        true,
        3
    ),
    (
        'medicare_enrollment_pressure',
        'No Enrollment Pressure',
        'Agents should not pressure immediate enrollment decisions',
        'vertical',
        'medicare',
        'warning',
        'Flag if the agent pressures the caller to enroll immediately, uses artificial urgency ("this offer expires today"), or discourages the caller from reviewing materials.',
        'toggle',
        true,
        4
    )
ON CONFLICT (slug) DO UPDATE SET
    name = EXCLUDED.name,
    description = EXCLUDED.description,
    prompt_fragment = EXCLUDED.prompt_fragment,
    updated_at = now();

-- ============================================================================
-- SEED DATA: ACA/Health Vertical Rules
-- ============================================================================
INSERT INTO core.qa_rules (slug, name, description, scope, vertical, severity, prompt_fragment, rule_type, is_system, display_order) VALUES
    (
        'aca_subsidy_accuracy',
        'Subsidy Accuracy',
        'Subsidy amounts must be qualified as estimates',
        'vertical',
        'aca',
        'critical',
        'Flag if the agent quotes specific subsidy amounts as guaranteed rather than estimates that depend on income verification and household size.',
        'toggle',
        true,
        1
    ),
    (
        'aca_coverage_date',
        'Coverage Date Clarity',
        'Coverage start dates must be clearly communicated',
        'vertical',
        'aca',
        'warning',
        'Flag if the agent does not clearly explain when coverage would begin or implies immediate coverage when enrollment has processing time.',
        'toggle',
        true,
        2
    )
ON CONFLICT (slug) DO UPDATE SET
    name = EXCLUDED.name,
    description = EXCLUDED.description,
    prompt_fragment = EXCLUDED.prompt_fragment,
    updated_at = now();

-- ============================================================================
-- SEED DATA: Solar Vertical Rules
-- ============================================================================
INSERT INTO core.qa_rules (slug, name, description, scope, vertical, severity, prompt_fragment, rule_type, is_system, display_order) VALUES
    (
        'solar_savings_claims',
        'No False Savings Claims',
        'Savings projections must be qualified as estimates',
        'vertical',
        'solar',
        'critical',
        'Flag if the agent guarantees specific dollar savings, promises the system will "pay for itself", or makes unqualified claims about eliminating electric bills entirely.',
        'toggle',
        true,
        1
    ),
    (
        'solar_contract_terms',
        'Contract Terms Disclosure',
        'Financing terms must be clearly disclosed',
        'vertical',
        'solar',
        'critical',
        'Flag if the agent does not disclose financing terms, interest rates, lease vs purchase distinction, or the total cost of the system over the contract period.',
        'toggle',
        true,
        2
    ),
    (
        'solar_property_requirements',
        'Property Requirements',
        'Agent should verify basic property eligibility',
        'vertical',
        'solar',
        'warning',
        'Flag if the agent does not ask about property ownership, roof condition, or other basic eligibility requirements before scheduling an appointment.',
        'toggle',
        true,
        3
    )
ON CONFLICT (slug) DO UPDATE SET
    name = EXCLUDED.name,
    description = EXCLUDED.description,
    prompt_fragment = EXCLUDED.prompt_fragment,
    updated_at = now();

-- ============================================================================
-- SEED DATA: Debt Relief Vertical Rules
-- ============================================================================
INSERT INTO core.qa_rules (slug, name, description, scope, vertical, severity, prompt_fragment, rule_type, is_system, display_order) VALUES
    (
        'debt_no_guarantee',
        'No Settlement Guarantees',
        'Cannot guarantee specific settlement percentages',
        'vertical',
        'debt_relief',
        'critical',
        'Flag if the agent guarantees a specific debt settlement percentage or promises to eliminate a specific dollar amount of debt.',
        'toggle',
        true,
        1
    ),
    (
        'debt_fee_disclosure',
        'Fee Disclosure',
        'Service fees must be disclosed upfront',
        'vertical',
        'debt_relief',
        'critical',
        'Flag if the agent does not disclose service fees, when fees are charged, or how fees are calculated.',
        'toggle',
        true,
        2
    ),
    (
        'debt_credit_impact',
        'Credit Impact Warning',
        'Must disclose potential negative credit impact',
        'vertical',
        'debt_relief',
        'warning',
        'Flag if the agent does not mention that debt settlement may negatively impact credit scores or that creditors may continue collection efforts.',
        'toggle',
        true,
        3
    )
ON CONFLICT (slug) DO UPDATE SET
    name = EXCLUDED.name,
    description = EXCLUDED.description,
    prompt_fragment = EXCLUDED.prompt_fragment,
    updated_at = now();

-- ============================================================================
-- Update campaigns table to use vertical foreign key
-- ============================================================================
-- First, normalize existing vertical values
UPDATE core.campaigns
SET vertical = LOWER(REPLACE(vertical, ' ', '_'))
WHERE vertical IS NOT NULL;

-- Update common variations
UPDATE core.campaigns SET vertical = 'medicare' WHERE LOWER(vertical) IN ('healthcare', 'health', 'medical');
UPDATE core.campaigns SET vertical = 'aca' WHERE LOWER(vertical) IN ('aca', 'obamacare', 'affordable_care');
UPDATE core.campaigns SET vertical = 'solar' WHERE LOWER(vertical) LIKE '%solar%';
UPDATE core.campaigns SET vertical = 'debt_relief' WHERE LOWER(vertical) LIKE '%debt%';
UPDATE core.campaigns SET vertical = 'auto_insurance' WHERE LOWER(vertical) LIKE '%auto%' OR LOWER(vertical) LIKE '%insurance%';
UPDATE core.campaigns SET vertical = 'general' WHERE vertical IS NULL OR vertical = '';

-- ============================================================================
-- Trigger: Auto-update updated_at
-- ============================================================================
CREATE OR REPLACE FUNCTION core.update_qa_rules_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS qa_rules_updated_at ON core.qa_rules;
CREATE TRIGGER qa_rules_updated_at
    BEFORE UPDATE ON core.qa_rules
    FOR EACH ROW
    EXECUTE FUNCTION core.update_qa_rules_timestamp();

-- ============================================================================
-- View: Compiled rules for a given vertical
-- This is what the Judge Lane will query
-- ============================================================================
CREATE OR REPLACE VIEW core.compiled_rules AS
SELECT
    r.id,
    r.slug,
    r.name,
    r.scope,
    r.vertical,
    r.severity,
    r.prompt_fragment,
    r.enabled
FROM core.qa_rules r
WHERE r.enabled = true
ORDER BY
    CASE r.scope
        WHEN 'global' THEN 1
        WHEN 'vertical' THEN 2
        WHEN 'custom' THEN 3
    END,
    r.display_order;

-- ============================================================================
-- Function: Get all applicable rules for a campaign
-- ============================================================================
CREATE OR REPLACE FUNCTION core.get_rules_for_vertical(p_vertical TEXT)
RETURNS TABLE (
    slug TEXT,
    name TEXT,
    severity TEXT,
    prompt_fragment TEXT
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        r.slug,
        r.name,
        r.severity,
        r.prompt_fragment
    FROM core.qa_rules r
    WHERE r.enabled = true
      AND (
          r.scope = 'global'
          OR (r.scope = 'vertical' AND r.vertical = p_vertical)
          OR r.scope = 'custom'
      )
    ORDER BY
        CASE r.scope
            WHEN 'global' THEN 1
            WHEN 'vertical' THEN 2
            WHEN 'custom' THEN 3
        END,
        r.display_order;
END;
$$ LANGUAGE plpgsql STABLE;

-- Grant permissions
GRANT SELECT ON core.qa_rules TO authenticated;
GRANT SELECT ON core.verticals TO authenticated;
GRANT SELECT ON core.compiled_rules TO authenticated;
GRANT EXECUTE ON FUNCTION core.get_rules_for_vertical(TEXT) TO authenticated;
