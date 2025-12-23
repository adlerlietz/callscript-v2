import { z } from "zod";
import { getAIClient } from "../base";

/**
 * Breakdown Analysis Tool - Drill down into entity performance
 */

export const breakdownAnalysisSchema = z.object({
  dimension: z
    .enum(["publisher", "buyer", "campaign", "vertical", "state"])
    .describe("The entity type to analyze (e.g., 'state' if asking about a specific state)"),
  filter_value: z
    .string()
    .describe("The specific entity value (e.g., 'FL' for Florida, 'Medicare Inc' for a publisher)"),
  breakdown_by: z
    .enum(["publisher", "buyer", "campaign", "vertical", "state"])
    .describe("The dimension to break down by (e.g., 'publisher' to see which publishers drive this entity)"),
  metric: z
    .enum(["revenue", "profit", "calls", "rpc"])
    .describe("The metric to analyze"),
  start_date: z.string().describe("Start date in ISO format (YYYY-MM-DD)"),
  end_date: z.string().describe("End date in ISO format (YYYY-MM-DD)"),
});

export type BreakdownAnalysisParams = z.infer<typeof breakdownAnalysisSchema>;

export async function executeBreakdownAnalysis(orgId: string, params: BreakdownAnalysisParams) {
  try {
    console.log("executeBreakdownAnalysis: Starting with orgId:", orgId, "params:", params);
    const supabase = getAIClient();

    const { data, error } = await supabase.schema("core").rpc("get_breakdown_analysis", {
      p_org_id: orgId,
      p_dimension: params.dimension,
      p_filter_value: params.filter_value,
      p_breakdown_by: params.breakdown_by,
      p_metric: params.metric,
      p_start_date: params.start_date,
      p_end_date: params.end_date,
    });

    if (error) {
      console.error("executeBreakdownAnalysis: Supabase error:", error);
      return {
        error: true,
        message: `Failed to fetch breakdown analysis: ${error.message}`,
        details: error,
      };
    }

    console.log("executeBreakdownAnalysis: Success, entries:", data?.length || 0);

    // Build data notes for transparency
    const notes: string[] = [];

    if (params.dimension === "state" || params.breakdown_by === "state") {
      notes.push("State data is inferred from phone area codes (~95% accurate for landlines, ~80% for mobile).");
    }

    return {
      success: true,
      chart_type: "bar" as const,
      context: {
        dimension: params.dimension,
        filter_value: params.filter_value,
        breakdown_by: params.breakdown_by,
      },
      metric: params.metric,
      data: data || [],
      entries: data?.length || 0,
      max_entries: 25,
      data_notes: notes.length > 0 ? notes : undefined,
      _meta: {
        query: params,
        tool: "analyze_breakdown",
      },
    };
  } catch (err) {
    console.error("executeBreakdownAnalysis: Exception:", err);
    return {
      error: true,
      message: `Database error: ${err instanceof Error ? err.message : "Unknown error"}`,
    };
  }
}
