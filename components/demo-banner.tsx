"use client";

import Link from "next/link";

/**
 * Demo Banner Component
 * Displays a persistent banner at the top of demo pages
 * indicating users are viewing sample data.
 */
export function DemoBanner() {
  return (
    <div className="bg-amber-500/10 border-b border-amber-500/30 px-4 py-2.5">
      <p className="text-center text-sm text-amber-400">
        <span className="font-medium">Demo Mode</span>
        <span className="mx-2 text-amber-500/50">|</span>
        You&apos;re viewing sample data.{" "}
        <Link
          href="/signup"
          className="underline underline-offset-2 hover:text-amber-300 font-medium"
        >
          Sign up
        </Link>{" "}
        to connect your own calls.
      </p>
    </div>
  );
}
