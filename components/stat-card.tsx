"use client";

import { cn } from "@/lib/utils";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";

interface StatCardProps {
  title: string;
  value: string | number;
  change?: number;
  changeLabel?: string;
  icon?: React.ReactNode;
  variant?: "default" | "success" | "warning" | "danger";
  size?: "default" | "large";
}

export function StatCard({
  title,
  value,
  change,
  changeLabel,
  icon,
  variant = "default",
  size = "default",
}: StatCardProps) {
  const variantStyles = {
    default: "border-zinc-800",
    success: "border-emerald-500/30 bg-emerald-500/5",
    warning: "border-amber-500/30 bg-amber-500/5",
    danger: "border-red-500/30 bg-red-500/5",
  };

  const valueStyles = {
    default: "text-zinc-100",
    success: "text-emerald-400",
    warning: "text-amber-400",
    danger: "text-red-400",
  };

  const getTrendIcon = () => {
    if (change === undefined || change === 0) {
      return <Minus className="h-3 w-3 text-zinc-500" />;
    }
    if (change > 0) {
      return <TrendingUp className="h-3 w-3 text-emerald-400" />;
    }
    return <TrendingDown className="h-3 w-3 text-red-400" />;
  };

  const getTrendColor = () => {
    if (change === undefined || change === 0) return "text-zinc-500";
    return change > 0 ? "text-emerald-400" : "text-red-400";
  };

  return (
    <div
      className={cn(
        "rounded-lg border bg-zinc-900 p-4",
        variantStyles[variant],
        size === "large" && "p-6"
      )}
    >
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-medium text-zinc-500 uppercase tracking-wider">
          {title}
        </span>
        {icon && <span className="text-zinc-500">{icon}</span>}
      </div>

      <div className={cn(
        "font-bold font-mono",
        valueStyles[variant],
        size === "large" ? "text-4xl" : "text-2xl"
      )}>
        {value}
      </div>

      {(change !== undefined || changeLabel) && (
        <div className="flex items-center gap-1 mt-2">
          {change !== undefined && (
            <>
              {getTrendIcon()}
              <span className={cn("text-xs font-medium", getTrendColor())}>
                {change > 0 ? "+" : ""}{change}%
              </span>
            </>
          )}
          {changeLabel && (
            <span className="text-xs text-zinc-500 ml-1">{changeLabel}</span>
          )}
        </div>
      )}
    </div>
  );
}

interface QueueStatusProps {
  pending: number;
  downloaded: number;
  processing: number;
  transcribed: number;
  health: "healthy" | "busy" | "backlogged";
}

export function QueueStatus({ pending, downloaded, processing, transcribed, health }: QueueStatusProps) {
  const total = pending + downloaded + processing + transcribed;

  const healthConfig = {
    healthy: { color: "bg-emerald-500", label: "Healthy", textColor: "text-emerald-400" },
    busy: { color: "bg-amber-500", label: "Busy", textColor: "text-amber-400" },
    backlogged: { color: "bg-red-500", label: "Backlogged", textColor: "text-red-400" },
  };

  const { color, label, textColor } = healthConfig[health];

  // Calculate segment widths
  const segments = [
    { count: pending, color: "bg-zinc-600", label: "Pending" },
    { count: downloaded, color: "bg-blue-500", label: "Downloaded" },
    { count: processing, color: "bg-amber-500", label: "Processing" },
    { count: transcribed, color: "bg-emerald-500", label: "Transcribed" },
  ];

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4">
      <div className="flex items-center justify-between mb-4">
        <span className="text-xs font-medium text-zinc-500 uppercase tracking-wider">
          Processing Queue
        </span>
        <div className="flex items-center gap-2">
          <div className={cn("h-2 w-2 rounded-full", color, health === "healthy" && "animate-pulse")} />
          <span className={cn("text-xs font-medium", textColor)}>{label}</span>
        </div>
      </div>

      {/* Progress bar */}
      <div className="h-3 bg-zinc-800 rounded-full overflow-hidden flex mb-4">
        {total > 0 ? (
          segments.map((seg, i) => (
            seg.count > 0 && (
              <div
                key={i}
                className={cn("h-full", seg.color)}
                style={{ width: `${(seg.count / total) * 100}%` }}
              />
            )
          ))
        ) : (
          <div className="h-full w-full bg-emerald-500/20" />
        )}
      </div>

      {/* Legend */}
      <div className="grid grid-cols-4 gap-2">
        {segments.map((seg, i) => (
          <div key={i} className="text-center">
            <div className="text-lg font-bold text-zinc-100">{seg.count}</div>
            <div className="text-xs text-zinc-500">{seg.label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
