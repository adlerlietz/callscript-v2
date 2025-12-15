"use client";

import { Activity, LogOut, Shield } from "lucide-react";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";

export default function NoAccessPage() {
  const router = useRouter();

  const handleSignOut = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-950">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="mb-8 flex items-center justify-center gap-3">
          <Activity className="h-8 w-8 text-zinc-100" />
          <span className="text-2xl font-semibold text-zinc-100">CallScript</span>
        </div>

        {/* Card */}
        <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-8 text-center">
          <div className="mb-6 flex justify-center">
            <div className="rounded-full bg-amber-500/10 p-4">
              <Shield className="h-10 w-10 text-amber-400" />
            </div>
          </div>

          <h1 className="mb-2 text-xl font-semibold text-zinc-100">
            No Organization Access
          </h1>

          <p className="mb-6 text-sm text-zinc-400">
            Your account is not associated with any organization.
            You need to be invited by an organization admin to access CallScript.
          </p>

          <div className="rounded-md bg-zinc-800/50 border border-zinc-700 px-4 py-3 mb-6">
            <p className="text-xs text-zinc-400">
              If you believe you should have access, please contact your organization administrator
              to send you an invitation link.
            </p>
          </div>

          <Button
            variant="outline"
            className="w-full border-zinc-700 bg-zinc-800 text-zinc-300 hover:bg-zinc-700 hover:text-zinc-100"
            onClick={handleSignOut}
          >
            <LogOut className="mr-2 h-4 w-4" />
            Sign Out
          </Button>
        </div>

        {/* Footer */}
        <p className="mt-8 text-center text-xs text-zinc-600">
          CallScript is invite-only. Organizations control access to their data.
        </p>
      </div>
    </div>
  );
}
