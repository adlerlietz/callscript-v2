import { createClient } from "https://esm.sh/@supabase/supabase-js@2.48.0";

// Environment validation
const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("Missing required environment variables");
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
  db: { schema: "core" },
});

const STORAGE_BUCKET = "calls_audio";
const BATCH_SIZE = 50;

type CallRecord = {
  id: string;
  ringba_call_id: string;
  audio_url: string;
  duration_seconds: number | null;
  start_time_utc: string;
};

/**
 * Generate storage path: {YYYY}/{MM}/{DD}/{call_id}.mp3
 */
function getStoragePath(callId: string, timestamp: string): string {
  const date = new Date(timestamp);
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");

  return `${year}/${month}/${day}/${callId}.mp3`;
}

/**
 * Process a single call: Download audio → Upload to Storage → Update DB
 */
async function processCall(call: CallRecord): Promise<void> {
  const storagePath = getStoragePath(call.id, call.start_time_utc);

  try {
    console.log(`📦 Processing call ${call.ringba_call_id}`);

    // Fetch audio from Ringba
    const audioResp = await fetch(call.audio_url, {
      method: "GET",
      signal: AbortSignal.timeout(60000), // 60s timeout
    });

    if (!audioResp.ok) {
      throw new Error(`HTTP ${audioResp.status}: ${audioResp.statusText}`);
    }

    // VALIDATION: Check Content-Length
    const contentLength = parseInt(audioResp.headers.get("Content-Length") || "0");
    if (contentLength === 0) {
      console.warn(`⚠️ Empty file for call ${call.ringba_call_id}`);
      await supabase
        .from("calls")
        .update({
          status: "failed",
          processing_error: "Empty audio file (Content-Length: 0)",
          updated_at: new Date().toISOString(),
        })
        .eq("id", call.id);
      return;
    }

    // Stream to Supabase Storage
    const audioBlob = await audioResp.blob();
    const { error: uploadError } = await supabase.storage
      .from(STORAGE_BUCKET)
      .upload(storagePath, audioBlob, {
        contentType: "audio/mpeg",
        upsert: true, // Allow re-processing
      });

    if (uploadError) {
      throw new Error(`Storage upload failed: ${uploadError.message}`);
    }

    // COST OPTIMIZATION: Skip AI for very short calls (< 15 seconds)
    if (call.duration_seconds !== null && call.duration_seconds < 15) {
      console.log(`⏭️ Skipping AI for short call ${call.ringba_call_id} (${call.duration_seconds}s)`);
      await supabase
        .from("calls")
        .update({
          storage_path: storagePath,
          status: "safe",
          processing_error: "Auto-marked safe: duration < 15s",
          updated_at: new Date().toISOString(),
        })
        .eq("id", call.id);
      return;
    }

    // SUCCESS: Mark as downloaded
    await supabase
      .from("calls")
      .update({
        storage_path: storagePath,
        status: "downloaded",
        updated_at: new Date().toISOString(),
      })
      .eq("id", call.id);

    console.log(`✅ Stored ${call.ringba_call_id} at ${storagePath}`);
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error(`❌ Failed to process call ${call.ringba_call_id}:`, errorMsg);

    // Update DB with error
    await supabase
      .from("calls")
      .update({
        processing_error: `Vault error: ${errorMsg}`,
        retry_count: supabase.rpc("increment", { row_id: call.id }), // Increment retry
        updated_at: new Date().toISOString(),
      })
      .eq("id", call.id);
  }
}

/**
 * Vault Lane: Download audio from Ringba → Store in Supabase Storage
 */
Deno.serve(async (req) => {
  console.log("🎧 recording-watcher started");

  try {
    // INVARIANT: LIFO ordering (newest calls first)
    const { data: calls, error } = await supabase
      .from("calls")
      .select("id, ringba_call_id, audio_url, duration_seconds, start_time_utc")
      .eq("status", "pending")
      .not("audio_url", "is", null)
      .is("storage_path", null)
      .order("start_time_utc", { ascending: false })
      .limit(BATCH_SIZE);

    if (error) {
      console.error("❌ Database query error", error);
      return new Response(
        JSON.stringify({ error: "database_error", details: error }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }

    if (!calls || calls.length === 0) {
      console.log("✅ No calls to process");
      return new Response(
        JSON.stringify({ status: "ok", processed: 0 }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }

    console.log(`📋 Found ${calls.length} calls to vault`);

    // BATCHING: Process all calls in parallel
    await Promise.all(calls.map((call) => processCall(call as CallRecord)));

    console.log(`✅ recording-watcher completed: ${calls.length} processed`);

    return new Response(
      JSON.stringify({
        status: "ok",
        processed: calls.length,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("❌ Unexpected error in recording-watcher", err);
    return new Response(
      JSON.stringify({ error: "unexpected_error" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
});
