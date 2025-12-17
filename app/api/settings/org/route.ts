import { NextRequest, NextResponse } from "next/server";
import { createClient, createSimpleAdminClient } from "@/lib/supabase/server";
import { getAuthContext, isAdmin } from "@/lib/supabase/auth";

/**
 * Default settings when table doesn't exist yet
 */
const DEFAULT_SETTINGS: Record<string, { value: unknown; description: string; is_secret: boolean }> = {
  org_name: { value: "My Organization", description: "Organization display name", is_secret: false },
  org_slug: { value: "my-org", description: "Organization URL slug", is_secret: false },
  slack_webhook_url: { value: "", description: "Slack webhook URL for notifications", is_secret: true },
  discord_webhook_url: { value: "", description: "Discord webhook URL for notifications", is_secret: true },
  notifications_enabled: {
    value: { critical_flags: true, queue_alerts: true, daily_digest: false },
    description: "Notification preferences",
    is_secret: false,
  },
  ringba_account_id: { value: "", description: "Ringba Account ID for API access", is_secret: false },
  ringba_api_token: { value: "", description: "Ringba API Token (read-only)", is_secret: true },
  openai_api_key: { value: "", description: "OpenAI API Key for Judge Lane", is_secret: true },
  judge_model: { value: "gpt-4o-mini", description: "Model used for QA analysis", is_secret: false },
  judge_temperature: { value: 0.3, description: "Temperature for QA model", is_secret: false },
  auto_flag_threshold: { value: 40, description: "Score below which calls are auto-flagged", is_secret: false },
  default_vertical: { value: "general", description: "Default vertical for new campaigns", is_secret: false },
};

/**
 * Mask secret values for display
 */
function maskSecret(value: unknown): string {
  const str = String(value);
  if (!str || str === "" || str === "null") return "";
  if (str.length <= 8) return "••••••••";
  return "••••••••" + str.slice(-4);
}

/**
 * GET /api/settings/org
 * Returns all organization settings (secrets are masked).
 * Only owner/admin can access settings.
 */
export async function GET() {
  // Verify user is authenticated and has org context
  const auth = await getAuthContext();
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Only admin/owner can view settings
  if (!isAdmin(auth)) {
    return NextResponse.json({ error: "Forbidden: admin access required" }, { status: 403 });
  }

  // Use admin client to bypass RLS for settings read
  const supabase = createSimpleAdminClient();

  console.log(`GET /api/settings/org - fetching for org_id: ${auth.orgId}`);

  const { data: settings, error } = await supabase
    .from("settings")
    .select("key, value, description, is_secret, updated_at")
    .eq("org_id", auth.orgId)
    .order("key");

  console.log(`Settings query result: ${settings?.length || 0} rows, error: ${error?.message || "none"}`);

  if (error) {
    // Table doesn't exist yet, return defaults
    console.warn("Settings table error, using defaults:", error.message);
    const defaults = Object.entries(DEFAULT_SETTINGS).map(([key, config]) => ({
      key,
      value: config.is_secret && config.value ? maskSecret(config.value) : config.value,
      description: config.description,
      is_secret: config.is_secret,
      updated_at: null,
    }));
    return NextResponse.json({ settings: defaults });
  }

  // If no settings found for this org, return defaults
  if (!settings || settings.length === 0) {
    console.log("No settings found for org, returning defaults");
    const defaults = Object.entries(DEFAULT_SETTINGS).map(([key, config]) => ({
      key,
      value: config.is_secret && config.value ? maskSecret(config.value) : config.value,
      description: config.description,
      is_secret: config.is_secret,
      updated_at: null,
    }));
    return NextResponse.json({ settings: defaults });
  }

  // Mask secret values
  const masked = settings.map((s: { key: string; value: unknown; description: string; is_secret: boolean; updated_at: string }) => ({
    ...s,
    value: s.is_secret && s.value ? maskSecret(s.value) : s.value,
  }));

  return NextResponse.json({ settings: masked });
}

/**
 * PATCH /api/settings/org
 * Update one or more settings (upserts if not exists).
 * Only owner/admin can modify settings.
 */
