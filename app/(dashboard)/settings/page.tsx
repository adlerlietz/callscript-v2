"use client";

import { useState, useEffect, useCallback } from "react";
import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronRight,
  Edit2,
  Loader2,
  Plus,
  Save,
  Search,
  Shield,
  Trash2,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
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
}

interface QARule {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  scope: "global" | "vertical" | "custom";
  vertical: string | null;
  enabled: boolean;
  severity: "critical" | "warning";
  prompt_fragment: string;
  is_system: boolean;
}

type Tab = "campaigns" | "rules";

// =============================================================================
// Components
// =============================================================================

function Toggle({
  enabled,
  onToggle,
  disabled,
}: {
  enabled: boolean;
  onToggle: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onToggle}
      disabled={disabled}
      className={cn(
        "relative inline-flex h-6 w-11 items-center rounded-full transition-colors",
        enabled ? "bg-emerald-500" : "bg-zinc-700",
        disabled && "opacity-50 cursor-not-allowed"
      )}
    >
      <span
        className={cn(
          "inline-block h-4 w-4 transform rounded-full bg-white transition-transform",
          enabled ? "translate-x-6" : "translate-x-1"
        )}
      />
    </button>
  );
}

function SeverityBadge({ severity }: { severity: "critical" | "warning" }) {
  return (
    <Badge
      variant={severity === "critical" ? "danger" : "warning"}
      className="text-xs"
    >
      {severity === "critical" ? "Critical" : "Warning"}
    </Badge>
  );
}

function VerticalBadge({ vertical, verticals }: { vertical: string | null; verticals: Vertical[] }) {
  const v = verticals.find((x) => x.id === vertical);
  if (!v) return <span className="text-zinc-500 text-sm">—</span>;

  const colorMap: Record<string, string> = {
    blue: "bg-blue-500/10 text-blue-400 border-blue-500/30",
    sky: "bg-sky-500/10 text-sky-400 border-sky-500/30",
    yellow: "bg-yellow-500/10 text-yellow-400 border-yellow-500/30",
    red: "bg-red-500/10 text-red-400 border-red-500/30",
    emerald: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30",
    orange: "bg-orange-500/10 text-orange-400 border-orange-500/30",
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
}: {
  campaign: Campaign;
  verticals: Vertical[];
  onSave: (id: string, name: string, vertical: string) => Promise<void>;
  onClose: () => void;
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
      <div className="bg-zinc-900 rounded-lg border border-zinc-800 p-6 w-full max-w-md">
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-lg font-semibold text-zinc-100">Edit Campaign</h3>
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-300">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-4">
          {/* Ringba ID (readonly) */}
          <div>
            <label className="block text-xs font-medium text-zinc-500 uppercase tracking-wider mb-2">
              Ringba Campaign ID
            </label>
            <div className="font-mono text-sm text-zinc-400 bg-zinc-800 rounded-md px-3 py-2">
              {campaign.ringba_campaign_id}
            </div>
          </div>

          {/* Friendly Name */}
          <div>
            <label className="block text-xs font-medium text-zinc-500 uppercase tracking-wider mb-2">
              Friendly Name
            </label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., Facebook Solar Q4"
              className="bg-zinc-800 border-zinc-700"
            />
          </div>

          {/* Vertical Selection */}
          <div>
            <label className="block text-xs font-medium text-zinc-500 uppercase tracking-wider mb-2">
              Vertical
            </label>
            <p className="text-xs text-zinc-500 mb-2">
              This determines which QA rules apply to calls from this campaign.
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

          {/* Call Count Info */}
          <div className="text-xs text-zinc-500">
            This campaign has {campaign.call_count.toLocaleString()} calls.
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
            Save Changes
          </Button>
        </div>
      </div>
    </div>
  );
}

// =============================================================================
// Rule Edit Modal
// =============================================================================

