"use client";

import { useEffect, useState } from "react";
import { Activity, AlertTriangle, DollarSign, Phone, Zap, RefreshCw } from "lucide-react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  ResponsiveContainer,
  Tooltip,
} from "recharts";
import { Badge } from "@/components/ui/badge";
import { formatCurrency, formatNumber, truncateId } from "@/lib/utils";

interface Stats {
  totalCalls: number;
  todayCalls: number;
  flaggedCalls: number;
  safeCalls: number;
  flagRate: number;
  revenueRecovered: number;
  systemHealth: string;
}

interface ChartDataPoint {
  date: string;
  calls: number;
  flags: number;
}

interface LiveFeedCall {
  id: string;
  start_time_utc: string;
  status: string;
  campaign_id: string | null;
}

function KPICard({
  title,
  value,
  subtitle,
  icon: Icon,
  variant = "default",
  loading = false,
}: {
  title: string;
  value: string | number;
  subtitle?: string;
  icon: React.ElementType;
  variant?: "default" | "danger" | "success";
  loading?: boolean;
}) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-6">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-zinc-400">{title}</span>
        <Icon className="h-4 w-4 text-zinc-500" />
      </div>
      <div className="mt-2">
        {loading ? (
          <div className="h-9 w-24 animate-pulse rounded bg-zinc-800" />
        ) : (
          <span
            className={`text-3xl font-semibold ${
              variant === "danger"
                ? "text-red-400"
                : variant === "success"
                ? "text-emerald-400"
                : "text-zinc-100"
            }`}
          >
            {value}
          </span>
        )}
      </div>
      {subtitle && <p className="mt-1 text-xs text-zinc-500">{subtitle}</p>}
    </div>
  );
}

function LiveFeedItem({
  id,
  time,
  status,
}: {
  id: string;
  time: string;
  status: string;
}) {
  return (
    <div className="flex items-center gap-3 rounded-md px-3 py-2 hover:bg-zinc-800/50">
      <span className="font-mono text-xs text-zinc-500">{time}</span>
      <span className="font-mono text-xs text-zinc-400">{truncateId(id)}</span>
      <Badge variant={status === "flagged" ? "danger" : status === "safe" ? "success" : "default"}>
        {status}
      </Badge>
    </div>
  );
}

