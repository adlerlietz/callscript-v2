import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export async function GET() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  const supabase = createClient(supabaseUrl, supabaseAnonKey);

  const { data, error } = await supabase
    .from("calls_overview")
    .select("*")
    .order("start_time_utc", { ascending: false })
    .limit(100);

  if (error) {
    console.error("Error fetching latest calls", error);
    return NextResponse.json(
      { error: "failed_to_fetch_calls" },
      { status: 500 }
    );
  }

  return NextResponse.json({ calls: data ?? [] });
}

