import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAuthContext } from "@/lib/supabase/auth";

/**
 * GET /api/calls/latest
 * Returns the 100 most recent calls for the authenticated user's organization.
 */
export async function GET() {
  // Require authentication
  const auth = await getAuthContext();
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = await createClient();

  // Query with org_id filter for multi-tenant isolation
  const { data, error } = await supabase
    .from("calls_overview")
    .select("*")
    .eq("org_id", auth.orgId)
    .order("start_time_utc", { ascending: false })
    .limit(100);

  if (error) {
    console.error("Error fetching latest calls:", error);
    return NextResponse.json(
      { error: "Failed to fetch calls" },
      { status: 500 }
    );
  }

  return NextResponse.json({ calls: data ?? [] });
}
