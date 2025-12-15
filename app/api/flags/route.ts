import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAuthContext } from "@/lib/supabase/auth";

/**
 * GET /api/flags
 * Fetches flagged calls for the authenticated user's organization.
 */
export async function GET(request: NextRequest) {
  // Verify user is authenticated and has org context
  const auth = await getAuthContext();
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const searchParams = request.nextUrl.searchParams;
  const limit = parseInt(searchParams.get("limit") || "100", 10);
  const offset = parseInt(searchParams.get("offset") || "0", 10);

  const supabase = await createClient();

  const { data, error, count } = await supabase
    .from("calls_overview")
    .select("*", { count: "exact" })
    .eq("org_id", auth.orgId)
    .eq("status", "flagged")
    .order("start_time_utc", { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) {
    console.error("Error fetching flagged calls:", error);
    return NextResponse.json({ error: "Failed to fetch flags" }, { status: 500 });
  }

  return NextResponse.json({
    flags: data ?? [],
    total: count ?? 0,
    limit,
    offset,
  });
}
