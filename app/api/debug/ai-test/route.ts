import { NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";

export async function GET(req: NextRequest) {
  const results: Record<string, any> = {};

  // Test 1: Check env vars
  results.env = {
    NEXT_PUBLIC_SUPABASE_URL: !!process.env.NEXT_PUBLIC_SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
    OPENAI_API_KEY: !!process.env.OPENAI_API_KEY,
    OPENAI_API_KEY_PREFIX: process.env.OPENAI_API_KEY?.substring(0, 15) + "...",
  };

  // Test 2: Test Supabase RPC
  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const { data, error } = await supabase.schema("core").rpc("get_leaderboard", {
      p_org_id: "00000000-0000-0000-0000-000000000001",
      p_dimension: "state",
      p_metric: "rpc",
      p_start_date: "2025-12-01",
      p_end_date: "2025-12-19",
      p_vertical_filter: "aca",
      p_state_filter: null,
      p_min_calls: 10,
    });

    if (error) {
      results.supabase = { error: error.message };
    } else {
      results.supabase = { success: true, top3: data?.slice(0, 3) };
    }
  } catch (e) {
    results.supabase = { exception: String(e) };
  }

  // Test 3: Test OpenRouter API
  try {
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "openai/gpt-4o",
        messages: [{ role: "user", content: "Say 'test ok' and nothing else" }],
        max_tokens: 10,
      }),
    });

    const data = await response.json();
    if (response.ok) {
      results.openrouter = {
        success: true,
        response: data.choices?.[0]?.message?.content
      };
    } else {
      results.openrouter = { error: data };
    }
  } catch (e) {
    results.openrouter = { exception: String(e) };
  }

  return new Response(JSON.stringify(results, null, 2), {
    headers: { "Content-Type": "application/json" }
  });
}
