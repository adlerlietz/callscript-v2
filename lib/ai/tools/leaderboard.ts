import { z } from "zod";
import { getAIClient } from "../base";

/**
 * Leaderboard Tool - Top performers by dimension
 */

export const leaderboardSchema = z.object({
  dimension: z
    .enum(["publisher", "buyer", "campaign", "vertical", "state"])
    .describe("The dimension to group by (vertical = industry like ACA, Medicare, Solar)"),
  metric: z
    .enum(["revenue", "profit", "calls", "flag_rate", "rpc"])
    .describe("The metric to rank by. Use 'rpc' (Revenue Per Call) for quality/efficiency analysis."),
  start_date: z.string().describe("Start date in ISO format (YYYY-MM-DD)"),
  end_date: z.string().describe("End date in ISO format (YYYY-MM-DD)"),
  vertical_filter: z
    .string()
    .optional()
    .describe("Filter to a specific vertical (e.g., 'medicare', 'aca', 'solar'). Use this when asking about performance WITHIN a vertical."),
  state_filter: z
    .string()
    .optional()
    .describe("Filter to a specific state (e.g., 'CA', 'TX'). Use this when asking about performance WITHIN a state."),
  min_calls: z
    .number()
    .optional()
    .describe("Minimum calls required for RPC metric (default 10). Prevents misleading single-call outliers."),
});

export type LeaderboardParams = z.infer<typeof leaderboardSchema>;

export async function executeLeaderboard(orgId: string, params: LeaderboardParams) {
  try {
    console.log("executeLeaderboard: Starting with orgId:", orgId, "params:", params);
    const supabase = getAIClient();

    const { data, error } = await supabase.schema("core").rpc("get_leaderboard", {
      p_org_id: orgId,
      p_dimension: params.dimension,
      p_metric: params.metric,
      p_start_date: params.start_date,
      p_end_date: params.end_date,
      p_vertical_filter: params.vertical_filter || null,
      p_state_filter: params.state_filter || null,
      p_min_calls: params.min_calls || 10,
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

    // Build data notes for transparency
    const notes: string[] = [];

    if (params.dimension === "state") {
      notes.push("State data is inferred from phone area codes (~95% accurate for landlines, ~80% for mobile).");
    }

    if (params.metric === "rpc") {
      const minCalls = params.min_calls || 10;
      notes.push(`RPC requires minimum ${minCalls} calls to avoid single-call outliers.`);
    }

    if (params.vertical_filter) {
      notes.push(`Filtered to vertical: ${params.vertical_filter}`);
    }
    if (params.state_filter) {
      notes.push(`Filtered to state: ${params.state_filter}`);
    }

    return {
      success: true,
      chart_type: "bar" as const,
      dimension: params.dimension,
      metric: params.metric,
      data: data || [],
      entries: data?.length || 0,
      max_entries: 25,
      truncated: (data?.length || 0) >= 25,
      filters_applied: {
        vertical: params.vertical_filter || null,
        state: params.state_filter || null,
        min_calls: params.metric === "rpc" ? (params.min_calls || 10) : null,
      },
      data_notes: notes.length > 0 ? notes : undefined,
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
