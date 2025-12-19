import { NextRequest } from "next/server";

export async function GET(req: NextRequest) {
  return new Response(JSON.stringify({
    NEXT_PUBLIC_SUPABASE_URL: !!process.env.NEXT_PUBLIC_SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
    supabase_service_role_key: !!process.env.supabase_service_role_key,
    OPENAI_API_KEY: !!process.env.OPENAI_API_KEY,
  }, null, 2), {
    headers: { "Content-Type": "application/json" }
  });
}