export async function PATCH(request: NextRequest) {
  // Verify user is authenticated and has org context
  const auth = await getAuthContext();
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Only admin/owner can modify settings
  if (!isAdmin(auth)) {
    return NextResponse.json({ error: "Forbidden: admin access required" }, { status: 403 });
  }

  // Use admin client to bypass RLS for settings upsert
  const supabase = createSimpleAdminClient();
  const body = await request.json();
  const { updates } = body as { updates: Record<string, unknown> };

  console.log(`PATCH /api/settings/org - org_id: ${auth.orgId}, updates keys: ${Object.keys(updates || {}).join(", ")}`);

  if (!updates || typeof updates !== "object") {
    return NextResponse.json({ error: "Updates object is required" }, { status: 400 });
  }

  const results: Record<string, boolean> = {};

  // Track Ringba credentials for vault storage
  let ringbaAccountId: string | null = null;
  let ringbaApiToken: string | null = null;

  for (const [key, value] of Object.entries(updates)) {
    // Skip if value is masked (user didn't change it)
    if (typeof value === "string" && value.startsWith("••••")) {
      continue;
    }

    // Track Ringba credentials for later vault storage
    if (key === "ringba_account_id" && typeof value === "string" && value.trim()) {
      ringbaAccountId = value.trim();
    }
    if (key === "ringba_api_token" && typeof value === "string" && value.trim()) {
      ringbaApiToken = value.trim();
    }

    // Get default config for this key (for description and is_secret)
    const defaultConfig = DEFAULT_SETTINGS[key] || {
      description: `Setting: ${key}`,
      is_secret: false,
    };

    // Use dedicated RPC to upsert setting (bypasses view trigger issues)
    const { error } = await supabase.rpc("upsert_setting", {
      p_org_id: auth.orgId,
      p_key: key,
      p_value: JSON.stringify(value),
      p_description: defaultConfig.description,
      p_is_secret: defaultConfig.is_secret,
    });

    if (error) {
      console.error(`Failed to upsert setting ${key}:`, error);
      results[key] = false;
    } else {
      console.log(`Successfully saved setting ${key} for org ${auth.orgId}`);
      results[key] = true;
    }
  }

  // Store Ringba credentials in vault for multi-org worker access
  // Need both account_id and token to store in vault
  if (ringbaAccountId && ringbaApiToken) {
    try {
      const adminClient = createSimpleAdminClient();
      const { error: vaultError } = await adminClient.rpc("store_org_credential", {
        p_org_id: auth.orgId,
        p_provider: "ringba",
        p_account_id: ringbaAccountId,
        p_token: ringbaApiToken,
      });

      if (vaultError) {
        console.error("Failed to store credentials in vault:", vaultError);
        // Don't fail the entire request, just note the error
        results["_vault_storage"] = false;
      } else {
        console.log(`Stored Ringba credentials in vault for org ${auth.orgId}`);
        results["_vault_storage"] = true;
      }
    } catch (err) {
      console.error("Vault storage exception:", err);
      results["_vault_storage"] = false;
    }
  } else if (ringbaAccountId || ringbaApiToken) {
    // Only one credential provided - need to fetch the other from settings
    try {
      const adminClient = createSimpleAdminClient();

      // Fetch the missing credential from settings
      const { data: existingSettings } = await adminClient
        .from("settings")
        .select("key, value")
        .eq("org_id", auth.orgId)
        .in("key", ["ringba_account_id", "ringba_api_token"]);

      const settingsMap: Record<string, string> = {};
      existingSettings?.forEach((s: { key: string; value: string }) => {
        try {
          settingsMap[s.key] = JSON.parse(s.value);
        } catch {
          settingsMap[s.key] = s.value;
        }
      });

      const finalAccountId = ringbaAccountId || settingsMap["ringba_account_id"];
      const finalToken = ringbaApiToken || settingsMap["ringba_api_token"];

      if (finalAccountId && finalToken) {
        const { error: vaultError } = await adminClient.rpc("store_org_credential", {
          p_org_id: auth.orgId,
          p_provider: "ringba",
          p_account_id: finalAccountId,
          p_token: finalToken,
        });

        if (vaultError) {
          console.error("Failed to store credentials in vault:", vaultError);
          results["_vault_storage"] = false;
        } else {
          console.log(`Stored Ringba credentials in vault for org ${auth.orgId}`);
          results["_vault_storage"] = true;
        }
      }
    } catch (err) {
      console.error("Vault storage exception:", err);
      results["_vault_storage"] = false;
    }
  }

  return NextResponse.json({ success: true, results });
}

/**
 * POST /api/settings/org/test-webhook
 * Test a webhook URL by sending a test message.
 * Only owner/admin can test webhooks.
 */
export async function POST(request: NextRequest) {
  // Verify user is authenticated and has org context
  const auth = await getAuthContext();
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Only admin/owner can test webhooks
  if (!isAdmin(auth)) {
    return NextResponse.json({ error: "Forbidden: admin access required" }, { status: 403 });
  }

  const body = await request.json();
  const { type, url } = body as { type: "slack" | "discord"; url: string };

  if (!type || !url) {
    return NextResponse.json({ error: "Type and URL are required" }, { status: 400 });
  }

  try {
    let payload: unknown;

    if (type === "slack") {
      payload = {
        text: "🧪 CallScript Test Message",
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: "*CallScript Webhook Test*\n\nIf you're seeing this, your Slack integration is working correctly! 🎉",
            },
          },
          {
            type: "context",
            elements: [
              {
                type: "mrkdwn",
                text: `Sent at ${new Date().toISOString()}`,
              },
            ],
          },
        ],
      };
    } else if (type === "discord") {
      payload = {
        content: "🧪 **CallScript Test Message**\n\nIf you're seeing this, your Discord integration is working correctly! 🎉",
        embeds: [
          {
            title: "Webhook Test Successful",
            color: 5763719, // Green
            timestamp: new Date().toISOString(),
          },
        ],
      };
    }

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const text = await response.text();
      return NextResponse.json(
        { success: false, error: `Webhook returned ${response.status}: ${text}` },
        { status: 400 }
      );
    }

    return NextResponse.json({ success: true, message: "Test message sent successfully" });
  } catch (err) {
    console.error("Webhook test failed:", err);
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}
