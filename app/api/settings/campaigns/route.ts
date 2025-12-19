import { NextRequest, NextResponse } from "next/server";
import { createClient, createCoreClient } from "@/lib/supabase/server";
import { getAuthContext, isAdmin } from "@/lib/supabase/auth";

/**
 * GET /api/settings/campaigns
 * Returns all campaigns with call counts, grouped by mapping status.
 * Filtered by user's organization.
 */
export async function GET() {
  // Verify user is authenticated and has org context
  const auth = await getAuthContext();
  if (!auth) {
    console.error("[campaigns] No auth context - user not authenticated or no org");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  console.log("[campaigns] Auth context:", {
    userId: auth.userId.slice(0, 8),
    orgId: auth.orgId,
    role: auth.role,
  });

  const supabase = await createCoreClient();

  // Debug: First check what campaigns exist (without org filter)
  const { data: allCampaigns, error: debugError } = await supabase
    .from("campaigns")
    .select("id, org_id, name")
    .limit(5);

  console.log("[campaigns] Debug - All campaigns (first 5):", allCampaigns, "Error:", debugError);

  // Get all campaigns for this org
  const { data: campaigns, error } = await supabase
    .from("campaigns")
    .select(`
      id,
      ringba_campaign_id,
      name,
      vertical,
      is_verified,
      inference_source,
      created_at,
      updated_at
    `)
    .eq("org_id", auth.orgId)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("[campaigns] Query error:", error);
    return NextResponse.json({ error: "Failed to fetch campaigns" }, { status: 500 });
  }

  console.log("[campaigns] Filtered campaigns for org", auth.orgId, ":", campaigns?.length || 0);

  console.log("[campaigns] Found", campaigns?.length || 0, "campaigns for org", auth.orgId);

  // Get call counts per campaign (filtered by org)
  // Use public schema client since calls_overview is in public schema
  const publicClient = await createClient();
  const { data: callCounts, error: countError } = await publicClient
    .from("calls_overview")
    .select("campaign_id")
    .eq("org_id", auth.orgId)
    .not("campaign_id", "is", null);

  // Count calls per campaign
  const countMap: Record<string, number> = {};
  if (callCounts) {
    for (const row of callCounts) {
      if (row.campaign_id) {
        countMap[row.campaign_id] = (countMap[row.campaign_id] || 0) + 1;
      }
    }
  }

  // Enrich campaigns with call counts and categorize
  const enriched = (campaigns || []).map((c) => ({
    ...c,
    call_count: countMap[c.id] || 0,
    is_mapped: c.is_verified || (c.name && c.name !== c.ringba_campaign_id && c.vertical && c.vertical !== "general"),
  }));

  // Separate unmapped from mapped
  const unmapped = enriched.filter((c) => !c.is_mapped);
  const mapped = enriched.filter((c) => c.is_mapped);

  return NextResponse.json({
    unmapped,
    mapped,
    total: enriched.length,
    unmapped_count: unmapped.length,
    // DEBUG: Remove after troubleshooting
    _debug: {
      userOrgId: auth.orgId,
      allCampaignsVisible: allCampaigns?.length || 0,
      allCampaignsData: allCampaigns,
      debugError: debugError?.message || null,
    },
  });
}

/**
 * PATCH /api/settings/campaigns
 * Update a campaign's name and/or vertical.
 * Only owner/admin can modify campaigns.
 */
export async function PATCH(request: NextRequest) {
  // Verify user is authenticated and has org context
  const auth = await getAuthContext();
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Only admin/owner can modify campaigns
  if (!isAdmin(auth)) {
    return NextResponse.json({ error: "Forbidden: admin access required" }, { status: 403 });
  }

  const supabase = await createCoreClient();
  const body = await request.json();
  const { id, name, vertical } = body;

  if (!id) {
    return NextResponse.json({ error: "Campaign ID is required" }, { status: 400 });
  }

  // Verify campaign belongs to user's org
  const { data: campaign, error: fetchError } = await supabase
    .from("campaigns")
    .select("id")
    .eq("id", id)
    .eq("org_id", auth.orgId)
    .single();

  if (fetchError || !campaign) {
    return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
  }

  const updates: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };

  if (name !== undefined) {
    updates.name = name;
  }

  if (vertical !== undefined) {
    updates.vertical = vertical;
  }

  // Mark as verified if user explicitly sets name or vertical
  if (name || vertical) {
    updates.is_verified = true;
    updates.inference_source = "manual";
  }

  const { data, error } = await supabase
    .from("campaigns")
    .update(updates)
    .eq("id", id)
    .eq("org_id", auth.orgId)
    .select()
    .single();

  if (error) {
    console.error("Failed to update campaign:", error);
    return NextResponse.json({ error: "Failed to update campaign" }, { status: 500 });
  }

  return NextResponse.json({ campaign: data });
}
