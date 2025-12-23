"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import { getFormatter, formatNumber } from "./helpers";
import type { ChartData } from "./types";

/**
 * Leaderboard Chart - Horizontal bar chart for rankings
 */
export function LeaderboardChart({ data }: { data: ChartData }) {
  if (!data.data || data.data.length === 0) {
    return (
      <div className="rounded-lg border border-zinc-700 bg-zinc-900 p-4 text-center text-zinc-500">
        No data available for the selected period
      </div>
    );
  }

  const formatter = getFormatter(data.metric);
  const dimensionLabel = data.dimension?.replace(/\b\w/g, (l) => l.toUpperCase()) || "Name";
  const metricLabel = data.metric?.replace("_", " ").replace(/\b\w/g, (l) => l.toUpperCase()) || "Value";

  const chartData = data.data.slice(0, 10).map((d) => ({
    name: d.name?.length && d.name.length > 15 ? `${d.name.substring(0, 15)}...` : d.name,
    fullName: d.name,
    value: d.value,
    calls: d.total_calls,
  }));

  return (
    <div className="rounded-lg border border-zinc-700 bg-zinc-900 p-4">
      <div className="text-sm font-medium text-zinc-300 mb-4">
        Top {dimensionLabel}s by {metricLabel}
      </div>
      <div className="h-[220px] sm:h-[250px]">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} layout="vertical">
            <CartesianGrid strokeDasharray="3 3" stroke="#374151" horizontal={false} />
            <XAxis
              type="number"
              tick={{ fill: "#9CA3AF", fontSize: 10 }}
              stroke="#374151"
              tickFormatter={formatter}
            />
            <YAxis
              type="category"
              dataKey="name"
              tick={{ fill: "#9CA3AF", fontSize: 10 }}
              stroke="#374151"
              width={100}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: "#18181b",
                border: "1px solid #374151",
                borderRadius: "8px",
              }}
              labelStyle={{ color: "#E5E7EB" }}
              formatter={(value: number, _name: string, props: { payload?: { calls?: number } }) => [
                `${formatter(value)} (${formatNumber(props.payload?.calls || 0)} calls)`,
                metricLabel,
              ]}
              labelFormatter={(label) => chartData.find((d) => d.name === label)?.fullName || label}
            />
            <Legend />
            <Bar dataKey="value" name={metricLabel} fill="#10B981" radius={[0, 4, 4, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
