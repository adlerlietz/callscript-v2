"use client";

import { useState, useEffect } from "react";
import { createClient } from "@supabase/supabase-js";
import {
  Clock, User, Loader2, AlertTriangle, Bug, ChevronDown, ChevronUp
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { cn, formatDuration } from "@/lib/utils";
import type { Call, CallStatus } from "@/lib/database.types";

// Initialize Supabase client
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

// Helper: Truncate UUID
function truncateId(id: string, length = 8): string {
  return id.slice(0, length);
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

// Props for CallInspector
interface CallInspectorProps {
  call: Call | null;
  open: boolean;
  onClose: () => void;
  onStatusUpdate?: (id: string, status: CallStatus) => void;
}

// Call Inspector (Slide-Over Sheet)
export function CallInspector({
  call,
  open,
  onClose,
  onStatusUpdate,
}: CallInspectorProps) {
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
              setAudioError(null);
            } else {
              setAudioError("No audio available");
            }
          } else {
            setAudioUrl(data.signedUrl);
          }
        })
        .finally(() => setAudioLoading(false));
    } else if (call.audio_url) {
      setAudioUrl(call.audio_url);
    } else {
      setAudioError("No audio available for this call");
    }
  }, [call]);

  if (!call) return null;

  const handleStatusUpdate = async (newStatus: CallStatus) => {
    setUpdating(true);
    try {
      const res = await fetch(`/api/calls/${call.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });

      if (res.ok && onStatusUpdate) {
        onStatusUpdate(call.id, newStatus);
      }
    } finally {
      setUpdating(false);
    }
  };

  // Speaker color mapping for consistent colors
  const speakerColors: Record<string, string> = {
    SPEAKER_00: "text-blue-400",
    SPEAKER_01: "text-emerald-400",
    SPEAKER_02: "text-amber-400",
    SPEAKER_03: "text-purple-400",
  };

  const getSpeakerColor = (speaker: string) => {
    return speakerColors[speaker] || "text-zinc-400";
  };

  const formatTimestamp = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  // Render transcript with speaker attribution (if segments have text) or plain
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

    if (!call.transcript_text) {
      return (
        <div className="flex flex-col items-center justify-center py-12 text-zinc-500">
          <AlertTriangle className="h-8 w-8 mb-3" />
          <span className="font-medium">No transcript available</span>
          <span className="text-xs mt-1">transcript_text is NULL in database</span>
        </div>
      );
    }

    // Check if we have speaker-attributed segments with text
    const segments = call.transcript_segments;
    const hasAttributedSegments = segments &&
      Array.isArray(segments) &&
      segments.length > 0 &&
      segments.some((seg: { text?: string }) => seg.text && seg.text.length > 0);

    if (hasAttributedSegments) {
      // Render speaker-attributed transcript
      return (
        <div className="space-y-4">
          {segments.map((seg: { speaker: string; start: number; end: number; text?: string }, i: number) => {
            if (!seg.text) return null;

            // Highlight sensitive patterns in segment text
            const sensitivePatterns = /(social security|ssn|credit card|\d{3}-\d{2}-\d{4})/gi;
            const parts = seg.text.split(sensitivePatterns);

            return (
              <div key={i} className="flex gap-3">
                <div className="flex-shrink-0 w-24">
                  <div className={cn("text-xs font-medium", getSpeakerColor(seg.speaker))}>
                    {seg.speaker.replace("SPEAKER_", "Speaker ")}
                  </div>
                  <div className="text-[10px] text-zinc-600 font-mono">
                    {formatTimestamp(seg.start)}
                  </div>
                </div>
                <div className="flex-1 text-sm text-zinc-300 leading-relaxed">
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
              </div>
            );
          })}
        </div>
      );
    }

    // Fallback: Plain transcript without speaker attribution
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

    const flags = call.qa_flags;

    return (
      <div className="py-6 border-b border-zinc-800">
        <span className="text-sm font-medium text-zinc-400 mb-4 block">QA Analysis</span>

        {flags.summary && (
          <div className="mb-4 p-3 rounded-lg bg-zinc-800/50 border border-zinc-700">
            <p className="text-sm text-zinc-300">{flags.summary}</p>
          </div>
        )}

        {flags.score !== undefined && (
          <div className="mb-4 flex items-center gap-3">
            <span className="text-xs text-zinc-500">Score:</span>
            <ScoreIndicator score={flags.score} />
          </div>
        )}

        {flags.compliance_issues && flags.compliance_issues.length > 0 && (
          <div className="space-y-2">
            <span className="text-xs text-zinc-500">Issues:</span>
            {flags.compliance_issues.map((issue, i) => (
              <div
                key={i}
                className="flex items-start gap-3 p-3 rounded-lg bg-zinc-900 border border-zinc-800"
              >
                <Badge variant="warning">Issue</Badge>
                <p className="text-sm text-zinc-300">{issue}</p>
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

        {/* Audio Player */}
        <div className="py-6 border-b border-zinc-800">
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm font-medium text-zinc-400">Audio</span>
            <span className="text-xs text-zinc-500 font-mono">
              Duration: {call.duration_seconds ? formatDuration(call.duration_seconds) : "—"}
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
              {call.duration_seconds ? formatDuration(call.duration_seconds) : "—"}
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

// Export helper components for reuse
export { StatusBadge, ScoreIndicator };
