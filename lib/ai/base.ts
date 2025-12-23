import { createClient } from "@supabase/supabase-js";

/**
 * AI Tools Base - Shared client and utilities
 */

// Create a simple Supabase client for AI tools (service role, no cookies)
export function getAIClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    console.error("AI Tools: Missing env vars", { url: !!url, key: !!key });
    throw new Error("Missing Supabase configuration");
  }

  return createClient(url, key);
}

// Standard tool response structure
export interface ToolResponse<T = unknown> {
  success?: boolean;
  error?: boolean;
  message?: string;
  data?: T;
  chart_type?: string;
  data_notes?: string[];
  _meta: {
    tool: string;
    query: Record<string, unknown>;
  };
}
