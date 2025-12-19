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
 * Fetch audio with retry and fallback logic.
 * Handles transient failures and 404s gracefully.
 */
async function fetchAudioWithRetry(
  url: string,
  callId: string,
  maxRetries: number = 3
): Promise<Response | null> {
  let lastError: string = "";

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 60000); // 60s timeout

      const response = await fetch(url, {
        method: "GET",
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (response.ok) {
        return response;
      }

      // Permanent failures - don't retry
      if (response.status === 404 || response.status === 403 || response.status === 410) {
        console.warn(`⚠️ Audio permanently unavailable for ${callId}: HTTP ${response.status}`);
        return null;
      }

      // Transient failures - retry with backoff
      if (response.status >= 500 || response.status === 429) {
        const waitTime = Math.min(1000 * Math.pow(2, attempt), 10000);
        console.log(`⚠️ Audio fetch ${response.status}, retry ${attempt}/${maxRetries} in ${waitTime}ms`);
        await new Promise(r => setTimeout(r, waitTime));
        continue;
      }

      lastError = `HTTP ${response.status}: ${response.statusText}`;

    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);

      if (error instanceof Error && error.name === "AbortError") {
        console.log(`⚠️ Audio fetch timeout for ${callId}, retry ${attempt}/${maxRetries}`);
        if (attempt < maxRetries) {
          await new Promise(r => setTimeout(r, 2000));
          continue;
        }
      }

      // Network errors - retry
      if (attempt < maxRetries) {
        const waitTime = Math.min(1000 * Math.pow(2, attempt), 10000);
        console.log(`⚠️ Audio fetch error: ${lastError}, retry in ${waitTime}ms`);
        await new Promise(r => setTimeout(r, waitTime));
        continue;
      }
    }
  }

  throw new Error(`Audio fetch failed after ${maxRetries} attempts: ${lastError}`);
}

/**
 * Process a single call: Lock → Download audio → Upload to Storage → Update DB
 *
 * Atomic locking ensures only one worker processes each call:
 * - Lock acquired via UPDATE with WHERE status='pending' AND storage_path IS NULL
 * - .select("id") returns affected rows; empty array = lock failed
 * - On success: storage_path set to final path
 * - On failure: storage_path reset to NULL (releases lock)
 */
async function processCall(call: CallRecord): Promise<void> {
  const storagePath = getStoragePath(call.id, call.start_time_utc);
  const lockValue = `vault_lock:${call.id.slice(0, 8)}`;

  // ==========================================================================
  // STEP 0: Atomic lock - claim this call
  // ==========================================================================
  // Uses .select("id") to get affected rows. In Supabase JS v2:
  // - If UPDATE matches rows: returns { data: [{id: "..."}], error: null }
  // - If UPDATE matches no rows: returns { data: [], error: null }
  // This is atomic: only one concurrent worker can succeed.
  const { data: lockData, error: lockError } = await supabase
    .from("calls")
    .update({
      storage_path: lockValue,
      updated_at: new Date().toISOString(),
    })
    .eq("id", call.id)
    .eq("status", "pending")
    .is("storage_path", null)
    .select("id");

  if (lockError) {
    console.error(`❌ Lock error for ${call.ringba_call_id}:`, lockError.message);
    return;
  }

  // Lock failed - another worker claimed this call
  if (!lockData || lockData.length === 0) {
    console.log(`⏭️ Skipping ${call.ringba_call_id} - claimed by another worker`);
    return;
  }

  console.log(`🔒 Locked ${call.ringba_call_id}`);

  try {
    // ==========================================================================
    // STEP 1: Fetch audio from Ringba
    // ==========================================================================
    const audioResp = await fetchAudioWithRetry(call.audio_url, call.ringba_call_id);

    // Handle permanent 404/403/410 - release lock and mark as failed
    if (audioResp === null) {
      console.warn(`⚠️ Audio not available for ${call.ringba_call_id}, marking as failed`);
      await supabase
        .from("calls")
        .update({
          storage_path: null, // Release lock
          status: "failed",
          processing_error: "Audio file not available (404/403/410)",
          updated_at: new Date().toISOString(),
        })
        .eq("id", call.id);
      return;
    }

    // VALIDATION: Check Content-Length
    const contentLength = parseInt(audioResp.headers.get("Content-Length") || "0");
    if (contentLength === 0) {
      console.warn(`⚠️ Empty file for call ${call.ringba_call_id}`);
      await supabase
        .from("calls")
        .update({
          storage_path: null, // Release lock
          status: "failed",
          processing_error: "Empty audio file (Content-Length: 0)",
          updated_at: new Date().toISOString(),
        })
        .eq("id", call.id);
      return;
    }

    // ==========================================================================
    // STEP 2: Upload to Supabase Storage
    // ==========================================================================
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

    // ==========================================================================
    // STEP 3: Update DB with success status
    // ==========================================================================
    // COST OPTIMIZATION: Skip AI for very short calls (< 5 seconds)
    if (call.duration_seconds !== null && call.duration_seconds < 5) {
      console.log(`⏭️ Skipping AI for very short call ${call.ringba_call_id} (${call.duration_seconds}s)`);
      await supabase
        .from("calls")
        .update({
          storage_path: storagePath, // Overwrites lock value with real path
          status: "safe",
          processing_error: "Auto-marked safe: duration < 5s",
          updated_at: new Date().toISOString(),
        })
        .eq("id", call.id);
      return;
    }

    // SUCCESS: Mark as downloaded
    await supabase
      .from("calls")
      .update({
        storage_path: storagePath, // Overwrites lock value with real path
        status: "downloaded",
        updated_at: new Date().toISOString(),
      })
      .eq("id", call.id);

    console.log(`✅ Stored ${call.ringba_call_id} at ${storagePath}`);

  } catch (err) {
    // ==========================================================================
    // TRANSIENT ERROR: Release lock, keep status='pending' for retry
    // ==========================================================================
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error(`❌ Failed to process call ${call.ringba_call_id}:`, errorMsg);

    await supabase
      .from("calls")
      .update({
        storage_path: null, // Release lock - call remains pending for retry
        processing_error: `Vault error: ${errorMsg}`,
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
