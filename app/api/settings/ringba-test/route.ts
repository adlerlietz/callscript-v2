import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

/**
 * POST /api/settings/ringba-test
 * Tests Ringba API connection with provided credentials
 */
export async function POST(request: NextRequest) {
  const body = await request.json();
  const { accountId, token } = body;

  if (!accountId || !token) {
    return NextResponse.json(
      { success: false, error: "Account ID and Token are required" },
      { status: 400 }
    );
  }

  // Skip masked tokens - can't test with them
  if (token.startsWith("••••")) {
    return NextResponse.json(
      { success: false, error: "Please enter the full API token to test" },
      { status: 400 }
    );
  }

  try {
    // Test Ringba API by fetching a small sample
    const response = await fetch(
      `https://api.ringba.com/v2/${accountId}/calllogs?dateStart=${encodeURIComponent(
        new Date(Date.now() - 60000).toISOString() // Last minute
      )}&dateEnd=${encodeURIComponent(new Date().toISOString())}&pageSize=1`,
      {
        headers: {
          Authorization: `Token ${token}`,
          "Content-Type": "application/json",
        },
      }
    );

    if (!response.ok) {
      const text = await response.text();
      if (response.status === 401) {
        return NextResponse.json(
          { success: false, error: "Invalid API token" },
          { status: 401 }
        );
      }
      if (response.status === 403) {
        return NextResponse.json(
          { success: false, error: "Access denied - check account ID" },
          { status: 403 }
        );
      }
      return NextResponse.json(
        { success: false, error: `Ringba API error: ${response.status} - ${text}` },
        { status: response.status }
      );
    }

    const data = await response.json();
    const totalCalls = data.totalCount || 0;

    return NextResponse.json({
      success: true,
      message: "Connected successfully",
      totalCalls,
    });
  } catch (err) {
    console.error("Ringba test failed:", err);
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : "Connection failed" },
      { status: 500 }
    );
  }
}

/**
 * GET /api/settings/ringba-test
 * Gets the last sync time from the database
 */
export async function GET() {
  try {
    // Get the most recent call's updated_at to determine last sync
    const { data, error } = await supabase
      .from("calls_overview")
      .select("updated_at")
      .order("updated_at", { ascending: false })
      .limit(1);

    if (error) {
      console.error("Failed to get last sync time:", error);
      return NextResponse.json({ lastSync: null });
    }

    if (!data || data.length === 0) {
      return NextResponse.json({ lastSync: null, message: "No calls synced yet" });
    }

    const lastSync = data[0].updated_at;
    return NextResponse.json({ lastSync });
  } catch (err) {
    console.error("Failed to get last sync:", err);
    return NextResponse.json({ lastSync: null });
  }
}