function RuleEditModal({
  rule,
  onSave,
  onClose,
}: {
  rule: QARule;
  onSave: (id: string, updates: Partial<QARule>) => Promise<void>;
  onClose: () => void;
}) {
  const [name, setName] = useState(rule.name);
  const [description, setDescription] = useState(rule.description || "");
  const [severity, setSeverity] = useState(rule.severity);
  const [promptFragment, setPromptFragment] = useState(rule.prompt_fragment);
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    await onSave(rule.id, {
      name,
      description,
      severity,
      prompt_fragment: promptFragment,
    });
    setSaving(false);
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-zinc-900 rounded-lg border border-zinc-800 p-6 w-full max-w-lg">
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-lg font-semibold text-zinc-100">Edit Rule</h3>
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-300">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-4">
          {/* Rule Name */}
          <div>
            <label className="block text-xs font-medium text-zinc-500 uppercase tracking-wider mb-2">
              Rule Name
            </label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="bg-zinc-800 border-zinc-700"
              disabled={rule.is_system}
            />
          </div>

          {/* Description */}
          <div>
            <label className="block text-xs font-medium text-zinc-500 uppercase tracking-wider mb-2">
              Description
            </label>
            <Input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Brief description shown in the UI"
              className="bg-zinc-800 border-zinc-700"
            />
          </div>

          {/* Severity */}
          <div>
            <label className="block text-xs font-medium text-zinc-500 uppercase tracking-wider mb-2">
              Severity
            </label>
            <p className="text-xs text-zinc-500 mb-2">
              Critical issues will auto-flag calls. Warnings lower the score.
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setSeverity("critical")}
                className={cn(
                  "flex-1 px-3 py-2 rounded-lg border text-sm transition-colors",
                  severity === "critical"
                    ? "bg-red-500/10 border-red-500/30 text-red-400"
                    : "bg-zinc-800 border-zinc-700 text-zinc-400 hover:bg-zinc-700"
                )}
              >
                🔴 Critical
              </button>
              <button
                onClick={() => setSeverity("warning")}
                className={cn(
                  "flex-1 px-3 py-2 rounded-lg border text-sm transition-colors",
                  severity === "warning"
                    ? "bg-amber-500/10 border-amber-500/30 text-amber-400"
                    : "bg-zinc-800 border-zinc-700 text-zinc-400 hover:bg-zinc-700"
                )}
              >
                ⚠️ Warning
              </button>
            </div>
          </div>

          {/* Prompt Fragment */}
          <div>
            <label className="block text-xs font-medium text-zinc-500 uppercase tracking-wider mb-2">
              AI Instruction
            </label>
            <p className="text-xs text-zinc-500 mb-2">
              This text is sent to the AI judge. Be specific about what to flag.
            </p>
            <textarea
              value={promptFragment}
              onChange={(e) => setPromptFragment(e.target.value)}
              rows={4}
              className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-zinc-600"
              placeholder="Flag if the agent..."
            />
          </div>
        </div>

        <div className="flex justify-end gap-3 mt-6">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving || !name || !promptFragment}>
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            ) : (
              <Save className="h-4 w-4 mr-2" />
            )}
            Save Changes
          </Button>
        </div>
      </div>
    </div>
  );
}

// =============================================================================
// Add Custom Rule Modal
// =============================================================================

