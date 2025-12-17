import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAuthContext } from "@/lib/supabase/auth";

/**
 * GET /api/calls/[id]/audio
 * Returns a signed URL for the call's audio file.
 * Verifies user auth and org ownership before generating URL.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  // Verify user is authenticated and has org context
  const auth = await getAuthContext();
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const supabase = await createClient();

  // Fetch call to verify ownership and get storage_path
  const { data: call, error: fetchError } = await supabase
    .from("calls_overview")
    .select("id, org_id, storage_path, audio_url")
    .eq("id", id)
    .eq("org_id", auth.orgId)
    .single();

  if (fetchError || !call) {
    return NextResponse.json({ error: "Call not found" }, { status: 404 });
  }

  // Try storage signed URL first, then fallback to Ringba URL
  if (call.storage_path) {
    const { data, error } = await supabase.storage
      .from("calls_audio")
      .createSignedUrl(call.storage_path, 3600); // 1 hour expiry

    if (!error && data?.signedUrl) {
      return NextResponse.json({ url: data.signedUrl, source: "storage" });
    }
    // Storage failed - log and fallback
    console.warn("Storage URL generation failed:", error?.message);
  }

  // Fallback to Ringba URL
  if (call.audio_url) {
    return NextResponse.json({ url: call.audio_url, source: "ringba" });
  }

  return NextResponse.json(
    { error: "No audio available for this call" },
    { status: 404 }
  );
}
