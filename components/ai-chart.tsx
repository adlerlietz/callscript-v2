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
  Legend,
} from "recharts";
import { cn } from "@/lib/utils";

interface ChartData {
  success?: boolean;
  error?: boolean;
  message?: string;
  chart_type?: "line" | "bar" | "area";
  metric?: string;
  dimension?: string;
  data?: Array<{
    date_bucket?: string;
    name?: string;
    value: number;
    total_calls?: number;
  }>;
  period?: { start: string; end: string };
  metrics?: {
    total_calls: number;
    revenue: number;
    payout: number;
    profit: number;
    margin_pct: number;
    flag_rate_pct: number;
    rpc: number;
  };
  definitions?: Record<string, string>;
  _meta?: { tool: string; query: Record<string, unknown> };
}

interface AIChartProps {
  data: Record<string, unknown>;
}

// Format currency
function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

// Format percentage
function formatPercent(value: number): string {
  return `${value.toFixed(1)}%`;
}

// Format number
function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}

// Get formatter based on metric type
function getFormatter(metric?: string): (value: number) => string {
  switch (metric) {
    case "revenue":
    case "profit":
    case "payout":
      return formatCurrency;
    case "flag_rate":
    case "margin_pct":
      return formatPercent;
    default:
      return formatNumber;
  }
}

// KPI Summary Card
function KPISummaryCard({ data }: { data: ChartData }) {
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

// Trend Chart (Line/Bar)
function TrendChart({ data }: { data: ChartData }) {
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
      <ResponsiveContainer width="100%" height={200}>
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
  );
}

// Leaderboard Chart
function LeaderboardChart({ data }: { data: ChartData }) {
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
      <ResponsiveContainer width="100%" height={250}>
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
  );
}

// Main AIChart component
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
