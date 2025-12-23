import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "CallScript",
  description: "Automated Pay-Per-Call QA Platform",
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen bg-zinc-950 text-zinc-100">
        {children}
      </body>
    </html>
  );
}
