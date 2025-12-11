import Link from "next/link";

export default function HomePage() {
  return (
    <div className="p-8">
      <h1 className="text-3xl font-bold mb-4">Welcome to CallScript v2</h1>
      <p className="text-gray-600 mb-8">
        Automated Pay-Per-Call QA Platform
      </p>

      <nav className="space-y-2">
        <Link
          href="/dashboard"
          className="block text-blue-600 hover:underline"
        >
          → Dashboard
        </Link>
        <Link
          href="/calls"
          className="block text-blue-600 hover:underline"
        >
          → Calls
        </Link>
        <Link
          href="/flags"
          className="block text-blue-600 hover:underline"
        >
          → Flags
        </Link>
      </nav>
    </div>
  );
}

