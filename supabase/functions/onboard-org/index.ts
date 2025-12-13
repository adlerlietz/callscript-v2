/**
 * CallScript V2 - Organization Onboarding
 *
 * Creates a new organization, adds the user as owner, and stores Ringba credentials.
 *
 * POST /functions/v1/onboard-org
 * Body: {
 *   org_name: string,
 *   ringba_account_id: string,
 *   ringba_token: string
 * }
 *
 * Requires: Authenticated user (from Supabase Auth)
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.48.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

interface OnboardRequest {
  org_name: string;
  ringba_account_id: string;
  ringba_token: string;
}

interface OnboardResponse {
  success: boolean;
  org_id?: string;
  slug?: string;
  error?: string;
}

/**
 * Validate Ringba credentials by making a test API call
 */
async function validateRingbaCredentials(
  accountId: string,
  token: string
): Promise<{ valid: boolean; error?: string }> {
  try {
    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);

    const response = await fetch(
      `https://api.ringba.com/v2/${accountId}/calllogs`,
      {
        method: "POST",
        headers: {
          Authorization: `Token ${token}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          reportStart: oneHourAgo.toISOString(),
          reportEnd: now.toISOString(),
          size: 1,
          offset: 0,
          valueColumns: [{ column: "inboundCallId" }],
        }),
        signal: AbortSignal.timeout(10000),
      }
    );

    if (response.status === 401 || response.status === 403) {
      return { valid: false, error: "Invalid API token" };
    }

    if (response.status === 404) {
      return { valid: false, error: "Invalid account ID" };
    }

    if (!response.ok) {
      const text = await response.text();
      return { valid: false, error: `Ringba API error: ${response.status} - ${text}` };
    }

    return { valid: true };

  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { valid: false, error: `Connection failed: ${message}` };
  }
}

/**
 * Generate URL-safe slug from org name
 */
function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50);
}

Deno.serve(async (req) => {
  // Only allow POST
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  // Get authenticated user from JWT
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return new Response(
      JSON.stringify({ success: false, error: "Unauthorized" } as OnboardResponse),
      { status: 401, headers: { "Content-Type": "application/json" } }
    );
  }

  const token = authHeader.replace("Bearer ", "");
  const { data: { user }, error: authError } = await supabase.auth.getUser(token);

  if (authError || !user) {
    return new Response(
      JSON.stringify({ success: false, error: "Invalid token" } as OnboardResponse),
      { status: 401, headers: { "Content-Type": "application/json" } }
    );
  }

  // Check if user already has an org
  const { data: existingMembership } = await supabase
    .schema("core")
    .from("organization_members")
    .select("org_id")
    .eq("user_id", user.id)
    .single();

  if (existingMembership) {
    return new Response(
      JSON.stringify({
        success: false,
        error: "User already belongs to an organization",
      } as OnboardResponse),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  // Parse request body
  let body: OnboardRequest;
  try {
    body = await req.json();
  } catch {
    return new Response(
      JSON.stringify({ success: false, error: "Invalid JSON body" } as OnboardResponse),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  const { org_name, ringba_account_id, ringba_token } = body;

  // Validate required fields
  if (!org_name || !ringba_account_id || !ringba_token) {
    return new Response(
      JSON.stringify({
        success: false,
        error: "Missing required fields: org_name, ringba_account_id, ringba_token",
      } as OnboardResponse),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  console.log(`🏢 Onboarding org: ${org_name} for user ${user.id}`);

  // Step 1: Validate Ringba credentials
  console.log("📡 Validating Ringba credentials...");
  const validation = await validateRingbaCredentials(ringba_account_id, ringba_token);

  if (!validation.valid) {
    console.log(`❌ Ringba validation failed: ${validation.error}`);
    return new Response(
      JSON.stringify({
        success: false,
        error: `Invalid Ringba credentials: ${validation.error}`,
      } as OnboardResponse),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  console.log("✅ Ringba credentials valid");

  // Step 2: Create organization
  const slug = generateSlug(org_name);

  const { data: org, error: orgError } = await supabase
    .schema("core")
    .from("organizations")
    .insert({
      name: org_name,
      slug,
      plan: "trial",
    })
    .select("id, name, slug")
    .single();

  if (orgError) {
    console.error("❌ Failed to create org:", orgError);

    // Check for slug conflict
    if (orgError.code === "23505") {
      return new Response(
        JSON.stringify({
          success: false,
          error: "Organization name already taken",
        } as OnboardResponse),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({
        success: false,
        error: "Failed to create organization",
      } as OnboardResponse),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }

  console.log(`✅ Created org: ${org.id} (${org.slug})`);

  // Step 3: Add user as owner
  const { error: memberError } = await supabase
    .schema("core")
    .from("organization_members")
    .insert({
      org_id: org.id,
      user_id: user.id,
      role: "owner",
      accepted_at: new Date().toISOString(),
    });

  if (memberError) {
    console.error("❌ Failed to add member:", memberError);
    // Rollback: delete org
    await supabase.schema("core").from("organizations").delete().eq("id", org.id);
    return new Response(
      JSON.stringify({
        success: false,
        error: "Failed to add user to organization",
      } as OnboardResponse),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }

  console.log(`✅ Added user ${user.id} as owner`);

  // Step 4: Store Ringba credentials in Vault
  const { error: credError } = await supabase.rpc("store_org_credential", {
    p_org_id: org.id,
    p_provider: "ringba",
    p_account_id: ringba_account_id,
    p_token: ringba_token,
  });

  if (credError) {
    console.error("❌ Failed to store credentials:", credError);
    // Don't rollback - org is created, user can retry credential setup
    return new Response(
      JSON.stringify({
        success: true,
        org_id: org.id,
        slug: org.slug,
        error: "Organization created but credential storage failed. Please add credentials in settings.",
      } as OnboardResponse),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  }

  console.log("✅ Stored Ringba credentials in Vault");

  // Step 5: Update user's JWT claims (force refresh on next request)
  await supabase.auth.admin.updateUserById(user.id, {
    app_metadata: {
      org_id: org.id,
      org_slug: org.slug,
      org_name: org.name,
      org_role: "owner",
    },
  });

  console.log("✅ Updated user JWT claims");

  // Success!
  console.log(`🎉 Onboarding complete for org ${org.slug}`);

  return new Response(
    JSON.stringify({
      success: true,
      org_id: org.id,
      slug: org.slug,
    } as OnboardResponse),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
});
