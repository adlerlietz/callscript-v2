import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAuthContext } from "@/lib/supabase/auth";

/**
 * GET /api/stats
 * Fetches basic statistics for the authenticated user's organization.
 */
export async function GET() {
  // Verify user is authenticated and has org context
  const auth = await getAuthContext();
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = await createClient();
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayISO = today.toISOString();

  // Run queries in parallel using the public view with org filter
  const [totalResult, flaggedResult, safeResult, todayResult] = await Promise.all([
    supabase.from("calls_overview").select("*", { count: "exact", head: true }).eq("org_id", auth.orgId),
    supabase.from("calls_overview").select("*", { count: "exact", head: true }).eq("org_id", auth.orgId).eq("status", "flagged"),
    supabase.from("calls_overview").select("*", { count: "exact", head: true }).eq("org_id", auth.orgId).eq("status", "safe"),
    supabase.from("calls_overview").select("*", { count: "exact", head: true }).eq("org_id", auth.orgId).gte("start_time_utc", todayISO),
  ]);

  const totalCalls = totalResult.count ?? 0;
  const flaggedCalls = flaggedResult.count ?? 0;
  const safeCalls = safeResult.count ?? 0;
  const todayCalls = todayResult.count ?? 0;

  // Flag rate calculation
  const reviewedCalls = flaggedCalls + safeCalls;
  const flagRate = reviewedCalls > 0 ? (flaggedCalls / reviewedCalls) * 100 : 0;

  return NextResponse.json({
    totalCalls,
    todayCalls,
    flaggedCalls,
    safeCalls,
    flagRate: Math.round(flagRate * 10) / 10,
    revenueRecovered: 0,
    systemHealth: "healthy",
  });
}
