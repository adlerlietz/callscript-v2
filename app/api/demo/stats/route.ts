import { NextResponse } from "next/server";
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
 * GET /api/demo/stats
 * Fetches dashboard statistics for the demo organization.
 * No authentication required - uses hardcoded demo org.
 */
export async function GET() {
  const supabase = createDemoClient();
  const now = new Date();

  // Today start (midnight UTC)
  const todayStart = new Date(now);
  todayStart.setUTCHours(0, 0, 0, 0);
  const todayISO = todayStart.toISOString();

  // Yesterday start for comparison
  const yesterdayStart = new Date(todayStart);
  yesterdayStart.setUTCDate(yesterdayStart.getUTCDate() - 1);
  const yesterdayISO = yesterdayStart.toISOString();

  // Helper to add org filter to all queries
  const orgQuery = () =>
    supabase
      .from("calls_overview")
      .select("*", { count: "exact", head: true })
      .eq("org_id", DEMO_ORG_ID);

  // Run all queries in parallel
  const [
    todayTotalResult,
    todayFlaggedResult,
    todaySafeResult,
    yesterdayTotalResult,
    yesterdayFlaggedResult,
    totalFlaggedResult,
    totalSafeResult,
    pendingResult,
    downloadedResult,
    processingResult,
    transcribedResult,
    revenueAtRiskResult,
  ] = await Promise.all([
    // Today
    orgQuery().gte("start_time_utc", todayISO),
    orgQuery().gte("start_time_utc", todayISO).eq("status", "flagged"),
    orgQuery().gte("start_time_utc", todayISO).eq("status", "safe"),
    // Yesterday
    orgQuery()
      .gte("start_time_utc", yesterdayISO)
      .lt("start_time_utc", todayISO),
    orgQuery()
      .gte("start_time_utc", yesterdayISO)
      .lt("start_time_utc", todayISO)
      .eq("status", "flagged"),
    // Overall
    orgQuery().eq("status", "flagged"),
    orgQuery().eq("status", "safe"),
    // Queue
    orgQuery().eq("status", "pending"),
    orgQuery().eq("status", "downloaded"),
    orgQuery().eq("status", "processing"),
    orgQuery().eq("status", "transcribed"),
    // Revenue
    supabase
      .from("calls_overview")
      .select("revenue")
      .eq("org_id", DEMO_ORG_ID)
      .eq("status", "flagged")
      .not("revenue", "is", null),
  ]);

  // Extract counts
  const todayTotal = todayTotalResult.count ?? 0;
  const todayFlagged = todayFlaggedResult.count ?? 0;
  const todaySafe = todaySafeResult.count ?? 0;
  const yesterdayTotal = yesterdayTotalResult.count ?? 0;
  const yesterdayFlagged = yesterdayFlaggedResult.count ?? 0;

  const totalFlagged = totalFlaggedResult.count ?? 0;
  const totalSafe = totalSafeResult.count ?? 0;

  const pending = pendingResult.count ?? 0;
  const downloaded = downloadedResult.count ?? 0;
  const processing = processingResult.count ?? 0;
  const transcribed = transcribedResult.count ?? 0;

  // Calculate revenue at risk
  const revenueAtRisk = (revenueAtRiskResult.data ?? []).reduce(
    (sum, row) => sum + (Number(row.revenue) || 0),
    0
  );

  // Calculate percentages and changes
  const todayReviewed = todayFlagged + todaySafe;
  const todayFlagRate =
    todayReviewed > 0 ? (todayFlagged / todayReviewed) * 100 : 0;

  const yesterdayReviewed =
    yesterdayFlagged + (yesterdayTotalResult.count ?? 0) - yesterdayFlagged;
  const yesterdayFlagRate =
    yesterdayReviewed > 0 ? (yesterdayFlagged / yesterdayReviewed) * 100 : 0;

  // Volume change
  const volumeChange =
    yesterdayTotal > 0
      ? ((todayTotal - yesterdayTotal) / yesterdayTotal) * 100
      : 0;

  // Flag rate change
  const flagRateChange =
    yesterdayFlagRate > 0 ? todayFlagRate - yesterdayFlagRate : 0;

  // Queue health
  const queueTotal = pending + downloaded + processing + transcribed;
  const queueHealth =
    queueTotal < 50 ? "healthy" : queueTotal < 200 ? "busy" : "backlogged";

  return NextResponse.json({
    // Today's metrics
    today: {
      total: todayTotal,
      flagged: todayFlagged,
      safe: todaySafe,
      flagRate: Math.round(todayFlagRate * 10) / 10,
    },
    // Comparison to yesterday
    changes: {
      volume: Math.round(volumeChange * 10) / 10,
      flagRate: Math.round(flagRateChange * 10) / 10,
    },
    // Overall totals
    totals: {
      flagged: totalFlagged,
      safe: totalSafe,
      reviewed: totalFlagged + totalSafe,
    },
    // Queue status
    queue: {
      pending,
      downloaded,
      processing,
      transcribed,
      total: queueTotal,
      health: queueHealth,
    },
    // Revenue
    revenueAtRisk: Math.round(revenueAtRisk * 100) / 100,
    // System status (always show healthy for demo)
    systemHealth: "operational",
    // Integration status (always show configured for demo)
    ringbaConfigured: true,
    timestamp: now.toISOString(),
    // Demo indicator
    isDemo: true,
  });
}
