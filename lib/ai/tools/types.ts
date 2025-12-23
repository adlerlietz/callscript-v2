/**
 * Shared types for AI tools
 */

export interface KPISummaryResponse {
  period: { start: string; end: string };
  metrics: {
    total_calls: number;
    revenue: number;
    payout: number;
    profit: number;
    margin_pct: number;
    flag_rate_pct: number;
    rpc: number;
  };
  definitions: Record<string, string>;
}

export interface TrendDataPoint {
  date_bucket: string;
  value: number;
}

export interface LeaderboardEntry {
  name: string;
  value: number;
  total_calls: number;
}

export interface BreakdownEntry {
  name: string;
  value: number;
  total_calls: number;
  contribution_pct: number;
}

export interface ForecastDataPoint {
  date: string;
  actual_value: number | null;
  forecast_value: number | null;
  is_forecast: boolean;
}

export interface NegotiationPartner {
  name: string;
  total_calls: number;
  revenue: number;
  payout: number;
  profit: number;
  margin_pct: number;
  action_tag: string;
}

export interface SimulationResult {
  target_name: string;
  target_type: string;
  total_calls: number;
  current_revenue: number;
  current_payout: number;
  current_profit: number;
  simulated_revenue: number;
  simulated_payout: number;
  simulated_profit: number;
  profit_change: number;
  profit_change_pct: number;
}

export interface CallSample {
  call_id: string;
  call_date: string;
  publisher_name: string;
  buyer_name: string;
  duration_seconds: number;
  revenue: number;
  payout: number;
  profit: number;
  masked_caller: string;
}
