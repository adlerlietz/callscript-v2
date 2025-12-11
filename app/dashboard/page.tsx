"use client";

import { useEffect, useState } from "react";

type RecordingSummary = {
  total_calls_today: number;
  calls_with_recordings_today: number;
  recording_coverage_pct: number;
};

export default function DashboardPage() {
  const [summary, setSummary] = useState<RecordingSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchSummary() {
      try {
        const res = await fetch("/api/dashboard/recordings-summary");
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        const json = await res.json();
        setSummary(json);
      } catch (err) {
        console.error("Failed to fetch recording summary", err);
        setError("Failed to load dashboard data");
      } finally {
        setLoading(false);
      }
    }

    fetchSummary();
  }, []);

  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold mb-6">Dashboard</h1>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {/* Recording Coverage Card */}
        <div className="bg-white border border-gray-200 rounded-lg shadow-sm p-6">
          <h2 className="text-sm font-medium text-gray-500 uppercase tracking-wide mb-4">
            Recording Coverage (Today)
          </h2>

          {loading && (
            <div className="animate-pulse space-y-3">
              <div className="h-4 bg-gray-200 rounded w-3/4"></div>
              <div className="h-4 bg-gray-200 rounded w-1/2"></div>
              <div className="h-8 bg-gray-200 rounded w-1/3"></div>
            </div>
          )}

          {error && <p className="text-red-500 text-sm">{error}</p>}

          {!loading && !error && summary && (
            <div className="space-y-2">
              <p className="text-gray-700">
                <span className="font-medium">Total calls:</span>{" "}
                <span className="text-lg">{summary.total_calls_today}</span>
              </p>
              <p className="text-gray-700">
                <span className="font-medium">With recordings:</span>{" "}
                <span className="text-lg">
                  {summary.calls_with_recordings_today}
                </span>
              </p>
              <p className="mt-4">
                <span
                  className={`text-3xl font-bold ${
                    summary.recording_coverage_pct >= 80
                      ? "text-green-600"
                      : summary.recording_coverage_pct >= 50
                      ? "text-yellow-600"
                      : "text-red-600"
                  }`}
                >
                  {summary.recording_coverage_pct}%
                </span>
                <span className="text-gray-500 text-sm ml-2">coverage</span>
              </p>
            </div>
          )}
        </div>

        {/* Placeholder cards for future stats */}
        <div className="bg-white border border-gray-200 rounded-lg shadow-sm p-6 opacity-50">
          <h2 className="text-sm font-medium text-gray-500 uppercase tracking-wide mb-4">
            Flagged Calls
          </h2>
          <p className="text-gray-400 text-sm">Coming soon...</p>
        </div>

        <div className="bg-white border border-gray-200 rounded-lg shadow-sm p-6 opacity-50">
          <h2 className="text-sm font-medium text-gray-500 uppercase tracking-wide mb-4">
            Processing Queue
          </h2>
          <p className="text-gray-400 text-sm">Coming soon...</p>
        </div>
      </div>
    </div>
  );
}

