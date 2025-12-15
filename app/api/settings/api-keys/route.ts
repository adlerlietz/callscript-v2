import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import crypto from "crypto";

/**
 * Creates a Supabase admin client for api_keys table access
 */
function getSupabaseAdmin() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseServiceKey) {
    return null;
  }

  return createClient(supabaseUrl, supabaseServiceKey, {
    db: { schema: "core" },
  });
}

/**
 * Generate a secure API key
 */
function generateApiKey(prefix: string = "cs_live_"): string {
  const randomPart = crypto.randomBytes(24).toString("base64url");
  return `${prefix}${randomPart}`;
}

/**
 * Hash an API key for secure storage
 */
function hashApiKey(key: string): string {
  return crypto.createHash("sha256").update(key).digest("hex");
}

/**
 * GET /api/settings/api-keys
 * List all API keys (only shows hints, not full keys)
 */
export async function GET() {
  const supabase = getSupabaseAdmin();

  if (!supabase) {
    return NextResponse.json(
      { error: "Service role key not configured" },
      { status: 500 }
    );
  }

  const { data: keys, error } = await supabase
    .from("api_keys")
    .select("id, name, key_prefix, key_hint, permissions, is_active, last_used_at, created_at")
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Failed to fetch API keys:", error);
    return NextResponse.json({ keys: [] });
  }

  return NextResponse.json({ keys: keys || [] });
}

/**
 * POST /api/settings/api-keys
 * Create a new API key
 */
export async function POST(request: NextRequest) {
  const supabase = getSupabaseAdmin();

  if (!supabase) {
    return NextResponse.json(
      { error: "Service role key not configured" },
      { status: 500 }
    );
  }

  const body = await request.json();
  const { name = "API Key", permissions = ["read"] } = body;

  // Generate the key
  const fullKey = generateApiKey("cs_live_");
  const keyHash = hashApiKey(fullKey);
  const keyHint = fullKey.slice(-4);

  // Store in database
  const { data, error } = await supabase
    .from("api_keys")
    .insert({
      name,
      key_prefix: "cs_live_",
      key_hash: keyHash,
      key_hint: keyHint,
      permissions: JSON.stringify(permissions),
      is_active: true,
    })
    .select()
    .single();

  if (error) {
    console.error("Failed to create API key:", error);
    return NextResponse.json(
      { error: "Failed to create API key" },
      { status: 500 }
    );
  }

  // Return the full key only once (user must save it)
  return NextResponse.json({
    key: {
      id: data.id,
      name: data.name,
      fullKey, // Only returned on creation!
      keyHint,
      permissions,
      created_at: data.created_at,
    },
    message: "Save this key now - it won't be shown again!",
  }, { status: 201 });
}

/**
 * DELETE /api/settings/api-keys?id=xxx
 * Deactivate an API key (soft delete)
 */
export async function DELETE(request: NextRequest) {
  const supabase = getSupabaseAdmin();

  if (!supabase) {
    return NextResponse.json(
      { error: "Service role key not configured" },
      { status: 500 }
    );
  }

  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");

  if (!id) {
    return NextResponse.json({ error: "Key ID is required" }, { status: 400 });
  }

  // Soft delete - mark as inactive
  const { error } = await supabase
    .from("api_keys")
    .update({ is_active: false })
    .eq("id", id);

  if (error) {
    console.error("Failed to deactivate API key:", error);
    return NextResponse.json(
      { error: "Failed to deactivate API key" },
      { status: 500 }
    );
  }

  return NextResponse.json({ success: true, message: "API key deactivated" });
}

/**
 * PATCH /api/settings/api-keys
 * Roll (regenerate) an API key
 */
export async function PATCH(request: NextRequest) {
  const supabase = getSupabaseAdmin();

  if (!supabase) {
    return NextResponse.json(
      { error: "Service role key not configured" },
      { status: 500 }
    );
  }

  const body = await request.json();
  const { id } = body;

  if (!id) {
    return NextResponse.json({ error: "Key ID is required" }, { status: 400 });
  }

  // Generate new key
  const fullKey = generateApiKey("cs_live_");
  const keyHash = hashApiKey(fullKey);
  const keyHint = fullKey.slice(-4);

  // Update in database
  const { data, error } = await supabase
    .from("api_keys")
    .update({
      key_hash: keyHash,
      key_hint: keyHint,
    })
    .eq("id", id)
    .select()
    .single();

  if (error) {
    console.error("Failed to roll API key:", error);
    return NextResponse.json(
      { error: "Failed to roll API key" },
      { status: 500 }
    );
  }

  return NextResponse.json({
    key: {
      id: data.id,
      name: data.name,
      fullKey, // Only returned on roll!
      keyHint,
      created_at: data.created_at,
    },
    message: "Key rolled successfully. Save this new key - it won't be shown again!",
  });
}
