import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
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

  const supabase = await createClient();

  const { data: settings, error } = await supabase
    .from("settings")
    .select("key, value, description, is_secret, updated_at")
    .eq("org_id", auth.orgId)
    .order("key");

  if (error) {
    // Table doesn't exist yet, return defaults
    console.warn("Settings table not found, using defaults:", error.message);
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
  const masked = (settings || []).map((s) => ({
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

  const supabase = await createClient();
  const body = await request.json();
  const { updates } = body as { updates: Record<string, unknown> };

  if (!updates || typeof updates !== "object") {
    return NextResponse.json({ error: "Updates object is required" }, { status: 400 });
  }

  const results: Record<string, boolean> = {};

  for (const [key, value] of Object.entries(updates)) {
    // Skip if value is masked (user didn't change it)
    if (typeof value === "string" && value.startsWith("••••")) {
      continue;
    }

    // Get default config for this key (for description and is_secret)
    const defaultConfig = DEFAULT_SETTINGS[key] || {
      description: `Setting: ${key}`,
      is_secret: false,
    };

    // Use upsert to create or update the setting (include org_id)
    const { error } = await supabase
      .from("settings")
      .upsert({
        org_id: auth.orgId,
        key,
        value: JSON.stringify(value),
        description: defaultConfig.description,
        is_secret: defaultConfig.is_secret,
        updated_at: new Date().toISOString(),
      }, {
        onConflict: "org_id,key",
      });

    if (error) {
      console.error(`Failed to upsert setting ${key}:`, error);
      results[key] = false;
    } else {
      results[key] = true;
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
