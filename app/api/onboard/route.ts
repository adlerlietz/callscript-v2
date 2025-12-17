import { NextRequest, NextResponse } from "next/server";
import { createClient, createSimpleAdminClient } from "@/lib/supabase/server";

/**
 * POST /api/onboard
 * Creates a new organization and adds the user as owner.
 */
export async function POST(request: NextRequest) {
  try {
    // Get authenticated user
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    // Check if user already has an org
    if (user.app_metadata?.org_id) {
      return NextResponse.json(
        { error: "You already have an organization" },
        { status: 400 }
      );
    }

    // Parse request body
    const body = await request.json();
    const { org_name } = body;

    if (!org_name || typeof org_name !== "string" || org_name.trim().length < 2) {
      return NextResponse.json(
        { error: "Organization name must be at least 2 characters" },
        { status: 400 }
      );
    }

    const trimmedName = org_name.trim();

    // Generate slug from name
    const slug = trimmedName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .substring(0, 50);

    // Use simple admin client for database operations (no cookie handling needed)
    const adminClient = createSimpleAdminClient();

    // Check if user already has a membership
    const { data: existingMembership } = await adminClient
      .schema("core")
      .from("organization_members")
      .select("id")
      .eq("user_id", user.id)
      .single();

    if (existingMembership) {
      return NextResponse.json(
        { error: "You are already a member of an organization" },
        { status: 400 }
      );
    }

    // Create organization
    const { data: org, error: orgError } = await adminClient
      .schema("core")
      .from("organizations")
      .insert({
        name: trimmedName,
        slug: slug,
        plan: "trial",
        is_active: true,
      })
      .select("id, slug")
      .single();

    if (orgError) {
      console.error("Failed to create organization:", orgError);
      if (orgError.code === "23505") {
        // Unique constraint violation
        return NextResponse.json(
          { error: "An organization with this name already exists" },
          { status: 400 }
        );
      }
      return NextResponse.json(
        { error: `Failed to create organization: ${orgError.message || orgError.code}` },
        { status: 500 }
      );
    }

    // Add user as owner
    const { error: memberError } = await adminClient
      .schema("core")
      .from("organization_members")
      .insert({
        org_id: org.id,
        user_id: user.id,
        role: "owner",
        accepted_at: new Date().toISOString(),
      });

    if (memberError) {
      console.error("Failed to add member:", memberError);
      // Rollback org creation
      await adminClient.schema("core").from("organizations").delete().eq("id", org.id);
      return NextResponse.json(
        { error: `Failed to add member: ${memberError.message || memberError.code}` },
        { status: 500 }
      );
    }

    // Update user's app_metadata with org info
    const { error: updateError } = await adminClient.auth.admin.updateUserById(
      user.id,
      {
        app_metadata: {
          org_id: org.id,
          org_slug: org.slug,
          org_name: trimmedName,
          org_role: "owner",
        },
      }
    );

    if (updateError) {
      console.error("Failed to update user metadata:", updateError);
      // Don't rollback - org is created, user can still use it
    }

    return NextResponse.json({
      success: true,
      org_id: org.id,
      slug: org.slug,
    });
  } catch (error) {
    console.error("Onboard error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { error: `Something went wrong: ${message}` },
      { status: 500 }
    );
  }
}
