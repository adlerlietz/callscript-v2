"use client";

import { cn } from "@/lib/utils";
import { formatCurrency, formatNumber } from "./helpers";
import type { SimulationChartData } from "./types";

/**
 * Simulation Chart - What-if analysis with before/after comparison
 */
export function SimulationChart({ data }: { data: SimulationChartData }) {
  const { simulation, data: result } = data;

  if (!result) {
    return (
      <div className="rounded-lg border border-zinc-700 bg-zinc-900 p-4 text-center text-zinc-500">
        No data found for {simulation?.target_name || "the specified entity"}. Check the name spelling.
      </div>
    );
  }

  const isPositive = result.profit_change > 0;
  const changeDir = simulation?.change_amount && simulation.change_amount > 0 ? "increase" : "decrease";

  return (
    <div className="rounded-lg border border-zinc-700 bg-zinc-900 p-4">
      <div className="text-sm font-medium text-zinc-300 mb-2">
        Simulation: {result.target_name}
      </div>
      <div className="text-xs text-zinc-500 mb-4">
        {simulation?.change_variable} {changeDir} of ${Math.abs(simulation?.change_amount || 0)}/call
        {" • "}Based on {formatNumber(result.total_calls)} calls
      </div>

      <div className="grid grid-cols-2 gap-4 mb-4">
        <div className="bg-zinc-800 rounded-lg p-4">
          <div className="text-xs text-zinc-500 mb-1">Current Profit</div>
          <div className={cn(
            "text-xl font-semibold",
            result.current_profit >= 0 ? "text-emerald-400" : "text-red-400"
          )}>
            {formatCurrency(result.current_profit)}
          </div>
          <div className="text-xs text-zinc-500 mt-2">
            Revenue: {formatCurrency(result.current_revenue)}
          </div>
          <div className="text-xs text-zinc-500">
            Payout: {formatCurrency(result.current_payout)}
          </div>
        </div>
        <div className="bg-zinc-800 rounded-lg p-4">
          <div className="text-xs text-zinc-500 mb-1">Simulated Profit</div>
          <div className={cn(
            "text-xl font-semibold",
            result.simulated_profit >= 0 ? "text-emerald-400" : "text-red-400"
          )}>
            {formatCurrency(result.simulated_profit)}
          </div>
          <div className="text-xs text-zinc-500 mt-2">
            Revenue: {formatCurrency(result.simulated_revenue)}
          </div>
          <div className="text-xs text-zinc-500">
            Payout: {formatCurrency(result.simulated_payout)}
          </div>
        </div>
      </div>

      <div className={cn(
        "text-center py-3 rounded-lg font-medium",
        isPositive ? "bg-emerald-400/10 text-emerald-400" : "bg-red-400/10 text-red-400"
      )}>
        <span className="text-lg">
          {isPositive ? "+" : ""}{formatCurrency(result.profit_change)}
        </span>
        {result.profit_change_pct !== null && (
          <span className="text-sm ml-2">
            ({isPositive ? "+" : ""}{result.profit_change_pct.toFixed(1)}%)
          </span>
        )}
      </div>
    </div>
  );
}
