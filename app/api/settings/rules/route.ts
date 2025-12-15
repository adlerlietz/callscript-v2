import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

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
}

/**
 * GET /api/settings/rules
 * Returns all QA rules grouped by scope
 */
export async function GET() {
  const { data: rules, error } = await supabase
    .from("qa_rules")
    .select("*")
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
 * Update a rule's enabled status, severity, or prompt
 */
export async function PATCH(request: NextRequest) {
  const body = await request.json();
  const { id, enabled, severity, prompt_fragment, name, description } = body;

  if (!id) {
    return NextResponse.json({ error: "Rule ID is required" }, { status: 400 });
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
 * Create a new custom rule
 */
export async function POST(request: NextRequest) {
  const body = await request.json();
  const { name, description, severity, prompt_fragment, rule_type, rule_config } = body;

  if (!name || !prompt_fragment) {
    return NextResponse.json(
      { error: "Name and prompt are required" },
      { status: 400 }
    );
  }

  // Generate slug from name
  const slug = `custom_${name.toLowerCase().replace(/[^a-z0-9]+/g, "_")}_${Date.now()}`;

  const { data, error } = await supabase
    .from("qa_rules")
    .insert({
      slug,
      name,
      description: description || null,
      scope: "custom",
      vertical: null,
      enabled: true,
      severity: severity || "warning",
      prompt_fragment,
      rule_type: rule_type || null,
      rule_config: rule_config || null,
      is_system: false,
      display_order: 100, // Custom rules appear last
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
 * Delete a custom rule (system rules cannot be deleted)
 */
export async function DELETE(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");

  if (!id) {
    return NextResponse.json({ error: "Rule ID is required" }, { status: 400 });
  }

  // First check if it's a system rule
  const { data: rule } = await supabase
    .from("qa_rules")
    .select("is_system")
    .eq("id", id)
    .single();

  if (rule?.is_system) {
    return NextResponse.json(
      { error: "System rules cannot be deleted" },
      { status: 403 }
    );
  }

  const { error } = await supabase.from("qa_rules").delete().eq("id", id);

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
