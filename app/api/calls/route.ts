import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAuthContext } from "@/lib/supabase/auth";

/**
 * GET /api/calls
 * Fetches paginated calls for the authenticated user's organization.
 */
export async function GET(request: NextRequest) {
  // Verify user is authenticated and has org context
  const auth = await getAuthContext();
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const searchParams = request.nextUrl.searchParams;
  const status = searchParams.get("status");
  const limit = parseInt(searchParams.get("limit") || "100", 10);
  const offset = parseInt(searchParams.get("offset") || "0", 10);

  const supabase = await createClient();

  // Use the public calls_overview view with org filter (RLS also enforces this)
  let query = supabase
    .from("calls_overview")
    .select("*", { count: "exact" })
    .eq("org_id", auth.orgId)
    .order("start_time_utc", { ascending: false })
    .range(offset, offset + limit - 1);

  if (status && status !== "all") {
    query = query.eq("status", status);
  }

  const { data, error, count } = await query;

  if (error) {
    console.error("Error fetching calls:", error);
    return NextResponse.json({ error: "Failed to fetch calls" }, { status: 500 });
  }

  return NextResponse.json({
    calls: data ?? [],
    total: count ?? 0,
    limit,
    offset,
  });
}
