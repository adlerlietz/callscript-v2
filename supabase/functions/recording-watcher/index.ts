import { createClient } from "https://esm.sh/@supabase/supabase-js@2.48.0";

type CallRow = {
  id: string;
  ringba_call_id: string;
  audio_url: string | null;
  status: string | null;
  start_time_utc: string;
};

Deno.serve(async (req) => {
  const url = new URL(req.url);

  // 🔐 Allow either:
  //  1) Cron with Bearer token
  //  2) Local debug via ?local=1
  const authHeader = req.headers.get("authorization") ?? "";
  const cronSecret = Deno.env.get("CRON_SECRET");

  const isCron =
    !!cronSecret && authHeader === `Bearer ${cronSecret}`;
  const isLocal = url.searchParams.get("local") === "1";

  if (!isCron && !isLocal) {
    return new Response(
      JSON.stringify({ error: "unauthorized" }),
      { status: 401, headers: { "content-type": "application/json" } },
    );
  }

  const minutes = Number(url.searchParams.get("minutes") ?? "60");
  const since = new Date(Date.now() - minutes * 60_000).toISOString();

  console.log("🎧 recording-watcher window", { since, minutes });

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !serviceKey) {
    console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
    return new Response(
      JSON.stringify({ error: "missing Supabase env" }),
      { status: 500, headers: { "content-type": "application/json" } },
    );
  }

  const supabase = createClient(supabaseUrl, serviceKey, {
    db: { schema: "core" },
  });

  try {
    // 1) Find recent calls with recordings that are still pending
    const { data, error } = await supabase
      .from("calls")
      .select("id, ringba_call_id, audio_url, status, start_time_utc")
      .gt("start_time_utc", since)
      .not("audio_url", "is", null)
      .eq("status", "pending")
      .limit(500);

    if (error) {
      console.error("Supabase select error", error);
      return new Response(
        JSON.stringify({ error: "supabase_select_error", details: error }),
        { status: 500, headers: { "content-type": "application/json" } },
      );
    }

    const calls = (data ?? []) as CallRow[];

    if (calls.length === 0) {
      console.log("🎧 No calls to queue");
      return new Response(
        JSON.stringify({ status: "ok", found: 0, updated: 0 }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }

    const ids = calls.map((c) => c.id);

    // 2) Update timestamp (status stays pending until worker picks it up)
    const { error: updateError } = await supabase
      .from("calls")
      .update({ updated_at: new Date().toISOString() })
      .in("id", ids);

    if (updateError) {
      console.error("Supabase update error", updateError);
      return new Response(
        JSON.stringify({ error: "supabase_update_error", details: updateError }),
        { status: 500, headers: { "content-type": "application/json" } },
      );
    }

    console.log("🎧 recording-watcher queued calls", {
      found: calls.length,
      ids,
    });

    return new Response(
      JSON.stringify({
        status: "ok",
        found: calls.length,
        updated: ids.length,
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  } catch (e) {
    console.error("recording-watcher fatal error", e);
    return new Response(
      JSON.stringify({ error: "unexpected_error" }),
      { status: 500, headers: { "content-type": "application/json" } },
    );
  }
});
