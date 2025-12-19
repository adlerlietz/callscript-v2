import { NextRequest, NextResponse } from "next/server";
import { createCoreClient } from "@/lib/supabase/server";
import { getAuthContext, isAdmin } from "@/lib/supabase/auth";

/**
 * QA Rule type definition
 */
interface QARule {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  scope: "global" | "vertical" | "custom";
  vertical: string | null;
  enabled: boolean;
  severity: "critical" | "warning";
  prompt_fragment: string;
  rule_type: string | null;
  rule_config: Record<string, unknown> | null;
  is_system: boolean;
  display_order: number;
  org_id: string | null;
}

/**
 * GET /api/settings/rules
 * Returns all QA rules grouped by scope.
 * System rules (org_id IS NULL) are visible to all.
 * Custom rules are filtered by user's organization.
 */
export async function GET() {
  // Verify user is authenticated and has org context
  const auth = await getAuthContext();
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = await createCoreClient();

  // Get all rules: system rules (org_id IS NULL) + org-specific custom rules
  const { data: rules, error } = await supabase
    .from("qa_rules")
    .select("*")
    .or(`org_id.is.null,org_id.eq.${auth.orgId}`)
    .order("display_order", { ascending: true });

  if (error) {
    // If table doesn't exist yet, return hardcoded defaults
    console.warn("QA rules table not found, using defaults:", error.message);
    return NextResponse.json({
      global: getDefaultGlobalRules(),
      vertical: getDefaultVerticalRules(),
      custom: [],
    });
  }

  // Group rules by scope
  const global = (rules || []).filter((r: QARule) => r.scope === "global");
  const vertical = (rules || []).filter((r: QARule) => r.scope === "vertical");
  const custom = (rules || []).filter((r: QARule) => r.scope === "custom");

  // Group vertical rules by vertical name
  const verticalGrouped: Record<string, QARule[]> = {};
  for (const rule of vertical) {
    const v = rule.vertical || "general";
    if (!verticalGrouped[v]) {
      verticalGrouped[v] = [];
    }
    verticalGrouped[v].push(rule);
  }

  return NextResponse.json({
    global,
    vertical: verticalGrouped,
    custom,
  });
}

/**
 * PATCH /api/settings/rules
 * Update a rule's enabled status, severity, or prompt.
 * Only owner/admin can modify rules. System rules cannot be modified.
 */
export async function PATCH(request: NextRequest) {
  // Verify user is authenticated and has org context
  const auth = await getAuthContext();
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Only admin/owner can modify rules
  if (!isAdmin(auth)) {
    return NextResponse.json({ error: "Forbidden: admin access required" }, { status: 403 });
  }

  const supabase = await createCoreClient();
  const body = await request.json();
  const { id, enabled, severity, prompt_fragment, name, description } = body;

  if (!id) {
    return NextResponse.json({ error: "Rule ID is required" }, { status: 400 });
  }

  // Verify rule belongs to user's org and is not a system rule
  const { data: rule, error: fetchError } = await supabase
    .from("qa_rules")
    .select("id, is_system, org_id")
    .eq("id", id)
    .single();

  if (fetchError || !rule) {
    return NextResponse.json({ error: "Rule not found" }, { status: 404 });
  }

  if (rule.is_system) {
    return NextResponse.json({ error: "System rules cannot be modified" }, { status: 403 });
  }

  if (rule.org_id !== auth.orgId) {
    return NextResponse.json({ error: "Rule not found" }, { status: 404 });
  }

  const updates: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };

  if (enabled !== undefined) updates.enabled = enabled;
  if (severity !== undefined) updates.severity = severity;
  if (prompt_fragment !== undefined) updates.prompt_fragment = prompt_fragment;
  if (name !== undefined) updates.name = name;
  if (description !== undefined) updates.description = description;

  const { data, error } = await supabase
    .from("qa_rules")
    .update(updates)
    .eq("id", id)
    .eq("org_id", auth.orgId)
    .select()
    .single();

  if (error) {
    console.error("Failed to update rule:", error);
    return NextResponse.json({ error: "Failed to update rule" }, { status: 500 });
  }

  return NextResponse.json({ rule: data });
}

/**
 * POST /api/settings/rules
 * Create a new custom rule.
 * Only owner/admin can create rules.
 */
