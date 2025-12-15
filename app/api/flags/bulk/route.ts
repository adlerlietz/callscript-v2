import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { ids, action } = body;

  if (!Array.isArray(ids) || ids.length === 0) {
    return NextResponse.json({ error: "ids array required" }, { status: 400 });
  }

  if (!["mark_safe", "confirm_bad"].includes(action)) {
    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  }

  // Note: Bulk updates require service_role - return mock success for demo
  console.log(`Would bulk update ${ids.length} calls with action: ${action}`);

  return NextResponse.json({
    updated: ids.length,
    ids,
    message: "Bulk update acknowledged (requires service_role for production)",
  });
}
