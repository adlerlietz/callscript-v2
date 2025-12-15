/**
 * Legacy Supabase client exports for backwards compatibility.
 * New code should use @/lib/supabase/client or @/lib/supabase/server.
 */
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

// Client for accessing core schema (requires auth or service_role)
export const supabaseCore = createClient(supabaseUrl, supabaseAnonKey, {
  db: {
    schema: "core",
  },
});

// Client for accessing public schema (has public views)
export const supabase = createClient(supabaseUrl, supabaseAnonKey);

// Re-export new client creators for gradual migration
export { createClient as createBrowserClient } from "@/lib/supabase/client";
export { createClient as createServerClient } from "@/lib/supabase/server";
