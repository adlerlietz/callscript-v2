"use client";

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import { cn } from "@/lib/utils";
import { getFormatter } from "./helpers";
import type { ForecastChartData } from "./types";

/**
 * Forecast Chart - Historical + projected data with dual lines
 */
export function ForecastChart({ data }: { data: ForecastChartData }) {
  if (!data.data || data.data.length === 0) {
    return (
      <div className="rounded-lg border border-zinc-700 bg-zinc-900 p-4 text-center text-zinc-500">
        Not enough historical data to generate a forecast (need at least 2 days)
      </div>
    );
  }

  const formatter = getFormatter(data.metric);
  const metricLabel = data.metric?.replace("_", " ").replace(/\b\w/g, (l) => l.toUpperCase()) || "Value";

  const chartData = data.data.map((d) => ({
    date: new Date(d.date).toLocaleDateString("en-US", { month: "short", day: "numeric" }),
    actual: d.actual_value,
    forecast: d.forecast_value,
    isForecast: d.is_forecast,
  }));

  // Trend indicator
  const trend = data.trend_summary;
  const trendIcon = trend?.direction === "up" ? "↑" : trend?.direction === "down" ? "↓" : "→";
  const trendColor = trend?.direction === "up" ? "text-emerald-400" : trend?.direction === "down" ? "text-red-400" : "text-zinc-400";

  return (
    <div className="rounded-lg border border-zinc-700 bg-zinc-900 p-4">
      <div className="flex items-center justify-between mb-4">
        <div className="text-sm font-medium text-zinc-300">
          {metricLabel} Forecast
        </div>
        {trend && (
          <div className={cn("text-sm font-medium", trendColor)}>
            {trendIcon} {Math.abs(trend.projected_change_pct)}% {trend.direction}
          </div>
        )}
      </div>
      <div className="h-[190px] sm:h-[220px]">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
            <XAxis
              dataKey="date"
              tick={{ fill: "#9CA3AF", fontSize: 10 }}
              stroke="#374151"
            />
            <YAxis
              tick={{ fill: "#9CA3AF", fontSize: 10 }}
              stroke="#374151"
              tickFormatter={formatter}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: "#18181b",
                border: "1px solid #374151",
                borderRadius: "8px",
              }}
              labelStyle={{ color: "#E5E7EB" }}
              formatter={(value: number, name: string) => {
                if (value === null || value === undefined) return ["-", name];
                return [formatter(value), name === "actual" ? "Actual" : "Forecast"];
              }}
            />
            <Legend />
            {/* Solid green line for actual data */}
            <Line
              type="monotone"
              dataKey="actual"
              name="Actual"
              stroke="#10B981"
              strokeWidth={2}
              dot={{ fill: "#10B981", strokeWidth: 2, r: 3 }}
              connectNulls={false}
            />
            {/* Dashed gray line for forecast */}
            <Line
              type="monotone"
              dataKey="forecast"
              name="Forecast"
              stroke="#6B7280"
              strokeWidth={2}
              strokeDasharray="5 5"
              dot={{ fill: "#6B7280", strokeWidth: 2, r: 3 }}
              connectNulls={true}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <div className="text-xs text-zinc-500 mt-2">
        Based on {data.historical_days || 0} days of historical data • {data.forecast_days || 0} day projection
      </div>
    </div>
  );
}
