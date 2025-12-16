import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export async function GET() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  const supabase = createClient(supabaseUrl, supabaseAnonKey);

  try {
    // Get today's date in UTC (YYYY-MM-DD format)
    const todayString = new Date().toISOString().slice(0, 10);

    // Query 1: Total calls today
    const { count: totalCallsToday, error: totalError } = await supabase
      .from("ringba_calls_latest")
      .select("*", { count: "exact", head: true })
      .eq("day_bucket", todayString);

    if (totalError) {
      console.error("Error fetching total calls", totalError);
      return NextResponse.json(
        { error: "failed_to_fetch_recording_summary" },
        { status: 500 }
      );
    }

    // Query 2: Calls with recordings today
    const { count: callsWithRecordingsToday, error: recordingsError } =
      await supabase
        .from("ringba_calls_latest")
        .select("*", { count: "exact", head: true })
        .eq("day_bucket", todayString)
        .eq("has_recording", true);

    if (recordingsError) {
      console.error("Error fetching calls with recordings", recordingsError);
      return NextResponse.json(
        { error: "failed_to_fetch_recording_summary" },
        { status: 500 }
      );
    }

    const total = totalCallsToday ?? 0;
    const withRecordings = callsWithRecordingsToday ?? 0;

    // Calculate coverage percentage (avoid division by zero)
    const recordingCoveragePct =
      total > 0 ? Math.round((withRecordings / total) * 1000) / 10 : 0;

    return NextResponse.json({
      total_calls_today: total,
      calls_with_recordings_today: withRecordings,
      recording_coverage_pct: recordingCoveragePct,
    });
  } catch (err) {
    console.error("Unexpected error in recordings-summary", err);
    return NextResponse.json(
      { error: "failed_to_fetch_recording_summary" },
      { status: 500 }
    );
  }
}

