"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Shield,
  ShieldAlert,
  ShieldCheck,
  ChevronDown,
  ChevronRight,
  Edit2,
  Plus,
  Trash2,
  Loader2,
  Save,
  X,
  Info,
  Zap,
  AlertTriangle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

// =============================================================================
// Types
// =============================================================================

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

interface Vertical {
  id: string;
  name: string;
  description: string;
  icon: string;
  color: string;
}

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
  const [promptFragment, setPromptFragment] = useState(rule.prompt_fragment || "");
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

          <div>
            <label className="block text-xs font-medium text-zinc-500 uppercase tracking-wider mb-2">
              Description
            </label>
            <Input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What this rule checks for"
              className="bg-zinc-800 border-zinc-700"
            />
          </div>

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
                Critical (Auto-flag)
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
                Warning (Lower score)
              </button>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-zinc-500 uppercase tracking-wider mb-2">
              AI Instruction
            </label>
            <p className="text-xs text-zinc-500 mb-2">
              This exact text is injected into the AI Judge&apos;s system prompt.
            </p>
            <textarea
              value={promptFragment}
              onChange={(e) => setPromptFragment(e.target.value)}
              rows={4}
              className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-zinc-600"
              placeholder="Flag if the agent fails to..."
            />
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
// Add Custom Rule Modal
// =============================================================================

