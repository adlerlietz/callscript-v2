"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Layers,
  Plus,
  Edit2,
  Trash2,
  Loader2,
  Save,
  X,
  Info,
  Lock,
  AlertTriangle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

// =============================================================================
// Types
// =============================================================================

interface Vertical {
  id: string;
  name: string;
  description: string;
  icon: string;
  color: string;
  is_system: boolean;
  campaign_count?: number;
}

// Color options for custom verticals
const COLOR_OPTIONS = [
  { id: "blue", label: "Blue", class: "bg-blue-500" },
  { id: "sky", label: "Sky", class: "bg-sky-500" },
  { id: "cyan", label: "Cyan", class: "bg-cyan-500" },
  { id: "teal", label: "Teal", class: "bg-teal-500" },
  { id: "emerald", label: "Emerald", class: "bg-emerald-500" },
  { id: "green", label: "Green", class: "bg-green-500" },
  { id: "yellow", label: "Yellow", class: "bg-yellow-500" },
  { id: "amber", label: "Amber", class: "bg-amber-500" },
  { id: "orange", label: "Orange", class: "bg-orange-500" },
  { id: "red", label: "Red", class: "bg-red-500" },
  { id: "rose", label: "Rose", class: "bg-rose-500" },
  { id: "pink", label: "Pink", class: "bg-pink-500" },
  { id: "purple", label: "Purple", class: "bg-purple-500" },
  { id: "violet", label: "Violet", class: "bg-violet-500" },
  { id: "indigo", label: "Indigo", class: "bg-indigo-500" },
  { id: "zinc", label: "Gray", class: "bg-zinc-500" },
];

// Common emoji icons for verticals
const ICON_OPTIONS = [
  "📋", "📞", "💼", "🏠", "🚗", "💰", "🏥", "⚡", "🔧", "📊",
  "🎯", "💎", "🛡️", "📱", "🌐", "⚖️", "🎓", "🏦", "🛒", "✈️",
];

const colorMap: Record<string, string> = {
  blue: "bg-blue-500/10 text-blue-400 border-blue-500/30",
  sky: "bg-sky-500/10 text-sky-400 border-sky-500/30",
  cyan: "bg-cyan-500/10 text-cyan-400 border-cyan-500/30",
  teal: "bg-teal-500/10 text-teal-400 border-teal-500/30",
  emerald: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30",
  green: "bg-green-500/10 text-green-400 border-green-500/30",
  yellow: "bg-yellow-500/10 text-yellow-400 border-yellow-500/30",
  amber: "bg-amber-500/10 text-amber-400 border-amber-500/30",
  orange: "bg-orange-500/10 text-orange-400 border-orange-500/30",
  red: "bg-red-500/10 text-red-400 border-red-500/30",
  rose: "bg-rose-500/10 text-rose-400 border-rose-500/30",
  pink: "bg-pink-500/10 text-pink-400 border-pink-500/30",
  purple: "bg-purple-500/10 text-purple-400 border-purple-500/30",
  violet: "bg-violet-500/10 text-violet-400 border-violet-500/30",
  indigo: "bg-indigo-500/10 text-indigo-400 border-indigo-500/30",
  zinc: "bg-zinc-500/10 text-zinc-400 border-zinc-500/30",
};

// =============================================================================
// Create/Edit Vertical Modal
// =============================================================================

