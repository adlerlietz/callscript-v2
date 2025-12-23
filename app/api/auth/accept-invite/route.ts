import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createClient as createServerClient } from "@/lib/supabase/server";

// Admin client to bypass RLS
function createAdminSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { db: { schema: "core" } }
  );
}

/**
 * POST /api/auth/accept-invite
 * Sets accepted_at for the current user's pending org membership.
 * Called after invite OTP verification.
 */
export async function POST() {
  // Get current user from session
  const supabase = await createServerClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const adminSupabase = createAdminSupabase();

  // Update accepted_at for any pending memberships
  const { data, error } = await adminSupabase
    .from("organization_members")
    .update({ accepted_at: new Date().toISOString() })
    .eq("user_id", user.id)
    .is("accepted_at", null)
    .select("id, org_id");

  if (error) {
    console.error("[Accept Invite] Error:", error);
    return NextResponse.json({ error: "Failed to accept invite" }, { status: 500 });
  }

  console.log("[Accept Invite] Accepted memberships:", data?.length || 0);

  return NextResponse.json({
    success: true,
    accepted: data?.length || 0
  });
}
