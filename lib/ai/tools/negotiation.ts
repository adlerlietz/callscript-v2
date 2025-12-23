import { z } from "zod";
import { getAIClient } from "../base";

/**
 * Negotiation Analysis Tool - Find partner leverage opportunities
 */

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

export type NegotiationParams = z.infer<typeof negotiationSchema>;

export async function executeNegotiationAnalysis(orgId: string, params: NegotiationParams) {
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
