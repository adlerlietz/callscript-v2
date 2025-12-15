import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

/**
 * GET /api/settings/campaigns
 * Returns all campaigns with call counts, grouped by mapping status
 */
export async function GET() {
  // Get all campaigns with their call counts
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
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Failed to fetch campaigns:", error);
    return NextResponse.json({ error: "Failed to fetch campaigns" }, { status: 500 });
  }

  // Get call counts per campaign
  const { data: callCounts, error: countError } = await supabase
    .from("calls")
    .select("campaign_id")
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
  });
}

/**
 * PATCH /api/settings/campaigns
 * Update a campaign's name and/or vertical
 */
export async function PATCH(request: NextRequest) {
  const body = await request.json();
  const { id, name, vertical } = body;

  if (!id) {
    return NextResponse.json({ error: "Campaign ID is required" }, { status: 400 });
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
    .select()
    .single();

  if (error) {
    console.error("Failed to update campaign:", error);
    return NextResponse.json({ error: "Failed to update campaign" }, { status: 500 });
  }

  return NextResponse.json({ campaign: data });
}
