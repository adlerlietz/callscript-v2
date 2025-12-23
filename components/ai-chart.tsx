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

// Forecast Chart (Historical + Projected with dual lines)
interface ForecastDataPoint {
  date: string;
  actual_value: number | null;
  forecast_value: number | null;
  is_forecast: boolean;
}

interface ForecastChartData {
  success?: boolean;
  error?: boolean;
  message?: string;
  chart_type?: string;
  metric?: string;
  data?: ForecastDataPoint[];
  trend_summary?: {
    projected_change_pct: number;
    direction: "up" | "down" | "flat";
    last_actual: number;
    last_projected: number;
  };
  historical_days?: number;
  forecast_days?: number;
  _meta?: { tool: string; query: Record<string, unknown> };
}

function ForecastChart({ data }: { data: ForecastChartData }) {
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

// Negotiation Analysis Chart (Table format for actionable data)
interface NegotiationDataRow {
  entity_name: string;
  total_calls: number;
  revenue: number;
  payout: number;
  profit: number;
  margin_pct: number;
  rpc: number;
  action_tag: string;
  suggested_tactic: string;
}

interface NegotiationChartData {
  success?: boolean;
  error?: boolean;
  message?: string;
  chart_type?: string;
  partner_type?: "buyer" | "publisher";
  data?: NegotiationDataRow[];
  summary?: {
    total_partners: number;
    by_action_tag: Array<{ tag: string; count: number; total_profit: number }>;
  };
  _meta?: { tool: string; query: Record<string, unknown> };
}

function NegotiationChart({ data }: { data: NegotiationChartData }) {
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

// Simulation Chart (What-If Analysis with Before/After comparison)
interface SimulationResult {
  target_name: string;
  total_calls: number;
  current_revenue: number;
  current_payout: number;
  current_profit: number;
  simulated_revenue: number;
  simulated_payout: number;
  simulated_profit: number;
  profit_change: number;
  profit_change_pct: number | null;
  change_description: string;
}

interface SimulationChartData {
  success?: boolean;
  error?: boolean;
  message?: string;
  chart_type?: string;
  simulation?: {
    target_type: string;
    target_name: string;
    change_variable: string;
    change_amount: number;
  };
  data?: SimulationResult | null;
  data_notes?: string[];
  _meta?: { tool: string; query: Record<string, unknown> };
}

function SimulationChart({ data }: { data: SimulationChartData }) {
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

// Call Samples Chart (Proof Points - Table of actual calls)
interface CallSampleRow {
  call_id: string;
  start_time_utc: string;
  publisher_name: string;
  caller_masked: string;
  duration_seconds: number;
  revenue: number;
  payout: number;
  status_label: string;
  audio_url: string | null;
}

interface CallSamplesChartData {
  success?: boolean;
  error?: boolean;
  message?: string;
  chart_type?: string;
  data?: CallSampleRow[];
  count?: number;
  filters_applied?: Record<string, unknown>;
  data_notes?: string[];
  _meta?: { tool: string; query: Record<string, unknown> };
}

function CallSamplesChart({ data }: { data: CallSamplesChartData }) {
  const statusColors: Record<string, string> = {
    "Converted": "text-emerald-400",
    "Missed Opportunity": "text-yellow-400",
    "System Drop": "text-red-400",
    "Unconverted": "text-zinc-400",
  };

  if (!data.data || data.data.length === 0) {
    return (
      <div className="rounded-lg border border-zinc-700 bg-zinc-900 p-4 text-center text-zinc-500">
        No calls found matching the criteria
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-zinc-700 bg-zinc-900 p-4">
      <div className="text-sm font-medium text-zinc-300 mb-2">
        Call Samples ({data.count || data.data.length} calls)
      </div>
      {data.data_notes && data.data_notes.length > 0 && (
        <div className="text-xs text-zinc-500 mb-4">
          {data.data_notes.join(" • ")}
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-zinc-500 border-b border-zinc-700">
              <th className="text-left py-2 px-2">Time</th>
              <th className="text-left py-2 px-2">Caller</th>
              <th className="text-left py-2 px-2">Publisher</th>
              <th className="text-right py-2 px-2">Dur</th>
              <th className="text-right py-2 px-2">Revenue</th>
              <th className="text-left py-2 px-2">Status</th>
              <th className="text-center py-2 px-2">View</th>
            </tr>
          </thead>
          <tbody>
            {data.data.map((row, i) => (
              <tr key={i} className="border-b border-zinc-800 hover:bg-zinc-800/50">
                <td className="py-2 px-2 text-zinc-300">
                  {new Date(row.start_time_utc).toLocaleTimeString("en-US", {
                    hour: "numeric",
                    minute: "2-digit",
                  })}
                </td>
                <td className="py-2 px-2 text-zinc-400 font-mono text-xs">
                  {row.caller_masked}
                </td>
                <td className="py-2 px-2 text-zinc-100 max-w-[120px] truncate" title={row.publisher_name}>
                  {row.publisher_name}
                </td>
                <td className="py-2 px-2 text-right text-zinc-300">
                  {row.duration_seconds}s
                </td>
                <td className={cn(
                  "py-2 px-2 text-right",
                  row.revenue > 0 ? "text-emerald-400" : "text-zinc-400"
                )}>
                  ${row.revenue.toFixed(2)}
                </td>
                <td className={cn("py-2 px-2", statusColors[row.status_label] || "text-zinc-400")}>
                  {row.status_label}
                </td>
                <td className="py-2 px-2 text-center">
                  <a
                    href={`/calls/${row.call_id}`}
                    className="text-blue-400 hover:underline"
                  >
                    View
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
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
