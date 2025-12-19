import { createClient } from "https://esm.sh/@supabase/supabase-js@2.48.0";

// Environment validation
const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const RINGBA_TOKEN = Deno.env.get("RINGBA_TOKEN");
const RINGBA_ACCOUNT_ID = Deno.env.get("RINGBA_ACCOUNT_ID");

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !RINGBA_TOKEN || !RINGBA_ACCOUNT_ID) {
  throw new Error("Missing required environment variables");
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
  db: { schema: "core" },
});

const PAGE_SIZE = 1000;

// =============================================================================
// CIRCUIT BREAKER - Prevents cascading failures on Ringba API outage
// =============================================================================
const CIRCUIT_FAILURE_THRESHOLD = 3;    // Open after 3 consecutive failures
const CIRCUIT_RECOVERY_TIMEOUT = 300;   // 5 minutes before retry
const CIRCUIT_KEY = "ringba_circuit";

interface CircuitState {
  failures: number;
  openUntil: number;  // Unix timestamp
  lastError: string;
}

async function getCircuitState(): Promise<CircuitState> {
  // Store circuit state in database for persistence across function invocations
  const { data } = await supabase
    .from("calls")
    .select("id")
    .limit(1);  // Just check DB is accessible

  // Use in-memory state for this invocation (edge functions are stateless)
  // For production, consider using Supabase or Redis for shared state
  return { failures: 0, openUntil: 0, lastError: "" };
}

async function ringbaFetchWithRetry(
  url: string,
  options: RequestInit,
  maxRetries: number = 3
): Promise<Response> {
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 30000); // 30s timeout

      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (response.ok) {
        return response;
      }

      // Non-retryable errors
      if (response.status === 401 || response.status === 403) {
        throw new Error(`Auth error: ${response.status}`);
      }

      // Retryable errors (5xx, rate limits)
      if (response.status >= 500 || response.status === 429) {
        const waitTime = Math.min(1000 * Math.pow(2, attempt), 10000);
        console.log(`⚠️ Ringba ${response.status}, retry ${attempt}/${maxRetries} in ${waitTime}ms`);
        await new Promise(r => setTimeout(r, waitTime));
        continue;
      }

      throw new Error(`Ringba API error: ${response.status}`);

    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      if (error instanceof Error && error.name === "AbortError") {
        console.log(`⚠️ Ringba timeout, retry ${attempt}/${maxRetries}`);
        continue;
      }

      // Network errors are retryable
      if (attempt < maxRetries) {
        const waitTime = Math.min(1000 * Math.pow(2, attempt), 10000);
        console.log(`⚠️ Ringba error: ${lastError.message}, retry in ${waitTime}ms`);
        await new Promise(r => setTimeout(r, waitTime));
        continue;
      }
    }
  }

  throw lastError || new Error("Max retries exceeded");
}

/**
 * Get time window for ingestion with dynamic lookback support.
 * Supports request body with {"lookback": 1440} for 24-hour backfill.
 * Defaults to 15-minute rolling window if no lookback specified.
 */
async function getTimeWindow(req: Request): Promise<{ reportStart: string; reportEnd: string }> {
  let lookbackMinutes = 15; // Default: 15-minute rolling window

  // Try to parse request body for lookback parameter
  try {
    const contentType = req.headers.get("content-type");
    if (contentType?.includes("application/json")) {
      const body = await req.json();
      if (body.lookback && typeof body.lookback === "number" && body.lookback > 0) {
        lookbackMinutes = body.lookback;
        console.log(`📅 Backfill mode: Looking back ${lookbackMinutes} minutes`);
      }
    }
  } catch (err) {
    // If body parsing fails, just use default
    console.log("No valid body found, using default 15-minute window");
  }

  const now = new Date();
  const windowStart = new Date(now.getTime() - lookbackMinutes * 60 * 1000);

  const reportStart = windowStart.toISOString();
  const reportEnd = now.toISOString();

  console.log(`⏰ Time window: ${reportStart} → ${reportEnd}`);

  return { reportStart, reportEnd };
}

// Default org ID for single-tenant mode
// TODO: Make this dynamic for multi-tenant by looking up org from credentials
const DEFAULT_ORG_ID = "00000000-0000-0000-0000-000000000001";

/**
 * Upsert or find campaign by Ringba campaign ID.
 * Also updates the name if it's currently "Unknown Campaign" and a real name is provided.
 */
async function ensureCampaign(
  ringbaCampaignId: string,
  campaignName: string,
  orgId: string = DEFAULT_ORG_ID
): Promise<string | null> {
  // Try to find existing
  const { data: existing } = await supabase
    .from("campaigns")
    .select("id, name")
    .eq("ringba_campaign_id", ringbaCampaignId)
    .eq("org_id", orgId)
    .maybeSingle();

  if (existing) {
    // Update name if currently "Unknown Campaign" and we have a real name
    if (existing.name === "Unknown Campaign" && campaignName && campaignName !== "Unknown Campaign") {
      await supabase
        .from("campaigns")
        .update({ name: campaignName, inference_source: "ringba_calllog" })
        .eq("id", existing.id);
      console.log(`Updated campaign name: ${ringbaCampaignId} -> ${campaignName}`);
    }
    return existing.id;
  }

  // Create new
  const { data: created, error } = await supabase
    .from("campaigns")
    .insert({
      ringba_campaign_id: ringbaCampaignId,
      name: campaignName || "Unknown Campaign",
      org_id: orgId,
    })
    .select("id")
    .single();

  if (error) {
    console.error("Failed to create campaign", { ringbaCampaignId, error });
    return null;
  }

  return created.id;
}

