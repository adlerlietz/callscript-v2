import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const limit = parseInt(searchParams.get("limit") || "100", 10);
  const offset = parseInt(searchParams.get("offset") || "0", 10);

  const { data, error, count } = await supabase
    .from("calls_overview")
    .select("*", { count: "exact" })
    .eq("status", "flagged")
    .order("start_time_utc", { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) {
    console.error("Error fetching flagged calls:", error);
    return NextResponse.json({ error: "Failed to fetch flags" }, { status: 500 });
  }

  return NextResponse.json({
    flags: data ?? [],
    total: count ?? 0,
    limit,
    offset,
  });
}
