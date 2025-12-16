"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Building2,
  AlertTriangle,
  Trash2,
  Loader2,
  Save,
  CheckCircle,
  Users,
  UserPlus,
  Mail,
  Shield,
  ShieldCheck,
  Crown,
  MoreHorizontal,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface TeamMember {
  id: string;
  user_id: string;
  email: string;
  role: "owner" | "admin" | "reviewer";
  invited_at: string;
  accepted_at: string | null;
  created_at: string;
}

export default function GeneralSettingsPage() {
  const [orgName, setOrgName] = useState("");
  const [orgSlug, setOrgSlug] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  // Team state
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [currentUserId, setCurrentUserId] = useState("");
  const [currentUserRole, setCurrentUserRole] = useState<string>("");
  const [teamLoading, setTeamLoading] = useState(true);
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"admin" | "reviewer">("reviewer");
  const [inviting, setInviting] = useState(false);
  const [inviteError, setInviteError] = useState("");
  const [inviteSuccess, setInviteSuccess] = useState("");

  // Fetch settings on mount
  const fetchSettings = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/settings/org");
      if (res.ok) {
        const data = await res.json();
        const settings: Record<string, unknown> = {};
        for (const s of data.settings || []) {
          settings[s.key] = s.value;
        }
        // Try to parse JSON values
        const name = settings.org_name;
        const slug = settings.org_slug;
        setOrgName(typeof name === "string" ? name.replace(/^"|"$/g, "") : "My Organization");
        setOrgSlug(typeof slug === "string" ? slug.replace(/^"|"$/g, "") : "my-org");
      }
    } catch (err) {
      console.error("Failed to fetch settings:", err);
      // Use defaults on error
      setOrgName("My Organization");
      setOrgSlug("my-org");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  // Fetch team members
  const fetchTeam = useCallback(async () => {
    setTeamLoading(true);
    try {
      const res = await fetch("/api/settings/team");
      if (res.ok) {
        const data = await res.json();
        setMembers(data.members || []);
        setCurrentUserId(data.currentUserId);
        setCurrentUserRole(data.currentUserRole);
      }
    } catch (err) {
      console.error("Failed to fetch team:", err);
    } finally {
      setTeamLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTeam();
  }, [fetchTeam]);

  const handleInvite = async () => {
    if (!inviteEmail.trim()) return;
    setInviting(true);
    setInviteError("");
    setInviteSuccess("");

    try {
      const res = await fetch("/api/settings/team", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: inviteEmail.trim(), role: inviteRole }),
      });
      const data = await res.json();

      if (!res.ok) {
        setInviteError(data.error || "Failed to send invite");
      } else {
        setInviteSuccess(data.isNewUser ? "Invitation sent!" : "User added to team!");
        setInviteEmail("");
        setInviteRole("reviewer");
        fetchTeam();
        setTimeout(() => {
          setShowInviteModal(false);
          setInviteSuccess("");
        }, 2000);
      }
    } catch (err) {
      setInviteError("Failed to send invite");
    } finally {
      setInviting(false);
    }
  };

  const handleChangeRole = async (memberId: string, newRole: string) => {
    try {
      const res = await fetch("/api/settings/team", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ memberId, role: newRole }),
      });
      if (res.ok) {
        fetchTeam();
      }
    } catch (err) {
      console.error("Failed to change role:", err);
    }
  };

  const handleRemoveMember = async (memberId: string) => {
    if (!confirm("Are you sure you want to remove this member?")) return;
    try {
      const res = await fetch(`/api/settings/team?id=${memberId}`, {
        method: "DELETE",
      });
      if (res.ok) {
        fetchTeam();
      }
    } catch (err) {
      console.error("Failed to remove member:", err);
    }
  };

  const getRoleIcon = (role: string) => {
    switch (role) {
      case "owner":
        return <Crown className="h-4 w-4 text-amber-400" />;
      case "admin":
        return <ShieldCheck className="h-4 w-4 text-blue-400" />;
      default:
        return <Shield className="h-4 w-4 text-zinc-400" />;
    }
  };

  const getRoleBadge = (role: string) => {
    const colors = {
      owner: "bg-amber-500/10 text-amber-400 border-amber-500/20",
      admin: "bg-blue-500/10 text-blue-400 border-blue-500/20",
      reviewer: "bg-zinc-500/10 text-zinc-400 border-zinc-500/20",
    };
    return colors[role as keyof typeof colors] || colors.reviewer;
  };

  const handleSave = async () => {
    setSaving(true);
    setSaved(false);
    try {
      const res = await fetch("/api/settings/org", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          updates: {
            org_name: orgName,
            org_slug: orgSlug,
          },
        }),
      });
      if (res.ok) {
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
      }
    } catch (err) {
      console.error("Failed to save settings:", err);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-zinc-500" />
      </div>
    );
  }

  return (
    <div className="max-w-2xl">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-xl font-semibold text-zinc-100">General</h1>
        <p className="text-sm text-zinc-500 mt-1">
          Manage your organization profile and settings.
        </p>
      </div>

      {/* Organization Profile */}
      <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-6 mb-6">
        <div className="flex items-start gap-4">
          <div className="p-2 rounded-lg bg-zinc-800">
            <Building2 className="h-5 w-5 text-zinc-400" />
          </div>
          <div className="flex-1">
            <h3 className="text-sm font-medium text-zinc-100 mb-1">
              Organization Profile
            </h3>
            <p className="text-sm text-zinc-500 mb-6">
              Your organization name appears in reports and notifications.
            </p>

            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-zinc-500 uppercase tracking-wider mb-2">
                  Organization Name
                </label>
                <Input
                  value={orgName}
                  onChange={(e) => setOrgName(e.target.value)}
                  placeholder="Acme Corp"
                  className="bg-zinc-800 border-zinc-700 max-w-md"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-zinc-500 uppercase tracking-wider mb-2">
                  URL Slug
                </label>
                <div className="flex items-center gap-2 max-w-md">
                  <span className="text-sm text-zinc-500">callscript.ai/</span>
                  <Input
                    value={orgSlug}
                    onChange={(e) =>
                      setOrgSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))
                    }
                    placeholder="acme"
                    className="bg-zinc-800 border-zinc-700"
                  />
                </div>
                <p className="text-xs text-zinc-500 mt-1">
                  Only lowercase letters, numbers, and dashes.
                </p>
              </div>
            </div>

            <div className="mt-6">
              <Button onClick={handleSave} disabled={saving}>
                {saving ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                ) : saved ? (
                  <CheckCircle className="h-4 w-4 mr-2 text-emerald-400" />
                ) : (
                  <Save className="h-4 w-4 mr-2" />
                )}
                {saved ? "Saved!" : "Save Changes"}
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* Team Members */}
      <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-6 mb-6">
        <div className="flex items-start gap-4">
          <div className="p-2 rounded-lg bg-zinc-800">
            <Users className="h-5 w-5 text-zinc-400" />
          </div>
          <div className="flex-1">
            <div className="flex items-center justify-between mb-1">
              <h3 className="text-sm font-medium text-zinc-100">Team Members</h3>
              {(currentUserRole === "owner" || currentUserRole === "admin") && (
                <Button
                  size="sm"
                  onClick={() => setShowInviteModal(true)}
                  className="h-8"
                >
                  <UserPlus className="h-4 w-4 mr-2" />
                  Invite
                </Button>
              )}
            </div>
            <p className="text-sm text-zinc-500 mb-6">
              Manage who has access to your organization.
            </p>

            {teamLoading ? (
              <div className="flex justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-zinc-500" />
              </div>
            ) : (
              <div className="space-y-3">
                {members.map((member) => (
                  <div
                    key={member.id}
                    className="flex items-center justify-between p-3 rounded-lg bg-zinc-800/50 border border-zinc-700/50"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-zinc-700 flex items-center justify-center">
                        <span className="text-sm font-medium text-zinc-300">
                          {member.email[0].toUpperCase()}
                        </span>
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-zinc-200">
                            {member.email}
                          </span>
                          {member.user_id === currentUserId && (
                            <span className="text-xs text-zinc-500">(you)</span>
                          )}
                          {!member.accepted_at && (
                            <span className="text-xs text-amber-400 bg-amber-400/10 px-2 py-0.5 rounded">
                              Pending
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-1 mt-0.5">
                          {getRoleIcon(member.role)}
                          <span className={`text-xs px-2 py-0.5 rounded border capitalize ${getRoleBadge(member.role)}`}>
                            {member.role}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Actions - only for other members, not yourself */}
                    {member.user_id !== currentUserId && currentUserRole === "owner" && (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="bg-zinc-900 border-zinc-700">
                          {member.role !== "owner" && (
                            <>
                              <DropdownMenuItem
                                onClick={() => handleChangeRole(member.id, "admin")}
                                disabled={member.role === "admin"}
                                className="text-zinc-300 focus:bg-zinc-800"
                              >
                                <ShieldCheck className="h-4 w-4 mr-2" />
                                Make Admin
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onClick={() => handleChangeRole(member.id, "reviewer")}
                                disabled={member.role === "reviewer"}
                                className="text-zinc-300 focus:bg-zinc-800"
                              >
                                <Shield className="h-4 w-4 mr-2" />
                                Make Reviewer
                              </DropdownMenuItem>
                            </>
                          )}
                          {member.role !== "owner" && (
                            <DropdownMenuItem
                              onClick={() => handleRemoveMember(member.id)}
                              className="text-red-400 focus:bg-red-950 focus:text-red-400"
                            >
                              <Trash2 className="h-4 w-4 mr-2" />
                              Remove
                            </DropdownMenuItem>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                    {member.user_id !== currentUserId && currentUserRole === "admin" && member.role === "reviewer" && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleRemoveMember(member.id)}
                        className="h-8 text-red-400 hover:text-red-300 hover:bg-red-950"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                ))}

                {members.length === 0 && (
                  <div className="text-center py-8 text-zinc-500">
                    No team members yet. Invite someone to get started.
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Invite Modal */}
      {showInviteModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-full max-w-md rounded-lg border border-zinc-800 bg-zinc-900 p-6 shadow-xl">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-zinc-100">Invite Team Member</h3>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setShowInviteModal(false);
                  setInviteError("");
                  setInviteSuccess("");
                  setInviteEmail("");
                }}
                className="h-8 w-8 p-0"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-zinc-500 uppercase tracking-wider mb-2">
                  Email Address
                </label>
                <div className="flex items-center gap-2">
                  <Mail className="h-4 w-4 text-zinc-500" />
                  <Input
                    type="email"
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                    placeholder="colleague@company.com"
                    className="bg-zinc-800 border-zinc-700 flex-1"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-zinc-500 uppercase tracking-wider mb-2">
                  Role
                </label>
                <div className="flex gap-2">
                  <Button
                    variant={inviteRole === "reviewer" ? "default" : "outline"}
                    size="sm"
                    onClick={() => setInviteRole("reviewer")}
                    className={inviteRole === "reviewer" ? "" : "border-zinc-700 text-zinc-400"}
                  >
                    <Shield className="h-4 w-4 mr-2" />
                    Reviewer
                  </Button>
                  {currentUserRole === "owner" && (
                    <Button
                      variant={inviteRole === "admin" ? "default" : "outline"}
                      size="sm"
                      onClick={() => setInviteRole("admin")}
                      className={inviteRole === "admin" ? "" : "border-zinc-700 text-zinc-400"}
                    >
                      <ShieldCheck className="h-4 w-4 mr-2" />
                      Admin
                    </Button>
                  )}
                </div>
                <p className="text-xs text-zinc-500 mt-2">
                  {inviteRole === "admin"
                    ? "Admins can manage settings, invite members, and review calls."
                    : "Reviewers can view and review flagged calls."}
                </p>
              </div>

              {inviteError && (
                <div className="p-3 rounded bg-red-950/50 border border-red-900/50 text-sm text-red-400">
                  {inviteError}
                </div>
              )}

              {inviteSuccess && (
                <div className="p-3 rounded bg-emerald-950/50 border border-emerald-900/50 text-sm text-emerald-400 flex items-center gap-2">
                  <CheckCircle className="h-4 w-4" />
                  {inviteSuccess}
                </div>
              )}

              <div className="flex justify-end gap-3 pt-2">
                <Button
                  variant="outline"
                  onClick={() => {
                    setShowInviteModal(false);
                    setInviteError("");
                    setInviteSuccess("");
                    setInviteEmail("");
                  }}
                  className="border-zinc-700"
                >
                  Cancel
                </Button>
                <Button onClick={handleInvite} disabled={inviting || !inviteEmail.trim()}>
                  {inviting ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  ) : (
                    <UserPlus className="h-4 w-4 mr-2" />
                  )}
                  Send Invite
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Danger Zone */}
      <div className="rounded-lg border border-red-900/50 bg-red-950/20 p-6">
        <div className="flex items-start gap-4">
          <div className="p-2 rounded-lg bg-red-900/30">
            <AlertTriangle className="h-5 w-5 text-red-400" />
          </div>
          <div className="flex-1">
            <h3 className="text-sm font-medium text-red-400 mb-1">Danger Zone</h3>
            <p className="text-sm text-zinc-500 mb-4">
              Once you delete your organization, there is no going back. All data will
              be permanently removed.
            </p>

            {!showDeleteConfirm ? (
              <Button
                variant="destructive"
                onClick={() => setShowDeleteConfirm(true)}
              >
                <Trash2 className="h-4 w-4 mr-2" />
                Delete Organization
              </Button>
            ) : (
              <div className="space-y-3">
                <p className="text-sm text-red-400">
                  Type <span className="font-mono font-bold">{orgSlug}</span> to
                  confirm deletion:
                </p>
                <div className="flex items-center gap-3">
                  <Input
                    placeholder={orgSlug}
                    className="bg-zinc-800 border-zinc-700 max-w-xs"
                  />
                  <Button variant="destructive">Confirm Delete</Button>
                  <Button
                    variant="ghost"
                    onClick={() => setShowDeleteConfirm(false)}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
