import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

/**
 * Creates Supabase clients on-demand (not at module load time).
 * This avoids build errors when env vars aren't available during static analysis.
 */
function getSupabaseClients() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  // Public client for reading from views
  const supabase = createClient(supabaseUrl, supabaseAnonKey);

  // Admin client for writing to core schema (if key available)
  const supabaseAdmin = supabaseServiceKey
    ? createClient(supabaseUrl, supabaseServiceKey, { db: { schema: "core" } })
    : null;

  return { supabase, supabaseAdmin };
}

/**
 * GET /api/calls/[id]
 * Fetches a single call by ID from the public view.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const { supabase, supabaseAdmin } = getSupabaseClients();

  // Fetch from public view (read-only)
  const { data: publicData, error: publicError } = await supabase
    .from("calls_overview")
    .select("*")
    .eq("id", id)
    .single();

  if (publicError) {
    console.error("Error fetching call from public view:", publicError);
    return NextResponse.json({ error: "Call not found" }, { status: 404 });
  }

  // If we have admin client, fetch full data from core.calls
  if (supabaseAdmin) {
    const { data: coreData, error: coreError } = await supabaseAdmin
      .from("calls")
      .select(`
        id,
        ringba_call_id,
        campaign_id,
        start_time_utc,
        updated_at,
        caller_number,
        duration_seconds,
        revenue,
        audio_url,
        storage_path,
        status,
        retry_count,
        processing_error,
        transcript_text,
        transcript_segments,
        qa_flags,
        qa_version,
        judge_model
      `)
      .eq("id", id)
      .single();

    if (!coreError && coreData) {
      return NextResponse.json({ call: coreData });
    }
    // Fall through to return public data on error
  }

  return NextResponse.json({ call: publicData });
}

/**
 * PATCH /api/calls/[id]
 * Updates a call's status or other fields.
 * Uses service_role key to write to core schema.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const { supabaseAdmin } = getSupabaseClients();

  // Validate service role key is configured
  if (!supabaseAdmin) {
    console.error("SUPABASE_SERVICE_ROLE_KEY not configured");
    return NextResponse.json(
      { error: "Server configuration error: missing service role key" },
      { status: 500 }
    );
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  // Validate allowed fields to update
  const allowedFields = ["status", "qa_flags", "processing_error"];
  const updateData: Record<string, unknown> = {};

  for (const field of allowedFields) {
    if (field in body) {
      updateData[field] = body[field];
    }
  }

  if (Object.keys(updateData).length === 0) {
    return NextResponse.json(
      { error: "No valid fields to update" },
      { status: 400 }
    );
  }

  // Validate status if provided
  if (updateData.status) {
    const validStatuses = [
      "pending",
      "downloaded",
      "processing",
      "transcribed",
      "flagged",
      "safe",
      "failed",
    ];
    if (!validStatuses.includes(updateData.status as string)) {
      return NextResponse.json(
        { error: `Invalid status. Must be one of: ${validStatuses.join(", ")}` },
        { status: 400 }
      );
    }
  }

  // Add updated_at timestamp
  updateData.updated_at = new Date().toISOString();

  // Perform the update
  const { data, error } = await supabaseAdmin
    .from("calls")
    .update(updateData)
    .eq("id", id)
    .select()
    .single();

  if (error) {
    console.error("Error updating call:", error);
    return NextResponse.json(
      { error: "Failed to update call", details: error.message },
      { status: 500 }
    );
  }

  return NextResponse.json({
    call: data,
    message: "Call updated successfully",
  });
}
