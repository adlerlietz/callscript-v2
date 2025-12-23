import { z } from "zod";
import { createClient } from "@supabase/supabase-js";

/**
 * AI Explore Platform - Tool Definitions
 *
 * These tools are invoked by the AI to query call analytics data.
 * All queries are filtered by org_id for multi-tenant security.
 */

// Create a simple Supabase client for AI tools (service role, no cookies)
function getAIClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    console.error("AI Tools: Missing env vars", { url: !!url, key: !!key });
    throw new Error("Missing Supabase configuration");
  }

  return createClient(url, key);
}

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

export const negotiationSchema = z.object({
  partner_type: z
    .enum(["buyer", "publisher"])
    .describe("Type of partner to analyze: 'buyer' for price increase opportunities, 'publisher' for payout issues"),
  lookback_days: z
    .number()
    .optional()
    .describe("Days of data to analyze (default 30)"),
  min_calls: z
    .number()
    .optional()
    .describe("Minimum calls to include a partner (default 20, filters out noise)"),
});

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

// Tool descriptions for the AI
export const toolDescriptions = {
  get_kpi_summary:
    "Get aggregate KPIs (revenue, profit, margin, flag rate, RPC) for a date range. Use this for summary statistics.",
  get_trend_data:
    "Get time-series trend data for a metric (revenue, profit, calls, flag_rate, rpc). Returns up to 90 data points for charting.",
  get_leaderboard:
    "Get top performers ranked by a metric (revenue, profit, calls, flag_rate, rpc). Can group by publisher, buyer, campaign, vertical (industry), or state. Use vertical_filter to analyze WITHIN a vertical (e.g., 'best states for Medicare' = dimension:state, metric:rpc, vertical_filter:'medicare'). Returns top 25.",
  analyze_breakdown:
    "Drill down into a specific entity to explain its performance. Use this to answer 'WHY' questions. Example: If Florida is the top state, break it down by 'publisher' to see who drives that traffic. Example: If a publisher has high revenue, break it down by 'campaign' to see which campaigns perform best. Returns contribution percentages.",
  generate_forecast:
    "Project future metrics using linear regression on historical data. Use when user asks 'forecast', 'project', 'predict', or 'what will happen'. Returns historical data with trend line + projected future values. Always caveat results with 'Based on the last N days of data...'",
  analyze_negotiation_opportunities:
    "Find Buyers or Publishers with negotiation leverage. Use when user asks 'who should I negotiate with', 'increase profit', 'which publishers are bad', 'price increase opportunities', 'cut payout'. For Buyers: finds high-margin partners for price increases. For Publishers: finds money-losing partners to cut or block. Returns partners ranked by leverage with specific action recommendations.",
  simulate_financial_change:
    "Calculate hypothetical financial impact of payout or revenue changes. Use when user asks 'what if I cut payout', 'what if I raised CPA', 'simulate', 'impact of changing'. For Publishers: simulate payout changes (change_variable='payout'). For Buyers: simulate CPA/revenue changes (change_variable='revenue'). Returns current vs simulated profit comparison.",
  get_call_samples:
    "Fetch actual call records as proof points. Use when user asks 'show me calls', 'list examples', 'give me proof', 'find calls where...'. Filters by publisher, buyer, status (converted/missed/system_drop), duration range, revenue range, date range. Returns call details with masked caller numbers. Default 5 calls, max 25.",
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

/**
 * Execute trend data tool
 */
export async function executeTrendData(
  orgId: string,
  params: z.infer<typeof trendDataSchema>
) {
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

/**
 * Execute leaderboard tool
 */
export async function executeLeaderboard(
  orgId: string,
  params: z.infer<typeof leaderboardSchema>
) {
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

    // Add accuracy disclosure for state-based queries
    if (params.dimension === "state") {
      notes.push("State data is inferred from phone area codes (~95% accurate for landlines, ~80% for mobile).");
    }

    // Add RPC minimum calls note
    if (params.metric === "rpc") {
      const minCalls = params.min_calls || 10;
      notes.push(`RPC requires minimum ${minCalls} calls to avoid single-call outliers.`);
    }

    // Add filter context
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

/**
 * Execute breakdown analysis tool
 */
export async function executeBreakdownAnalysis(
  orgId: string,
  params: z.infer<typeof breakdownAnalysisSchema>
) {
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

    // Add accuracy disclosure for state-based analysis
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

/**
 * Execute forecast tool
 */
export async function executeForecast(
  orgId: string,
  params: z.infer<typeof forecastSchema>
) {
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

/**
 * Execute negotiation analysis tool
 */
export async function executeNegotiationAnalysis(
  orgId: string,
  params: z.infer<typeof negotiationSchema>
) {
  try {
    console.log("executeNegotiationAnalysis: Starting with orgId:", orgId, "params:", params);
    const supabase = getAIClient();

    const { data, error } = await supabase.schema("core").rpc("get_partner_leverage_analysis", {
      p_org_id: orgId,
      p_partner_type: params.partner_type,
      p_lookback_days: params.lookback_days || 30,
      p_min_calls: params.min_calls || 20,
    });

    if (error) {
      console.error("executeNegotiationAnalysis: Supabase error:", error);
      return {
        error: true,
        message: `Failed to analyze negotiation opportunities: ${error.message}`,
        details: error,
      };
    }

    console.log("executeNegotiationAnalysis: Success, partners:", data?.length || 0);

    // Group by action tag for summary
    const byTag: Record<string, typeof data> = {};
    data?.forEach((d: { action_tag: string; profit: number }) => {
      if (!byTag[d.action_tag]) byTag[d.action_tag] = [];
      byTag[d.action_tag].push(d);
    });

    // Calculate summary stats
    const summary = {
      total_partners: data?.length || 0,
      by_action_tag: Object.keys(byTag).map(tag => ({
        tag,
        count: byTag[tag].length,
        total_profit: byTag[tag].reduce((sum: number, d: { profit: number }) => sum + (d.profit || 0), 0),
      })),
    };

    // Build data notes
    const notes: string[] = [];
    notes.push(`Analyzed ${params.lookback_days || 30} days of data.`);
    notes.push(`Minimum ${params.min_calls || 20} calls required per partner.`);

    if (params.partner_type === "buyer") {
      const highMargin = byTag["HIGH_MARGIN"]?.length || 0;
      if (highMargin > 0) {
        notes.push(`Found ${highMargin} buyers with >40% margin (price increase opportunity).`);
      }
    } else {
      const negativeProfit = byTag["NEGATIVE_PROFIT"]?.length || 0;
      if (negativeProfit > 0) {
        notes.push(`⚠️ Found ${negativeProfit} publishers losing money.`);
      }
    }

    return {
      success: true,
      chart_type: "negotiation" as const,
      partner_type: params.partner_type,
      data: data || [],
      summary,
      data_notes: notes,
      _meta: {
        query: params,
        tool: "analyze_negotiation_opportunities",
      },
    };
  } catch (err) {
    console.error("executeNegotiationAnalysis: Exception:", err);
    return {
      error: true,
      message: `Database error: ${err instanceof Error ? err.message : "Unknown error"}`,
    };
  }
}

/**
 * Execute simulation tool
 */
export async function executeSimulation(
  orgId: string,
  params: z.infer<typeof simulationSchema>
) {
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

/**
 * Execute call samples tool
 */
export async function executeCallSamples(
  orgId: string,
  params: z.infer<typeof callSamplesSchema>
) {
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
