"use client";

import { KPISummaryCard } from "./kpi-summary";
import { TrendChart } from "./trend-chart";
import { LeaderboardChart } from "./leaderboard";
import { ForecastChart } from "./forecast";
import { NegotiationChart } from "./negotiation";
import { SimulationChart } from "./simulation";
import { CallSamplesChart } from "./call-samples";
import type {
  ChartData,
  ForecastChartData,
  NegotiationChartData,
  SimulationChartData,
  CallSamplesChartData
} from "./types";

interface AIChartProps {
  data: Record<string, unknown>;
}

/**
 * AIChart - Main component that routes to specific chart types
 */
export function AIChart({ data }: AIChartProps) {
  const chartData = data as ChartData;

  // Handle error responses
  if (chartData.error) {
    return (
      <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-red-400">
        {chartData.message || "An error occurred"}
      </div>
    );
  }

  // Determine chart type based on tool response
  const tool = chartData._meta?.tool;

  switch (tool) {
    case "get_kpi_summary":
      return <KPISummaryCard data={chartData} />;
    case "get_trend_data":
      return <TrendChart data={chartData} />;
    case "get_leaderboard":
      return <LeaderboardChart data={chartData} />;
    case "analyze_breakdown":
      return <LeaderboardChart data={chartData} />;
    case "generate_forecast":
      return <ForecastChart data={chartData as ForecastChartData} />;
    case "analyze_negotiation_opportunities":
      return <NegotiationChart data={chartData as unknown as NegotiationChartData} />;
    case "simulate_financial_change":
      return <SimulationChart data={chartData as unknown as SimulationChartData} />;
    case "get_call_samples":
      return <CallSamplesChart data={chartData as unknown as CallSamplesChartData} />;
    default:
      // If no specific tool, try to render based on data structure
      if (chartData.metrics) {
        return <KPISummaryCard data={chartData} />;
      }
      if (chartData.data && chartData.data[0]?.date_bucket) {
        return <TrendChart data={chartData} />;
      }
      if (chartData.data && chartData.data[0]?.name) {
        return <LeaderboardChart data={chartData} />;
      }
      return null;
  }
}

// Re-export types for consumers
export type {
  ChartData,
  ForecastChartData,
  NegotiationChartData,
  SimulationChartData,
  CallSamplesChartData,
} from "./types";

// Re-export individual charts for direct use
export { KPISummaryCard } from "./kpi-summary";
export { TrendChart } from "./trend-chart";
export { LeaderboardChart } from "./leaderboard";
export { ForecastChart } from "./forecast";
export { NegotiationChart } from "./negotiation";
export { SimulationChart } from "./simulation";
export { CallSamplesChart } from "./call-samples";

// Default export
export default AIChart;
