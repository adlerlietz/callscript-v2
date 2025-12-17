import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAuthContext, isAdmin } from "@/lib/supabase/auth";

/**
 * POST /api/settings/ringba-test
 * Tests Ringba API connection with provided credentials.
 * Only owner/admin can test connections.
 */
export async function POST(request: NextRequest) {
  // Verify user is authenticated and has org context
  const auth = await getAuthContext();
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Only admin/owner can test connections
  if (!isAdmin(auth)) {
    return NextResponse.json({ error: "Forbidden: admin access required" }, { status: 403 });
  }

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

  // Validate Account ID format - Ringba Account IDs typically start with "RA"
  // and are alphanumeric (e.g., "RA1234abcd")
  const cleanedAccountId = accountId.trim();
  if (!cleanedAccountId.match(/^[A-Za-z0-9_-]+$/)) {
    return NextResponse.json(
      { success: false, error: "Invalid Account ID format - should be alphanumeric (e.g., RA1234abcd)" },
      { status: 400 }
    );
  }

  try {
    // Test Ringba API by fetching a small sample
    // Ringba requires POST with JSON body for calllogs endpoint
    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);

    // Trim credentials to remove accidental whitespace
    const cleanAccountId = accountId.trim();
    const cleanToken = token.trim();

    // Log for debugging (safe - shows first/last chars of token)
    const tokenPreview = cleanToken.length > 10
      ? `${cleanToken.slice(0, 6)}...${cleanToken.slice(-6)}`
      : "too short";
    console.log(`Testing Ringba connection: accountId="${cleanAccountId}", tokenLength=${cleanToken.length}, tokenPreview=${tokenPreview}`);

    const payload = {
      reportStart: oneHourAgo.toISOString(),
      reportEnd: now.toISOString(),
      size: 1,
      offset: 0,
      valueColumns: [
        { column: "callDt" },
        { column: "inboundCallId" },
      ],
    };

    // Try with "Token" auth header first (Ringba standard)
    const apiUrl = `https://api.ringba.com/v2/${cleanAccountId}/calllogs`;
    console.log(`Ringba API URL: ${apiUrl}`);

    let response = await fetch(apiUrl, {
      method: "POST",
      headers: {
        Authorization: `Token ${cleanToken}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(payload),
    });

    console.log(`First attempt (Token auth) status: ${response.status}`);

    // If 401, try with "Bearer" auth header (some accounts may use this)
    if (response.status === 401) {
      console.log("Trying Bearer auth...");
      response = await fetch(apiUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${cleanToken}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(payload),
      });
      console.log(`Second attempt (Bearer auth) status: ${response.status}`);
    }

    if (!response.ok) {
      const text = await response.text();
      console.error(`Ringba error response: ${text}`);

      if (response.status === 401) {
        return NextResponse.json(
          {
            success: false,
            error: "Invalid API token - please verify your token from Ringba settings",
            details: `Account ID: "${cleanAccountId}", Token: ${cleanToken.length} chars (${tokenPreview}), Response: ${text.slice(0, 200)}`
          },
          { status: 401 }
        );
      }
      if (response.status === 403) {
        return NextResponse.json(
          { success: false, error: "Access denied - check account ID and token permissions" },
          { status: 403 }
        );
      }
      if (response.status === 404) {
        return NextResponse.json(
          { success: false, error: `Invalid account ID "${cleanAccountId}" - account not found in Ringba` },
          { status: 404 }
        );
      }
      return NextResponse.json(
        { success: false, error: `Ringba API error: ${response.status} - ${text}` },
        { status: response.status }
      );
    }

    const data = await response.json();
    const records = data.report?.records || [];
    const totalCalls = records.length;

    return NextResponse.json({
      success: true,
      message: `Connected successfully${totalCalls > 0 ? ` - found ${totalCalls} call(s) in last hour` : ""}`,
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
 * Gets the last sync time from the database.
 */
export async function GET() {
  // Verify user is authenticated and has org context
  const auth = await getAuthContext();
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = await createClient();

  try {
    // Get the most recent call's updated_at for this org
    const { data, error } = await supabase
      .from("calls_overview")
      .select("updated_at")
      .eq("org_id", auth.orgId)
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
