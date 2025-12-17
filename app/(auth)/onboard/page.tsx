"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Activity, Loader2, Building2, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createClient } from "@/lib/supabase/client";

export default function OnboardPage() {
  const [orgName, setOrgName] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checkingAuth, setCheckingAuth] = useState(true);
  const router = useRouter();

  // Check if user is authenticated
  useEffect(() => {
    const checkAuth = async () => {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();

      if (!user) {
        // Not logged in, redirect to signup
        router.push("/signup");
        return;
      }

      // Check if user already has an org
      if (user.app_metadata?.org_id) {
        // Already has org, redirect to dashboard
        router.push("/dashboard");
        return;
      }

      setCheckingAuth(false);
    };

    checkAuth();
  }, [router]);

  const handleCreateOrg = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!orgName.trim()) {
      setError("Organization name is required");
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/onboard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ org_name: orgName.trim() }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Failed to create organization");
        setIsLoading(false);
        return;
      }

      // Success - redirect to dashboard
      // Force a page reload to get fresh JWT with org claims
      window.location.href = "/dashboard";
    } catch (err) {
      setError("Something went wrong. Please try again.");
      setIsLoading(false);
    }
  };

  if (checkingAuth) {
    return (
      <div className="min-h-screen bg-[#09090b] flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-zinc-500" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#09090b] flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="mb-8 flex items-center justify-center gap-3">
          <Activity className="h-8 w-8 text-zinc-100" />
          <span className="text-2xl font-bold text-zinc-100">CallScript</span>
        </div>

        <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-6">
          <div className="mb-6 text-center">
            <div className="mb-4 flex justify-center">
              <div className="rounded-full bg-blue-500/10 p-3">
                <Building2 className="h-6 w-6 text-blue-400" />
              </div>
            </div>
            <h1 className="text-xl font-semibold text-zinc-100">
              Create Your Organization
            </h1>
            <p className="mt-2 text-sm text-zinc-500">
              Set up your workspace to start monitoring calls
            </p>
          </div>

          <form onSubmit={handleCreateOrg} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-zinc-500 uppercase tracking-wider mb-2">
                Organization Name
              </label>
              <Input
                type="text"
                value={orgName}
                onChange={(e) => setOrgName(e.target.value)}
                placeholder="Acme Insurance"
                className="bg-zinc-800 border-zinc-700 text-zinc-100 placeholder:text-zinc-500"
                autoFocus
              />
              <p className="mt-1 text-xs text-zinc-600">
                This will be your workspace name
              </p>
            </div>

            {error && (
              <div className="rounded-md bg-red-500/10 border border-red-500/20 px-4 py-3">
                <p className="text-sm text-red-400">{error}</p>
              </div>
            )}

            <Button type="submit" className="w-full" disabled={isLoading}>
              {isLoading ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <ArrowRight className="h-4 w-4 mr-2" />
              )}
              Create Organization
            </Button>
          </form>

          <div className="mt-6 pt-6 border-t border-zinc-800">
            <p className="text-xs text-zinc-600 text-center">
              You can connect your Ringba account after setup in Settings
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
