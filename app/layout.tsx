import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "CallScript v2",
  description: "Automated Pay-Per-Call QA Platform",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-gray-50 text-gray-900">{children}</body>
    </html>
  );
}

