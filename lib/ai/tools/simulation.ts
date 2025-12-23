import { z } from "zod";
import { getAIClient } from "../base";

/**
 * Simulation Tool - What-if financial analysis
 */

export const simulationSchema = z.object({
  target_type: z
    .enum(["publisher", "buyer"])
    .describe("Type of entity: 'publisher' for payout changes, 'buyer' for revenue changes"),
  target_id: z
    .string()
    .describe("Name of the publisher or buyer to simulate changes for"),
  change_variable: z
    .enum(["payout", "revenue"])
    .describe("Variable to change: 'payout' for publishers, 'revenue' for buyers"),
  change_amount: z
    .number()
    .describe("Dollar change PER CALL. Negative = decrease (e.g., -5 cuts $5/call). Positive = increase."),
  lookback_days: z
    .number()
    .optional()
    .describe("Days of historical data to base simulation on (default 30)"),
});

export type SimulationParams = z.infer<typeof simulationSchema>;

export async function executeSimulation(orgId: string, params: SimulationParams) {
  try {
    console.log("executeSimulation: Starting with orgId:", orgId, "params:", params);

    // Validate change_variable matches target_type
    if (params.target_type === "publisher" && params.change_variable !== "payout") {
      return {
        error: true,
        message: "For publishers, only 'payout' changes are supported. Use change_variable='payout'.",
      };
    }
    if (params.target_type === "buyer" && params.change_variable !== "revenue") {
      return {
        error: true,
        message: "For buyers, only 'revenue' changes are supported. Use change_variable='revenue'.",
      };
    }

    const supabase = getAIClient();

    const { data, error } = await supabase.schema("core").rpc("get_simulation_impact", {
      p_org_id: orgId,
      p_target_type: params.target_type,
      p_target_id: params.target_id,
      p_change_variable: params.change_variable,
      p_change_amount: params.change_amount,
      p_lookback_days: params.lookback_days || 30,
    });

    if (error) {
      console.error("executeSimulation: Supabase error:", error);
      return {
        error: true,
        message: `Failed to run simulation: ${error.message}`,
        details: error,
      };
    }

    console.log("executeSimulation: Success, result:", data?.[0] ? "found" : "not found");

    // Build data notes
    const notes: string[] = [];
    const changeDir = params.change_amount > 0 ? "increase" : "decrease";
    notes.push(`Simulated $${Math.abs(params.change_amount)}/call ${changeDir} in ${params.change_variable}.`);
    notes.push(`Based on ${params.lookback_days || 30} days of historical data.`);

    if (!data || data.length === 0) {
      notes.push(`No data found for ${params.target_type}: "${params.target_id}". Check the name spelling.`);
    }

    return {
      success: true,
      chart_type: "simulation" as const,
      simulation: {
        target_type: params.target_type,
        target_name: data?.[0]?.target_name || params.target_id,
        change_variable: params.change_variable,
        change_amount: params.change_amount,
      },
      data: data?.[0] || null,
      data_notes: notes,
      _meta: {
        query: params,
        tool: "simulate_financial_change",
      },
    };
  } catch (err) {
    console.error("executeSimulation: Exception:", err);
    return {
      error: true,
      message: `Database error: ${err instanceof Error ? err.message : "Unknown error"}`,
    };
  }
}
