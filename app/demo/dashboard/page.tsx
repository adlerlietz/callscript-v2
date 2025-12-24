"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import {
  RefreshCw,
  Phone,
  AlertTriangle,
  CheckCircle,
  DollarSign,
  Activity,
  ArrowRight,
  Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatCard, QueueStatus } from "@/components/stat-card";
import { cn } from "@/lib/utils";

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
  ringbaConfigured: boolean;
  timestamp: string;
  isDemo?: boolean;
}

export default function DemoDashboardPage() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const fetchStats = useCallback(async (showRefresh = false) => {
    if (showRefresh) setRefreshing(true);

    try {
      // Use demo API endpoint
      const res = await fetch("/api/demo/stats");

      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const statsData = await res.json();
      setStats(statsData);

      setLastUpdated(new Date());
      setError(null);
    } catch (err) {
      console.error("Failed to fetch demo stats:", err);
      setError("Failed to load demo data");
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
            <div
              key={i}
              className="h-32 bg-zinc-900 rounded-lg border border-zinc-800 animate-pulse"
            />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8 bg-[#09090b] min-h-screen">
      {/* Header */}
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-zinc-100">
            Command Center
          </h1>
          <p className="text-sm text-zinc-500">
            {lastUpdated && (
              <>
                Last updated: {lastUpdated.toLocaleTimeString()}
                <span className="ml-2 text-amber-400">Demo Data</span>
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
              variant={
                stats.today.flagRate > 30
                  ? "danger"
                  : stats.today.flagRate > 20
                  ? "warning"
                  : "default"
              }
              size="large"
            />
            <StatCard
              title="Revenue at Risk"
              value={`$${stats.revenueAtRisk.toLocaleString()}`}
              icon={<DollarSign className="h-4 w-4" />}
              variant={
                stats.revenueAtRisk > 1000
                  ? "danger"
                  : stats.revenueAtRisk > 500
                  ? "warning"
                  : "default"
              }
              size="large"
            />
            <StatCard
              title="Queue Size"
              value={stats.queue.total.toString()}
              icon={<Activity className="h-4 w-4" />}
              variant={
                stats.queue.health === "backlogged"
                  ? "danger"
                  : stats.queue.health === "busy"
                  ? "warning"
                  : "success"
              }
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
                  href="/demo/flags"
                  className="flex items-center justify-between p-3 rounded-lg bg-zinc-800 hover:bg-zinc-700 transition-colors"
                >
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4 text-red-400" />
                    <span className="text-sm text-zinc-300">
                      Review Flagged Calls
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold text-red-400">
                      {stats.totals.flagged}
                    </span>
                    <ArrowRight className="h-4 w-4 text-zinc-500" />
                  </div>
                </Link>
                <Link
                  href="/demo/calls"
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

          {/* System Health - Always show healthy for demo */}
          <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="h-3 w-3 rounded-full bg-emerald-500 animate-pulse" />
                <span className="text-sm font-medium text-zinc-300">
                  Pipeline Status: All Systems Operational
                </span>
              </div>
              <div className="flex items-center gap-2">
                <Zap className="h-4 w-4 text-emerald-400" />
                <span className="text-xs text-zinc-500">Demo Mode</span>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
