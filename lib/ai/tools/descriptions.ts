/**
 * Tool descriptions for the AI to understand when to use each tool
 */
export const toolDescriptions = {
  get_kpi_summary:
    "Get aggregate KPIs (revenue, profit, margin, flag rate, RPC) for a date range. Use this for summary statistics.",
  get_trend_data:
    "Get time-series trend data for a metric (revenue, profit, calls, flag_rate, rpc). Returns up to 90 data points for charting.",
  get_leaderboard:
    "Get top performers ranked by a metric (revenue, profit, calls, flag_rate, rpc). Can group by publisher, buyer, campaign, vertical (industry), or state. Use vertical_filter to analyze WITHIN a vertical (e.g., 'best states for Medicare' = dimension:state, metric:rpc, vertical_filter:'medicare'). Returns top 25.",
  analyze_breakdown:
    "Drill down into a specific entity to explain its performance. Use this to answer 'WHY' questions. Example: If Florida is the top state, break it down by 'publisher' to see who drives that traffic. Example: If a publisher has high revenue, break it down by 'campaign' to see which campaigns perform best. Returns contribution percentages.",
  generate_forecast:
    "Project future metrics using linear regression on historical data. Use when user asks 'forecast', 'project', 'predict', or 'what will happen'. Returns historical data with trend line + projected future values. Always caveat results with 'Based on the last N days of data...'",
  analyze_negotiation_opportunities:
    "Find Buyers or Publishers with negotiation leverage. Use when user asks 'who should I negotiate with', 'increase profit', 'which publishers are bad', 'price increase opportunities', 'cut payout'. For Buyers: finds high-margin partners for price increases. For Publishers: finds money-losing partners to cut or block. Returns partners ranked by leverage with specific action recommendations.",
  simulate_financial_change:
    "Calculate hypothetical financial impact of payout or revenue changes. Use when user asks 'what if I cut payout', 'what if I raised CPA', 'simulate', 'impact of changing'. For Publishers: simulate payout changes (change_variable='payout'). For Buyers: simulate CPA/revenue changes (change_variable='revenue'). Returns current vs simulated profit comparison.",
  get_call_samples:
    "Fetch actual call records as proof points. Use when user asks 'show me calls', 'list examples', 'give me proof', 'find calls where...'. Filters by publisher, buyer, status (converted/missed/system_drop), duration range, revenue range, date range. Returns call details with masked caller numbers. Default 5 calls, max 25.",
};
