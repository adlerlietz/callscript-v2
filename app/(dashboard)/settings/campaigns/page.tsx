"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Tags,
  AlertTriangle,
  Search,
  Edit2,
  Loader2,
  Save,
  X,
  ArrowRight,
  Info,
  Plus,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

// =============================================================================
// Types
// =============================================================================

interface Campaign {
  id: string;
  ringba_campaign_id: string;
  name: string;
  vertical: string | null;
  is_verified: boolean;
  call_count: number;
  is_mapped: boolean;
}

interface Vertical {
  id: string;
  name: string;
  description: string;
  icon: string;
  color: string;
  is_system?: boolean;
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
];

// Common emoji icons for verticals
const ICON_OPTIONS = ["📋", "📞", "💼", "🏠", "🚗", "💰", "🏥", "⚡", "🔧", "📊", "🎯", "💎", "🛡️", "📱", "🌐"];

// =============================================================================
// Components
// =============================================================================

function VerticalBadge({
  vertical,
  verticals,
}: {
  vertical: string | null;
  verticals: Vertical[];
}) {
  const v = verticals.find((x) => x.id === vertical);
  if (!v) return <span className="text-zinc-500 text-sm">Not assigned</span>;

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

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 px-2 py-1 rounded-md border text-sm",
        colorMap[v.color] || colorMap.zinc
      )}
    >
      <span>{v.icon}</span>
      <span>{v.name}</span>
    </span>
  );
}

// =============================================================================
// Campaign Edit Modal
// =============================================================================

function CampaignEditModal({
  campaign,
  verticals,
  onSave,
  onClose,
  onCreateVertical,
}: {
  campaign: Campaign;
  verticals: Vertical[];
  onSave: (id: string, name: string, vertical: string) => Promise<void>;
  onClose: () => void;
  onCreateVertical: () => void;
}) {
  const [name, setName] = useState(campaign.name || "");
  const [vertical, setVertical] = useState(campaign.vertical || "general");
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    await onSave(campaign.id, name, vertical);
    setSaving(false);
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-zinc-900 rounded-lg border border-zinc-800 p-6 w-full max-w-md max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-lg font-semibold text-zinc-100">Map Campaign</h3>
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-300">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-6">
          {/* The Problem → The Solution */}
          <div className="rounded-lg bg-zinc-800/50 p-4 border border-zinc-700/50">
            <div className="flex items-center gap-3 mb-3">
              <div className="flex-1">
                <p className="text-xs text-zinc-500 uppercase tracking-wider mb-1">
                  Ringba sees
                </p>
                <code className="text-sm font-mono text-zinc-400 break-all">
                  {campaign.ringba_campaign_id}
                </code>
              </div>
              <ArrowRight className="h-4 w-4 text-zinc-600" />
              <div className="flex-1">
                <p className="text-xs text-zinc-500 uppercase tracking-wider mb-1">
                  You see
                </p>
                <span className="text-sm text-zinc-200">
                  {name || "Your friendly name"}
                </span>
              </div>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-zinc-500 uppercase tracking-wider mb-2">
              Friendly Name
            </label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., ACA - Facebook Ads Q4"
              className="bg-zinc-800 border-zinc-700"
            />
            <p className="text-xs text-zinc-500 mt-1">
              This name appears in reports and the dashboard.
            </p>
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="block text-xs font-medium text-zinc-500 uppercase tracking-wider">
                Vertical
              </label>
              <button
                onClick={onCreateVertical}
                className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1"
              >
                <Plus className="h-3 w-3" />
                Create New
              </button>
            </div>
            <p className="text-xs text-zinc-500 mb-3">
              The vertical determines which QA rules apply to calls from this campaign.
            </p>
            <div className="grid grid-cols-2 gap-2">
              {verticals.map((v) => (
                <button
                  key={v.id}
                  onClick={() => setVertical(v.id)}
                  className={cn(
                    "flex items-center gap-2 px-3 py-2 rounded-lg border text-left transition-colors",
                    vertical === v.id
                      ? "bg-zinc-700 border-zinc-600 text-zinc-100"
                      : "bg-zinc-800/50 border-zinc-800 text-zinc-400 hover:bg-zinc-800"
                  )}
                >
                  <span>{v.icon}</span>
                  <span className="text-sm">{v.name}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="text-xs text-zinc-500 flex items-center gap-2">
            <Info className="h-3 w-3" />
            <span>
              {campaign.call_count.toLocaleString()} calls will use these settings.
            </span>
          </div>
        </div>

        <div className="flex justify-end gap-3 mt-6">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving || !name}>
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            ) : (
              <Save className="h-4 w-4 mr-2" />
            )}
            Save Mapping
          </Button>
        </div>
      </div>
    </div>
  );
}

