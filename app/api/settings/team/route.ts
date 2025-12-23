import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getAuthContext, isAdmin, isOwner } from "@/lib/supabase/auth";

// Create admin client that properly bypasses RLS
function createAdminSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { db: { schema: "core" } }
  );
}

/**
 * GET /api/settings/team
 * List all members of the organization.
 */
export async function GET() {
  const auth = await getAuthContext();
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createAdminSupabase();

  // Get all members with their user info
  const { data: members, error } = await supabase
    .from("organization_members")
    .select(`
      id,
      user_id,
      role,
      invited_at,
      accepted_at,
      created_at
    `)
    .eq("org_id", auth.orgId)
    .order("created_at", { ascending: true });

  if (error) {
    console.error("Failed to fetch team members:", error);
    return NextResponse.json({ error: "Failed to fetch team" }, { status: 500 });
  }

  // Get user emails from Supabase Auth
  const { data: authData } = await supabase.auth.admin.listUsers();
  const authUsers = authData?.users || [];

  // Merge user emails with members
  const enrichedMembers = members?.map((m) => {
    const user = authUsers.find((u) => u.id === m.user_id);
    return {
      ...m,
      email: user?.email || "Unknown",
    };
  });

  return NextResponse.json({
    members: enrichedMembers || [],
    currentUserId: auth.userId,
    currentUserRole: auth.role,
  });
}

/**
 * POST /api/settings/team
 * Invite a new member to the organization.
 * Only owner/admin can invite.
 */
export async function POST(request: NextRequest) {
  const auth = await getAuthContext();
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!isAdmin(auth)) {
    return NextResponse.json({ error: "Only admins can invite members" }, { status: 403 });
  }

  const body = await request.json();
  const { email, role = "reviewer" } = body;

  if (!email || typeof email !== "string") {
    return NextResponse.json({ error: "Email is required" }, { status: 400 });
  }

  // Validate role
  if (!["admin", "reviewer"].includes(role)) {
    return NextResponse.json({ error: "Invalid role" }, { status: 400 });
  }

  // Only owners can invite admins
  if (role === "admin" && !isOwner(auth)) {
    return NextResponse.json({ error: "Only owners can invite admins" }, { status: 403 });
  }

  const supabase = createAdminSupabase();

  // Check if user already exists in Supabase Auth
  const { data: authUsers, error: listError } = await supabase.auth.admin.listUsers();
  const existingUser = authUsers?.users?.find(
    (u) => u.email?.toLowerCase() === email.toLowerCase()
  );

  if (listError) {
    console.error("Failed to list users:", listError);
  }

  if (existingUser) {
    // Check if already a member
    const { data: existingMember } = await supabase
      .from("organization_members")
      .select("id")
      .eq("org_id", auth.orgId)
      .eq("user_id", existingUser.id)
      .single();

    if (existingMember) {
      return NextResponse.json({ error: "User is already a member" }, { status: 400 });
    }

    // Add existing user to org
    const { error: memberError } = await supabase
      .from("organization_members")
      .insert({
        org_id: auth.orgId,
        user_id: existingUser.id,
        role,
        invited_by: auth.userId,
        invited_at: new Date().toISOString(),
        accepted_at: new Date().toISOString(), // Auto-accept for existing users
      });

    if (memberError) {
      console.error("Failed to add member:", memberError);
      return NextResponse.json({
        error: "Failed to add member",
        details: memberError.message,
        code: memberError.code,
      }, { status: 500 });
    }

    // Update their app_metadata
    await supabase.auth.admin.updateUserById(existingUser.id, {
      app_metadata: {
        org_id: auth.orgId,
        org_role: role,
        org_name: auth.orgName,
        org_slug: auth.orgSlug,
      },
    });

    return NextResponse.json({
      success: true,
      message: "User added to organization",
      isNewUser: false,
    });
  }

  // Create invite for new user via magic link
  console.log("[Invite] Attempting to invite user");
  console.log("[Invite] redirectTo:", `${process.env.NEXT_PUBLIC_SITE_URL || "https://callscript.io"}/auth/callback`);

  const { data: inviteData, error: inviteError } = await supabase.auth.admin.inviteUserByEmail(
    email.toLowerCase(),
    {
      redirectTo: `${process.env.NEXT_PUBLIC_SITE_URL || "https://callscript.io"}/auth/callback`,
      data: {
        invited_to_org: auth.orgId,
        invited_role: role,
        invited_by: auth.userId,
      },
    }
  );

  console.log("[Invite] Response: user created =", !!inviteData?.user);
  if (inviteError) console.error("[Invite] Error code:", inviteError.code);

  if (inviteError) {
    console.error("Failed to send invite:", inviteError);
    return NextResponse.json({
      error: "Failed to send invite",
      details: inviteError.message,
      code: inviteError.code || inviteError.status,
    }, { status: 500 });
  }

  if (!inviteData?.user) {
    console.error("[Invite] No user returned from inviteUserByEmail");
    return NextResponse.json({
      error: "Invite created but no user returned",
      details: "Supabase returned empty user data",
    }, { status: 500 });
  }

  // Create pending membership
  const { error: memberError } = await supabase
    .from("organization_members")
    .insert({
      org_id: auth.orgId,
      user_id: inviteData.user.id,
      role,
      invited_by: auth.userId,
      invited_at: new Date().toISOString(),
      accepted_at: null, // Pending acceptance
    });

  if (memberError) {
    console.error("Failed to create pending membership:", memberError);
  }

  // Set their app_metadata for when they accept
  await supabase.auth.admin.updateUserById(inviteData.user.id, {
    app_metadata: {
      org_id: auth.orgId,
      org_role: role,
      org_name: auth.orgName,
      org_slug: auth.orgSlug,
    },
  });

  return NextResponse.json({
    success: true,
    message: "Invitation sent",
    isNewUser: true,
  }, { status: 201 });
}

