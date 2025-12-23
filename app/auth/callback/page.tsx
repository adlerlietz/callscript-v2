"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Loader2 } from "lucide-react";

/**
 * Client-side auth callback handler.
 * Handles hash fragment tokens from Supabase implicit flow (invites, magic links).
 * Ensures all users have a password set before accessing the app.
 */
export default function AuthCallbackPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const handleCallback = async () => {
      const supabase = createClient();

      // Helper to check if user needs to set password
      const checkPasswordAndRedirect = async (type?: string | null) => {
        const { data: { user } } = await supabase.auth.getUser();

        if (!user) {
          setError("Failed to get user information");
          return;
        }

        // Always redirect to password setup for recovery flow
        if (type === "recovery") {
          router.push("/auth/update-password");
          return;
        }

        // Check if password has been set (stored in user metadata)
        const hasPassword = user.user_metadata?.password_set === true;

        if (!hasPassword) {
          console.log("[Auth Callback] User needs to set password");
          router.push("/auth/update-password");
          return;
        }

        router.push("/dashboard");
      };

      // Check for hash fragment (implicit flow)
      const hash = window.location.hash;
      if (hash && hash.includes("access_token")) {
        console.log("[Auth Callback] Hash fragment detected, processing...");

        // Check if this is a recovery/password reset flow
        const hashParams = new URLSearchParams(hash.substring(1));
        const type = hashParams.get("type");

        // Supabase client automatically handles hash fragments
        const { data, error } = await supabase.auth.getSession();

        if (error) {
          console.error("[Auth Callback] Session error:", error.message);
          setError(error.message);
          return;
        }

        if (data.session) {
          console.log("[Auth Callback] Session established from hash, type:", type);
          await checkPasswordAndRedirect(type);
          return;
        }
      }

      // Check for code in query params (PKCE flow)
      const params = new URLSearchParams(window.location.search);
      const code = params.get("code");

      if (code) {
        console.log("[Auth Callback] Code detected, exchanging...");
        const { error } = await supabase.auth.exchangeCodeForSession(code);

        if (error) {
          console.error("[Auth Callback] Code exchange error:", error.message);
          // Check for PKCE error - provide helpful message
          if (error.message.includes("code verifier")) {
            setError("Please open this link in the same browser where you requested it. The security verification requires the original browser session.");
            return;
          }
          setError(error.message);
          return;
        }

        console.log("[Auth Callback] Code exchange successful");
        await checkPasswordAndRedirect();
        return;
      }

      // Check for token_hash (invite/magic link flow)
      const tokenHash = params.get("token_hash");
      const type = params.get("type");

      if (tokenHash && type) {
        console.log("[Auth Callback] Token hash detected, verifying...");
        const { error } = await supabase.auth.verifyOtp({
          token_hash: tokenHash,
          type: type as "invite" | "magiclink" | "recovery" | "email",
        });

        if (error) {
          console.error("[Auth Callback] Token verification error:", error.message);
          setError(error.message);
          return;
        }

        console.log("[Auth Callback] Token verified");
        await checkPasswordAndRedirect(type);
        return;
      }

      // No valid auth params found
      console.error("[Auth Callback] No valid auth parameters found");
      setError("Invalid authentication link");
    };

    handleCallback();
  }, [router]);

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-zinc-950">
        <div className="text-center p-8 rounded-lg border border-red-900 bg-red-950/20 max-w-md">
          <h1 className="text-xl font-semibold text-red-400 mb-2">Authentication Error</h1>
          <p className="text-zinc-400 mb-4">{error}</p>
          <a
            href="/login"
            className="text-sm text-zinc-300 hover:text-white underline"
          >
            Return to Login
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-zinc-950">
      <div className="text-center">
        <Loader2 className="h-8 w-8 animate-spin text-zinc-400 mx-auto mb-4" />
        <p className="text-zinc-400">Completing sign in...</p>
      </div>
    </div>
  );
}
