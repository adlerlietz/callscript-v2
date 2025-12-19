"use client";

import { useState, useEffect, use } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@supabase/supabase-js";
import {
  ArrowLeft, Clock, User, Loader2, AlertTriangle,
  CheckCircle, DollarSign, Shield, MessageSquare
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn, formatDuration, formatDate } from "@/lib/utils";
import type { Call, CallStatus } from "@/lib/database.types";

// Initialize Supabase client
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

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

// Score Ring Component
function ScoreRing({ score }: { score: number }) {
  const color = score >= 70 ? "text-emerald-400" : score >= 40 ? "text-amber-400" : "text-red-400";
  const bgColor = score >= 70 ? "bg-emerald-400/10" : score >= 40 ? "bg-amber-400/10" : "bg-red-400/10";
  const strokeColor = score >= 70 ? "stroke-emerald-400" : score >= 40 ? "stroke-amber-400" : "stroke-red-400";

  const circumference = 2 * Math.PI * 40;
  const strokeDashoffset = circumference - (score / 100) * circumference;

  return (
    <div className={cn("relative w-24 h-24 rounded-full flex items-center justify-center", bgColor)}>
      <svg className="absolute w-full h-full -rotate-90">
        <circle
          cx="48"
          cy="48"
          r="40"
          fill="none"
          stroke="currentColor"
          strokeWidth="6"
          className="text-zinc-800"
        />
        <circle
          cx="48"
          cy="48"
          r="40"
          fill="none"
          strokeWidth="6"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={strokeDashoffset}
          className={strokeColor}
        />
      </svg>
      <span className={cn("text-2xl font-bold", color)}>{score}</span>
    </div>
  );
}

// Stat Card Component
function StatCard({
  icon: Icon,
  label,
  value,
  subValue
}: {
  icon: React.ElementType;
  label: string;
  value: string;
  subValue?: string;
}) {
  return (
    <div className="bg-zinc-900 rounded-lg p-4 border border-zinc-800">
      <div className="flex items-center gap-2 text-zinc-500 mb-2">
        <Icon className="h-4 w-4" />
        <span className="text-xs uppercase tracking-wider">{label}</span>
      </div>
      <div className="text-lg font-semibold text-zinc-100">{value}</div>
      {subValue && <div className="text-xs text-zinc-500 mt-1">{subValue}</div>}
    </div>
  );
}