/**
 * PATCH /api/settings/team
 * Update a member's role.
 * Only owner can change roles.
 */
export async function PATCH(request: NextRequest) {
  const auth = await getAuthContext();
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!isOwner(auth)) {
    return NextResponse.json({ error: "Only owners can change roles" }, { status: 403 });
  }

  const body = await request.json();
  const { memberId, role } = body;

  if (!memberId || !role) {
    return NextResponse.json({ error: "Member ID and role are required" }, { status: 400 });
  }

  if (!["owner", "admin", "reviewer"].includes(role)) {
    return NextResponse.json({ error: "Invalid role" }, { status: 400 });
  }

  const supabase = createAdminSupabase();

  // Get the member
  const { data: member } = await supabase
    .from("organization_members")
    .select("user_id, role")
    .eq("id", memberId)
    .eq("org_id", auth.orgId)
    .single();

  if (!member) {
    return NextResponse.json({ error: "Member not found" }, { status: 404 });
  }

  // Can't change own role
  if (member.user_id === auth.userId) {
    return NextResponse.json({ error: "Cannot change your own role" }, { status: 400 });
  }

  // Update role
  const { error } = await supabase
    .from("organization_members")
    .update({ role })
    .eq("id", memberId)
    .eq("org_id", auth.orgId);

  if (error) {
    console.error("Failed to update role:", error);
    return NextResponse.json({ error: "Failed to update role" }, { status: 500 });
  }

  // Update user's app_metadata
  await supabase.auth.admin.updateUserById(member.user_id, {
    app_metadata: {
      org_role: role,
    },
  });

  return NextResponse.json({ success: true, message: "Role updated" });
}

/**
 * DELETE /api/settings/team
 * Remove a member from the organization.
 * Owner/admin can remove members (but not owners).
 */
export async function DELETE(request: NextRequest) {
  const auth = await getAuthContext();
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!isAdmin(auth)) {
    return NextResponse.json({ error: "Only admins can remove members" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const memberId = searchParams.get("id");

  if (!memberId) {
    return NextResponse.json({ error: "Member ID is required" }, { status: 400 });
  }

  const supabase = createAdminSupabase();

  // Get the member
  const { data: member } = await supabase
    .from("organization_members")
    .select("user_id, role")
    .eq("id", memberId)
    .eq("org_id", auth.orgId)
    .single();

  if (!member) {
    return NextResponse.json({ error: "Member not found" }, { status: 404 });
  }

  // Can't remove yourself
  if (member.user_id === auth.userId) {
    return NextResponse.json({ error: "Cannot remove yourself" }, { status: 400 });
  }

  // Can't remove owners (only owners can transfer ownership)
  if (member.role === "owner") {
    return NextResponse.json({ error: "Cannot remove an owner" }, { status: 400 });
  }

  // Admins can't remove other admins (only owners can)
  if (member.role === "admin" && !isOwner(auth)) {
    return NextResponse.json({ error: "Only owners can remove admins" }, { status: 403 });
  }

  // Remove membership
  const { error } = await supabase
    .from("organization_members")
    .delete()
    .eq("id", memberId)
    .eq("org_id", auth.orgId);

  if (error) {
    console.error("Failed to remove member:", error);
    return NextResponse.json({ error: "Failed to remove member" }, { status: 500 });
  }

  // Clear user's app_metadata (they'll see /no-access on next login)
  await supabase.auth.admin.updateUserById(member.user_id, {
    app_metadata: {
      org_id: null,
      org_role: null,
      org_name: null,
      org_slug: null,
    },
  });

  return NextResponse.json({ success: true, message: "Member removed" });
}
