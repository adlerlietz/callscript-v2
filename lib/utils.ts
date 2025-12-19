import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(amount);
}

export function formatNumber(num: number): string {
  return new Intl.NumberFormat("en-US").format(num);
}

export function formatDate(date: Date | string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(date));
}

export function truncateId(id: string, length = 8): string {
  return id.slice(0, length);
}

/**
 * Format publisher/source name for display.
 * Priority: publisher_name > buyer_name > cleaned publisher_id
 * Returns null for UUID-like strings (not human readable).
 */
export function formatSourceName(
  publisherId: string | null,
  buyerName: string | null,
  publisherName?: string | null
): string | null {
  // Try publisher_name first (most human-readable from Ringba)
  if (publisherName && publisherName.trim()) {
    return publisherName.trim();
  }

  // Try buyer_name second
  if (buyerName && buyerName.trim()) {
    return buyerName.trim();
  }

  // Try publisher_id, but skip if it looks like a UUID
  if (publisherId) {
    // Skip UUID-like strings (e.g., "f9d2913f-5e5b-4a1c-...")
    const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]/i;
    if (uuidPattern.test(publisherId)) {
      return null;
    }

    // Clean up non-UUID publisher IDs
    const name = publisherId
      .replace(/^(PUB_|pub_|PUBLISHER_|publisher_)/i, "")
      .replace(/[_-]/g, " ")
      .replace(/\d+/g, "")
      .trim();
    return name || null;
  }

  return null;
}
