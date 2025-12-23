"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Building2, Link2, ShieldCheck, Tags, Layers } from "lucide-react";
import { cn } from "@/lib/utils";

const navItems = [
  { href: "/settings/general", label: "General", icon: Building2 },
  { href: "/settings/connections", label: "Connections", icon: Link2 },
  { href: "/settings/qa-rules", label: "QA Rules", icon: ShieldCheck },
  { href: "/settings/campaigns", label: "Campaigns", icon: Tags },
  { href: "/settings/verticals", label: "Verticals", icon: Layers },
];

export default function SettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();

  return (
    <div className="flex flex-col md:flex-row min-h-[calc(100vh-4rem)]">
      {/* Mobile: Horizontal scrolling tabs */}
      <nav className="flex md:hidden overflow-x-auto border-b border-zinc-800 bg-zinc-950 px-4 py-2 gap-2 scrollbar-hide">
        {navItems.map((item) => {
          const isActive =
            pathname === item.href ||
            (pathname === "/settings" && item.href === "/settings/general");
          const Icon = item.icon;

          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-2 px-3 py-2 text-sm font-medium whitespace-nowrap rounded-md transition-colors",
                isActive
                  ? "bg-zinc-800 text-white"
                  : "text-zinc-400 hover:bg-zinc-900 hover:text-white"
              )}
            >
              <Icon className="h-4 w-4" />
              {item.label}
            </Link>
          );
        })}
      </nav>

      {/* Desktop: Vertical sidebar */}
      <aside className="hidden md:block w-64 border-r border-zinc-800 bg-zinc-950 p-4">
        <h2 className="mb-6 text-sm font-semibold uppercase tracking-wider text-zinc-500">
          Settings
        </h2>
        <nav className="space-y-1">
          {navItems.map((item) => {
            const isActive =
              pathname === item.href ||
              (pathname === "/settings" && item.href === "/settings/general");
            const Icon = item.icon;

            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex items-center gap-3 px-3 py-2 text-sm font-medium transition-colors rounded-md",
                  isActive
                    ? "bg-zinc-800 text-white"
                    : "text-zinc-400 hover:bg-zinc-900 hover:text-white"
                )}
              >
                <Icon className="h-4 w-4" />
                {item.label}
              </Link>
            );
          })}
        </nav>
      </aside>

      {/* Main Content */}
      <main className="flex-1 bg-zinc-950 p-4 sm:p-6 lg:p-8">{children}</main>
    </div>
  );
}
