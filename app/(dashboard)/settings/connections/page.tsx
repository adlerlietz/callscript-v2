"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Link2,
  Loader2,
  Save,
  Send,
  Eye,
  EyeOff,
  Copy,
  Check,
  RefreshCw,
  Zap,
  Key,
  CheckCircle2,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

// Slack icon component (lucide doesn't have a good one)
function SlackIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="currentColor"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zM6.313 15.165a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313zM8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834zM8.834 6.313a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312zM18.956 8.834a2.528 2.528 0 0 1 2.522-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.522V8.834zM17.688 8.834a2.528 2.528 0 0 1-2.523 2.521 2.527 2.527 0 0 1-2.52-2.521V2.522A2.527 2.527 0 0 1 15.165 0a2.528 2.528 0 0 1 2.523 2.522v6.312zM15.165 18.956a2.528 2.528 0 0 1 2.523 2.522A2.528 2.528 0 0 1 15.165 24a2.527 2.527 0 0 1-2.52-2.522v-2.522h2.52zM15.165 17.688a2.527 2.527 0 0 1-2.52-2.523 2.526 2.526 0 0 1 2.52-2.52h6.313A2.527 2.527 0 0 1 24 15.165a2.528 2.528 0 0 1-2.522 2.523h-6.313z" />
    </svg>
  );
}

// Toggle component
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

