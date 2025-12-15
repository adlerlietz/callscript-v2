import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAuthContext } from "@/lib/supabase/auth";

/**
 * GET /api/stats/chart
 * Fetches chart data for the authenticated user's organization.
 */
export async function GET(request: NextRequest) {
  // Verify user is authenticated and has org context
  const auth = await getAuthContext();
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = await createClient();
  const searchParams = request.nextUrl.searchParams;
  const days = parseInt(searchParams.get("days") || "7", 10);

  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);
  startDate.setHours(0, 0, 0, 0);

  const { data, error } = await supabase
    .from("calls_overview")
    .select("start_time_utc, status")
    .eq("org_id", auth.orgId)
    .gte("start_time_utc", startDate.toISOString())
    .order("start_time_utc", { ascending: true });

  if (error) {
    console.error("Error fetching chart data:", error);
    return NextResponse.json({ error: "Failed to fetch chart data" }, { status: 500 });
  }

  // Group by day
  const dailyData: Record<string, { total: number; flagged: number }> = {};

  for (const call of data ?? []) {
    const date = new Date(call.start_time_utc).toISOString().slice(0, 10);
    if (!dailyData[date]) {
      dailyData[date] = { total: 0, flagged: 0 };
    }
    dailyData[date].total++;
    if (call.status === "flagged") {
      dailyData[date].flagged++;
    }
  }

  // Convert to array sorted by date
  const chartData = Object.entries(dailyData)
    .map(([date, counts]) => ({
      date,
      calls: counts.total,
      flags: counts.flagged,
    }))
    .sort((a, b) => a.date.localeCompare(b.date));

  return NextResponse.json({ chartData });
}
