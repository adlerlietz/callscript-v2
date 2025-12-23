"use client";

import { cn } from "@/lib/utils";
import type { CallSamplesChartData } from "./types";

/**
 * Call Samples Chart - Table of actual call records
 */
export function CallSamplesChart({ data }: { data: CallSamplesChartData }) {
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
