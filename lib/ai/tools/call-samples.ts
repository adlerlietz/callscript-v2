import { z } from "zod";
import { getAIClient } from "../base";

/**
 * Call Samples Tool - Fetch actual call records as proof points
 */

export const callSamplesSchema = z.object({
  publisher_name: z
    .string()
    .optional()
    .describe("Filter by publisher name (partial match)"),
  buyer_name: z
    .string()
    .optional()
    .describe("Filter by buyer name (partial match)"),
  status: z
    .enum(["all", "converted", "missed", "system_drop"])
    .optional()
    .describe("Filter by call outcome: 'converted' (revenue > 0), 'missed' (>60s, $0), 'system_drop' (<5s, $0)"),
  min_duration: z
    .number()
    .optional()
    .describe("Minimum call duration in seconds"),
  max_duration: z
    .number()
    .optional()
    .describe("Maximum call duration in seconds"),
  min_revenue: z
    .number()
    .optional()
    .describe("Minimum revenue"),
  max_revenue: z
    .number()
    .optional()
    .describe("Maximum revenue"),
  start_date: z
    .string()
    .optional()
    .describe("Start date filter (YYYY-MM-DD)"),
  end_date: z
    .string()
    .optional()
    .describe("End date filter (YYYY-MM-DD)"),
  limit: z
    .number()
    .optional()
    .describe("Number of calls to return (default 5, max 25)"),
});

export type CallSamplesParams = z.infer<typeof callSamplesSchema>;

export async function executeCallSamples(orgId: string, params: CallSamplesParams) {
  try {
    console.log("executeCallSamples: Starting with orgId:", orgId, "params:", params);
    const supabase = getAIClient();

    // Build filters object for JSONB parameter
    const filters: Record<string, unknown> = {};
    if (params.publisher_name) filters.publisher_name = params.publisher_name;
    if (params.buyer_name) filters.buyer_name = params.buyer_name;
    if (params.status && params.status !== "all") filters.status = params.status;
    if (params.min_duration !== undefined) filters.min_duration = params.min_duration;
    if (params.max_duration !== undefined) filters.max_duration = params.max_duration;
    if (params.min_revenue !== undefined) filters.min_revenue = params.min_revenue;
    if (params.max_revenue !== undefined) filters.max_revenue = params.max_revenue;
    if (params.start_date) filters.start_date = params.start_date;
    if (params.end_date) filters.end_date = params.end_date;

    const { data, error } = await supabase.schema("core").rpc("get_call_samples", {
      p_org_id: orgId,
      p_filters: filters,
      p_limit: Math.min(params.limit || 5, 25),
    });

    if (error) {
      console.error("executeCallSamples: Supabase error:", error);
      return {
        error: true,
        message: `Failed to fetch call samples: ${error.message}`,
        details: error,
      };
    }

    console.log("executeCallSamples: Success, calls found:", data?.length || 0);

    // Build data notes for context
    const notes: string[] = [];
    if (params.publisher_name) notes.push(`Publisher: ${params.publisher_name}`);
    if (params.buyer_name) notes.push(`Buyer: ${params.buyer_name}`);
    if (params.status && params.status !== "all") notes.push(`Status: ${params.status}`);
    if (params.start_date || params.end_date) {
      notes.push(`Date: ${params.start_date || "any"} to ${params.end_date || "today"}`);
    }

    if (notes.length === 0) {
      notes.push("No filters applied");
    }

    return {
      success: true,
      chart_type: "call_samples" as const,
      filters_applied: filters,
      data: data || [],
      count: data?.length || 0,
      data_notes: notes,
      _meta: {
        query: params,
        tool: "get_call_samples",
      },
    };
  } catch (err) {
    console.error("executeCallSamples: Exception:", err);
    return {
      error: true,
      message: `Database error: ${err instanceof Error ? err.message : "Unknown error"}`,
    };
  }
}
