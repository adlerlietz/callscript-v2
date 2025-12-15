import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const { data, error } = await supabase
    .from("calls_overview")
    .select("*")
    .eq("id", id)
    .single();

  if (error) {
    console.error("Error fetching call:", error);
    return NextResponse.json({ error: "Call not found" }, { status: 404 });
  }

  return NextResponse.json({ call: data });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  // Note: Updates require service_role or auth - return mock success for demo
  const { id } = await params;
  const body = await request.json();

  // For demo purposes, acknowledge the request
  // In production, this would use supabaseCore with service_role
  console.log(`Would update call ${id} with:`, body);

  return NextResponse.json({
    call: { id, ...body },
    message: "Update acknowledged (requires service_role for production)",
  });
}