function VerticalModal({
  vertical,
  onSave,
  onClose,
}: {
  vertical?: Vertical | null;
  onSave: (data: { name: string; description: string; icon: string; color: string }) => Promise<boolean>;
  onClose: () => void;
}) {
  const isEditing = !!vertical;
  const [name, setName] = useState(vertical?.name || "");
  const [description, setDescription] = useState(vertical?.description || "");
  const [icon, setIcon] = useState(vertical?.icon || "📋");
  const [color, setColor] = useState(vertical?.color || "blue");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = async () => {
    if (!name.trim()) {
      setError("Name is required");
      return;
    }
    setError(null);
    setSaving(true);
    const success = await onSave({ name, description, icon, color });
    setSaving(false);
    if (success) {
      onClose();
    } else {
      setError("Failed to save vertical. It may already exist.");
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-zinc-900 rounded-lg border border-zinc-800 p-6 w-full max-w-md max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-lg font-semibold text-zinc-100">
            {isEditing ? "Edit Vertical" : "Create Custom Vertical"}
          </h3>
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-300">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-5">
          {error && (
            <div className="rounded-lg bg-red-500/10 border border-red-500/30 p-3 text-sm text-red-400">
              {error}
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-zinc-500 uppercase tracking-wider mb-2">
              Vertical Name *
            </label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., Legal Services"
              className="bg-zinc-800 border-zinc-700"
              disabled={isEditing}
            />
            {isEditing && (
              <p className="text-xs text-zinc-500 mt-1">Name cannot be changed after creation.</p>
            )}
          </div>

          <div>
            <label className="block text-xs font-medium text-zinc-500 uppercase tracking-wider mb-2">
              Description
            </label>
            <Input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="e.g., Personal injury and legal leads"
              className="bg-zinc-800 border-zinc-700"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-zinc-500 uppercase tracking-wider mb-2">
              Icon
            </label>
            <div className="flex flex-wrap gap-2">
              {ICON_OPTIONS.map((i) => (
                <button
                  key={i}
                  onClick={() => setIcon(i)}
                  className={cn(
                    "w-10 h-10 rounded-lg border text-lg flex items-center justify-center transition-colors",
                    icon === i
                      ? "bg-zinc-700 border-zinc-600"
                      : "bg-zinc-800/50 border-zinc-800 hover:bg-zinc-800"
                  )}
                >
                  {i}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-zinc-500 uppercase tracking-wider mb-2">
              Color
            </label>
            <div className="flex flex-wrap gap-2">
              {COLOR_OPTIONS.map((c) => (
                <button
                  key={c.id}
                  onClick={() => setColor(c.id)}
                  className={cn(
                    "w-8 h-8 rounded-full transition-all",
                    c.class,
                    color === c.id ? "ring-2 ring-white ring-offset-2 ring-offset-zinc-900" : ""
                  )}
                  title={c.label}
                />
              ))}
            </div>
          </div>

          {/* Preview */}
          <div>
            <label className="block text-xs font-medium text-zinc-500 uppercase tracking-wider mb-2">
              Preview
            </label>
            <div className="p-3 bg-zinc-800/50 rounded-lg border border-zinc-700/50">
              <span
                className={cn(
                  "inline-flex items-center gap-1.5 px-2 py-1 rounded-md border text-sm",
                  colorMap[color] || colorMap.zinc
                )}
              >
                <span>{icon}</span>
                <span>{name || "New Vertical"}</span>
              </span>
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-3 mt-6">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving || !name.trim()}>
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            ) : isEditing ? (
              <Save className="h-4 w-4 mr-2" />
            ) : (
              <Plus className="h-4 w-4 mr-2" />
            )}
            {isEditing ? "Save Changes" : "Create Vertical"}
          </Button>
        </div>
      </div>
    </div>
  );
}

// =============================================================================
// Delete Confirmation Modal
// =============================================================================

function DeleteModal({
  vertical,
  onConfirm,
  onClose,
}: {
  vertical: Vertical;
  onConfirm: () => Promise<void>;
  onClose: () => void;
}) {
  const [deleting, setDeleting] = useState(false);

  const handleDelete = async () => {
    setDeleting(true);
    await onConfirm();
    setDeleting(false);
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-zinc-900 rounded-lg border border-zinc-800 p-6 w-full max-w-sm">
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2 rounded-full bg-red-500/10">
            <AlertTriangle className="h-5 w-5 text-red-400" />
          </div>
          <h3 className="text-lg font-semibold text-zinc-100">Delete Vertical</h3>
        </div>

        <p className="text-sm text-zinc-400 mb-6">
          Are you sure you want to delete <strong className="text-zinc-200">{vertical.name}</strong>?
          This action cannot be undone.
        </p>

        <div className="flex justify-end gap-3">
          <Button variant="ghost" onClick={onClose} disabled={deleting}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={handleDelete}
            disabled={deleting}
            className="bg-red-600 hover:bg-red-700"
          >
            {deleting ? (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            ) : (
              <Trash2 className="h-4 w-4 mr-2" />
            )}
            Delete
          </Button>
        </div>
      </div>
    </div>
  );
}

// =============================================================================
// Main Page
// =============================================================================

export default function VerticalsPage() {
  const [loading, setLoading] = useState(true);
  const [verticals, setVerticals] = useState<Vertical[]>([]);
  const [campaignCounts, setCampaignCounts] = useState<Record<string, number>>({});
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingVertical, setEditingVertical] = useState<Vertical | null>(null);
  const [deletingVertical, setDeletingVertical] = useState<Vertical | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Fetch data
  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [verticalsRes, campaignsRes] = await Promise.all([
        fetch("/api/settings/verticals"),
        fetch("/api/settings/campaigns"),
      ]);

      if (verticalsRes.ok) {
        const data = await verticalsRes.json();
        setVerticals(data.verticals || []);
      }

      if (campaignsRes.ok) {
        const data = await campaignsRes.json();
        // Count campaigns per vertical
        const counts: Record<string, number> = {};
        [...(data.mapped || []), ...(data.unmapped || [])].forEach((c: { vertical: string | null }) => {
          const v = c.vertical || "general";
          counts[v] = (counts[v] || 0) + 1;
        });
        setCampaignCounts(counts);
      }
    } catch (err) {
      console.error("Failed to fetch data:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Handlers
  const handleCreate = async (data: { name: string; description: string; icon: string; color: string }): Promise<boolean> => {
    const res = await fetch("/api/settings/verticals", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });

    if (res.ok) {
      await fetchData();
      return true;
    }
    return false;
  };

  const handleDelete = async (id: string) => {
    setError(null);
    const res = await fetch(`/api/settings/verticals?id=${id}`, {
      method: "DELETE",
    });

    if (res.ok) {
      await fetchData();
    } else {
      const data = await res.json();
      setError(data.error || "Failed to delete vertical");
    }
  };

  // Separate system and custom verticals
  const systemVerticals = verticals.filter((v) => v.is_system);
  const customVerticals = verticals.filter((v) => !v.is_system);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-zinc-500" />
      </div>
    );
  }

  return (
    <div className="max-w-4xl">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-xl font-semibold text-zinc-100">Verticals</h1>
          <p className="text-sm text-zinc-500 mt-1">
            Manage industry verticals for campaign categorization and QA rules.
          </p>
        </div>
        <Button onClick={() => setShowCreateModal(true)}>
          <Plus className="h-4 w-4 mr-2" />
          Create Vertical
        </Button>
      </div>

      {/* Error Alert */}
      {error && (
        <div className="rounded-lg bg-red-500/10 border border-red-500/30 p-4 mb-6 flex items-start gap-3">
          <AlertTriangle className="h-5 w-5 text-red-400 mt-0.5" />
          <div>
            <p className="text-sm text-red-400">{error}</p>
            <button
              onClick={() => setError(null)}
              className="text-xs text-red-400/70 hover:text-red-400 mt-1"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {/* Explainer Card */}
      <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4 mb-8">
        <div className="flex items-start gap-3">
          <Info className="h-5 w-5 text-zinc-500 mt-0.5" />
          <div className="text-sm text-zinc-400">
            <p>
              <strong className="text-zinc-200">Verticals</strong> categorize campaigns by industry.
              Each vertical can have specific QA rules that apply to all calls from campaigns in that vertical.
            </p>
          </div>
        </div>
      </div>

      <div className="space-y-8">
        {/* System Verticals */}
        <div>
          <div className="flex items-center gap-2 mb-4">
            <Lock className="h-4 w-4 text-zinc-500" />
            <h2 className="text-sm font-medium text-zinc-400 uppercase tracking-wider">
              System Verticals ({systemVerticals.length})
            </h2>
          </div>
          <p className="text-xs text-zinc-500 mb-4">
            Built-in verticals that cannot be deleted. You can assign campaigns to these verticals.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {systemVerticals.map((v) => (
              <div
                key={v.id}
                className="flex items-center justify-between p-4 rounded-lg border border-zinc-800 bg-zinc-900/50"
              >
                <div className="flex items-center gap-3">
                  <span
                    className={cn(
                      "inline-flex items-center justify-center w-10 h-10 rounded-lg text-xl",
                      colorMap[v.color] || colorMap.zinc
                    )}
                  >
                    {v.icon}
                  </span>
                  <div>
                    <h3 className="text-sm font-medium text-zinc-200">{v.name}</h3>
                    <p className="text-xs text-zinc-500">{v.description}</p>
                  </div>
                </div>
                <div className="text-right">
                  <span className="text-sm text-zinc-400">
                    {campaignCounts[v.id] || 0}
                  </span>
                  <p className="text-xs text-zinc-600">campaigns</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Custom Verticals */}
        <div>
          <div className="flex items-center gap-2 mb-4">
            <Layers className="h-4 w-4 text-zinc-500" />
            <h2 className="text-sm font-medium text-zinc-400 uppercase tracking-wider">
              Custom Verticals ({customVerticals.length})
            </h2>
          </div>

          {customVerticals.length === 0 ? (
            <div className="rounded-lg border border-dashed border-zinc-800 p-8 text-center">
              <Layers className="h-8 w-8 text-zinc-700 mx-auto mb-3" />
              <p className="text-sm text-zinc-500 mb-2">No custom verticals yet.</p>
              <p className="text-xs text-zinc-600 mb-4">
                Create a custom vertical for industries not covered by system verticals.
              </p>
              <Button variant="outline" size="sm" onClick={() => setShowCreateModal(true)}>
                <Plus className="h-3 w-3 mr-2" />
                Create Custom Vertical
              </Button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {customVerticals.map((v) => (
                <div
                  key={v.id}
                  className="flex items-center justify-between p-4 rounded-lg border border-zinc-800 bg-zinc-900/50 group"
                >
                  <div className="flex items-center gap-3">
                    <span
                      className={cn(
                        "inline-flex items-center justify-center w-10 h-10 rounded-lg text-xl",
                        colorMap[v.color] || colorMap.zinc
                      )}
                    >
                      {v.icon}
                    </span>
                    <div>
                      <h3 className="text-sm font-medium text-zinc-200">{v.name}</h3>
                      <p className="text-xs text-zinc-500">{v.description}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="text-right mr-2">
                      <span className="text-sm text-zinc-400">
                        {campaignCounts[v.id] || 0}
                      </span>
                      <p className="text-xs text-zinc-600">campaigns</p>
                    </div>
                    <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setEditingVertical(v)}
                        className="h-8 w-8 p-0"
                      >
                        <Edit2 className="h-3 w-3" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setDeletingVertical(v)}
                        className="h-8 w-8 p-0 text-red-400 hover:text-red-300 hover:bg-red-500/10"
                        disabled={(campaignCounts[v.id] || 0) > 0}
                        title={
                          (campaignCounts[v.id] || 0) > 0
                            ? "Cannot delete: campaigns are using this vertical"
                            : "Delete vertical"
                        }
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Modals */}
      {showCreateModal && (
        <VerticalModal
          onSave={handleCreate}
          onClose={() => setShowCreateModal(false)}
        />
      )}

      {editingVertical && (
        <VerticalModal
          vertical={editingVertical}
          onSave={async (data) => {
            // For now, editing just updates icon/color/description
            // The API doesn't support PATCH yet, so we'd need to add that
            // For now, just close the modal
            setEditingVertical(null);
            return true;
          }}
          onClose={() => setEditingVertical(null)}
        />
      )}

      {deletingVertical && (
        <DeleteModal
          vertical={deletingVertical}
          onConfirm={async () => {
            await handleDelete(deletingVertical.id);
          }}
          onClose={() => setDeletingVertical(null)}
        />
      )}
    </div>
  );
}
