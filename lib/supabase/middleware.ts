import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Updates Supabase auth session in middleware.
 * Required to refresh expired sessions and keep users logged in.
 */
export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({
    request,
  });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({
            request,
          });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // IMPORTANT: Do not add code between createServerClient and supabase.auth.getUser()
  // A simple mistake could make your app vulnerable to security issues.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Define protected and public routes
  const isLoginPage = request.nextUrl.pathname === "/login";
  const isPublicRoute = request.nextUrl.pathname.startsWith("/api/public");
  const isAuthCallback = request.nextUrl.pathname === "/auth/callback";

  // If no user and trying to access protected route, redirect to login
  if (!user && !isLoginPage && !isPublicRoute && !isAuthCallback) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  // If user is logged in and on login page, redirect to dashboard
  if (user && isLoginPage) {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}
