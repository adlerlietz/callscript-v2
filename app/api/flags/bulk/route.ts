import { NextRequest, NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { getAuthContext } from "@/lib/supabase/auth";

/**
 * POST /api/flags/bulk
 * Bulk update call statuses (mark_safe or confirm_bad).
 * Verifies all calls belong to user's org before updating.
 */
export async function POST(request: NextRequest) {
  // Verify user is authenticated and has org context
  const auth = await getAuthContext();
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const { ids, action } = body;

  if (!Array.isArray(ids) || ids.length === 0) {
    return NextResponse.json({ error: "ids array required" }, { status: 400 });
  }

  if (!["mark_safe", "confirm_bad"].includes(action)) {
    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  }

  const supabase = await createClient();

  // Verify all requested calls belong to user's org
  const { data: validCalls, error: fetchError } = await supabase
    .from("calls_overview")
    .select("id")
    .eq("org_id", auth.orgId)
    .in("id", ids);

  if (fetchError) {
    console.error("Error validating calls:", fetchError);
    return NextResponse.json(
      { error: "Failed to validate calls" },
      { status: 500 }
    );
  }

  const validIds = validCalls?.map((c) => c.id) || [];
  if (validIds.length === 0) {
    return NextResponse.json(
      { error: "No valid calls found for your organization" },
      { status: 404 }
    );
  }

  // Use admin client for the actual update
  const supabaseAdmin = await createAdminClient();

  const updateData: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };

  // Only update status for mark_safe action
  if (action === "mark_safe") {
    updateData.status = "safe";
  }
  // For confirm_bad, the call remains flagged - this action is for workflow acknowledgment

  try {
    // Perform bulk update only on validated IDs
    const { data, error } = await supabaseAdmin
      .from("calls")
      .update(updateData)
      .in("id", validIds)
      .select("id, status");

    if (error) {
      console.error("Bulk update error:", error);
      return NextResponse.json(
        { error: "Failed to update calls", details: error.message },
        { status: 500 }
      );
    }

    const updatedCount = data?.length || 0;

    return NextResponse.json({
      success: true,
      updated: updatedCount,
      action,
      newStatus: action === "mark_safe" ? "safe" : "flagged (confirmed)",
      message: `Successfully updated ${updatedCount} call(s)`,
    });
  } catch (err) {
    console.error("Bulk update exception:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
