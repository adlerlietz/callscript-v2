"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  LayoutDashboard,
  Phone,
  AlertTriangle,
  Settings,
  Activity,
  LogOut,
  Loader2,
  Sparkles,
  Menu,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import { useState } from "react";

const navigation = [
  { name: "Command Center", href: "/dashboard", icon: LayoutDashboard },
  { name: "AI Explore", href: "/explore", icon: Sparkles },
  { name: "All Calls", href: "/calls", icon: Phone },
  { name: "Flagged", href: "/flags", icon: AlertTriangle },
  { name: "Settings", href: "/settings", icon: Settings },
];

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  const handleLogout = async () => {
    setIsLoggingOut(true);
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  };

  const handleNavClick = () => {
    // Close mobile menu when navigating
    setMobileOpen(false);
  };

  return (
    <>
      {/* Mobile hamburger button - fixed position, visible on mobile only */}
      <button
        onClick={() => setMobileOpen(true)}
        className="fixed top-4 left-4 z-50 p-2 rounded-md bg-zinc-900 border border-zinc-800 md:hidden"
        aria-label="Open menu"
      >
        <Menu className="h-5 w-5 text-zinc-100" />
      </button>

      {/* Mobile overlay backdrop */}
      {mobileOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-40 md:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Sidebar - slides in on mobile, static on desktop */}
      <div
        className={cn(
          "flex h-screen w-64 flex-col border-r border-zinc-800 bg-zinc-900",
          // Mobile: fixed position, slide from left
          "fixed inset-y-0 left-0 z-50 transform transition-transform duration-300 ease-in-out",
          // Desktop: relative position, always visible
          "md:relative md:translate-x-0",
          // Mobile: hidden by default, shown when open
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
        {/* Logo + Mobile close button */}
        <div className="flex h-16 items-center justify-between border-b border-zinc-800 px-6">
          <div className="flex items-center gap-2">
            <Activity className="h-6 w-6 text-zinc-100" />
            <span className="text-lg font-semibold text-zinc-100">CallScript</span>
          </div>
          {/* Close button - mobile only */}
          <button
            onClick={() => setMobileOpen(false)}
            className="p-1 rounded-md hover:bg-zinc-800 md:hidden"
            aria-label="Close menu"
          >
            <X className="h-5 w-5 text-zinc-400" />
          </button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 space-y-1 px-3 py-4">
          {navigation.map((item) => {
            const isActive = pathname === item.href || pathname.startsWith(item.href + "/");
            return (
              <Link
                key={item.name}
                href={item.href}
                onClick={handleNavClick}
                className={cn(
                  "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                  isActive
                    ? "bg-zinc-800 text-zinc-100"
                    : "text-zinc-400 hover:bg-zinc-800/50 hover:text-zinc-100"
                )}
              >
                <item.icon className="h-4 w-4" />
                {item.name}
              </Link>
            );
          })}
        </nav>

        {/* Footer */}
        <div className="border-t border-zinc-800 p-4 space-y-3">
          <div className="flex items-center gap-2 px-2">
            <div className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
            <span className="text-xs text-zinc-500">System Operational</span>
          </div>

          <button
            onClick={handleLogout}
            disabled={isLoggingOut}
            className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-zinc-400 hover:bg-zinc-800/50 hover:text-zinc-100 transition-colors disabled:opacity-50"
          >
            {isLoggingOut ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <LogOut className="h-4 w-4" />
            )}
            {isLoggingOut ? "Signing out..." : "Sign Out"}
          </button>
        </div>
      </div>
    </>
  );
}
