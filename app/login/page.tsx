"use client";

import { useState } from "react";
import { Activity, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);

    // Simulate login - will be replaced with Supabase Auth
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // For now, just show error
    setError("Authentication not configured yet");
    setIsLoading(false);
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-950">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="mb-8 flex items-center justify-center gap-3">
          <Activity className="h-8 w-8 text-zinc-100" />
          <span className="text-2xl font-semibold text-zinc-100">CallScript</span>
        </div>

        {/* Login Card */}
        <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-8">
          <form onSubmit={handleSubmit} className="space-y-6">
            <div>
              <label
                htmlFor="email"
                className="block text-sm font-medium text-zinc-400 mb-2"
              >
                Email
              </label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="admin@company.com"
                required
              />
            </div>

            <div>
              <label
                htmlFor="password"
                className="block text-sm font-medium text-zinc-400 mb-2"
              >
                Password
              </label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                required
              />
            </div>

            {error && (
              <div className="rounded-md bg-red-500/10 border border-red-500/20 px-4 py-3">
                <p className="text-sm text-red-400">{error}</p>
              </div>
            )}

            <Button
              type="submit"
              className="w-full bg-zinc-100 text-zinc-900 hover:bg-zinc-200"
              disabled={isLoading}
            >
              {isLoading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Signing in...
                </>
              ) : (
                "Sign In"
              )}
            </Button>
          </form>

          <div className="mt-6 text-center">
            <a
              href="#"
              className="text-sm text-zinc-500 hover:text-zinc-400 transition-colors"
            >
              Forgot password?
            </a>
          </div>
        </div>

        {/* Footer */}
        <p className="mt-8 text-center text-xs text-zinc-600">
          Invite-only access. Contact admin for credentials.
        </p>
      </div>
    </div>
  );
}