export default function DashboardPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [chartData, setChartData] = useState<ChartDataPoint[]>([]);
  const [liveFeed, setLiveFeed] = useState<LiveFeedCall[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchData = async (showRefresh = false) => {
    if (showRefresh) setRefreshing(true);

    try {
      const [statsRes, chartRes, feedRes] = await Promise.all([
        fetch("/api/stats"),
        fetch("/api/stats/chart?days=7"),
        fetch("/api/calls?limit=10"),
      ]);

      if (statsRes.ok) {
        const statsData = await statsRes.json();
        setStats(statsData);
      }

      if (chartRes.ok) {
        const chartJson = await chartRes.json();
        setChartData(chartJson.chartData || []);
      }

      if (feedRes.ok) {
        const feedJson = await feedRes.json();
        setLiveFeed(feedJson.calls || []);
      }
    } catch (error) {
      console.error("Failed to fetch dashboard data:", error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchData();
    const interval = setInterval(() => fetchData(), 30000); // Refresh every 30s
    return () => clearInterval(interval);
  }, []);

  const formatTime = (isoString: string) => {
    const date = new Date(isoString);
    return date.toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
  };

  return (
    <div className="p-8">
      {/* Header */}
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-zinc-100">Command Center</h1>
          <p className="text-sm text-zinc-500">Real-time system overview</p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => fetchData(true)}
            disabled={refreshing}
            className="flex items-center gap-2 rounded-md bg-zinc-800/50 px-3 py-1.5 text-xs font-medium text-zinc-300 hover:bg-zinc-700/50 disabled:opacity-50"
          >
            <RefreshCw className={`h-3 w-3 ${refreshing ? "animate-spin" : ""}`} />
            Refresh
          </button>
          <div className="flex items-center gap-2 rounded-md bg-zinc-800/50 px-3 py-1.5">
            <div className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
            <span className="text-xs font-medium text-zinc-300">Live</span>
          </div>
        </div>
      </div>

      {/* KPI Grid */}
      <div className="mb-8 grid grid-cols-4 gap-4">
        <KPICard
          title="Volume"
          value={formatNumber(stats?.todayCalls ?? 0)}
          subtitle="Total calls today"
          icon={Phone}
          loading={loading}
        />
        <KPICard
          title="Flag Rate"
          value={`${stats?.flagRate ?? 0}%`}
          subtitle="Risk level"
          icon={AlertTriangle}
          variant={(stats?.flagRate ?? 0) > 5 ? "danger" : "default"}
          loading={loading}
        />
        <KPICard
          title="Est. Savings"
          value={formatCurrency(stats?.revenueRecovered ?? 0)}
          subtitle="Blocked spend"
          icon={DollarSign}
          variant="success"
          loading={loading}
        />
        <KPICard
          title="System Health"
          value={stats?.systemHealth === "healthy" ? "Operational" : "Degraded"}
          subtitle={`${stats?.flaggedCalls ?? 0} pending review`}
          icon={Zap}
          variant={stats?.systemHealth === "healthy" ? "success" : "danger"}
          loading={loading}
        />
      </div>

      {/* Main Content Grid */}
      <div className="grid grid-cols-3 gap-6">
        {/* Chart */}
        <div className="col-span-2 rounded-lg border border-zinc-800 bg-zinc-900 p-6">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-sm font-medium text-zinc-400">Traffic Overview (7 days)</h2>
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                <div className="h-2 w-2 rounded-full bg-zinc-500" />
                <span className="text-xs text-zinc-500">Calls</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="h-2 w-2 rounded-full bg-red-500" />
                <span className="text-xs text-zinc-500">Flags</span>
              </div>
            </div>
          </div>
          <div className="h-64">
            {loading ? (
              <div className="flex h-full items-center justify-center">
                <div className="h-8 w-8 animate-spin rounded-full border-2 border-zinc-700 border-t-zinc-400" />
              </div>
            ) : chartData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData}>
                  <defs>
                    <linearGradient id="traffic" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#71717a" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#71717a" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="flags" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#ef4444" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <XAxis
                    dataKey="date"
                    axisLine={false}
                    tickLine={false}
                    tick={{ fill: "#71717a", fontSize: 11 }}
                    tickFormatter={(value) => new Date(value).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                  />
                  <YAxis hide />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "#18181b",
                      border: "1px solid #27272a",
                      borderRadius: "6px",
                      fontSize: "12px",
                    }}
                    labelStyle={{ color: "#a1a1aa" }}
                    labelFormatter={(value) => new Date(value).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}
                  />
                  <Area
                    type="monotone"
                    dataKey="calls"
                    stroke="#71717a"
                    fill="url(#traffic)"
                    strokeWidth={2}
                  />
                  <Area
                    type="monotone"
                    dataKey="flags"
                    stroke="#ef4444"
                    fill="url(#flags)"
                    strokeWidth={2}
                  />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-zinc-500">
                No data available
              </div>
            )}
          </div>
        </div>

        {/* Live Feed */}
        <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-6">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-sm font-medium text-zinc-400">Recent Calls</h2>
            <Activity className="h-4 w-4 text-zinc-500" />
          </div>
          <div className="space-y-1">
            {loading ? (
              <div className="space-y-2">
                {[...Array(7)].map((_, i) => (
                  <div key={i} className="h-8 animate-pulse rounded bg-zinc-800" />
                ))}
              </div>
            ) : liveFeed.length > 0 ? (
              liveFeed.map((call) => (
                <LiveFeedItem
                  key={call.id}
                  id={call.id}
                  time={formatTime(call.start_time_utc)}
                  status={call.status}
                />
              ))
            ) : (
              <p className="text-sm text-zinc-500">No recent calls</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
