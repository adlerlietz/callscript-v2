import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAuthContext } from "@/lib/supabase/auth";

/**
 * GET /api/settings/verticals
 * Returns all available verticals for dropdown selection.
 * Verticals are global (not per-org), but requires authentication.
 */
export async function GET() {
  // Verify user is authenticated
  const auth = await getAuthContext();
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = await createClient();

  const { data: verticals, error } = await supabase
    .from("verticals")
    .select("id, name, description, icon, color, display_order")
    .order("display_order", { ascending: true });

  if (error) {
    // If table doesn't exist yet, return hardcoded defaults
    console.warn("Verticals table not found, using defaults:", error.message);
    return NextResponse.json({
      verticals: [
        { id: "general", name: "General", description: "Default vertical", icon: "📞", color: "zinc" },
        { id: "medicare", name: "Medicare", description: "Health insurance for seniors 65+", icon: "🏥", color: "blue" },
        { id: "aca", name: "ACA / Health", description: "Affordable Care Act health insurance", icon: "🏥", color: "sky" },
        { id: "solar", name: "Solar", description: "Residential solar panel installation", icon: "🌞", color: "yellow" },
        { id: "debt_relief", name: "Debt Relief", description: "Debt consolidation and settlement", icon: "💳", color: "red" },
        { id: "auto_insurance", name: "Auto Insurance", description: "Vehicle insurance policies", icon: "🚗", color: "emerald" },
        { id: "home_services", name: "Home Services", description: "HVAC, roofing, windows, etc.", icon: "🏠", color: "orange" },
      ],
    });
  }

  return NextResponse.json({ verticals });
}
