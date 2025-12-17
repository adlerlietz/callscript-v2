"use client";

import { useState } from "react";
import Link from "next/link";
import { Activity, Loader2, Mail, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createClient } from "@/lib/supabase/client";

export default function SignupPage() {
  const [email, setEmail] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!email.trim()) {
      setError("Email is required");
      return;
    }

    setIsLoading(true);
    setError(null);

    const supabase = createClient();

    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback?next=/onboard`,
      },
    });

    if (error) {
      setError(error.message);
      setIsLoading(false);
      return;
    }

    setSuccess(true);
    setIsLoading(false);
  };

  return (
    <div className="min-h-screen bg-[#09090b] flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="mb-8 flex items-center justify-center gap-3">
          <Activity className="h-8 w-8 text-zinc-100" />
          <span className="text-2xl font-bold text-zinc-100">CallScript</span>
        </div>

        {!success ? (
          <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-6">
            <div className="mb-6 text-center">
              <h1 className="text-xl font-semibold text-zinc-100">
                Get Started
              </h1>
              <p className="mt-2 text-sm text-zinc-500">
                Create your account to start monitoring calls
              </p>
            </div>

            <form onSubmit={handleSignup} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-zinc-500 uppercase tracking-wider mb-2">
                  Email Address
                </label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
                  <Input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@company.com"
                    className="pl-10 bg-zinc-800 border-zinc-700 text-zinc-100 placeholder:text-zinc-500"
                  />
                </div>
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
                Get Started
              </Button>
            </form>

            <div className="mt-6 text-center">
              <p className="text-sm text-zinc-500">
                Already have an account?{" "}
                <Link href="/login" className="text-zinc-300 hover:text-zinc-100">
                  Sign in
                </Link>
              </p>
            </div>
          </div>
        ) : (
          <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-6 text-center">
            <div className="mb-4 flex justify-center">
              <div className="rounded-full bg-emerald-500/10 p-3">
                <Mail className="h-6 w-6 text-emerald-400" />
              </div>
            </div>
            <h2 className="text-lg font-semibold text-zinc-100 mb-2">
              Check your email
            </h2>
            <p className="text-sm text-zinc-500 mb-4">
              We sent a magic link to <span className="text-zinc-300">{email}</span>
            </p>
            <p className="text-xs text-zinc-600">
              Click the link in the email to continue setting up your account.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
