"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Building2, Link2, ShieldCheck, Tags } from "lucide-react";

const navItems = [
  { href: "/settings/general", label: "General", icon: Building2 },
  { href: "/settings/connections", label: "Connections", icon: Link2 },
  { href: "/settings/qa-rules", label: "QA Rules", icon: ShieldCheck },
  { href: "/settings/campaigns", label: "Campaigns", icon: Tags },
];

export default function SettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();

  return (
    <div className="flex min-h-[calc(100vh-4rem)]">
      {/* Sidebar */}
      <aside className="w-64 border-r border-zinc-800 bg-zinc-950 p-4">
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
                className={`flex items-center gap-3 px-3 py-2 text-sm font-medium transition-colors ${
                  isActive
                    ? "bg-zinc-800 text-white"
                    : "text-zinc-400 hover:bg-zinc-900 hover:text-white"
                }`}
              >
                <Icon className="h-4 w-4" />
                {item.label}
              </Link>
            );
          })}
        </nav>
      </aside>

      {/* Main Content */}
      <main className="flex-1 bg-zinc-950 p-8">{children}</main>
    </div>
  );
}
