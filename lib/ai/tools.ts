import { z } from "zod";
import { createCoreClient } from "@/lib/supabase/server";

/**
 * AI Explore Platform - Tool Definitions
 *
 * These tools are invoked by the AI to query call analytics data.
 * All queries are filtered by org_id for multi-tenant security.
 */

// Response types for type safety
export interface KPISummaryResponse {
  period: { start: string; end: string };
  metrics: {
    total_calls: number;
    revenue: number;
    payout: number;
    profit: number;
    margin_pct: number;
    flag_rate_pct: number;
    rpc: number;
  };
  definitions: Record<string, string>;
}

export interface TrendDataPoint {
  date_bucket: string;
  value: number;
}

export interface LeaderboardEntry {
  name: string;
  value: number;
  total_calls: number;
}

// Tool parameter schemas
export const kpiSummarySchema = z.object({
  start_date: z.string().describe("Start date in ISO format (YYYY-MM-DD)"),
  end_date: z.string().describe("End date in ISO format (YYYY-MM-DD)"),
});

export const trendDataSchema = z.object({
  metric: z
    .enum(["revenue", "profit", "calls", "flag_rate", "rpc"])
    .describe("The metric to trend"),
  interval: z.enum(["day", "week"]).describe("Grouping interval"),
  start_date: z.string().describe("Start date in ISO format (YYYY-MM-DD)"),
  end_date: z.string().describe("End date in ISO format (YYYY-MM-DD)"),
});

export const leaderboardSchema = z.object({
  dimension: z
    .enum(["publisher", "buyer", "campaign", "vertical", "state"])
    .describe("The dimension to group by (vertical = industry like ACA, Medicare, Solar)"),
  metric: z
    .enum(["revenue", "profit", "calls", "flag_rate"])
    .describe("The metric to rank by"),
  start_date: z.string().describe("Start date in ISO format (YYYY-MM-DD)"),
  end_date: z.string().describe("End date in ISO format (YYYY-MM-DD)"),
});

// Tool descriptions for the AI
export const toolDescriptions = {
  get_kpi_summary:
    "Get aggregate KPIs (revenue, profit, margin, flag rate, RPC) for a date range. Use this for summary statistics.",
  get_trend_data:
    "Get time-series trend data for a metric (revenue, profit, calls, flag_rate, rpc). Returns up to 90 data points for charting.",
  get_leaderboard:
    "Get top performers ranked by a metric (revenue, profit, calls, flag_rate). Can group by publisher, buyer, campaign, vertical (industry), or state. Returns top 25.",
};

/**
 * Execute KPI summary tool
 */
export async function executeKpiSummary(
  orgId: string,
  params: z.infer<typeof kpiSummarySchema>
) {
  try {
    console.log("executeKpiSummary: Starting with orgId:", orgId, "params:", params);
    const supabase = await createCoreClient();

    const { data, error } = await supabase.rpc("get_kpi_summary", {
      p_org_id: orgId,
      p_start_date: params.start_date,
      p_end_date: params.end_date,
    });

    if (error) {
      console.error("executeKpiSummary: Supabase error:", error);
      return {
        error: true,
        message: `Failed to fetch KPI summary: ${error.message}`,
        details: error,
      };
    }

    console.log("executeKpiSummary: Success, data:", JSON.stringify(data).substring(0, 200));
    return {
      success: true,
      ...data,
      _meta: {
        query: params,
        tool: "get_kpi_summary",
      },
    };
  } catch (err) {
    console.error("executeKpiSummary: Exception:", err);
    return {
      error: true,
      message: `Database error: ${err instanceof Error ? err.message : "Unknown error"}`,
    };
  }
}

/**
 * Execute trend data tool
 */
export async function executeTrendData(
  orgId: string,
  params: z.infer<typeof trendDataSchema>
) {
  try {
    console.log("executeTrendData: Starting with orgId:", orgId, "params:", params);
    const supabase = await createCoreClient();

    const { data, error } = await supabase.rpc("get_trend_data", {
      p_org_id: orgId,
      p_metric: params.metric,
      p_interval: params.interval,
      p_start_date: params.start_date,
      p_end_date: params.end_date,
    });

    if (error) {
      console.error("executeTrendData: Supabase error:", error);
      return {
        error: true,
        message: `Failed to fetch trend data: ${error.message}`,
        details: error,
      };
    }

    const chartType = params.metric === "calls" ? "bar" : "line";

    console.log("executeTrendData: Success, rows:", data?.length || 0);
    return {
      success: true,
      chart_type: chartType,
      metric: params.metric,
      interval: params.interval,
      data: data || [],
      data_points: data?.length || 0,
      _meta: {
        query: params,
        tool: "get_trend_data",
      },
    };
  } catch (err) {
    console.error("executeTrendData: Exception:", err);
    return {
      error: true,
      message: `Database error: ${err instanceof Error ? err.message : "Unknown error"}`,
    };
  }
}

/**
 * Execute leaderboard tool
 */
export async function executeLeaderboard(
  orgId: string,
  params: z.infer<typeof leaderboardSchema>
) {
  try {
    console.log("executeLeaderboard: Starting with orgId:", orgId, "params:", params);
    const supabase = await createCoreClient();

    const { data, error } = await supabase.rpc("get_leaderboard", {
      p_org_id: orgId,
      p_dimension: params.dimension,
      p_metric: params.metric,
      p_start_date: params.start_date,
      p_end_date: params.end_date,
    });

    if (error) {
      console.error("executeLeaderboard: Supabase error:", error);
      return {
        error: true,
        message: `Failed to fetch leaderboard: ${error.message}`,
        details: error,
      };
    }

    console.log("executeLeaderboard: Success, entries:", data?.length || 0);
    return {
      success: true,
      chart_type: "bar" as const,
      dimension: params.dimension,
      metric: params.metric,
      data: data || [],
      entries: data?.length || 0,
      max_entries: 25,
      truncated: (data?.length || 0) >= 25,
      _meta: {
        query: params,
        tool: "get_leaderboard",
      },
    };
  } catch (err) {
    console.error("executeLeaderboard: Exception:", err);
    return {
      error: true,
      message: `Database error: ${err instanceof Error ? err.message : "Unknown error"}`,
    };
  }
}
