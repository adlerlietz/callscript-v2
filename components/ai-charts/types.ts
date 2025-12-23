/**
 * Chart Types - Shared type definitions
 */

export interface ChartData {
  success?: boolean;
  error?: boolean;
  message?: string;
  chart_type?: "line" | "bar" | "area";
  metric?: string;
  dimension?: string;
  data?: Array<{
    date_bucket?: string;
    name?: string;
    value: number;
    total_calls?: number;
  }>;
  period?: { start: string; end: string };
  metrics?: {
    total_calls: number;
    revenue: number;
    payout: number;
    profit: number;
    margin_pct: number;
    flag_rate_pct: number;
    rpc: number;
  };
  definitions?: Record<string, string>;
  _meta?: { tool: string; query: Record<string, unknown> };
}

export interface ForecastDataPoint {
  date: string;
  actual_value: number | null;
  forecast_value: number | null;
  is_forecast: boolean;
}

export interface ForecastChartData {
  success?: boolean;
  error?: boolean;
  message?: string;
  chart_type?: string;
  metric?: string;
  data?: ForecastDataPoint[];
  trend_summary?: {
    projected_change_pct: number;
    direction: "up" | "down" | "flat";
    last_actual: number;
    last_projected: number;
  };
  historical_days?: number;
  forecast_days?: number;
  _meta?: { tool: string; query: Record<string, unknown> };
}

export interface NegotiationDataRow {
  entity_name: string;
  total_calls: number;
  revenue: number;
  payout: number;
  profit: number;
  margin_pct: number;
  rpc: number;
  action_tag: string;
  suggested_tactic: string;
}

export interface NegotiationChartData {
  success?: boolean;
  error?: boolean;
  message?: string;
  chart_type?: string;
  partner_type?: "buyer" | "publisher";
  data?: NegotiationDataRow[];
  summary?: {
    total_partners: number;
    by_action_tag: Array<{ tag: string; count: number; total_profit: number }>;
  };
  _meta?: { tool: string; query: Record<string, unknown> };
}

export interface SimulationResult {
  target_name: string;
  total_calls: number;
  current_revenue: number;
  current_payout: number;
  current_profit: number;
  simulated_revenue: number;
  simulated_payout: number;
  simulated_profit: number;
  profit_change: number;
  profit_change_pct: number | null;
  change_description: string;
}

export interface SimulationChartData {
  success?: boolean;
  error?: boolean;
  message?: string;
  chart_type?: string;
  simulation?: {
    target_type: string;
    target_name: string;
    change_variable: string;
    change_amount: number;
  };
  data?: SimulationResult | null;
  data_notes?: string[];
  _meta?: { tool: string; query: Record<string, unknown> };
}

export interface CallSampleRow {
  call_id: string;
  start_time_utc: string;
  publisher_name: string;
  caller_masked: string;
  duration_seconds: number;
  revenue: number;
  payout: number;
  status_label: string;
  audio_url: string | null;
}

export interface CallSamplesChartData {
  success?: boolean;
  error?: boolean;
  message?: string;
  chart_type?: string;
  data?: CallSampleRow[];
  count?: number;
  filters_applied?: Record<string, unknown>;
  data_notes?: string[];
  _meta?: { tool: string; query: Record<string, unknown> };
}
