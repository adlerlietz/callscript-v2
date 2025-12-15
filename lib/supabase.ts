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
