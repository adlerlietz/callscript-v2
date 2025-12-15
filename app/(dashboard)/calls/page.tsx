"use client";

import { useState, useEffect, useCallback } from "react";
import { createClient } from "@supabase/supabase-js";
import {
  Search, RefreshCw, Clock, User, Loader2,
  AlertTriangle, Bug, ChevronDown, ChevronUp
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

// Initialize Supabase client
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

// Correct TypeScript types matching database columns
type Call = {
  id: string;
  ringba_call_id: string;
  campaign_id: string | null;
  start_time_utc: string;
  updated_at: string | null;
  caller_number: string | null;
  duration_seconds: number | null;  // DB column name
  revenue: number | null;
  audio_url: string | null;
  storage_path: string | null;
  status: string;
  retry_count: number | null;
  processing_error: string | null;
  transcript_text: string | null;   // DB column name
  transcript_segments: unknown[] | null;
  qa_flags: QaFlags | null;
  qa_version: string | null;
  judge_model: string | null;
};

type QaFlags = {
  score?: number;
  summary?: string;
  flags?: Array<{
    rule: string;
    severity: "critical" | "high" | "medium";
    snippet: string;
    timestamp_seconds?: number;
  }>;
};

// Helper: Format duration (seconds -> mm:ss)
function formatDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined) return "—";
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