export default function CallDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [call, setCall] = useState<Call | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [audioLoading, setAudioLoading] = useState(false);
  const [updating, setUpdating] = useState(false);

  // Fetch call data
  useEffect(() => {
    async function fetchCall() {
      try {
        const res = await fetch(`/api/calls/${id}`);
        if (!res.ok) {
          throw new Error("Call not found");
        }
        const data = await res.json();
        setCall(data.call);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load call");
      } finally {
        setLoading(false);
      }
    }
    fetchCall();
  }, [id]);

  // Load audio URL
  useEffect(() => {
    if (!call) return;

    if (call.storage_path) {
      setAudioLoading(true);
      supabase.storage
        .from("calls_audio")
        .createSignedUrl(call.storage_path, 3600)
        .then(({ data, error }) => {
          if (error || !data?.signedUrl) {
            if (call.audio_url) {
              setAudioUrl(call.audio_url);
            }
          } else {
            setAudioUrl(data.signedUrl);
          }
        })
        .finally(() => setAudioLoading(false));
    } else if (call.audio_url) {
      setAudioUrl(call.audio_url);
    }
  }, [call]);

  const handleStatusUpdate = async (newStatus: CallStatus) => {
    if (!call) return;
    setUpdating(true);
    try {
      const res = await fetch(`/api/calls/${call.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
      if (res.ok) {
        setCall({ ...call, status: newStatus });
      }
    } finally {
      setUpdating(false);
    }
  };

  // Format timestamp as MM:SS
  const formatTimestamp = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  // Get speaker color
  const getSpeakerColor = (speaker: string) => {
    const colors: Record<string, string> = {
      "SPEAKER_00": "text-blue-400 border-blue-400/30",
      "SPEAKER_01": "text-emerald-400 border-emerald-400/30",
      "SPEAKER_02": "text-amber-400 border-amber-400/30",
      "SPEAKER_03": "text-purple-400 border-purple-400/30",
    };
    return colors[speaker] || "text-zinc-400 border-zinc-400/30";
  };

  // Get speaker label
  const getSpeakerLabel = (speaker: string) => {
    const labels: Record<string, string> = {
      "SPEAKER_00": "Agent",
      "SPEAKER_01": "Caller",
      "SPEAKER_02": "Speaker 3",
      "SPEAKER_03": "Speaker 4",
    };
    return labels[speaker] || speaker;
  };

  // Highlight sensitive patterns in text
  const highlightSensitive = (text: string) => {
    const sensitivePatterns = /(social security|ssn|credit card|\d{3}-\d{2}-\d{4})/gi;
    const parts = text.split(sensitivePatterns);
    return parts.map((part, j) => {
      if (sensitivePatterns.test(part)) {
        return (
          <span key={j} className="bg-red-500/20 text-red-400 px-1 rounded">
            {part}
          </span>
        );
      }
      return <span key={j}>{part}</span>;
    });
  };

  // Render transcript with speaker segments
  const renderTranscript = () => {
    if (!call) return null;

    if (["pending", "downloaded", "processing"].includes(call.status)) {
      return (
        <div className="flex items-center justify-center py-16 text-zinc-500">
          <Loader2 className="h-6 w-6 animate-spin mr-3" />
          <span>Processing transcript...</span>
        </div>
      );
    }

    if (!call.transcript_text) {
      return (
        <div className="flex flex-col items-center justify-center py-16 text-zinc-500">
          <AlertTriangle className="h-10 w-10 mb-4" />
          <span className="font-medium">No transcript available</span>
        </div>
      );
    }

    // If we have speaker segments, render them with attribution
    const segments = call.transcript_segments as Array<{
      speaker: string;
      start: number;
      end: number;
      text: string;
    }> | null;

    if (segments && Array.isArray(segments) && segments.length > 0) {
      return (
        <div className="space-y-4">
          {segments.map((segment, i) => (
            <div key={i} className="flex gap-3">
              {/* Timestamp */}
              <div className="flex-shrink-0 w-12 text-xs text-zinc-600 font-mono pt-1">
                {formatTimestamp(segment.start)}
              </div>
              {/* Speaker & Text */}
              <div className="flex-1">
                <div className={cn(
                  "inline-block text-xs font-medium px-2 py-0.5 rounded border mb-1",
                  getSpeakerColor(segment.speaker)
                )}>
                  {getSpeakerLabel(segment.speaker)}
                </div>
                <div className="text-zinc-300 leading-relaxed">
                  {highlightSensitive(segment.text || "")}
                </div>
              </div>
            </div>
          ))}
        </div>
      );
    }

    // Fallback: render raw transcript text if no segments
    return (
      <div className="text-zinc-300 leading-relaxed whitespace-pre-wrap">
        {highlightSensitive(call.transcript_text)}
      </div>
    );
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="h-8 w-8 animate-spin text-zinc-500" />
      </div>
    );
  }

  if (error || !call) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen">
        <AlertTriangle className="h-12 w-12 text-red-400 mb-4" />
        <h1 className="text-xl font-semibold text-zinc-100 mb-2">Call Not Found</h1>
        <p className="text-zinc-500 mb-6">{error || "The requested call could not be found."}</p>
        <Button variant="outline" onClick={() => router.push("/calls")}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back to Calls
        </Button>
      </div>
    );
  }

  const qaFlags = call.qa_flags;
  const score = qaFlags?.score ?? null;

  return (
    <div className="min-h-screen bg-[#09090b]">
      {/* Header */}
      <div className="border-b border-zinc-800 bg-zinc-900/50">
        <div className="max-w-7xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => router.push("/calls")}
                className="text-zinc-400 hover:text-zinc-100"
              >
                <ArrowLeft className="h-4 w-4 mr-2" />
                Back
              </Button>
              <div className="h-6 w-px bg-zinc-800" />
              <div>
                <div className="flex items-center gap-3">
                  <h1 className="text-lg font-semibold text-zinc-100 font-mono">
                    {call.id.slice(0, 12)}...
                  </h1>
                  <StatusBadge status={call.status} />
                </div>
                <p className="text-sm text-zinc-500">{formatDate(call.start_time_utc)}</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {call.status === "flagged" && (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={updating}
                  onClick={() => handleStatusUpdate("safe")}
                  className="text-emerald-400 border-emerald-400/30 hover:bg-emerald-400/10"
                >
                  {updating ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  ) : (
                    <CheckCircle className="h-4 w-4 mr-2" />
                  )}
                  Mark Safe
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-7xl mx-auto px-6 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Main Content */}
          <div className="lg:col-span-2 space-y-6">
            {/* Audio Player */}
            <div className="bg-zinc-900 rounded-lg border border-zinc-800 p-6">
              <h2 className="text-sm font-medium text-zinc-400 mb-4">Audio Recording</h2>
              {audioLoading ? (
                <div className="flex items-center gap-2 text-zinc-500">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span className="text-sm">Loading audio...</span>
                </div>
              ) : audioUrl ? (
                <audio src={audioUrl} controls className="w-full" />
              ) : (
                <p className="text-sm text-zinc-500">No audio available</p>
              )}
            </div>

            {/* Transcript */}
            <div className="bg-zinc-900 rounded-lg border border-zinc-800 p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-sm font-medium text-zinc-400">Transcript</h2>
                {call.transcript_text && (
                  <span className="text-xs text-zinc-600">
                    {call.transcript_text.length.toLocaleString()} characters
                  </span>
                )}
              </div>
              <div className="bg-zinc-950 rounded-lg p-4 max-h-[500px] overflow-y-auto border border-zinc-800">
                <div className="text-sm text-zinc-300 whitespace-pre-wrap">
                  {renderTranscript()}
                </div>
              </div>
            </div>
          </div>

          {/* Sidebar */}
          <div className="space-y-6">
            {/* QA Score */}
            {score !== null && (
              <div className="bg-zinc-900 rounded-lg border border-zinc-800 p-6">
                <h2 className="text-sm font-medium text-zinc-400 mb-4">QA Score</h2>
                <div className="flex items-center justify-center">
                  <ScoreRing score={score} />
                </div>
                {qaFlags?.summary && (
                  <p className="mt-4 text-sm text-zinc-400 text-center">
                    {qaFlags.summary}
                  </p>
                )}
              </div>
            )}

            {/* Call Metadata */}
            <div className="grid grid-cols-2 gap-3">
              <StatCard
                icon={Clock}
                label="Duration"
                value={call.duration_seconds ? formatDuration(call.duration_seconds) : "—"}
              />
              <StatCard
                icon={DollarSign}
                label="Revenue"
                value={call.revenue ? `$${Number(call.revenue).toFixed(2)}` : "$0.00"}
              />
              <StatCard
                icon={User}
                label="Caller"
                value={call.caller_number || "Unknown"}
              />
              <StatCard
                icon={Shield}
                label="Risk"
                value={qaFlags?.customer_sentiment || "—"}
              />
            </div>

            {/* Issues */}
            {qaFlags?.compliance_issues && qaFlags.compliance_issues.length > 0 && (
              <div className="bg-zinc-900 rounded-lg border border-zinc-800 p-6">
                <h2 className="text-sm font-medium text-zinc-400 mb-4 flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-amber-400" />
                  Issues Detected ({qaFlags.compliance_issues.length})
                </h2>
                <div className="space-y-3">
                  {qaFlags.compliance_issues.map((issue, i) => (
                    <div
                      key={i}
                      className="p-3 rounded-lg bg-zinc-950 border border-zinc-800"
                    >
                      <p className="text-sm text-zinc-300">{issue}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Processing Error */}
            {call.processing_error && (
              <div className="bg-red-500/10 rounded-lg border border-red-500/20 p-4">
                <h2 className="text-sm font-medium text-red-400 mb-2">Processing Error</h2>
                <p className="text-sm text-red-300 font-mono">{call.processing_error}</p>
              </div>
            )}

            {/* Metadata */}
            <div className="bg-zinc-900 rounded-lg border border-zinc-800 p-6">
              <h2 className="text-sm font-medium text-zinc-400 mb-4 flex items-center gap-2">
                <MessageSquare className="h-4 w-4" />
                Metadata
              </h2>
              <dl className="space-y-3 text-sm">
                <div className="flex justify-between">
                  <dt className="text-zinc-500">Ringba ID</dt>
                  <dd className="text-zinc-300 font-mono text-xs">{call.ringba_call_id.slice(0, 16)}...</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-zinc-500">QA Version</dt>
                  <dd className="text-zinc-300">{call.qa_version || "—"}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-zinc-500">Model</dt>
                  <dd className="text-zinc-300">{call.judge_model || "—"}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-zinc-500">Updated</dt>
                  <dd className="text-zinc-300">{formatDate(call.updated_at)}</dd>
                </div>
              </dl>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
