"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Activity, Loader2, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createClient } from "@/lib/supabase/client";

export default function UpdatePasswordPage() {
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [isValidSession, setIsValidSession] = useState(false);
  const router = useRouter();

  // Verify user has valid session on mount
  useEffect(() => {
    const checkSession = async () => {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        router.push("/login?error=session_expired");
        return;
      }
      setIsValidSession(true);
    };
    checkSession();
  }, [router]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const supabase = createClient();

    // Verify session is still valid before updating password
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      setError("Session expired. Please use the password reset link again.");
      return;
    }

    if (password.length < 8) {
      setError("Password must be at least 8 characters");
      return;
    }

    if (password !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }

    setIsLoading(true);

    // Update password and set the password_set flag
    const { error } = await supabase.auth.updateUser({
      password,
      data: {
        password_set: true,
      },
    });

    if (error) {
      setError(error.message);
      setIsLoading(false);
      return;
    }

    setSuccess(true);
    setTimeout(() => {
      router.push("/dashboard");
    }, 2000);
  };

  // Show loading while checking session
  if (!isValidSession) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-zinc-950">
        <Loader2 className="h-8 w-8 animate-spin text-zinc-400" />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-950">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="mb-8 flex items-center justify-center gap-3">
          <Activity className="h-8 w-8 text-zinc-100" />
          <span className="text-2xl font-semibold text-zinc-100">CallScript</span>
        </div>

        {/* Update Password Card */}
        <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-8">
          <div className="mb-6 text-center">
            <Lock className="h-10 w-10 text-zinc-400 mx-auto mb-3" />
            <h1 className="text-lg font-semibold text-zinc-100">Set Your Password</h1>
            <p className="text-sm text-zinc-500 mt-1">
              Create a password to secure your account
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label
                htmlFor="password"
                className="block text-sm font-medium text-zinc-400 mb-2"
              >
                New Password
              </label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                required
                minLength={8}
                className="bg-zinc-800 border-zinc-700 text-zinc-100 placeholder:text-zinc-500"
              />
            </div>

            <div>
              <label
                htmlFor="confirmPassword"
                className="block text-sm font-medium text-zinc-400 mb-2"
              >
                Confirm Password
              </label>
              <Input
                id="confirmPassword"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="••••••••"
                required
                minLength={8}
                className="bg-zinc-800 border-zinc-700 text-zinc-100 placeholder:text-zinc-500"
              />
            </div>

            {error && (
              <div className="rounded-md bg-red-500/10 border border-red-500/20 px-4 py-3">
                <p className="text-sm text-red-400">{error}</p>
              </div>
            )}

            {success && (
              <div className="rounded-md bg-emerald-500/10 border border-emerald-500/20 px-4 py-3">
                <p className="text-sm text-emerald-400">
                  Password set successfully! Redirecting...
                </p>
              </div>
            )}

            <Button
              type="submit"
              className="w-full bg-zinc-100 text-zinc-900 hover:bg-zinc-200"
              disabled={isLoading || success}
            >
              {isLoading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Setting password...
                </>
              ) : (
                "Set Password"
              )}
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}