// Helper: Format date
function formatDate(isoString: string): string {
  const date = new Date(isoString);
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// Helper: Truncate UUID
function truncateId(id: string, length = 8): string {
  return id.slice(0, length);
}

// Helper: Extract score from qa_flags
function extractScore(qaFlags: QaFlags | null): number | null {
  if (!qaFlags) return null;
  if (typeof qaFlags.score === "number") return qaFlags.score;
  return null;
}

// Status Badge Component
function StatusBadge({ status }: { status: string }) {
  const config: Record<string, { variant: "default" | "success" | "danger" | "warning" | "info"; label: string }> = {
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

// Score Indicator Component
function ScoreIndicator({ score }: { score: number | null }) {
  if (score === null) return <span className="text-zinc-500 font-mono">—</span>;
  const color = score >= 70 ? "text-emerald-400" : score >= 40 ? "text-amber-400" : "text-red-400";
  return <span className={cn("font-mono font-medium", color)}>{score}</span>;
}

// Debug Panel Component
function DebugPanel({ call, audioUrl }: { call: Call; audioUrl: string | null }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="mt-4 rounded-lg border border-amber-500/30 bg-amber-500/5">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between p-3 text-amber-400 hover:bg-amber-500/10"
      >
        <div className="flex items-center gap-2">
          <Bug className="h-4 w-4" />
          <span className="text-sm font-medium">Debug Panel</span>
        </div>
        {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
      </button>
      {expanded && (
        <div className="p-3 border-t border-amber-500/30">
          <pre className="text-xs text-amber-300 overflow-auto max-h-64 font-mono">
{`=== RAW CALL DATA ===
id: ${call.id}
status: ${call.status}
storage_path: ${call.storage_path || "NULL"}
audio_url: ${call.audio_url || "NULL"}
duration_seconds: ${call.duration_seconds ?? "NULL"}
transcript_text length: ${call.transcript_text?.length ?? "NULL (no transcript)"}
qa_flags: ${call.qa_flags ? JSON.stringify(call.qa_flags, null, 2) : "NULL"}
caller_number: ${call.caller_number || "NULL"}
processing_error: ${call.processing_error || "NULL"}

=== COMPUTED VALUES ===
signedAudioUrl: ${audioUrl || "NOT GENERATED"}

=== FULL JSON ===
${JSON.stringify(call, null, 2)}`}
          </pre>
        </div>
      )}
    </div>
  );
}

// Call Inspector (Slide-Over Sheet)
function CallInspector({
  call,
  open,
  onClose,
  onStatusUpdate,
}: {
  call: Call | null;
  open: boolean;
  onClose: () => void;
  onStatusUpdate: (id: string, status: string) => void;
}) {
  const [updating, setUpdating] = useState(false);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [audioLoading, setAudioLoading] = useState(false);
  const [audioError, setAudioError] = useState<string | null>(null);

  // Generate signed URL when call changes
  useEffect(() => {
    if (!call) {
      setAudioUrl(null);
      return;
    }

    // Reset audio state
    setAudioUrl(null);
    setAudioError(null);

    // Try to get audio URL - prefer storage signed URL, fallback to Ringba URL
    if (call.storage_path) {
      setAudioLoading(true);
      supabase.storage
        .from("calls_audio")
        .createSignedUrl(call.storage_path, 3600) // 1 hour expiry
        .then(({ data, error }) => {
          if (error || !data?.signedUrl) {
            // Storage failed - fallback to Ringba audio_url
            console.warn("Storage URL failed, using Ringba URL:", error?.message);
            if (call.audio_url) {
              setAudioUrl(call.audio_url);
              setAudioError(null); // Clear error since we have fallback
            } else {
              setAudioError("No audio available");
            }
          } else {
            setAudioUrl(data.signedUrl);
          }
        })
        .finally(() => setAudioLoading(false));
    } else if (call.audio_url) {
      // No storage_path - use Ringba URL directly
      setAudioUrl(call.audio_url);
    } else {
      setAudioError("No audio available for this call");
    }
  }, [call]);

  if (!call) return null;

  const handleStatusUpdate = async (newStatus: string) => {
    setUpdating(true);
    try {
      // Note: This requires proper RLS/service role setup
      const { error } = await supabase
        .from("calls_overview")
        .update({ status: newStatus })
        .eq("id", call.id);

      if (error) {
        console.error("Status update error:", error);
      } else {
        onStatusUpdate(call.id, newStatus);
      }
    } finally {
      setUpdating(false);
    }
  };

  // Render transcript with PII highlighting
  const renderTranscript = () => {
    // Processing state
    if (["pending", "downloaded", "processing"].includes(call.status)) {
      return (
        <div className="flex items-center justify-center py-12 text-zinc-500">
          <Loader2 className="h-5 w-5 animate-spin mr-3" />
          <span>Processing transcript...</span>
        </div>
      );
    }

    // Check transcript_text (correct DB column name)
    if (!call.transcript_text) {
      return (
        <div className="flex flex-col items-center justify-center py-12 text-zinc-500">
          <AlertTriangle className="h-8 w-8 mb-3" />
          <span className="font-medium">No transcript available</span>
          <span className="text-xs mt-1">transcript_text is NULL in database</span>
        </div>
      );
    }

    // Highlight sensitive patterns
    const sensitivePatterns = /(social security|ssn|credit card|\d{3}-\d{2}-\d{4})/gi;
    const lines = call.transcript_text.split("\n");

    return lines.map((line, i) => {
      const parts = line.split(sensitivePatterns);
      return (
        <div key={i} className="mb-2 leading-relaxed">
          {parts.map((part, j) => {
            if (sensitivePatterns.test(part)) {
              return (
                <span key={j} className="bg-red-500/20 text-red-400 px-1 rounded">
                  {part}
                </span>
              );
            }
            return <span key={j}>{part}</span>;
          })}
        </div>
      );
    });
  };

  // Render QA Summary
  const renderQaSummary = () => {
    if (!call.qa_flags) return null;

    return (
      <div className="py-6 border-b border-zinc-800">
        <span className="text-sm font-medium text-zinc-400 mb-4 block">QA Analysis</span>

        {call.qa_flags.summary && (
          <div className="mb-4 p-3 rounded-lg bg-zinc-800/50 border border-zinc-700">
            <p className="text-sm text-zinc-300">{call.qa_flags.summary}</p>
          </div>
        )}

        {call.qa_flags.score !== undefined && (
          <div className="mb-4 flex items-center gap-3">
            <span className="text-xs text-zinc-500">Score:</span>
            <ScoreIndicator score={call.qa_flags.score} />
          </div>
        )}

        {call.qa_flags.flags && call.qa_flags.flags.length > 0 && (
          <div className="space-y-2">
            {call.qa_flags.flags.map((flag, i) => (
              <div
                key={i}
                className="flex items-start gap-3 p-3 rounded-lg bg-zinc-900 border border-zinc-800"
              >
                <Badge
                  variant={
                    flag.severity === "critical"
                      ? "danger"
                      : flag.severity === "high"
                      ? "warning"
                      : "default"
                  }
                >
                  {flag.severity}
                </Badge>
                <div className="flex-1">
                  <p className="text-sm font-medium text-zinc-300">{flag.rule}</p>
                  <p className="text-xs text-zinc-500 mt-1">{flag.snippet}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  };

  return (
    <Sheet open={open} onOpenChange={onClose}>
      <SheetContent className="w-[800px] overflow-y-auto bg-[#09090b] border-zinc-800">
        <SheetHeader className="pb-4 border-b border-zinc-800">
          <div className="flex items-center justify-between">
            <div>
              <SheetTitle className="flex items-center gap-3 text-zinc-100">
                <span className="font-mono text-lg">{truncateId(call.id, 12)}</span>
                <StatusBadge status={call.status} />
              </SheetTitle>
              <p className="text-sm text-zinc-500 mt-1 font-mono">
                {call.ringba_call_id}
              </p>
            </div>
            {call.status === "flagged" && (
              <Button
                variant="outline"
                size="sm"
                disabled={updating}
                onClick={() => handleStatusUpdate("safe")}
              >
                {updating ? <Loader2 className="h-4 w-4 animate-spin" /> : "Mark Safe"}
              </Button>
            )}
          </div>
        </SheetHeader>

        {/* Audio Player - Simple HTML5 audio controls */}
        <div className="py-6 border-b border-zinc-800">
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm font-medium text-zinc-400">Audio</span>
            <span className="text-xs text-zinc-500 font-mono">
              Duration: {formatDuration(call.duration_seconds)}
            </span>
          </div>

          {audioLoading ? (
            <div className="flex items-center gap-2 text-zinc-500">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span className="text-sm">Loading audio...</span>
            </div>
          ) : audioError ? (
            <div className="text-sm text-red-400">{audioError}</div>
          ) : audioUrl ? (
            <audio
              src={audioUrl}
              controls
              className="w-full"
            />
          ) : (
            <div className="text-sm text-zinc-500">
              No audio available
            </div>
          )}
        </div>

        {/* Metadata */}
        <div className="py-6 border-b border-zinc-800 grid grid-cols-3 gap-4">
          <div>
            <div className="flex items-center gap-2 text-zinc-500 mb-1">
              <Clock className="h-3 w-3" />
              <span className="text-xs">Duration</span>
            </div>
            <span className="text-sm font-medium font-mono">
              {formatDuration(call.duration_seconds)}
            </span>
          </div>
          <div>
            <div className="flex items-center gap-2 text-zinc-500 mb-1">
              <User className="h-3 w-3" />
              <span className="text-xs">Caller</span>
            </div>
            <span className="text-sm font-mono">{call.caller_number || "—"}</span>
          </div>
          <div>
            <div className="text-xs text-zinc-500 mb-1">Revenue</div>
            <span className="text-sm font-medium font-mono">
              {call.revenue && Number(call.revenue) > 0
                ? `$${Number(call.revenue).toFixed(2)}`
                : "—"}
            </span>
          </div>
        </div>

        {/* QA Summary */}
        {renderQaSummary()}

        {/* Transcript */}
        <div className="py-6">
          <div className="flex items-center justify-between mb-4">
            <span className="text-sm font-medium text-zinc-400">Transcript</span>
            {call.transcript_text && (
              <span className="text-xs text-zinc-600">
                {call.transcript_text.length.toLocaleString()} chars
              </span>
            )}
          </div>
          <div className="bg-zinc-900 rounded-lg p-4 max-h-[400px] overflow-y-auto border border-zinc-800">
            <div className="text-sm text-zinc-300 whitespace-pre-wrap font-sans">
              {renderTranscript()}
            </div>
          </div>
        </div>

        {/* Error Display */}
        {call.processing_error && (
          <div className="py-4 px-4 rounded-lg bg-red-500/10 border border-red-500/20 mb-4">
            <p className="text-sm text-red-400 font-mono">{call.processing_error}</p>
          </div>
        )}

        {/* Debug Panel */}
        <DebugPanel call={call} audioUrl={audioUrl} />
      </SheetContent>
    </Sheet>
  );
}

// Main Calls Page Component
export default function CallsPage() {
  const [calls, setCalls] = useState<Call[]>([]);
  const [selectedCall, setSelectedCall] = useState<Call | null>(null);
  const [filter, setFilter] = useState<"all" | "flagged" | "safe" | "processing">("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);

  // Fetch calls from Supabase
  const fetchCalls = useCallback(async (showRefresh = false) => {
    if (showRefresh) setRefreshing(true);
    setFetchError(null);

    try {
      let query = supabase
        .from("calls_overview")
        .select("*")
        .order("start_time_utc", { ascending: false })
        .limit(50);

      // Apply status filter
      if (filter === "flagged") {
        query = query.eq("status", "flagged");
      } else if (filter === "safe") {
        query = query.eq("status", "safe");
      } else if (filter === "processing") {
        query = query.in("status", ["pending", "downloaded", "processing"]);
      }

      const { data, error } = await query;

      if (error) {
        console.error("Error fetching calls:", error);
        setFetchError(`Database error: ${error.message}`);
        setCalls([]);
      } else {
        console.log("Fetched calls:", data?.length, "Sample:", data?.[0]);
        setCalls((data as Call[]) || []);
      }
    } catch (err) {
      console.error("Fetch exception:", err);
      setFetchError(`Exception: ${err}`);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [filter]);

  // Initial fetch and polling
  useEffect(() => {
    fetchCalls();

    // Poll every 10 seconds for updates
    const pollInterval = setInterval(() => {
      fetchCalls();
    }, 10000);

    return () => clearInterval(pollInterval);
  }, [fetchCalls]);

  // Handle status update from inspector
  const handleStatusUpdate = (id: string, newStatus: string) => {
    setCalls((prev) =>
      prev.map((call) =>
        call.id === id ? { ...call, status: newStatus } : call
      )
    );
    if (selectedCall?.id === id) {
      setSelectedCall((prev) => (prev ? { ...prev, status: newStatus } : null));
    }
  };

  // Filter calls by search query
  const filteredCalls = calls.filter((call) => {
    if (!searchQuery) return true;

    const query = searchQuery.toLowerCase();
    return (
      call.transcript_text?.toLowerCase().includes(query) ||
      call.caller_number?.toLowerCase().includes(query) ||
      call.ringba_call_id?.toLowerCase().includes(query) ||
      call.id.toLowerCase().includes(query)
    );
  });

  return (
    <div className="p-8 bg-[#09090b] min-h-screen">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-zinc-100">Call Log</h1>
          <p className="text-sm text-zinc-500">
            {loading ? "Loading..." : `${filteredCalls.length} calls`}
            {!loading && !fetchError && (
              <span className="ml-2 text-emerald-500">● Live (10s poll)</span>
            )}
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

      {/* Error Banner */}
      {fetchError && (
        <div className="mb-6 p-4 rounded-lg bg-red-500/10 border border-red-500/30">
          <p className="text-sm text-red-400">{fetchError}</p>
        </div>
      )}

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
        <table className="w-full">
          <thead className="bg-zinc-900">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium text-zinc-400 uppercase tracking-wider">
                Status
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-zinc-400 uppercase tracking-wider">
                ID
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
                <td colSpan={6} className="px-4 py-12 text-center text-sm text-zinc-500">
                  {fetchError ? "Error loading calls" : "No calls found"}
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
                  <td className="px-4 py-4 font-mono text-sm text-zinc-400">
                    {truncateId(call.id)}
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
                    <ScoreIndicator score={extractScore(call.qa_flags)} />
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Inspector Sheet */}
      <CallInspector
        call={selectedCall}
        open={!!selectedCall}
        onClose={() => setSelectedCall(null)}
        onStatusUpdate={handleStatusUpdate}
      />
    </div>
  );
}
