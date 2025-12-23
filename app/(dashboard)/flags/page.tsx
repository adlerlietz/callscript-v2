"use client";

import { useState, useEffect, useCallback } from "react";
import { Download, CheckCircle, XCircle, RefreshCw, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CallInspector } from "@/components/call-inspector";
import { cn, formatDate, formatDuration, truncateId, formatSourceName } from "@/lib/utils";
import type { Call, QaFlags, FlagSeverity, CallStatus } from "@/lib/database.types";

function SeverityBadge({ severity }: { severity: FlagSeverity }) {
  const config: Record<FlagSeverity, { variant: "danger" | "warning" | "default"; label: string }> = {
    critical: { variant: "danger", label: "Critical" },
    high: { variant: "warning", label: "High" },
    medium: { variant: "default", label: "Medium" },
  };
  const { variant, label } = config[severity] || { variant: "default", label: severity };
  return <Badge variant={variant}>{label}</Badge>;
}

function getHighestSeverity(flags: QaFlags | null): FlagSeverity {
  if (!flags || flags.error) return "medium";

  const score = flags.score ?? 100;

  // Score-based severity (lower score = more severe)
  if (score <= 20) return "critical";
  if (score <= 50) return "high";
  return "medium";
}

function getFirstSnippet(flags: QaFlags | null): string {
  if (!flags) return "No flag details";
  if (flags.error) return flags.error;
  if (flags.summary) return flags.summary;
  if (flags.compliance_issues && flags.compliance_issues.length > 0) {
    return flags.compliance_issues[0];
  }
  return "Flagged for review";
}

const PAGE_SIZE = 50;

