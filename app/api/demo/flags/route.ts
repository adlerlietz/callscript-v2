import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { DEMO_ORG_ID } from "@/lib/demo/constants";

/**
 * Creates an admin Supabase client for demo queries.
 * Uses service role to bypass RLS since demo has no auth session.
 */
function createDemoClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

/**
 * GET /api/demo/flags
 * Fetches flagged calls for the demo organization.
 * No authentication required - uses hardcoded demo org.
 */
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const limit = parseInt(searchParams.get("limit") || "100", 10);
  const offset = parseInt(searchParams.get("offset") || "0", 10);

  const supabase = createDemoClient();

  const { data, error, count } = await supabase
    .from("calls_overview")
    .select("*", { count: "exact" })
    .eq("org_id", DEMO_ORG_ID)
    .eq("status", "flagged")
    .order("start_time_utc", { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) {
    console.error("Error fetching demo flagged calls:", error);
    return NextResponse.json(
      { error: "Failed to fetch flags" },
      { status: 500 }
    );
  }

  return NextResponse.json({
    flags: data ?? [],
    total: count ?? 0,
    limit,
    offset,
    isDemo: true,
  });
}
