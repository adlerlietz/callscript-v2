import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export async function GET() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayISO = today.toISOString();

  // Run queries in parallel using the public view
  const [totalResult, flaggedResult, safeResult, todayResult] = await Promise.all([
    supabase.from("calls_overview").select("*", { count: "exact", head: true }),
    supabase.from("calls_overview").select("*", { count: "exact", head: true }).eq("status", "flagged"),
    supabase.from("calls_overview").select("*", { count: "exact", head: true }).eq("status", "safe"),
    supabase.from("calls_overview").select("*", { count: "exact", head: true }).gte("start_time_utc", todayISO),
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
    revenueRecovered: 0, // Revenue not in public view
    systemHealth: "healthy",
  });
}
