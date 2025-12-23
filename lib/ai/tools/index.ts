/**
 * AI Tools - Re-export all tools for convenient importing
 */

// Descriptions
export { toolDescriptions } from "./descriptions";

// Types
export type {
  KPISummaryResponse,
  TrendDataPoint,
  LeaderboardEntry,
  BreakdownEntry,
  ForecastDataPoint,
  NegotiationPartner,
  SimulationResult,
  CallSample,
} from "./types";

// KPI Summary
export { kpiSummarySchema, executeKpiSummary } from "./kpi";
export type { KpiSummaryParams } from "./kpi";

// Trend Data
export { trendDataSchema, executeTrendData } from "./trend";
export type { TrendDataParams } from "./trend";

// Leaderboard
export { leaderboardSchema, executeLeaderboard } from "./leaderboard";
export type { LeaderboardParams } from "./leaderboard";

// Breakdown Analysis
export { breakdownAnalysisSchema, executeBreakdownAnalysis } from "./breakdown";
export type { BreakdownAnalysisParams } from "./breakdown";

// Forecast
export { forecastSchema, executeForecast } from "./forecast";
export type { ForecastParams } from "./forecast";

// Negotiation
export { negotiationSchema, executeNegotiationAnalysis } from "./negotiation";
export type { NegotiationParams } from "./negotiation";

// Simulation
export { simulationSchema, executeSimulation } from "./simulation";
export type { SimulationParams } from "./simulation";

// Call Samples
export { callSamplesSchema, executeCallSamples } from "./call-samples";
export type { CallSamplesParams } from "./call-samples";