function AddRuleModal({
  verticals,
  initialVertical,
  onSave,
  onClose,
}: {
  verticals: Vertical[];
  initialVertical?: string | null;
  onSave: (rule: {
    name: string;
    description: string;
    severity: "critical" | "warning";
    prompt_fragment: string;
    scope: "global" | "vertical" | "custom";
    vertical: string | null;
  }) => Promise<void>;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [severity, setSeverity] = useState<"critical" | "warning">("warning");
  const [promptFragment, setPromptFragment] = useState("");
  const [scope, setScope] = useState<"global" | "vertical" | "custom">(
    initialVertical ? "vertical" : "custom"
  );
  const [vertical, setVertical] = useState<string | null>(initialVertical || null);
  const [saving, setSaving] = useState(false);

  const templates = [
    {
      label: "Must say phrase",
      prompt: 'Flag if the agent does NOT say "[YOUR PHRASE HERE]" during the call.',
    },
    {
      label: "Must NOT say",
      prompt: 'Flag if the agent says "[PROHIBITED PHRASE]" or similar language.',
    },
    {
      label: "Required disclosure",
      prompt: 'Flag if the agent fails to disclose "[REQUIRED DISCLOSURE]" before collecting personal information.',
    },
    {
      label: "Verify identity",
      prompt: "Flag if the agent does not verify the caller's identity before discussing account details.",
    },
    {
      label: "No pressure tactics",
      prompt: "Flag if the agent uses high-pressure sales tactics or creates false urgency.",
    },
    {
      label: "Custom",
      prompt: "Flag if...",
    },
  ];

  const handleSave = async () => {
    setSaving(true);
    await onSave({
      name,
      description,
      severity,
      prompt_fragment: promptFragment,
      scope,
      vertical: scope === "vertical" ? vertical : null,
    });
    setSaving(false);
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-zinc-900 rounded-lg border border-zinc-800 p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-lg font-semibold text-zinc-100">Create QA Rule</h3>
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-300">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-5">
          {/* Scope Selection */}
          <div>
            <label className="block text-xs font-medium text-zinc-500 uppercase tracking-wider mb-2">
              Rule Applies To
            </label>
            <div className="grid grid-cols-3 gap-2">
              <button
                onClick={() => { setScope("vertical"); if (!vertical && verticals.length > 0) setVertical(verticals[0].id); }}
                className={cn(
                  "px-3 py-2.5 rounded-lg border text-sm transition-colors text-center",
                  scope === "vertical"
                    ? "bg-blue-500/10 border-blue-500/30 text-blue-400"
                    : "bg-zinc-800 border-zinc-700 text-zinc-400 hover:bg-zinc-700"
                )}
              >
                <Zap className="h-4 w-4 mx-auto mb-1" />
                Vertical
              </button>
              <button
                onClick={() => setScope("global")}
                className={cn(
                  "px-3 py-2.5 rounded-lg border text-sm transition-colors text-center",
                  scope === "global"
                    ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400"
                    : "bg-zinc-800 border-zinc-700 text-zinc-400 hover:bg-zinc-700"
                )}
              >
                <ShieldCheck className="h-4 w-4 mx-auto mb-1" />
                All Calls
              </button>
              <button
                onClick={() => setScope("custom")}
                className={cn(
                  "px-3 py-2.5 rounded-lg border text-sm transition-colors text-center",
                  scope === "custom"
                    ? "bg-purple-500/10 border-purple-500/30 text-purple-400"
                    : "bg-zinc-800 border-zinc-700 text-zinc-400 hover:bg-zinc-700"
                )}
              >
                <Shield className="h-4 w-4 mx-auto mb-1" />
                Custom
              </button>
            </div>
            <p className="text-xs text-zinc-500 mt-2">
              {scope === "vertical" && "This rule will only apply to calls from campaigns in the selected vertical."}
              {scope === "global" && "This rule will apply to ALL calls regardless of vertical."}
              {scope === "custom" && "Custom rules apply to all calls but are organized separately."}
            </p>
          </div>

          {/* Vertical Selector (when scope is vertical) */}
          {scope === "vertical" && (
            <div>
              <label className="block text-xs font-medium text-zinc-500 uppercase tracking-wider mb-2">
                Select Vertical
              </label>
              <div className="grid grid-cols-2 gap-2">
                {verticals.filter(v => v.id !== "general").map((v) => (
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
          )}

          {/* Rule Name */}
          <div>
            <label className="block text-xs font-medium text-zinc-500 uppercase tracking-wider mb-2">
              Rule Name *
            </label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., Accident Date Required"
              className="bg-zinc-800 border-zinc-700"
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
              placeholder="Brief description of what this rule checks"
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
                <ShieldAlert className="h-4 w-4 inline mr-2" />
                Critical
                <span className="block text-xs opacity-70">Auto-flags call</span>
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
                <AlertTriangle className="h-4 w-4 inline mr-2" />
                Warning
                <span className="block text-xs opacity-70">Lowers QA score</span>
              </button>
            </div>
          </div>

          {/* Template Shortcuts */}
          <div>
            <label className="block text-xs font-medium text-zinc-500 uppercase tracking-wider mb-2">
              Quick Templates
            </label>
            <div className="flex flex-wrap gap-2">
              {templates.map((t) => (
                <button
                  key={t.label}
                  onClick={() => setPromptFragment(t.prompt)}
                  className="px-2.5 py-1.5 text-xs bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded-md text-zinc-400 transition-colors"
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          {/* AI Instruction */}
          <div>
            <label className="block text-xs font-medium text-zinc-500 uppercase tracking-wider mb-2">
              AI Instruction *
            </label>
            <p className="text-xs text-zinc-500 mb-2">
              This exact text is sent to the AI. Be specific about what should trigger a flag.
            </p>
            <textarea
              value={promptFragment}
              onChange={(e) => setPromptFragment(e.target.value)}
              rows={4}
              className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-zinc-600"
              placeholder="Flag if the agent fails to..."
            />
          </div>
        </div>

        <div className="flex justify-end gap-3 mt-6 pt-4 border-t border-zinc-800">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            disabled={saving || !name || !promptFragment || (scope === "vertical" && !vertical)}
          >
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            ) : (
              <Plus className="h-4 w-4 mr-2" />
            )}
            Create Rule
          </Button>
        </div>
      </div>
    </div>
  );
}

// =============================================================================
// Main Page
// =============================================================================

export default function QARulesPage() {
  const [loading, setLoading] = useState(true);
  const [rules, setRules] = useState<{
    global: QARule[];
    vertical: Record<string, QARule[]>;
    custom: QARule[];
  }>({ global: [], vertical: {}, custom: [] });
  const [verticals, setVerticals] = useState<Vertical[]>([]);
  const [editingRule, setEditingRule] = useState<QARule | null>(null);
  const [addingRule, setAddingRule] = useState<{ open: boolean; vertical?: string | null }>({ open: false });
  const [expandedVerticals, setExpandedVerticals] = useState<Set<string>>(new Set());

  // Fetch data
  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [rulesRes, verticalsRes] = await Promise.all([
        fetch("/api/settings/rules"),
        fetch("/api/settings/verticals"),
      ]);

      if (rulesRes.ok) {
        const data = await rulesRes.json();
        setRules({
          global: data.global || [],
          vertical: data.vertical || {},
          custom: data.custom || [],
        });
      }

      if (verticalsRes.ok) {
        const data = await verticalsRes.json();
        setVerticals(data.verticals || []);
      }
    } catch (err) {
      console.error("Failed to fetch rules:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Handlers
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

  const handleAddRule = async (rule: {
    name: string;
    description: string;
    severity: "critical" | "warning";
    prompt_fragment: string;
    scope: "global" | "vertical" | "custom";
    vertical: string | null;
  }) => {
    await fetch("/api/settings/rules", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(rule),
    });
    await fetchData();
  };

  const handleDeleteRule = async (id: string) => {
    if (!confirm("Delete this rule?")) return;
    await fetch(`/api/settings/rules?id=${id}`, { method: "DELETE" });
    await fetchData();
  };

  const toggleVertical = (v: string) => {
    const next = new Set(expandedVerticals);
    if (next.has(v)) {
      next.delete(v);
    } else {
      next.add(v);
    }
    setExpandedVerticals(next);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-zinc-500" />
      </div>
    );
  }

  return (
    <div className="max-w-3xl">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-xl font-semibold text-zinc-100">QA Rules</h1>
        <p className="text-sm text-zinc-500 mt-1">
          Configure what the AI Judge looks for in each call.
        </p>
      </div>

      {/* Explainer Card */}
      <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4 mb-8">
        <div className="flex items-start gap-3">
          <Info className="h-5 w-5 text-zinc-500 mt-0.5" />
          <div className="text-sm text-zinc-400">
            <p className="mb-2">
              <strong className="text-zinc-200">How it works:</strong> Each enabled rule
              injects an instruction into the AI Judge&apos;s system prompt. When a call is
              analyzed, the AI checks for violations of each active rule.
            </p>
            <p>
              <strong className="text-zinc-200">Severity:</strong>{" "}
              <span className="text-red-400">Critical</span> violations auto-flag the call.{" "}
              <span className="text-amber-400">Warnings</span> lower the QA score but
              don&apos;t auto-flag.
            </p>
          </div>
        </div>
      </div>

      <div className="space-y-8">
        {/* ========== GLOBAL SAFETY LAYERS ========== */}
        <div>
          <div className="flex items-center gap-2 mb-4">
            <ShieldCheck className="h-4 w-4 text-emerald-400" />
            <h2 className="text-sm font-medium text-zinc-300 uppercase tracking-wider">
              Global Safety Layers
            </h2>
            <span className="text-xs text-zinc-600">(Apply to ALL calls)</span>
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
                      <Badge variant="default" className="text-xs">
                        System
                      </Badge>
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
                  <Toggle enabled={rule.enabled} onToggle={() => handleToggleRule(rule)} />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* ========== VERTICAL PRESETS ========== */}
        <div>
          <div className="flex items-center gap-2 mb-4">
            <Zap className="h-4 w-4 text-amber-400" />
            <h2 className="text-sm font-medium text-zinc-300 uppercase tracking-wider">
              Vertical Presets
            </h2>
            <span className="text-xs text-zinc-600">(Industry-specific rules)</span>
          </div>

          <div className="space-y-2">
            {verticals
              .filter((v) => v.id !== "general")
              .map((v) => {
                const verticalRules = rules.vertical[v.id] || [];
                const isExpanded = expandedVerticals.has(v.id);
                const enabledCount = verticalRules.filter((r) => r.enabled).length;

                return (
                  <div
                    key={v.id}
                    className="rounded-lg border border-zinc-800 overflow-hidden"
                  >
                    <button
                      onClick={() => toggleVertical(v.id)}
                      className="w-full flex items-center justify-between p-4 bg-zinc-900 hover:bg-zinc-800/50 transition-colors"
                    >
                      <div className="flex items-center gap-3">
                        <span className="text-lg">{v.icon}</span>
                        <span className="font-medium text-zinc-200">{v.name}</span>
                        <span className="text-xs text-zinc-500">
                          {verticalRules.length > 0
                            ? `${enabledCount}/${verticalRules.length} active`
                            : "No rules"}
                        </span>
                      </div>
                      {isExpanded ? (
                        <ChevronDown className="h-4 w-4 text-zinc-500" />
                      ) : (
                        <ChevronRight className="h-4 w-4 text-zinc-500" />
                      )}
                    </button>

                    {isExpanded && (
                      <div className="border-t border-zinc-800">
                        {verticalRules.length > 0 && (
                          <div className="divide-y divide-zinc-800">
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
                                    {!rule.is_system && (
                                      <Badge variant="default" className="text-xs bg-purple-500/10 text-purple-400 border-purple-500/30">
                                        Custom
                                      </Badge>
                                    )}
                                  </div>
                                  <p className="mt-1 text-sm text-zinc-500">
                                    {rule.description}
                                  </p>
                                </div>
                                <div className="flex items-center gap-3">
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => setEditingRule(rule)}
                                  >
                                    <Edit2 className="h-3 w-3" />
                                  </Button>
                                  {!rule.is_system && (
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      onClick={() => handleDeleteRule(rule.id)}
                                      className="text-red-400 hover:text-red-300"
                                    >
                                      <Trash2 className="h-3 w-3" />
                                    </Button>
                                  )}
                                  <Toggle
                                    enabled={rule.enabled}
                                    onToggle={() => handleToggleRule(rule)}
                                  />
                                </div>
                              </div>
                            ))}
                          </div>
                        )}

                        {verticalRules.length === 0 && (
                          <div className="p-6 text-center">
                            <p className="text-sm text-zinc-500 mb-3">
                              No rules configured for {v.name} yet
                            </p>
                          </div>
                        )}

                        {/* Add Rule Button for this vertical */}
                        <div className="p-3 bg-zinc-800/30 border-t border-zinc-800">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="w-full text-zinc-400 hover:text-zinc-200"
                            onClick={() => setAddingRule({ open: true, vertical: v.id })}
                          >
                            <Plus className="h-3 w-3 mr-2" />
                            Add Rule to {v.name}
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
          </div>
        </div>

        {/* ========== CUSTOM RULES ========== */}
        <div>
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <ShieldAlert className="h-4 w-4 text-blue-400" />
              <h2 className="text-sm font-medium text-zinc-300 uppercase tracking-wider">
                Custom Rules
              </h2>
            </div>
            <Button variant="outline" size="sm" onClick={() => setAddingRule({ open: true })}>
              <Plus className="h-3 w-3 mr-2" />
              Add Rule
            </Button>
          </div>

          {rules.custom.length === 0 ? (
            <div className="rounded-lg border border-dashed border-zinc-800 p-8 text-center">
              <Shield className="h-8 w-8 text-zinc-700 mx-auto mb-3" />
              <p className="text-sm text-zinc-500 mb-3">
                Add custom rules specific to your business requirements.
              </p>
              <Button variant="outline" size="sm" onClick={() => setAddingRule({ open: true })}>
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
                      {rule.description || rule.prompt_fragment?.slice(0, 80) + "..."}
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
                    <Toggle enabled={rule.enabled} onToggle={() => handleToggleRule(rule)} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Modals */}
      {editingRule && (
        <RuleEditModal
          rule={editingRule}
          onSave={handleSaveRule}
          onClose={() => setEditingRule(null)}
        />
      )}

      {addingRule.open && (
        <AddRuleModal
          verticals={verticals}
          initialVertical={addingRule.vertical}
          onSave={handleAddRule}
          onClose={() => setAddingRule({ open: false })}
        />
      )}
    </div>
  );
}