export default function FlagsPage() {
  const [calls, setCalls] = useState<Call[]>([]);
  const [selectedCall, setSelectedCall] = useState<Call | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [updating, setUpdating] = useState<string | null>(null);

  // Pagination state
  const [offset, setOffset] = useState(0);
  const [total, setTotal] = useState(0);

  const fetchFlags = useCallback(async (newOffset = 0, showRefresh = false) => {
    if (showRefresh) setRefreshing(true);
    else setLoading(true);

    try {
      const res = await fetch(`/api/flags?limit=${PAGE_SIZE}&offset=${newOffset}`);
      if (res.ok) {
        const data = await res.json();
        setCalls(data.flags || []);
        setTotal(data.total || 0);
        setOffset(newOffset);
        // Clear selections when changing pages
        if (newOffset !== offset) {
          setSelectedIds(new Set());
        }
      }
    } catch (error) {
      console.error("Failed to fetch flagged calls:", error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [offset]);

  useEffect(() => {
    fetchFlags();
  }, [fetchFlags]);

  const toggleSelect = (id: string, e: React.MouseEvent) => {
    e.stopPropagation(); // Prevent row click
    const newSelected = new Set(selectedIds);
    if (newSelected.has(id)) {
      newSelected.delete(id);
    } else {
      newSelected.add(id);
    }
    setSelectedIds(newSelected);
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === calls.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(calls.map((c) => c.id)));
    }
  };

  const handleMarkSafe = async (ids?: string[]) => {
    const idsToUpdate = ids || Array.from(selectedIds);
    if (idsToUpdate.length === 0) return;

    try {
      const res = await fetch("/api/flags/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: idsToUpdate, action: "mark_safe" }),
      });

      if (res.ok) {
        setCalls((prev) => prev.filter((c) => !idsToUpdate.includes(c.id)));
        setSelectedIds(new Set());
      }
    } catch (error) {
      console.error("Failed to mark safe:", error);
    }
  };

  const handleSingleAction = async (id: string, action: "safe" | "confirm", e: React.MouseEvent) => {
    e.stopPropagation(); // Prevent row click
    setUpdating(id);
    try {
      const res = await fetch(`/api/calls/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: action === "safe" ? "safe" : "flagged" }),
      });

      if (res.ok && action === "safe") {
        setCalls((prev) => prev.filter((c) => c.id !== id));
      }
    } finally {
      setUpdating(null);
    }
  };

  const handleStatusUpdate = (id: string, newStatus: CallStatus) => {
    if (newStatus === "safe") {
      setCalls((prev) => prev.filter((c) => c.id !== id));
      setSelectedCall(null);
    }
  };

  const handleExportCSV = () => {
    const selected = calls.filter((c) => selectedIds.has(c.id));
    const csv = [
      ["ID", "Source", "Date", "Severity", "Duration", "Revenue"].join(","),
      ...selected.map((c) =>
        [
          c.id,
          formatSourceName(c.publisher_id, c.buyer_name, c.publisher_name) || "",
          c.start_time_utc,
          getHighestSeverity(c.qa_flags),
          c.duration_seconds || 0,
          c.revenue || 0,
        ].join(",")
      ),
    ].join("\n");

    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `flagged-calls-${new Date().toISOString().split("T")[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-zinc-100">Flagged Calls</h1>
          <p className="text-sm text-zinc-500">
            {loading ? "Loading..." : `${total.toLocaleString()} calls requiring review`}
          </p>
        </div>
        <Button
          variant="outline"
          size="icon"
          onClick={() => fetchFlags(offset, true)}
          disabled={refreshing}
        >
          <RefreshCw className={cn("h-4 w-4", refreshing && "animate-spin")} />
        </Button>
      </div>

      {/* Bulk Actions Bar */}
      {selectedIds.size > 0 && (
        <div className="mb-6 flex items-center justify-between rounded-lg border border-zinc-700 bg-zinc-800/50 px-4 py-3">
          <span className="text-sm text-zinc-300">
            {selectedIds.size} call{selectedIds.size > 1 ? "s" : ""} selected
          </span>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => handleMarkSafe()}>
              <CheckCircle className="mr-2 h-4 w-4" />
              Mark Safe
            </Button>
            <Button variant="outline" size="sm" onClick={handleExportCSV}>
              <Download className="mr-2 h-4 w-4" />
              Export Refund CSV
            </Button>
          </div>
        </div>
      )}

      {/* Pagination helpers */}
      {(() => {
        const currentPage = Math.floor(offset / PAGE_SIZE) + 1;
        const totalPages = Math.ceil(total / PAGE_SIZE);
        const hasNext = offset + PAGE_SIZE < total;
        const hasPrev = offset > 0;
        const showingStart = total === 0 ? 0 : offset + 1;
        const showingEnd = Math.min(offset + PAGE_SIZE, total);

        return (
          <>
            {/* Table */}
            <div className="rounded-lg border border-zinc-800 overflow-hidden">
              <div className="overflow-x-auto">
              <table className="w-full min-w-[800px]">
          <thead className="bg-zinc-900">
            <tr>
              <th className="w-12 px-4 py-3">
                <input
                  type="checkbox"
                  checked={selectedIds.size === calls.length && calls.length > 0}
                  onChange={toggleSelectAll}
                  className="h-4 w-4 rounded border-zinc-700 bg-zinc-800 text-zinc-100 focus:ring-zinc-400"
                />
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-zinc-400 uppercase tracking-wider">
                Source
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-zinc-400 uppercase tracking-wider">
                Date
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-zinc-400 uppercase tracking-wider">
                Severity
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-zinc-400 uppercase tracking-wider">
                Duration
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-zinc-400 uppercase tracking-wider">
                Flag Reason
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-zinc-400 uppercase tracking-wider">
                Revenue
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-zinc-400 uppercase tracking-wider">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-800">
            {loading ? (
              [...Array(5)].map((_, i) => (
                <tr key={i}>
                  <td colSpan={8} className="px-4 py-4">
                    <div className="h-6 animate-pulse rounded bg-zinc-800" />
                  </td>
                </tr>
              ))
            ) : calls.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-12 text-center">
                  <CheckCircle className="mx-auto h-12 w-12 text-emerald-500" />
                  <h3 className="mt-4 text-lg font-medium text-zinc-100">All Clear</h3>
                  <p className="mt-2 text-sm text-zinc-500">
                    No flagged calls to review. Great work!
                  </p>
                </td>
              </tr>
            ) : (
              calls.map((call) => (
                <tr
                  key={call.id}
                  onClick={() => setSelectedCall(call)}
                  className={cn(
                    "transition-colors cursor-pointer",
                    selectedIds.has(call.id)
                      ? "bg-zinc-800/50"
                      : "hover:bg-zinc-900/50"
                  )}
                >
                  <td className="px-4 py-4" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={selectedIds.has(call.id)}
                      onChange={(e) => toggleSelect(call.id, e as unknown as React.MouseEvent)}
                      className="h-4 w-4 rounded border-zinc-700 bg-zinc-800 text-zinc-100 focus:ring-zinc-400"
                    />
                  </td>
                  <td className="px-4 py-4">
                    <span className="text-sm font-medium text-white">
                      {formatSourceName(call.publisher_id, call.buyer_name, call.publisher_name) || "—"}
                    </span>
                  </td>
                  <td className="px-4 py-4">
                    <div className="text-sm text-zinc-300">{formatDate(call.start_time_utc)}</div>
                    <div className="text-xs text-zinc-500 font-mono">{truncateId(call.id)}</div>
                  </td>
                  <td className="px-4 py-4">
                    <SeverityBadge severity={getHighestSeverity(call.qa_flags)} />
                  </td>
                  <td className="px-4 py-4 text-sm font-mono text-zinc-300">
                    {call.duration_seconds ? formatDuration(call.duration_seconds) : "—"}
                  </td>
                  <td className="px-4 py-4">
                    <p className="text-sm text-zinc-400 max-w-xs truncate">
                      {getFirstSnippet(call.qa_flags)}
                    </p>
                  </td>
                  <td className="px-4 py-4 text-sm font-mono">
                    {call.revenue && Number(call.revenue) > 0 ? (
                      <span className="text-red-400">${Number(call.revenue).toFixed(2)}</span>
                    ) : (
                      <span className="text-zinc-500">$0.00</span>
                    )}
                  </td>
                  <td className="px-4 py-4">
                    <div className="flex items-center gap-2">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-emerald-400 hover:text-emerald-300"
                        disabled={updating === call.id}
                        onClick={(e) => handleSingleAction(call.id, "safe", e)}
                      >
                        <CheckCircle className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-red-400 hover:text-red-300"
                        disabled={updating === call.id}
                        onClick={(e) => handleSingleAction(call.id, "confirm", e)}
                      >
                        <XCircle className="h-4 w-4" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))
            )}
              </tbody>
              </table>
              </div>
            </div>

            {/* Pagination Controls */}
            {total > PAGE_SIZE && (
              <div className="flex items-center justify-between border border-zinc-800 border-t-0 rounded-b-lg bg-zinc-900/50 px-4 py-3">
                <span className="text-sm text-zinc-500">
                  Showing {showingStart.toLocaleString()}-{showingEnd.toLocaleString()} of {total.toLocaleString()}
                </span>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={!hasPrev || loading}
                    onClick={() => fetchFlags(offset - PAGE_SIZE)}
                  >
                    <ChevronLeft className="h-4 w-4 mr-1" />
                    Previous
                  </Button>
                  <span className="px-3 py-1 text-sm text-zinc-400">
                    Page {currentPage} of {totalPages}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={!hasNext || loading}
                    onClick={() => fetchFlags(offset + PAGE_SIZE)}
                  >
                    Next
                    <ChevronRight className="h-4 w-4 ml-1" />
                  </Button>
                </div>
              </div>
            )}
          </>
        );
      })()}

      {/* Call Inspector Sheet */}
      <CallInspector
        call={selectedCall}
        open={!!selectedCall}
        onClose={() => setSelectedCall(null)}
        onStatusUpdate={handleStatusUpdate}
      />
    </div>
  );
}