export default function ConnectionsPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Ringba state
  const [ringbaAccountId, setRingbaAccountId] = useState("");
  const [ringbaToken, setRingbaToken] = useState("");
  const [ringbaStatus, setRingbaStatus] = useState<"connected" | "error" | "not_configured">("not_configured");
  const [lastSync, setLastSync] = useState<string | null>(null);
  const [testingRingba, setTestingRingba] = useState(false);
  const [ringbaTestResult, setRingbaTestResult] = useState<{ success: boolean; message: string } | null>(null);

  // Slack state
  const [slackUrl, setSlackUrl] = useState("");
  const [slackCriticalFlags, setSlackCriticalFlags] = useState(true);
  const [slackDailySummary, setSlackDailySummary] = useState(false);
  const [testingSlack, setTestingSlack] = useState(false);
  const [slackTestResult, setSlackTestResult] = useState<{ success: boolean; message: string } | null>(null);

  // API Key state
  const [apiKey, setApiKey] = useState("");
  const [apiKeyId, setApiKeyId] = useState<string | null>(null);
  const [showApiKey, setShowApiKey] = useState(false);
  const [copiedKey, setCopiedKey] = useState(false);
  const [rollingKey, setRollingKey] = useState(false);
  const [newKeyGenerated, setNewKeyGenerated] = useState(false);

  // Fetch settings
  const fetchSettings = useCallback(async () => {
    setLoading(true);
    try {
      // Fetch org settings
      const res = await fetch("/api/settings/org");
      console.log("[v2.1] Fetch settings response status:", res.status);
      if (res.ok) {
        const data = await res.json();
        console.log("[v2.1] Fetched settings data:", data);
        const settings: Record<string, unknown> = {};
        for (const s of data.settings || []) {
          settings[s.key] = s.value;
        }
        console.log("Parsed settings:", settings);

        setRingbaAccountId(String(settings.ringba_account_id || ""));
        setRingbaToken(String(settings.ringba_api_token || ""));
        setSlackUrl(String(settings.slack_webhook_url || ""));

        // Check notification preferences
        const notifs = settings.notifications_enabled as Record<string, boolean> | undefined;
        if (notifs) {
          setSlackCriticalFlags(notifs.critical_flags ?? true);
          setSlackDailySummary(notifs.daily_digest ?? false);
        }

        // Determine Ringba status
        const accountId = String(settings.ringba_account_id || "");
        const token = String(settings.ringba_api_token || "");
        // Token is masked after save (starts with ••••), which means it's configured
        if (accountId && accountId !== '""' && token && token !== '""') {
          setRingbaStatus("connected");
        } else {
          setRingbaStatus("not_configured");
        }
      }

      // Fetch last sync time
      const syncRes = await fetch("/api/settings/ringba-test");
      if (syncRes.ok) {
        const syncData = await syncRes.json();
        if (syncData.lastSync) {
          const syncDate = new Date(syncData.lastSync);
          const now = new Date();
          const diffMs = now.getTime() - syncDate.getTime();
          const diffMins = Math.floor(diffMs / 60000);
          if (diffMins < 1) {
            setLastSync("Just now");
          } else if (diffMins < 60) {
            setLastSync(`${diffMins} min${diffMins > 1 ? "s" : ""} ago`);
          } else {
            const diffHours = Math.floor(diffMins / 60);
            if (diffHours < 24) {
              setLastSync(`${diffHours} hour${diffHours > 1 ? "s" : ""} ago`);
            } else {
              setLastSync(syncDate.toLocaleDateString());
            }
          }
        }
      }

      // Fetch API keys
      const keysRes = await fetch("/api/settings/api-keys");
      if (keysRes.ok) {
        const keysData = await keysRes.json();
        if (keysData.keys && keysData.keys.length > 0) {
          const activeKey = keysData.keys.find((k: { is_active: boolean }) => k.is_active);
          if (activeKey) {
            setApiKeyId(activeKey.id);
            setApiKey(`${activeKey.key_prefix}••••••••••••••••${activeKey.key_hint}`);
          } else {
            setApiKeyId(null);
            setApiKey("No active API key");
          }
        } else {
          setApiKeyId(null);
          setApiKey("No API key generated yet");
        }
      }
    } catch (err) {
      console.error("Failed to fetch settings:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  // Save all settings
  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetch("/api/settings/org", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          updates: {
            ringba_account_id: ringbaAccountId,
            ringba_api_token: ringbaToken,
            slack_webhook_url: slackUrl,
            notifications_enabled: {
              critical_flags: slackCriticalFlags,
              queue_alerts: true,
              daily_digest: slackDailySummary,
            },
          },
        }),
      });

      const data = await res.json();
      console.log("Save response:", data);

      if (!res.ok) {
        alert(`Failed to save: ${data.error || "Unknown error"}`);
        return;
      }

      // If Ringba credentials were saved successfully, update status immediately
      if (ringbaAccountId && ringbaToken && !ringbaToken.startsWith("••••")) {
        setRingbaStatus("connected");
        setRingbaTestResult({ success: true, message: "Settings saved successfully" });
      }

      await fetchSettings();
    } catch (err) {
      console.error("Save error:", err);
      alert(`Save failed: ${err instanceof Error ? err.message : "Unknown error"}`);
    } finally {
      setSaving(false);
    }
  };

  // Test Ringba connection
  const handleTestRingba = async () => {
    setTestingRingba(true);
    setRingbaTestResult(null);
    try {
      const res = await fetch("/api/settings/ringba-test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accountId: ringbaAccountId,
          token: ringbaToken,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setRingbaStatus("connected");
        setLastSync("Just now");
        setRingbaTestResult({ success: true, message: data.message });
      } else {
        setRingbaStatus("error");
        const errorMsg = data.details
          ? `${data.error} | ${data.details}`
          : data.error;
        setRingbaTestResult({ success: false, message: errorMsg });
      }
    } catch (err) {
      setRingbaStatus("error");
      console.error("Ringba test failed:", err);
      setRingbaTestResult({ success: false, message: `Network error: ${err instanceof Error ? err.message : "Unknown"}` });
    } finally {
      setTestingRingba(false);
    }
  };

  // Test Slack webhook
  const handleTestSlack = async () => {
    if (!slackUrl || slackUrl.startsWith("••••")) {
      setSlackTestResult({ success: false, message: "Please enter a valid webhook URL first" });
      return;
    }

    setTestingSlack(true);
    setSlackTestResult(null);

    try {
      const res = await fetch("/api/settings/org", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "slack", url: slackUrl }),
      });
      const data = await res.json();
      setSlackTestResult({
        success: data.success,
        message: data.success ? "Test message sent!" : data.error,
      });
    } catch {
      setSlackTestResult({ success: false, message: "Failed to test webhook" });
    } finally {
      setTestingSlack(false);
    }
  };

  // Copy API key
  const handleCopyApiKey = () => {
    navigator.clipboard.writeText(apiKey);
    setCopiedKey(true);
    setTimeout(() => setCopiedKey(false), 2000);
  };

  // Roll (regenerate) API key
  const handleRollKey = async () => {
    if (!confirm("This will invalidate your current API key immediately. Continue?")) {
      return;
    }

    setRollingKey(true);
    setNewKeyGenerated(false);

    try {
      if (apiKeyId) {
        // Roll existing key
        const res = await fetch("/api/settings/api-keys", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: apiKeyId }),
        });
        const data = await res.json();
        if (data.key?.fullKey) {
          setApiKey(data.key.fullKey);
          setShowApiKey(true);
          setNewKeyGenerated(true);
        }
      } else {
        // Create new key
        const res = await fetch("/api/settings/api-keys", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: "Production API Key" }),
        });
        const data = await res.json();
        if (data.key?.fullKey) {
          setApiKey(data.key.fullKey);
          setApiKeyId(data.key.id);
          setShowApiKey(true);
          setNewKeyGenerated(true);
        }
      }
    } catch (err) {
      console.error("Failed to roll API key:", err);
      alert("Failed to generate new API key");
    } finally {
      setRollingKey(false);
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
        <h1 className="text-xl font-semibold text-zinc-100">Connections</h1>
        <p className="text-sm text-zinc-500 mt-1">
          Manage data sources, alerts, and API access.
        </p>
      </div>

      <div className="space-y-6">
        {/* ========== SECTION A: RINGBA (Data Source) ========== */}
        <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-6">
          <div className="flex items-start gap-4">
            <div className="p-2 rounded-lg bg-zinc-800">
              <Link2 className="h-5 w-5 text-zinc-400" />
            </div>
            <div className="flex-1">
              <div className="flex items-center justify-between mb-1">
                <h3 className="text-sm font-medium text-zinc-100">
                  Ringba Integration
                </h3>
                <StatusBadge status={ringbaStatus} lastSync={lastSync} />
              </div>
              <p className="text-sm text-zinc-500 mb-6">
                Connect to Ringba to automatically sync call metadata and recordings.
              </p>

              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-medium text-zinc-500 uppercase tracking-wider mb-2">
                    Account ID
                  </label>
                  <Input
                    value={ringbaAccountId}
                    onChange={(e) => setRingbaAccountId(e.target.value)}
                    placeholder="Your Ringba Account ID"
                    className="bg-zinc-800 border-zinc-700"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-zinc-500 uppercase tracking-wider mb-2">
                    Auth Token
                  </label>
                  <Input
                    type="password"
                    value={ringbaToken}
                    onChange={(e) => setRingbaToken(e.target.value)}
                    placeholder="Your Ringba API Token"
                    className="bg-zinc-800 border-zinc-700"
                  />
                </div>

                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleTestRingba}
                  disabled={testingRingba || !ringbaAccountId || !ringbaToken}
                  className="text-zinc-400"
                >
                  {testingRingba ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  ) : (
                    <Zap className="h-4 w-4 mr-2" />
                  )}
                  Test Connection
                </Button>

                {ringbaTestResult && (
                  <div
                    className={cn(
                      "mt-3 p-3 rounded-md text-sm break-all",
                      ringbaTestResult.success
                        ? "bg-emerald-950/30 border border-emerald-700 text-emerald-300"
                        : "bg-red-950/30 border border-red-700 text-red-300"
                    )}
                  >
                    {ringbaTestResult.success ? "✓ " : "✗ "}
                    {ringbaTestResult.message}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* ========== SECTION B: SLACK (Alerts) ========== */}
        <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-6">
          <div className="flex items-start gap-4">
            <div className="p-2 rounded-lg bg-zinc-800">
              <SlackIcon className="h-5 w-5 text-zinc-400" />
            </div>
            <div className="flex-1">
              <h3 className="text-sm font-medium text-zinc-100 mb-1">
                Slack Alerts
              </h3>
              <p className="text-sm text-zinc-500 mb-6">
                Receive real-time alerts when critical issues are detected.
              </p>

              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-medium text-zinc-500 uppercase tracking-wider mb-2">
                    Webhook URL
                  </label>
                  <div className="flex gap-2">
                    <Input
                      type="url"
                      value={slackUrl}
                      onChange={(e) => setSlackUrl(e.target.value)}
                      placeholder="https://hooks.slack.com/services/..."
                      className="flex-1 bg-zinc-800 border-zinc-700"
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={handleTestSlack}
                      disabled={testingSlack || !slackUrl || slackUrl.startsWith("••••")}
                      className="text-zinc-400"
                    >
                      {testingSlack ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Send className="h-4 w-4" />
                      )}
                    </Button>
                  </div>
                  {slackTestResult && (
                    <p
                      className={cn(
                        "mt-2 text-sm",
                        slackTestResult.success ? "text-emerald-400" : "text-red-400"
                      )}
                    >
                      {slackTestResult.success ? "✓ " : "✗ "}
                      {slackTestResult.message}
                    </p>
                  )}
                </div>

                <div className="border-t border-zinc-800 pt-4">
                  <label className="block text-xs font-medium text-zinc-500 uppercase tracking-wider mb-3">
                    Triggers
                  </label>
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-zinc-300">Critical Flags</span>
                      <Toggle
                        enabled={slackCriticalFlags}
                        onToggle={() => setSlackCriticalFlags(!slackCriticalFlags)}
                      />
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-zinc-300">Daily Summary</span>
                      <Toggle
                        enabled={slackDailySummary}
                        onToggle={() => setSlackDailySummary(!slackDailySummary)}
                      />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* ========== SECTION C: API KEYS (Developer Access) ========== */}
        <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-6">
          <div className="flex items-start gap-4">
            <div className="p-2 rounded-lg bg-zinc-800">
              <Key className="h-5 w-5 text-zinc-400" />
            </div>
            <div className="flex-1">
              <h3 className="text-sm font-medium text-zinc-100 mb-1">
                CallScript API
              </h3>
              <p className="text-sm text-zinc-500 mb-6">
                Access your call data programmatically via the CallScript API.
              </p>

              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-medium text-zinc-500 uppercase tracking-wider mb-2">
                    API Key
                  </label>
                  <div className="flex items-center gap-2">
                    <div className={cn(
                      "flex-1 font-mono text-sm border rounded-md px-4 py-2.5 flex items-center justify-between",
                      newKeyGenerated
                        ? "bg-emerald-950/30 border-emerald-700 text-emerald-300"
                        : "bg-zinc-800 border-zinc-700 text-zinc-300"
                    )}>
                      <span className="break-all">
                        {showApiKey || newKeyGenerated ? apiKey : (apiKey.includes("••••") ? apiKey : "cs_live_••••••••••••••••••••••••")}
                      </span>
                      <div className="flex items-center gap-2 ml-2 flex-shrink-0">
                        <button
                          onClick={() => setShowApiKey(!showApiKey)}
                          className="text-zinc-500 hover:text-zinc-300"
                        >
                          {showApiKey || newKeyGenerated ? (
                            <EyeOff className="h-4 w-4" />
                          ) : (
                            <Eye className="h-4 w-4" />
                          )}
                        </button>
                        <button
                          onClick={handleCopyApiKey}
                          className="text-zinc-500 hover:text-zinc-300"
                        >
                          {copiedKey ? (
                            <Check className="h-4 w-4 text-emerald-400" />
                          ) : (
                            <Copy className="h-4 w-4" />
                          )}
                        </button>
                      </div>
                    </div>
                  </div>
                  {newKeyGenerated && (
                    <p className="mt-2 text-sm text-emerald-400">
                      Save this key now - it won&apos;t be shown again!
                    </p>
                  )}
                </div>

                <div className="flex items-center gap-3">
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={handleRollKey}
                    disabled={rollingKey}
                  >
                    {rollingKey ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <RefreshCw className="h-4 w-4 mr-2" />
                    )}
                    {apiKeyId ? "Roll Key" : "Generate Key"}
                  </Button>
                  <span className="text-xs text-zinc-500">
                    {apiKeyId
                      ? "This will invalidate your current key immediately."
                      : "Generate your first API key."}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Save Button */}
        <div className="flex justify-end pt-4">
          <Button onClick={handleSave} disabled={saving}>
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            ) : (
              <Save className="h-4 w-4 mr-2" />
            )}
            Save All Changes
          </Button>
        </div>
      </div>
    </div>
  );
}

// Status badge component
function StatusBadge({
  status,
  lastSync,
}: {
  status: "connected" | "error" | "not_configured";
  lastSync: string | null;
}) {
  if (status === "connected") {
    return (
      <div className="flex items-center gap-2 text-emerald-400">
        <CheckCircle2 className="h-4 w-4" />
        <span className="text-xs">Connected{lastSync ? ` (Last sync: ${lastSync})` : ""}</span>
      </div>
    );
  }

  if (status === "error") {
    return (
      <div className="flex items-center gap-2 text-red-400">
        <XCircle className="h-4 w-4" />
        <span className="text-xs">Connection Error</span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 text-zinc-500">
      <span className="h-2 w-2 rounded-full bg-zinc-600" />
      <span className="text-xs">Not Configured</span>
    </div>
  );
}
