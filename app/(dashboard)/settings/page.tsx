"use client";

import { useState } from "react";
import { Eye, EyeOff, RefreshCw, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

// Mock data
const MOCK_QA_RULES = [
  { id: "1", name: "Detect PII Collection", enabled: true, description: "Flag calls where SSN or credit card is requested early" },
  { id: "2", name: "TCPA Compliance", enabled: true, description: "Verify consent language was provided" },
  { id: "3", name: "DNC Check", enabled: false, description: "Flag if caller is on Do Not Call registry" },
  { id: "4", name: "Health Claims", enabled: true, description: "Detect unverified health benefit claims" },
];

const MOCK_CAMPAIGNS = [
  { id: "camp_001", name: "ACA Health", vertical: "Healthcare" },
  { id: "camp_002", name: "Medicare Plus", vertical: "Healthcare" },
  { id: "camp_003", name: "Solar Direct", vertical: "Solar" },
  { id: "camp_004", name: "Auto Insurance", vertical: "Insurance" },
];

type Tab = "rules" | "campaigns" | "integrations" | "api";

function Toggle({ enabled, onToggle }: { enabled: boolean; onToggle: () => void }) {
  return (
    <button
      onClick={onToggle}
      className={cn(
        "relative inline-flex h-6 w-11 items-center rounded-full transition-colors",
        enabled ? "bg-emerald-500" : "bg-zinc-700"
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

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState<Tab>("rules");
  const [rules, setRules] = useState(MOCK_QA_RULES);
  const [slackWebhook, setSlackWebhook] = useState("");
  const [showApiKey, setShowApiKey] = useState(false);

  const toggleRule = (id: string) => {
    setRules(rules.map((r) => (r.id === id ? { ...r, enabled: !r.enabled } : r)));
  };

  const tabs: { id: Tab; label: string }[] = [
    { id: "rules", label: "QA Rules" },
    { id: "campaigns", label: "Campaigns" },
    { id: "integrations", label: "Integrations" },
    { id: "api", label: "API Keys" },
  ];

  return (
    <div className="p-8">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-zinc-100">Settings</h1>
        <p className="text-sm text-zinc-500">Configure your QA platform</p>
      </div>

      {/* Tabs */}
      <div className="mb-8 border-b border-zinc-800">
        <nav className="flex gap-8">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                "pb-4 text-sm font-medium transition-colors border-b-2 -mb-px",
                activeTab === tab.id
                  ? "border-zinc-100 text-zinc-100"
                  : "border-transparent text-zinc-500 hover:text-zinc-300"
              )}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </div>

      {/* Tab Content */}
      {activeTab === "rules" && (
        <div className="space-y-4">
          {rules.map((rule) => (
            <div
              key={rule.id}
              className="flex items-center justify-between rounded-lg border border-zinc-800 bg-zinc-900 p-4"
            >
              <div className="flex-1">
                <div className="flex items-center gap-3">
                  <h3 className="text-sm font-medium text-zinc-100">{rule.name}</h3>
                  <Badge variant={rule.enabled ? "success" : "default"}>
                    {rule.enabled ? "Active" : "Disabled"}
                  </Badge>
                </div>
                <p className="mt-1 text-sm text-zinc-500">{rule.description}</p>
              </div>
              <div className="flex items-center gap-4">
                <Button variant="ghost" size="sm">
                  Edit Prompt
                </Button>
                <Toggle enabled={rule.enabled} onToggle={() => toggleRule(rule.id)} />
              </div>
            </div>
          ))}
        </div>
      )}

      {activeTab === "campaigns" && (
        <div className="rounded-lg border border-zinc-800 overflow-hidden">
          <table className="w-full">
            <thead className="bg-zinc-900">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-zinc-400 uppercase">
                  Campaign ID
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-zinc-400 uppercase">
                  Name
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-zinc-400 uppercase">
                  Vertical
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800">
              {MOCK_CAMPAIGNS.map((campaign) => (
                <tr key={campaign.id} className="hover:bg-zinc-900/50">
                  <td className="px-4 py-4 font-mono text-sm text-zinc-400">
                    {campaign.id}
                  </td>
                  <td className="px-4 py-4 text-sm text-zinc-300">
                    {campaign.name}
                  </td>
                  <td className="px-4 py-4">
                    <select className="bg-zinc-800 border border-zinc-700 rounded-md px-3 py-1.5 text-sm text-zinc-300">
                      <option value="Healthcare">Healthcare</option>
                      <option value="Solar">Solar</option>
                      <option value="Insurance">Insurance</option>
                      <option value="General">General</option>
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {activeTab === "integrations" && (
        <div className="max-w-xl space-y-6">
          <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-6">
            <h3 className="text-sm font-medium text-zinc-100 mb-4">Slack Notifications</h3>
            <p className="text-sm text-zinc-500 mb-4">
              Receive alerts when queue backs up or critical flags are detected.
            </p>
            <div className="flex gap-3">
              <Input
                placeholder="https://hooks.slack.com/services/..."
                value={slackWebhook}
                onChange={(e) => setSlackWebhook(e.target.value)}
                className="flex-1"
              />
              <Button variant="outline">
                <Save className="mr-2 h-4 w-4" />
                Save
              </Button>
            </div>
          </div>
        </div>
      )}

      {activeTab === "api" && (
        <div className="max-w-xl space-y-6">
          <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-6">
            <h3 className="text-sm font-medium text-zinc-100 mb-4">API Key</h3>
            <p className="text-sm text-zinc-500 mb-4">
              Use this key to access the CallScript API programmatically.
            </p>
            <div className="flex items-center gap-3 mb-4">
              <div className="flex-1 font-mono text-sm bg-zinc-800 rounded-md px-4 py-3 text-zinc-300">
                {showApiKey ? "cs_live_example_key_replace_me_1234" : "cs_live_••••••••••••••••••••••••••••"}
              </div>
              <Button variant="ghost" size="icon" onClick={() => setShowApiKey(!showApiKey)}>
                {showApiKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </Button>
            </div>
            <Button variant="destructive" size="sm">
              <RefreshCw className="mr-2 h-4 w-4" />
              Roll Key
            </Button>
            <p className="mt-3 text-xs text-zinc-500">
              Rolling the key will invalidate the current key immediately.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
