import { z } from "zod";
import { getAIClient } from "../base";

/**
 * Trend Data Tool - Time-series metrics
 */

export const trendDataSchema = z.object({
  metric: z
    .enum(["revenue", "profit", "calls", "flag_rate", "rpc"])
    .describe("The metric to trend"),
  interval: z.enum(["day", "week"]).describe("Grouping interval"),
  start_date: z.string().describe("Start date in ISO format (YYYY-MM-DD)"),
  end_date: z.string().describe("End date in ISO format (YYYY-MM-DD)"),
});

export type TrendDataParams = z.infer<typeof trendDataSchema>;

export async function executeTrendData(orgId: string, params: TrendDataParams) {
  try {
    console.log("executeTrendData: Starting with orgId:", orgId, "params:", params);
    const supabase = getAIClient();

    const { data, error } = await supabase.schema("core").rpc("get_trend_data", {
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
