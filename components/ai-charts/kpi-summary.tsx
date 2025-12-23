"use client";

import { cn } from "@/lib/utils";
import { formatCurrency, formatPercent, formatNumber } from "./helpers";
import type { ChartData } from "./types";

/**
 * KPI Summary Card - Aggregate metrics display
 */
export function KPISummaryCard({ data }: { data: ChartData }) {
  if (!data.metrics) return null;

  const metrics = [
    { label: "Total Calls", value: formatNumber(data.metrics.total_calls), color: "text-zinc-100" },
    { label: "Revenue", value: formatCurrency(data.metrics.revenue), color: "text-emerald-400" },
    { label: "Payout", value: formatCurrency(data.metrics.payout), color: "text-yellow-400" },
    { label: "Profit", value: formatCurrency(data.metrics.profit), color: "text-emerald-400" },
    { label: "Margin", value: formatPercent(data.metrics.margin_pct), color: "text-blue-400" },
    { label: "Flag Rate", value: formatPercent(data.metrics.flag_rate_pct), color: data.metrics.flag_rate_pct > 20 ? "text-red-400" : "text-zinc-100" },
    { label: "RPC", value: formatCurrency(data.metrics.rpc), color: "text-zinc-100" },
  ];

  return (
    <div className="rounded-lg border border-zinc-700 bg-zinc-900 p-4">
      <div className="text-xs text-zinc-500 mb-3">
        {data.period?.start} to {data.period?.end}
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {metrics.map((m) => (
          <div key={m.label}>
            <div className="text-xs text-zinc-500">{m.label}</div>
            <div className={cn("text-lg font-semibold", m.color)}>{m.value}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