export async function POST(request: NextRequest) {
  // Verify user is authenticated and has org context
  const auth = await getAuthContext();
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Only admin/owner can create rules
  if (!isAdmin(auth)) {
    return NextResponse.json({ error: "Forbidden: admin access required" }, { status: 403 });
  }

  const supabase = await createCoreClient();
  const body = await request.json();
  const { name, description, severity, prompt_fragment, rule_type, rule_config, scope, vertical } = body;

  // Debug logging
  console.log("[QA Rules POST] Received:", { name, scope, vertical, severity });

  if (!name || !prompt_fragment) {
    return NextResponse.json(
      { error: "Name and prompt are required" },
      { status: 400 }
    );
  }

  // Validate scope
  const validScope = ["global", "vertical", "custom"].includes(scope) ? scope : "custom";
  console.log("[QA Rules POST] Validated scope:", validScope, "vertical:", vertical);

  // Vertical is required if scope is "vertical"
  if (validScope === "vertical" && !vertical) {
    return NextResponse.json(
      { error: "Vertical is required for vertical-scoped rules" },
      { status: 400 }
    );
  }

  // Generate slug from name
  const slug = `custom_${name.toLowerCase().replace(/[^a-z0-9]+/g, "_")}_${Date.now()}`;

  // Display order: global=10, vertical=50, custom=100
  const displayOrder = validScope === "global" ? 10 : validScope === "vertical" ? 50 : 100;

  const { data, error } = await supabase
    .from("qa_rules")
    .insert({
      org_id: auth.orgId,
      slug,
      name,
      description: description || null,
      scope: validScope,
      vertical: validScope === "vertical" ? vertical : null,
      enabled: true,
      severity: severity || "warning",
      prompt_fragment,
      rule_type: rule_type || null,
      rule_config: rule_config || null,
      is_system: false,
      display_order: displayOrder,
    })
    .select()
    .single();

  if (error) {
    console.error("Failed to create rule:", error);
    return NextResponse.json({ error: "Failed to create rule" }, { status: 500 });
  }

  return NextResponse.json({ rule: data }, { status: 201 });
}

/**
 * DELETE /api/settings/rules?id=xxx
 * Delete a custom rule (system rules cannot be deleted).
 * Only owner/admin can delete rules.
 */
export async function DELETE(request: NextRequest) {
  // Verify user is authenticated and has org context
  const auth = await getAuthContext();
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Only admin/owner can delete rules
  if (!isAdmin(auth)) {
    return NextResponse.json({ error: "Forbidden: admin access required" }, { status: 403 });
  }

  const supabase = await createCoreClient();
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");

  if (!id) {
    return NextResponse.json({ error: "Rule ID is required" }, { status: 400 });
  }

  // Check if rule exists, belongs to user's org, and is not a system rule
  const { data: rule } = await supabase
    .from("qa_rules")
    .select("is_system, org_id")
    .eq("id", id)
    .single();

  if (!rule) {
    return NextResponse.json({ error: "Rule not found" }, { status: 404 });
  }

  if (rule.is_system) {
    return NextResponse.json(
      { error: "System rules cannot be deleted" },
      { status: 403 }
    );
  }

  if (rule.org_id !== auth.orgId) {
    return NextResponse.json({ error: "Rule not found" }, { status: 404 });
  }

  const { error } = await supabase
    .from("qa_rules")
    .delete()
    .eq("id", id)
    .eq("org_id", auth.orgId);

  if (error) {
    console.error("Failed to delete rule:", error);
    return NextResponse.json({ error: "Failed to delete rule" }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}

// Default rules when table doesn't exist
function getDefaultGlobalRules() {
  return [
    {
      id: "default-pii",
      slug: "pii_detection",
      name: "Detect PII Collection",
      description: "Flag calls where sensitive personal information is requested",
      scope: "global",
      enabled: true,
      severity: "critical",
      is_system: true,
    },
    {
      id: "default-tcpa",
      slug: "tcpa_disclosure",
      name: "TCPA Recording Disclosure",
      description: "Ensure callers are informed the call may be recorded",
      scope: "global",
      enabled: true,
      severity: "critical",
      is_system: true,
    },
    {
      id: "default-dnc",
      slug: "dnc_request",
      name: "Do Not Call Request",
      description: "Detect when callers ask to be removed from call lists",
      scope: "global",
      enabled: true,
      severity: "warning",
      is_system: true,
    },
    {
      id: "default-professionalism",
      slug: "agent_professionalism",
      name: "Agent Professionalism",
      description: "Detect unprofessional agent behavior",
      scope: "global",
      enabled: true,
      severity: "warning",
      is_system: true,
    },
    {
      id: "default-distress",
      slug: "customer_distress",
      name: "Customer Distress",
      description: "Detect signs of customer confusion or distress",
      scope: "global",
      enabled: true,
      severity: "warning",
      is_system: true,
    },
  ];
}

function getDefaultVerticalRules() {
  return {
    medicare: [
      {
        id: "default-medicare-cms",
        slug: "medicare_cms_disclaimer",
        name: "CMS Disclaimer Required",
        description: "Medicare calls must include required CMS disclaimer language",
        scope: "vertical",
        vertical: "medicare",
        enabled: true,
        severity: "critical",
        is_system: true,
      },
    ],
    solar: [
      {
        id: "default-solar-savings",
        slug: "solar_savings_claims",
        name: "No False Savings Claims",
        description: "Savings projections must be qualified as estimates",
        scope: "vertical",
        vertical: "solar",
        enabled: true,
        severity: "critical",
        is_system: true,
      },
    ],
  };
}
