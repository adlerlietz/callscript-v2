"use client";

import { cn } from "@/lib/utils";
import { formatCurrency, formatNumber } from "./helpers";
import type { NegotiationChartData } from "./types";

/**
 * Negotiation Chart - Partner leverage analysis table
 */
export function NegotiationChart({ data }: { data: NegotiationChartData }) {
  if (!data.data || data.data.length === 0) {
    return (
      <div className="rounded-lg border border-zinc-700 bg-zinc-900 p-4 text-center text-zinc-500">
        No partners found matching the criteria
      </div>
    );
  }

  const tagColors: Record<string, string> = {
    HIGH_MARGIN: "text-emerald-400",
    HIGH_PERFORMER: "text-emerald-400",
    HIGH_VOLUME: "text-blue-400",
    LOW_MARGIN: "text-yellow-400",
    LOW_RPC: "text-yellow-400",
    NEGATIVE_PROFIT: "text-red-400",
    STANDARD: "text-zinc-400",
  };

  const tagBgColors: Record<string, string> = {
    HIGH_MARGIN: "bg-emerald-400/10",
    HIGH_PERFORMER: "bg-emerald-400/10",
    HIGH_VOLUME: "bg-blue-400/10",
    LOW_MARGIN: "bg-yellow-400/10",
    LOW_RPC: "bg-yellow-400/10",
    NEGATIVE_PROFIT: "bg-red-400/10",
    STANDARD: "bg-zinc-400/10",
  };

  return (
    <div className="rounded-lg border border-zinc-700 bg-zinc-900 p-4">
      <div className="text-sm font-medium text-zinc-300 mb-4">
        {data.partner_type === "buyer" ? "Buyer" : "Publisher"} Leverage Analysis
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-zinc-500 border-b border-zinc-700">
              <th className="text-left py-2 px-2">Name</th>
              <th className="text-right py-2 px-2">Calls</th>
              <th className="text-right py-2 px-2">Revenue</th>
              <th className="text-right py-2 px-2">Profit</th>
              <th className="text-right py-2 px-2">Margin</th>
              <th className="text-left py-2 px-2">Action</th>
            </tr>
          </thead>
          <tbody>
            {data.data.slice(0, 15).map((row, i) => (
              <tr key={i} className="border-b border-zinc-800 hover:bg-zinc-800/50">
                <td className="py-2 px-2 text-zinc-100 max-w-[150px] truncate" title={row.entity_name}>
                  {row.entity_name}
                </td>
                <td className="py-2 px-2 text-right text-zinc-300">
                  {formatNumber(row.total_calls)}
                </td>
                <td className="py-2 px-2 text-right text-zinc-300">
                  {formatCurrency(row.revenue)}
                </td>
                <td className={cn(
                  "py-2 px-2 text-right font-medium",
                  row.profit < 0 ? "text-red-400" : "text-emerald-400"
                )}>
                  {formatCurrency(row.profit)}
                </td>
                <td className="py-2 px-2 text-right text-zinc-300">
                  {row.margin_pct}%
                </td>
                <td className="py-2 px-2">
                  <span className={cn(
                    "px-2 py-0.5 rounded text-xs font-medium",
                    tagColors[row.action_tag] || "text-zinc-400",
                    tagBgColors[row.action_tag] || "bg-zinc-400/10"
                  )}>
                    {row.action_tag.replace(/_/g, " ")}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {data.data.length > 15 && (
        <div className="text-xs text-zinc-500 mt-2 text-center">
          Showing top 15 of {data.data.length} partners
        </div>
      )}
    </div>
  );
}
