"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Phone,
  AlertTriangle,
  Activity,
  Sparkles,
  Menu,
  X,
  ArrowRight,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useState } from "react";

// Demo navigation - no settings, prefixed with /demo
const navigation = [
  { name: "Command Center", href: "/demo/dashboard", icon: LayoutDashboard },
  { name: "AI Explore", href: "/demo/explore", icon: Sparkles },
  { name: "All Calls", href: "/demo/calls", icon: Phone },
  { name: "Flagged", href: "/demo/flags", icon: AlertTriangle },
];

/**
 * Demo Sidebar Component
 * Similar to main sidebar but:
 * - All links prefixed with /demo
 * - No logout button
 * - "Get Started" CTA instead
 * - No settings page
 */
export function DemoSidebar() {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  const handleNavClick = () => {
    setMobileOpen(false);
  };

  return (
    <>
      {/* Mobile hamburger button */}
      <button
        onClick={() => setMobileOpen(true)}
        className="fixed top-14 left-4 z-50 p-2 rounded-md bg-zinc-900 border border-zinc-800 md:hidden"
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

      {/* Sidebar */}
      <div
        className={cn(
          "flex h-screen w-64 flex-col border-r border-zinc-800 bg-zinc-900",
          "fixed inset-y-0 left-0 z-50 transform transition-transform duration-300 ease-in-out",
          "md:relative md:translate-x-0",
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
        {/* Logo + Demo badge */}
        <div className="flex h-16 items-center justify-between border-b border-zinc-800 px-6">
          <div className="flex items-center gap-2">
            <Activity className="h-6 w-6 text-zinc-100" />
            <span className="text-lg font-semibold text-zinc-100">
              CallScript
            </span>
            <span className="ml-1 px-1.5 py-0.5 text-[10px] font-medium bg-amber-500/20 text-amber-400 rounded">
              DEMO
            </span>
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
            const isActive =
              pathname === item.href || pathname.startsWith(item.href + "/");
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

        {/* Footer - CTA instead of logout */}
        <div className="border-t border-zinc-800 p-4 space-y-3">
          <div className="flex items-center gap-2 px-2">
            <div className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
            <span className="text-xs text-zinc-500">Demo Mode Active</span>
          </div>

          <Link
            href="/signup"
            className="flex w-full items-center justify-center gap-2 rounded-md px-3 py-2.5 text-sm font-medium bg-zinc-100 text-zinc-900 hover:bg-white transition-colors"
          >
            Get Started
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </div>
    </>
  );
}
