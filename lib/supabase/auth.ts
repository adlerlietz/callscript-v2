import { createClient } from "@/lib/supabase/server";

/**
 * Authenticated user context with organization info.
 * Extracted from JWT app_metadata set by auth hook.
 */
export interface AuthContext {
  userId: string;
  orgId: string;
  orgSlug: string;
  orgName: string;
  role: "owner" | "admin" | "reviewer";
}

/**
 * Get the current user's auth context including org membership.
 * Returns null if user is not authenticated or has no org.
 */
export async function getAuthContext(): Promise<AuthContext | null> {
  try {
    const supabase = await createClient();
    const { data: { user }, error } = await supabase.auth.getUser();

    if (error || !user) {
      return null;
    }

    const appMetadata = user.app_metadata;

    // Check if user has org context (set by auth hook)
    if (!appMetadata?.org_id) {
      return null;
    }

    return {
      userId: user.id,
      orgId: appMetadata.org_id,
      orgSlug: appMetadata.org_slug || "",
      orgName: appMetadata.org_name || "",
      role: appMetadata.org_role || "reviewer",
    };
  } catch (err) {
    console.error("Failed to get auth context:", err);
    return null;
  }
}

/**
 * Check if user has one of the specified roles.
 */
export function hasRole(auth: AuthContext, roles: Array<"owner" | "admin" | "reviewer">): boolean {
  return roles.includes(auth.role);
}

/**
 * Check if user is an admin or owner.
 */
export function isAdmin(auth: AuthContext): boolean {
  return hasRole(auth, ["owner", "admin"]);
}

/**
 * Check if user is the owner.
 */
export function isOwner(auth: AuthContext): boolean {
  return auth.role === "owner";
}
