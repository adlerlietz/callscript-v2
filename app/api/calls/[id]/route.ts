import { NextRequest, NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { getAuthContext } from "@/lib/supabase/auth";

/**
 * GET /api/calls/[id]
 * Fetches a single call by ID.
 * Uses authenticated client - RLS ensures user can only see their org's calls.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  // Verify user is authenticated and has org context
  const auth = await getAuthContext();
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const supabase = await createClient();

  // Fetch call with org_id filter (RLS also enforces this)
  const { data, error } = await supabase
    .from("calls_overview")
    .select("*")
    .eq("id", id)
    .eq("org_id", auth.orgId)
    .single();

  if (error || !data) {
    console.error("Error fetching call:", error);
    return NextResponse.json({ error: "Call not found" }, { status: 404 });
  }

  return NextResponse.json({ call: data });
}

/**
 * PATCH /api/calls/[id]
 * Updates a call's status or other fields.
 * Verifies user auth and org ownership, then uses service_role to write to core schema.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  // Verify user is authenticated and has org context
  const auth = await getAuthContext();
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const supabase = await createClient();

  // First verify the call belongs to the user's org
  const { data: existingCall, error: fetchError } = await supabase
    .from("calls_overview")
    .select("id, org_id")
    .eq("id", id)
    .eq("org_id", auth.orgId)
    .single();

  if (fetchError || !existingCall) {
    return NextResponse.json({ error: "Call not found" }, { status: 404 });
  }

  // Use admin client for the actual update
  const supabaseAdmin = await createAdminClient();

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  // Validate allowed fields to update
  const allowedFields = ["status", "qa_flags", "processing_error"];
  const updateData: Record<string, unknown> = {};

  for (const field of allowedFields) {
    if (field in body) {
      updateData[field] = body[field];
    }
  }

  if (Object.keys(updateData).length === 0) {
    return NextResponse.json(
      { error: "No valid fields to update" },
      { status: 400 }
    );
  }

  // Validate status if provided
  if (updateData.status) {
    const validStatuses = [
      "pending",
      "downloaded",
      "processing",
      "transcribed",
      "flagged",
      "safe",
      "failed",
    ];
    if (!validStatuses.includes(updateData.status as string)) {
      return NextResponse.json(
        { error: `Invalid status. Must be one of: ${validStatuses.join(", ")}` },
        { status: 400 }
      );
    }
  }

  // Add updated_at timestamp
  updateData.updated_at = new Date().toISOString();

  // Perform the update
  const { data, error } = await supabaseAdmin
    .from("calls")
    .update(updateData)
    .eq("id", id)
    .select()
    .single();

  if (error) {
    console.error("Error updating call:", error);
    return NextResponse.json(
      { error: "Failed to update call", details: error.message },
      { status: 500 }
    );
  }

  return NextResponse.json({
    call: data,
    message: "Call updated successfully",
  });
}
