"use client";

import { useState, useEffect, useCallback } from "react";
import { Building2, AlertTriangle, Trash2, Loader2, Save, CheckCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export default function GeneralSettingsPage() {
  const [orgName, setOrgName] = useState("");
  const [orgSlug, setOrgSlug] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

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
