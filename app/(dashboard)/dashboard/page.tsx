"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import {
  RefreshCw, Phone, AlertTriangle, CheckCircle,
  DollarSign, Activity, ArrowRight, Zap, Clock
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatCard, QueueStatus } from "@/components/stat-card";
import { cn } from "@/lib/utils";

interface HealthData {
  status: "healthy" | "degraded" | "unhealthy";
  latency_ms: number;
  metrics: {
    stuck_jobs: number;
    throughput_1h: number;
    recent_activity: number;
  };
  warnings?: string[];
}

interface DashboardStats {
  today: {
    total: number;
    flagged: number;
    safe: number;
    flagRate: number;
  };
  changes: {
    volume: number;
    flagRate: number;
  };
  totals: {
    flagged: number;
    safe: number;
    reviewed: number;
  };
  queue: {
    pending: number;
    downloaded: number;
    processing: number;
    transcribed: number;
    total: number;
    health: "healthy" | "busy" | "backlogged";
  };
  revenueAtRisk: number;
  systemHealth: string;
  timestamp: string;
}

export default function DashboardPage() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [health, setHealth] = useState<HealthData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const fetchStats = useCallback(async (showRefresh = false) => {
    if (showRefresh) setRefreshing(true);

    try {
      // Fetch both stats and health in parallel
      const [statsRes, healthRes] = await Promise.all([
        fetch("/api/dashboard/stats"),
        fetch("/api/health"),
      ]);

      if (!statsRes.ok) throw new Error(`HTTP ${statsRes.status}`);
      const statsData = await statsRes.json();
      setStats(statsData);

      if (healthRes.ok) {
        const healthData = await healthRes.json();
        setHealth(healthData);
      }

      setLastUpdated(new Date());
      setError(null);
    } catch (err) {
      console.error("Failed to fetch stats:", err);
      setError("Failed to load dashboard data");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchStats();

    // Poll every 30 seconds
    const interval = setInterval(() => fetchStats(), 30000);
    return () => clearInterval(interval);
  }, [fetchStats]);

  if (loading) {
    return (
      <div className="p-8">
        <div className="mb-8">
          <div className="h-8 w-48 bg-zinc-800 rounded animate-pulse mb-2" />
          <div className="h-4 w-32 bg-zinc-800 rounded animate-pulse" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-32 bg-zinc-900 rounded-lg border border-zinc-800 animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="p-8 bg-[#09090b] min-h-screen">
      {/* Header */}
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-zinc-100">Command Center</h1>
          <p className="text-sm text-zinc-500">
            {lastUpdated && (
              <>
                Last updated: {lastUpdated.toLocaleTimeString()}
                <span className="ml-2 text-emerald-500">● Live</span>
              </>
            )}
          </p>
        </div>
        <Button
          variant="outline"
          size="icon"
          onClick={() => fetchStats(true)}
          disabled={refreshing}
        >
          <RefreshCw className={cn("h-4 w-4", refreshing && "animate-spin")} />
        </Button>
      </div>

      {/* Error Banner */}
      {error && (
        <div className="mb-6 p-4 rounded-lg bg-red-500/10 border border-red-500/30">
          <p className="text-sm text-red-400">{error}</p>
        </div>
      )}

      {stats && (
        <>
          {/* Primary Stats */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
            <StatCard
              title="Today's Calls"
              value={stats.today.total.toLocaleString()}
              change={stats.changes.volume}
              changeLabel="vs yesterday"
              icon={<Phone className="h-4 w-4" />}
              size="large"
            />
            <StatCard
              title="Flag Rate"
              value={`${stats.today.flagRate}%`}
              change={stats.changes.flagRate}
              changeLabel="vs yesterday"
              icon={<AlertTriangle className="h-4 w-4" />}
              variant={stats.today.flagRate > 30 ? "danger" : stats.today.flagRate > 20 ? "warning" : "default"}
              size="large"
            />
            <StatCard
              title="Revenue at Risk"
              value={`$${stats.revenueAtRisk.toLocaleString()}`}
              icon={<DollarSign className="h-4 w-4" />}
              variant={stats.revenueAtRisk > 1000 ? "danger" : stats.revenueAtRisk > 500 ? "warning" : "default"}
              size="large"
            />
            <StatCard
              title="Queue Size"
              value={stats.queue.total.toString()}
              icon={<Activity className="h-4 w-4" />}
              variant={stats.queue.health === "backlogged" ? "danger" : stats.queue.health === "busy" ? "warning" : "success"}
              changeLabel={stats.queue.health}
              size="large"
            />
          </div>

          {/* Queue Status */}
          <div className="mb-8">
            <QueueStatus
              pending={stats.queue.pending}
              downloaded={stats.queue.downloaded}
              processing={stats.queue.processing}
              transcribed={stats.queue.transcribed}
              health={stats.queue.health}
            />
          </div>

          {/* Secondary Stats Row */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
            {/* Today's Breakdown */}
            <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4">
              <h3 className="text-xs font-medium text-zinc-500 uppercase tracking-wider mb-4">
                Today&apos;s Results
              </h3>
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4 text-red-400" />
                    <span className="text-sm text-zinc-300">Flagged</span>
                  </div>
                  <span className="text-lg font-bold text-red-400">
                    {stats.today.flagged}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <CheckCircle className="h-4 w-4 text-emerald-400" />
                    <span className="text-sm text-zinc-300">Safe</span>
                  </div>
                  <span className="text-lg font-bold text-emerald-400">
                    {stats.today.safe}
                  </span>
                </div>
              </div>
            </div>

            {/* Overall Totals */}
            <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4">
              <h3 className="text-xs font-medium text-zinc-500 uppercase tracking-wider mb-4">
                All Time
              </h3>
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-zinc-500">Total Reviewed</span>
                  <span className="text-lg font-bold text-zinc-100">
                    {stats.totals.reviewed.toLocaleString()}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-zinc-500">Total Flagged</span>
                  <span className="text-lg font-bold text-red-400">
                    {stats.totals.flagged.toLocaleString()}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-zinc-500">Total Safe</span>
                  <span className="text-lg font-bold text-emerald-400">
                    {stats.totals.safe.toLocaleString()}
                  </span>
                </div>
              </div>
            </div>

            {/* Quick Actions */}
            <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4">
              <h3 className="text-xs font-medium text-zinc-500 uppercase tracking-wider mb-4">
                Quick Actions
              </h3>
              <div className="space-y-2">
                <Link
                  href="/flags"
                  className="flex items-center justify-between p-3 rounded-lg bg-zinc-800 hover:bg-zinc-700 transition-colors"
                >
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4 text-red-400" />
                    <span className="text-sm text-zinc-300">Review Flagged Calls</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold text-red-400">
                      {stats.totals.flagged}
                    </span>
                    <ArrowRight className="h-4 w-4 text-zinc-500" />
                  </div>
                </Link>
                <Link
                  href="/calls"
                  className="flex items-center justify-between p-3 rounded-lg bg-zinc-800 hover:bg-zinc-700 transition-colors"
                >
                  <div className="flex items-center gap-2">
                    <Phone className="h-4 w-4 text-zinc-400" />
                    <span className="text-sm text-zinc-300">View All Calls</span>
                  </div>
                  <ArrowRight className="h-4 w-4 text-zinc-500" />
                </Link>
              </div>
            </div>
          </div>

          {/* System Health */}
          <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <div className={cn(
                  "h-3 w-3 rounded-full",
                  health?.status === "healthy" ? "bg-emerald-500 animate-pulse" :
                  health?.status === "degraded" ? "bg-yellow-500 animate-pulse" : "bg-red-500"
                )} />
                <span className="text-sm font-medium text-zinc-300">
                  Pipeline Status: {
                    health?.status === "healthy" ? "All Systems Operational" :
                    health?.status === "degraded" ? "Degraded Performance" : "Issues Detected"
                  }
                </span>
              </div>
              <span className="text-xs text-zinc-500">
                Latency: {health?.latency_ms || 0}ms
              </span>
            </div>

            {/* Health Metrics */}
            {health && (
              <div className="grid grid-cols-3 gap-4 pt-3 border-t border-zinc-800">
                <div className="flex items-center gap-2">
                  <Zap className="h-4 w-4 text-emerald-400" />
                  <div>
                    <p className="text-xs text-zinc-500">Throughput (1h)</p>
                    <p className="text-sm font-medium text-zinc-200">{health.metrics.throughput_1h} calls</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Clock className="h-4 w-4 text-yellow-400" />
                  <div>
                    <p className="text-xs text-zinc-500">Stuck Jobs</p>
                    <p className={cn(
                      "text-sm font-medium",
                      health.metrics.stuck_jobs > 0 ? "text-yellow-400" : "text-zinc-200"
                    )}>
                      {health.metrics.stuck_jobs}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Activity className="h-4 w-4 text-blue-400" />
                  <div>
                    <p className="text-xs text-zinc-500">Recent Activity</p>
                    <p className="text-sm font-medium text-zinc-200">{health.metrics.recent_activity} events</p>
                  </div>
                </div>
              </div>
            )}

            {/* Warnings */}
            {health?.warnings && health.warnings.length > 0 && (
              <div className="mt-3 pt-3 border-t border-zinc-800">
                {health.warnings.map((warning, i) => (
                  <div key={i} className="flex items-center gap-2 text-yellow-400">
                    <AlertTriangle className="h-3 w-3" />
                    <span className="text-xs">{warning}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
