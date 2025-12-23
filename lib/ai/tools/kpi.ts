import { z } from "zod";
import { getAIClient } from "../base";

/**
 * KPI Summary Tool - Aggregate metrics for a date range
 */

export const kpiSummarySchema = z.object({
  start_date: z.string().describe("Start date in ISO format (YYYY-MM-DD)"),
  end_date: z.string().describe("End date in ISO format (YYYY-MM-DD)"),
});

export type KpiSummaryParams = z.infer<typeof kpiSummarySchema>;

export async function executeKpiSummary(orgId: string, params: KpiSummaryParams) {
  try {
    console.log("executeKpiSummary: Starting with orgId:", orgId, "params:", params);
    const supabase = getAIClient();

    const { data, error } = await supabase.schema("core").rpc("get_kpi_summary", {
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
