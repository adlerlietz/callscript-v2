"use client";

import { useEffect, useState } from "react";

type Call = {
  ringba_call_id: string;
  start_time_utc: string;
  caller_number: string | null;
  audio_url: string | null;
  status: string | null;
  has_recording: boolean | null;
  day_bucket: string | null;
  hour_bucket: number | null;
  source: string | null;
};

export default function CallsPage() {
  const [calls, setCalls] = useState<Call[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchCalls() {
      try {
        const res = await fetch("/api/calls/latest");
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        const json = await res.json();
        setCalls(json.calls ?? []);
      } catch (err) {
        console.error("Failed to fetch calls", err);
        setError("Failed to load calls");
      } finally {
        setLoading(false);
      }
    }

    fetchCalls();
  }, []);

  if (loading) {
    return (
      <div className="p-8">
        <h1 className="text-2xl font-bold mb-4">Calls</h1>
        <p className="text-gray-500">Loading...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-8">
        <h1 className="text-2xl font-bold mb-4">Calls</h1>
        <p className="text-red-500">{error}</p>
      </div>
    );
  }

  if (calls.length === 0) {
    return (
      <div className="p-8">
        <h1 className="text-2xl font-bold mb-4">Calls</h1>
        <p className="text-gray-500">No calls found</p>
      </div>
    );
  }

  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold mb-4">Calls</h1>
      <p className="text-sm text-gray-500 mb-4">
        Showing {calls.length} most recent calls
      </p>

      <div className="overflow-x-auto">
        <table className="min-w-full border border-gray-200 text-sm">
          <thead className="bg-gray-100">
            <tr>
              <th className="px-4 py-2 text-left font-medium">Time</th>
              <th className="px-4 py-2 text-left font-medium">Caller</th>
              <th className="px-4 py-2 text-left font-medium">Has Recording</th>
              <th className="px-4 py-2 text-left font-medium">Status</th>
              <th className="px-4 py-2 text-left font-medium">Source</th>
            </tr>
          </thead>
          <tbody>
            {calls.map((call) => (
              <tr
                key={call.ringba_call_id}
                className="border-t border-gray-200 hover:bg-gray-50"
              >
                <td className="px-4 py-2 whitespace-nowrap">
                  {new Date(call.start_time_utc).toLocaleString()}
                </td>
                <td className="px-4 py-2 whitespace-nowrap font-mono">
                  {call.caller_number ?? "—"}
                </td>
                <td className="px-4 py-2">
                  {call.has_recording ? (
                    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-800">
                      Yes
                    </span>
                  ) : (
                    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-600">
                      No
                    </span>
                  )}
                </td>
                <td className="px-4 py-2">
                  <span
                    className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                      call.status === "pending"
                        ? "bg-yellow-100 text-yellow-800"
                        : call.status === "flagged"
                        ? "bg-red-100 text-red-800"
                        : call.status === "safe"
                        ? "bg-green-100 text-green-800"
                        : "bg-gray-100 text-gray-600"
                    }`}
                  >
                    {call.status ?? "unknown"}
                  </span>
                </td>
                <td className="px-4 py-2 text-gray-600">
                  {call.source ?? "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

