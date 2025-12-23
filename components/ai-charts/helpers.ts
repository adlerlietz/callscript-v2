/**
 * Chart Helpers - Shared formatting utilities
 */

export function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

export function formatPercent(value: number): string {
  return `${value.toFixed(1)}%`;
}

export function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}

export function getFormatter(metric?: string): (value: number) => string {
  switch (metric) {
    case "revenue":
    case "profit":
    case "payout":
      return formatCurrency;
    case "flag_rate":
    case "margin_pct":
      return formatPercent;
    default:
      return formatNumber;
  }
}
