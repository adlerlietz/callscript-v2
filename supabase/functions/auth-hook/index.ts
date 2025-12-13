/**
 * CallScript V2 - Auth Hook
 *
 * Supabase Auth Hook that injects org_id and role into JWT app_metadata.
 * Called automatically on login and token refresh.
 *
 * Setup in Supabase Dashboard:
 *   Authentication → Hooks → Custom Access Token Hook → Select this function
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.48.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

interface AuthHookPayload {
  user_id: string;
  claims: Record<string, unknown>;
  authentication_method: string;
}

Deno.serve(async (req) => {
  try {
    const payload: AuthHookPayload = await req.json();
    const userId = payload.user_id;

    console.log(`🔐 Auth hook triggered for user ${userId}`);

    // Get user's organization membership
    const { data: membership, error } = await supabase
      .schema("core")
      .from("organization_members")
      .select(`
        org_id,
        role,
        organizations:org_id (
          id,
          name,
          slug,
          is_active
        )
      `)
      .eq("user_id", userId)
      .not("accepted_at", "is", null) // Only accepted memberships
      .single();

    if (error || !membership) {
      console.log(`⚠️ User ${userId} has no organization membership`);
      // Return empty claims - user can log in but has no org access
      return new Response(
        JSON.stringify({ app_metadata: {} }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    // Check if org is active
    const org = membership.organizations as { id: string; name: string; slug: string; is_active: boolean };
    if (!org.is_active) {
      console.log(`⚠️ Org ${org.id} is disabled for user ${userId}`);
      return new Response(
        JSON.stringify({
          app_metadata: {
            org_disabled: true,
          },
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    // Inject org_id and role into JWT
    console.log(`✅ User ${userId} assigned to org ${org.slug} as ${membership.role}`);

    return new Response(
      JSON.stringify({
        app_metadata: {
          org_id: membership.org_id,
          org_slug: org.slug,
          org_name: org.name,
          org_role: membership.role,
        },
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }
    );

  } catch (err) {
    console.error("❌ Auth hook error:", err);

    // Return empty claims on error - don't block login
    return new Response(
      JSON.stringify({ app_metadata: {} }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
});
