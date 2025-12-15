import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const status = searchParams.get("status");
  const limit = parseInt(searchParams.get("limit") || "100", 10);
  const offset = parseInt(searchParams.get("offset") || "0", 10);

  // Use the public calls_overview view
  let query = supabase
    .from("calls_overview")
    .select("*", { count: "exact" })
    .order("start_time_utc", { ascending: false })
    .range(offset, offset + limit - 1);

  if (status && status !== "all") {
    query = query.eq("status", status);
  }

  const { data, error, count } = await query;

  if (error) {
    console.error("Error fetching calls:", error);
    return NextResponse.json({ error: "Failed to fetch calls" }, { status: 500 });
  }

  return NextResponse.json({
    calls: data ?? [],
    total: count ?? 0,
    limit,
    offset,
  });
}
