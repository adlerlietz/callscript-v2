import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

/**
 * Creates Supabase admin client for bulk updates to core schema
 */
function getSupabaseAdmin() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseServiceKey) {
    return null;
  }

  return createClient(supabaseUrl, supabaseServiceKey, {
    db: { schema: "core" },
  });
}

/**
 * POST /api/flags/bulk
 * Bulk update call statuses (mark_safe or confirm_bad)
 */
export async function POST(request: NextRequest) {
  const body = await request.json();
  const { ids, action } = body;

  if (!Array.isArray(ids) || ids.length === 0) {
    return NextResponse.json({ error: "ids array required" }, { status: 400 });
  }

  if (!["mark_safe", "confirm_bad"].includes(action)) {
    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  }

  const supabaseAdmin = getSupabaseAdmin();

  if (!supabaseAdmin) {
    console.error("SUPABASE_SERVICE_ROLE_KEY not configured");
    return NextResponse.json(
      { error: "Server configuration error: missing service role key" },
      { status: 500 }
    );
  }

  // Map action to new status
  const newStatus = action === "mark_safe" ? "safe" : "flagged";

  // For confirm_bad, we keep it as flagged but could add a confirmed_bad field later
  // For now, mark_safe changes to "safe", confirm_bad stays "flagged" (already flagged)

  const updateData: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };

  // Only update status for mark_safe action
  if (action === "mark_safe") {
    updateData.status = "safe";
  }
  // For confirm_bad, we could add additional tracking here
  // For now, the call remains flagged - this action is for workflow acknowledgment

  try {
    // Perform bulk update
    const { data, error } = await supabaseAdmin
      .from("calls")
      .update(updateData)
      .in("id", ids)
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