function AddRuleModal({
  onSave,
  onClose,
}: {
  onSave: (rule: { name: string; description: string; severity: "critical" | "warning"; prompt_fragment: string }) => Promise<void>;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [severity, setSeverity] = useState<"critical" | "warning">("warning");
  const [promptFragment, setPromptFragment] = useState("");
  const [saving, setSaving] = useState(false);

  // Template suggestions
  const templates = [
    { label: "Must mention phrase", prompt: 'Flag if the agent does NOT mention "[PHRASE]" during the call.' },
    { label: "Must not say", prompt: 'Flag if the agent says "[PHRASE]" or similar language.' },
    { label: "Minimum mentions", prompt: 'Flag if the agent mentions "[PHRASE]" fewer than [N] times.' },
    { label: "Custom check", prompt: "Flag if..." },
  ];

  const handleSave = async () => {
    setSaving(true);
    await onSave({ name, description, severity, prompt_fragment: promptFragment });
    setSaving(false);
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-zinc-900 rounded-lg border border-zinc-800 p-6 w-full max-w-lg">
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-lg font-semibold text-zinc-100">Add Custom Rule</h3>
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-300">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-4">
          {/* Rule Name */}
          <div>
            <label className="block text-xs font-medium text-zinc-500 uppercase tracking-wider mb-2">
              Rule Name
            </label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., Zero Down Promotion"
              className="bg-zinc-800 border-zinc-700"
            />
          </div>

          {/* Description */}
          <div>
            <label className="block text-xs font-medium text-zinc-500 uppercase tracking-wider mb-2">
              Description (Optional)
            </label>
            <Input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Brief description"
              className="bg-zinc-800 border-zinc-700"
            />
          </div>

          {/* Severity */}
          <div>
            <label className="block text-xs font-medium text-zinc-500 uppercase tracking-wider mb-2">
              Severity
            </label>
            <div className="flex gap-2">
              <button
                onClick={() => setSeverity("critical")}
                className={cn(
                  "flex-1 px-3 py-2 rounded-lg border text-sm transition-colors",
                  severity === "critical"
                    ? "bg-red-500/10 border-red-500/30 text-red-400"
                    : "bg-zinc-800 border-zinc-700 text-zinc-400 hover:bg-zinc-700"
                )}
              >
                🔴 Critical (Auto-flag)
              </button>
              <button
                onClick={() => setSeverity("warning")}
                className={cn(
                  "flex-1 px-3 py-2 rounded-lg border text-sm transition-colors",
                  severity === "warning"
                    ? "bg-amber-500/10 border-amber-500/30 text-amber-400"
                    : "bg-zinc-800 border-zinc-700 text-zinc-400 hover:bg-zinc-700"
                )}
              >
                ⚠️ Warning (Lower score)
              </button>
            </div>
          </div>

          {/* Template Suggestions */}
          <div>
            <label className="block text-xs font-medium text-zinc-500 uppercase tracking-wider mb-2">
              Start from template
            </label>
            <div className="flex flex-wrap gap-2">
              {templates.map((t) => (
                <button
                  key={t.label}
                  onClick={() => setPromptFragment(t.prompt)}
                  className="px-2 py-1 text-xs bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded text-zinc-400"
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          {/* Prompt Fragment */}
          <div>
            <label className="block text-xs font-medium text-zinc-500 uppercase tracking-wider mb-2">
              AI Instruction
            </label>
            <textarea
              value={promptFragment}
              onChange={(e) => setPromptFragment(e.target.value)}
              rows={4}
              className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-zinc-600"
              placeholder='Flag if the agent fails to mention "Zero Down" at least 2 times during the call.'
            />
          </div>
        </div>

        <div className="flex justify-end gap-3 mt-6">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving || !name || !promptFragment}>
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            ) : (
              <Plus className="h-4 w-4 mr-2" />
            )}
            Add Rule
          </Button>
        </div>
      </div>
    </div>
  );
}

// =============================================================================
// Main Settings Page
// =============================================================================

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState<Tab>("campaigns");
  const [loading, setLoading] = useState(true);

  // Campaigns state
  const [campaigns, setCampaigns] = useState<{ unmapped: Campaign[]; mapped: Campaign[] }>({
    unmapped: [],
    mapped: [],
  });
  const [verticals, setVerticals] = useState<Vertical[]>([]);
  const [editingCampaign, setEditingCampaign] = useState<Campaign | null>(null);
  const [campaignSearch, setCampaignSearch] = useState("");

  // Rules state
  const [rules, setRules] = useState<{
    global: QARule[];
    vertical: Record<string, QARule[]>;
    custom: QARule[];
  }>({ global: [], vertical: {}, custom: [] });
  const [editingRule, setEditingRule] = useState<QARule | null>(null);
  const [addingRule, setAddingRule] = useState(false);
  const [expandedVerticals, setExpandedVerticals] = useState<Set<string>>(new Set());

  // Fetch data
  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [campaignsRes, verticalsRes, rulesRes] = await Promise.all([
        fetch("/api/settings/campaigns"),
        fetch("/api/settings/verticals"),
        fetch("/api/settings/rules"),
      ]);

      if (campaignsRes.ok) {
        const data = await campaignsRes.json();
        setCampaigns({ unmapped: data.unmapped || [], mapped: data.mapped || [] });
      }

      if (verticalsRes.ok) {
        const data = await verticalsRes.json();
        setVerticals(data.verticals || []);
      }

      if (rulesRes.ok) {
        const data = await rulesRes.json();
        setRules({
          global: data.global || [],
          vertical: data.vertical || {},
          custom: data.custom || [],
        });
      }
    } catch (err) {
      console.error("Failed to fetch settings data:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Campaign handlers
  const handleSaveCampaign = async (id: string, name: string, vertical: string) => {
    await fetch("/api/settings/campaigns", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, name, vertical }),
    });
    await fetchData();
  };

  // Rule handlers
  const handleToggleRule = async (rule: QARule) => {
    await fetch("/api/settings/rules", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: rule.id, enabled: !rule.enabled }),
    });
    await fetchData();
  };

  const handleSaveRule = async (id: string, updates: Partial<QARule>) => {
    await fetch("/api/settings/rules", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, ...updates }),
    });
    await fetchData();
  };

  const handleAddRule = async (rule: { name: string; description: string; severity: "critical" | "warning"; prompt_fragment: string }) => {
    await fetch("/api/settings/rules", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(rule),
    });
    await fetchData();
  };

  const handleDeleteRule = async (id: string) => {
    if (!confirm("Are you sure you want to delete this rule?")) return;
    await fetch(`/api/settings/rules?id=${id}`, { method: "DELETE" });
    await fetchData();
  };

  // Filter campaigns by search
  const filteredMapped = campaigns.mapped.filter(
    (c) =>
      c.name.toLowerCase().includes(campaignSearch.toLowerCase()) ||
      c.ringba_campaign_id.toLowerCase().includes(campaignSearch.toLowerCase())
  );

  // Toggle vertical expansion
  const toggleVertical = (v: string) => {
    const next = new Set(expandedVerticals);
    if (next.has(v)) {
      next.delete(v);
    } else {
      next.add(v);
    }
    setExpandedVerticals(next);
  };

  const tabs: { id: Tab; label: string; count?: number }[] = [
    { id: "campaigns", label: "Campaigns", count: campaigns.unmapped.length || undefined },
    { id: "rules", label: "QA Rules" },
  ];

  if (loading) {
    return (
      <div className="p-8 flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-zinc-500" />
      </div>
    );
  }

  return (
    <div className="p-8">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-zinc-100">Settings</h1>
        <p className="text-sm text-zinc-500">Configure campaigns and QA rules</p>
      </div>

      {/* Tabs */}
      <div className="mb-8 border-b border-zinc-800">
        <nav className="flex gap-8">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                "pb-4 text-sm font-medium transition-colors border-b-2 -mb-px flex items-center gap-2",
                activeTab === tab.id
                  ? "border-zinc-100 text-zinc-100"
                  : "border-transparent text-zinc-500 hover:text-zinc-300"
              )}
            >
              {tab.label}
              {tab.count && tab.count > 0 && (
                <span className="px-1.5 py-0.5 text-xs bg-amber-500/20 text-amber-400 rounded">
                  {tab.count}
                </span>
              )}
            </button>
          ))}
        </nav>
      </div>

      {/* ========== CAMPAIGNS TAB ========== */}
      {activeTab === "campaigns" && (
        <div className="space-y-8">
          {/* Unmapped Campaigns Alert */}
          {campaigns.unmapped.length > 0 && (
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-4">
              <div className="flex items-start gap-3">
                <AlertTriangle className="h-5 w-5 text-amber-400 mt-0.5" />
                <div className="flex-1">
                  <h3 className="text-sm font-medium text-amber-400">
                    {campaigns.unmapped.length} Unmapped Campaign{campaigns.unmapped.length > 1 ? "s" : ""}
                  </h3>
                  <p className="text-sm text-zinc-400 mt-1">
                    These campaigns are using default QA rules. Assign a vertical to apply industry-specific compliance checks.
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
                      <span className="font-mono text-sm text-zinc-400">
                        {c.ringba_campaign_id.slice(0, 24)}...
                      </span>
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
                      Map Campaign
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Mapped Campaigns Table */}
          <div>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-medium text-zinc-400 uppercase tracking-wider">
                Mapped Campaigns ({campaigns.mapped.length})
              </h2>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-500" />
                <Input
                  placeholder="Search campaigns..."
                  value={campaignSearch}
                  onChange={(e) => setCampaignSearch(e.target.value)}
                  className="pl-9 w-64 bg-zinc-900 border-zinc-800"
                />
              </div>
            </div>

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
                        {campaignSearch ? "No campaigns match your search" : "No mapped campaigns yet"}
                      </td>
                    </tr>
                  ) : (
                    filteredMapped.map((c) => (
                      <tr key={c.id} className="hover:bg-zinc-900/50">
                        <td className="px-4 py-4 font-mono text-sm text-zinc-500">
                          {c.ringba_campaign_id.slice(0, 20)}...
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
          </div>
        </div>
      )}

      {/* ========== QA RULES TAB ========== */}
      {activeTab === "rules" && (
        <div className="space-y-8">
          {/* Global Rules */}
          <div>
            <div className="flex items-center gap-2 mb-4">
              <Shield className="h-4 w-4 text-zinc-400" />
              <h2 className="text-sm font-medium text-zinc-400 uppercase tracking-wider">
                Global Rules
              </h2>
              <span className="text-xs text-zinc-600">(Apply to all calls)</span>
            </div>

            <div className="space-y-2">
              {rules.global.map((rule) => (
                <div
                  key={rule.id}
                  className={cn(
                    "flex items-center justify-between rounded-lg border bg-zinc-900 p-4",
                    rule.enabled ? "border-zinc-800" : "border-zinc-800/50 opacity-60"
                  )}
                >
                  <div className="flex-1">
                    <div className="flex items-center gap-3">
                      <h3 className="text-sm font-medium text-zinc-100">{rule.name}</h3>
                      <SeverityBadge severity={rule.severity} />
                      {rule.is_system && (
                        <Badge variant="default" className="text-xs">System</Badge>
                      )}
                    </div>
                    <p className="mt-1 text-sm text-zinc-500">{rule.description}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setEditingRule(rule)}
                    >
                      <Edit2 className="h-3 w-3" />
                    </Button>
                    <Toggle
                      enabled={rule.enabled}
                      onToggle={() => handleToggleRule(rule)}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Vertical Rules */}
          <div>
            <h2 className="text-sm font-medium text-zinc-400 uppercase tracking-wider mb-4">
              Vertical-Specific Rules
            </h2>

            <div className="space-y-2">
              {verticals
                .filter((v) => v.id !== "general")
                .map((v) => {
                  const verticalRules = rules.vertical[v.id] || [];
                  const isExpanded = expandedVerticals.has(v.id);
                  const enabledCount = verticalRules.filter((r) => r.enabled).length;

                  return (
                    <div key={v.id} className="rounded-lg border border-zinc-800 overflow-hidden">
                      <button
                        onClick={() => toggleVertical(v.id)}
                        className="w-full flex items-center justify-between p-4 bg-zinc-900 hover:bg-zinc-800/50 transition-colors"
                      >
                        <div className="flex items-center gap-3">
                          <span className="text-lg">{v.icon}</span>
                          <span className="font-medium text-zinc-200">{v.name}</span>
                          <span className="text-xs text-zinc-500">
                            {enabledCount}/{verticalRules.length} rules active
                          </span>
                        </div>
                        {isExpanded ? (
                          <ChevronDown className="h-4 w-4 text-zinc-500" />
                        ) : (
                          <ChevronRight className="h-4 w-4 text-zinc-500" />
                        )}
                      </button>

                      {isExpanded && verticalRules.length > 0 && (
                        <div className="border-t border-zinc-800 divide-y divide-zinc-800">
                          {verticalRules.map((rule) => (
                            <div
                              key={rule.id}
                              className={cn(
                                "flex items-center justify-between p-4",
                                !rule.enabled && "opacity-60"
                              )}
                            >
                              <div className="flex-1 pl-8">
                                <div className="flex items-center gap-3">
                                  <h4 className="text-sm font-medium text-zinc-200">
                                    {rule.name}
                                  </h4>
                                  <SeverityBadge severity={rule.severity} />
                                </div>
                                <p className="mt-1 text-sm text-zinc-500">{rule.description}</p>
                              </div>
                              <div className="flex items-center gap-3">
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => setEditingRule(rule)}
                                >
                                  <Edit2 className="h-3 w-3" />
                                </Button>
                                <Toggle
                                  enabled={rule.enabled}
                                  onToggle={() => handleToggleRule(rule)}
                                />
                              </div>
                            </div>
                          ))}
                        </div>
                      )}

                      {isExpanded && verticalRules.length === 0 && (
                        <div className="p-4 text-center text-sm text-zinc-500 border-t border-zinc-800">
                          No rules configured for this vertical
                        </div>
                      )}
                    </div>
                  );
                })}
            </div>
          </div>

          {/* Custom Rules */}
          <div>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-medium text-zinc-400 uppercase tracking-wider">
                Custom Rules
              </h2>
              <Button variant="outline" size="sm" onClick={() => setAddingRule(true)}>
                <Plus className="h-3 w-3 mr-2" />
                Add Rule
              </Button>
            </div>

            {rules.custom.length === 0 ? (
              <div className="rounded-lg border border-dashed border-zinc-800 p-8 text-center">
                <p className="text-sm text-zinc-500 mb-3">
                  No custom rules yet. Add rules specific to your business needs.
                </p>
                <Button variant="outline" size="sm" onClick={() => setAddingRule(true)}>
                  <Plus className="h-3 w-3 mr-2" />
                  Add Your First Rule
                </Button>
              </div>
            ) : (
              <div className="space-y-2">
                {rules.custom.map((rule) => (
                  <div
                    key={rule.id}
                    className={cn(
                      "flex items-center justify-between rounded-lg border bg-zinc-900 p-4",
                      rule.enabled ? "border-zinc-800" : "border-zinc-800/50 opacity-60"
                    )}
                  >
                    <div className="flex-1">
                      <div className="flex items-center gap-3">
                        <h3 className="text-sm font-medium text-zinc-100">{rule.name}</h3>
                        <SeverityBadge severity={rule.severity} />
                      </div>
                      <p className="mt-1 text-sm text-zinc-500">
                        {rule.description || rule.prompt_fragment.slice(0, 80)}...
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setEditingRule(rule)}
                      >
                        <Edit2 className="h-3 w-3" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleDeleteRule(rule.id)}
                        className="text-red-400 hover:text-red-300"
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                      <Toggle
                        enabled={rule.enabled}
                        onToggle={() => handleToggleRule(rule)}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Modals */}
      {editingCampaign && (
        <CampaignEditModal
          campaign={editingCampaign}
          verticals={verticals}
          onSave={handleSaveCampaign}
          onClose={() => setEditingCampaign(null)}
        />
      )}

      {editingRule && (
        <RuleEditModal
          rule={editingRule}
          onSave={handleSaveRule}
          onClose={() => setEditingRule(null)}
        />
      )}

      {addingRule && (
        <AddRuleModal
          onSave={handleAddRule}
          onClose={() => setAddingRule(false)}
        />
      )}
    </div>
  );
}
