import { createClient } from "https://esm.sh/@supabase/supabase-js@2.48.0";

// Match your actual secret names exactly:
const SB_URL = Deno.env.get("SB_URL");
const SB_SERVICE_ROLE = Deno.env.get("SB_SERVICE_ROLE");
const RINGBA_TOKEN = Deno.env.get("RINGBA_TOKEN");
const RINGBA_ACCOUNT_ID = Deno.env.get("RINGBA_ACCOUNT_ID");

if (!SB_URL || !SB_SERVICE_ROLE || !RINGBA_TOKEN || !RINGBA_ACCOUNT_ID) {
  console.error("Missing required environment variables", {
    SB_URL,
    hasServiceRole: !!SB_SERVICE_ROLE,
    hasToken: !!RINGBA_TOKEN,
    hasAccountId: !!RINGBA_ACCOUNT_ID,
  });
}

const supabase = createClient(SB_URL!, SB_SERVICE_ROLE!, {
  auth: { persistSession: false },
  db: { schema: "core" },
});

const PAGE_SIZE = 1000;

function getWindow(req: Request) {
  const url = new URL(req.url);
  const startParam = url.searchParams.get("start");
  const endParam = url.searchParams.get("end");

  if (startParam && endParam) {
    return {
      reportStart: new Date(startParam).toISOString(),
      reportEnd: new Date(endParam).toISOString(),
    };
  }

  const now = new Date();
  const fifteenMinutesAgo = new Date(now.getTime() - 15 * 60 * 1000);

  return {
    reportStart: fifteenMinutesAgo.toISOString(),
    reportEnd: now.toISOString(),
  };
}

Deno.serve(async (req) => {
  if (req.method !== "GET" && req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  try {
    const { reportStart, reportEnd } = getWindow(req);
    console.log("sync-ringba window", { reportStart, reportEnd });

    let offset = 0;
    let totalFetched = 0;

    while (true) {
      const payload = {
        reportStart,
        reportEnd,
        offset,
        size: PAGE_SIZE,
        orderByColumns: [],
        filters: [],
        formatDateTime: true,
        formatPercentages: true,
        formatTimeZone: "America/Denver",
        formatTimespans: true,
        valueColumns: [
          { column: "inboundCallId" },
          { column: "callDt" },
          { column: "campaignName" },
          { column: "publisherName" },
          { column: "inboundPhoneNumber" },
          { column: "recordingUrl" },
        ],
      };

      const ringbaResp = await fetch(
        `https://api.ringba.com/v2/${RINGBA_ACCOUNT_ID}/calllogs`,
        {
          method: "POST",
          headers: {
            Authorization: `Token ${RINGBA_TOKEN}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
        }
      );

      if (!ringbaResp.ok) {
        const err = await ringbaResp.text();
        console.error("Ringba error", ringbaResp.status, err);
        return new Response("Ringba error", { status: 502 });
      }

      const json = await ringbaResp.json();
      const records = json?.report?.records ?? [];

      if (!records.length) break;

      const rows = records.map((r: any) => ({
        ringba_call_id: r.inboundCallId,
        start_time_utc: new Date(r.callDt).toISOString(),
        caller_number: r.inboundPhoneNumber,
        audio_url: r.recordingUrl ?? null,
        status: "pending",
      }));

      const { error } = await supabase
        .from("calls")
        .upsert(rows, { onConflict: "ringba_call_id" });

      if (error) {
        console.error("Supabase upsert error", error);
        return new Response("Supabase error", { status: 500 });
      }

      totalFetched += records.length;

      // Stop if we got fewer than PAGE_SIZE records = no more pages
      if (records.length < PAGE_SIZE) {
        break;
      }

      offset += PAGE_SIZE;
    }

    return new Response(
      JSON.stringify({ status: "ok", fetched: totalFetched }),
      {
        headers: { "Content-Type": "application/json" },
      },
    );
  } catch (e) {
    console.error("Unexpected error in sync-ringba", e);
    return new Response("Internal error", { status: 500 });
  }
});
