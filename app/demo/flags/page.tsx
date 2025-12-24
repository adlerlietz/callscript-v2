"use client";

import { useState, useEffect, useCallback } from "react";
import { RefreshCw, CheckCircle, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { cn, formatDate, formatDuration, truncateId, formatSourceName } from "@/lib/utils";

type FlagSeverity = "critical" | "high" | "medium";

type QaFlags = {
  score?: number;
  summary?: string;
  error?: string;
  compliance_issues?: string[];
};

type Call = {
  id: string;
  ringba_call_id: string;
  start_time_utc: string;
  duration_seconds: number | null;
  revenue: number | null;
  status: string;
  transcript_text: string | null;
  qa_flags: QaFlags | null;
  publisher_id: string | null;
  publisher_name: string | null;
  buyer_name: string | null;
};

function SeverityBadge({ severity }: { severity: FlagSeverity }) {
  const config: Record<
    FlagSeverity,
    { variant: "danger" | "warning" | "default"; label: string }
  > = {
    critical: { variant: "danger", label: "Critical" },
    high: { variant: "warning", label: "High" },
    medium: { variant: "default", label: "Medium" },
  };
  const { variant, label } = config[severity] || {
    variant: "default",
    label: severity,
  };
  return <Badge variant={variant}>{label}</Badge>;
}

function getHighestSeverity(flags: QaFlags | null): FlagSeverity {
  if (!flags || flags.error) return "medium";
  const score = flags.score ?? 100;
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

/**
 * Demo Flags Page
 * Uses /api/demo/flags endpoint with demo org data.
 * Read-only - no status changes allowed.
 */
export default function DemoFlagsPage() {
  const [calls, setCalls] = useState<Call[]>([]);
  const [selectedCall, setSelectedCall] = useState<Call | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [offset, setOffset] = useState(0);
  const [total, setTotal] = useState(0);

  const fetchFlags = useCallback(
    async (newOffset = 0, showRefresh = false) => {
      if (showRefresh) setRefreshing(true);
      else setLoading(true);

      try {
        // Use demo API endpoint
        const res = await fetch(
          `/api/demo/flags?limit=${PAGE_SIZE}&offset=${newOffset}`
        );
        if (res.ok) {
          const data = await res.json();
          setCalls(data.flags || []);
          setTotal(data.total || 0);
          setOffset(newOffset);
        }
      } catch (error) {
        console.error("Failed to fetch demo flags:", error);
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    []
  );

  useEffect(() => {
    fetchFlags();
  }, [fetchFlags]);

  const currentPage = Math.floor(offset / PAGE_SIZE) + 1;
  const totalPages = Math.ceil(total / PAGE_SIZE);
  const hasNext = offset + PAGE_SIZE < total;
  const hasPrev = offset > 0;
  const showingStart = total === 0 ? 0 : offset + 1;
  const showingEnd = Math.min(offset + PAGE_SIZE, total);

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-zinc-100">Flagged Calls</h1>
          <p className="text-sm text-zinc-500">
            {loading
              ? "Loading..."
              : `${total.toLocaleString()} calls requiring review`}
            <span className="ml-2 text-amber-400">Demo Data</span>
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

      {/* Demo Notice */}
      <div className="mb-6 p-4 rounded-lg bg-amber-500/10 border border-amber-500/30">
        <p className="text-sm text-amber-400">
          Demo mode - Actions like &quot;Mark Safe&quot; and &quot;Export CSV&quot; are
          disabled. Sign up to manage your own flagged calls.
        </p>
      </div>

      {/* Table */}
      <div className="rounded-lg border border-zinc-800 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[800px]">
            <thead className="bg-zinc-900">
              <tr>
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
              ) : calls.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-12 text-center">
                    <CheckCircle className="mx-auto h-12 w-12 text-emerald-500" />
                    <h3 className="mt-4 text-lg font-medium text-zinc-100">
                      All Clear
                    </h3>
                    <p className="mt-2 text-sm text-zinc-500">
                      No flagged calls to review.
                    </p>
                  </td>
                </tr>
              ) : (
                calls.map((call) => (
                  <tr
                    key={call.id}
                    onClick={() => setSelectedCall(call)}
                    className="hover:bg-zinc-900/50 cursor-pointer transition-colors"
                  >
                    <td className="px-4 py-4">
                      <span className="text-sm font-medium text-white">
                        {formatSourceName(
                          call.publisher_id,
                          call.buyer_name,
                          call.publisher_name
                        ) || "—"}
                      </span>
                    </td>
                    <td className="px-4 py-4">
                      <div className="text-sm text-zinc-300">
                        {formatDate(call.start_time_utc)}
                      </div>
                      <div className="text-xs text-zinc-500 font-mono">
                        {truncateId(call.id)}
                      </div>
                    </td>
                    <td className="px-4 py-4">
                      <SeverityBadge severity={getHighestSeverity(call.qa_flags)} />
                    </td>
                    <td className="px-4 py-4 text-sm font-mono text-zinc-300">
                      {call.duration_seconds
                        ? formatDuration(call.duration_seconds)
                        : "—"}
                    </td>
                    <td className="px-4 py-4">
                      <p className="text-sm text-zinc-400 max-w-xs truncate">
                        {getFirstSnippet(call.qa_flags)}
                      </p>
                    </td>
                    <td className="px-4 py-4 text-sm font-mono">
                      {call.revenue && Number(call.revenue) > 0 ? (
                        <span className="text-red-400">
                          ${Number(call.revenue).toFixed(2)}
                        </span>
                      ) : (
                        <span className="text-zinc-500">$0.00</span>
                      )}
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
            Showing {showingStart.toLocaleString()}-{showingEnd.toLocaleString()}{" "}
            of {total.toLocaleString()}
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
                  <SeverityBadge
                    severity={getHighestSeverity(selectedCall.qa_flags)}
                  />
                </SheetTitle>
              </SheetHeader>

              {/* QA Summary */}
              {selectedCall.qa_flags && (
                <div className="py-6 border-b border-zinc-800">
                  <span className="text-sm font-medium text-zinc-400 mb-4 block">
                    QA Analysis
                  </span>
                  {selectedCall.qa_flags.summary && (
                    <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/30">
                      <p className="text-sm text-red-300">
                        {selectedCall.qa_flags.summary}
                      </p>
                    </div>
                  )}
                  {selectedCall.qa_flags.compliance_issues &&
                    selectedCall.qa_flags.compliance_issues.length > 0 && (
                      <ul className="mt-4 space-y-2">
                        {selectedCall.qa_flags.compliance_issues.map(
                          (issue, i) => (
                            <li
                              key={i}
                              className="text-sm text-zinc-400 flex items-start gap-2"
                            >
                              <span className="text-red-400">•</span>
                              {issue}
                            </li>
                          )
                        )}
                      </ul>
                    )}
                </div>
              )}

              {/* Transcript */}
              <div className="py-6">
                <span className="text-sm font-medium text-zinc-400 mb-4 block">
                  Transcript
                </span>
                {selectedCall.transcript_text ? (
                  <div className="bg-zinc-900 rounded-lg p-4 max-h-[300px] overflow-y-auto border border-zinc-800">
                    <p className="text-sm text-zinc-300 whitespace-pre-wrap">
                      {selectedCall.transcript_text}
                    </p>
                  </div>
                ) : (
                  <div className="text-sm text-zinc-500 text-center py-8">
                    No transcript available
                  </div>
                )}
              </div>

              {/* Demo Note */}
              <div className="py-4 px-4 rounded-lg bg-amber-500/10 border border-amber-500/30">
                <p className="text-sm text-amber-400">
                  Demo mode - Actions are disabled. Sign up to manage flagged
                  calls.
                </p>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
