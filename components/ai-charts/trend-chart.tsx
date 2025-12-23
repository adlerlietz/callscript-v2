"use client";

import {
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { getFormatter } from "./helpers";
import type { ChartData } from "./types";

/**
 * Trend Chart - Line or bar chart for time series data
 */
export function TrendChart({ data }: { data: ChartData }) {
  if (!data.data || data.data.length === 0) {
    return (
      <div className="rounded-lg border border-zinc-700 bg-zinc-900 p-4 text-center text-zinc-500">
        No data available for the selected period
      </div>
    );
  }

  const formatter = getFormatter(data.metric);
  const chartData = data.data.map((d) => ({
    date: d.date_bucket ? new Date(d.date_bucket).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "",
    value: d.value,
  }));

  const metricLabel = data.metric?.replace("_", " ").replace(/\b\w/g, (l) => l.toUpperCase()) || "Value";

  return (
    <div className="rounded-lg border border-zinc-700 bg-zinc-900 p-4">
      <div className="text-sm font-medium text-zinc-300 mb-4">
        {metricLabel} Trend
      </div>
      <div className="h-[180px] sm:h-[200px]">
        <ResponsiveContainer width="100%" height="100%">
          {data.chart_type === "bar" ? (
            <BarChart data={chartData}>
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
                formatter={(value: number) => [formatter(value), metricLabel]}
              />
              <Bar dataKey="value" fill="#10B981" radius={[4, 4, 0, 0]} />
            </BarChart>
          ) : (
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
                formatter={(value: number) => [formatter(value), metricLabel]}
              />
              <Line
                type="monotone"
                dataKey="value"
                stroke="#10B981"
                strokeWidth={2}
                dot={{ fill: "#10B981", strokeWidth: 2 }}
              />
            </LineChart>
          )}
        </ResponsiveContainer>
      </div>
    </div>
  );
}
