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

/**
 * Upsert or find campaign by Ringba campaign ID.
 */
async function ensureCampaign(
  ringbaCampaignId: string,
  campaignName: string
): Promise<string | null> {
  // Try to find existing
  const { data: existing } = await supabase
    .from("campaigns")
    .select("id")
    .eq("ringba_campaign_id", ringbaCampaignId)
    .maybeSingle();

  if (existing) return existing.id;

  // Create new
  const { data: created, error } = await supabase
    .from("campaigns")
    .insert({
      ringba_campaign_id: ringbaCampaignId,
      name: campaignName || "Unknown Campaign",
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
          { column: "callDt" },
          { column: "inboundPhoneNumber" },
          { column: "buyer" },
          { column: "callLengthInSeconds" },
          { column: "campaignId" },
          { column: "publisherId" },
          { column: "conversionAmount" },
          { column: "payoutAmount" },
          { column: "recordingUrl" },
          { column: "inboundCallId" },
        ],
      };

      console.log(`📄 Fetching page at offset=${offset}`);

      // Call Ringba API with STRICT headers
      const ringbaResp = await fetch(
        `https://api.ringba.com/v2/${RINGBA_ACCOUNT_ID}/calllogs`,
        {
          method: "POST",
          headers: {
            Authorization: `Token ${RINGBA_TOKEN}`,
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify(payload),
        }
      );

      // VERBOSE ERROR HANDLING - Critical for debugging
      if (!ringbaResp.ok) {
        const errorBody = await ringbaResp.text();
        const errorMsg = `Ringba API Error [${ringbaResp.status}]: ${errorBody}`;
        console.error("❌ " + errorMsg);
        throw new Error(errorMsg);
      }

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

      // Map to database schema
      const rows = records.map((r: any) => ({
        ringba_call_id: r.inboundCallId,
        campaign_id: r.campaignId ? campaignMap.get(r.campaignId) ?? null : null,
        start_time_utc: new Date(r.callDt).toISOString(),
        caller_number: r.inboundPhoneNumber ?? null,
        duration_seconds: r.callLengthInSeconds ?? null,
        revenue: r.conversionAmount ?? 0,
        audio_url: r.recordingUrl ?? null,
        status: "pending",
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
