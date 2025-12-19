import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getAuthContext, isAdmin } from "@/lib/supabase/auth";

// Admin client for verticals (global table)
function createAdminSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { db: { schema: "core" } }
  );
}

// Default colors for custom verticals
const VERTICAL_COLORS = [
  "blue", "sky", "cyan", "teal", "emerald", "green",
  "lime", "yellow", "amber", "orange", "red", "rose",
  "pink", "fuchsia", "purple", "violet", "indigo", "zinc"
];

/**
 * GET /api/settings/verticals
 * Returns all available verticals for dropdown selection.
 * Verticals are global (not per-org), but requires authentication.
 */
export async function GET() {
  const auth = await getAuthContext();
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createAdminSupabase();

  const { data: verticals, error } = await supabase
    .from("verticals")
    .select("id, name, description, icon, color, display_order, is_system")
    .order("display_order", { ascending: true });

  if (error) {
    console.warn("Verticals table error:", error.message);
    return NextResponse.json({
      verticals: [
        { id: "general", name: "General", description: "Default vertical", icon: "📞", color: "zinc", is_system: true },
      ],
    });
  }

  return NextResponse.json({ verticals, colors: VERTICAL_COLORS });
}

/**
 * POST /api/settings/verticals
 * Create a new custom vertical.
 * Only admins can create verticals.
 */
export async function POST(request: NextRequest) {
  const auth = await getAuthContext();
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!isAdmin(auth)) {
    return NextResponse.json({ error: "Only admins can create verticals" }, { status: 403 });
  }

  const body = await request.json();
  const { name, description, icon, color } = body;

  if (!name || typeof name !== "string" || name.length < 2) {
    return NextResponse.json({ error: "Name must be at least 2 characters" }, { status: 400 });
  }

  // Generate ID from name (snake_case)
  const id = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 30);

  if (!id) {
    return NextResponse.json({ error: "Invalid name" }, { status: 400 });
  }

  const supabase = createAdminSupabase();

  // Get max display_order
  const { data: maxOrder } = await supabase
    .from("verticals")
    .select("display_order")
    .order("display_order", { ascending: false })
    .limit(1)
    .single();

  const displayOrder = (maxOrder?.display_order ?? 0) + 1;

  const { data: vertical, error } = await supabase
    .from("verticals")
    .insert({
      id,
      name: name.trim(),
      description: description?.trim() || `Custom vertical: ${name}`,
      icon: icon || "📋",
      color: color || "zinc",
      display_order: displayOrder,
      is_system: false,
    })
    .select()
    .single();

  if (error) {
    if (error.code === "23505") {
      return NextResponse.json({ error: "A vertical with this name already exists" }, { status: 409 });
    }
    console.error("Failed to create vertical:", error);
    return NextResponse.json({ error: "Failed to create vertical" }, { status: 500 });
  }

  return NextResponse.json({ vertical }, { status: 201 });
}

/**
 * DELETE /api/settings/verticals
 * Delete a custom vertical.
 * Only admins can delete verticals.
 * System verticals cannot be deleted.
 */
export async function DELETE(request: NextRequest) {
  const auth = await getAuthContext();
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!isAdmin(auth)) {
    return NextResponse.json({ error: "Only admins can delete verticals" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");

  if (!id) {
    return NextResponse.json({ error: "Vertical ID is required" }, { status: 400 });
  }

  const supabase = createAdminSupabase();

  // Check if it's a system vertical
  const { data: existing } = await supabase
    .from("verticals")
    .select("id, is_system")
    .eq("id", id)
    .single();

  if (!existing) {
    return NextResponse.json({ error: "Vertical not found" }, { status: 404 });
  }

  if (existing.is_system) {
    return NextResponse.json({ error: "System verticals cannot be deleted" }, { status: 400 });
  }

  // Check if any campaigns use this vertical
  const { count } = await supabase
    .from("campaigns")
    .select("id", { count: "exact", head: true })
    .eq("vertical", id);

  if (count && count > 0) {
    return NextResponse.json({
      error: `Cannot delete: ${count} campaign(s) use this vertical. Reassign them first.`,
    }, { status: 400 });
  }

  // Delete the vertical
  const { error } = await supabase
    .from("verticals")
    .delete()
    .eq("id", id);

  if (error) {
    console.error("Failed to delete vertical:", error);
    return NextResponse.json({ error: "Failed to delete vertical" }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