// =============================================================================
// Create Vertical Modal
// =============================================================================

function CreateVerticalModal({
  onSave,
  onClose,
}: {
  onSave: (vertical: { name: string; description: string; icon: string; color: string }) => Promise<boolean>;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [icon, setIcon] = useState("📋");
  const [color, setColor] = useState("blue");
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
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-zinc-900 rounded-lg border border-zinc-800 p-6 w-full max-w-md max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-lg font-semibold text-zinc-100">Create Custom Vertical</h3>
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
            />
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
                  `bg-${color}-500/10 text-${color}-400 border-${color}-500/30`
                )}
                style={{
                  backgroundColor: `color-mix(in srgb, var(--color-${color}-500, #6b7280) 10%, transparent)`,
                  color: `var(--color-${color}-400, #9ca3af)`,
                  borderColor: `color-mix(in srgb, var(--color-${color}-500, #6b7280) 30%, transparent)`,
                }}
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
            ) : (
              <Plus className="h-4 w-4 mr-2" />
            )}
            Create Vertical
          </Button>
        </div>
      </div>
    </div>
  );
}

// =============================================================================
// Main Page
// =============================================================================

export default function CampaignsPage() {
  const [loading, setLoading] = useState(true);
  const [campaigns, setCampaigns] = useState<{
    unmapped: Campaign[];
    mapped: Campaign[];
  }>({ unmapped: [], mapped: [] });
  const [verticals, setVerticals] = useState<Vertical[]>([]);
  const [editingCampaign, setEditingCampaign] = useState<Campaign | null>(null);
  const [showCreateVertical, setShowCreateVertical] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  // Fetch data
  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [campaignsRes, verticalsRes] = await Promise.all([
        fetch("/api/settings/campaigns"),
        fetch("/api/settings/verticals"),
      ]);

      if (campaignsRes.ok) {
        const data = await campaignsRes.json();
        setCampaigns({ unmapped: data.unmapped || [], mapped: data.mapped || [] });
      }

      if (verticalsRes.ok) {
        const data = await verticalsRes.json();
        setVerticals(data.verticals || []);
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
  const handleSaveCampaign = async (id: string, name: string, vertical: string) => {
    await fetch("/api/settings/campaigns", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, name, vertical }),
    });
    await fetchData();
  };

  const handleCreateVertical = async (vertical: {
    name: string;
    description: string;
    icon: string;
    color: string;
  }): Promise<boolean> => {
    const res = await fetch("/api/settings/verticals", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(vertical),
    });

    if (res.ok) {
      // Refresh verticals list
      const verticalsRes = await fetch("/api/settings/verticals");
      if (verticalsRes.ok) {
        const data = await verticalsRes.json();
        setVerticals(data.verticals || []);
      }
      return true;
    }
    return false;
  };

  // Filter campaigns
  const filteredMapped = campaigns.mapped.filter(
    (c) =>
      c.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      c.ringba_campaign_id.toLowerCase().includes(searchQuery.toLowerCase())
  );

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
      <div className="mb-8">
        <h1 className="text-xl font-semibold text-zinc-100">Campaigns</h1>
        <p className="text-sm text-zinc-500 mt-1">
          Map Ringba campaign IDs to friendly names and assign verticals.
        </p>
      </div>

      {/* Explainer Card */}
      <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4 mb-8">
        <div className="flex items-start gap-3">
          <Info className="h-5 w-5 text-zinc-500 mt-0.5" />
          <div className="text-sm text-zinc-400">
            <p className="mb-2">
              <strong className="text-zinc-200">The Problem:</strong> Ringba sends cryptic
              IDs like <code className="text-xs bg-zinc-800 px-1 rounded">CA-8823-9912</code>.
              Your dashboard looks ugly and the AI doesn&apos;t know what rules to apply.
            </p>
            <p>
              <strong className="text-zinc-200">The Solution:</strong> Map each campaign to
              a friendly name and vertical. The AI Judge will automatically apply the
              correct industry rules.
            </p>
          </div>
        </div>
      </div>

      <div className="space-y-8">
        {/* ========== UNMAPPED CAMPAIGNS (ALERT) ========== */}
        {campaigns.unmapped.length > 0 && (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-4">
            <div className="flex items-start gap-3">
              <AlertTriangle className="h-5 w-5 text-amber-400 mt-0.5" />
              <div className="flex-1">
                <h3 className="text-sm font-medium text-amber-400">
                  {campaigns.unmapped.length} Campaign
                  {campaigns.unmapped.length > 1 ? "s" : ""} Need Mapping
                </h3>
                <p className="text-sm text-zinc-400 mt-1">
                  These campaigns are using default &quot;General&quot; rules. Assign a vertical to
                  apply industry-specific compliance checks.
                </p>
              </div>
            </div>

            <div className="mt-4 space-y-2">
              {campaigns.unmapped.map((c) => (
                <div
                  key={c.id}
                  className="flex items-center justify-between bg-zinc-900/50 rounded-lg px-4 py-3 border border-zinc-800"
                >
                  <div>
                    <code className="font-mono text-sm text-zinc-400">
                      {c.ringba_campaign_id.length > 28
                        ? c.ringba_campaign_id.slice(0, 28) + "..."
                        : c.ringba_campaign_id}
                    </code>
                    <span className="ml-3 text-xs text-zinc-500">
                      {c.call_count.toLocaleString()} calls
                    </span>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setEditingCampaign(c)}
                  >
                    <Edit2 className="h-3 w-3 mr-2" />
                    Map Now
                  </Button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ========== MAPPED CAMPAIGNS TABLE ========== */}
        <div>
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Tags className="h-4 w-4 text-zinc-400" />
              <h2 className="text-sm font-medium text-zinc-400 uppercase tracking-wider">
                Mapped Campaigns ({campaigns.mapped.length})
              </h2>
            </div>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-500" />
              <Input
                placeholder="Search..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9 w-56 bg-zinc-900 border-zinc-800"
              />
            </div>
          </div>

          {campaigns.mapped.length === 0 && campaigns.unmapped.length === 0 ? (
            <div className="rounded-lg border border-dashed border-zinc-800 p-8 text-center">
              <Tags className="h-8 w-8 text-zinc-700 mx-auto mb-3" />
              <p className="text-sm text-zinc-500 mb-2">No campaigns detected yet.</p>
              <p className="text-xs text-zinc-600">
                Campaigns will appear here after the first Ringba sync.
              </p>
            </div>
          ) : (
            <div className="rounded-lg border border-zinc-800 overflow-hidden">
              <table className="w-full">
                <thead className="bg-zinc-900">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-zinc-500 uppercase tracking-wider">
                      Ringba ID
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-zinc-500 uppercase tracking-wider">
                      Friendly Name
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-zinc-500 uppercase tracking-wider">
                      Vertical
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-zinc-500 uppercase tracking-wider">
                      Calls
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-zinc-500 uppercase tracking-wider">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800">
                  {filteredMapped.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-4 py-8 text-center text-zinc-500">
                        {searchQuery
                          ? "No campaigns match your search"
                          : "No mapped campaigns yet"}
                      </td>
                    </tr>
                  ) : (
                    filteredMapped.map((c) => (
                      <tr key={c.id} className="hover:bg-zinc-900/50">
                        <td className="px-4 py-4 font-mono text-sm text-zinc-500">
                          {c.ringba_campaign_id.length > 20
                            ? c.ringba_campaign_id.slice(0, 20) + "..."
                            : c.ringba_campaign_id}
                        </td>
                        <td className="px-4 py-4 text-sm text-zinc-200">{c.name}</td>
                        <td className="px-4 py-4">
                          <VerticalBadge vertical={c.vertical} verticals={verticals} />
                        </td>
                        <td className="px-4 py-4 text-sm text-zinc-400">
                          {c.call_count.toLocaleString()}
                        </td>
                        <td className="px-4 py-4 text-right">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setEditingCampaign(c)}
                          >
                            <Edit2 className="h-3 w-3" />
                          </Button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Modals */}
      {editingCampaign && (
        <CampaignEditModal
          campaign={editingCampaign}
          verticals={verticals}
          onSave={handleSaveCampaign}
          onClose={() => setEditingCampaign(null)}
          onCreateVertical={() => setShowCreateVertical(true)}
        />
      )}

      {showCreateVertical && (
        <CreateVerticalModal
          onSave={handleCreateVertical}
          onClose={() => setShowCreateVertical(false)}
        />
      )}
    </div>
  );
}
