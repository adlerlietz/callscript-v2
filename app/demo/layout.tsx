import { DemoSidebar } from "@/components/demo-sidebar";
import { DemoBanner } from "@/components/demo-banner";

/**
 * Demo Layout
 * Wraps all demo pages with demo-specific sidebar and banner.
 * No authentication required.
 */
export default function DemoLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex h-screen bg-[#09090b]">
      <DemoSidebar />
      <main className="flex-1 overflow-auto">
        <DemoBanner />
        <div className="pt-14 md:pt-0">{children}</div>
      </main>
    </div>
  );
}