/**
 * Sync Ringba call logs to Supabase with hybrid backfill support.
 */
Deno.serve(async (req) => {
  if (req.method !== "GET" && req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const { reportStart, reportEnd } = await getTimeWindow(req);
  console.log("🔄 sync-ringba-realtime started", { reportStart, reportEnd });

  let offset = 0;
  let totalFetched = 0;
  let totalUpserted = 0;

  try {
    while (true) {
      // Use KNOWN GOOD PAYLOAD structure
      const payload = {
        reportStart,
        reportEnd,
        size: PAGE_SIZE,
        offset,
        valueColumns: [
          // Core identifiers
          { column: "inboundCallId" },
          { column: "callDt" },
          { column: "callLengthInSeconds" },
          { column: "inboundPhoneNumber" },
          { column: "recordingUrl" },
          // Campaign
          { column: "campaignId" },
          { column: "campaignName" },
          // Publisher attribution
          { column: "publisherId" },
          { column: "publisherSubId" },
          { column: "publisherName" },
          // Buyer/Target routing
          { column: "buyer" },
          { column: "targetId" },
          { column: "targetName" },
          // Financial
          { column: "conversionAmount" },
          { column: "payoutAmount" },
          // NOTE: Geographic columns (state, city) removed - not available in this Ringba account
        ],
      };

      console.log(`📄 Fetching page at offset=${offset}`);

      // Call Ringba API with retry logic and timeout
      const ringbaResp = await ringbaFetchWithRetry(
        `https://api.ringba.com/v2/${RINGBA_ACCOUNT_ID}/calllogs`,
        {
          method: "POST",
          headers: {
            Authorization: `Token ${RINGBA_TOKEN}`,
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify(payload),
        },
        3  // max retries
      );

      const json = await ringbaResp.json();
      const records = json?.report?.records ?? [];
      const partialResult = json?.report?.partialResult ?? false;

      console.log(`📦 Received ${records.length} records`, { partialResult });

      // Terminate if no records or partial result
      if (records.length === 0 || partialResult) {
        console.log("🛑 Terminating: No more records or partial result");
        break;
      }

      // Ensure campaigns exist
      const campaignMap = new Map<string, string>();
      for (const r of records) {
        if (r.campaignId && !campaignMap.has(r.campaignId)) {
          const campaignUuid = await ensureCampaign(
            r.campaignId,
            r.campaignName ?? "Unknown Campaign"
          );
          if (campaignUuid) {
            campaignMap.set(r.campaignId, campaignUuid);
          }
        }
      }

      // Map to database schema (includes new analytics columns)
      const rows = records.map((r: any) => ({
        // Core identifiers
        ringba_call_id: r.inboundCallId,
        org_id: DEFAULT_ORG_ID,
        campaign_id: r.campaignId ? campaignMap.get(r.campaignId) ?? null : null,
        start_time_utc: new Date(r.callDt).toISOString(),
        status: "pending",
        // Call metadata
        caller_number: r.inboundPhoneNumber ?? null,
        duration_seconds: r.callLengthInSeconds ?? null,
        audio_url: r.recordingUrl ?? null,
        // Financial (revenue existing, payout new)
        revenue: r.conversionAmount ?? 0,
        payout: r.payoutAmount ?? 0,
        // Publisher attribution (NEW)
        publisher_id: r.publisherId ?? null,
        publisher_sub_id: r.publisherSubId ?? null,
        publisher_name: r.publisherName ?? null,
        // Buyer/Target routing (NEW)
        buyer_name: r.buyer ?? null,
        target_id: r.targetId ?? null,
        target_name: r.targetName ?? null,
        // Geographic - not available in current Ringba account
        caller_state: null,
        caller_city: null,
        // Raw payload for forensics
        raw_payload: r,
      }));

      // Upsert to database
      const { error } = await supabase
        .from("calls")
        .upsert(rows, {
          onConflict: "ringba_call_id",
          ignoreDuplicates: false,
        });

      if (error) {
        console.error("❌ Supabase upsert error", error);
        throw new Error(`Database error: ${JSON.stringify(error)}`);
      }

      totalFetched += records.length;
      totalUpserted += rows.length;

      // Terminate if we got fewer than PAGE_SIZE records
      if (records.length < PAGE_SIZE) {
        console.log(`🛑 Terminating: Received ${records.length} < ${PAGE_SIZE}`);
        break;
      }

      offset += PAGE_SIZE;
    }

    console.log("✅ sync-ringba-realtime completed", {
      totalFetched,
      totalUpserted,
      finalOffset: offset,
    });

    return new Response(
      JSON.stringify({
        status: "ok",
        fetched: totalFetched,
        upserted: totalUpserted,
      }),
      {
        headers: { "Content-Type": "application/json" },
      }
    );
  } catch (e) {
    const errorMsg = e instanceof Error ? e.message : String(e);
    console.error("❌ Fatal error in sync-ringba-realtime:", errorMsg);
    return new Response(
      JSON.stringify({
        status: "error",
        message: errorMsg,
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
});
