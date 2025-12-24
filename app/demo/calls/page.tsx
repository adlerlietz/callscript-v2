"use client";

import { useState, useEffect, useCallback } from "react";
import { Search, RefreshCw, Clock, User, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { cn, formatSourceName } from "@/lib/utils";

type Call = {
  id: string;
  ringba_call_id: string;
  campaign_id: string | null;
  start_time_utc: string;
  caller_number: string | null;
  duration_seconds: number | null;
  revenue: number | null;
  status: string;
  transcript_text: string | null;
  qa_flags: QaFlags | null;
  publisher_id: string | null;
  publisher_name: string | null;
  buyer_name: string | null;
  caller_state: string | null;
};

type QaFlags = {
  score?: number;
  summary?: string;
};

function formatDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined) return "—";
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

function formatDate(isoString: string): string {
  const date = new Date(isoString);
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function StatusBadge({ status }: { status: string }) {
  const config: Record<
    string,
    { variant: "default" | "success" | "danger" | "warning" | "info"; label: string }
  > = {
    pending: { variant: "warning", label: "Pending" },
    downloaded: { variant: "default", label: "Downloaded" },
    processing: { variant: "info", label: "Processing" },
    transcribed: { variant: "default", label: "Transcribed" },
    flagged: { variant: "danger", label: "Flagged" },
    safe: { variant: "success", label: "Safe" },
    failed: { variant: "danger", label: "Failed" },
  };
  const { variant, label } = config[status] || { variant: "default", label: status };
  return <Badge variant={variant}>{label}</Badge>;
}

function ScoreIndicator({ score }: { score: number | null }) {
  if (score === null) return <span className="text-zinc-500 font-mono">—</span>;
  const color =
    score >= 70
      ? "text-emerald-400"
      : score >= 40
      ? "text-amber-400"
      : "text-red-400";
  return <span className={cn("font-mono font-medium", color)}>{score}</span>;
}

/**
 * Demo Calls Page
 * Uses /api/demo/calls endpoint with demo org data.
 * Read-only - no status changes allowed.
 */
export default function DemoCallsPage() {
  const [calls, setCalls] = useState<Call[]>([]);
  const [selectedCall, setSelectedCall] = useState<Call | null>(null);
  const [filter, setFilter] = useState<"all" | "flagged" | "safe" | "processing">(
    "all"
  );
  const [searchQuery, setSearchQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchCalls = useCallback(
    async (showRefresh = false) => {
      if (showRefresh) setRefreshing(true);

      try {
        const params = new URLSearchParams();
        params.set("limit", "50");

        if (filter === "flagged") {
          params.set("status", "flagged");
        } else if (filter === "safe") {
          params.set("status", "safe");
        }

        // Use demo API endpoint
        const res = await fetch(`/api/demo/calls?${params}`);

        if (res.ok) {
          const data = await res.json();
          let callsList = (data.calls as Call[]) || [];

          if (filter === "processing") {
            callsList = callsList.filter((c) =>
              ["pending", "downloaded", "processing"].includes(c.status)
            );
          }

          setCalls(callsList);
        }
      } catch (error) {
        console.error("Failed to fetch demo calls:", error);
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [filter]
  );

  useEffect(() => {
    fetchCalls();
  }, [fetchCalls]);

  const filteredCalls = calls.filter((call) => {
    if (!searchQuery) return true;
    const query = searchQuery.toLowerCase();
    return (
      call.transcript_text?.toLowerCase().includes(query) ||
      call.caller_number?.toLowerCase().includes(query) ||
      call.ringba_call_id?.toLowerCase().includes(query) ||
      call.publisher_id?.toLowerCase().includes(query)
    );
  });

  return (
    <div className="p-4 sm:p-6 lg:p-8 bg-[#09090b] min-h-screen">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-zinc-100">Call Log</h1>
          <p className="text-sm text-zinc-500">
            {loading ? "Loading..." : `${filteredCalls.length} calls`}
            <span className="ml-2 text-amber-400">Demo Data</span>
          </p>
        </div>
        <Button
          variant="outline"
          size="icon"
          onClick={() => fetchCalls(true)}
          disabled={refreshing}
        >
          <RefreshCw className={cn("h-4 w-4", refreshing && "animate-spin")} />
        </Button>
      </div>

      {/* Toolbar */}
      <div className="mb-6 flex items-center gap-4">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-500" />
          <Input
            placeholder="Search transcript, caller, or ID..."
            className="pl-10 bg-zinc-900 border-zinc-800"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
        <div className="flex items-center gap-1 rounded-lg bg-zinc-900 p-1 border border-zinc-800">
          {(["all", "flagged", "safe", "processing"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={cn(
                "px-3 py-1.5 text-sm font-medium rounded-md transition-colors",
                filter === f
                  ? "bg-zinc-800 text-zinc-100"
                  : "text-zinc-400 hover:text-zinc-100"
              )}
            >
              {f.charAt(0).toUpperCase() + f.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div className="rounded-lg border border-zinc-800 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[600px]">
            <thead className="bg-zinc-900">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-zinc-400 uppercase tracking-wider">
                  Status
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-zinc-400 uppercase tracking-wider">
                  Source
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-zinc-400 uppercase tracking-wider">
                  Date
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-zinc-400 uppercase tracking-wider">
                  Duration
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-zinc-400 uppercase tracking-wider">
                  Caller
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-zinc-400 uppercase tracking-wider">
                  Score
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800">
              {loading ? (
                [...Array(5)].map((_, i) => (
                  <tr key={i}>
                    <td colSpan={6} className="px-4 py-4">
                      <div className="h-6 animate-pulse rounded bg-zinc-800" />
                    </td>
                  </tr>
                ))
              ) : filteredCalls.length === 0 ? (
                <tr>
                  <td
                    colSpan={6}
                    className="px-4 py-12 text-center text-sm text-zinc-500"
                  >
                    No calls found
                  </td>
                </tr>
              ) : (
                filteredCalls.map((call) => (
                  <tr
                    key={call.id}
                    onClick={() => setSelectedCall(call)}
                    className="hover:bg-zinc-900/50 cursor-pointer transition-colors"
                  >
                    <td className="px-4 py-4">
                      <StatusBadge status={call.status} />
                    </td>
                    <td className="px-4 py-4">
                      <span className="text-sm font-medium text-white">
                        {formatSourceName(
                          call.publisher_id,
                          call.buyer_name,
                          call.publisher_name
                        ) || "—"}
                      </span>
                    </td>
                    <td className="px-4 py-4 text-sm text-zinc-300">
                      {formatDate(call.start_time_utc)}
                    </td>
                    <td className="px-4 py-4 text-sm text-zinc-300 font-mono">
                      {formatDuration(call.duration_seconds)}
                    </td>
                    <td className="px-4 py-4 text-sm text-zinc-400 font-mono">
                      {call.caller_number || "—"}
                    </td>
                    <td className="px-4 py-4">
                      <ScoreIndicator score={call.qa_flags?.score ?? null} />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Call Detail Sheet (Read-Only) */}
      <Sheet open={!!selectedCall} onOpenChange={() => setSelectedCall(null)}>
        <SheetContent className="w-[600px] overflow-y-auto bg-[#09090b] border-zinc-800">
          {selectedCall && (
            <>
              <SheetHeader className="pb-4 border-b border-zinc-800">
                <SheetTitle className="flex items-center gap-3 text-zinc-100">
                  <span className="font-mono text-lg">
                    {selectedCall.id.slice(0, 12)}
                  </span>
                  <StatusBadge status={selectedCall.status} />
                </SheetTitle>
              </SheetHeader>

              {/* Metadata */}
              <div className="py-6 border-b border-zinc-800 grid grid-cols-3 gap-4">
                <div>
                  <div className="flex items-center gap-2 text-zinc-500 mb-1">
                    <Clock className="h-3 w-3" />
                    <span className="text-xs">Duration</span>
                  </div>
                  <span className="text-sm font-medium font-mono">
                    {formatDuration(selectedCall.duration_seconds)}
                  </span>
                </div>
                <div>
                  <div className="flex items-center gap-2 text-zinc-500 mb-1">
                    <User className="h-3 w-3" />
                    <span className="text-xs">Caller</span>
                  </div>
                  <span className="text-sm font-mono">
                    {selectedCall.caller_number || "—"}
                  </span>
                </div>
                <div>
                  <div className="text-xs text-zinc-500 mb-1">Revenue</div>
                  <span className="text-sm font-medium font-mono">
                    {selectedCall.revenue && Number(selectedCall.revenue) > 0
                      ? `$${Number(selectedCall.revenue).toFixed(2)}`
                      : "—"}
                  </span>
                </div>
              </div>

              {/* QA Summary */}
              {selectedCall.qa_flags && (
                <div className="py-6 border-b border-zinc-800">
                  <span className="text-sm font-medium text-zinc-400 mb-4 block">
                    QA Analysis
                  </span>
                  {selectedCall.qa_flags.summary && (
                    <div className="p-3 rounded-lg bg-zinc-800/50 border border-zinc-700">
                      <p className="text-sm text-zinc-300">
                        {selectedCall.qa_flags.summary}
                      </p>
                    </div>
                  )}
                  {selectedCall.qa_flags.score !== undefined && (
                    <div className="mt-4 flex items-center gap-3">
                      <span className="text-xs text-zinc-500">Score:</span>
                      <ScoreIndicator score={selectedCall.qa_flags.score} />
                    </div>
                  )}
                </div>
              )}

              {/* Transcript */}
              <div className="py-6">
                <span className="text-sm font-medium text-zinc-400 mb-4 block">
                  Transcript
                </span>
                {selectedCall.transcript_text ? (
                  <div className="bg-zinc-900 rounded-lg p-4 max-h-[400px] overflow-y-auto border border-zinc-800">
                    <p className="text-sm text-zinc-300 whitespace-pre-wrap">
                      {selectedCall.transcript_text}
                    </p>
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center py-12 text-zinc-500">
                    <AlertTriangle className="h-8 w-8 mb-3" />
                    <span>No transcript available</span>
                  </div>
                )}
              </div>

              {/* Demo Note */}
              <div className="py-4 px-4 rounded-lg bg-amber-500/10 border border-amber-500/30">
                <p className="text-sm text-amber-400">
                  Demo mode - Audio playback and status changes are disabled.
                </p>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
