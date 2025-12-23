import { z } from "zod";
import { getAIClient } from "../base";

/**
 * Forecast Tool - Linear regression projections
 */

export const forecastSchema = z.object({
  metric: z
    .enum(["revenue", "profit", "calls"])
    .describe("The metric to forecast"),
  lookback_days: z
    .number()
    .optional()
    .describe("Days of historical data to analyze (default 30, max 90)"),
  forecast_days: z
    .number()
    .optional()
    .describe("Days to project into the future (default 7, max 30)"),
  filter_dimension: z
    .enum(["publisher", "buyer", "campaign", "vertical", "state"])
    .optional()
    .describe("Optional: filter to a specific dimension"),
  filter_value: z
    .string()
    .optional()
    .describe("Optional: the value to filter by (e.g., 'FL' for state, 'Medicare Inc' for publisher)"),
});

export type ForecastParams = z.infer<typeof forecastSchema>;

export async function executeForecast(orgId: string, params: ForecastParams) {
  try {
    console.log("executeForecast: Starting with orgId:", orgId, "params:", params);
    const supabase = getAIClient();

    const { data, error } = await supabase.schema("core").rpc("get_metric_forecast", {
      p_org_id: orgId,
      p_metric: params.metric,
      p_lookback_days: params.lookback_days || 30,
      p_forecast_days: params.forecast_days || 7,
      p_dimension: params.filter_dimension || null,
      p_filter_value: params.filter_value || null,
    });

    if (error) {
      console.error("executeForecast: Supabase error:", error);
      return {
        error: true,
        message: `Failed to generate forecast: ${error.message}`,
        details: error,
      };
    }

    console.log("executeForecast: Success, rows:", data?.length || 0);

    // Calculate trend summary for AI context
    const historical = data?.filter((d: { is_forecast: boolean }) => !d.is_forecast) || [];
    const projected = data?.filter((d: { is_forecast: boolean }) => d.is_forecast) || [];

    const lastActual = historical.length > 0
      ? historical[historical.length - 1]?.actual_value || 0
      : 0;
    const lastProjected = projected.length > 0
      ? projected[projected.length - 1]?.forecast_value || 0
      : 0;

    const projectedChangePct = lastActual > 0
      ? ((lastProjected - lastActual) / lastActual * 100)
      : 0;

    // Build data notes
    const notes: string[] = [];
    notes.push(`Based on ${historical.length} days of historical data.`);

    if (params.filter_dimension && params.filter_value) {
      notes.push(`Filtered to ${params.filter_dimension}: ${params.filter_value}`);
    }

    if (historical.length < 7) {
      notes.push("Warning: Limited historical data may reduce forecast accuracy.");
    }

    return {
      success: true,
      chart_type: "forecast" as const,
      metric: params.metric,
      data: data || [],
      historical_days: historical.length,
      forecast_days: projected.length,
      trend_summary: {
        last_actual: Math.round(lastActual * 100) / 100,
        last_projected: Math.round(lastProjected * 100) / 100,
        projected_change_pct: Math.round(projectedChangePct * 10) / 10,
        direction: projectedChangePct > 1 ? "up" : projectedChangePct < -1 ? "down" : "flat",
      },
      data_notes: notes,
      _meta: {
        query: params,
        tool: "generate_forecast",
      },
    };
  } catch (err) {
    console.error("executeForecast: Exception:", err);
    return {
      error: true,
      message: `Database error: ${err instanceof Error ? err.message : "Unknown error"}`,
    };
  }
}
