import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";

/**
 * GET /api/health
 * Public health check endpoint for uptime monitoring.
 * Returns pipeline status, queue depths, and processing metrics.
 */
export async function GET() {
  const startTime = Date.now();

  try {
    // Create a simple client without cookies for health checks
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll: () => [],
          setAll: () => {},
        },
      }
    );

    // Check database connectivity and get queue stats (using public view)
    const { data: queueStats, error: queueError } = await supabase
      .from("calls_overview")
      .select("status")
      .limit(10000);

    if (queueError) {
      return NextResponse.json({
        status: "unhealthy",
        error: "Database connection failed",
        details: queueError.message,
        timestamp: new Date().toISOString(),
        latency_ms: Date.now() - startTime,
      }, { status: 503 });
    }

    // Calculate queue depths by status
    const statusCounts: Record<string, number> = {};
    queueStats?.forEach((call) => {
      statusCounts[call.status] = (statusCounts[call.status] || 0) + 1;
    });

    // Get recent processing activity (last hour)
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { data: recentActivity } = await supabase
      .from("calls_overview")
      .select("id, status, updated_at")
      .gte("updated_at", oneHourAgo)
      .order("updated_at", { ascending: false })
      .limit(100);

    // Check for stuck jobs (processing for > 30 minutes)
    const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    const { data: stuckJobs } = await supabase
      .from("calls_overview")
      .select("id")
      .eq("status", "processing")
      .lt("updated_at", thirtyMinutesAgo);

    // Calculate health score
    const stuckCount = stuckJobs?.length || 0;
    const pendingCount = statusCounts["pending"] || 0;
    const processingCount = statusCounts["processing"] || 0;
    const recentCount = recentActivity?.length || 0;

    // Determine overall status
    let overallStatus: "healthy" | "degraded" | "unhealthy" = "healthy";
    const warnings: string[] = [];

    if (stuckCount > 0) {
      warnings.push(`${stuckCount} jobs stuck in processing`);
      overallStatus = "degraded";
    }

    if (stuckCount > 10) {
      overallStatus = "unhealthy";
    }

    if (pendingCount > 500) {
      warnings.push(`High queue depth: ${pendingCount} pending`);
      if (overallStatus === "healthy") overallStatus = "degraded";
    }

    if (recentCount === 0 && (pendingCount > 0 || processingCount > 0)) {
      warnings.push("No processing activity in last hour");
      overallStatus = "degraded";
    }

    // Calculate throughput (completed in last hour)
    const completedRecently = recentActivity?.filter(
      (c) => c.status === "transcribed" || c.status === "flagged" || c.status === "safe"
    ).length || 0;

    return NextResponse.json({
      status: overallStatus,
      timestamp: new Date().toISOString(),
      latency_ms: Date.now() - startTime,

      queue: {
        pending: statusCounts["pending"] || 0,
        downloaded: statusCounts["downloaded"] || 0,
        processing: statusCounts["processing"] || 0,
        transcribed: statusCounts["transcribed"] || 0,
        flagged: statusCounts["flagged"] || 0,
        safe: statusCounts["safe"] || 0,
        failed: statusCounts["failed"] || 0,
      },

      metrics: {
        stuck_jobs: stuckCount,
        throughput_1h: completedRecently,
        recent_activity: recentCount,
      },

      warnings: warnings.length > 0 ? warnings : undefined,
    });

  } catch (error) {
    return NextResponse.json({
      status: "unhealthy",
      error: "Health check failed",
      details: error instanceof Error ? error.message : "Unknown error",
      timestamp: new Date().toISOString(),
      latency_ms: Date.now() - startTime,
    }, { status: 503 });
  }
}
